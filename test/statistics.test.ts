import { describe, it, expect } from 'vitest';
import {
  normalCdf,
  twoSidedPFromZ,
  twoProportionZTest,
  fisherExactTwoSided,
  benjaminiHochberg,
  cohensH,
  chooseTest,
  logGamma,
} from '../src/in-operation/statistics.js';

const close = (a: number, b: number, tol = 1e-3) => Math.abs(a - b) <= tol;

describe('normal distribution', () => {
  it('normalCdf matches known values', () => {
    expect(close(normalCdf(0), 0.5)).toBe(true);
    expect(close(normalCdf(1.96), 0.975, 1e-3)).toBe(true);
    expect(close(normalCdf(-1.96), 0.025, 1e-3)).toBe(true);
    expect(close(normalCdf(2.576), 0.995, 1e-3)).toBe(true);
  });
  it('two-sided p for z=1.96 is ~0.05', () => {
    expect(close(twoSidedPFromZ(1.96), 0.05, 1e-3)).toBe(true);
  });
});

describe('logGamma', () => {
  it('reproduces factorials (Gamma(n+1) = n!)', () => {
    expect(close(Math.exp(logGamma(6)), 120, 1e-6)).toBe(true); // 5!
    expect(close(Math.exp(logGamma(11)), 3628800, 1e-1)).toBe(true); // 10!
  });
});

describe('two-proportion z-test', () => {
  it('matches a hand-computed example (10/100 vs 20/100)', () => {
    const r = twoProportionZTest(10, 100, 20, 100);
    expect(close(r.p1, 0.1)).toBe(true);
    expect(close(r.p2, 0.2)).toBe(true);
    expect(close(r.diff, -0.1)).toBe(true);
    expect(close(r.ratio, 0.5)).toBe(true);
    expect(close(Math.abs(r.z), 1.9802, 1e-3)).toBe(true);
    expect(close(r.pValue, 0.0477, 2e-3)).toBe(true);
  });
  it('handles p2 = 0 without NaN', () => {
    const r = twoProportionZTest(5, 100, 0, 100);
    expect(r.ratio).toBe(Infinity);
    expect(Number.isFinite(r.pValue)).toBe(true);
  });
});

describe('Fisher exact (two-sided)', () => {
  it('matches the classic 2x2 [[3,1],[1,3]] ~ 0.4857', () => {
    expect(close(fisherExactTwoSided(3, 1, 1, 3), 0.4857, 1e-3)).toBe(true);
  });
  it('is tiny for a perfectly separated table', () => {
    expect(fisherExactTwoSided(10, 0, 0, 10)).toBeLessThan(0.001);
  });
  it('is ~1 for no association', () => {
    expect(fisherExactTwoSided(5, 5, 5, 5)).toBeGreaterThan(0.9);
  });
});

describe('Benjamini–Hochberg', () => {
  it('all-equal-spaced p-values collapse to the max here', () => {
    const adj = benjaminiHochberg([0.01, 0.02, 0.03, 0.04, 0.05]);
    expect(adj.every((p) => close(p, 0.05))).toBe(true);
  });
  it('preserves input order and enforces monotonicity', () => {
    const adj = benjaminiHochberg([0.001, 0.5]);
    expect(close(adj[0]!, 0.002)).toBe(true);
    expect(close(adj[1]!, 0.5)).toBe(true);
  });
  it('caps at 1', () => {
    const adj = benjaminiHochberg([0.9, 0.95]);
    expect(adj.every((p) => p <= 1)).toBe(true);
  });
});

describe('effect size + test choice', () => {
  it('Cohen’s h labels magnitude', () => {
    expect(cohensH(0.1, 0.2).magnitude).toBe('small');
    expect(cohensH(0.061, 0.065).magnitude).toBe('negligible');
    expect(cohensH(0.05, 0.6).magnitude).toBe('large');
  });
  it('chooses Fisher when an expected cell count is < 5', () => {
    // 1 event in 40 vs 0 in 40 -> tiny expected counts
    expect(chooseTest(1, 40, 0, 40)).toBe('fisher_exact');
  });
  it('chooses the z-test for large, well-populated tables', () => {
    expect(chooseTest(1200, 18900, 400, 20000)).toBe('two_proportion_z');
  });
});
