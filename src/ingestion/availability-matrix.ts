import type { CanonicalDataset } from './canonical-schema.js';
import type { IngestResult } from './ingest.js';

/**
 * Data availability matrix (Module 2).
 *
 * Before running anything, the engine reports which tests it can run, which it
 * cannot, and exactly which artifact/field is missing for each it cannot. The
 * 2024 rule contemplates documenting WHY relevant data is unavailable
 * (§ 146.136(c)(4)(iii)(A)(3)); this matrix is that documentation, and it drives
 * the TPA data-request letter. A "cannot test, here's why, here's the letter to
 * send your TPA" output is a first-class deliverable, not a silent skip.
 */

export interface AnalysisFeature {
  id: string;
  label: string;
  scope: 'as_written' | 'in_operation';
  requiredDatasets: CanonicalDataset[];
  requiredFields: string[];
  /** Artifact a customer would need to supply if missing. */
  sourceArtifact: string;
}

/** Registry of the data-dependent (mostly in-operation) analysis features. */
export const ANALYSIS_FEATURES: AnalysisFeature[] = [
  {
    id: 'denial_rate',
    label: 'Claims denial rate by classification',
    scope: 'in_operation',
    requiredDatasets: ['claims'],
    requiredFields: ['denied_flag', 'diagnosis_code', 'network_status'],
    sourceArtifact: 'Claims extract (professional + facility)',
  },
  {
    id: 'denial_rate_by_reason',
    label: 'Denial rate by reason category (administrative / medical necessity / benefit exclusion)',
    scope: 'in_operation',
    requiredDatasets: ['claims'],
    requiredFields: ['denied_flag', 'denial_reason_code'],
    sourceArtifact: 'Remittance / adjudication data (835 preferred)',
  },
  {
    id: 'pa_request_rate',
    label: 'Prior authorization request rate',
    scope: 'in_operation',
    requiredDatasets: ['prior_auth'],
    requiredFields: ['pa_requested_flag'],
    sourceArtifact: 'Prior auth / precertification log',
  },
  {
    id: 'pa_approval_rate',
    label: 'Prior authorization approval/denial rate',
    scope: 'in_operation',
    requiredDatasets: ['prior_auth'],
    requiredFields: ['pa_decision'],
    sourceArtifact: 'Prior auth / precertification log',
  },
  {
    id: 'concurrent_review_freq',
    label: 'Concurrent / continued-stay review frequency and interval',
    scope: 'in_operation',
    requiredDatasets: ['concurrent_review'],
    requiredFields: ['review_type'],
    sourceArtifact: 'Concurrent / continued-stay review log',
  },
  {
    id: 'overturn_rate',
    label: 'Appeal and overturn rate (internal + external)',
    scope: 'in_operation',
    requiredDatasets: ['appeals'],
    requiredFields: ['appeal_level', 'appeal_outcome'],
    sourceArtifact: 'Appeals and external review log',
  },
  {
    id: 'oon_utilization',
    label: 'Out-of-network utilization rate (network adequacy proxy)',
    scope: 'in_operation',
    requiredDatasets: ['claims'],
    requiredFields: ['network_status', 'allowed_amount'],
    sourceArtifact: 'Claims extract',
  },
  {
    id: 'network_composition',
    label: 'Network composition / adequacy by specialty',
    scope: 'in_operation',
    requiredDatasets: ['network'],
    requiredFields: ['specialty'],
    sourceArtifact: 'Network directory + credentialing roster',
  },
  {
    id: 'reimbursement_vs_medicare',
    label: 'Provider reimbursement as % of Medicare (Self-Compliance Tool Appendix II)',
    scope: 'in_operation',
    requiredDatasets: ['reimbursement'],
    requiredFields: ['fee_schedule_rate'],
    sourceArtifact: 'Provider reimbursement / fee schedule extract + CMS Medicare PFS reference',
  },
  {
    id: 'cost_share',
    label: 'Average allowed amount and member cost share per episode',
    scope: 'in_operation',
    requiredDatasets: ['claims'],
    requiredFields: ['allowed_amount', 'paid_amount'],
    sourceArtifact: 'Claims extract',
  },
  {
    id: 'qtl_denominator',
    label: 'QTL substantially-all denominator (plan payments by classification)',
    scope: 'in_operation',
    requiredDatasets: ['claims'],
    requiredFields: ['paid_amount', 'diagnosis_code'],
    sourceArtifact: 'Claims extract',
  },
];

export interface FeatureAvailability {
  feature: AnalysisFeature;
  runnable: boolean;
  missingDatasets: CanonicalDataset[];
  missingFields: string[];
  reason: string;
}

export interface AvailabilityMatrix {
  runnable: FeatureAvailability[];
  blocked: FeatureAvailability[];
  /** Distinct artifacts that would unblock at least one feature. */
  missingArtifacts: string[];
}

export function buildAvailabilityMatrix(ingested: IngestResult[]): AvailabilityMatrix {
  const byDataset = new Map<CanonicalDataset, Set<string>>();
  for (const ing of ingested) {
    const set = byDataset.get(ing.dataset) ?? new Set<string>();
    for (const cf of Object.keys(ing.mapping.resolved)) set.add(cf);
    byDataset.set(ing.dataset, set);
  }

  const runnable: FeatureAvailability[] = [];
  const blocked: FeatureAvailability[] = [];
  const missingArtifacts = new Set<string>();

  for (const feature of ANALYSIS_FEATURES) {
    const missingDatasets = feature.requiredDatasets.filter((d) => !byDataset.has(d));
    const availableFields = new Set<string>();
    for (const d of feature.requiredDatasets) {
      for (const f of byDataset.get(d) ?? []) availableFields.add(f);
    }
    const missingFields = feature.requiredFields.filter((f) => !availableFields.has(f));

    const av: FeatureAvailability = {
      feature,
      runnable: missingDatasets.length === 0 && missingFields.length === 0,
      missingDatasets,
      missingFields,
      reason:
        missingDatasets.length > 0
          ? `Missing dataset(s): ${missingDatasets.join(', ')}. Supply: ${feature.sourceArtifact}.`
          : missingFields.length > 0
            ? `Missing field(s): ${missingFields.join(', ')} in ${feature.requiredDatasets.join('/')}.`
            : 'All required data present.',
    };
    if (av.runnable) runnable.push(av);
    else {
      blocked.push(av);
      missingArtifacts.add(feature.sourceArtifact);
    }
  }

  return { runnable, blocked, missingArtifacts: [...missingArtifacts].sort() };
}
