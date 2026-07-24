import { describe, it, expect } from 'vitest';
import { loadRulesetsFromDir } from '../src/rulesets/loader.js';
import { RulesetRegistry } from '../src/rulesets/registry.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  fromQtl,
  fromInOperation,
  fromWarningSign,
  fromCaselaw,
  resetFindingIds,
  type SynthesisContext,
} from '../src/findings/synthesis.js';
import { assertSeverityInvariant, FindingIntegrityError, compareSeverity, type Finding } from '../src/findings/finding.js';
import { lintNarrative } from '../src/nqtl/sufficiency-linter.js';
import { evaluateQtl } from '../src/qtl/qtl-engine.js';
import { runComparisonFamily } from '../src/in-operation/metrics.js';

const here = dirname(fileURLToPath(import.meta.url));
const rulesets = loadRulesetsFromDir(join(here, '..', 'rulesets'));

function ctx(): SynthesisContext {
  resetFindingIds();
  return {
    analysisId: 'A1',
    registry: new RulesetRegistry(rulesets, {
      active: ['federal:statute', 'federal:2013', 'guidance:*'],
      advisory: ['federal:2024'],
    }),
  };
}

describe('severity invariant', () => {
  it('rejects a facial_violation finding derived from in-operation data', () => {
    const bad: Finding = {
      id: 'X', analysisId: 'A', scope: 'in_operation', track: 'regulatory',
      authorityRefs: ['federal:2013'], evidence: [], severity: 'facial_violation',
      confidence: 'high', investigationQuestion: 'q', title: 't', detail: 'd',
      proposedConclusion: null, attorneyDisposition: null,
    };
    expect(() => assertSeverityInvariant(bad)).toThrow(FindingIntegrityError);
  });

  it('rejects an empty authority_refs finding', () => {
    const bad: Finding = {
      id: 'X', analysisId: 'A', scope: 'structural', track: 'regulatory',
      authorityRefs: [], evidence: [], severity: 'compliant', confidence: 'high',
      investigationQuestion: 'q', title: 't', detail: 'd', proposedConclusion: null, attorneyDisposition: null,
    };
    expect(() => assertSeverityInvariant(bad)).toThrow(/empty authority_refs/);
  });
});

describe('synthesis', () => {
  it('maps a QTL facial violation to severity=facial_violation, scope=structural', () => {
    const d = evaluateQtl({
      classification: 'inpatient_in_network',
      frQtlType: { id: 'copay', kind: 'financial_requirement', label: 'copay', restrictiveness: 'higher_is_more_restrictive' },
      projectionMethod: 'x',
      msBenefits: [{ id: 'B1', planPayments: 300, subjectToType: true, level: 20 }, { id: 'B2', planPayments: 600, subjectToType: false }],
      mhsudApplied: { subjectToType: true, level: 20 },
    });
    const f = fromQtl(ctx(), d)!;
    expect(f.severity).toBe('facial_violation');
    expect(f.scope).toBe('structural');
    expect(f.authorityRefs.length).toBeGreaterThan(0);
  });

  it('never marks an in-operation finding facial (severity guard holds through synthesis)', () => {
    const [r] = runComparisonFamily([
      { metricId: 'denial_rate', classification: 'outpatient_in_network', mhsud: { events: 226, n: 1240 }, ms: { events: 1153, n: 18900 } },
    ]);
    const f = fromInOperation(ctx(), r!)!;
    expect(f.scope).toBe('in_operation');
    expect(f.severity).not.toBe('facial_violation');
    expect(['significant_indicator', 'potential_indicator']).toContain(f.severity);
  });

  it('tags a finding that depends only on the advisory 2024 rule', () => {
    const c = ctx();
    const f = fromWarningSign(c, {
      ruleId: 'I.blanket_preauth_mhsud', category: 'I', ruleName: 'x',
      passage: { documentId: 'spd', text: 'Prior authorization is required for behavioral health services.' },
      matchedPattern: 'x', mode: 'mhsud_scoped', citation: 'DOL Warning Signs', authorityRefs: ['federal:2024'], rationale: 'r',
    });
    expect(f.advisory).toBe(true);
  });

  it('maps a caselaw hit to the litigation track', () => {
    const f = fromCaselaw(ctx(), {
      ruleId: 'nqtl.dual_um_vendor', caseName: 'DOL Warning Signs', citation: 'x', jurisdiction: 'federal (DOL)',
      precedentialWeight: 'regulator_finding', scope: 'both', theory: 't', finding: 'f', remediation: 'r',
      matchedTargets: ['vendor_structure'], venueWeight: { label: 'enforcement_posture', rationale: 'x' },
      authorityRefs: ['caselaw:nqtl.dual_um_vendor'], track: 'litigation',
    });
    expect(f.track).toBe('litigation');
    expect(f.severity).not.toBe('facial_violation');
  });

  it('orders findings most-severe-first', () => {
    const findings: Finding[] = [
      { id: '1', analysisId: 'A', scope: 'in_operation', track: 'regulatory', authorityRefs: ['x'], evidence: [], severity: 'potential_indicator', confidence: 'low', investigationQuestion: '', title: '', detail: '', proposedConclusion: null, attorneyDisposition: null },
      { id: '2', analysisId: 'A', scope: 'structural', track: 'regulatory', authorityRefs: ['x'], evidence: [], severity: 'facial_violation', confidence: 'high', investigationQuestion: '', title: '', detail: '', proposedConclusion: null, attorneyDisposition: null },
    ];
    findings.sort(compareSeverity);
    expect(findings[0]!.severity).toBe('facial_violation');
  });
});

