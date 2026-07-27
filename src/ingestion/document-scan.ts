import type { PlanDocument } from './document-reader.js';
import { readPlanDocument } from './document-reader.js';
import { chunkDocument } from './document-chunker.js';
import { scanPassages, type WarningSignHit, type CandidatePassage, type ScanOptions } from '../analysis/warning-sign-scanner.js';
import { scanLitigationLanguage, type LitigationLanguageObservation } from '../analysis/litigation-language.js';
import { extractCostShares, compareCostShareLevels, type CostShareLevelFinding } from './schedule-of-benefits.js';

/**
 * End-to-end plan-document screen: read → chunk → run the deterministic
 * warning-sign scanner + litigation-language detectors → produce a plain-English
 * "what may not be compliant" description with verbatim quotes and anchors.
 *
 * This is an AS-WRITTEN LANGUAGE SCREEN. It is deterministic and honest about
 * what it does NOT do: it does not perform the FR/QTL math (that needs the
 * schedule of benefits as structured numbers), it does not evaluate the plan
 * "in operation" (that needs claims data), and it does not draw legal
 * conclusions (every item is an indicator requiring review).
 */

export interface DocumentScanResult {
  source: string;
  format: PlanDocument['format'];
  pageCount: number | null;
  passageCount: number;
  warningSigns: Array<WarningSignHit & { occurrences: number }>;
  litigation: Array<LitigationLanguageObservation & { occurrences: number }>;
  costShareLevels: CostShareLevelFinding[];
  phiWarnings: string[];
}

const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/;

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function scanPlanDocumentText(doc: PlanDocument, documentId?: string, scanOpts?: ScanOptions): DocumentScanResult {
  const id = documentId ?? doc.source;
  const passages = chunkDocument(doc, { documentId: id });

  // Warning signs (dedup by rule + normalized quote).
  const wsMap = new Map<string, WarningSignHit & { occurrences: number }>();
  for (const hit of scanPassages(passages, undefined, scanOpts)) {
    const key = `${hit.ruleId}::${normalize(hit.passage.text)}`;
    const existing = wsMap.get(key);
    if (existing) existing.occurrences += 1;
    else wsMap.set(key, { ...hit, occurrences: 1 });
  }

  // Litigation-theory language (dedup similarly).
  const litMap = new Map<string, LitigationLanguageObservation & { occurrences: number }>();
  for (const obs of scanLitigationLanguage(passages)) {
    const key = `${obs.theoryRuleId}::${obs.label}::${normalize(obs.passage.text)}`;
    const existing = litMap.get(key);
    if (existing) existing.occurrences += 1;
    else litMap.set(key, { ...obs, occurrences: 1 });
  }

  // Schedule-of-benefits cost-share level comparison (facial).
  const costShareLevels = compareCostShareLevels(extractCostShares(passages));

  // Light PHI check — plan documents should be plan-level, not member data.
  const phiWarnings: string[] = [];
  if (SSN_RE.test(doc.text)) {
    phiWarnings.push('An SSN-like pattern was found in the document text. Plan documents should not contain member PHI; verify before sharing.');
  }

  return {
    source: doc.source,
    format: doc.format,
    pageCount: doc.pageCount,
    passageCount: passages.length,
    warningSigns: [...wsMap.values()],
    litigation: [...litMap.values()],
    costShareLevels,
    phiWarnings,
  };
}

/** Read + chunk file(s) into all candidate passages (for cost-share extraction in a full run). */
export async function extractAllChunks(filePaths: string[]): Promise<CandidatePassage[]> {
  const out: CandidatePassage[] = [];
  for (const path of filePaths) {
    const doc = await readPlanDocument(path);
    out.push(...chunkDocument(doc, { documentId: path }));
  }
  return out;
}

/** Read a file from disk and scan it. */
export async function scanPlanDocumentFile(filePath: string, documentId?: string, scanOpts?: ScanOptions): Promise<DocumentScanResult> {
  const doc = await readPlanDocument(filePath);
  return scanPlanDocumentText(doc, documentId, scanOpts);
}

/** Extract deduped candidate passages that fired a rule — for wiring into runAnalysis. */
export async function extractWarningSignPassages(filePaths: string[]): Promise<CandidatePassage[]> {
  const out: CandidatePassage[] = [];
  for (const path of filePaths) {
    const result = await scanPlanDocumentFile(path);
    for (const hit of result.warningSigns) out.push(hit.passage);
  }
  return out;
}

