import type { CanonicalDataset } from './canonical-schema.js';

/**
 * Pre-built column-mapping templates for common TPAs.
 *
 * Ships Aetna ASO, UMR, and Meritain claims-extract templates. Everything else
 * falls back to the fuzzy mapping wizard (see column-mapping.ts) with a
 * persisted mapping profile per employer/TPA.
 *
 * NOTE: these header names reflect common extract layouts and are a STARTING
 * POINT; a given employer's file may differ. The wizard reconciles differences
 * and the resulting profile is persisted so the next file maps automatically.
 */

export interface TpaTemplate {
  tpa: string;
  dataset: CanonicalDataset;
  /** canonicalField -> source header in this TPA's extract */
  map: Record<string, string>;
}

export const TPA_TEMPLATES: TpaTemplate[] = [
  {
    tpa: 'aetna_aso',
    dataset: 'claims',
    map: {
      member_id_hashed: 'MEMBER_HASH_ID',
      claim_id: 'CLAIM_ID',
      date_of_service: 'SERVICE_DT',
      place_of_service: 'POS_CD',
      revenue_code: 'REV_CD',
      procedure_code: 'PROC_CD',
      diagnosis_code: 'DIAG_1_CD',
      diagnosis_code_secondary: 'DIAG_2_CD',
      provider_npi: 'RENDERING_NPI',
      provider_taxonomy: 'PROV_TAXONOMY',
      network_status: 'NTWK_IND',
      claim_type: 'CLAIM_TYPE',
      billed_amount: 'BILLED_AMT',
      allowed_amount: 'ALLOWED_AMT',
      paid_amount: 'PLAN_PAID_AMT',
      member_cost_share: 'MBR_RESP_AMT',
      denied_flag: 'DENIED_IND',
      denial_reason_code: 'DENIAL_CD',
    },
  },
  {
    tpa: 'umr',
    dataset: 'claims',
    map: {
      member_id_hashed: 'MemberIDHash',
      claim_id: 'ClaimNumber',
      date_of_service: 'DateOfService',
      place_of_service: 'PlaceOfService',
      revenue_code: 'RevenueCode',
      procedure_code: 'ProcedureCode',
      diagnosis_code: 'PrimaryDiagnosis',
      diagnosis_code_secondary: 'OtherDiagnoses',
      provider_npi: 'ProviderNPI',
      provider_taxonomy: 'TaxonomyCode',
      network_status: 'NetworkIndicator',
      claim_type: 'ClaimFormType',
      billed_amount: 'ChargeAmount',
      allowed_amount: 'AllowedAmount',
      paid_amount: 'PaidAmount',
      member_cost_share: 'MemberLiability',
      denied_flag: 'DenialFlag',
      denial_reason_code: 'DenialReasonCode',
    },
  },
  {
    tpa: 'meritain',
    dataset: 'claims',
    map: {
      member_id_hashed: 'MBR_ID_HASH',
      claim_id: 'CLM_NBR',
      date_of_service: 'DOS',
      place_of_service: 'POS',
      revenue_code: 'REV',
      procedure_code: 'CPT_HCPCS',
      diagnosis_code: 'ICD_PRIMARY',
      diagnosis_code_secondary: 'ICD_OTHER',
      provider_npi: 'NPI',
      provider_taxonomy: 'TAXONOMY',
      network_status: 'INN_OON',
      claim_type: 'FORM_TYPE',
      billed_amount: 'CHARGE',
      allowed_amount: 'ALLOWED',
      paid_amount: 'PAID',
      member_cost_share: 'MEMBER_PAY',
      denied_flag: 'DENY_FLAG',
      denial_reason_code: 'DENY_REASON',
    },
  },
];

export function templatesFor(tpa: string, dataset?: CanonicalDataset): TpaTemplate[] {
  return TPA_TEMPLATES.filter(
    (t) => t.tpa === tpa && (dataset === undefined || t.dataset === dataset),
  );
}

export function knownTpas(): string[] {
  return [...new Set(TPA_TEMPLATES.map((t) => t.tpa))];
}
