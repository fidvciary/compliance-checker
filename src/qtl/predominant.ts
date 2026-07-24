import type { FrQtlType, MsBenefit, PredominantResult, LevelTally } from './types.js';

const FLOAT_DUST = 1e-9;

/**
 * Predominant test (§ 2590.712(c)(3)(i)(B)).
 *
 * Among M/S benefits SUBJECT TO the FR/QTL type (by plan-payment dollars):
 *   - If a single level applies to MORE THAN one-half → that is the predominant
 *     level and the maximum that may be applied to MH/SUD.
 *   - Otherwise (no single level over one-half), combine levels starting from the
 *     MOST restrictive and accumulate toward less restrictive until the
 *     combination exceeds one-half; the LEAST restrictive level within that
 *     minimal combination is the predominant level. Accumulating most-restrictive
 *     first yields the highest defensible predominant level, matching the
 *     regulation's "least restrictive level within the combination" for the
 *     smallest combination that crosses one-half.
 *
 * Decisions use exact comparisons (dollars·2 > total) so the one-half boundary is
 * decided without float error. "More restrictive" is direction-aware per the
 * FR/QTL type (higher copay/coinsurance vs. fewer days/visits).
 */
export function predominantTest(
  msBenefits: MsBenefit[],
  frQtlType: FrQtlType,
  epsilon: number,
): PredominantResult {
  const subject = msBenefits.filter((b) => b.subjectToType && b.level != null);
  const subjectTotalDollars = round2(subject.reduce((s, b) => s + b.planPayments, 0));

  // Tally dollars per level.
  const byLevel = new Map<number, LevelTally>();
  for (const b of subject) {
    const lvl = b.level as number;
    const existing = byLevel.get(lvl);
    const dollars = (existing?.dollars ?? 0) + b.planPayments;
    byLevel.set(lvl, {
      level: lvl,
      label: b.levelLabel ?? formatLevel(lvl, frQtlType),
      dollars: round2(dollars),
      share: subjectTotalDollars === 0 ? 0 : round4(dollars / subjectTotalDollars),
    });
  }
  const perLevel = [...byLevel.values()].sort((a, b) => a.level - b.level);

  if (subjectTotalDollars <= 0) {
    return {
      applicable: true,
      subjectTotalDollars,
      perLevel,
      singleLevelMajority: null,
      combination: null,
      predominantLevel: null,
      predominantLabel: 'n/a (no M/S benefits subject to this type)',
      thresholdProximate: false,
    };
  }

  // 1) Single level over one-half? (dollars·2 > total)
  let singleLevelMajority: LevelTally | null = null;
  for (const t of perLevel) {
    if (2 * t.dollars > subjectTotalDollars + FLOAT_DUST) {
      singleLevelMajority = t;
      break;
    }
  }

  // Proximity: any single level's share within epsilon of 1/2 → fragile.
  let thresholdProximate = perLevel.some((t) => Math.abs(t.share - 0.5) <= epsilon);

  if (singleLevelMajority) {
    return {
      applicable: true,
      subjectTotalDollars,
      perLevel,
      singleLevelMajority,
      combination: null,
      predominantLevel: singleLevelMajority.level,
      predominantLabel: singleLevelMajority.label,
      thresholdProximate,
    };
  }

  // 2) Multi-level combination: accumulate from most restrictive down.
  const mostRestrictiveFirst = [...perLevel].sort((a, b) =>
    frQtlType.restrictiveness === 'higher_is_more_restrictive' ? b.level - a.level : a.level - b.level,
  );

  const included: LevelTally[] = [];
  let cumulative = 0;
  let leastRestrictive: LevelTally | null = null;
  for (const t of mostRestrictiveFirst) {
    included.push(t);
    cumulative = round2(cumulative + t.dollars);
    // least restrictive so far = the last one added (we go most→least restrictive)
    leastRestrictive = t;
    if (2 * cumulative > subjectTotalDollars + FLOAT_DUST) break;
  }
  const cumulativeShare = round4(cumulative / subjectTotalDollars);
  // Proximity at the crossing step: cumulative share within epsilon of 1/2.
  if (Math.abs(cumulativeShare - 0.5) <= epsilon) thresholdProximate = true;

  return {
    applicable: true,
    subjectTotalDollars,
    perLevel,
    singleLevelMajority: null,
    combination: {
      levelsIncluded: included,
      cumulativeShare,
      leastRestrictiveLevel: leastRestrictive!.level,
      leastRestrictiveLabel: leastRestrictive!.label,
    },
    predominantLevel: leastRestrictive!.level,
    predominantLabel: leastRestrictive!.label,
    thresholdProximate,
  };
}

function formatLevel(level: number, type: FrQtlType): string {
  if (type.id.includes('coinsurance')) return `${level}% coinsurance`;
  if (type.id.includes('copay')) return `$${level} copay`;
  if (type.id.includes('deductible')) return `$${level} deductible`;
  if (type.kind === 'quantitative_treatment_limitation') return `${level} ${type.label}`;
  return `${level}`;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
function round4(n: number): number {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}
