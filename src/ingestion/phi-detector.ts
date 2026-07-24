import type { Table } from './table.js';

/**
 * Module 2 — PHI gate (Non-negotiable #2).
 *
 * Runs BEFORE any row reaches an analysis engine. If member names, SSNs, MRNs,
 * full DOBs, addresses, or member IDs that are not already hashed are detected,
 * the upload is REJECTED with a field-level report. Fail closed. Never silently
 * strip and proceed.
 *
 * Design rule: the report identifies WHERE PHI was found (column, row indices,
 * type, count) but NEVER echoes the PHI value itself — a PHI report that quoted
 * SSNs would itself be a PHI leak.
 */

export type PhiType =
  | 'ssn'
  | 'mrn'
  | 'dob'
  | 'address'
  | 'member_name'
  | 'unhashed_member_id'
  | 'email'
  | 'phone';

export interface PhiFinding {
  type: PhiType;
  column: string;
  detectedBy: 'column_name' | 'value_pattern';
  /** Number of offending cells. */
  matchCount: number;
  /** Up to 5 offending row indices (0-based, excluding header). Never the values. */
  sampleRowIndices: number[];
  remediation: string;
}

export interface PhiScanResult {
  clean: boolean;
  findings: PhiFinding[];
  scannedColumns: number;
  scannedRows: number;
}

// ---- Value patterns -------------------------------------------------------

