import type { AnalysisInput } from './pipeline.js';

/**
 * A realistic synthetic scenario that exercises the whole pipeline end to end,
 * with planted findings across both tracks and all scopes. Used by `parity
 * analyze --demo` and by the integration test. All data is fabricated and
 * de-identified.
 */
export function buildDemoInput(): AnalysisInput {
  return {
    analysisId: 'DEMO-2025',
    planYear: 2025,
    scope: 'both',
    jurisdiction: 'CT',
    rulesetSelectors: {
      active: ['federal:statute', 'federal:2013', 'guidance:*', 'state:ct'],
      advisory: ['federal:2024'],
    },
    nqtlSet: 'core',
    samplePeriod: '2024-01-01 to 2024-12-31',
    projectionMethod: 'prior-year paid claims, trended 6%',
    dataSources: [
      { artifact: 'SPD + wrap document', provenance: 'employer upload' },
      { artifact: 'Claims extract (de-identified)', provenance: 'Aetna ASO, 2024 CY' },
    ],

    // QTL: a copay that fails substantially-all on the M/S side but is applied to MH/SUD → facial.
    qtlInputs: [
      {
        classification: 'outpatient_in_network',
        frQtlType: { id: 'copay', kind: 'financial_requirement', label: 'copayment', restrictiveness: 'higher_is_more_restrictive' },
        projectionMethod: 'prior-year paid, trended 6%',
        msBenefits: [
          { id: 'office_visit', planPayments: 200000, subjectToType: true, level: 25 },
          { id: 'pt', planPayments: 800000, subjectToType: false },
        ],
        mhsudApplied: { subjectToType: true, level: 40 },
      },
    ],
    cumulativeInputs: [{ classification: 'outpatient_in_network', separateMhsudDeductible: true, separateMhsudOutOfPocketMax: false }],
    dollarLimitInputs: [{ scope: 'annual', mhsudLimit: 5000, msLimit: null }],

    // As-written warning signs (verbatim plan language)
    warningSignPassages: [
      { documentId: 'SPD', page: 14, section: 'Behavioral Health', text: 'Prior authorization is required for all outpatient mental health and substance use disorder services.' },
      { documentId: 'SPD', page: 22, section: 'Exclusions', text: 'Wilderness therapy programs are excluded from coverage.' },
      { documentId: 'UM', page: 3, section: 'Concurrent Review', text: 'Concurrent review is conducted every 3 days for substance use disorder inpatient stays.' },
    ],
    vendorMap: [{ function: 'utilization_management', msVendor: 'Aetna', mhsudVendor: 'Optum Behavioral', msCriteriaSet: 'MCG', mhsudCriteriaSet: 'proprietary' }],

    asWrittenComparisons: [
      {
        nqtlId: 'prior_authorization',
        classification: 'outpatient_in_network',
        ms: { side: 'MS', scopePercent: 5, criteriaSource: 'nationally_recognized', criteriaStandards: ['MCG'] },
        mhsud: { side: 'MHSUD', scopePercent: 62, criteriaSource: 'proprietary', criteriaStandards: [] },
      },
    ],
    factorProfiles: [
      {
        nqtlId: 'prior_authorization',
        classification: 'outpatient_in_network',
        ms: { side: 'MS', factors: [{ factor: 'excessive_utilization', definition: '>90th pct LOS' }], evidentiarySources: ['internal_claims_analysis'] },
        mhsud: { side: 'MHSUD', factors: [{ factor: 'excessive_utilization', definition: '>75th pct LOS' }, { factor: 'high_variation_in_length_of_stay', definition: 'any' }], evidentiarySources: ['internal_claims_analysis', 'internal_market_and_competitive_analysis'] },
      },
    ],

    // Litigation track: plan facts that trip the dual-UM-vendor rule (activated for demo).
    planFacts: { dualUmVendor: true, wildernessExclusion: true, mhsudCriteriaSource: 'proprietary', mhsudCriteriaStandards: [] },
    caselawActivateForTest: ['nqtl.dual_um_vendor'],

    // In-operation: an adverse, significant denial-rate disparity + an insufficient-data cell.
    rateComparisons: [
      { metricId: 'denial_rate', classification: 'outpatient_in_network', mhsud: { events: 226, n: 1240 }, ms: { events: 1153, n: 18900 } },
      { metricId: 'denial_rate', classification: 'inpatient_out_of_network', mhsud: { events: 3, n: 12 }, ms: { events: 2, n: 40 } },
    ],
    reimbursementTable: [
      { code: '99213', description: 'Office visit, established', specialtyGroup: 'M/S comparison', percentOfMedicare: 128, locality: 'CT' },
      { code: '90837', description: 'Psychotherapy, 60 min', specialtyGroup: 'MH/SUD', percentOfMedicare: 84, locality: 'CT' },
      { code: '90853', description: 'Group psychotherapy', specialtyGroup: 'MH/SUD', percentOfMedicare: 79, locality: 'CT' },
    ],
  };
}
