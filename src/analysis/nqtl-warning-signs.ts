/**
 * Module 7a — Warning-sign rule table (DETERMINISTIC).
 *
 * Categories I–V from the DOL "Warning Signs That Your NQTLs May Not Be
 * Compliant" document. The LLM is used ONLY to locate and extract candidate
 * passages; the classification of a passage into a category is a RULE MATCH here,
 * and the report quotes the plan language verbatim with a document/page/section
 * anchor. An LLM never decides whether a rule fired.
 *
 * A warning sign indicates a provision "may warrant further review" — it is not,
 * by itself, a determination of noncompliance.
 *
 * Rule modes:
 *   - 'mhsud_scoped': fires when a pattern matches AND the passage is scoped to
 *     MH/SUD AND does NOT also indicate parallel M/S application. This is what
 *     makes the scanner robust to compliant look-alikes (e.g., prior auth applied
 *     to BOTH medical and behavioral admissions must NOT flag).
 *   - 'intrinsic': the pattern is inherently MH/SUD-specific (e.g., wilderness
 *     therapy, ASAM, residential day limit) and fires on the pattern alone.
 */

export type WarningSignCategory = 'I' | 'II' | 'III' | 'IV' | 'V';

export interface WarningSignRule {
  id: string;
  category: WarningSignCategory;
  name: string;
  mode: 'mhsud_scoped' | 'intrinsic';
  patterns: RegExp[];
  citation: string;
  rationale: string;
}

// Shared vocabulary for scoping detection.
export const MHSUD_TERMS =
  /(mental health|substance use|substance abuse|behavioral health|psychiatric|psychological|chemical dependency|addiction|\bSUD\b|\bMH\/?SUD\b|\bMH\b)/i;

// Signals that a provision applies to medical/surgical too (parallel application).
export const APPLIES_TO_BOTH =
  /(medical\s*(and|\/|,|&)\s*(surgical|behavioral|mental)|both medical|all (inpatient )?(admissions|services|claims)|regardless of (diagnosis|condition)|medical\/surgical and (mental|behavioral)|all conditions|any (admission|service))/i;