const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/;
// 9 consecutive digits are treated as a possible SSN only in ssn-named columns
// (bare 9-digit strings are too common — claim ids, etc. — for a global rule).
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;
const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/;
// Full date of birth: MM/DD/YYYY, M-D-YYYY, or YYYY-MM-DD with a plausible year.
const FULL_DATE_RE = /\b(?:(?:0?[1-9]|1[0-2])[/-](?:0?[1-9]|[12]\d|3[01])[/-](?:19|20)\d{2}|(?:19|20)\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01]))\b/;
// Street address: leading number + street-type keyword.
const ADDRESS_RE = /\b\d{1,6}\s+([A-Za-z0-9.'-]+\s+){0,4}(st(?:reet)?|ave(?:nue)?|blvd|boulevard|rd|road|ln|lane|dr(?:ive)?|ct|court|way|pl(?:ace)?|ter(?:race)?|cir(?:cle)?|pkwy|parkway|hwy|highway|apt|suite|ste|unit)\b/i;

// Hashed identifiers: hex digests of common lengths (md5/sha1/sha256).
const HASH_RE = /^[a-f0-9]{32}$|^[a-f0-9]{40}$|^[a-f0-9]{64}$/i;

// ---- Column-name heuristics ----------------------------------------------

function normHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/** Column-name → PHI type. Provider name/NPI are intentionally NOT member PHI. */
const NAME_COLUMN_HINTS: Array<{ re: RegExp; type: PhiType }> = [
  { re: /^ssn$|social_security|_ssn$|^tax_id$|^tin$/, type: 'ssn' },
  { re: /^mrn$|medical_record|record_number|^chart_number$/, type: 'mrn' },
  { re: /(date_of_birth|^dob$|birth_date|^birthdate$|_dob$)/, type: 'dob' },
  {
    re: /(street|address|addr1|addr_1|address_line|home_address|mailing_address|^city$|^zip$|zipcode|zip_code|postal_code)/,
    type: 'address',
  },
  { re: /^email|email_address|_email$/, type: 'email' },
  { re: /(phone|telephone|mobile|cell_number)/, type: 'phone' },
];

// Member-name columns. Guard against provider_* / rendering_* / billing_* which
// are not member PHI.
const MEMBER_NAME_RE =
  /(member|subscriber|patient|insured|dependent|enrollee|beneficiary)?_?(full_name|first_name|last_name|middle_name|^name$|_name$)/;
const PROVIDER_PREFIX_RE = /(provider|rendering|billing|servicing|facility|prescriber|referring|attending|npi|group_name)/;

// Member/subscriber identifier columns (must be hashed).
const MEMBER_ID_RE =
  /(member_id|member_number|subscriber_id|subscriber_number|enrollee_id|patient_id|patient_account|policy_id|policy_number|cert(?:ificate)?_number|unique_member)/;

function memberNameColumn(norm: string): boolean {
  if (PROVIDER_PREFIX_RE.test(norm)) return false;
  return MEMBER_NAME_RE.test(norm);
}

function looksLikePersonName(v: string): boolean {
  // "Last, First" or "First Last" with 2+ capitalized alpha tokens.
  const cleaned = v.replace(/,/g, ' ').trim();
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  if (tokens.length < 2 || tokens.length > 4) return false;
  const nameLike = tokens.filter((t) => /^[A-Z][a-z'’-]{1,}$/.test(t));
  return nameLike.length >= 2;
}

// ---- Scanner --------------------------------------------------------------

function remediationFor(type: PhiType): string {
  switch (type) {
    case 'ssn':
      return 'Remove the SSN/TIN column entirely before upload. It is never needed for parity analysis.';
    case 'mrn':
      return 'Remove medical record numbers. Use a hashed member identifier (SHA-256 hex) for claim linkage instead.';
    case 'dob':
      return 'Replace full date of birth with age band or year only; parity analysis never needs full DOB.';
    case 'address':
      return 'Remove street address / ZIP+4 / city columns. If geographic analysis is needed, provide 3-digit ZIP or county only.';
    case 'member_name':
      return 'Remove all member/patient name columns. Link claims by a hashed member id.';
    case 'unhashed_member_id':
      return 'Hash member identifiers with SHA-256 (hex) before upload; raw member ids are re-identifiable.';
    case 'email':
      return 'Remove email addresses; not used in parity analysis.';
    case 'phone':
      return 'Remove phone numbers; not used in parity analysis.';
  }
}

export function scanTableForPhi(table: Table): PhiScanResult {
  const findings: PhiFinding[] = [];

  const addFinding = (
    type: PhiType,
    column: string,
    detectedBy: PhiFinding['detectedBy'],
    rowIndices: number[],
  ) => {
    findings.push({
      type,
      column,
      detectedBy,
      matchCount: rowIndices.length,
      sampleRowIndices: rowIndices.slice(0, 5),
      remediation: remediationFor(type),
    });
  };

  for (const header of table.headers) {
    const norm = normHeader(header);

    // 1) Column-name heuristics for member names and member IDs.
    if (memberNameColumn(norm)) {
      const rowIdx = table.rows
        .map((r, i) => (r[header] && r[header] !== '' ? i : -1))
        .filter((i) => i >= 0);
      if (rowIdx.length > 0) addFinding('member_name', header, 'column_name', rowIdx);
    }

    if (MEMBER_ID_RE.test(norm)) {
      const rowIdx: number[] = [];
      table.rows.forEach((r, i) => {
        const v = r[header];
        if (v && v !== '' && !HASH_RE.test(v)) rowIdx.push(i);
      });
      if (rowIdx.length > 0) addFinding('unhashed_member_id', header, 'column_name', rowIdx);
    }

    for (const hint of NAME_COLUMN_HINTS) {
      if (hint.re.test(norm)) {
        const rowIdx = table.rows
          .map((r, i) => (r[header] && r[header] !== '' ? i : -1))
          .filter((i) => i >= 0);
        if (rowIdx.length > 0) addFinding(hint.type, header, 'column_name', rowIdx);
      }
    }
  }

  // 2) Value-pattern scanning across ALL columns (defense in depth: a mislabeled
  //    or free-text column can still leak PHI). DOB is only pattern-flagged if
  //    the column was not already identified — full-date values also appear as
  //    date_of_service, so we require the column not be a service-date column.
  const alreadyFlaggedCols = new Set(findings.map((f) => `${f.column}:${f.type}`));
  for (const header of table.headers) {
    const norm = normHeader(header);
    const isServiceDate = /(date_of_service|service_date|dos|paid_date|process_date|admit_date|discharge_date)/.test(norm);

    const ssnRows: number[] = [];
    const emailRows: number[] = [];
    const phoneRows: number[] = [];
    const addrRows: number[] = [];
    const dobRows: number[] = [];

    table.rows.forEach((r, i) => {
      const v = r[header];
      if (!v) return;
      if (SSN_RE.test(v)) ssnRows.push(i);
      if (EMAIL_RE.test(v)) emailRows.push(i);
      if (PHONE_RE.test(v)) phoneRows.push(i);
      if (ADDRESS_RE.test(v)) addrRows.push(i);
      // Full DOB by value: skip service-date columns; a birth-ish column name or
      // an unknown column with full dates is treated as DOB (fail closed).
      if (!isServiceDate && FULL_DATE_RE.test(v)) dobRows.push(i);
    });

    if (ssnRows.length && !alreadyFlaggedCols.has(`${header}:ssn`)) addFinding('ssn', header, 'value_pattern', ssnRows);
    if (emailRows.length && !alreadyFlaggedCols.has(`${header}:email`)) addFinding('email', header, 'value_pattern', emailRows);
    if (phoneRows.length && !alreadyFlaggedCols.has(`${header}:phone`)) addFinding('phone', header, 'value_pattern', phoneRows);
    if (addrRows.length && !alreadyFlaggedCols.has(`${header}:address`)) addFinding('address', header, 'value_pattern', addrRows);
    // Only escalate value-pattern DOB when the column name is birth-ish OR
    // wholly unrecognized; a fully-populated unknown date column is suspicious.
    const dobColumnish = /(birth|dob)/.test(norm);
    if (dobRows.length && dobColumnish && !alreadyFlaggedCols.has(`${header}:dob`)) {
      addFinding('dob', header, 'value_pattern', dobRows);
    }
  }

  // 3) Person-name heuristic on unrecognized text columns (catch a "notes" or
  //    mislabeled column carrying names). Only fires when a strong majority of a
  //    column's sampled values look like person names, to limit false positives.
  for (const header of table.headers) {
    const norm = normHeader(header);
    if (memberNameColumn(norm) || PROVIDER_PREFIX_RE.test(norm)) continue; // handled / excluded
    if (findings.some((f) => f.column === header && f.type === 'member_name')) continue;
    const values = table.rows.map((r) => r[header] ?? '').filter((v) => v !== '');
    if (values.length < 3) continue;
    const sample = values.slice(0, 50);
    const nameHits = sample.filter(looksLikePersonName).length;
    if (nameHits / sample.length >= 0.6) {
      const rowIdx = table.rows
        .map((r, i) => (looksLikePersonName(r[header] ?? '') ? i : -1))
        .filter((i) => i >= 0);
      addFinding('member_name', header, 'value_pattern', rowIdx);
    }
  }

  return {
    clean: findings.length === 0,
    findings,
    scannedColumns: table.headers.length,
    scannedRows: table.rows.length,
  };
}

/** Human-readable, PHI-safe rejection report. */
export function formatPhiRejection(table: Table, result: PhiScanResult): string {
  const lines: string[] = [];
  lines.push(`PHI GATE: upload REJECTED — ${table.source}`);
  lines.push(`Scanned ${result.scannedRows} rows across ${result.scannedColumns} columns.`);
  lines.push('');
  lines.push('Detected protected health information (values are intentionally NOT shown):');
  for (const f of result.findings) {
    lines.push(
      `  • [${f.type}] column "${f.column}" — ${f.matchCount} cell(s), detected by ${f.detectedBy}` +
        (f.sampleRowIndices.length ? ` (e.g. rows ${f.sampleRowIndices.join(', ')})` : ''),
    );
    lines.push(`      → ${f.remediation}`);
  }
  lines.push('');
  lines.push('Fix every item above and re-upload. The engine fails closed: no rows were analyzed.');
  return lines.join('\n');
}
