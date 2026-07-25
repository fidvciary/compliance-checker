import {
  twoProportionZTest,
  fisherExactTwoSided,
  benjaminiHochberg,
  cohensH,
  chooseTest,
} from './statistics.js';
import type { Classification } from '../classification/classifications.js';
import type { AuditLog } from '../audit/audit-log.js';

/**
 * Module 8 — in-operation metrics comparison.
 *
 * Every in-operation finding is emitted as: metric, values, disparity,
 * statistical result, and a generated INVESTIGATION QUESTION pointing at the
 * process that would explain or fail to explain the disparity — NEVER as a
 * conclusion (Non-negotiable #4; DOL Self-Compliance Tool Appendix II). Any code
 * path that emits "violation" from a data disparity alone would be a bug.
 */

export const MINIMUM_CELL_SIZE = 30;
export const ALPHA = 0.05;

export type MetricDirection = 'mhsud_higher_is_adverse' | 'mhsud_lower_is_adverse';

export interface MetricDefinition {
  id: string;
  label: string;
  /** Which direction of disparity is adverse to MH/SUD access. */
  direction: MetricDirection;
  unit: 'rate';
}

export const METRIC_DEFINITIONS: MetricDefinition[] = [
  { id: 'denial_rate', label: 'Claims denial rate', direction: 'mhsud_higher_is_adverse', unit: 'rate' },
  { id: 'pa_denial_rate', label: 'Prior authorization denial rate', direction: 'mhsud_higher_is_adverse', unit: 'rate' },
  { id: 'pa_approval_rate', label: 'Prior authorization approval rate', direction: 'mhsud_lower_is_adverse', unit: 'rate' },
  { id: 'appeal_overturn_rate', label: 'Appeal overturn rate', direction: 'mhsud_higher_is_adverse', unit: 'rate' },
  { id: 'oon_utilization_rate', label: 'Out-of-network utilization rate', direction: 'mhsud_higher_is_adverse', unit: 'rate' },
];

export interface RateComparisonInput {
  metricId: string;
  classification: Classification;
  subclassKey?: string;
  /** Group 1 = MH/SUD. */
  mhsud: { events: number; n: number };
  /** Group 2 = M/S. */
  ms: { events: number; n: number };
}

export type ComparisonStatus = 'tested' | 'insufficient_data';

export interface RateComparisonResult {
  metricId: string;
  label: string;
  classification: Classification;
  subclassKey?: string;
  status: ComparisonStatus;
  nMhsud: number;
  nMs: number;
  rateMhsud: number;
  rateMs: number;
  ratio: number;
  diff: number;
  testUsed?: 'two_proportion_z' | 'fisher_exact';
  pValue?: number;
  pAdjusted?: number;
  ciLow?: number;
  ciHigh?: number;
  effectSize?: { h: number; magnitude: string };
  adverseToMhsud?: boolean;
  significant?: boolean;
  /** Aggressive sensitivity: adverse and in the (alpha..nearAlpha] band — low confidence. */
  nearSignificant?: boolean;
  practicallyNegligible?: boolean;
  investigationQuestion: string;
  insufficientReason?: string;
  authorityRefs: string[];
}

function metricDef(id: string): MetricDefinition {
  const d = METRIC_DEFINITIONS.find((m) => m.id === id);
  if (!d) throw new Error(`Unknown metric '${id}'. Register it in METRIC_DEFINITIONS.`);
  return d;
}

function fmtPct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}
function fmtP(p: number): string {
  return p < 0.001 ? 'p<0.001' : `p=${p.toFixed(3)}`;
}

export interface ComparisonOptions {
  /** Aggressive sensitivity: surface adverse near-significant results as low-confidence. */
  reportNearSignificant?: boolean;
  /** Upper p bound for "near-significant" (e.g., 0.10). */
  nearSignificantAlpha?: number;
}