export const WARNING_SIGN_RULES: WarningSignRule[] = [
  // ---------------- Category I — Preauthorization / pre-service ----------------
  {
    id: 'I.blanket_preauth_mhsud',
    category: 'I',
    name: 'Blanket preauthorization applied only to MH/SUD',
    mode: 'mhsud_scoped',
    patterns: [/(prior authorization|pre-?authorization|precertification|pre-?certification|pre-?service (review|notification))/i],
    citation: 'DOL Warning Signs, Category I',
    rationale: 'Preauthorization scoped to MH/SUD without a comparable M/S requirement warrants further review.',
  },
  {
    id: 'I.facility_admission_preauth_mhsud',
    category: 'I',
    name: 'Facility-admission preauthorization required only for MH/SUD',
    mode: 'mhsud_scoped',
    patterns: [/(admission|inpatient|facility|residential).{0,40}(prior authorization|precertification|pre-?authorization)/i, /(prior authorization|precertification).{0,40}(admission|inpatient|facility|residential)/i],
    citation: 'DOL Warning Signs, Category I',
    rationale: 'Admission preauthorization scoped to MH/SUD facilities without a comparable M/S requirement warrants review.',
  },
  {
    id: 'I.frequent_concurrent_review_mhsud',
    category: 'I',
    name: 'More frequent concurrent review for MH/SUD inpatient',
    mode: 'mhsud_scoped',
    patterns: [/(concurrent review|continued[- ]stay review|continued stay).{0,60}(every|each|daily|per day|\b\d+\s*(day|days)\b)/i, /(reviewed|review).{0,30}(every|each)\s*\d+\s*(day|days)/i],
    citation: 'DOL Warning Signs, Category I',
    rationale: 'Concurrent review at a shorter interval for MH/SUD than for M/S warrants review.',
  },
  {
    id: 'I.delegated_different_criteria_mhsud',
    category: 'I',
    name: 'Medical-necessity review delegated to a different authority / different criteria for MH/SUD',
    mode: 'mhsud_scoped',
    patterns: [/(managed by|administered by|delegated to|reviewed by|vendor).{0,40}(behavioral|mental health|substance)/i, /(behavioral health (vendor|organization|manager)|\bMBHO\b|carve[- ]out)/i],
    citation: 'DOL Warning Signs, Category I',
    rationale: 'Delegating MH/SUD UM to a different authority using different criteria is a named warning sign.',
  },

  // ---------------- Category II — Fail-first / step therapy ----------------
  {
    id: 'II.document_progress_prior_treatment',
    category: 'II',
    name: 'Requirement to document progress in prior treatment',
    mode: 'mhsud_scoped',
    patterns: [/(document|demonstrate|show).{0,30}(progress|improvement).{0,40}(prior|previous|earlier) (treatment|therapy|episode)/i, /failed (prior|previous|conservative) (treatment|therapy)/i],
    citation: 'DOL Warning Signs, Category II',
    rationale: 'Requiring documentation of progress in prior treatment for MH/SUD without an M/S analog warrants review.',
  },
  {
    id: 'II.exhaust_prior_levels_of_care',
    category: 'II',
    name: 'Requirement that prior levels of care be exhausted (fail-first)',
    mode: 'mhsud_scoped',
    patterns: [/(fail(ed)?[- ]first|step therapy|step-care)/i, /(exhaust|try and fail|attempt).{0,40}(lower|less intensive|prior) level of care/i],
    citation: 'DOL Warning Signs, Category II',
    rationale: 'Fail-first / exhaust-lower-level-of-care requirements scoped to MH/SUD warrant review.',
  },
  {
    id: 'II.php_before_inpatient',
    category: 'II',
    name: 'Requirement that PHP be attempted before inpatient MH/SUD',
    mode: 'intrinsic',
    patterns: [/(partial hospitalization|\bPHP\b|intensive outpatient|\bIOP\b).{0,40}(before|prior to|attempted).{0,20}(inpatient|residential|admission)/i, /(must (try|attempt)|required to (try|attempt)).{0,30}(partial hospitalization|outpatient|\bIOP\b|\bPHP\b)/i],
    citation: 'DOL Warning Signs, Category II',
    rationale: 'Requiring a lower level of care be attempted before inpatient MH/SUD warrants review.',
  },

  // ---------------- Category III — Probability of improvement ----------------
  {
    id: 'III.likelihood_of_improvement_exclusion',
    category: 'III',
    name: 'Likelihood-of-improvement exclusion',
    mode: 'mhsud_scoped',
    patterns: [/(likely to|likelihood of|reasonable (expectation|probability) of|expected to) (improve|improvement|benefit)/i, /(not|no) (expected|reasonable|likely).{0,20}improvement/i],
    citation: 'DOL Warning Signs, Category III',
    rationale: 'Conditioning MH/SUD coverage on likelihood of improvement is a named warning sign.',
  },
  {
    id: 'III.measurable_improvement_n_days',
    category: 'III',
    name: 'Measurable-improvement-within-N-days requirement (MH/SUD only)',
    mode: 'mhsud_scoped',
    patterns: [/(measurable|demonstrable|significant) improvement.{0,30}(within|in)\s*\d+\s*(day|days|week|weeks)/i, /improvement.{0,20}(within|in)\s*\d+\s*(day|days).{0,40}(or|otherwise).{0,20}(discontinue|terminate|deny)/i],
    citation: 'DOL Warning Signs, Category III',
    rationale: 'A measurable-improvement-within-N-days condition applied only to MH/SUD warrants review.',
  },

  // ---------------- Category IV — Written treatment plan ----------------
  {
    id: 'IV.written_plan_mhsud_only',
    category: 'IV',
    name: 'Written treatment plan required only for MH/SUD',
    mode: 'mhsud_scoped',
    patterns: [/written (treatment|care) plan/i, /(submit|provide).{0,20}treatment plan/i],
    citation: 'DOL Warning Signs, Category IV',
    rationale: 'A written-treatment-plan requirement scoped to MH/SUD without an M/S analog warrants review.',
  },
  {
    id: 'IV.periodic_resubmission',
    category: 'IV',
    name: 'Periodic treatment-plan resubmission without an M/S analog',
    mode: 'mhsud_scoped',
    patterns: [/(resubmit|update|renew).{0,30}(treatment plan).{0,30}(every|each)\s*\d+\s*(day|days|week|weeks)/i, /treatment plan.{0,20}(every|each)\s*\d+\s*(day|days)/i],
    citation: 'DOL Warning Signs, Category IV',
    rationale: 'Periodic treatment-plan resubmission scoped to MH/SUD warrants review.',
  },

  // ---------------- Category V — Other structural ----------------
  {
    id: 'V.patient_noncompliance_exclusion',
    category: 'V',
    name: 'Patient non-compliance exclusion',
    mode: 'mhsud_scoped',
    patterns: [/(non[- ]?complian(ce|t)|failure to (comply|follow|adhere)|patient.{0,15}(refus|declin))/i],
    citation: 'DOL Warning Signs, Category V',
    rationale: 'Excluding coverage on patient non-compliance grounds for MH/SUD warrants review.',
  },
  {
    id: 'V.residential_day_limit',
    category: 'V',
    name: 'Residential day limit with no M/S analog',
    mode: 'intrinsic',
    patterns: [/(residential|\bRTC\b).{0,40}(limited to|maximum of|up to|no more than|\bcap(ped)?\b).{0,10}\d+\s*(day|days)/i, /\d+\s*(day|days).{0,20}(residential|\bRTC\b) (limit|maximum)/i],
    citation: 'DOL Warning Signs, Category V',
    rationale: 'A residential-treatment day limit with no comparable M/S sub-acute restriction warrants review.',
  },
  {
    id: 'V.geographic_restriction',
    category: 'V',
    name: 'Geographic limitation',
    mode: 'mhsud_scoped',
    patterns: [/(in-?state|within the state|in-?region|geographic).{0,30}(facility|facilities|provider|treatment)/i, /(only|must be).{0,20}(in-?state|within \w+ miles)/i],
    citation: 'DOL Warning Signs, Category V',
    rationale: 'Restricting MH/SUD care to in-state/in-region facilities without an M/S analog warrants review.',
  },
  {
    id: 'V.licensure_restriction',
    category: 'V',
    name: 'Provider licensure restriction more restrictive than for M/S',
    mode: 'intrinsic',
    patterns: [/(exclud|not cover|not eligible|will not (reimburse|pay)).{0,40}(\bLMFT\b|\bLPC\b|\bLCSW\b|\bLPCC\b|marriage and family|professional counselor|clinical social worker)/i, /(\bMD\b|physician|psychiatrist) supervision (required|only)/i, /(\bLMFT\b|\bLPC\b|\bLCSW\b).{0,30}(not (covered|reimbursed|eligible)|excluded)/i],
    citation: 'DOL Warning Signs, Category V',
    rationale: 'Excluding LMFT/LPC/LCSW or requiring MD supervision only for MH/SUD providers warrants review.',
  },
  {
    id: 'V.wilderness_exclusion',
    category: 'V',
    name: 'Wilderness / outdoor behavioral health exclusion',
    mode: 'intrinsic',
    patterns: [/(wilderness|outdoor (behavioral|therapy|program)|adventure therapy|boot ?camp|therapeutic (boarding|wilderness))/i],
    citation: 'DOL Warning Signs, Category V',
    rationale: 'A blanket wilderness/outdoor behavioral health exclusion warrants review of comparable M/S sub-acute settings.',
  },
];

export function rulesByCategory(category: WarningSignCategory): WarningSignRule[] {
  return WARNING_SIGN_RULES.filter((r) => r.category === category);
}
