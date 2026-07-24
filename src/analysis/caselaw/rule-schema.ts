/**
 * Module 9/10 — Case-law and enforcement rule pack schema.
 *
 * Versioned YAML, one file per authority. THE ACTIVATION GATE IS THE POINT OF
 * THIS MODULE: a rule does not fire until `active: true`, and `active` may only
 * be true when BOTH `verified_by` and `verified_date` are populated. The loader
 * enforces this. The pack ships with everything inactive so an attorney
 * verification pass is forced before first customer use.
 */

export type CaselawAuthorityType = 'case_law' | 'enforcement_action' | 'regulator_finding';

export type PrecedentialWeight =
  | 'binding_circuit'
  | 'persuasive_district'
  | 'settlement'
  | 'regulator_finding'
  | 'binding_scotus'
  | 'persuasive_circuit';

export type CaselawScope = 'as_written' | 'in_operation' | 'both';

export interface CaselawDetection {
  target: string;
  /** Boolean expression over registered predicates (predicates.ts). */
  test: string;
}

export interface CaselawRule {
  id: string;
  authority_type: CaselawAuthorityType;
  case_name: string;
  citation: string;
  jurisdiction: string;
  precedential_weight: PrecedentialWeight;
  theory: string;
  scope: CaselawScope;
  detection: CaselawDetection[];
  /** All detection tests must pass ('all') or any ('any'). Default 'all'. */
  detection_mode?: 'all' | 'any';
  finding_template: string;
  remediation_prompt: string;
  verified_by: string | null; // attorney initials/id
  verified_date: string | null; // ISO date
  /** INACTIVE until attorney-verified. The loader refuses active:true without verification. */
  active: boolean;
  /** Optional posture/caveat notes surfaced in the report (e.g., ASO vs fully-insured open questions). */
  note?: string;
  source_file?: string;
}

export class CaselawActivationError extends Error {
  constructor(ruleId: string, reason: string) {
    super(`Case-law rule '${ruleId}' failed the activation gate: ${reason}`);
    this.name = 'CaselawActivationError';
  }
}

/**
 * Validate the activation invariant. Called by the loader for every rule.
 * A rule may be `active: true` ONLY if verified_by and verified_date are set.
 * (An inactive rule may have verification fields null — that is the ship state.)
 */
export function assertActivationInvariant(rule: CaselawRule): void {
  if (rule.active) {
    if (!rule.verified_by || !rule.verified_date) {
      throw new CaselawActivationError(
        rule.id,
        'active:true requires both verified_by and verified_date to be populated. ' +
          'Rules must be attorney-verified before they can fire.',
      );
    }
    if (Number.isNaN(Date.parse(rule.verified_date))) {
      throw new CaselawActivationError(rule.id, `verified_date '${rule.verified_date}' is not a valid date.`);
    }
  }
}
