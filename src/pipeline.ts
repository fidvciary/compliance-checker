import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Clock } from './util/clock.js';
import { systemClock } from './util/clock.js';
import { AuditLog } from './audit/audit-log.js';
import { loadRulesetsFromDir } from './rulesets/loader.js';
import { RulesetRegistry } from './rulesets/registry.js';
import { loadCaselawFromDir } from './analysis/caselaw/loader.js';
import { CaselawRegistry } from './analysis/caselaw/registry.js';
import type { CaselawRule } from './analysis/caselaw/rule-schema.js';
import type { PlanFacts } from './analysis/caselaw/predicates.js';
import { ClassificationScheme } from './classification/consistency-lock.js';
import { CLASSIFICATIONS, type Classification } from './classification/classifications.js';
import { scaffoldSixStep } from './nqtl/scaffolder.js';
import type { NqtlSet } from './nqtl/nqtl-library.js';
import { crossCheckFactorSymmetry, type SideProfile } from './nqtl/factors.js';
import { evaluateQtl } from './qtl/qtl-engine.js';
import { evaluateCumulative, evaluateDollarLimit, type CumulativeInput, type DollarLimitInput } from './qtl/cumulative.js';
import type { QtlTestInput, QtlDetermination } from './qtl/types.js';
import { scanPassages, detectDualAdministrator, type CandidatePassage, type VendorAssignment } from './analysis/warning-sign-scanner.js';
import { extractCostShares, compareCostShareLevels } from './ingestion/schedule-of-benefits.js';
import { compareAsWritten, type AsWrittenNqtlProfile, type CompareOptions } from './analysis/as-written-comparability.js';
import { runComparisonFamily, type RateComparisonInput } from './in-operation/metrics.js';
import { buildAvailabilityMatrix } from './ingestion/availability-matrix.js';
import type { IngestResult } from './ingestion/ingest.js';
import {
  fromQtl, fromCumulative, fromDollarLimit, fromWarningSign, fromDualAdministrator,
  fromAsWritten, fromFactorAsymmetry, fromCaselaw, fromInOperation, fromCostShareLevel, resetFindingIds,
  type SynthesisContext,
} from './findings/synthesis.js';
import type { Finding } from './findings/finding.js';
import { buildComparativeAnalysisReport } from './report/comparative-analysis.js';
import { buildSelfComplianceToolReport, type ReimbursementRow } from './report/self-compliance-tool.js';
import type { EvaluationScope, ReportRecord } from './report/report-model.js';
import type { MethodologyConfig } from './report/methodology.js';
import { resolveSensitivity, type SensitivityLevel } from './config/sensitivity.js';
import { assignAndRankRisk } from './findings/risk.js';

const here = dirname(fileURLToPath(import.meta.url));
export const RULESETS_DIR = join(here, '..', 'rulesets');
export const CASELAW_DIR = join(here, '..', 'caselaw');

export interface AnalysisInput {
  analysisId: string;
  planYear: number;
  scope: EvaluationScope;
  jurisdiction: string;
  rulesetSelectors: { active: string[]; advisory: string[] };
  nqtlSet: NqtlSet;
  /** Precision/recall dial. Default 'balanced'; 'aggressive' flags any possible gap and ranks by risk. */
  sensitivity?: SensitivityLevel;
  classifications?: Classification[];
  samplePeriod?: string | null;
  projectionMethod?: string;
  dataSources?: Array<{ artifact: string; provenance: string }>;
  ingestedDatasets?: IngestResult[];

  qtlInputs?: QtlTestInput[];
  cumulativeInputs?: CumulativeInput[];
  dollarLimitInputs?: Array<{ scope: 'aggregate_lifetime' | 'annual' } & DollarLimitInput>;