/** Run one comparison, applying the n>=30 gate and choosing the test. p-adjusted is filled by the family runner. */
export function runRateComparison(input: RateComparisonInput, opts: ComparisonOptions = {}): RateComparisonResult {
  const def = metricDef(input.metricId);
  const { mhsud, ms } = input;
  const base = {
    metricId: input.metricId,
    label: def.label,
    classification: input.classification,
    ...(input.subclassKey ? { subclassKey: input.subclassKey } : {}),
    nMhsud: mhsud.n,
    nMs: ms.n,
    rateMhsud: mhsud.n === 0 ? 0 : mhsud.events / mhsud.n,
    rateMs: ms.n === 0 ? 0 : ms.events / ms.n,
    authorityRefs: ['guidance:self-compliance-tool'],
  };

  // n>=30 minimum-cell gate. Below threshold: INSUFFICIENT_DATA, no test.
  if (mhsud.n < MINIMUM_CELL_SIZE || ms.n < MINIMUM_CELL_SIZE) {
    return {
      ...base,
      status: 'insufficient_data',
      ratio: base.rateMs === 0 ? (base.rateMhsud === 0 ? 1 : Infinity) : base.rateMhsud / base.rateMs,
      diff: base.rateMhsud - base.rateMs,
      insufficientReason: `Cell size below minimum (n=${mhsud.n} MH/SUD, n=${ms.n} M/S; require >= ${MINIMUM_CELL_SIZE} on both sides). No test was run. Consider 24-month aggregation for small plans (record the sample period in the methodology / Step 5).`,
      investigationQuestion: `Insufficient data to compare ${def.label.toLowerCase()} for ${input.classification} (n=${mhsud.n}/${ms.n}). Obtain additional periods or aggregate before testing.`,
    };
  }

  const testUsed = chooseTest(mhsud.events, mhsud.n, ms.events, ms.n);
  const z = twoProportionZTest(mhsud.events, mhsud.n, ms.events, ms.n);
  const pValue =
    testUsed === 'fisher_exact'
      ? fisherExactTwoSided(mhsud.events, mhsud.n - mhsud.events, ms.events, ms.n - ms.events)
      : z.pValue;
  const eff = cohensH(z.p1, z.p2);
  const adverse = def.direction === 'mhsud_higher_is_adverse' ? z.p1 > z.p2 : z.p1 < z.p2;

  return {
    ...base,
    status: 'tested',
    ratio: z.ratio,
    diff: z.diff,
    testUsed,
    pValue,
    ciLow: z.ciLow,
    ciHigh: z.ciHigh,
    effectSize: { h: round(eff.h, 3), magnitude: eff.magnitude },
    adverseToMhsud: adverse,
    significant: pValue < ALPHA,
    nearSignificant:
      !!opts.reportNearSignificant && adverse && pValue >= ALPHA && pValue < (opts.nearSignificantAlpha ?? 0.1),
    practicallyNegligible: eff.magnitude === 'negligible' && Math.abs(z.diff) < 0.02,
    investigationQuestion: '', // filled by family runner (needs adjusted p)
  };
}

/**
 * Run a family of comparisons and apply the Benjamini–Hochberg correction across
 * the TESTED members. Fills p-adjusted and the investigation-question framing.
 */
export function runComparisonFamily(inputs: RateComparisonInput[], audit?: AuditLog, opts: ComparisonOptions = {}): RateComparisonResult[] {
  const results = inputs.map((i) => runRateComparison(i, opts));
  const tested = results.filter((r) => r.status === 'tested');
  const adjusted = benjaminiHochberg(tested.map((r) => r.pValue!));
  tested.forEach((r, i) => {
    // Keep full precision: p-values can be extremely small; rounding here would
    // destroy them and could break the mathematical guarantee adjusted >= raw.
    r.pAdjusted = adjusted[i]!;
  });

  for (const r of results) {
    if (r.status === 'tested') r.investigationQuestion = buildInvestigationQuestion(r);
    audit?.append('inoperation.tested', 'engine', {
      metricId: r.metricId,
      classification: r.classification,
      status: r.status,
      testUsed: r.testUsed,
      pValue: r.pValue,
      pAdjusted: r.pAdjusted,
    });
  }
  return results;
}

function buildInvestigationQuestion(r: RateComparisonResult): string {
  const ratioStr = Number.isFinite(r.ratio) ? r.ratio.toFixed(2) : '∞';
  const adjStr = r.pAdjusted !== undefined ? (r.pAdjusted < 0.001 ? 'adjusted p<0.001' : `adjusted p=${r.pAdjusted.toFixed(3)}`) : '';
  const ci = r.ciLow !== undefined && r.ciHigh !== undefined ? `95% CI on difference [${(r.ciLow * 100).toFixed(1)}, ${(r.ciHigh * 100).toFixed(1)}] pts` : '';
  const testName = r.testUsed === 'fisher_exact' ? 'Fisher exact' : 'two-proportion z';

  const head = `MH/SUD ${r.classification.replace(/_/g, ' ')} ${r.label.toLowerCase()} was ${fmtPct(r.rateMhsud)} versus ${fmtPct(r.rateMs)} for M/S (ratio ${ratioStr}, ${fmtP(r.pValue!)}, ${adjStr}, n=${r.nMhsud}/${r.nMs}; ${testName}; ${ci}; effect size h=${r.effectSize!.h} [${r.effectSize!.magnitude}]).`;

  if (!r.significant) {
    if (r.nearSignificant) {
      return `${head} Below the 95% significance threshold but NEAR-significant and adverse to MH/SUD; surfaced under high-sensitivity screening as a LOW-CONFIDENCE item to verify with more data. Not a warning sign on these data alone.`;
    }
    return `${head} The difference is NOT statistically significant at the 95% level after correction; not a warning sign on these data.`;
  }
  if (r.practicallyNegligible) {
    return `${head} Although statistically significant, the practical magnitude is negligible (effect size ${r.effectSize!.magnitude}, absolute difference ${(Math.abs(r.diff) * 100).toFixed(1)} pts); this is unlikely to be a compliance concern and is reported for completeness.`;
  }
  if (!r.adverseToMhsud) {
    return `${head} The disparity direction is not adverse to MH/SUD access on this metric; reported for completeness.`;
  }
  return `${head} Under the DOL Self-Compliance Tool this is a warning sign warranting further review. Determine whether the processes, strategies, evidentiary standards, and other factors producing this differential are comparable and applied no more stringently for MH/SUD than for M/S. This outcome does not, by itself, establish noncompliance.`;
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round((n + Number.EPSILON) * f) / f;
}
