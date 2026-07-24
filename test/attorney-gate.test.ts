import { describe, it, expect } from 'vitest';
import { runAnalysis } from '../src/pipeline.js';
import { buildDemoInput } from '../src/demo.js';
import { AttorneyReviewGate, AttorneyGateError } from '../src/attorney/review-gate.js';
import { AuditLog } from '../src/audit/audit-log.js';
import { fixedClock } from '../src/util/clock.js';
import { reportContentHash } from '../src/report/report-model.js';

function freshReport() {
  const result = runAnalysis(buildDemoInput(), { clock: fixedClock('2026-07-24T00:00:00Z', 1) });
  // give one finding a proposed AI conclusion to exercise the disposition path
  const withConclusion = result.comparativeReport.findings[0]!;
  withConclusion.proposedConclusion = { text: 'AI draft conclusion.', status: 'DRAFT_PENDING_ATTORNEY_REVIEW', promptTemplateId: 't', promptVersion: 'v1', modelId: 'm' };
  return result.comparativeReport;
}

const ATTY = { userId: 'atty1', name: 'A. Counsel', barJurisdiction: 'CT' };

describe('attorney review gate', () => {
  it('will not finalize or export FINAL without approval', () => {
    const report = freshReport();
    const gate = new AttorneyReviewGate(report, new AuditLog(fixedClock('2026-07-24T00:00:00Z', 1)));
    expect(() => gate.finalize()).toThrow(AttorneyGateError);
    expect(() => gate.exportFinal()).toThrow(/not final/);
  });

  it('will not approve while proposed conclusions are un-disposed', () => {
    const report = freshReport();
    const gate = new AttorneyReviewGate(report, new AuditLog(fixedClock('2026-07-24T00:00:00Z', 1)));
    gate.submitForReview();
    expect(() => gate.approve(ATTY)).toThrow(/not been reviewed/);
  });

  it('runs the full lifecycle: submit -> dispose -> approve -> finalize -> export', () => {
    const report = freshReport();
    const audit = new AuditLog(fixedClock('2026-07-24T00:00:00Z', 1));
    const gate = new AttorneyReviewGate(report, audit);
    gate.submitForReview();
    // dispose every proposed conclusion
    for (const f of report.findings.filter((x) => x.proposedConclusion)) {
      gate.disposeConclusion(f.id, 'edited', ATTY.userId, 'Attorney-finalized conclusion.');
    }
    const record = gate.approve(ATTY);
    expect(record.barJurisdiction).toBe('CT');
    expect(record.approvedContentHash).toMatch(/^[a-f0-9]{64}$/);
    gate.finalize();
    expect(gate.status).toBe('final');
    const md = gate.exportFinal();
    // FINAL export suppresses DRAFT banners and shows the approved (edited) conclusion
    expect(md).not.toMatch(/DRAFT — PENDING ATTORNEY REVIEW/);
    expect(md).toMatch(/attorney-approved/);
    expect(md).toMatch(/Attorney-finalized conclusion\./);
    // both the original AI draft and the attorney text are retained on the finding
    const f0 = report.findings.find((x) => x.attorneyDisposition)!;
    expect(f0.proposedConclusion!.text).toBe('AI draft conclusion.');
    expect(f0.attorneyDisposition!.editedText).toBe('Attorney-finalized conclusion.');
    // audit recorded the approval + issuance
    expect(audit.filter('report.issued').length).toBe(1);
  });

  it('invalidates approval if content changes after approval', () => {
    const report = freshReport();
    const gate = new AttorneyReviewGate(report, new AuditLog(fixedClock('2026-07-24T00:00:00Z', 1)));
    gate.submitForReview();
    for (const f of report.findings.filter((x) => x.proposedConclusion)) gate.disposeConclusion(f.id, 'approved', ATTY.userId);
    gate.approve(ATTY);
    // tamper: change a finding title after approval
    report.findings[0]!.title = 'MUTATED AFTER APPROVAL';
    expect(() => gate.finalize()).toThrow(/changed since attorney approval/);
  });

  it('can be returned with comments', () => {
    const report = freshReport();
    const gate = new AttorneyReviewGate(report, new AuditLog(fixedClock('2026-07-24T00:00:00Z', 1)));
    gate.submitForReview();
    gate.returnWithComments(ATTY.userId, 'Step 3 narrative too conclusory; expand.');
    expect(gate.status).toBe('attorney_returned');
  });
});

describe('full-pipeline integration + reproducibility', () => {
  it('produces the expected findings across tracks and scopes', () => {
    const result = runAnalysis(buildDemoInput(), { clock: fixedClock('2026-07-24T00:00:00Z', 1) });
    const sev = (s: string) => result.findings.filter((f) => f.severity === s).length;
    expect(sev('facial_violation')).toBeGreaterThanOrEqual(3); // S-A fail + sep deductible + dollar limit
    expect(result.findings.some((f) => f.track === 'litigation')).toBe(true); // dual UM vendor (activated)
    expect(result.findings.some((f) => f.scope === 'in_operation')).toBe(true);
    expect(result.findings.some((f) => f.severity === 'insufficient_data')).toBe(true);
    // audit chain intact
    expect(result.audit.verifyChain().valid).toBe(true);
  });

  it('is reproducible: identical inputs + clock -> identical report hash AND audit head hash', () => {
    const a = runAnalysis(buildDemoInput(), { clock: fixedClock('2026-07-24T00:00:00Z', 1) });
    const b = runAnalysis(buildDemoInput(), { clock: fixedClock('2026-07-24T00:00:00Z', 1) });
    // deterministic report content
    expect(reportContentHash(a.comparativeReport)).toBe(reportContentHash(b.comparativeReport));
    // audit head hash identical (byte-level reproducibility of the deterministic run)
    expect(a.audit.headHash()).toBe(b.audit.headHash());
  });

  it('never emits a facial_violation from in-operation data (severity guard holds end to end)', () => {
    const result = runAnalysis(buildDemoInput(), { clock: fixedClock('2026-07-24T00:00:00Z', 1) });
    for (const f of result.findings.filter((x) => x.scope === 'in_operation')) {
      expect(f.severity).not.toBe('facial_violation');
    }
  });
});