  warningSignPassages?: CandidatePassage[];
  /** Passages (e.g., Schedule-of-Benefits lines) to extract cost-share levels from. */
  costSharePassages?: CandidatePassage[];
  vendorMap?: VendorAssignment[];
  asWrittenComparisons?: Array<{ nqtlId: string; classification: Classification; ms: AsWrittenNqtlProfile; mhsud: AsWrittenNqtlProfile; opts?: CompareOptions }>;
  factorProfiles?: Array<{ nqtlId: string; classification: Classification; ms: SideProfile; mhsud: SideProfile }>;

  planFacts?: PlanFacts;
  rateComparisons?: RateComparisonInput[];
  reimbursementTable?: ReimbursementRow[];

  /** TEST/DEMO ONLY: activate named case-law rules (normally requires attorney verification). */
  caselawActivateForTest?: string[];
}

export interface AnalysisResult {
  audit: AuditLog;
  registry: RulesetRegistry;
  caselaw: CaselawRegistry;
  findings: Finding[];
  qtlDeterminations: QtlDetermination[];
  comparativeReport: ReportRecord;
  selfComplianceReport: ReportRecord;
}

export function runAnalysis(input: AnalysisInput, opts: { clock?: Clock } = {}): AnalysisResult {
  const clock = opts.clock ?? systemClock;
  const audit = new AuditLog(clock);
  resetFindingIds();

  // Rulesets + registry
  const rulesets = loadRulesetsFromDir(RULESETS_DIR);
  const registry = new RulesetRegistry(rulesets, input.rulesetSelectors);
  audit.append('ruleset.loaded', 'engine', { active: registry.coverSummary().active, advisory: registry.coverSummary().advisory });

  // Case-law pack (all inactive unless a test activates)
  let caselawRules: CaselawRule[] = loadCaselawFromDir(CASELAW_DIR);
  if (input.caselawActivateForTest?.length) {
    const set = new Set(input.caselawActivateForTest);
    caselawRules = caselawRules.map((r) => (set.has(r.id) ? { ...r, verified_by: 'TEST', verified_date: '2026-07-01', active: true } : r));
  }
  const caselaw = new CaselawRegistry(caselawRules);

  // Classification scheme (locked) — shared by QTL and NQTL
  const scheme = (() => {
    const s = new ClassificationScheme();
    for (const c of input.classifications ?? [...CLASSIFICATIONS]) s.addClassification(c);
    return s.lock();
  })();

  // NQTL six-step scaffold
  const { registry: sixStep } = scaffoldSixStep({ scheme, nqtlSet: input.nqtlSet, scope: input.scope, audit });

  const ctx: SynthesisContext = { analysisId: input.analysisId, registry, audit };
  const findings: Finding[] = [];
  const sensitivity = resolveSensitivity(input.sensitivity);

  // QTL/FR
  const qtlDeterminations: QtlDetermination[] = [];
  for (const q of input.qtlInputs ?? []) {
    const d = evaluateQtl({ ...q, epsilon: q.epsilon ?? sensitivity.qtlEpsilon });
    qtlDeterminations.push(d);
    audit.append('qtl.computed', 'engine', { classification: d.classification, frQtl: d.frQtlTypeId, verdict: d.compliance.verdict });
    const f = fromQtl(ctx, d);
    if (f) findings.push(f);
  }
  for (const c of input.cumulativeInputs ?? []) {
    for (const cf of evaluateCumulative(c)) findings.push(fromCumulative(ctx, cf));
  }
  for (const dl of input.dollarLimitInputs ?? []) {
    const f = evaluateDollarLimit(dl);
    if (f) findings.push(fromDollarLimit(ctx, f));
  }

  // As-written: warning signs + dual admin
  if (input.warningSignPassages?.length) {
    const scanOpts = {
      requireCueForSectionContext: sensitivity.warningSignRequireCueForSection,
      emitAppliesToBothAsVerify: sensitivity.emitAppliesToBothAsVerify,
    };
    for (const h of scanPassages(input.warningSignPassages, audit, scanOpts)) findings.push(fromWarningSign(ctx, h));
  }
  if (input.vendorMap?.length) {
    for (const d of detectDualAdministrator(input.vendorMap)) findings.push(fromDualAdministrator(ctx, d));
  }
  // As-written comparability (sensitivity controls scope tolerance)
  for (const cmp of input.asWrittenComparisons ?? []) {
    const opts = { scopePointTolerance: sensitivity.scopePointTolerance, scopeRatio: sensitivity.scopeRatio, ...cmp.opts };
    for (const a of compareAsWritten(cmp.nqtlId, cmp.classification, cmp.ms, cmp.mhsud, opts)) findings.push(fromAsWritten(ctx, a));
  }
  // Factor symmetry
  for (const p of input.factorProfiles ?? []) {
    for (const a of crossCheckFactorSymmetry(p.ms, p.mhsud)) findings.push(fromFactorAsymmetry(ctx, p.nqtlId, p.classification, a));
  }
  // Schedule-of-Benefits cost-share level comparison (facial)
  if (input.costSharePassages?.length) {
    const rows = extractCostShares(input.costSharePassages);
    for (const c of compareCostShareLevels(rows)) findings.push(fromCostShareLevel(ctx, c));
  }

  // Case law (litigation track) — only active rules fire
  if (input.planFacts) {
    for (const h of caselaw.evaluate(input.planFacts, { venueState: input.jurisdiction, audit })) findings.push(fromCaselaw(ctx, h));
  }

  // In-operation (sensitivity controls near-significant reporting)
  if (input.rateComparisons?.length) {
    const opts = { reportNearSignificant: sensitivity.reportNearSignificant, nearSignificantAlpha: sensitivity.nearSignificantAlpha };
    for (const r of runComparisonFamily(input.rateComparisons, audit, opts)) {
      const f = fromInOperation(ctx, r);
      if (f) findings.push(f);
    }
  }

  // Risk scoring + ranking: assign a risk score to every finding and order the
  // canonical finding list highest-risk first so the top of the report is where
  // to focus. High sensitivity surfaces more; risk ranking keeps it usable.
  const ranked = assignAndRankRisk(findings);
  findings.length = 0;
  findings.push(...ranked);

  // Availability matrix
  const availability = buildAvailabilityMatrix(input.ingestedDatasets ?? []);

  const createdAt = clock.now();
  const methodology: MethodologyConfig = {
    scope: input.scope,
    qtlEpsilon: 0.02,
    projectionMethod: input.projectionMethod ?? 'prior-year paid claims, trended',
    samplePeriod: input.samplePeriod ?? null,
    statisticalConfidence: 0.95,
    multipleComparisonsCorrection: 'Benjamini-Hochberg',
  };
  const cover = registry.coverSummary();

  const comparativeReport = buildComparativeAnalysisReport({
    analysisId: input.analysisId,
    scope: input.scope,
    planYear: input.planYear,
    samplePeriod: input.samplePeriod ?? null,
    jurisdiction: input.jurisdiction,
    rulesetsActive: cover.active,
    rulesetsAdvisory: cover.advisory,
    dataSources: input.dataSources ?? [],
    sixStep,
    findings,
    qtlDeterminations,
    availability,
    methodology,
    createdAt,
  });
  audit.append('report.generated', 'engine', { reportId: comparativeReport.id, type: 'comparative_analysis', findings: findings.length });

  const selfComplianceReport = buildSelfComplianceToolReport({
    analysisId: input.analysisId,
    scope: input.scope,
    planYear: input.planYear,
    samplePeriod: input.samplePeriod ?? null,
    jurisdiction: input.jurisdiction,
    rulesetsActive: cover.active,
    rulesetsAdvisory: cover.advisory,
    dataSources: input.dataSources ?? [],
    findings,
    reimbursementTable: input.reimbursementTable ?? [],
    methodology,
    createdAt,
  });
  audit.append('report.generated', 'engine', { reportId: selfComplianceReport.id, type: 'self_compliance_tool' });

  return { audit, registry, caselaw, findings, qtlDeterminations, comparativeReport, selfComplianceReport };
}
