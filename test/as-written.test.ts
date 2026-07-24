import { describe, it, expect } from 'vitest';
import { compareAsWritten, type AsWrittenNqtlProfile } from '../src/analysis/as-written-comparability.js';

const ms = (p: Partial<AsWrittenNqtlProfile>): AsWrittenNqtlProfile => ({ side: 'MS', ...p });
const mh = (p: Partial<AsWrittenNqtlProfile>): AsWrittenNqtlProfile => ({ side: 'MHSUD', ...p });

describe('as-written comparability — the seven asymmetry types', () => {
  it('flags scope asymmetry (4% M/S vs 60% MH/SUD)', () => {
    const f = compareAsWritten('prior_authorization', 'outpatient_in_network', ms({ scopePercent: 4 }), mh({ scopePercent: 60 }));
    const scope = f.find((x) => x.asymmetryType === 'scope')!;
    expect(scope).toBeDefined();
    expect(scope.direction).toBe('more_stringent_for_mhsud');
    expect(scope.suggestedSeverity).toBe('significant_indicator');
  });

  it('does not flag comparable scope (30% vs 34%)', () => {
    const f = compareAsWritten('prior_authorization', 'outpatient_in_network', ms({ scopePercent: 30 }), mh({ scopePercent: 34 }));
    expect(f.some((x) => x.asymmetryType === 'scope')).toBe(false);
  });

  it('flags criteria-source asymmetry (proprietary MH/SUD vs MCG M/S)', () => {
    const f = compareAsWritten(
      'medical_necessity_criteria',
      'inpatient_in_network',
      ms({ criteriaSource: 'nationally_recognized', criteriaStandards: ['MCG'] }),
      mh({ criteriaSource: 'proprietary', criteriaStandards: [] }),
    );
    const c = f.find((x) => x.asymmetryType === 'criteria_source')!;
    expect(c.direction).toBe('more_stringent_for_mhsud');
  });

  it('flags missing ASAM for SUD when required', () => {
    const f = compareAsWritten(
      'medical_necessity_criteria',
      'inpatient_in_network',
      ms({ criteriaSource: 'nationally_recognized', criteriaStandards: ['InterQual'] }),
      mh({ criteriaSource: 'nationally_recognized', criteriaStandards: ['InterQual'] }),
      { sudRequiresAsam: true },
    );
    expect(f.some((x) => x.asymmetryType === 'criteria_source' && /ASAM/.test(x.detail))).toBe(true);
  });

  it('flags reviewer-qualification asymmetry', () => {
    const f = compareAsWritten('prior_authorization', 'inpatient_in_network', ms({ reviewerCredential: 'RN' }), mh({ reviewerCredential: 'peer physician' }));
    expect(f.some((x) => x.asymmetryType === 'reviewer_qualification')).toBe(true);
  });

  it('flags trigger-threshold asymmetry (lower MH/SUD dollar trigger is more stringent)', () => {
    const f = compareAsWritten('retrospective_review', 'inpatient_in_network', ms({ triggerThreshold: { type: 'dollar', value: 25000 } }), mh({ triggerThreshold: { type: 'dollar', value: 5000 } }));
    const t = f.find((x) => x.asymmetryType === 'trigger_threshold')!;
    expect(t.direction).toBe('more_stringent_for_mhsud');
  });

  it('flags review-cadence asymmetry (every 3d MH/SUD vs 7d M/S)', () => {
    const f = compareAsWritten('concurrent_review', 'inpatient_in_network', ms({ reviewCadenceDays: 7 }), mh({ reviewCadenceDays: 3 }));
    const c = f.find((x) => x.asymmetryType === 'review_cadence')!;
    expect(c.direction).toBe('more_stringent_for_mhsud');
    expect(c.suggestedSeverity).toBe('significant_indicator');
  });

  it('flags exclusion asymmetry (MH/SUD exclusion without M/S analog)', () => {
    const f = compareAsWritten('treatment_specific_exclusion', 'outpatient_out_of_network', ms({ exclusions: [] }), mh({ exclusions: ['wilderness therapy', 'ABA'] }));
    const exclusions = f.filter((x) => x.asymmetryType === 'exclusion');
    expect(exclusions).toHaveLength(2);
    expect(exclusions.every((x) => x.direction === 'more_stringent_for_mhsud')).toBe(true);
  });

  it('flags reimbursement-methodology and percent-of-Medicare asymmetry', () => {
    const f = compareAsWritten(
      'provider_reimbursement_methodology',
      'outpatient_in_network',
      ms({ reimbursementMethodology: 'percent_of_medicare', percentOfMedicare: 130 }),
      mh({ reimbursementMethodology: 'proprietary_fee_schedule', percentOfMedicare: 85 }),
    );
    expect(f.some((x) => x.asymmetryType === 'reimbursement_methodology' && x.detail.includes('methodology'))).toBe(true);
    const pom = f.find((x) => x.asymmetryType === 'reimbursement_methodology' && x.detail.includes('percent-of-Medicare'))!;
    expect(pom.direction).toBe('more_stringent_for_mhsud');
  });

  it('returns no findings for fully symmetric profiles', () => {
    const same = { scopePercent: 20, criteriaSource: 'nationally_recognized' as const, criteriaStandards: ['MCG'], reviewerCredential: 'RN', reviewCadenceDays: 5, exclusions: [], reimbursementMethodology: 'percent_of_medicare', percentOfMedicare: 120 };
    const f = compareAsWritten('prior_authorization', 'outpatient_in_network', ms(same), mh(same));
    expect(f).toHaveLength(0);
  });
});
