import type { Classification } from '../classification/classifications.js';

/**
 * Module 5 — QTL / FR parity engine types (29 CFR § 2590.712(c)(3)).
 *
 * Threshold decisions use EXACT integer-ratio comparisons (3·num ≥ 2·den for the
 * 2/3 substantially-all test; level·2 > total for the 1/2 predominant test)
 * rather than float division, so boundary cases (exactly two-thirds) are decided
 * correctly. Display ratios are computed separately for the exposed arithmetic.
 */

export type FrQtlKind = 'financial_requirement' | 'quantitative_treatment_limitation';

/** 'higher_is_more_restrictive' for copay/coinsurance/deductible; 'lower' for day/visit limits. */
export type Restrictiveness = 'higher_is_more_restrictive' | 'lower_is_more_restrictive';

export interface FrQtlType {
  id: string; // 'copay', 'coinsurance', 'inpatient_day_limit', ...
  kind: FrQtlKind;
  label: string;
  restrictiveness: Restrictiveness;
  /** Deductible / out-of-pocket maximum accumulate; these are governed by the cumulative rule. */
  cumulative?: boolean;
}

/** One M/S benefit within a classification, valued by projected plan payments. */
export interface MsBenefit {
  id: string;
  /** Projected dollar amount of plan payments for the plan year (reasonable projection). */
  planPayments: number;
  /** Whether this benefit is subject to the FR/QTL type under test. */
  subjectToType: boolean;
  /** The level applied when subject (e.g., 20 for a $20 copay or 20 for 20% coinsurance). */
  level?: number | null;
  levelLabel?: string;
}

/** What the plan actually applies to MH/SUD for this FR/QTL type in this classification. */
export interface MhsudApplication {
  subjectToType: boolean;
  level?: number | null;
  levelLabel?: string;
}

export interface QtlTestInput {
  classification: Classification;
  frQtlType: FrQtlType;
  msBenefits: MsBenefit[];
  mhsudApplied?: MhsudApplication;
  /** Proximity threshold (fraction) for THRESHOLD_PROXIMATE routing. Default 0.02. */
  epsilon?: number;
  /** Description of the reasonable projection method used for plan-year dollars. */
  projectionMethod: string;
}

export interface SubstantiallyAllResult {
  denominatorDollars: number; // all M/S benefits in the classification
  numeratorDollars: number; // M/S benefits subject to the FR/QTL type
  /** Display ratio numerator/denominator (NaN-safe: 0 when denominator is 0). */
  ratio: number;
  thresholdFraction: number; // 2/3
  /** True iff 3·numerator ≥ 2·denominator (exact). */
  applies: boolean;
  thresholdProximate: boolean;
  /** True when there are no M/S benefits (dollars) in the classification at all. */
  noMsBenefits: boolean;
  benefitInventory: Array<{ id: string; planPayments: number; subjectToType: boolean; level: number | null }>;
}

export interface LevelTally {
  level: number;
  label: string;
  dollars: number;
  share: number; // dollars / subjectTotal
}

export interface PredominantResult {
  applicable: boolean; // false when substantially-all did not apply
  subjectTotalDollars: number;
  perLevel: LevelTally[];
  singleLevelMajority: LevelTally | null;
  combination: {
    levelsIncluded: LevelTally[];
    cumulativeShare: number;
    leastRestrictiveLevel: number;
    leastRestrictiveLabel: string;
  } | null;
  predominantLevel: number | null;
  predominantLabel: string;
  thresholdProximate: boolean;
}

export type QtlVerdict =
  | 'compliant'
  | 'facial_violation'
  | 'threshold_proximate'
  | 'not_evaluated';

export interface QtlDetermination {
  classification: Classification;
  frQtlTypeId: string;
  frQtlKind: FrQtlKind;
  projectionMethod: string;
  substantiallyAll: SubstantiallyAllResult;
  predominant: PredominantResult | null;
  compliance: {
    mayApplyToMhsud: boolean; // false when substantially-all fails
    allowedMaxLevel: number | null; // predominant level, or null when may-not-apply
    allowedMaxLabel: string;
    mhsudSubject: boolean | null;
    mhsudLevel: number | null;
    verdict: QtlVerdict;
    /** Machine tag for the finding synthesis / severity model. */
    failureType:
      | 'none'
      | 'substantially_all_fails_but_applied'
      | 'predominant_exceeded'
      | 'threshold_proximate';
    rationale: string;
  };
  authorityRefs: string[];
}
