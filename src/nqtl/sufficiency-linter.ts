/**
 * Module 11 — Sufficiency linter (FAQ Part 45, Q3).
 *
 * Runs on every drafted narrative section BEFORE the section is eligible for
 * attorney review. Encodes the FAQ Part 45 Q3 prohibitions that regulators cite
 * when rejecting comparative analyses as insufficient. A section with any
 * BLOCKING issue is not eligible for attorney review — this is what keeps output
 * from reading like TPA boilerplate.
 */

export interface LinterInput {
  sectionId: string;
  text: string;
  /** Structured signals the drafter/UI can provide. */
  presentedAt?: 'plan' | 'book_of_business';
  aggregatedAcrossClassifications?: boolean;
  /** A section that is only a side-by-side table with no textual analysis. */
  containsTableInPlaceOfAnalysis?: boolean;
  /** Number of documents referenced in the section. */
  referencedDocuments?: number;
}

export interface LintIssue {
  check: 'conclusory' | 'factors_without_explanation' | 'document_dump' | 'table_instead_of_analysis' | 'book_of_business_or_aggregated';
  severity: 'blocking' | 'warning';
  message: string;
  citation: string;
}

export interface LintResult {
  sectionId: string;
  issues: LintIssue[];
  eligibleForReview: boolean; // false if any blocking issue
}

const CITATION = 'FAQ Part 45, Q3';

const CONCLUSORY_PHRASES = [
  /\bthe plan (is|remains) (fully )?compliant\b/i,
  /\bin (full )?compliance with mhpaea\b/i,
  /\bcomparable to,? and applied no more stringently than\b/i, // bare recitation of the standard
  /\bare comparable and (are )?applied no more stringently\b/i,
  /\bmeets all (applicable )?parity requirements\b/i,
  /\bno parity (issues|concerns) (were )?(identified|found)\b/i,
];

const EXPLANATION_SIGNALS = /\b(because|specifically|defined as|is applied by|for example|e\.g\.|threshold of|measured by|based on the following|as follows|the factor .* was)\b/i;
const FACTOR_MENTION = /\b(factor|factors|evidentiary standard|strateg(y|ies)|process(es)?)\b/i;
const DOCUMENT_DUMP_SIGNALS = /\b(see attached|refer to exhibit|see exhibit|as set forth in|attached hereto|see the attached)\b/i;
const RELEVANCE_SIGNALS = /\b(relevant because|demonstrates that|shows that|is relevant to|supports the|establishes that)\b/i;
const BOB_PHRASES = /\b(book of business|across all (of our )?(plans|clients)|aggregated across (all )?classifications|all classifications combined|company-wide|enterprise-wide)\b/i;

export function lintNarrative(input: LinterInput): LintResult {
  const issues: LintIssue[] = [];
  const text = input.text;
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;

  // 1) Conclusory / bare recitation of the legal standard, with no supporting specifics.
  const conclusoryHit = CONCLUSORY_PHRASES.find((re) => re.test(text));
  if (conclusoryHit && !EXPLANATION_SIGNALS.test(text)) {
    issues.push({
      check: 'conclusory',
      severity: 'blocking',
      message:
        'Section makes a conclusory/generalized statement or bare recitation of the legal standard without ' +
        'explaining, with specifics, how the conclusion follows. Add the concrete factors, thresholds, and ' +
        'application details.',
      citation: CITATION,
    });
  } else if (wordCount < 40 && conclusoryHit) {
    issues.push({ check: 'conclusory', severity: 'warning', message: 'Section is very short and largely conclusory; expand with specifics.', citation: CITATION });
  }

  // 2) Factors/processes identified without explanation of how they were defined and applied.
  if (FACTOR_MENTION.test(text) && !EXPLANATION_SIGNALS.test(text)) {
    issues.push({
      check: 'factors_without_explanation',
      severity: 'blocking',
      message:
        'Section identifies factors/processes/evidentiary standards but does not explain how they were defined ' +
        'and applied in practice. Describe the operational definition and application for each.',
      citation: CITATION,
    });
  }

  // 3) Document dump without per-document relevance explanation.
  const manyDocs = (input.referencedDocuments ?? 0) >= 3;
  if ((DOCUMENT_DUMP_SIGNALS.test(text) || manyDocs) && !RELEVANCE_SIGNALS.test(text)) {
    issues.push({
      check: 'document_dump',
      severity: 'blocking',
      message:
        'Section references documents without explaining each document\'s relevance to the comparative analysis. ' +
        'Explain why each cited document matters and what it demonstrates.',
      citation: CITATION,
    });
  }

  // 4) Side-by-side plan-term table presented in place of textual comparative analysis.
  if (input.containsTableInPlaceOfAnalysis) {
    issues.push({
      check: 'table_instead_of_analysis',
      severity: 'blocking',
      message:
        'A side-by-side plan-term table is presented in place of textual comparative analysis. Tables supplement ' +
        'but do not substitute for a narrative comparison of how the NQTL is designed and applied.',
      citation: CITATION,
    });
  }

  // 5) Book-of-business or across-classification aggregation instead of plan-level, per-classification data.
  if (input.presentedAt === 'book_of_business' || input.aggregatedAcrossClassifications || BOB_PHRASES.test(text)) {
    issues.push({
      check: 'book_of_business_or_aggregated',
      severity: 'blocking',
      message:
        'Data or analysis is presented at book-of-business level or aggregated across classifications. It must be ' +
        'plan-level and per-classification (analyses may not be combined across classifications).',
      citation: CITATION,
    });
  }

  return {
    sectionId: input.sectionId,
    issues,
    eligibleForReview: !issues.some((i) => i.severity === 'blocking'),
  };
}
