import type { BenefitType } from './classifications.js';

/**
 * MH/SUD identification.
 *
 * Determines whether a claim is Mental Health / Substance Use Disorder or
 * Medical/Surgical, from ICD-10 F-chapter diagnoses, MH/SUD-specific procedure
 * codes (psychotherapy, HCPCS H-codes), and provider taxonomy. Includes an
 * EXPLICIT, DOCUMENTED comorbidity tie-break that is surfaced in the methodology
 * appendix (Non-negotiable: the tie-break rule must be stated).
 */

// ICD-10 F-chapter. F10-F19 are SUD; F20-F99 are mental/behavioral.
// NOTE: F01-F09 are mental disorders due to known physiological conditions
// (e.g., vascular dementia). These are frequently adjudicated as neurological/
// medical rather than MH/SUD. We treat them as AMBIGUOUS and do not auto-assign
// them to MH/SUD; this nuance is documented in the methodology appendix.
const SUD_DX_RE = /^F1[0-9]/i;
const MH_DX_RE = /^F([2-9][0-9])/i;
const AMBIGUOUS_NEUROCOGNITIVE_DX_RE = /^F0[0-9]/i;

// MH/SUD-specific procedure codes.
const MHSUD_PROC_RE =
  /^(9078[5-9]|9079[0-2]|90832|90833|90834|90836|90837|90838|90839|90840|90845|90846|90847|90849|90853|9086[0-9]|9088[0-9]|9089[0-9]|9613[0-9]|H\d{4}|9084[0-9]|8030[0-9]|8035[0-9]|8037[0-7])/i;

// NUCC provider taxonomy prefixes for behavioral health providers.
// 101/102/103/104/106 = behavioral health & social service; 2084P = psychiatry;
// 261QM = mental health clinic; 3245 = SUD rehab facility; 320/322/323/324 = BH facilities.
const MHSUD_TAXONOMY_RE = /^(10[1-4]Y|106H|103T|103G|104100|2084P|261QM|3245|322[0-9]|323[0-9]|324[0-9]|320[0-9])/i;

export interface DiagnosisInput {
  primary?: string;
  secondary?: string[]; // may be comma/pipe delimited upstream; pass as array
}

export interface MhsudDetermination {
  benefitType: BenefitType;
  /** Which signal was decisive, for audit + methodology transparency. */
  basis: string;
  /** True when primary dx is non-MH but a secondary MH/SUD dx is present. */
  comorbidity: boolean;
  signals: {
    primaryIsMhsud: boolean;
    primaryIsAmbiguousNeurocognitive: boolean;
    secondaryHasMhsud: boolean;
    procedureIsMhsud: boolean;
    taxonomyIsMhsud: boolean;
  };
}

export function isMhsudDiagnosis(code: string | undefined): boolean {
  if (!code) return false;
  const c = code.trim();
  return SUD_DX_RE.test(c) || MH_DX_RE.test(c);
}

export function isMhsudProcedure(code: string | undefined): boolean {
  if (!code) return false;
  return MHSUD_PROC_RE.test(code.trim());
}

export function isMhsudTaxonomy(code: string | undefined): boolean {
  if (!code) return false;
  return MHSUD_TAXONOMY_RE.test(code.trim());
}

/**
 * COMORBIDITY TIE-BREAK (documented, deterministic).
 *
 * Precedence, most-decisive first:
 *   1. An MH/SUD-SPECIFIC procedure code (psychotherapy, H-code, psych testing)
 *      → MH/SUD. The service itself is behavioral regardless of diagnosis.
 *   2. A behavioral-health provider taxonomy → MH/SUD.
 *   3. Primary diagnosis in the MH/SUD range (F10-F99) → MH/SUD.
 *   4. Primary diagnosis medical, but a SECONDARY diagnosis is MH/SUD
 *      (the comorbidity case) → M/S. The PRIMARY diagnosis governs the claim's
 *      classification; the comorbidity is flagged for transparency but does not
 *      flip a medical service to MH/SUD. This prevents both over- and
 *      under-counting MH/SUD utilization.
 *   5. Otherwise → M/S.
 *
 * Ambiguous F01-F09 neurocognitive codes do NOT by themselves establish MH/SUD.
 */
export function determineBenefitType(input: {
  diagnosis: DiagnosisInput;
  procedureCode?: string;
  providerTaxonomy?: string;
}): MhsudDetermination {
  const primary = input.diagnosis.primary?.trim();
  const secondary = (input.diagnosis.secondary ?? []).map((s) => s.trim()).filter(Boolean);

  const primaryIsMhsud = isMhsudDiagnosis(primary);
  const primaryIsAmbiguousNeurocognitive = !!primary && AMBIGUOUS_NEUROCOGNITIVE_DX_RE.test(primary);
  const secondaryHasMhsud = secondary.some((s) => isMhsudDiagnosis(s));
  const procedureIsMhsud = isMhsudProcedure(input.procedureCode);
  const taxonomyIsMhsud = isMhsudTaxonomy(input.providerTaxonomy);

  const signals = {
    primaryIsMhsud,
    primaryIsAmbiguousNeurocognitive,
    secondaryHasMhsud,
    procedureIsMhsud,
    taxonomyIsMhsud,
  };

  const comorbidity = !primaryIsMhsud && secondaryHasMhsud;

  if (procedureIsMhsud) {
    return { benefitType: 'MHSUD', basis: 'MH/SUD-specific procedure code (decisive)', comorbidity, signals };
  }
  if (taxonomyIsMhsud) {
    return { benefitType: 'MHSUD', basis: 'behavioral-health provider taxonomy', comorbidity, signals };
  }
  if (primaryIsMhsud) {
    return { benefitType: 'MHSUD', basis: 'primary diagnosis in F10-F99', comorbidity, signals };
  }
  if (comorbidity) {
    return {
      benefitType: 'MS',
      basis: 'primary diagnosis is medical; MH/SUD present only as comorbidity — primary governs',
      comorbidity: true,
      signals,
    };
  }
  if (!primary && !input.procedureCode && !input.providerTaxonomy) {
    return { benefitType: 'indeterminate', basis: 'no diagnosis, procedure, or taxonomy available', comorbidity, signals };
  }
  return { benefitType: 'MS', basis: 'no MH/SUD signal (medical/surgical)', comorbidity, signals };
}
