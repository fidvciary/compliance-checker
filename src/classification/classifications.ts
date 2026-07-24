/**
 * Module 3 — MHPAEA classification taxonomy.
 *
 * Six classifications (29 CFR § 2590.712(c)(2)(ii)) plus the permitted
 * sub-classifications. Parity is tested WITHIN a classification, and (per the WV
 * submission-form rule) classifications are shared between QTL and NQTL testing
 * — see consistency-lock.ts.
 */

export const CLASSIFICATIONS = [
  'inpatient_in_network',
  'inpatient_out_of_network',
  'outpatient_in_network',
  'outpatient_out_of_network',
  'emergency_care',
  'prescription_drugs',
] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

/** Special sentinel: a claim/benefit that could not be deterministically mapped. */
export const QUARANTINE = 'QUARANTINE' as const;
export type ClassificationOrQuarantine = Classification | typeof QUARANTINE;

export type BenefitType = 'MS' | 'MHSUD' | 'indeterminate';

/**
 * Physical setting derived from codes, BEFORE combination with network. The
 * three "intermediate_*" settings are first-class because they are where
 * classification errors produce false compliance.
 */
export type Setting =
  | 'inpatient'
  | 'outpatient'
  | 'emergency'
  | 'prescription'
  | 'intermediate_residential' // RTC — DOL analog: SNF / rehab facility (inpatient)
  | 'intermediate_php' // partial hospitalization — analog: intensive outpatient (outpatient)
  | 'intermediate_iop' // intensive outpatient — analog: intensive outpatient (outpatient)
  | 'indeterminate';

export type NetworkStatus = 'in_network' | 'out_of_network' | 'not_applicable';

/** Permitted outpatient sub-classification (§ 2590.712(c)(3)(iii)(C)). */
export type OutpatientSubclass = 'office_visit' | 'all_other_outpatient';

export interface Subclassification {
  kind: 'outpatient_office_vs_other' | 'network_tier' | 'formulary_tier';
  value: string; // e.g. 'office_visit', 'tier_1', 'preferred'
}

/**
 * DOL intermediate-care analog policy.
 *
 * MH/SUD intermediate care must be assigned to the classification housing its
 * M/S analog. Residential treatment maps to the inpatient classification (its
 * analogs — skilled nursing facility, rehabilitation facility — are inpatient);
 * PHP and IOP map to the outpatient classification (their analog is intensive
 * outpatient M/S care).
 */
export const INTERMEDIATE_ANALOG: Record<
  'intermediate_residential' | 'intermediate_php' | 'intermediate_iop',
  { housingSetting: 'inpatient' | 'outpatient'; msAnalog: string }
> = {
  intermediate_residential: {
    housingSetting: 'inpatient',
    msAnalog: 'Skilled nursing facility / inpatient rehabilitation facility',
  },
  intermediate_php: {
    housingSetting: 'outpatient',
    msAnalog: 'Comparable intensive outpatient / hospital outpatient M/S care',
  },
  intermediate_iop: {
    housingSetting: 'outpatient',
    msAnalog: 'Comparable intensive outpatient M/S care',
  },
};

/** Collapse a setting (including intermediate) to its housing setting. */
export function housingSetting(setting: Setting): 'inpatient' | 'outpatient' | 'emergency' | 'prescription' | 'indeterminate' {
  switch (setting) {
    case 'intermediate_residential':
      return INTERMEDIATE_ANALOG.intermediate_residential.housingSetting;
    case 'intermediate_php':
      return INTERMEDIATE_ANALOG.intermediate_php.housingSetting;
    case 'intermediate_iop':
      return INTERMEDIATE_ANALOG.intermediate_iop.housingSetting;
    case 'inpatient':
    case 'outpatient':
    case 'emergency':
    case 'prescription':
    case 'indeterminate':
      return setting;
  }
}

/** Combine a housing setting + network into one of the six classifications. */
export function toClassification(setting: Setting, network: NetworkStatus): ClassificationOrQuarantine {
  const housing = housingSetting(setting);
  switch (housing) {
    case 'emergency':
      return 'emergency_care';
    case 'prescription':
      return 'prescription_drugs';
    case 'inpatient':
      return network === 'out_of_network' ? 'inpatient_out_of_network' : 'inpatient_in_network';
    case 'outpatient':
      return network === 'out_of_network' ? 'outpatient_out_of_network' : 'outpatient_in_network';
    case 'indeterminate':
      return QUARANTINE;
  }
}
