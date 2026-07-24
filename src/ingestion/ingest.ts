import type { Table } from './table.js';
import { parseCsv } from './table.js';
import { scanTableForPhi, formatPhiRejection, type PhiScanResult } from './phi-detector.js';
import { mapColumns, type MapOptions, type MappingResult } from './column-mapping.js';
import type { CanonicalDataset } from './canonical-schema.js';
import type { AuditLog } from '../audit/audit-log.js';

/**
 * Ingestion orchestration.
 *
 * Order is mandatory and enforced here: parse → PHI GATE (fail closed) → map.
 * If the PHI gate is not clean, ingestion throws PhiRejectedError and NO rows
 * are returned to any engine. The rejection is recorded in the audit log.
 */

export class PhiRejectedError extends Error {
  constructor(
    public readonly source: string,
    public readonly scan: PhiScanResult,
    public readonly report: string,
  ) {
    super(`PHI detected in ${source}; ingestion rejected (fail closed).`);
    this.name = 'PhiRejectedError';
  }
}

export interface IngestResult {
  dataset: CanonicalDataset;
  source: string;
  table: Table;
  mapping: MappingResult;
  /** Canonical rows: each row keyed by canonical field name (only mapped fields). */
  records: Array<Record<string, string>>;
  rowCount: number;
}

export interface IngestOptions extends MapOptions {
  audit?: AuditLog;
  /** Actor label for audit entries. */
  actor?: string;
}

/** Ingest already-parsed CSV text for a dataset. */
export function ingestCsv(text: string, source: string, opts: IngestOptions): IngestResult {
  const table = parseCsv(text, source);
  return ingestTable(table, opts);
}

export function ingestTable(table: Table, opts: IngestOptions): IngestResult {
  const actor = opts.actor ?? 'engine';
  opts.audit?.append('ingestion.received', actor, {
    source: table.source,
    dataset: opts.dataset,
    rows: table.rows.length,
    columns: table.headers.length,
  });

  // ---- PHI GATE (fail closed) ----
  const scan = scanTableForPhi(table);
  if (!scan.clean) {
    const report = formatPhiRejection(table, scan);
    // Record the rejection WITHOUT any PHI values (findings carry only metadata).
    opts.audit?.append('ingestion.phi_rejected', actor, {
      source: table.source,
      dataset: opts.dataset,
      findings: scan.findings.map((f) => ({
        type: f.type,
        column: f.column,
        detectedBy: f.detectedBy,
        matchCount: f.matchCount,
      })),
    });
    throw new PhiRejectedError(table.source, scan, report);
  }

  // ---- column mapping ----
  const mapping = mapColumns(table.headers, opts);
  const records = table.rows.map((row) => {
    const rec: Record<string, string> = {};
    for (const [canonical, header] of Object.entries(mapping.resolved)) {
      const v = row[header];
      if (v !== undefined) rec[canonical] = v;
    }
    return rec;
  });

  opts.audit?.append('ingestion.accepted', actor, {
    source: table.source,
    dataset: opts.dataset,
    rows: records.length,
    mappedFields: Object.keys(mapping.resolved).sort(),
    unmappedFields: mapping.unmapped,
  });

  return { dataset: opts.dataset, source: table.source, table, mapping, records, rowCount: records.length };
}
