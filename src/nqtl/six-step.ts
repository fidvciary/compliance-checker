import type { Classification } from '../classification/classifications.js';
import type { SideProfile, FactorAsymmetry } from './factors.js';

/**
 * Six-step comparative-analysis record (45 CFR § 146.137(c)).
 *
 * SCHEMA CARDINALITY (WV submission-form rule): each record covers exactly one
 * NQTL × one classification × (optional) one sub-classification. A record
 * structurally CANNOT span multiple classifications — `classification` is a
 * single value, not an array — and the registry rejects duplicate keys. Prior
 * auth for inpatient in-network is a distinct record from inpatient
 * out-of-network; combining analyses across classifications is prohibited.
 */

export type ReviewStatus = 'DRAFT_PENDING_ATTORNEY_REVIEW';

export interface NarrativeDraft {
  text: string;
  status: ReviewStatus;
  promptTemplateId: string | null;
  promptVersion: string | null;
  modelId: string | null;
}

export interface Step1Description {
  nqtlDescription: string;
  /** References to quoted plan language (document/page/section anchors). */
  planTermRefs: Array<{ documentId: string; page?: number; section?: string; quotedText: string }>;
  msBenefitsApplied: string[];
  mhsudBenefitsApplied: string[];
  narrative: NarrativeDraft | null;
}

export interface Step2Factors {
  ms: SideProfile;
  mhsud: SideProfile;
  /** Populated by the symmetry cross-check; any entry is an automatic finding. */
  asymmetries: FactorAsymmetry[];
  narrative: NarrativeDraft | null;
}

export interface Step3Application {
  narrative: NarrativeDraft | null;
}

export interface Step4AsWritten {
  /** Finding ids emitted by the as-written comparability engine (Module 8). */
  findingIds: string[];
  narrative: NarrativeDraft | null;
}

export interface Step5InOperation {
  performed: boolean;
  /** When not performed (as-written-only scope), the required limitation text. */
  notPerformedReason?: string;
  findingIds: string[];
  narrative: NarrativeDraft | null;
}

export interface Step6Findings {
  findingIds: string[];
  narrative: NarrativeDraft | null;
}

export interface SixStepRecord {
  id: string; // `${nqtlId}::${classification}::${subclassKey ?? '-'}`
  nqtlId: string;
  classification: Classification; // exactly one — cannot span classifications
  subclassKey?: string;
  step1: Step1Description;
  step2: Step2Factors;
  step3: Step3Application;
  step4: Step4AsWritten;
  step5: Step5InOperation;
  step6: Step6Findings;
}

export function sixStepKey(nqtlId: string, classification: Classification, subclassKey?: string): string {
  return `${nqtlId}::${classification}::${subclassKey ?? '-'}`;
}

/**
 * Collection that enforces the one-record-per-(NQTL×classification×subclass)
 * cardinality. Adding a record whose key already exists throws; there is no API
 * to merge records across classifications.
 */
export class SixStepRegistry {
  private readonly records = new Map<string, SixStepRecord>();

  add(record: SixStepRecord): void {
    if (record.id !== sixStepKey(record.nqtlId, record.classification, record.subclassKey)) {
      throw new Error(`SixStepRecord id '${record.id}' does not match its key components.`);
    }
    if (this.records.has(record.id)) {
      throw new Error(
        `Duplicate six-step record '${record.id}'. Each NQTL × classification × sub-classification ` +
          `must have exactly one analysis; combining across classifications is prohibited.`,
      );
    }
    this.records.set(record.id, record);
  }

  get(id: string): SixStepRecord | undefined {
    return this.records.get(id);
  }

  all(): SixStepRecord[] {
    return [...this.records.values()];
  }

  forClassification(c: Classification): SixStepRecord[] {
    return this.all().filter((r) => r.classification === c);
  }

  forNqtl(nqtlId: string): SixStepRecord[] {
    return this.all().filter((r) => r.nqtlId === nqtlId);
  }

  get size(): number {
    return this.records.size;
  }
}
