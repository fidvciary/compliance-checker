/**
 * Canonical field registry.
 *
 * The engine's analysis code reads canonical field names; ingestion maps each
 * TPA's proprietary headers onto these. Each field declares which analysis
 * features it feeds so the data-availability matrix can report exactly which
 * tests are runnable and which artifact is missing for each that is not.
 */

export type CanonicalDataset =
  | 'claims'
  | 'remittance'
  | 'prior_auth'
  | 'concurrent_review'
  | 'appeals'
  | 'network'
  | 'reimbursement';

export interface CanonicalField {
  name: string;
  dataset: CanonicalDataset;
  description: string;
  required: boolean; // required for the dataset to be usable at all
  feeds: string[]; // analysis feature ids
}

export const CANONICAL_FIELDS: CanonicalField[] = [
  // --- claims ---
  { name: 'member_id_hashed', dataset: 'claims', description: 'Hashed member identifier for de-identified linkage', required: true, feeds: ['dedup', 'episode'] },
  { name: 'claim_id', dataset: 'claims', description: 'Unique claim/line identifier', required: true, feeds: ['dedup'] },
  { name: 'date_of_service', dataset: 'claims', description: 'Date of service', required: true, feeds: ['sample_period', 'classification'] },
  { name: 'place_of_service', dataset: 'claims', description: 'CMS place-of-service code', required: false, feeds: ['classification'] },
  { name: 'revenue_code', dataset: 'claims', description: 'UB-04 revenue code (facility)', required: false, feeds: ['classification'] },
  { name: 'procedure_code', dataset: 'claims', description: 'CPT/HCPCS procedure code', required: false, feeds: ['classification', 'reimbursement'] },
  { name: 'diagnosis_code', dataset: 'claims', description: 'Primary ICD-10 diagnosis code', required: true, feeds: ['classification', 'mhsud_identification'] },
  { name: 'diagnosis_code_secondary', dataset: 'claims', description: 'Secondary ICD-10 codes (comma or pipe delimited)', required: false, feeds: ['classification', 'comorbidity'] },
  { name: 'provider_npi', dataset: 'claims', description: 'Rendering provider NPI', required: false, feeds: ['classification', 'network'] },
  { name: 'provider_taxonomy', dataset: 'claims', description: 'Provider taxonomy code', required: false, feeds: ['classification', 'mhsud_identification'] },
  { name: 'network_status', dataset: 'claims', description: 'In-network vs out-of-network', required: true, feeds: ['classification', 'oon_utilization'] },
  { name: 'claim_type', dataset: 'claims', description: 'Professional vs facility', required: false, feeds: ['classification'] },
  { name: 'billed_amount', dataset: 'claims', description: 'Provider billed charge', required: false, feeds: ['reimbursement'] },
  { name: 'allowed_amount', dataset: 'claims', description: 'Plan allowed amount', required: true, feeds: ['qtl_denominator', 'reimbursement', 'cost_share'] },
  { name: 'paid_amount', dataset: 'claims', description: 'Plan paid amount (plan payment)', required: true, feeds: ['qtl_denominator', 'cost_share'] },
  { name: 'member_cost_share', dataset: 'claims', description: 'Member responsibility (copay+coins+deductible)', required: false, feeds: ['cost_share'] },
  { name: 'denied_flag', dataset: 'claims', description: 'Whether the claim/line was denied', required: true, feeds: ['denial_rate'] },
  { name: 'denial_reason_code', dataset: 'claims', description: 'Adjudication denial reason code (CARC/RARC)', required: false, feeds: ['denial_rate_by_reason'] },

  // --- remittance (835) ---
  { name: 'denial_reason_category', dataset: 'remittance', description: 'Denial reason category: administrative | medical_necessity | benefit_exclusion', required: false, feeds: ['denial_rate_by_reason'] },

  // --- prior auth log ---
  { name: 'pa_requested_flag', dataset: 'prior_auth', description: 'Service required prior authorization', required: true, feeds: ['pa_request_rate'] },
  { name: 'pa_decision', dataset: 'prior_auth', description: 'PA decision: approved | denied | partial', required: true, feeds: ['pa_approval_rate'] },
  { name: 'pa_turnaround_days', dataset: 'prior_auth', description: 'Turnaround time in days', required: false, feeds: ['pa_turnaround'] },

  // --- concurrent review ---
  { name: 'review_type', dataset: 'concurrent_review', description: 'concurrent | continued_stay', required: true, feeds: ['concurrent_review_freq'] },
  { name: 'review_interval_days', dataset: 'concurrent_review', description: 'Days between reviews', required: false, feeds: ['concurrent_review_interval'] },

  // --- appeals ---
  { name: 'appeal_level', dataset: 'appeals', description: 'internal | external', required: true, feeds: ['appeal_rate', 'overturn_rate'] },
  { name: 'appeal_outcome', dataset: 'appeals', description: 'upheld | overturned | partial', required: true, feeds: ['overturn_rate'] },

  // --- network directory ---
  { name: 'specialty', dataset: 'network', description: 'Provider specialty for network composition', required: true, feeds: ['network_composition'] },
  { name: 'accepting_new_patients', dataset: 'network', description: 'Whether accepting new patients', required: false, feeds: ['network_adequacy'] },

  // --- reimbursement / fee schedule ---
  { name: 'fee_schedule_rate', dataset: 'reimbursement', description: 'Contracted/allowed rate for the code', required: true, feeds: ['reimbursement_vs_medicare'] },
  { name: 'locality', dataset: 'reimbursement', description: 'CMS locality for Medicare benchmark', required: false, feeds: ['reimbursement_vs_medicare'] },
];

export function fieldsForDataset(dataset: CanonicalDataset): CanonicalField[] {
  return CANONICAL_FIELDS.filter((f) => f.dataset === dataset);
}

export function requiredFieldsForDataset(dataset: CanonicalDataset): CanonicalField[] {
  return fieldsForDataset(dataset).filter((f) => f.required);
}
