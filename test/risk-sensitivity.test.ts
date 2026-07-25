import { describe, it, expect } from 'vitest';
import { scoreFinding, assignAndRankRisk, riskTierCounts } from '../src/findings/risk.js';
import type { Finding, Severity, Confidence } from '../src/findings/finding.js';
import { SENSITIVITY_PRESETS, resolveSensitivity } from '../src/config/sensitivity.js';
import { scanPassages } from '../src/analysis/warning-sign-scanner.js';
import { compareAsWritten } from '../src/analysis/as-written-comparability.js';
import { runRateComparison } from '../src/in-operation/metrics.js';
import { runAnalysis } from '../src/pipeline.js';
import { buildDemoInput } from '../src/demo.js';
import { fixedClock } from '../src/util/clock.js';

function finding(sev: Severity, conf: Confidence, extra: Partial<Finding> = {}): Finding {
  return {
    id: 'F', analysisId: 'A', scope: 'as_written', track: 'regulatory', authorityRefs: ['federal:2013'],
    evidence: [], severity: sev, confidence: conf, investigationQuestion: 'q', title: 't', detail: 'd',
    proposedConclusion: null, attorneyDisposition: null, ...extra,
  };
}

describe('risk scoring', () => {
  it('rates a bright-line facial violation as critical', () => {
    const r = scoreFinding(finding('facial_violation', 'high', { scope: 'structural', evidence: [{ kind: 'computation', description: 'qtl', values: { substantiallyAllApplies: false } }] }));
    expect(r.tier).toBe('critical');
    expect(r.score).toBeGreaterThanOrEqual(80);
  });

  it('halves risk for an advisory (2024-rule-only) finding', () => {
    const required = scoreFinding(finding('facial_violation', 'high'));
    const advisory = scoreFinding(finding('facial_violation', 'high', { advisory: true }));
    expect(advisory.score).toBeLessThan(required.score);
  });

  it('scores a strong in-operation disparity as high, a weak warning sign as low', () => {
    const strong = scoreFinding(finding('significant_indicator', 'high', {
      scope: 'in_operation',
      evidence: [{ kind: 'statistical', metric: 'denial_rate', msValue: 0.06, mhsudValue: 0.18, ratio: 3.0, diff: 0.12, nMs: 18900, nMhsud: 1240, pAdjusted: 0.0001 }],
    }));
    const weak = scoreFinding(finding('potential_indicator', 'low'));
    expect(strong.tier === 'high' || strong.tier === 'critical').toBe(true);
    expect(['low', 'informational']).toContain(weak.tier);
    expect(strong.score).toBeGreaterThan(weak.score);
  });

  it('assigns and ranks findings highest-risk-first', () => {
    const fs = [finding('potential_indicator', 'low', { id: 'a' }), finding('facial_violation', 'high', { id: 'b' })];
    const ranked = assignAndRankRisk(fs);
    expect(ranked[0]!.id).toBe('b');
    expect(fs.every((f) => f.risk !== undefined)).toBe(true);
    expect(riskTierCounts(fs).critical).toBeGreaterThanOrEqual(0);
  });
});

describe('sensitivity presets', () => {
  it('aggressive is more sensitive than balanced than conservative', () => {
    const a = SENSITIVITY_PRESETS.aggressive, b = SENSITIVITY_PRESETS.balanced, c = SENSITIVITY_PRESETS.conservative;
    expect(a.qtlEpsilon).toBeGreaterThan(b.qtlEpsilon);
    expect(b.qtlEpsilon).toBeGreaterThan(c.qtlEpsilon);
    expect(a.scopePointTolerance).toBeLessThan(b.scopePointTolerance);
    expect(a.warningSignRequireCueForSection).toBe(false);
    expect(a.emitAppliesToBothAsVerify).toBe(true);
    expect(resolveSensitivity().level).toBe('balanced');
  });
});

describe('sensitivity behavior', () => {
  it('aggressive surfaces an "applies to both" passage as a WEAK verify hit; balanced suppresses it', () => {
    const p = [{ documentId: 'd', text: 'Prior authorization is required for all inpatient admissions, both medical/surgical and behavioral health.' }];
    expect(scanPassages(p)).toHaveLength(0); // balanced/default suppresses
    const weak = scanPassages(p, undefined, { emitAppliesToBothAsVerify: true });
    expect(weak.length).toBeGreaterThan(0);
    expect(weak.every((h) => h.weak)).toBe(true);
  });

  it('tighter as-written tolerance flags a small scope gap that balanced ignores', () => {
    const ms = { side: 'MS' as const, scopePercent: 20 };
    const mh = { side: 'MHSUD' as const, scopePercent: 25 };
    expect(compareAsWritten('prior_authorization', 'outpatient_in_network', ms, mh, { scopePointTolerance: 10, scopeRatio: 1.5 })).toHaveLength(0);
    const aggressive = compareAsWritten('prior_authorization', 'outpatient_in_network', ms, mh, { scopePointTolerance: 3, scopeRatio: 1.15 });
    expect(aggressive.length).toBeGreaterThan(0);
  });

  it('reports an adverse near-significant disparity only under aggressive reporting', () => {
    const input = { metricId: 'denial_rate', classification: 'outpatient_in_network' as const, mhsud: { events: 18, n: 100 }, ms: { events: 9, n: 100 } };
    const balanced = runRateComparison(input);
    expect(balanced.significant).toBe(false);
    expect(balanced.nearSignificant).toBeFalsy();
    const aggressive = runRateComparison(input, { reportNearSignificant: true, nearSignificantAlpha: 0.1 });
    expect(aggressive.nearSignificant).toBe(true);
  });
});

describe('pipeline: aggressive surfaces more, ranked by risk', () => {
  it('aggressive yields at least as many findings as balanced, all risk-scored and ranked', () => {
    const balanced = runAnalysis({ ...buildDemoInput(), sensitivity: 'balanced' }, { clock: fixedClock('2026-07-24T00:00:00Z', 1) });
    const aggressive = runAnalysis({ ...buildDemoInput(), sensitivity: 'aggressive' }, { clock: fixedClock('2026-07-24T00:00:00Z', 1) });
    expect(aggressive.findings.length).toBeGreaterThanOrEqual(balanced.findings.length);
    expect(aggressive.findings.every((f) => f.risk !== undefined)).toBe(true);
    // ranked highest-risk first
    for (let i = 1; i < aggressive.findings.length; i++) {
      expect(aggressive.findings[i - 1]!.risk!.score).toBeGreaterThanOrEqual(aggressive.findings[i]!.risk!.score);
    }
    // the S-A-fail facial violation should sit at or near the top
    expect(aggressive.findings[0]!.severity).toBe('facial_violation');
  });
});
