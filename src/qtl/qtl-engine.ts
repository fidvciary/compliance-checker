import type { QtlTestInput, QtlDetermination, QtlVerdict, PredominantResult } from './types.js';
import { substantiallyAllTest } from './substantially-all.js';
import { predominantTest } from './predominant.js';

const DEFAULT_EPSILON = 0.02;

/**
 * QTL/FR parity determination for one (classification × FR/QTL type).
 *
 * Ties the substantially-all and predominant tests into a compliance verdict and
 * exposes the FULL arithmetic so an examiner can re-derive it by hand.
 *
 *   - substantially-all fails  → the plan may not apply this FR/QTL type to
 *                                MH/SUD at all; if it does → facial_violation.
 *   - substantially-all passes → predominant level is the max applicable to
 *                                MH/SUD; a more-restrictive MH/SUD level →
 *                                facial_violation (deterministic arithmetic).
 *   - within epsilon of a threshold → threshold_proximate, routed to attorney
 *                                review with computation exposed; never
 *                                auto-asserted as a violation or as compliant.
 */
export function evaluateQtl(input: QtlTestInput): QtlDetermination {
  const epsilon = input.epsilon ?? DEFAULT_EPSILON;
  const sa = substantiallyAllTest(input.msBenefits, epsilon);

  let predominant: PredominantResult | null = null;
  if (sa.applies) {
    predominant = predominantTest(input.msBenefits, input.frQtlType, epsilon);
  }

  const mhsud = input.mhsudApplied;
  const mhsudSubject = mhsud?.subjectToType ?? null;
  const mhsudLevel = mhsud?.level ?? null;

  const proximate = sa.thresholdProximate || predominant?.thresholdProximate === true;

  let verdict: QtlVerdict = 'not_evaluated';
  let failureType: QtlDetermination['compliance']['failureType'] = 'none';
  let rationale = '';
  let mayApplyToMhsud = sa.applies;
  const allowedMaxLevel = sa.applies ? predominant?.predominantLevel ?? null : null;
  const allowedMaxLabel = sa.applies
    ? predominant?.predominantLabel ?? 'n/a'
    : 'may not be applied to MH/SUD (substantially-all not met)';

  if (!sa.applies) {
    // Plan may not apply this FR/QTL type to MH/SUD at all.
    mayApplyToMhsud = false;
    if (mhsudSubject === true) {
      verdict = proximate ? 'threshold_proximate' : 'facial_violation';
      failureType = proximate ? 'threshold_proximate' : 'substantially_all_fails_but_applied';
      rationale = sa.noMsBenefits
        ? `There are no M/S benefits (plan payments) in ${input.classification}, so the ${input.frQtlType.label} ` +
          `type cannot satisfy the substantially-all test; applying it to MH/SUD is impermissible. ` +
          `Providing MH/SUD benefits in a classification with no M/S benefits also warrants classification review.`
        : `The ${input.frQtlType.label} applies to only ${(sa.ratio * 100).toFixed(1)}% of M/S benefits in ` +
          `${input.classification} (< 66.67% substantially-all threshold), so it may not be applied to MH/SUD ` +
          `benefits in this classification at all. The plan applies it to MH/SUD.`;
    } else {
      verdict = 'compliant';
      failureType = 'none';
      rationale =
        `The ${input.frQtlType.label} does not meet substantially-all on the M/S side ` +
        `(${(sa.ratio * 100).toFixed(1)}%); it is correctly not applied to MH/SUD.`;
    }
  } else {
    // substantially-all met → predominant is the ceiling.
    const ceiling = predominant!.predominantLevel;
    if (mhsudSubject !== true || mhsudLevel == null) {
      verdict = proximate ? 'threshold_proximate' : 'compliant';
      failureType = proximate ? 'threshold_proximate' : 'none';
      rationale =
        `Substantially-all met (${(sa.ratio * 100).toFixed(1)}%); predominant level is ${predominant!.predominantLabel}. ` +
        `MH/SUD is not subject to this FR/QTL type, which is permissible (no-more-restrictive).`;
    } else if (ceiling == null) {
      verdict = 'threshold_proximate';
      failureType = 'threshold_proximate';
      rationale = 'Predominant level indeterminate; routed to attorney review.';
    } else {
      const moreRestrictive = isMoreRestrictive(mhsudLevel, ceiling, input.frQtlType.restrictiveness);
      if (moreRestrictive) {
        verdict = proximate ? 'threshold_proximate' : 'facial_violation';
        failureType = proximate ? 'threshold_proximate' : 'predominant_exceeded';
        rationale =
          `Substantially-all met (${(sa.ratio * 100).toFixed(1)}%). Predominant level applicable to MH/SUD is ` +
          `${predominant!.predominantLabel}; the plan applies ${formatApplied(mhsudLevel, input.frQtlType)} to MH/SUD, ` +
          `which is MORE restrictive than the predominant level.` +
          (proximate ? ' Result is within epsilon of a threshold — routed to attorney review.' : '');
      } else {
        verdict = proximate ? 'threshold_proximate' : 'compliant';
        failureType = proximate ? 'threshold_proximate' : 'none';
        rationale =
          `Substantially-all met (${(sa.ratio * 100).toFixed(1)}%). Predominant level is ${predominant!.predominantLabel}; ` +
          `the MH/SUD level ${formatApplied(mhsudLevel, input.frQtlType)} is no more restrictive.` +
          (proximate ? ' Within epsilon of a threshold — routed to attorney review.' : '');
      }
    }
  }

  return {
    classification: input.classification,
    frQtlTypeId: input.frQtlType.id,
    frQtlKind: input.frQtlType.kind,
    projectionMethod: input.projectionMethod,
    substantiallyAll: sa,
    predominant,
    compliance: {
      mayApplyToMhsud,
      allowedMaxLevel,
      allowedMaxLabel,
      mhsudSubject,
      mhsudLevel,
      verdict,
      failureType,
      rationale,
    },
    authorityRefs: ['federal:statute', 'federal:2013'],
  };
}

function isMoreRestrictive(a: number, b: number, r: QtlTestInput['frQtlType']['restrictiveness']): boolean {
  return r === 'higher_is_more_restrictive' ? a > b : a < b;
}

function formatApplied(level: number, type: QtlTestInput['frQtlType']): string {
  if (type.id.includes('coinsurance')) return `${level}%`;
  if (type.id.includes('copay') || type.id.includes('deductible')) return `$${level}`;
  return `${level}`;
}
