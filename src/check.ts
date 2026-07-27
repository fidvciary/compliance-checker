import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { AuditLog } from './audit/audit-log.js';
import { loadRulesetsFromDir } from './rulesets/loader.js';
import { RulesetRegistry } from './rulesets/registry.js';
import { resolveSensitivity, type SensitivityLevel } from './config/sensitivity.js';
import { readAnyDocument, readAnyTable, isTableFile, isDocumentFile, guessKind, type UploadKind } from './ingestion/any-file.js';
import { scanPlanDocumentText } from './ingestion/document-scan.js';
import { ingestTable, PhiRejectedError } from './ingestion/ingest.js';
import { buildAvailabilityMatrix } from './ingestion/availability-matrix.js';
import type { IngestResult } from './ingestion/ingest.js';
import type { CanonicalDataset } from './ingestion/canonical-schema.js';
import { aggregateClaimsForInOperation } from './in-operation/claims-aggregation.js';
import { runComparisonFamily } from './in-operation/metrics.js';
import {
  fromWarningSign, fromLitigationObservation, fromCostShareLevel, fromInOperation, resetFindingIds,
  type SynthesisContext,
} from './findings/synthesis.js';
import { assignAndRankRisk } from './findings/risk.js';
import type { Finding } from './findings/finding.js';
import type { AvailabilityMatrix } from './ingestion/availability-matrix.js';

const here = dirname(fileURLToPath(import.meta.url));
const RULESETS_DIR = join(here, '..', 'rulesets');

export type CheckScope = 'as-written' | 'everything';

export interface UploadedFile {
  name: string;
  bytes: Buffer;
  /** What the user says this is; if omitted, guessed from the name. */
  kind?: UploadKind;
}

export interface CheckOptions {
  scope: CheckScope;
  sensitivity?: SensitivityLevel;
  jurisdiction?: string;
}

export interface CheckResult {
  scope: CheckScope;
  sensitivity: SensitivityLevel;
  jurisdiction: string;
  issues: Finding[]; // risk-ranked, highest first
  phiRejections: Array<{ file: string; report: string }>;
  documentsAnalyzed: Array<{ name: string; format: string; pages: number | null; passages: number }>;
  claimsAnalyzed: { rows: number; classified: number; quarantined: number; msClaims: number; mhsudClaims: number } | null;
  dataAvailability: AvailabilityMatrix;
  checked: string[];
  limitations: string[];
  errors: Array<{ file: string; message: string }>;
}

const TABLE_KINDS: Record<UploadKind, CanonicalDataset | null> = {
  claims: 'claims',
  prior_auth: 'prior_auth',
  appeals: 'appeals',
  network: 'network',
  reimbursement: 'reimbursement',
  plan_document: null,
  schedule_of_benefits: null,
  unknown: null,
};

/**
 * Compliance CHECK — flags where a plan may lack MHPAEA parity. No report is
 * produced: the deliverable is the risk-ranked list of flagged issues.
 *
 * scope='as-written'  → analyze uploaded plan documents / schedule of benefits.
 * scope='everything'  → additionally analyze claims data "in operation" (denial
 *                       rates by classification). Claims go through the PHI gate
 *                       first and are rejected fail-closed if PHI is present.
 */
