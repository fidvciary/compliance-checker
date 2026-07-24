import { evaluateExpression, type PredicateEval } from './expression.js';

/**
 * Structured plan facts the case-law detection predicates read.
 *
 * These are populated from structured plan inputs and (where unstructured) from
 * LLM-extracted candidate passages that a human confirms. The predicates below
 * are DETERMINISTIC code; an LLM never decides whether a rule fired.
 */
export interface PlanFacts {
  // Medical necessity criteria (MH/SUD)
  mhsudCriteriaSource?: 'proprietary' | 'nationally_recognized' | 'state_mandated' | 'unknown';
  /** Standards the MH/SUD criteria align with (e.g., ASAM, LOCUS, CALOCUS, AACAP, MCG, InterQual). */
  mhsudCriteriaStandards?: string[];
  /** Framing tags extracted from the criteria (e.g., 'acute_stabilization', 'chronic_condition', 'lowest_level_default'). */
  criteriaFraming?: string[];
  /** Criteria the applicable state mandates (e.g., ASAM for SUD). */
  stateMandatedCriteria?: string[];

  // Internal process
  distinctInternalProcessMhsudOnly?: boolean; // a distinct review process applied to MH/SUD but not M/S
  algorithmicTriageMhsud?: boolean; // automated outlier/utilization triage routing MH/SUD to heightened review

  // Reimbursement
  oonRateReductionMhsudOnly?: boolean; // reduction factor on OON MH/SUD rates not applied to M/S
  reimbursementMethodologyNonComparable?: boolean;

  // Residential / room & board
  excludesRoomAndBoardResidential?: boolean;
  coversRoomAndBoardSnf?: boolean;
  categoricalResidentialExclusion?: boolean;
  residentialDayLimit?: boolean;

  // Treatment-specific exclusions
  wildernessExclusion?: boolean;
  abaExclusion?: boolean;

  // Provider / facility
  excludedLicensures?: string[]; // e.g., ['LMFT','LPC','LCSW']
  facilityLicensureUnobtainable?: boolean;
  geographicRestriction?: boolean;

  // Vendor structure
  dualUmVendor?: boolean;
}

type Predicate = (facts: PlanFacts, args: string[]) => boolean;

const intersects = (a: string[] | undefined, b: string[]): boolean =>
  (a ?? []).some((x) => b.map((y) => y.toUpperCase()).includes(x.toUpperCase()));

export const PREDICATES: Record<string, Predicate> = {
  criteria_source_is_proprietary: (f) => f.mhsudCriteriaSource === 'proprietary',
  aligns_with: (f, args) => intersects(f.mhsudCriteriaStandards, args),
  contains_acute_stabilization_framing: (f) => (f.criteriaFraming ?? []).includes('acute_stabilization'),
  contains_chronic_condition_framing: (f) => (f.criteriaFraming ?? []).includes('chronic_condition'),
  contains_lowest_effective_level_of_care_default: (f) => (f.criteriaFraming ?? []).includes('lowest_level_default'),
  state_mandates_criteria: (f, args) =>
    args.length === 0 ? (f.stateMandatedCriteria ?? []).length > 0 : intersects(f.stateMandatedCriteria, args),
  applies_state_mandated_criteria: (f) =>
    intersects(f.mhsudCriteriaStandards, f.stateMandatedCriteria ?? []),
  distinct_internal_process_mhsud_only: (f) => f.distinctInternalProcessMhsudOnly === true,
  algorithmic_triage_present: (f) => f.algorithmicTriageMhsud === true,
  oon_rate_reduction_mhsud_only: (f) => f.oonRateReductionMhsudOnly === true,
  reimbursement_methodology_noncomparable: (f) => f.reimbursementMethodologyNonComparable === true,
  excludes_room_and_board_residential: (f) => f.excludesRoomAndBoardResidential === true,
  covers_room_and_board_snf: (f) => f.coversRoomAndBoardSnf === true,
  categorical_residential_exclusion: (f) => f.categoricalResidentialExclusion === true,
  residential_day_limit_present: (f) => f.residentialDayLimit === true,
  wilderness_exclusion_present: (f) => f.wildernessExclusion === true,
  aba_exclusion_present: (f) => f.abaExclusion === true,
  excludes_licensed_professionals: (f, args) => intersects(f.excludedLicensures, args),
  facility_licensure_unobtainable: (f) => f.facilityLicensureUnobtainable === true,
  geographic_restriction_present: (f) => f.geographicRestriction === true,
  dual_um_vendor: (f) => f.dualUmVendor === true,
};

/** Evaluate one detection test expression against plan facts. */
export function evalDetection(expression: string, facts: PlanFacts): boolean {
  const evalPredicate: PredicateEval = (name, args) => {
    const p = PREDICATES[name];
    if (!p) {
      throw new Error(
        `Unknown case-law detection predicate '${name}'. Register it in predicates.ts before use — ` +
          `detection must be deterministic code, not free interpretation.`,
      );
    }
    return p(facts, args);
  };
  return evaluateExpression(expression, evalPredicate);
}
