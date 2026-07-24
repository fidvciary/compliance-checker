import { contentHash } from '../util/hash.js';
import type { Clock } from '../util/clock.js';
import { systemClock } from '../util/clock.js';
import type { AuditLog } from '../audit/audit-log.js';
import {
  type ReportRecord,
  type AttorneyRecord,
  deterministicBody,
  renderMarkdown,
} from '../report/report-model.js';
import type { Finding, AttorneyDisposition } from '../findings/finding.js';

/**
 * Module 12 — Attorney review gate (Non-negotiable #1).
 *
 * Report lifecycle: generated → pending_attorney_review → attorney_approved →
 * final, plus attorney_returned. A report may NOT be exported in FINAL form, and
 * its DRAFT banners may NOT be suppressed, without a recorded approval event
 * containing the reviewing attorney's identity, bar jurisdiction, timestamp, and
 * the exact content hash approved. Any change after approval invalidates it.
 *
 * Rationale (encode-in-comments per spec): an NQTL comparative analysis is an
 * attestation of fact about actual human decision-making at the plan and its
 * vendors. AI-generated content presented as attested fact is the core liability
 * risk in this product — hence a hard gate, distinct from and stricter than any
 * optional "invite a reviewer" collaboration flow (see InviteReviewer below,
 * which grants NO finalization authority).
 */

export class AttorneyGateError extends Error {}

/**
 * The approval hash commits to EXACTLY what the attorney signs off on: the
 * deterministic report body PLUS each finding's proposed conclusion and the
 * attorney's disposition of it. Editing any conclusion after approval changes
 * this hash and invalidates the approval.
 */
export function approvalHash(report: ReportRecord): string {
  return contentHash({
    body: deterministicBody(report),
    conclusions: report.findings.map((f) => ({
      id: f.id,
      proposed: f.proposedConclusion?.text ?? null,
      disposition: f.attorneyDisposition,
    })),
  });
}

export class AttorneyReviewGate {
  constructor(
    private readonly report: ReportRecord,
    private readonly audit: AuditLog,
    private readonly clock: Clock = systemClock,
  ) {}

  get status() {
    return this.report.status;
  }

  /** generated → pending_attorney_review. */
  submitForReview(): void {
    if (this.report.status !== 'generated' && this.report.status !== 'attorney_returned') {
      throw new AttorneyGateError(`Cannot submit for review from status '${this.report.status}'.`);
    }
    this.report.status = 'pending_attorney_review';
    this.audit.append('attorney.action', 'engine', { action: 'submitted_for_review', reportId: this.report.id });
  }

  /**
   * The attorney reviews an inline-editable version of a proposed conclusion.
   * The original AI draft is retained on the Finding; the attorney's action and
   * edited text are retained in attorneyDisposition. Both are kept.
   */
  disposeConclusion(findingId: string, action: AttorneyDisposition['action'], userId: string, editedText?: string): void {
    if (this.report.status !== 'pending_attorney_review') {
      throw new AttorneyGateError(`Conclusions can only be disposed while pending_attorney_review (is '${this.report.status}').`);
    }
    const finding = this.report.findings.find((f) => f.id === findingId);
    if (!finding) throw new AttorneyGateError(`Finding '${findingId}' not found.`);
    finding.attorneyDisposition = {
      userId,
      action,
      ...(editedText !== undefined ? { editedText } : {}),
      timestamp: this.clock.now(),
    };
    this.audit.append('attorney.action', `attorney:${userId}`, {
      action: `dispose:${action}`,
      findingId,
      reportId: this.report.id,
      // record hashes of both the original draft and the edited text — both retained
      originalDraftHash: finding.proposedConclusion ? contentHash(finding.proposedConclusion.text) : null,
      editedTextHash: editedText !== undefined ? contentHash(editedText) : null,
    });
  }

