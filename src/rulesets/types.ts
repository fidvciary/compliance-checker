/**
 * Module 1 — Versioned ruleset model.
 *
 * The regulatory ground is actively shifting (2024 final rule under federal
 * non-enforcement; 2013 rule + CAA 2021 in force; state laws independent).
 * Rulesets are therefore declarative, versioned DATA — never branching logic.
 * The engine must survive a rule change by loading a different data file, not by
 * a code rewrite. Do not hard-code the 2024 final rule anywhere.
 */

export type AuthorityType =
  | 'statute'
  | 'regulation'
  | 'subregulatory_guidance'
  | 'case_law'
  | 'enforcement_action';

/**
 * Enforcement status drives whether a finding that depends on a ruleset is
 * REQUIRED-NOW versus ADVISORY. This is the core "what is required now vs. what
 * is prudent to be ready for" distinction that the report surfaces.
 */
export type EnforcementStatus =
  | 'enforced' // currently in force and enforced (2013 rule, CAA 2021 statute, state laws)
  | 'non_enforced_federal' // e.g. 2024 final rule under the May 15 2025 non-enforcement policy
  | 'not_yet_proposed' // stub for the 2026 replacement rule
  | 'sunset'; // superseded / expired

export type AppliesTo = 'self_funded' | 'fully_insured' | 'both';

export type Jurisdiction =
  | 'federal'
  | 'CT'
  | 'MD'
  | 'WV'
  | 'IL'
  | 'NY'
  | 'CA'
  | string; // other state codes permitted

export interface RulesetProvision {
  /** Sub-identifier within a ruleset, e.g. 'substantially_all_test'. */
  id: string;
  /** Precise citation for this provision. */
  citation: string;
  /** Short human summary. Not used for any determination — description only. */
  summary: string;
  /** Optional machine tags linking provisions to engine features. */
  tags?: string[];
}

export interface Ruleset {
  /** Stable ID, e.g. 'federal:2013' or 'guidance:self-compliance-tool'. */
  id: string;
  title: string;
  authority_type: AuthorityType;
  citation: string;
  enforcement_status: EnforcementStatus;
  /** ISO date the authority took effect. */
  effective_date: string | null;
  /** ISO date the authority sunsets/was superseded, or null if still operative. */
  sunset_date: string | null;
  applies_to: AppliesTo;
  jurisdiction: Jurisdiction;
  /**
   * Free-text posture note. For the 2024 rule this carries the ERIC v. HHS
   * litigation posture and the Departments' March 30 2026 status report.
   */
  note?: string;
  provisions: RulesetProvision[];
  /** Source-file provenance for audit. */
  source_file?: string;
}

/**
 * A parsed, validated ruleset with a computed role for a given run:
 *   - 'active'   : findings depending on it are required-now
 *   - 'advisory' : findings depending only on advisory rulesets are segregated
 *                  and labeled "ADVISORY — NOT CURRENTLY FEDERALLY ENFORCED"
 */
export type RulesetRole = 'active' | 'advisory';
