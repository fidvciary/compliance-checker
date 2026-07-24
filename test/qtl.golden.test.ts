import { describe, it, expect } from 'vitest';
import { evaluateQtl } from '../src/qtl/qtl-engine.js';
import { evaluateCumulative, evaluateDollarLimit } from '../src/qtl/cumulative.js';
import type { FrQtlType, MsBenefit } from '../src/qtl/types.js';

const COPAY: FrQtlType = { id: 'copay', kind: 'financial_requirement', label: 'copayment', restrictiveness: 'higher_is_more_restrictive' };
const COINS: FrQtlType = { id: 'coinsurance', kind: 'financial_requirement', label: 'coinsurance', restrictiveness: 'higher_is_more_restrictive' };
const DAY_LIMIT: FrQtlType = { id: 'inpatient_day_limit', kind: 'quantitative_treatment_limitation', label: 'inpatient day limit', restrictiveness: 'lower_is_more_restrictive' };

const b = (id: string, planPayments: number, subjectToType: boolean, level: number | null = null): MsBenefit => ({
  id, planPayments, subjectToType, level,
});

describe('QTL golden fixtures — substantially-all (hand-computed)', () => {
  // FIXTURE 1 — exact two-thirds boundary.
  it('exact 2/3 boundary: applies AND is flagged threshold_proximate', () => {
    const d = evaluateQtl({
      classification: 'outpatient_in_network',
      frQtlType: COPAY,
      projectionMethod: 'prior-year paid, trended',
      msBenefits: [b('B1', 200, true, 20), b('B2', 200, true, 20), b('B3', 200, false)],
      mhsudApplied: { subjectToType: true, level: 20 },
    });
    expect(d.substantiallyAll.denominatorDollars).toBe(600);
    expect(d.substantiallyAll.numeratorDollars).toBe(400);
    expect(d.substantiallyAll.applies).toBe(true); // 3*400 >= 2*600
    expect(d.substantiallyAll.thresholdProximate).toBe(true);
    expect(d.predominant?.predominantLevel).toBe(20);
    expect(d.compliance.verdict).toBe('threshold_proximate');
  });

  // FIXTURE 4 — substantially-all fails.
  it('S-A fails (1/3): a copay applied to MH/SUD is a facial violation', () => {
    const d = evaluateQtl({
      classification: 'inpatient_in_network',
      frQtlType: COPAY,
      projectionMethod: 'prior-year paid',
      msBenefits: [b('B1', 300, true, 20), b('B2', 300, false), b('B3', 300, false)],
      mhsudApplied: { subjectToType: true, level: 20 },
    });
    expect(d.substantiallyAll.applies).toBe(false);
    expect(d.predominant).toBeNull();
    expect(d.compliance.verdict).toBe('facial_violation');
    expect(d.compliance.failureType).toBe('substantially_all_fails_but_applied');
    expect(d.compliance.mayApplyToMhsud).toBe(false);
  });

  // FIXTURE 3 — zero M/S benefits in the classification.
  it('zero M/S benefits: division-by-zero handled; applying to MH/SUD is a facial violation', () => {
    const d = evaluateQtl({
      classification: 'inpatient_out_of_network',
      frQtlType: COPAY,
      projectionMethod: 'prior-year paid',
      msBenefits: [],
      mhsudApplied: { subjectToType: true, level: 20 },
    });
    expect(d.substantiallyAll.noMsBenefits).toBe(true);
    expect(d.substantiallyAll.ratio).toBe(0); // NaN-safe
    expect(d.substantiallyAll.applies).toBe(false);
    expect(d.compliance.verdict).toBe('facial_violation');
    expect(d.compliance.rationale).toMatch(/no M\/S benefits/i);
  });
});