/** Plain-English "what may not be compliant" description. */
export function describeDocumentScan(result: DocumentScanResult): string {
  const L: string[] = [];
  L.push(`# Plan-document compliance screen — ${result.source}`);
  L.push('');
  L.push(
    `Read ${result.pageCount ? `${result.pageCount} page(s)` : 'document'} (${result.format}); analyzed ${result.passageCount} passages.`,
  );
  L.push('');
  L.push('> **What this is:** a deterministic, AS-WRITTEN language screen. Each item below is an INDICATOR that a');
  L.push('> provision *may* not be compliant and warrants further review — none is a determination of noncompliance.');
  L.push('> **What this does NOT do:** the FR/QTL math (copay/coinsurance/day-limit parity) needs the schedule of');
  L.push('> benefits as structured numbers; the "in operation" analysis needs claims data; legal conclusions require');
  L.push('> attorney review. This screen surfaces plan LANGUAGE that matches known parity concerns.');
  L.push('');

  if (result.phiWarnings.length) {
    L.push('## ⚠ PHI warning');
    for (const w of result.phiWarnings) L.push(`- ${w}`);
    L.push('');
  }

  L.push(`## Potential non-compliance signals — DOL Warning Signs (${result.warningSigns.length})`);
  L.push('');
  if (result.warningSigns.length === 0) {
    L.push('_No DOL Warning Signs matched the plan language. (Absence of language-level signals does not establish compliance — the FR/QTL math and in-operation analysis are still required.)_');
  } else {
    const byCat = groupBy(result.warningSigns, (h) => h.category);
    for (const cat of Object.keys(byCat).sort()) {
      L.push(`### Category ${cat}`);
      L.push('');
      for (const h of byCat[cat]!) {
        L.push(`- **${h.ruleName}** — _${h.passage.section ?? 'unknown section'}${h.passage.page ? `, p.${h.passage.page}` : ''}_${h.occurrences > 1 ? ` (×${h.occurrences})` : ''}`);
        L.push(`  - Plan language (verbatim): "${h.passage.text}"`);
        L.push(`  - Why it may matter: ${h.rationale}`);
        L.push(`  - Authority: ${h.citation}`);
      }
      L.push('');
    }
  }

  L.push(`## Litigation-theory language (${result.litigation.length}) — case-law rules INACTIVE pending attorney verification`);
  L.push('');
  if (result.litigation.length === 0) {
    L.push('_No litigation-theory language patterns matched._');
  } else {
    L.push('These match the fact pattern of a known case; the corresponding rule does not "fire" until an attorney');
    L.push('verifies the citation/holding and activates it. Treat as language to review, not a conclusion.');
    L.push('');
    for (const o of result.litigation) {
      L.push(`- **${o.label}** → theory: *${o.caseName}* (rule \`${o.theoryRuleId}\`, inactive)${o.occurrences > 1 ? ` (×${o.occurrences})` : ''}`);
      L.push(`  - _${o.passage.section ?? 'unknown section'}${o.passage.page ? `, p.${o.passage.page}` : ''}_`);
      L.push(`  - Plan language (verbatim): "${o.passage.text}"`);
      L.push(`  - Why it may matter: ${o.why}`);
    }
    L.push('');
  }

  L.push(`## Cost-share level comparison — Schedule of Benefits (${result.costShareLevels.length})`);
  L.push('');
  if (result.costShareLevels.length === 0) {
    L.push('_No MH/SUD-more-restrictive cost-share levels were extracted. (If the numeric copays/coinsurance live in a separate Summary of Benefits, provide it — this SPD may describe structure without the numbers.)_');
  } else {
    L.push('Facial comparison of stated cost shares (the dollar-weighted substantially-all/predominant test additionally needs claims data):');
    L.push('');
    for (const c of result.costShareLevels) {
      L.push(`- **${c.classification} — ${c.frType.replace('_', ' ')}**: MH/SUD ${fmtLevel(c.frType, c.mhsudLevel)} vs M/S ${fmtLevel(c.frType, c.msLevel)} (more restrictive for MH/SUD)`);
      L.push(`  - MH/SUD line: "${c.mhsudServiceText}"${c.mhsudAnchor.page ? ` (p.${c.mhsudAnchor.page})` : ''}`);
      L.push(`  - M/S line: "${c.msServiceText}"${c.msAnchor.page ? ` (p.${c.msAnchor.page})` : ''}`);
    }
  }
  L.push('');

  L.push('## Recommended next steps');
  L.push('');
  L.push('1. Provide the **schedule of benefits** (copays, coinsurance, deductibles, day/visit limits by classification)');
  L.push('   so the engine can run the substantially-all and predominant FR/QTL tests.');
  L.push('2. Provide **de-identified claims data** to run the in-operation analysis (denial rates, PA, overturns, etc.).');
  L.push('3. Have counsel review each item above; activate the relevant case-law rules after verifying citations.');
  L.push('4. Nothing here is a completed comparative analysis or legal advice until attorney-reviewed.');
  return L.join('\n');
}

function groupBy<T>(items: T[], key: (t: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const it of items) (out[key(it)] ??= []).push(it);
  return out;
}

function fmtLevel(frType: string, level: number): string {
  if (frType === 'coinsurance') return `${level}%`;
  if (frType === 'copay' || frType === 'deductible') return `$${level}`;
  if (frType === 'day_limit') return `${level} days`;
  if (frType === 'visit_limit') return `${level} visits`;
  return String(level);
}
