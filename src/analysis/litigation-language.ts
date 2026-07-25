import type { CandidatePassage } from './warning-sign-scanner.js';
import { MHSUD_TERMS } from './nqtl-warning-signs.js';

/**
 * Litigation-theory language detectors (deterministic).
 *
 * These text patterns correspond to case-law theories in the rule pack. Because
 * every case-law rule ships INACTIVE (attorney-verification gate), we do NOT emit
 * them as fired findings. Instead we surface them as OBSERVATIONS that point to
 * the relevant rule id, so an attorney can review the language and decide whether
 * to activate the rule. This keeps the activation gate intact while still telling
 * the user "this language matches a known litigation theory."
 */

export interface LitigationLanguageRule {
  theoryRuleId: string;
  caseName: string;
  label: string;
  /** Requires MH/SUD context in the passage (or an inherently MH pattern). */
  requiresMhsudContext: boolean;
  patterns: RegExp[];
  why: string;
}

export const LITIGATION_LANGUAGE_RULES: LitigationLanguageRule[] = [
  {
    theoryRuleId: 'wit_ubh.gasc_deviation',
    caseName: 'Wit v. United Behavioral Health',
    label: 'Acute-stabilization / acute-focus medical-necessity framing',
    requiresMhsudContext: true,
    patterns: [
      /\bacute (danger|stabiliz\w*|symptom\w*|care|condition|phase|crisis)\b/i,
      /\b(danger to (themselves|self|others)|imminent (risk|danger))\b/i,
      /\b(only|solely) (when|if) .{0,40}\b(acute|crisis|stabiliz)/i,
    ],
    why:
      'Medical-necessity criteria oriented to acute stabilization (rather than to the underlying chronic condition) ' +
      'were central to Wit v. UBH. Confirm the criteria also address chronic conditions and comorbidities and are not ' +
      'biased toward the lowest level of care.',
  },
  {
    theoryRuleId: 'wit_ubh.gasc_deviation',
    caseName: 'Wit v. United Behavioral Health',
    label: 'Lowest-level-of-care default',
    requiresMhsudContext: true,
    patterns: [/\b(least intensive|lowest (effective )?level of care|lower level of care)\b/i],
    why: 'A default to the lowest/least-intensive level of care is a Wit v. UBH concern; confirm level-of-care decisions follow generally accepted standards (e.g., ASAM/LOCUS).',
  },
  {
    theoryRuleId: 'danny_p.room_and_board',
    caseName: 'Danny P. v. Catholic Health Initiatives',
    label: 'Room and board excluded at residential treatment',
    requiresMhsudContext: false,
    patterns: [/\broom and board\b.{0,60}\b(not covered|excluded|no benefits|not (a )?covered)\b/i, /\b(not covered|excluded)\b.{0,40}\broom and board\b/i],
    why: 'Excluding room and board at residential treatment while covering it at a skilled nursing facility was actionable in Danny P. Confirm parity of room-and-board coverage across residential MH/SUD and SNF/rehab.',
  },
  {
    theoryRuleId: 'residential_exclusion.categorical',
    caseName: 'Bushell / Joseph F.',
    label: 'Categorical residential-treatment exclusion or day limit',
    requiresMhsudContext: false,
    patterns: [/\bresidential (treatment|care)\b.{0,50}\b(not covered|excluded|limited to \d+|maximum of \d+)\b/i],
    why: 'A categorical residential exclusion or day-limit without a comparable M/S sub-acute restriction has supported parity claims (Bushell; Joseph F.).',
  },
  {
    theoryRuleId: 'aba_exclusion',
    caseName: 'N.R. v. Raytheon Co.',
    label: 'ABA (applied behavior analysis) exclusion or limitation',
    requiresMhsudContext: false,
    patterns: [/\b(applied behavior analysis|\bABA\b)\b.{0,50}\b(not covered|excluded|limited|maximum|not (a )?covered)\b/i],
    why: 'Exclusion or limitation of ABA for autism spectrum disorder has been litigated (N.R. v. Raytheon and progeny). Confirm ABA is covered comparably.',
  },
];

export interface LitigationLanguageObservation {
  theoryRuleId: string;
  caseName: string;
  label: string;
  passage: CandidatePassage;
  matched: string;
  why: string;
  /** Always true: the corresponding case-law rule is inactive pending attorney verification. */
  ruleInactivePendingVerification: true;
}

export function scanLitigationLanguage(passages: CandidatePassage[]): LitigationLanguageObservation[] {
  const out: LitigationLanguageObservation[] = [];
  for (const passage of passages) {
    // MH/SUD context can come from the passage text or its section heading.
    const mentionsMhsud = MHSUD_TERMS.test(passage.text) || MHSUD_TERMS.test(passage.section ?? '');
    for (const rule of LITIGATION_LANGUAGE_RULES) {
      if (rule.requiresMhsudContext && !mentionsMhsud) continue;
      const matched = rule.patterns.find((p) => p.test(passage.text));
      if (matched) {
        out.push({
          theoryRuleId: rule.theoryRuleId,
          caseName: rule.caseName,
          label: rule.label,
          passage,
          matched: matched.source,
          why: rule.why,
          ruleInactivePendingVerification: true,
        });
      }
    }
  }
  return out;
}
