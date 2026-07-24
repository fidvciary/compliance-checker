import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadRulesetsFromDir } from '../src/rulesets/loader.js';
import { RulesetRegistry } from '../src/rulesets/registry.js';
import { ClassificationScheme } from '../src/classification/consistency-lock.js';
import { scaffoldSixStep } from '../src/nqtl/scaffolder.js';
import { evaluateQtl } from '../src/qtl/qtl-engine.js';
import { fromQtl, resetFindingIds, type SynthesisContext } from '../src/findings/synthesis.js';
import { buildComparativeAnalysisReport, type ComparativeAnalysisInput } from '../src/report/comparative-analysis.js';
import { buildSelfComplianceToolReport } from '../src/report/self-compliance-tool.js';
import { renderMarkdown, reportContentHash } from '../src/report/report-model.js';
import { buildAvailabilityMatrix } from '../src/ingestion/availability-matrix.js';
import { generateTpaRequestLetter } from '../src/report/tpa-request-letter.js';
import type { MethodologyConfig } from '../src/report/methodology.js';

const here = dirname(fileURLToPath(import.meta.url));
const rulesets = loadRulesetsFromDir(join(here, '..', 'rulesets'));

const methodology: MethodologyConfig = {
  scope: 'both',
  qtlEpsilon: 0.02,
  projectionMethod: 'prior-year paid claims, trended 6%',
  samplePeriod: '2024-01-01 to 2024-12-31',
  statisticalConfidence: 0.95,
  multipleComparisonsCorrection: 'Benjamini-Hochberg',
};

function buildInput(scope: 'as-written' | 'both'): ComparativeAnalysisInput {
  resetFindingIds();
  const registry = new RulesetRegistry(rulesets, { active: ['federal:statute', 'federal:2013', 'guidance:*'], advisory: ['federal:2024'] });
  const ctx: SynthesisContext = { analysisId: 'RUN-1', registry };
  const scheme = new ClassificationScheme().useAllClassifications().lock();
  const { registry: sixStep } = scaffoldSixStep({ scheme, nqtlSet: 'core', scope });

  const qtl = evaluateQtl({
    classification: 'inpatient_in_network',
    frQtlType: { id: 'copay', kind: 'financial_requirement', label: 'copay', restrictiveness: 'higher_is_more_restrictive' },
    projectionMethod: methodology.projectionMethod,
    msBenefits: [{ id: 'B1', planPayments: 300, subjectToType: true, level: 20 }, { id: 'B2', planPayments: 600, subjectToType: false }],
    mhsudApplied: { subjectToType: true, level: 20 },
  });
  const findings = [fromQtl(ctx, qtl)!];

  return {
    analysisId: 'RUN-1',
    scope,
    planYear: 2025,
    samplePeriod: scope === 'as-written' ? null : methodology.samplePeriod,
    jurisdiction: 'CT',
    rulesetsActive: ['federal:2013', 'federal:statute', 'guidance:warning-signs'],
    rulesetsAdvisory: ['federal:2024'],
    dataSources: [{ artifact: 'SPD', provenance: 'employer upload 2026-07-01' }],
    sixStep,
    findings,
    qtlDeterminations: [qtl],
    availability: buildAvailabilityMatrix([]),
    methodology: { ...methodology, scope },
    createdAt: '2026-07-24T00:00:00Z',
  };
}

describe('comparative-analysis report', () => {
  it('renders a cover, two tracks, six-step sections, and appendices', () => {
    const report = buildComparativeAnalysisReport(buildInput('both'));
    const md = renderMarkdown(report);
    expect(md).toMatch(/MHPAEA NQTL Comparative Analysis Report/);
    expect(md).toMatch(/Track 1 \(Regulatory\)/);
    expect(md).toMatch(/Track 2 \(Litigation Exposure\)/);
    expect(md).toMatch(/Appendix — Methodology/);
    expect(md).toMatch(/Appendix — FR\/QTL Worksheet/);
  });

  it('states the as-written scope limitation on the report face', () => {
    const report = buildComparativeAnalysisReport(buildInput('as-written'));
    const md = renderMarkdown(report);
    expect(md).toMatch(/300gg-26\(a\)\(8\)\(A\)\(iv\)/);
    expect(md).toMatch(/Step 5 NOT PERFORMED/);
  });

  it('shows DRAFT banners in a generated (non-final) report', () => {
    const input = buildInput('both');
    input.findings[0]!.proposedConclusion = { text: 'proposed', status: 'DRAFT_PENDING_ATTORNEY_REVIEW', promptTemplateId: 't', promptVersion: 'v1', modelId: 'm' };
    const report = buildComparativeAnalysisReport(input);
    const md = renderMarkdown(report);
    expect(md).toMatch(/DRAFT — PENDING ATTORNEY REVIEW/);
  });

  it('is byte-reproducible: identical inputs render identical deterministic content', () => {
    const a = reportContentHash(buildComparativeAnalysisReport(buildInput('both')));
    const b = reportContentHash(buildComparativeAnalysisReport(buildInput('both')));
    expect(a).toBe(b);
    // and the rendered markdown of the deterministic body is identical
    expect(renderMarkdown(buildComparativeAnalysisReport(buildInput('both')))).toBe(
      renderMarkdown(buildComparativeAnalysisReport(buildInput('both'))),
    );
  });

  it('content hash excludes volatile createdAt', () => {
    const r1 = buildComparativeAnalysisReport(buildInput('both'));
    const r2 = buildComparativeAnalysisReport({ ...buildInput('both'), createdAt: '2099-01-01T00:00:00Z' });
    expect(reportContentHash(r1)).toBe(reportContentHash(r2));
  });
});

describe('Self-Compliance Tool report', () => {
  it('renders Sections A–H and Appendices I/II', () => {
    const input = buildInput('both');
    const report = buildSelfComplianceToolReport({
      analysisId: 'RUN-1',
      scope: 'both',
      planYear: 2025,
      samplePeriod: methodology.samplePeriod,
      jurisdiction: 'CT',
      rulesetsActive: input.rulesetsActive,
      rulesetsAdvisory: input.rulesetsAdvisory,
      dataSources: input.dataSources,
      findings: input.findings,
      reimbursementTable: [
        { code: '99213', description: 'Office visit', specialtyGroup: 'M/S comparison', percentOfMedicare: 130 },
        { code: '90837', description: 'Psychotherapy 60min', specialtyGroup: 'MH/SUD', percentOfMedicare: 85 },
      ],
      methodology,
      createdAt: '2026-07-24T00:00:00Z',
    });
    const md = renderMarkdown(report);
    expect(md).toMatch(/Section A — Annual & Lifetime Dollar Limits/);
    expect(md).toMatch(/Section H — Compliance Program/);
    expect(md).toMatch(/Appendix I — Documentation Checklist/);
    expect(md).toMatch(/Appendix II — Reimbursement Rate Comparison/);
    expect(md).toMatch(/90837/);
  });
});

describe('TPA data-request letter', () => {
  it('names the missing datasets and fields with a PHI warning', () => {
    const matrix = buildAvailabilityMatrix([]); // nothing ingested → everything blocked
    const letter = generateTpaRequestLetter(matrix, {
      employerName: 'Acme Co', planName: 'Acme Health Plan', tpaName: 'Aetna ASO',
      planYear: 2025, samplePeriod: '2024 CY', requesterName: 'Jane Doe', requesterTitle: 'Benefits Director',
    });
    expect(letter).toMatch(/Prior authorization/i);
    expect(letter).toMatch(/protected health information/i);
    expect(letter).toMatch(/146\.136\(c\)\(4\)\(iii\)/);
  });
});
