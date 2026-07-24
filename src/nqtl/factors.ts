/**
 * DOL standardized factor list and evidentiary-source list (Self-Compliance Tool),
 * plus the symmetry cross-check.
 *
 * For Steps 2 and 3 of the six-step analysis the engine presents these
 * standardized lists. The single most frequently cited failure in DOL and state
 * exam reports is asymmetry: a factor or evidentiary source used on one side
 * (M/S or MH/SUD) but not the other, or the same factor defined/applied
 * differently. Any such asymmetry is an automatic finding.
 */

export const DOL_FACTORS = [
  'excessive_utilization',
  'recent_medical_cost_escalation',
  'provider_discretion_in_diagnosis_or_treatment',
  'lack_of_clinical_efficacy',
  'high_variability_in_cost_per_episode',
  'high_variation_in_length_of_stay',
  'lack_of_adherence_to_quality_standards',
  'high_fraud_incidence',
  'current_and_projected_demand',
] as const;
export type DolFactor = (typeof DOL_FACTORS)[number];

export const EVIDENTIARY_SOURCES = [
  'internal_claims_analysis',
  'medical_expert_review',
  'state_or_federal_requirements',
  'national_accreditation_standards',
  'internal_market_and_competitive_analysis',
  'medicare_fee_schedules',
  'published_clinical_standards', // e.g., ASAM, ICSI
] as const;
export type EvidentiarySource = (typeof EVIDENTIARY_SOURCES)[number];

/** How a factor is defined/operationalized on one side (e.g., its threshold). */
export interface FactorUsage {
  factor: string;
  /** Free-text definition/threshold as applied (e.g., ">$X per episode", ">N days"). */
  definition: string;
}

export interface SideProfile {
  side: 'MS' | 'MHSUD';
  factors: FactorUsage[];
  evidentiarySources: string[];
}

export type FactorAsymmetryType =
  | 'factor_only_on_mhsud'
  | 'factor_only_on_ms'
  | 'factor_defined_differently'
  | 'source_only_on_mhsud'
  | 'source_only_on_ms';

export interface FactorAsymmetry {
  type: FactorAsymmetryType;
  item: string;
  detail: string;
}

/**
 * Cross-check the factor set and source set used for MH/SUD against M/S for a
 * single NQTL × classification. Returns every asymmetry (each is an automatic
 * finding). Comparing across classifications is prohibited — callers pass one
 * classification's profiles.
 */
export function crossCheckFactorSymmetry(ms: SideProfile, mhsud: SideProfile): FactorAsymmetry[] {
  const out: FactorAsymmetry[] = [];

  const msFactors = new Map(ms.factors.map((f) => [f.factor, f.definition]));
  const mhFactors = new Map(mhsud.factors.map((f) => [f.factor, f.definition]));

  for (const [factor, def] of mhFactors) {
    if (!msFactors.has(factor)) {
      out.push({ type: 'factor_only_on_mhsud', item: factor, detail: `Factor '${factor}' is used for MH/SUD but not for M/S in this classification.` });
    } else if (msFactors.get(factor) !== def) {
      out.push({
        type: 'factor_defined_differently',
        item: factor,
        detail: `Factor '${factor}' is defined/applied differently: M/S = "${msFactors.get(factor)}"; MH/SUD = "${def}".`,
      });
    }
  }
  for (const factor of msFactors.keys()) {
    if (!mhFactors.has(factor)) {
      out.push({ type: 'factor_only_on_ms', item: factor, detail: `Factor '${factor}' is used for M/S but not for MH/SUD in this classification.` });
    }
  }

  const msSources = new Set(ms.evidentiarySources);
  const mhSources = new Set(mhsud.evidentiarySources);
  for (const s of mhSources) if (!msSources.has(s)) out.push({ type: 'source_only_on_mhsud', item: s, detail: `Evidentiary source '${s}' is used for MH/SUD but not for M/S.` });
  for (const s of msSources) if (!mhSources.has(s)) out.push({ type: 'source_only_on_ms', item: s, detail: `Evidentiary source '${s}' is used for M/S but not for MH/SUD.` });

  return out;
}
