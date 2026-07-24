import type { Classification } from '../classification/classifications.js';

/**
 * Module 7b — As-written comparability tests.
 *
 * Deterministic side-by-side comparison of structured plan extractions for one
 * NQTL × classification, emitting findings on the seven asymmetry types. Each
 * finding is an INDICATOR requiring comparative review, not a conclusion.
 * "More stringent for MH/SUD" is surfaced because that is the direction that
 * matters under the NQTL general standard (29 CFR § 2590.712(c)(4)).
 */

export interface AsWrittenNqtlProfile {
  side: 'MS' | 'MHSUD';
  /** Percent (0-100) of codes/services subject to the NQTL. */
  scopePercent?: number;
  criteriaSource?: 'proprietary' | 'nationally_recognized' | 'state_mandated';
  criteriaStandards?: string[]; // MCG, InterQual, ASAM, LOCUS, ...
  reviewerCredential?: string; // 'RN', 'peer physician same specialty', ...
  reviewerTiming?: string; // 'pre-service', 'concurrent', ...
  triggerThreshold?: { type: 'dollar' | 'day' | 'visit'; value: number } | null;
  /** Concurrent/continued-stay review interval in days (fewer = more frequent = more stringent). */
  reviewCadenceDays?: number | null;
  exclusions?: string[]; // treatment-specific exclusions
  reimbursementMethodology?: string; // 'percent_of_medicare:120', 'ucr:fairhealth_80th', ...
  /** Percent of Medicare, when reimbursement is Medicare-benchmarked. */
  percentOfMedicare?: number | null;
}

export type AsymmetryType =
  | 'scope'
  | 'criteria_source'
  | 'reviewer_qualification'
  | 'trigger_threshold'
  | 'review_cadence'
  | 'exclusion'
  | 'reimbursement_methodology';

export interface AsWrittenFinding {
  nqtlId: string;
  classification: Classification;
  asymmetryType: AsymmetryType;
  detail: string;
  msValue: string;
  mhsudValue: string;
  direction: 'more_stringent_for_mhsud' | 'more_stringent_for_ms' | 'differs';
  suggestedSeverity: 'significant_indicator' | 'potential_indicator';
  authorityRefs: string[];
}

export interface CompareOptions {
  /** Scope asymmetry flags when |diff| exceeds this many points OR ratio >= scopeRatio. */
  scopePointTolerance?: number; // default 10
  scopeRatio?: number; // default 1.5
  /** SUD level-of-care where ASAM is expected; a MH/SUD side lacking ASAM is flagged. */
  sudRequiresAsam?: boolean;
  authorityRefs?: string[];
}

const DEFAULTS = { scopePointTolerance: 10, scopeRatio: 1.5 };

