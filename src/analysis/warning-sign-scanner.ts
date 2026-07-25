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
  /** Weak hit (aggressive sensitivity): low confidence, e.g. an "applies to both — verify" item. */
  weak?: boolean;
  note?: string;
}

export interface ScanOptions {
  /** When MH context is section-only, also require a requirement cue (precision). */
  requireCueForSectionContext?: boolean;
  /** Aggressive: emit "applies to both" passages as WEAK verify hits instead of suppressing. */
  emitAppliesToBothAsVerify?: boolean;
}

const DEFAULT_SCAN_OPTS: Required<ScanOptions> = {
  requireCueForSectionContext: true,
  emitAppliesToBothAsVerify: false,
};

function ruleFires(
  rule: WarningSignRule,
  passage: CandidatePassage,
  opts: Required<ScanOptions>,
): { fired: boolean; pattern?: string; weak?: boolean; note?: string } {
  const text = passage.text;
  const matched = rule.patterns.find((p) => p.test(text));
  if (!matched) return { fired: false };

  if (rule.mode === 'intrinsic') {
    return { fired: true, pattern: matched.source };
  }
  // mhsud_scoped: MH/SUD context can come from the passage text OR the section
  // heading. When it comes ONLY from the section, precision modes also require a
  // requirement/imposition cue so descriptive text does not false-fire.
  const mhInText = MHSUD_TERMS.test(text);
  const mhInSection = MHSUD_TERMS.test(passage.section ?? '');
  const appliesToBoth = APPLIES_TO_BOTH.test(text);
  const cueOk = !opts.requireCueForSectionContext || REQUIREMENT_CUE.test(text);
  const mentionsMhsud = mhInText || (mhInSection && cueOk);
  if (!mentionsMhsud) return { fired: false };

  if (!appliesToBoth) return { fired: true, pattern: matched.source };

  // Parallel M/S application is stated. Precision modes suppress; aggressive mode
  // surfaces it as a WEAK "verify comparability" item (low confidence/low risk).
  if (opts.emitAppliesToBothAsVerify) {
    return {
      fired: true,
      pattern: matched.source,
      weak: true,
      note:
        'The provision states it applies to both M/S and MH/SUD. That is compatible with parity ON ITS FACE, ' +
        'but confirm the factors, evidentiary standards, and application are actually comparable and no more ' +
        'stringent for MH/SUD in operation.',
    };
  }
  return { fired: false };
}

// Language that indicates an actual requirement/imposition (vs. description).
const REQUIREMENT_CUE =
  /\b(required|require|requires|must|shall|only|prior to|before|may not|will not|not covered|excluded|limited to|no more than|maximum of|need to obtain|obtain (a |an )?(pre-?cert|pre-?auth|authorization))\b/i;

export function scanPassages(passages: CandidatePassage[], audit?: AuditLog, options?: ScanOptions): WarningSignHit[] {
  const opts = { ...DEFAULT_SCAN_OPTS, ...(options ?? {}) };
  const hits: WarningSignHit[] = [];
  for (const passage of passages) {
    for (const rule of WARNING_SIGN_RULES) {
      const { fired, pattern, weak, note } = ruleFires(rule, passage, opts);
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
          ...(weak ? { weak: true } : {}),
          ...(note ? { note } : {}),
        };
        hits.push(hit);
        audit?.append('warning_sign.matched', 'engine', {
          ruleId: rule.id,
          category: rule.category,
          documentId: passage.documentId,
          page: passage.page,
          section: passage.section,
          weak: weak ?? false,
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
