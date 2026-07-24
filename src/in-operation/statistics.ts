/**
 * Module 8 — statistical primitives for the in-operation engine.
 *
 * Deterministic implementations, validated in tests against known values:
 *   - two-proportion z-test (95%) with unpooled CI on the difference
 *   - Fisher exact test (two-sided) for small counts
 *   - Benjamini–Hochberg multiple-comparisons correction
 *   - Cohen's h effect size
 *
 * The n>=30 minimum-cell gate lives in metrics.ts; below it, no test runs.
 */

/** Error function (Abramowitz & Stegun 7.1.26; |error| < 1.5e-7). */
export function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

/** Standard normal CDF. */
export function normalCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

/** Two-sided p-value for a z statistic. */
export function twoSidedPFromZ(z: number): number {
  return 2 * (1 - normalCdf(Math.abs(z)));
}

export interface TwoProportionResult {
  p1: number; // rate for group 1 (MH/SUD by convention)
  p2: number; // rate for group 2 (M/S)
  diff: number; // p1 - p2
  ratio: number; // p1 / p2 (Infinity if p2 == 0 and p1 > 0)
  z: number;
  pValue: number; // two-sided
  ciLow: number; // 95% CI on the difference (unpooled)
  ciHigh: number;
}

/**
 * Two-proportion z-test. Group 1 is MH/SUD, group 2 is M/S by convention.
 * Uses the pooled SE for the test statistic and the unpooled SE for the CI on
 * the difference (standard practice).
 */
export function twoProportionZTest(x1: number, n1: number, x2: number, n2: number): TwoProportionResult {
  const p1 = x1 / n1;
  const p2 = x2 / n2;
  const pooled = (x1 + x2) / (n1 + n2);
  const sePooled = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
  const z = sePooled === 0 ? 0 : (p1 - p2) / sePooled;
  const seUnpooled = Math.sqrt((p1 * (1 - p1)) / n1 + (p2 * (1 - p2)) / n2);
  const diff = p1 - p2;
  return {
    p1,
    p2,
    diff,
    ratio: p2 === 0 ? (p1 === 0 ? 1 : Infinity) : p1 / p2,
    z,
    pValue: twoSidedPFromZ(z),
    ciLow: diff - 1.96 * seUnpooled,
    ciHigh: diff + 1.96 * seUnpooled,
  };
}

// ---- log-gamma (Lanczos) for exact hypergeometric probabilities ----
const LANCZOS = [
  676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];
export function logGamma(z: number): number {
  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  }
  z -= 1;
  let x = 0.99999999999980993;
  for (let i = 0; i < LANCZOS.length; i++) x += LANCZOS[i]! / (z + i + 1);
  const t = z + LANCZOS.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

function logChoose(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity;
  return logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);
}

/**
 * Fisher exact test (two-sided) for a 2x2 table [[a,b],[c,d]].
 * Sums the hypergeometric probabilities of all tables (same margins) that are
 * no more probable than the observed table.
 */
export function fisherExactTwoSided(a: number, b: number, c: number, d: number): number {
  const r1 = a + b;
  const r2 = c + d;
  const c1 = a + c;
  const n = r1 + r2;
  const logProb = (aa: number): number =>
    logChoose(c1, aa) + logChoose(n - c1, r1 - aa) - logChoose(n, r1);
  const pObs = logProb(a);
  const lo = Math.max(0, r1 - (n - c1));
  const hi = Math.min(r1, c1);
  let total = 0;
  const EPS = 1e-7;
  for (let aa = lo; aa <= hi; aa++) {
    const lp = logProb(aa);
    if (lp <= pObs + EPS) total += Math.exp(lp);
  }
  return Math.min(1, total);
}

/**
 * Benjamini–Hochberg adjusted p-values (FDR). Returns adjusted p-values in the
 * ORIGINAL input order. Monotone (step-up) enforced; capped at 1.
 */
export function benjaminiHochberg(pValues: number[]): number[] {
  const m = pValues.length;
  if (m === 0) return [];
  const idx = pValues.map((p, i) => ({ p, i })).sort((x, y) => x.p - y.p);
  const adj = new Array<number>(m);
  let prev = Infinity;
  for (let k = m; k >= 1; k--) {
    const { p, i } = idx[k - 1]!;
    const val = Math.min(prev, (p * m) / k);
    adj[i] = Math.min(1, val);
    prev = adj[i]!;
  }
  return adj;
}

/** Cohen's h effect size for two proportions, with a magnitude label. */
export function cohensH(p1: number, p2: number): { h: number; magnitude: 'negligible' | 'small' | 'medium' | 'large' } {
  const phi = (p: number) => 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, p))));
  const h = Math.abs(phi(p1) - phi(p2));
  const magnitude = h < 0.2 ? 'negligible' : h < 0.5 ? 'small' : h < 0.8 ? 'medium' : 'large';
  return { h, magnitude };
}

/** Choose Fisher (small expected counts) vs the normal approximation. */
export function chooseTest(x1: number, n1: number, x2: number, n2: number): 'fisher_exact' | 'two_proportion_z' {
  const a = x1;
  const b = n1 - x1;
  const c = x2;
  const d = n2 - x2;
  const N = n1 + n2;
  const row1 = a + b;
  const row2 = c + d;
  const col1 = a + c;
  const col2 = b + d;
  const expected = [
    (row1 * col1) / N,
    (row1 * col2) / N,
    (row2 * col1) / N,
    (row2 * col2) / N,
  ];
  return Math.min(...expected) < 5 ? 'fisher_exact' : 'two_proportion_z';
}