describe('sufficiency linter (FAQ Part 45 Q3)', () => {
  it('blocks a conclusory / bare-recitation section', () => {
    const r = lintNarrative({ sectionId: 's1', text: 'The processes are comparable to, and applied no more stringently than, those for medical/surgical benefits.' });
    expect(r.eligibleForReview).toBe(false);
    expect(r.issues.some((i) => i.check === 'conclusory')).toBe(true);
  });

  it('blocks factors identified without explanation', () => {
    const r = lintNarrative({ sectionId: 's2', text: 'The plan considered the following factors: excessive utilization and provider discretion.' });
    expect(r.issues.some((i) => i.check === 'factors_without_explanation')).toBe(true);
  });

  it('blocks a document dump without relevance', () => {
    const r = lintNarrative({ sectionId: 's3', text: 'See attached policy manuals. See exhibit A and exhibit B.', referencedDocuments: 4 });
    expect(r.issues.some((i) => i.check === 'document_dump')).toBe(true);
  });

  it('blocks a table presented in place of analysis', () => {
    const r = lintNarrative({ sectionId: 's4', text: 'Comparison table below.', containsTableInPlaceOfAnalysis: true });
    expect(r.issues.some((i) => i.check === 'table_instead_of_analysis')).toBe(true);
  });

  it('blocks book-of-business / cross-classification aggregation', () => {
    const r = lintNarrative({ sectionId: 's5', text: 'Denial rates are reported across all plans in our book of business.' });
    expect(r.issues.some((i) => i.check === 'book_of_business_or_aggregated')).toBe(true);
  });

  it('passes a specific, well-explained plan-level section', () => {
    const r = lintNarrative({
      sectionId: 's6',
      presentedAt: 'plan',
      text:
        'For inpatient in-network, prior authorization is applied to MH/SUD and M/S admissions using the same ' +
        'factor, excessive utilization, defined as admissions exceeding the 90th percentile length of stay. ' +
        'Specifically, both use MCG criteria because the plan adopted a single criteria set; the threshold of ' +
        '7 days triggers concurrent review for both, measured by the admitting diagnosis.',
    });
    expect(r.eligibleForReview).toBe(true);
    expect(r.issues).toHaveLength(0);
  });
});
