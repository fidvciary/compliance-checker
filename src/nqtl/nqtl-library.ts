import type { Classification } from '../classification/classifications.js';
import { CLASSIFICATIONS } from '../classification/classifications.js';

/**
 * Module 6 — NQTL inventory.
 *
 * The library of nonquantitative treatment limitations the engine reasons about.
 * `set` selects the analysis scope: 'core' is the high-frequency, high-value
 * subset; 'full' is everything (`--nqtl-set core | full | <custom path>`).
 */

export type NqtlSet = 'core' | 'full';

export interface NqtlDefinition {
  id: string;
  name: string;
  /** DOL Warning-Signs category, when the NQTL maps to one. */
  warningSignCategory?: 'I' | 'II' | 'III' | 'IV' | 'V';
  set: NqtlSet;
  /** Classifications the NQTL is typically applicable to (default: all six). */
  applicableClassifications: Classification[];
  description: string;
  /** Optional treatment-specific subtypes (e.g., wilderness, ABA, OTP, ketamine, TMS). */
  subtypes?: string[];
}

const ALL: Classification[] = [...CLASSIFICATIONS];
const INPATIENT_OUTPATIENT: Classification[] = [
  'inpatient_in_network',
  'inpatient_out_of_network',
  'outpatient_in_network',
  'outpatient_out_of_network',
];
const OON: Classification[] = ['inpatient_out_of_network', 'outpatient_out_of_network'];

export const NQTL_LIBRARY: NqtlDefinition[] = [
  { id: 'prior_authorization', name: 'Prior authorization / pre-service notification', warningSignCategory: 'I', set: 'core', applicableClassifications: ALL, description: 'Requirement to obtain approval before a service is rendered.' },
  { id: 'concurrent_review', name: 'Concurrent / continued-stay review', warningSignCategory: 'I', set: 'core', applicableClassifications: INPATIENT_OUTPATIENT, description: 'Ongoing review of medical necessity during an episode of care.' },
  { id: 'retrospective_review', name: 'Retrospective review', set: 'full', applicableClassifications: ALL, description: 'Post-service review of medical necessity or coding.' },
  { id: 'medical_necessity_criteria', name: 'Medical necessity criteria', warningSignCategory: 'I', set: 'core', applicableClassifications: ALL, description: 'The clinical criteria set used to determine medical necessity.' },
  { id: 'step_therapy', name: 'Step therapy / fail-first', warningSignCategory: 'II', set: 'core', applicableClassifications: ALL, description: 'Requirement to try/fail a lower level of care or therapy before authorizing another.' },
  { id: 'experimental_investigational_exclusion', name: 'Experimental / investigational exclusion', set: 'core', applicableClassifications: ALL, description: 'Exclusion of services deemed experimental or investigational.' },
  { id: 'written_treatment_plan', name: 'Written treatment plan requirement', warningSignCategory: 'IV', set: 'full', applicableClassifications: INPATIENT_OUTPATIENT, description: 'Requirement to submit and periodically resubmit a written treatment plan.' },
  { id: 'probability_of_improvement', name: 'Probability-of-improvement requirement', warningSignCategory: 'III', set: 'full', applicableClassifications: INPATIENT_OUTPATIENT, description: 'Requirement of measurable improvement or likelihood of improvement to continue coverage.' },
  { id: 'network_admission_standards', name: 'Network admission / credentialing standards', set: 'core', applicableClassifications: INPATIENT_OUTPATIENT, description: 'Standards for admitting providers to the network.' },
  { id: 'network_adequacy_standards', name: 'Network adequacy standards', set: 'full', applicableClassifications: INPATIENT_OUTPATIENT, description: 'Standards for network sufficiency (time/distance, provider counts).' },
  { id: 'provider_reimbursement_methodology', name: 'Provider reimbursement methodology', set: 'core', applicableClassifications: INPATIENT_OUTPATIENT, description: 'Methodology used to set in-network provider reimbursement rates.' },
  { id: 'oon_reimbursement_methodology', name: 'Out-of-network reimbursement (UCR) methodology', set: 'core', applicableClassifications: OON, description: 'Method for determining usual/customary/reasonable out-of-network rates.' },
  { id: 'facility_type_loc_restriction', name: 'Facility-type / level-of-care restriction', set: 'full', applicableClassifications: INPATIENT_OUTPATIENT, description: 'Restrictions on facility types or levels of care covered.' },
  { id: 'geographic_restriction', name: 'Geographic restriction', warningSignCategory: 'V', set: 'full', applicableClassifications: ALL, description: 'Restriction of care to in-state or in-region facilities.' },
  { id: 'provider_licensure_restriction', name: 'Provider licensure / credential restriction', warningSignCategory: 'V', set: 'core', applicableClassifications: INPATIENT_OUTPATIENT, description: 'Restrictions on which licensed professionals may deliver covered services.' },
  {
    id: 'treatment_specific_exclusion',
    name: 'Treatment-specific exclusion',
    set: 'full',
    applicableClassifications: ALL,
    description: 'Exclusion or limitation of specific MH/SUD treatments.',
    subtypes: ['wilderness_outdoor_behavioral', 'applied_behavior_analysis', 'methadone_otp', 'ketamine', 'tms'],
  },
  { id: 'patient_noncompliance_exclusion', name: 'Patient non-compliance exclusion', warningSignCategory: 'V', set: 'full', applicableClassifications: ALL, description: 'Exclusion triggered by patient non-adherence.' },
];

export function nqtlsForSet(set: NqtlSet): NqtlDefinition[] {
  if (set === 'full') return NQTL_LIBRARY.slice();
  return NQTL_LIBRARY.filter((n) => n.set === 'core');
}

export function getNqtl(id: string): NqtlDefinition | undefined {
  return NQTL_LIBRARY.find((n) => n.id === id);
}
