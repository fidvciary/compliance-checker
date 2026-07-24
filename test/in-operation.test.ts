import { describe, it, expect } from 'vitest';
import {
  runRateComparison,
  runComparisonFamily,
  MINIMUM_CELL_SIZE,
  type RateComparisonInput,
} from '../src/in-operation/metrics.js';

describe('in-operation metrics — n>=30 gate', () => {
  it('emits INSUFFICIENT_DATA (not a computed result) below the minimum cell size', () => {
    const r = runRateComparison({
      metricId: 'denial_rate',
      classification: 'outpatient_in_network',
      mhsud: { events: 5, n: 20 },
      ms: { events: 3, n: 100 },
    });
    expect(r.status).toBe('insufficient_data');
    expect(r.pValue).toBeUndefined();
    expect(r.nMhsud).toBe(20);
    expect(r.insufficientReason).toMatch(new RegExp(String(MINIMUM_CELL_SIZE)));
    expect(r.insufficientReason).toMatch(/24-month/);
  });

  it('runs when both sides meet the minimum', () => {
    const r = runRateComparison({
      metricId: 'denial_rate',
      classification: 'outpatient_in_network',
      mhsud: { events: 226, n: 1240 },
      ms: { events: 1153, n: 18900 },
    });
    expect(r.status).toBe('tested');
    expect(r.testUsed).toBe('two_proportion_z');
  });
});

describe('in-operation metrics — framing (investigation question, never a conclusion)', () => {
  const family: RateComparisonInput[] = [
    { metricId: 'denial_rate', classification: 'outpatient_in_network', mhsud: { events: 226, n: 1240 }, ms: { events: 1153, n: 18900 } },
  ];

  it('produces the warning-sign investigation-question framing for an adverse significant disparity', () => {
    const [r] = runComparisonFamily(family);
    expect(r!.status).toBe('tested');
    expect(r!.significant).toBe(true);
    expect(r!.adverseToMhsud).toBe(true);
    expect(r!.investigationQuestion).toMatch(/warning sign warranting further review/);
    expect(r!.investigationQuestion).toMatch(/does not, by itself, establish noncompliance/);
    // never emits the word "violation"
    expect(r!.investigationQuestion.toLowerCase()).not.toContain('violation');
  });

  it('reports ratio, absolute difference, p-value, adjusted p, and CI (all four+)', () => {
    const [r] = runComparisonFamily(family);
    expect(r!.ratio).toBeGreaterThan(2.5);
    expect(typeof r!.diff).toBe('number');
    expect(r!.pValue).toBeLessThan(0.001);
    expect(r!.pAdjusted).toBeDefined();
    expect(r!.ciLow).toBeDefined();
    expect(r!.ciHigh).toBeDefined();
    expect(r!.effectSize).toBeDefined();
  });

  it('flags a statistically-significant-but-practically-negligible difference', () => {
    // huge n, tiny difference: 6.1% vs 6.5%
    const [r] = runComparisonFamily([
      { metricId: 'denial_rate', classification: 'outpatient_in_network', mhsud: { events: 13000, n: 200000 }, ms: { events: 12200, n: 200000 } },
    ]);
    expect(r!.significant).toBe(true);
    expect(r!.practicallyNegligible).toBe(true);
    expect(r!.investigationQuestion).toMatch(/practical magnitude is negligible/);
  });

  it('applies Benjamini–Hochberg across the family (raw and adjusted reported)', () => {
    const results = runComparisonFamily([
      { metricId: 'denial_rate', classification: 'inpatient_in_network', mhsud: { events: 40, n: 200 }, ms: { events: 30, n: 300 } },
      { metricId: 'denial_rate', classification: 'outpatient_in_network', mhsud: { events: 100, n: 500 }, ms: { events: 90, n: 1000 } },
      { metricId: 'denial_rate', classification: 'inpatient_out_of_network', mhsud: { events: 5, n: 50 }, ms: { events: 6, n: 60 } },
    ]);
    const tested = results.filter((r) => r.status === 'tested');
    for (const r of tested) {
      expect(r.pAdjusted).toBeGreaterThanOrEqual(r.pValue!); // adjusted >= raw
      expect(r.pAdjusted).toBeLessThanOrEqual(1);
    }
  });

  it('uses Fisher exact when counts are small (but n>=30)', () => {
    const r = runRateComparison({
      metricId: 'appeal_overturn_rate',
      classification: 'inpatient_out_of_network',
      mhsud: { events: 1, n: 35 },
      ms: { events: 0, n: 40 },
    });
    expect(r.status).toBe('tested');
    expect(r.testUsed).toBe('fisher_exact');
  });

  it('recognizes approval rate as adverse when MH/SUD is LOWER', () => {
    const [r] = runComparisonFamily([
      { metricId: 'pa_approval_rate', classification: 'inpatient_in_network', mhsud: { events: 400, n: 1000 }, ms: { events: 850, n: 1000 } },
    ]);
    expect(r!.adverseToMhsud).toBe(true); // lower approval for MH/SUD is adverse
  });
});
