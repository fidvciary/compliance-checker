import {
  WARNING_SIGN_RULES,
  MHSUD_TERMS,
  APPLIES_TO_BOTH,
  type WarningSignRule,
  type WarningSignCategory,
} from './nqtl-warning-signs.js';
import type { AuditLog } from '../audit/audit-log.js';

/**
 * Module 7a — Warning-sign scanner engine.
 *
 * Applies the deterministic rule table to candidate passages extracted from plan
 * documents. The report quotes plan language verbatim with an anchor; the rule
 * match (not any LLM) determines the category.
 */

export interface CandidatePassage {
  documentId: string;
  page?: number;
  section?: string;
  /** Verbatim plan language. */
  text: string;
}

export interface WarningSignHit {
  ruleId: string;
  category: WarningSignCategory;
  ruleName: string;
  passage: CandidatePassage;
  matchedPattern: string;
  mode: WarningSignRule['mode'];
  citation: string;
  authorityRefs: string[];
  rationale: string;
}

function ruleFires(rule: WarningSignRule, text: string): { fired: boolean; pattern?: string } {
  const matched = rule.patterns.find((p) => p.test(text));
  if (!matched) return { fired: false };

  if (rule.mode === 'intrinsic') {
    return { fired: true, pattern: matched.source };
  }
  // mhsud_scoped: must mention MH/SUD and must NOT indicate parallel M/S application.
  const mentionsMhsud = MHSUD_TERMS.test(text);
  const appliesToBoth = APPLIES_TO_BOTH.test(text);
  if (mentionsMhsud && !appliesToBoth) {
    return { fired: true, pattern: matched.source };
  }
  return { fired: false };
}

export function scanPassages(passages: CandidatePassage[], audit?: AuditLog): WarningSignHit[] {
  const hits: WarningSignHit[] = [];
  for (const passage of passages) {
    for (const rule of WARNING_SIGN_RULES) {
      const { fired, pattern } = ruleFires(rule, passage.text);
      if (fired) {
        const hit: WarningSignHit = {
          ruleId: rule.id,
          category: rule.category,
          ruleName: rule.name,
          passage,
          matchedPattern: pattern ?? '',
          mode: rule.mode,
          citation: rule.citation,
          authorityRefs: ['guidance:warning-signs'],
          rationale: rule.rationale,
        };
        hits.push(hit);
        audit?.append('warning_sign.matched', 'engine', {
          ruleId: rule.id,
          category: rule.category,
          documentId: passage.documentId,
          page: passage.page,
          section: passage.section,
        });
      }
    }
  }
  return hits;
}

// ---------------- Dual-administrator detector (structural) ----------------

export interface VendorAssignment {
  /** e.g. 'utilization_management', 'medical_necessity_criteria', 'prior_auth'. */
  function: string;
  msVendor: string;
  mhsudVendor: string;
  msCriteriaSet?: string;
  mhsudCriteriaSet?: string;
}

export interface DualAdministratorFinding {
  function: string;
  type: 'different_vendor' | 'different_criteria';
  detail: string;
  authorityRefs: string[];
}

/**
 * If the vendor map shows a different entity performing UM for M/S vs. MH/SUD, or
 * a different medical-necessity criteria set, emit a structural finding. Named
 * DOL warning sign (Category I) and a recurring litigation fact pattern.
 */
export function detectDualAdministrator(assignments: VendorAssignment[]): DualAdministratorFinding[] {
  const out: DualAdministratorFinding[] = [];
  for (const a of assignments) {
    if (a.msVendor.trim() && a.mhsudVendor.trim() && a.msVendor.trim() !== a.mhsudVendor.trim()) {
      out.push({
        function: a.function,
        type: 'different_vendor',
        detail: `${a.function}: M/S is administered by "${a.msVendor}" while MH/SUD is administered by "${a.mhsudVendor}". A separate MH/SUD administrator is a named warning sign and a recurring litigation fact pattern; investigate whether the processes, strategies, and criteria are comparable and applied no more stringently.`,
        authorityRefs: ['guidance:warning-signs'],
      });
    }
    if (a.msCriteriaSet && a.mhsudCriteriaSet && a.msCriteriaSet.trim() !== a.mhsudCriteriaSet.trim()) {
      out.push({
        function: a.function,
        type: 'different_criteria',
        detail: `${a.function}: M/S uses criteria set "${a.msCriteriaSet}" while MH/SUD uses "${a.mhsudCriteriaSet}". Different medical-necessity criteria sets for MH/SUD warrant comparative review.`,
        authorityRefs: ['guidance:warning-signs'],
      });
    }
  }
  return out;
}
