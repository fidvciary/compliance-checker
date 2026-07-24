import { describe, it, expect } from 'vitest';
import { scanPassages, detectDualAdministrator, type CandidatePassage } from '../src/analysis/warning-sign-scanner.js';
import { WARNING_SIGN_RULES } from '../src/analysis/nqtl-warning-signs.js';

/**
 * Synthetic planted corpus: one passage per warning-sign rule, with an
 * expected-hit manifest. Recall = every planted rule fires on its passage.
 * Precision is tested separately with adversarial compliant look-alikes.
 */
const PLANTED: Array<{ expect: string; passage: CandidatePassage }> = [
  { expect: 'I.blanket_preauth_mhsud', passage: { documentId: 'spd', page: 12, section: 'UM', text: 'Prior authorization is required for outpatient behavioral health services.' } },
  { expect: 'I.facility_admission_preauth_mhsud', passage: { documentId: 'spd', page: 12, text: 'Precertification is required for substance use disorder residential admissions.' } },
  { expect: 'I.frequent_concurrent_review_mhsud', passage: { documentId: 'um', page: 3, text: 'Concurrent review is conducted every 3 days for substance use disorder inpatient stays.' } },
  { expect: 'I.delegated_different_criteria_mhsud', passage: { documentId: 'vendor', text: 'Behavioral health services are managed by a separate behavioral health organization (MBHO).' } },
  { expect: 'II.document_progress_prior_treatment', passage: { documentId: 'um', text: 'Coverage requires the member to document progress in prior treatment for substance use disorder.' } },
  { expect: 'II.exhaust_prior_levels_of_care', passage: { documentId: 'um', text: 'Members must fail first at a lower level of care before residential mental health treatment is approved.' } },
  { expect: 'II.php_before_inpatient', passage: { documentId: 'um', text: 'Partial hospitalization must be attempted before inpatient admission for psychiatric care.' } },
  { expect: 'III.likelihood_of_improvement_exclusion', passage: { documentId: 'spd', text: 'Coverage is excluded unless the member is likely to improve for mental health conditions.' } },
  { expect: 'III.measurable_improvement_n_days', passage: { documentId: 'um', text: 'The member must show measurable improvement within 30 days of substance use disorder treatment or benefits are discontinued.' } },
  { expect: 'IV.written_plan_mhsud_only', passage: { documentId: 'spd', text: 'A written treatment plan must be submitted for mental health services.' } },
  { expect: 'IV.periodic_resubmission', passage: { documentId: 'um', text: 'The treatment plan must be updated every 7 days for behavioral health admissions.' } },
  { expect: 'V.patient_noncompliance_exclusion', passage: { documentId: 'spd', text: 'Benefits are excluded where the patient is non-compliant with the treatment program for substance use disorder.' } },
  { expect: 'V.residential_day_limit', passage: { documentId: 'sob', text: 'Residential treatment is limited to 30 days per plan year.' } },
  { expect: 'V.geographic_restriction', passage: { documentId: 'spd', text: 'Residential mental health treatment must be provided at an in-state facility.' } },
  { expect: 'V.licensure_restriction', passage: { documentId: 'spd', text: 'Services provided by an LMFT or LPC are not covered.' } },
  { expect: 'V.wilderness_exclusion', passage: { documentId: 'spd', text: 'Wilderness therapy programs are excluded from coverage.' } },
];

describe('warning-sign scanner — recall on planted corpus', () => {
  for (const { expect: ruleId, passage } of PLANTED) {
    it(`fires ${ruleId}`, () => {
      const hits = scanPassages([passage]);
      expect(hits.map((h) => h.ruleId)).toContain(ruleId);
    });
  }

  it('every rule in the table is exercised by the corpus', () => {
    const covered = new Set(PLANTED.map((p) => p.expect));
    const uncovered = WARNING_SIGN_RULES.map((r) => r.id).filter((id) => !covered.has(id));
    expect(uncovered).toEqual([]);
  });

  it('quotes plan language verbatim with an anchor (LLM does not classify)', () => {
    const hits = scanPassages([PLANTED[0]!.passage]);
    expect(hits[0]!.passage.text).toBe(PLANTED[0]!.passage.text);
    expect(hits[0]!.passage.documentId).toBe('spd');
    expect(hits[0]!.authorityRefs).toContain('guidance:warning-signs');
  });
});

describe('warning-sign scanner — precision (adversarial compliant look-alikes must NOT fire)', () => {
  const adversarial: CandidatePassage[] = [
    { documentId: 'a1', text: 'Prior authorization is required for all inpatient admissions, both medical/surgical and behavioral health.' },
    { documentId: 'a2', text: 'Concurrent review is conducted every 3 days for all inpatient admissions regardless of diagnosis.' },
    { documentId: 'a3', text: 'A written treatment plan must be submitted for all inpatient admissions.' },
    { documentId: 'a4', text: 'Step therapy applies to specialty pharmacy for both medical and behavioral conditions.' },
  ];

  for (const p of adversarial) {
    it(`does not flag: "${p.text.slice(0, 42)}..."`, () => {
      expect(scanPassages([p])).toHaveLength(0);
    });
  }
});

describe('dual-administrator detector', () => {
  it('flags different UM vendors for M/S vs MH/SUD', () => {
    const f = detectDualAdministrator([
      { function: 'utilization_management', msVendor: 'Aetna', mhsudVendor: 'Optum Behavioral' },
    ]);
    expect(f).toHaveLength(1);
    expect(f[0]!.type).toBe('different_vendor');
  });

  it('flags different medical-necessity criteria sets', () => {
    const f = detectDualAdministrator([
      { function: 'medical_necessity_criteria', msVendor: 'X', mhsudVendor: 'X', msCriteriaSet: 'MCG', mhsudCriteriaSet: 'proprietary' },
    ]);
    expect(f.some((x) => x.type === 'different_criteria')).toBe(true);
  });

  it('does not flag identical vendor and criteria', () => {
    const f = detectDualAdministrator([
      { function: 'utilization_management', msVendor: 'Aetna', mhsudVendor: 'Aetna', msCriteriaSet: 'MCG', mhsudCriteriaSet: 'MCG' },
    ]);
    expect(f).toHaveLength(0);
  });
});
