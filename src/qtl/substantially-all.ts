import type { MsBenefit, SubstantiallyAllResult } from './types.js';

const TWO_THIRDS = 2 / 3;
const FLOAT_DUST = 1e-9;

/**
 * Substantially-all test (§ 2590.712(c)(3)(i)(A)).
 *
 * A type of FR/QTL applies to substantially all M/S benefits in a classification
 * iff it applies to at least two-thirds of all M/S benefits, measured by the
 * dollar amount of plan payments. Decision uses the exact comparison
 * 3·numerator ≥ 2·denominator so exactly-two-thirds decides as "applies".
 *
 * If substantially-all is NOT met, the plan may not apply that type of FR/QTL to
 * MH/SUD benefits in that classification at all.
 */
export function substantiallyAllTest(msBenefits: MsBenefit[], epsilon: number): SubstantiallyAllResult {
  const denominatorDollars = round2(msBenefits.reduce((s, b) => s + b.planPayments, 0));
  const numeratorDollars = round2(
    msBenefits.filter((b) => b.subjectToType).reduce((s, b) => s + b.planPayments, 0),
  );

  const noMsBenefits = denominatorDollars <= 0;

  // Exact 2/3 decision: 3·num ≥ 2·den (with tiny float dust tolerance).
  const applies = !noMsBenefits && 3 * numeratorDollars + FLOAT_DUST >= 2 * denominatorDollars;

  const ratio = denominatorDollars === 0 ? 0 : numeratorDollars / denominatorDollars;
  const thresholdProximate = !noMsBenefits && Math.abs(ratio - TWO_THIRDS) <= epsilon;

  return {
    denominatorDollars,
    numeratorDollars,
    ratio,
    thresholdFraction: TWO_THIRDS,
    applies,
    thresholdProximate,
    noMsBenefits,
    benefitInventory: msBenefits.map((b) => ({
      id: b.id,
      planPayments: b.planPayments,
      subjectToType: b.subjectToType,
      level: b.level ?? null,
    })),
  };
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
