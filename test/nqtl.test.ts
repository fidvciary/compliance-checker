import { describe, it, expect } from 'vitest';
import { ClassificationScheme } from '../src/classification/consistency-lock.js';
import { scaffoldSixStep } from '../src/nqtl/scaffolder.js';
import { SixStepRegistry, sixStepKey } from '../src/nqtl/six-step.js';
import { crossCheckFactorSymmetry } from '../src/nqtl/factors.js';
import { nqtlsForSet } from '../src/nqtl/nqtl-library.js';

describe('NQTL library', () => {
  it('core is a strict subset of full', () => {
    const core = nqtlsForSet('core').map((n) => n.id);
    const full = nqtlsForSet('full').map((n) => n.id);
    expect(core.every((id) => full.includes(id))).toBe(true);
    expect(full.length).toBeGreaterThan(core.length);
  });
});

describe('six-step scaffolder + cardinality', () => {
  const scheme = new ClassificationScheme().useAllClassifications().lock();

  it('instantiates one record per NQTL × applicable classification', () => {
    const { registry } = scaffoldSixStep({ scheme, nqtlSet: 'core', scope: 'both' });
    // prior_authorization applies to all six classifications
    expect(registry.forNqtl('prior_authorization')).toHaveLength(6);
    // concurrent_review applies to the four inpatient/outpatient classifications only
    expect(registry.forNqtl('concurrent_review')).toHaveLength(4);
  });

  it('separates inpatient in-network from inpatient out-of-network', () => {
    const { registry } = scaffoldSixStep({ scheme, nqtlSet: 'core', scope: 'both' });
    expect(registry.get(sixStepKey('prior_authorization', 'inpatient_in_network'))).toBeDefined();
    expect(registry.get(sixStepKey('prior_authorization', 'inpatient_out_of_network'))).toBeDefined();
    // they are distinct records
    expect(sixStepKey('prior_authorization', 'inpatient_in_network')).not.toBe(
      sixStepKey('prior_authorization', 'inpatient_out_of_network'),
    );
  });

  it('rejects a duplicate record (no combining across classifications)', () => {
    const reg = new SixStepRegistry();
    const rec = {
      id: sixStepKey('prior_authorization', 'inpatient_in_network'),
      nqtlId: 'prior_authorization',
      classification: 'inpatient_in_network' as const,
      step1: { nqtlDescription: '', planTermRefs: [], msBenefitsApplied: [], mhsudBenefitsApplied: [], narrative: null },
      step2: { ms: { side: 'MS' as const, factors: [], evidentiarySources: [] }, mhsud: { side: 'MHSUD' as const, factors: [], evidentiarySources: [] }, asymmetries: [], narrative: null },
      step3: { narrative: null },
      step4: { findingIds: [], narrative: null },
      step5: { performed: true, findingIds: [], narrative: null },
      step6: { findingIds: [], narrative: null },
    };
    reg.add(rec);
    expect(() => reg.add(rec)).toThrow(/Duplicate six-step record/);
  });

  it('marks Step 5 not-performed with the required statutory limitation under as-written scope', () => {
    const { registry } = scaffoldSixStep({ scheme, nqtlSet: 'core', scope: 'as-written' });
    const r = registry.get(sixStepKey('prior_authorization', 'outpatient_in_network'))!;
    expect(r.step5.performed).toBe(false);
    expect(r.step5.notPerformedReason).toMatch(/300gg-26\(a\)\(8\)\(A\)\(iv\)/);
  });

  it('honors the locked scheme (only in-scope classifications get records)', () => {
    const partial = new ClassificationScheme()
      .addClassification('outpatient_in_network')
      .addClassification('outpatient_out_of_network')
      .lock();
    const { registry } = scaffoldSixStep({ scheme: partial, nqtlSet: 'core', scope: 'both' });
    expect(registry.all().every((r) => r.classification.startsWith('outpatient'))).toBe(true);
  });

  it('pre-seeds the standardized DOL factor and source lists', () => {
    const res = scaffoldSixStep({ scheme, nqtlSet: 'core', scope: 'both' });
    expect(res.standardizedFactors).toContain('excessive_utilization');
    expect(res.standardizedEvidentiarySources).toContain('published_clinical_standards');
  });
});

describe('factor / evidentiary-source symmetry cross-check', () => {
  it('flags a factor used only for MH/SUD', () => {
    const asym = crossCheckFactorSymmetry(
      { side: 'MS', factors: [{ factor: 'excessive_utilization', definition: '>$10k/episode' }], evidentiarySources: ['internal_claims_analysis'] },
      { side: 'MHSUD', factors: [{ factor: 'excessive_utilization', definition: '>$10k/episode' }, { factor: 'high_variation_in_length_of_stay', definition: 'any' }], evidentiarySources: ['internal_claims_analysis'] },
    );
    expect(asym.some((a) => a.type === 'factor_only_on_mhsud' && a.item === 'high_variation_in_length_of_stay')).toBe(true);
  });

  it('flags a factor defined differently across sides', () => {
    const asym = crossCheckFactorSymmetry(
      { side: 'MS', factors: [{ factor: 'excessive_utilization', definition: '>$50k/episode' }], evidentiarySources: [] },
      { side: 'MHSUD', factors: [{ factor: 'excessive_utilization', definition: '>$10k/episode' }], evidentiarySources: [] },
    );
    expect(asym.some((a) => a.type === 'factor_defined_differently')).toBe(true);
  });

  it('flags an evidentiary source used only on one side', () => {
    const asym = crossCheckFactorSymmetry(
      { side: 'MS', factors: [], evidentiarySources: ['national_accreditation_standards', 'medicare_fee_schedules'] },
      { side: 'MHSUD', factors: [], evidentiarySources: ['national_accreditation_standards'] },
    );
    expect(asym.some((a) => a.type === 'source_only_on_ms' && a.item === 'medicare_fee_schedules')).toBe(true);
  });

  it('returns no asymmetry for symmetric profiles', () => {
    const same = { factors: [{ factor: 'excessive_utilization', definition: 'x' }], evidentiarySources: ['internal_claims_analysis'] };
    const asym = crossCheckFactorSymmetry({ side: 'MS', ...same }, { side: 'MHSUD', ...same });
    expect(asym).toHaveLength(0);
  });
});
