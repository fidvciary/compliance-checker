import type { Setting } from './classifications.js';

/**
 * Deterministic code → setting mapping tables. NOT LLM inference.
 *
 * Sources: CMS Place of Service code set; NUBC revenue codes; HCPCS/CPT.
 * This table is MAINTAINED — codes change annually and this seed covers the
 * high-frequency, well-established mappings. Anything not matched here is
 * QUARANTINED for manual review, never silently bucketed. Entries that warrant
 * SME re-verification are noted; unknown codes must fall through to quarantine.
 */

// ---- CMS Place of Service (POS) codes → setting ----
export const POS_TO_SETTING: Record<string, Setting> = {
  '21': 'inpatient', // Inpatient Hospital
  '51': 'inpatient', // Inpatient Psychiatric Facility
  '61': 'inpatient', // Comprehensive Inpatient Rehabilitation Facility
  '31': 'inpatient', // Skilled Nursing Facility (M/S analog for residential)
  '55': 'intermediate_residential', // Residential Substance Abuse Treatment Facility
  '56': 'intermediate_residential', // Psychiatric Residential Treatment Center
  '52': 'intermediate_php', // Psychiatric Facility - Partial Hospitalization
  '11': 'outpatient', // Office
  '49': 'outpatient', // Independent Clinic
  '50': 'outpatient', // Federally Qualified Health Center
  '71': 'outpatient', // State/local public health clinic
  '72': 'outpatient', // Rural Health Clinic
  '19': 'outpatient', // Off Campus - Outpatient Hospital
  '22': 'outpatient', // On Campus - Outpatient Hospital
  '53': 'outpatient', // Community Mental Health Center
  '57': 'outpatient', // Non-residential Substance Abuse Treatment Facility
  '58': 'outpatient', // Non-residential Opioid Treatment Facility
  '02': 'outpatient', // Telehealth (provided other than in patient's home)
  '10': 'outpatient', // Telehealth (in patient's home)
  '20': 'outpatient', // Urgent Care Facility
  '23': 'emergency', // Emergency Room - Hospital
};

// ---- NUBC revenue code (facility) → setting ----
// Matched by 4-digit code; ranges expressed as predicates below.
export interface RevenueRule {
  test: (code: string) => boolean;
  setting: Setting;
  note: string;
}
export const REVENUE_RULES: RevenueRule[] = [
  { test: (c) => /^01[0-9]{2}$/.test(c), setting: 'inpatient', note: 'Room & board (0100-0219)' },
  { test: (c) => /^02(0[0-9]|1[0-9])$/.test(c), setting: 'inpatient', note: 'Room & board / ICU (0200-0219)' },
  { test: (c) => /^045[0-9]$/.test(c), setting: 'emergency', note: 'Emergency room (0450-0459)' },
  { test: (c) => /^0762$/.test(c), setting: 'outpatient', note: 'Observation' },
  { test: (c) => c === '0912' || c === '0913', setting: 'intermediate_php', note: 'Partial hospitalization (0912-0913)' },
  { test: (c) => c === '0905' || c === '0906', setting: 'intermediate_iop', note: 'Intensive outpatient psych / chemical dependency (0905-0906)' },
  { test: (c) => c === '1002', setting: 'intermediate_residential', note: 'Residential treatment - psychiatric (1002)' },
  { test: (c) => c === '1001', setting: 'intermediate_residential', note: 'Residential treatment - chemical dependency (1001)' },
  { test: (c) => /^090[0-4]$/.test(c) || c === '0914' || c === '0915' || c === '0916' || c === '0917' || c === '0919', setting: 'outpatient', note: 'Behavioral health treatment/services - outpatient' },
  { test: (c) => /^051[0-9]$/.test(c), setting: 'outpatient', note: 'Clinic (0510-0519)' },
];

// ---- CPT / HCPCS procedure code → setting hint ----
export interface ProcedureRule {
  test: (code: string) => boolean;
  setting: Setting;
  note: string;
}

const inRange = (code: string, lo: number, hi: number): boolean => {
  const m = /^(\d{4,5})/.exec(code);
  if (!m) return false;
  const n = Number(m[1]);
  return n >= lo && n <= hi;
};

export const PROCEDURE_RULES: ProcedureRule[] = [
  // Emergency department E&M
  { test: (c) => inRange(c, 99281, 99285), setting: 'emergency', note: 'ED E&M (99281-99285)' },
  // Inpatient / observation E&M
  { test: (c) => inRange(c, 99221, 99239), setting: 'inpatient', note: 'Inpatient hospital E&M (99221-99239)' },
  { test: (c) => inRange(c, 99251, 99255), setting: 'inpatient', note: 'Inpatient consultation (99251-99255)' },
  // Office / outpatient E&M
  { test: (c) => inRange(c, 99202, 99215), setting: 'outpatient', note: 'Office/outpatient E&M (99202-99215)' },
  // Psychotherapy & psychiatry (outpatient MH by default)
  { test: (c) => inRange(c, 90832, 90899), setting: 'outpatient', note: 'Psychiatry / psychotherapy (90832-90899)' },
  { test: (c) => inRange(c, 90785, 90792), setting: 'outpatient', note: 'Psychiatric diagnostic / interactive (90785-90792)' },
  { test: (c) => inRange(c, 96130, 96139), setting: 'outpatient', note: 'Psychological / neuropsych testing (96130-96139)' },
  // HCPCS H-codes: behavioral health services — setting depends on the specific code
  { test: (c) => /^H0017$/i.test(c) || /^H0018$/i.test(c) || /^H0019$/i.test(c), setting: 'intermediate_residential', note: 'Behavioral health residential (H0017-H0019)' },
  { test: (c) => /^H0035$/i.test(c) || /^S0201$/i.test(c), setting: 'intermediate_php', note: 'Partial hospitalization (H0035, S0201)' },
  { test: (c) => /^H0015$/i.test(c) || /^S9480$/i.test(c) || /^H2036$/i.test(c), setting: 'intermediate_iop', note: 'Intensive outpatient program (H0015, S9480, H2036)' },
  { test: (c) => /^H(00[0-9]{2}|1[0-9]{3}|2[0-9]{3})$/i.test(c), setting: 'outpatient', note: 'Other HCPCS H-code behavioral health (outpatient default)' },
];

/** Resolve a setting from POS, revenue code, and procedure code in that order. */
export function settingFromCodes(input: {
  placeOfService?: string;
  revenueCode?: string;
  procedureCode?: string;
}): { setting: Setting; basis: string } {
  const pos = input.placeOfService?.trim();
  if (pos && POS_TO_SETTING[pos]) {
    return { setting: POS_TO_SETTING[pos]!, basis: `POS ${pos}` };
  }
  const rev = input.revenueCode?.trim();
  if (rev) {
    for (const rule of REVENUE_RULES) {
      if (rule.test(rev)) return { setting: rule.setting, basis: `revenue code ${rev} (${rule.note})` };
    }
  }
  const proc = input.procedureCode?.trim();
  if (proc) {
    for (const rule of PROCEDURE_RULES) {
      if (rule.test(proc)) return { setting: rule.setting, basis: `procedure ${proc} (${rule.note})` };
    }
  }
  return { setting: 'indeterminate', basis: 'no POS/revenue/procedure code matched a maintained mapping' };
}