export function compareAsWritten(
  nqtlId: string,
  classification: Classification,
  ms: AsWrittenNqtlProfile,
  mhsud: AsWrittenNqtlProfile,
  opts: CompareOptions = {},
): AsWrittenFinding[] {
  const findings: AsWrittenFinding[] = [];
  const refs = opts.authorityRefs ?? ['federal:statute', 'federal:2013'];
  const push = (f: Omit<AsWrittenFinding, 'nqtlId' | 'classification' | 'authorityRefs'>) =>
    findings.push({ nqtlId, classification, authorityRefs: refs, ...f });

  // 1) Scope asymmetry
  if (ms.scopePercent != null && mhsud.scopePercent != null) {
    const diff = mhsud.scopePercent - ms.scopePercent;
    const ratio = ms.scopePercent === 0 ? (mhsud.scopePercent > 0 ? Infinity : 1) : mhsud.scopePercent / ms.scopePercent;
    const tol = opts.scopePointTolerance ?? DEFAULTS.scopePointTolerance;
    const ratioThresh = opts.scopeRatio ?? DEFAULTS.scopeRatio;
    if (Math.abs(diff) > tol || ratio >= ratioThresh || ratio <= 1 / ratioThresh) {
      const moreForMhsud = mhsud.scopePercent > ms.scopePercent;
      push({
        asymmetryType: 'scope',
        detail: `The NQTL is applied to ${mhsud.scopePercent}% of MH/SUD codes/services vs ${ms.scopePercent}% of M/S codes/services (${Number.isFinite(ratio) ? ratio.toFixed(2) : '∞'}× ). A materially broader application to one side warrants comparative review of the factors and evidentiary standards used.`,
        msValue: `${ms.scopePercent}%`,
        mhsudValue: `${mhsud.scopePercent}%`,
        direction: moreForMhsud ? 'more_stringent_for_mhsud' : 'more_stringent_for_ms',
        suggestedSeverity: Math.abs(diff) > 25 || ratio >= 3 || ratio <= 1 / 3 ? 'significant_indicator' : 'potential_indicator',
      });
    }
  }

  // 2) Criteria source asymmetry
  if (ms.criteriaSource && mhsud.criteriaSource && ms.criteriaSource !== mhsud.criteriaSource) {
    const moreForMhsud = mhsud.criteriaSource === 'proprietary' && ms.criteriaSource !== 'proprietary';
    push({
      asymmetryType: 'criteria_source',
      detail: `Medical-necessity criteria source differs: M/S uses ${ms.criteriaSource.replace('_', ' ')} (${(ms.criteriaStandards ?? []).join(', ') || 'unspecified'}); MH/SUD uses ${mhsud.criteriaSource.replace('_', ' ')} (${(mhsud.criteriaStandards ?? []).join(', ') || 'unspecified'}). Proprietary MH/SUD criteria against nationally recognized M/S criteria is a recurring exam and litigation finding.`,
      msValue: `${ms.criteriaSource}:${(ms.criteriaStandards ?? []).join('/')}`,
      mhsudValue: `${mhsud.criteriaSource}:${(mhsud.criteriaStandards ?? []).join('/')}`,
      direction: moreForMhsud ? 'more_stringent_for_mhsud' : 'differs',
      suggestedSeverity: 'significant_indicator',
    });
  }
  if (opts.sudRequiresAsam && mhsud.side === 'MHSUD' && !(mhsud.criteriaStandards ?? []).map((s) => s.toUpperCase()).includes('ASAM')) {
    push({
      asymmetryType: 'criteria_source',
      detail: 'SUD level-of-care determinations do not use ASAM criteria where ASAM is the generally accepted / state-required standard. Failure to use ASAM for SUD LOC is a recognized parity theory.',
      msValue: 'n/a',
      mhsudValue: (mhsud.criteriaStandards ?? []).join(', ') || 'no ASAM',
      direction: 'more_stringent_for_mhsud',
      suggestedSeverity: 'significant_indicator',
    });
  }

  // 3) Reviewer qualification asymmetry
  if ((ms.reviewerCredential || mhsud.reviewerCredential) && ms.reviewerCredential !== mhsud.reviewerCredential) {
    push({
      asymmetryType: 'reviewer_qualification',
      detail: `Reviewer credential differs: M/S = "${ms.reviewerCredential ?? 'unspecified'}"; MH/SUD = "${mhsud.reviewerCredential ?? 'unspecified'}". Who makes the determination, and with what credentials, is a comparability factor.`,
      msValue: ms.reviewerCredential ?? 'unspecified',
      mhsudValue: mhsud.reviewerCredential ?? 'unspecified',
      direction: 'differs',
      suggestedSeverity: 'potential_indicator',
    });
  }
  if ((ms.reviewerTiming || mhsud.reviewerTiming) && ms.reviewerTiming !== mhsud.reviewerTiming) {
    push({
      asymmetryType: 'reviewer_qualification',
      detail: `Review timing differs: M/S = "${ms.reviewerTiming ?? 'unspecified'}"; MH/SUD = "${mhsud.reviewerTiming ?? 'unspecified'}".`,
      msValue: ms.reviewerTiming ?? 'unspecified',
      mhsudValue: mhsud.reviewerTiming ?? 'unspecified',
      direction: 'differs',
      suggestedSeverity: 'potential_indicator',
    });
  }

  // 4) Trigger threshold asymmetry
  if (ms.triggerThreshold && mhsud.triggerThreshold) {
    if (ms.triggerThreshold.type !== mhsud.triggerThreshold.type || ms.triggerThreshold.value !== mhsud.triggerThreshold.value) {
      // For the same type, a LOWER MH/SUD threshold triggers review sooner = more stringent.
      const sameType = ms.triggerThreshold.type === mhsud.triggerThreshold.type;
      const moreForMhsud = sameType && mhsud.triggerThreshold.value < ms.triggerThreshold.value;
      push({
        asymmetryType: 'trigger_threshold',
        detail: `Review trigger differs: M/S = ${ms.triggerThreshold.value} (${ms.triggerThreshold.type}); MH/SUD = ${mhsud.triggerThreshold.value} (${mhsud.triggerThreshold.type}). A lower MH/SUD threshold triggers review sooner.`,
        msValue: `${ms.triggerThreshold.value} ${ms.triggerThreshold.type}`,
        mhsudValue: `${mhsud.triggerThreshold.value} ${mhsud.triggerThreshold.type}`,
        direction: moreForMhsud ? 'more_stringent_for_mhsud' : 'differs',
        suggestedSeverity: 'significant_indicator',
      });
    }
  }

  // 5) Review cadence asymmetry
  if (ms.reviewCadenceDays != null && mhsud.reviewCadenceDays != null && ms.reviewCadenceDays !== mhsud.reviewCadenceDays) {
    const moreForMhsud = mhsud.reviewCadenceDays < ms.reviewCadenceDays; // shorter interval = more frequent
    push({
      asymmetryType: 'review_cadence',
      detail: `Concurrent review cadence differs: M/S every ${ms.reviewCadenceDays} days; MH/SUD every ${mhsud.reviewCadenceDays} days. ${moreForMhsud ? 'More frequent review for MH/SUD is more stringent.' : ''}`,
      msValue: `every ${ms.reviewCadenceDays}d`,
      mhsudValue: `every ${mhsud.reviewCadenceDays}d`,
      direction: moreForMhsud ? 'more_stringent_for_mhsud' : 'more_stringent_for_ms',
      suggestedSeverity: moreForMhsud ? 'significant_indicator' : 'potential_indicator',
    });
  }

  // 6) Exclusion asymmetry — MH/SUD exclusions without a structurally comparable M/S exclusion.
  const msExcl = new Set((ms.exclusions ?? []).map((e) => e.toLowerCase()));
  for (const ex of mhsud.exclusions ?? []) {
    if (!msExcl.has(ex.toLowerCase())) {
      push({
        asymmetryType: 'exclusion',
        detail: `MH/SUD-side exclusion "${ex}" has no structurally comparable M/S exclusion. Treatment-specific MH/SUD exclusions without an M/S analog warrant review.`,
        msValue: 'no comparable exclusion',
        mhsudValue: ex,
        direction: 'more_stringent_for_mhsud',
        suggestedSeverity: 'significant_indicator',
      });
    }
  }

  // 7) Reimbursement methodology asymmetry
  if (ms.reimbursementMethodology && mhsud.reimbursementMethodology && ms.reimbursementMethodology !== mhsud.reimbursementMethodology) {
    push({
      asymmetryType: 'reimbursement_methodology',
      detail: `Reimbursement methodology differs: M/S = "${ms.reimbursementMethodology}"; MH/SUD = "${mhsud.reimbursementMethodology}". Different rate-setting or UCR methodology by benefit type is a network-composition NQTL concern.`,
      msValue: ms.reimbursementMethodology,
      mhsudValue: mhsud.reimbursementMethodology,
      direction: 'differs',
      suggestedSeverity: 'significant_indicator',
    });
  }
  if (ms.percentOfMedicare != null && mhsud.percentOfMedicare != null && ms.percentOfMedicare !== mhsud.percentOfMedicare) {
    const moreForMhsud = mhsud.percentOfMedicare < ms.percentOfMedicare; // lower % = worse for MH/SUD access
    push({
      asymmetryType: 'reimbursement_methodology',
      detail: `Stated percent-of-Medicare differs: M/S at ${ms.percentOfMedicare}% vs MH/SUD at ${mhsud.percentOfMedicare}% of Medicare. A lower MH/SUD rate is a network-adequacy / reimbursement concern.`,
      msValue: `${ms.percentOfMedicare}% of Medicare`,
      mhsudValue: `${mhsud.percentOfMedicare}% of Medicare`,
      direction: moreForMhsud ? 'more_stringent_for_mhsud' : 'more_stringent_for_ms',
      suggestedSeverity: 'significant_indicator',
    });
  }

  return findings;
}
