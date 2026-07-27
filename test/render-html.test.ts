import { describe, it, expect } from 'vitest';
import { mdToHtml, escapeHtml } from '../src/report/markdown-lite.js';
import { renderReportHtml, renderDocumentScanHtml } from '../src/report/render-html.js';
import { runAnalysis } from '../src/pipeline.js';
import { buildDemoInput } from '../src/demo.js';
import { scanPlanDocumentText } from '../src/ingestion/document-scan.js';
import { planDocumentFromText } from '../src/ingestion/document-reader.js';
import { AttorneyReviewGate } from '../src/attorney/review-gate.js';
import { AuditLog } from '../src/audit/audit-log.js';
import { fixedClock } from '../src/util/clock.js';

describe('markdown-lite', () => {
  it('renders headings, bold, code, lists', () => {
    const html = mdToHtml('## Title\n\nSome **bold** and `code`.\n\n- a\n- b');
    expect(html).toMatch(/<h2>Title<\/h2>/);
    expect(html).toMatch(/<strong>bold<\/strong>/);
    expect(html).toMatch(/<code>code<\/code>/);
    expect(html).toMatch(/<ul><li>a<\/li><li>b<\/li><\/ul>/);
  });
  it('renders a GFM pipe table', () => {
    const html = mdToHtml('| A | B |\n|---|---|\n| 1 | 2 |');
    expect(html).toMatch(/<table>/);
    expect(html).toMatch(/<th>A<\/th>/);
    expect(html).toMatch(/<td>1<\/td>/);
  });
  it('escapes HTML to prevent injection', () => {
    expect(escapeHtml('<script>x</script>')).toBe('&lt;script&gt;x&lt;/script&gt;');
    expect(mdToHtml('a <b> c')).not.toMatch(/<b>/);
  });
});

describe('renderReportHtml', () => {
  const result = runAnalysis({ ...buildDemoInput(), sensitivity: 'aggressive' }, { clock: fixedClock('2026-07-24T00:00:00Z', 1) });

  it('produces a self-contained HTML doc with inlined styles and no external assets', () => {
    const html = renderReportHtml(result.comparativeReport);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toMatch(/<style>/);
    expect(html).not.toMatch(/<link|<script|https?:\/\//); // no external assets
  });

  it('shows the DRAFT status and risk-ranked finding cards', () => {
    const html = renderReportHtml(result.comparativeReport);
    expect(html).toMatch(/status-draft/);
    expect(html).toMatch(/class="finding critical"/);
    expect(html).toMatch(/RISK CRITICAL · \d+/);
    // dashboard + appendices present
    expect(html).toMatch(/At a glance/);
    expect(html).toMatch(/Appendix — Methodology/);
  });

  it('suppresses the DRAFT banner and shows the approved conclusion once finalized', () => {
    const report = runAnalysis({ ...buildDemoInput() }, { clock: fixedClock('2026-07-24T00:00:00Z', 1) }).comparativeReport;
    const f = report.findings[0]!;
    f.proposedConclusion = { text: 'AI draft.', status: 'DRAFT_PENDING_ATTORNEY_REVIEW', promptTemplateId: 't', promptVersion: 'v1', modelId: 'm' };
    const gate = new AttorneyReviewGate(report, new AuditLog(fixedClock('2026-07-24T00:00:00Z', 1)));
    gate.submitForReview();
    for (const x of report.findings.filter((y) => y.proposedConclusion)) gate.disposeConclusion(x.id, 'edited', 'atty', 'Approved conclusion.');
    gate.approve({ userId: 'atty', name: 'Counsel', barJurisdiction: 'CT' });
    gate.finalize();
    const html = renderReportHtml(report);
    expect(html).toMatch(/status-final/);
    expect(html).not.toMatch(/DRAFT — PENDING ATTORNEY REVIEW/);
    expect(html).toMatch(/attorney-approved/);
  });
});

describe('renderDocumentScanHtml', () => {
  it('renders the cost-share table and warning-sign cards', () => {
    const doc = planDocumentFromText(
      '*TOCLVL2*Summary of Benefits*TOCLVL2*\n\nOffice Visit: $25 copay in-network.\n\n*TOCLVL2*Mental Health Benefits*TOCLVL2*\n\nOutpatient mental health office visit: $50 copay in-network.\n\nPrior authorization is required for outpatient mental health services.',
      'sob',
    );
    const html = renderDocumentScanHtml(scanPlanDocumentText(doc));
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toMatch(/Cost-share level comparison/);
    expect(html).toMatch(/\$50/);
    expect(html).toMatch(/Warning Signs/);
  });
});
