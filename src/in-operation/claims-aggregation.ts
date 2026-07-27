import { classifyClaim } from '../classification/classifier.js';
import type { Classification } from '../classification/classifications.js';
import type { RateComparisonInput } from './metrics.js';

/**
 * Claims aggregation — turns de-identified claim rows into the per-classification
 * MH/SUD-vs-M/S event/denominator counts the in-operation metrics engine needs.
 *
 * This is the glue between the classifier and the statistics engine: each claim
 * is classified deterministically, bucketed by classification × benefit type,
 * and reduced to denial (and OON-utilization) counts. The metrics engine then
 * applies the n>=30 gate and the tests. Outcome disparities remain warning
 * signs, never conclusions.
 */

function truthy(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'y' || s === 'yes' || s === 'd' || s === 'denied';
}

interface Bucket {
  msDenied: number;
  msTotal: number;
  mhDenied: number;
  mhTotal: number;
  msOon: number;
  mhOon: number;
}

function emptyBucket(): Bucket {
  return { msDenied: 0, msTotal: 0, mhDenied: 0, mhTotal: 0, msOon: 0, mhOon: 0 };
}

export interface ClaimsAggregation {
  rateComparisons: RateComparisonInput[];
  classifiedCount: number;
  quarantinedCount: number;
  msCount: number;
  mhsudCount: number;
  byClassification: Record<string, Bucket>;
}

/** Aggregate canonical claim rows into in-operation rate comparisons. */
export function aggregateClaimsForInOperation(records: Array<Record<string, string>>): ClaimsAggregation {
  const byClass = new Map<Classification, Bucket>();
  let classifiedCount = 0;
  let quarantinedCount = 0;
  let msCount = 0;
  let mhsudCount = 0;

  for (const r of records) {
    const c = classifyClaim({
      placeOfService: r.place_of_service,
      revenueCode: r.revenue_code,
      procedureCode: r.procedure_code,
      primaryDiagnosis: r.diagnosis_code,
      secondaryDiagnoses: r.diagnosis_code_secondary ? r.diagnosis_code_secondary.split(/[,|;]/).map((s) => s.trim()) : undefined,
      providerTaxonomy: r.provider_taxonomy,
      networkStatus: r.network_status,
      claimType: r.claim_type,
    });
    if (c.quarantined || c.classification === 'QUARANTINE') {
      quarantinedCount += 1;
      continue;
    }
    if (c.benefitType === 'indeterminate') {
      quarantinedCount += 1;
      continue;
    }
    classifiedCount += 1;
    const bucket = byClass.get(c.classification) ?? byClass.set(c.classification, emptyBucket()).get(c.classification)!;
    const denied = truthy(r.denied_flag);
    const oon = c.network === 'out_of_network';
    if (c.benefitType === 'MHSUD') {
      mhsudCount += 1;
      bucket.mhTotal += 1;
      if (denied) bucket.mhDenied += 1;
      if (oon) bucket.mhOon += 1;
    } else {
      msCount += 1;
      bucket.msTotal += 1;
      if (denied) bucket.msDenied += 1;
      if (oon) bucket.msOon += 1;
    }
  }

  const rateComparisons: RateComparisonInput[] = [];
  const byClassification: Record<string, Bucket> = {};
  for (const [classification, b] of byClass) {
    byClassification[classification] = b;
    // Denial rate per classification (both sides must have claims to compare).
    if (b.msTotal > 0 && b.mhTotal > 0) {
      rateComparisons.push({
        metricId: 'denial_rate',
        classification,
        mhsud: { events: b.mhDenied, n: b.mhTotal },
        ms: { events: b.msDenied, n: b.msTotal },
      });
    }
  }

  return { rateComparisons, classifiedCount, quarantinedCount, msCount, mhsudCount, byClassification };
}
