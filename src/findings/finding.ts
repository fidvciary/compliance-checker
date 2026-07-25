import type { Classification } from '../classification/classifications.js';

/**
 * Module 10 — Finding record + severity model.
 *
 * Every finding is traceable (authority_refs non-empty), scoped, tracked, and
 * carries an investigation question. AI-drafted conclusions are separate and
 * gated (proposed_conclusion is always DRAFT_PENDING_ATTORNEY_REVIEW).
 */

export type FindingScope = 'as_written' | 'in_operation' | 'structural';
export type FindingTrack = 'regulatory' | 'litigation' | 'both';

export type Severity =
  | 'facial_violation'
  | 'significant_indicator'
  | 'potential_indicator'
  | 'documentation_gap'
  | 'insufficient_data'
  | 'compliant';

export type Confidence = 'high' | 'medium' | 'low';

export interface DocumentEvidence {
  kind: 'document';
  sourceDocumentId: string;
  page?: number;
  section?: string;
  quotedText: string;
}

export interface StatisticalEvidence {
  kind: 'statistical';
  metric: string;
  msValue: number;
  mhsudValue: number;
  ratio: number;
  diff: number;
  nMs: number;
  nMhsud: number;
  pValue?: number;
  pAdjusted?: number;
  ciLow?: number;
  ciHigh?: number;
  testUsed?: string;
}

export interface ComputationEvidence {
  kind: 'computation';
  description: string;
  values: Record<string, number | string | boolean | null>;
}

export type Evidence = DocumentEvidence | StatisticalEvidence | ComputationEvidence;

export type ReviewStatus = 'DRAFT_PENDING_ATTORNEY_REVIEW';

export interface ProposedConclusion {
  text: string;
  status: ReviewStatus; // always DRAFT_PENDING_ATTORNEY_REVIEW when set
  promptTemplateId: string | null;
  promptVersion: string | null;
  modelId: string | null;
}

export interface AttorneyDisposition {
  userId: string;
  action: 'approved' | 'edited' | 'rejected' | 'returned';
  editedText?: string;
  timestamp: string;
}

export interface Finding {
  id: string;
  analysisId: string;
  nqtlId?: string;
  classificationId?: Classification;
  subclassificationId?: string;
  scope: FindingScope;
  track: FindingTrack;
  /** Required, non-empty: ruleset ids and/or caselaw rule ids. */
  authorityRefs: string[];
  evidence: Evidence[];
  severity: Severity;
  confidence: Confidence;
  investigationQuestion: string;
  /** Short human title for report/UI. */
  title: string;
  detail: string;
  proposedConclusion: ProposedConclusion | null;
  attorneyDisposition: AttorneyDisposition | null;
  /** 'advisory' when every authority_ref is an advisory ruleset (segregated in report). */
  advisory?: boolean;
  /** Populated by the risk model (src/findings/risk.ts) for ranking. */
  risk?: RiskAssessment;
}

export type RiskTier = 'critical' | 'high' | 'medium' | 'low' | 'informational';

export interface RiskAssessment {
  /** 0-100. Higher = more likely a real, currently-enforceable parity problem worth attention. */
  score: number;
  tier: RiskTier;
  /** Human-readable factor breakdown for transparency. */
  factors: Record<string, number>;
}

export class FindingIntegrityError extends Error {}

/**
 * Severity guard (Non-negotiable #4): nothing derived from claims/outcome data
 * may be classified facial_violation. facial_violation is reserved for the
 * bright-line statutory/regulatory prohibitions requiring no comparative
 * judgment. This is enforced when a finding is created.
 */
export function assertSeverityInvariant(f: Finding): void {
  if (f.severity === 'facial_violation' && f.scope === 'in_operation') {
    throw new FindingIntegrityError(
      `Finding '${f.id}' is scope=in_operation but severity=facial_violation. ` +
        `Outcome/claims data can never establish a facial violation — it is a warning sign at most.`,
    );
  }
  if (f.authorityRefs.length === 0) {
    throw new FindingIntegrityError(`Finding '${f.id}' has empty authority_refs (required, non-empty).`);
  }
  if (f.proposedConclusion && f.proposedConclusion.status !== 'DRAFT_PENDING_ATTORNEY_REVIEW') {
    throw new FindingIntegrityError(
      `Finding '${f.id}' proposed_conclusion must be DRAFT_PENDING_ATTORNEY_REVIEW until the attorney gate approves it.`,
    );
  }
}

/** Ranking for report ordering: most severe first. */
export const SEVERITY_RANK: Record<Severity, number> = {
  facial_violation: 0,
  significant_indicator: 1,
  potential_indicator: 2,
  documentation_gap: 3,
  insufficient_data: 4,
  compliant: 5,
};

export function compareSeverity(a: Finding, b: Finding): number {
  return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
}