  /** pending_attorney_review → attorney_approved. Records the approval event. */
  approve(attorney: { userId: string; name: string; barJurisdiction: string }): AttorneyRecord {
    if (this.report.status !== 'pending_attorney_review') {
      throw new AttorneyGateError(`Cannot approve from status '${this.report.status}'.`);
    }
    // Every proposed conclusion must have been dispositioned (no silent approval of un-reviewed AI text).
    const undisposed = this.report.findings.filter((f) => f.proposedConclusion && !f.attorneyDisposition);
    if (undisposed.length > 0) {
      throw new AttorneyGateError(
        `Cannot approve: ${undisposed.length} proposed conclusion(s) have not been reviewed (e.g., ${undisposed[0]!.id}).`,
      );
    }
    const hash = approvalHash(this.report);
    const record: AttorneyRecord = {
      userId: attorney.userId,
      name: attorney.name,
      barJurisdiction: attorney.barJurisdiction,
      timestamp: this.clock.now(),
      approvedContentHash: hash,
    };
    this.report.status = 'attorney_approved';
    this.report.cover.attorneyOfRecord = record;
    this.audit.append('attorney.action', `attorney:${attorney.userId}`, {
      action: 'approved',
      reportId: this.report.id,
      barJurisdiction: attorney.barJurisdiction,
      approvedContentHash: hash,
    });
    return record;
  }

  /** any review state → attorney_returned (with comments). */
  returnWithComments(userId: string, comments: string): void {
    if (this.report.status !== 'pending_attorney_review' && this.report.status !== 'attorney_approved') {
      throw new AttorneyGateError(`Cannot return from status '${this.report.status}'.`);
    }
    this.report.status = 'attorney_returned';
    this.report.cover.attorneyOfRecord = null;
    this.audit.append('attorney.action', `attorney:${userId}`, { action: 'returned', reportId: this.report.id, comments });
  }

  /**
   * attorney_approved → final. Refuses if the content changed since approval
   * (the stored approvedContentHash must still match the current content).
   */
  finalize(): void {
    if (this.report.status !== 'attorney_approved') {
      throw new AttorneyGateError(`Cannot finalize from status '${this.report.status}'. Attorney approval is required.`);
    }
    const record = this.report.cover.attorneyOfRecord;
    if (!record) throw new AttorneyGateError('No attorney of record; cannot finalize.');
    const current = approvalHash(this.report);
    if (current !== record.approvedContentHash) {
      throw new AttorneyGateError(
        'Report content changed since attorney approval; the approval is invalidated. Re-submit for review and re-approve.',
      );
    }
    this.report.status = 'final';
    this.audit.append('report.issued', 'engine', {
      reportId: this.report.id,
      status: 'final',
      approvedContentHash: record.approvedContentHash,
      attorney: record.userId,
      barJurisdiction: record.barJurisdiction,
    });
  }

  /**
   * Export the FINAL report markdown. Throws unless the report is final AND the
   * approval hash still matches — this is the hard stop on FINAL export /
   * banner suppression without a valid recorded approval.
   */
  exportFinal(): string {
    if (this.report.status !== 'final') {
      throw new AttorneyGateError(`Report is '${this.report.status}', not final. FINAL export requires attorney approval + finalize().`);
    }
    const record = this.report.cover.attorneyOfRecord;
    if (!record || approvalHash(this.report) !== record.approvedContentHash) {
      throw new AttorneyGateError('FINAL export blocked: approval hash mismatch.');
    }
    return renderMarkdown(this.report);
  }
}

/**
 * Optional collaboration flow — DISTINCT from the attorney gate and with NO
 * finalization authority. Inviting a reviewer never transitions a report to
 * final and never suppresses DRAFT banners. Kept as a separate code path by
 * design (the two must not be the same path).
 */
export interface InviteReviewer {
  reportId: string;
  reviewerEmail: string;
  invitedBy: string;
  /** Comments only; cannot approve, finalize, or change status. */
  canComment: true;
  canFinalize: false;
}
