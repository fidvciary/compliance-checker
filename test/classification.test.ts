import { describe, it, expect } from 'vitest';
import { classifyClaim, detectIntermediateMisclassification, normalizeNetwork } from '../src/classification/classifier.js';
import { determineBenefitType } from '../src/classification/mhsud-identification.js';
import {
  ClassificationScheme,
  assertSchemesConsistent,
} from '../src/classification/consistency-lock.js';

describe('MH/SUD identification + comorbidity tie-break', () => {
  it('classifies an F-code primary diagnosis as MH/SUD', () => {
    const d = determineBenefitType({ diagnosis: { primary: 'F32.9' } });
    expect(d.benefitType).toBe('MHSUD');
  });

  it('classifies SUD (F10-F19) as MH/SUD', () => {
    expect(determineBenefitType({ diagnosis: { primary: 'F11.20' } }).benefitType).toBe('MHSUD');
  });

  it('treats a psychotherapy procedure as MH/SUD even with a medical primary dx', () => {
    const d = determineBenefitType({ diagnosis: { primary: 'E11.9' }, procedureCode: '90837' });
    expect(d.benefitType).toBe('MHSUD');
    expect(d.basis).toMatch(/procedure/);
  });

  it('applies the comorbidity tie-break: medical primary + MH secondary stays M/S but is flagged', () => {
    const d = determineBenefitType({ diagnosis: { primary: 'I50.9', secondary: ['F41.1'] } });
    expect(d.benefitType).toBe('MS');
    expect(d.comorbidity).toBe(true);
  });

  it('does not auto-assign ambiguous F01-F09 neurocognitive codes to MH/SUD', () => {
    const d = determineBenefitType({ diagnosis: { primary: 'F03.90' } });
    expect(d.benefitType).toBe('MS');
    expect(d.signals.primaryIsAmbiguousNeurocognitive).toBe(true);
  });
});

describe('network normalization', () => {
  it('maps varied tokens', () => {
    expect(normalizeNetwork('IN')).toBe('in_network');
    expect(normalizeNetwork('OON')).toBe('out_of_network');
    expect(normalizeNetwork('nonpar')).toBe('out_of_network');
    expect(normalizeNetwork(undefined)).toBe('not_applicable');
  });
});

describe('classification of claims', () => {
  it('classifies an inpatient psych admission (in-network) as inpatient_in_network', () => {
    const c = classifyClaim({ placeOfService: '51', primaryDiagnosis: 'F20.9', networkStatus: 'IN' });
    expect(c.benefitType).toBe('MHSUD');
    expect(c.classification).toBe('inpatient_in_network');
  });

  it('houses residential MH/SUD (RTC) in the INPATIENT classification per DOL analog', () => {
    const c = classifyClaim({ placeOfService: '56', primaryDiagnosis: 'F33.2', networkStatus: 'OUT' });
    expect(c.isIntermediate).toBe(true);
    expect(c.setting).toBe('intermediate_residential');
    expect(c.classification).toBe('inpatient_out_of_network');
    expect(c.intermediateAnalog?.msAnalog).toMatch(/nursing|rehab/i);
  });

  it('houses PHP in the OUTPATIENT classification', () => {
    const c = classifyClaim({ revenueCode: '0912', primaryDiagnosis: 'F10.20', networkStatus: 'IN' });
    expect(c.setting).toBe('intermediate_php');
    expect(c.classification).toBe('outpatient_in_network');
  });

  it('classifies an ED visit as emergency_care regardless of network', () => {
    const c = classifyClaim({ placeOfService: '23', primaryDiagnosis: 'F19.10', networkStatus: 'OUT' });
    expect(c.classification).toBe('emergency_care');
  });

  it('quarantines an unmappable claim instead of guessing', () => {
    const c = classifyClaim({ placeOfService: '99', primaryDiagnosis: 'F41.9' });
    expect(c.quarantined).toBe(true);
    expect(c.classification).toBe('QUARANTINE');
    expect(c.quarantineReason).toMatch(/manual review/i);
  });
});

describe('intermediate-care misclassification detector', () => {
  it('flags residential MH/SUD classified as outpatient while SNF is inpatient', () => {
    const r = detectIntermediateMisclassification({
      residentialMhsud: 'outpatient',
      skilledNursingOrRehab: 'inpatient',
    });
    expect(r.detected).toBe(true);
  });

  it('does not flag a symmetric classification', () => {
    const r = detectIntermediateMisclassification({
      residentialMhsud: 'inpatient',
      skilledNursingOrRehab: 'inpatient',
    });
    expect(r.detected).toBe(false);
  });
});

describe('consistency lock', () => {
  it('produces identical hashes for identically-built schemes', () => {
    const a = new ClassificationScheme().addClassification('inpatient_in_network').addClassification('outpatient_in_network').lock();
    const b = new ClassificationScheme().addClassification('outpatient_in_network').addClassification('inpatient_in_network').lock();
    expect(a.hash).toBe(b.hash); // order-independent
    assertSchemesConsistent(a.hash, b.hash);
  });

  it('throws when an engine uses a classification not in the locked scheme', () => {
    const scheme = new ClassificationScheme().addClassification('inpatient_in_network').lock();
    expect(() => scheme.assertInScope('outpatient_out_of_network')).toThrow(/not in the locked scheme/);
  });

  it('throws when sub-classifying for one analysis but not the other', () => {
    const scheme = new ClassificationScheme()
      .addClassification('outpatient_in_network')
      .addSubclassification('outpatient_in_network', { kind: 'outpatient_office_vs_other', value: 'office_visit' })
      .lock();
    // office_visit is declared; all_other is not
    scheme.assertInScope('outpatient_in_network', 'outpatient_office_vs_other:office_visit');
    expect(() =>
      scheme.assertInScope('outpatient_in_network', 'outpatient_office_vs_other:all_other_outpatient'),
    ).toThrow(/not declared/);
  });

  it('cannot be mutated after locking', () => {
    const b = new ClassificationScheme().addClassification('emergency_care');
    b.lock();
    expect(() => b.addClassification('prescription_drugs')).toThrow(/locked/);
  });

  it('fails the run when QTL and NQTL scheme hashes diverge', () => {
    expect(() => assertSchemesConsistent('aaaa', 'bbbb')).toThrow(/Consistency lock violation/);
  });
});