export async function checkCompliance(files: UploadedFile[], options: CheckOptions): Promise<CheckResult> {
  const sensitivity = resolveSensitivity(options.sensitivity ?? 'balanced');
  const jurisdiction = options.jurisdiction ?? 'federal';
  const audit = new AuditLog();
  resetFindingIds();

  const rulesets = loadRulesetsFromDir(RULESETS_DIR);
  const registry = new RulesetRegistry(rulesets, {
    active: ['federal:statute', 'federal:2013', 'guidance:*', `state:${jurisdiction.toLowerCase()}`],
    advisory: ['federal:2024'],
  });
  const ctx: SynthesisContext = { analysisId: 'CHECK', registry, audit };
  const scanOpts = {
    requireCueForSectionContext: sensitivity.warningSignRequireCueForSection,
    emitAppliesToBothAsVerify: sensitivity.emitAppliesToBothAsVerify,
  };

  const issues: Finding[] = [];
  const phiRejections: CheckResult['phiRejections'] = [];
  const documentsAnalyzed: CheckResult['documentsAnalyzed'] = [];
  const errors: CheckResult['errors'] = [];
  const ingested: IngestResult[] = [];
  let claimsAnalyzed: CheckResult['claimsAnalyzed'] = null;

  for (const f of files) {
    const kind = f.kind ?? guessKind(f.name);
    try {
      // ---- Documents (as-written) ----
      if (kind === 'plan_document' || kind === 'schedule_of_benefits' || (kind === 'unknown' && isDocumentFile(f.name))) {
        const doc = await readAnyDocument(f.name, f.bytes);
        const scan = scanPlanDocumentText(doc, f.name, scanOpts);
        documentsAnalyzed.push({ name: f.name, format: doc.format, pages: doc.pageCount, passages: scan.passageCount });
        for (const h of scan.warningSigns) issues.push(fromWarningSign(ctx, h));
        for (const o of scan.litigation) issues.push(fromLitigationObservation(ctx, o));
        for (const c of scan.costShareLevels) issues.push(fromCostShareLevel(ctx, c));
        continue;
      }
      // ---- Tables ----
      if (isTableFile(f.name) || TABLE_KINDS[kind]) {
        const dataset = TABLE_KINDS[kind] ?? 'claims';
        const table = await readAnyTable(f.name, f.bytes);
        try {
          const res = ingestTable(table, { dataset, audit }); // PHI gate here
          ingested.push(res);
          if (dataset === 'claims' && options.scope === 'everything') {
            const agg = aggregateClaimsForInOperation(res.records);
            claimsAnalyzed = {
              rows: res.rowCount,
              classified: agg.classifiedCount,
              quarantined: agg.quarantinedCount,
              msClaims: agg.msCount,
              mhsudClaims: agg.mhsudCount,
            };
            const opts = { reportNearSignificant: sensitivity.reportNearSignificant, nearSignificantAlpha: sensitivity.nearSignificantAlpha };
            for (const r of runComparisonFamily(agg.rateComparisons, audit, opts)) {
              const finding = fromInOperation(ctx, r);
              if (finding) issues.push(finding);
            }
          }
        } catch (e) {
          if (e instanceof PhiRejectedError) {
            phiRejections.push({ file: f.name, report: e.report });
          } else throw e;
        }
        continue;
      }
      errors.push({ file: f.name, message: `Could not classify file type for '${f.name}'.` });
    } catch (e) {
      errors.push({ file: f.name, message: (e as Error).message });
    }
  }

  const dataAvailability = buildAvailabilityMatrix(ingested);
  const ranked = assignAndRankRisk(issues);

  // What was / wasn't checked.
  const checked: string[] = [];
  if (documentsAnalyzed.length) checked.push(`As-written language of ${documentsAnalyzed.length} document(s): DOL Warning Signs, litigation-theory language, and Schedule-of-Benefits cost-share comparison.`);
  if (options.scope === 'everything' && claimsAnalyzed) checked.push(`In-operation denial rates from ${claimsAnalyzed.rows} claim rows (${claimsAnalyzed.classified} classified).`);

  const limitations: string[] = [];
  if (options.scope === 'as-written') limitations.push('In-operation analysis was not run (as-written mode). Outcome disparities in claims are not evaluated.');
  if (options.scope === 'everything' && !claimsAnalyzed) limitations.push('No claims data was analyzed (none uploaded or all rejected), so no in-operation flags were produced.');
  limitations.push('The dollar-weighted substantially-all/predominant FR/QTL test requires a claims extract; cost-share flags here are facial level comparisons.');
  limitations.push('Cash-pay and out-of-network MH/SUD care that never generates a claim is invisible to claims-based analysis and understates access problems.');
  limitations.push('Every item is an indicator requiring review, not a determination of noncompliance or legal advice. Case-law rules stay inactive until an attorney verifies them.');

  return {
    scope: options.scope,
    sensitivity: sensitivity.level,
    jurisdiction,
    issues: ranked,
    phiRejections,
    documentsAnalyzed,
    claimsAnalyzed,
    dataAvailability,
    checked,
    limitations,
    errors,
  };
}