describe('QTL golden fixtures — predominant (hand-computed)', () => {
  // FIXTURE 2 — no single level over one-half → multi-level combination.
  it('no single level > 1/2: combines most-restrictive-first; predominant = 20% coinsurance', () => {
    const d = evaluateQtl({
      classification: 'outpatient_in_network',
      frQtlType: COINS,
      projectionMethod: 'prior-year paid',
      // all subject → S-A = 100%
      msBenefits: [b('L1', 200, true, 10), b('L2', 250, true, 15), b('L3', 300, true, 20), b('L4', 250, true, 30)],
      mhsudApplied: { subjectToType: true, level: 20 },
    });
    expect(d.substantiallyAll.applies).toBe(true);
    expect(d.predominant?.singleLevelMajority).toBeNull();
    // combine 30% ($250) then 20% ($300) → cumulative $550 (>$500); least restrictive = 20%
    expect(d.predominant?.combination?.leastRestrictiveLevel).toBe(20);
    expect(d.predominant?.predominantLevel).toBe(20);
    expect(d.compliance.verdict).toBe('compliant'); // MH/SUD 20% == predominant, not more restrictive
  });

  it('same distribution but MH/SUD at 30% exceeds predominant → facial violation', () => {
    const d = evaluateQtl({
      classification: 'outpatient_in_network',
      frQtlType: COINS,
      projectionMethod: 'prior-year paid',
      msBenefits: [b('L1', 200, true, 10), b('L2', 250, true, 15), b('L3', 300, true, 20), b('L4', 250, true, 30)],
      mhsudApplied: { subjectToType: true, level: 30 },
    });
    expect(d.compliance.verdict).toBe('facial_violation');
    expect(d.compliance.failureType).toBe('predominant_exceeded');
    expect(d.compliance.allowedMaxLevel).toBe(20);
  });

  it('single-level majority: predominant = $30 copay; MH/SUD $20 is compliant', () => {
    const d = evaluateQtl({
      classification: 'outpatient_in_network',
      frQtlType: COPAY,
      projectionMethod: 'prior-year paid',
      msBenefits: [b('B1', 400, true, 30), b('B2', 400, true, 30), b('B3', 200, true, 10)],
      mhsudApplied: { subjectToType: true, level: 20 },
    });
    expect(d.predominant?.singleLevelMajority?.level).toBe(30); // $800/$1000 = 80%
    expect(d.compliance.verdict).toBe('compliant');
  });
});

describe('QTL golden fixtures — QTL direction (lower is more restrictive)', () => {
  it('day-limit: predominant 30 days; MH/SUD 20-day limit is MORE restrictive → facial violation', () => {
    const d = evaluateQtl({
      classification: 'inpatient_in_network',
      frQtlType: DAY_LIMIT,
      projectionMethod: 'prior-year paid',
      msBenefits: [b('B1', 600, true, 30), b('B2', 400, true, 60)],
      mhsudApplied: { subjectToType: true, level: 20 },
    });
    expect(d.predominant?.predominantLevel).toBe(30); // 30-day level is 60% of subject dollars
    expect(d.compliance.verdict).toBe('facial_violation');
    expect(d.compliance.failureType).toBe('predominant_exceeded');
  });

  it('day-limit combination: 15,30,45,60 → predominant 30 days (lower-first combination)', () => {
    const d = evaluateQtl({
      classification: 'inpatient_in_network',
      frQtlType: DAY_LIMIT,
      projectionMethod: 'prior-year paid',
      msBenefits: [b('L1', 250, true, 15), b('L2', 300, true, 30), b('L3', 250, true, 45), b('L4', 200, true, 60)],
      mhsudApplied: { subjectToType: true, level: 30 },
    });
    // most restrictive (lowest) first: 15 ($250), 30 ($300) → cum $550 > $500; least restrictive = 30
    expect(d.predominant?.combination?.leastRestrictiveLevel).toBe(30);
    expect(d.compliance.verdict).toBe('compliant');
  });
});

describe('QTL cumulative + aggregate dollar limits (bright-line facial)', () => {
  it('flags a separate MH/SUD deductible and OOP max as facial violations', () => {
    const f = evaluateCumulative({
      classification: 'outpatient_in_network',
      separateMhsudDeductible: true,
      separateMhsudOutOfPocketMax: true,
    });
    expect(f).toHaveLength(2);
    expect(f.every((x) => x.isFacialViolation)).toBe(true);
  });

  it('flags a MH/SUD-only annual dollar limit as a facial violation', () => {
    const f = evaluateDollarLimit({ scope: 'annual', mhsudLimit: 5000, msLimit: null });
    expect(f?.isFacialViolation).toBe(true);
  });

  it('flags a lower MH/SUD lifetime dollar limit', () => {
    const f = evaluateDollarLimit({ scope: 'aggregate_lifetime', mhsudLimit: 100000, msLimit: 1000000 });
    expect(f?.isFacialViolation).toBe(true);
  });

  it('does not flag equal dollar limits', () => {
    expect(evaluateDollarLimit({ scope: 'annual', mhsudLimit: 5000, msLimit: 5000 })).toBeNull();
  });
});
