/**
 * @fidvciary/parity-engine — public API surface.
 *
 * The MHPAEA parity compliance analysis engine. See README.md for the module
 * map and the seven hard non-negotiables enforced across these exports.
 */

// Pipeline (end-to-end orchestration)
export { runAnalysis, RULESETS_DIR, CASELAW_DIR } from './pipeline.js';
export type { AnalysisInput, AnalysisResult } from './pipeline.js';
export { buildDemoInput } from './demo.js';

// Audit + reproducibility
export { AuditLog } from './audit/audit-log.js';
export type { AuditEntry, AuditEventType } from './audit/audit-log.js';
export { contentHash, sha256 } from './util/hash.js';
export { canonicalStringify } from './util/canonical-json.js';
export { systemClock, fixedClock } from './util/clock.js';
export type { Clock } from './util/clock.js';

// Rulesets
export { loadRulesetsFromDir, parseRuleset } from './rulesets/loader.js';
export { RulesetRegistry, matchesSelector } from './rulesets/registry.js';
export type { Ruleset, EnforcementStatus, AuthorityType } from './rulesets/types.js';

// Ingestion + PHI gate
export { ingestCsv, ingestTable, PhiRejectedError } from './ingestion/ingest.js';
export { scanTableForPhi, formatPhiRejection } from './ingestion/phi-detector.js';
export type { PhiScanResult, PhiType } from './ingestion/phi-detector.js';
export { mapColumns } from './ingestion/column-mapping.js';
export { TPA_TEMPLATES, knownTpas } from './ingestion/tpa-templates.js';
export { buildAvailabilityMatrix, ANALYSIS_FEATURES } from './ingestion/availability-matrix.js';

// Plan-document reading + as-written screen (upload a PDF/txt -> what may not be compliant)
export { readPlanDocument, planDocumentFromText } from './ingestion/document-reader.js';
export type { PlanDocument } from './ingestion/document-reader.js';
export { chunkDocument } from './ingestion/document-chunker.js';
export {
  scanPlanDocumentText, scanPlanDocumentFile, describeDocumentScan, extractWarningSignPassages,
} from './ingestion/document-scan.js';
export type { DocumentScanResult } from './ingestion/document-scan.js';
export { scanLitigationLanguage, LITIGATION_LANGUAGE_RULES } from './analysis/litigation-language.js';

// Classification
export { classifyClaim, detectIntermediateMisclassification } from './classification/classifier.js';
export { determineBenefitType } from './classification/mhsud-identification.js';
export { ClassificationScheme, LockedClassificationScheme, assertSchemesConsistent } from './classification/consistency-lock.js';
export { CLASSIFICATIONS } from './classification/classifications.js';
export type { Classification } from './classification/classifications.js';

// QTL / FR
export { evaluateQtl } from './qtl/qtl-engine.js';
export { substantiallyAllTest } from './qtl/substantially-all.js';
export { predominantTest } from './qtl/predominant.js';
export { evaluateCumulative, evaluateDollarLimit } from './qtl/cumulative.js';
export type { QtlTestInput, QtlDetermination, FrQtlType, MsBenefit } from './qtl/types.js';

// NQTL + six-step + linter
export { NQTL_LIBRARY, nqtlsForSet } from './nqtl/nqtl-library.js';
export { scaffoldSixStep } from './nqtl/scaffolder.js';
export { SixStepRegistry, sixStepKey } from './nqtl/six-step.js';
export { DOL_FACTORS, EVIDENTIARY_SOURCES, crossCheckFactorSymmetry } from './nqtl/factors.js';
export { lintNarrative } from './nqtl/sufficiency-linter.js';

// As-written + warning signs + case law
export { scanPassages, detectDualAdministrator } from './analysis/warning-sign-scanner.js';
export { WARNING_SIGN_RULES } from './analysis/nqtl-warning-signs.js';
export { compareAsWritten } from './analysis/as-written-comparability.js';
export { loadCaselawFromDir, parseCaselawRule } from './analysis/caselaw/loader.js';
export { CaselawRegistry, venueWeight } from './analysis/caselaw/registry.js';
export { assertActivationInvariant, CaselawActivationError } from './analysis/caselaw/rule-schema.js';
export type { PlanFacts } from './analysis/caselaw/predicates.js';

// In-operation statistics
export {
  twoProportionZTest, fisherExactTwoSided, benjaminiHochberg, cohensH, chooseTest, normalCdf,
} from './in-operation/statistics.js';
export { runRateComparison, runComparisonFamily, MINIMUM_CELL_SIZE, METRIC_DEFINITIONS } from './in-operation/metrics.js';

// Findings + severity
export {
  assertSeverityInvariant, FindingIntegrityError, compareSeverity, SEVERITY_RANK,
} from './findings/finding.js';
export type { Finding, Severity, FindingScope, FindingTrack } from './findings/finding.js';

// Reports + attorney gate
export { renderMarkdown, reportContentHash } from './report/report-model.js';
export type { ReportRecord, ReportStatus, EvaluationScope } from './report/report-model.js';
export { buildComparativeAnalysisReport } from './report/comparative-analysis.js';
export { buildSelfComplianceToolReport } from './report/self-compliance-tool.js';
export { buildMethodologyAppendix } from './report/methodology.js';
export { generateTpaRequestLetter, buildDataUnavailabilityAppendix } from './report/tpa-request-letter.js';
export { AttorneyReviewGate, AttorneyGateError, approvalHash } from './attorney/review-gate.js';

// LLM boundary + prompt-version pinning
export { recordLlmCall, collectPromptVersions } from './llm/prompt-pinning.js';
export type { CandidateExtractor, NarrativeDrafter, LlmCallRecord } from './llm/prompt-pinning.js';
