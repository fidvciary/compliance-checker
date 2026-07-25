import type { CandidatePassage } from '../analysis/warning-sign-scanner.js';
import { MHSUD_TERMS } from '../analysis/nqtl-warning-signs.js';
import type { Classification } from '../classification/classifications.js';

/**
 * Schedule-of-Benefits cost-share extractor (deterministic).
 *
 * Pulls cost-share LEVELS (copay / coinsurance / deductible / day-/visit-limit)
 * out of Summary-of-Benefits text and pairs MH/SUD against M/S within the same
 * classification, so a facially more-restrictive MH/SUD cost share is caught
 * straight from an uploaded document.
 *
 * HONEST LIMITATION: a Schedule of Benefits gives the LEVELS but not the
 * dollar-weighted claims denominator the full substantially-all / predominant
 * test requires. This module therefore does a DIRECT LEVEL comparison (a strong
 * as-written indicator), not the dollar-weighted QTL math. When a claims extract
 * is available, the levels can feed the full QTL engine; until then, this is a
 * facial cost-share comparison and is labeled as such.
 */

export type FrType = 'copay' | 'coinsurance' | 'deductible' | 'day_limit' | 'visit_limit';
export type NetworkCol = 'in_network' | 'out_of_network' | 'unspecified';

export interface CostShareRow {
  serviceText: string;
  classification: Classification | 'unknown';
  benefitType: 'MS' | 'MHSUD' | 'unknown';
  frType: FrType;
  level: number;
  network: NetworkCol;
  anchor: { documentId: string; page?: number; section?: string };
}

const COPAY_RE = /\$(\d+(?:\.\d{2})?)\s*(?:copay|copayment|co-?pay)\b/gi;
const COINS_RE = /(\d+(?:\.\d+)?)\s*%\s*(?:coinsurance|co-?insurance)\b/gi;
const DEDUCT_RE = /\$(\d[\d,]*)\s*deductible\b/gi;
const DAY_LIMIT_RE = /\b(?:limited to|maximum of|up to|no more than)\s*(\d+)\s*days?\b/gi;
const VISIT_LIMIT_RE = /\b(?:limited to|maximum of|up to|no more than)\s*(\d+)\s*visits?\b/gi;

const HIGHER_IS_MORE_RESTRICTIVE: Record<FrType, boolean> = {
  copay: true,
  coinsurance: true,
  deductible: true,
  day_limit: false,
  visit_limit: false,
};

function classify(serviceText: string, section: string | undefined): Classification | 'unknown' {
  const s = `${serviceText} ${section ?? ''}`.toLowerCase();
  const oon = /(out-?of-?network|non-?par|oon)/.test(s);
  if (/(emergency|\ber\b|emergency room)/.test(s)) return 'emergency_care';
  if (/(prescription|pharmacy|\brx\b|formulary)/.test(s)) return 'prescription_drugs';
  if (/(inpatient|hospital admission|residential|admission)/.test(s)) return oon ? 'inpatient_out_of_network' : 'inpatient_in_network';
  if (/(outpatient|office visit|office|specialist|primary care|therapy|counseling|visit)/.test(s)) return oon ? 'outpatient_out_of_network' : 'outpatient_in_network';
  return 'unknown';
}

function benefitTypeOf(serviceText: string, section: string | undefined): 'MS' | 'MHSUD' | 'unknown' {
  const s = `${serviceText} ${section ?? ''}`;
  if (MHSUD_TERMS.test(s)) return 'MHSUD';
  // Clear M/S services
  if (/(surgery|surgical|maternity|cardiac|orthopedic|physical therapy|radiology|imaging|office visit|primary care|specialist visit|hospital)/i.test(s)) return 'MS';
  return 'unknown';
}

function networkOf(text: string, section: string | undefined): NetworkCol {
  const s = `${text} ${section ?? ''}`.toLowerCase();
  if (/(out-?of-?network|non-?par|\boon\b)/.test(s)) return 'out_of_network';
  if (/(in-?network|\binn\b|participating|\bpar\b)/.test(s)) return 'in_network';
  return 'unspecified';
}

/** Extract cost-share rows from candidate passages (each a service line/sentence). */
export function extractCostShares(passages: CandidatePassage[]): CostShareRow[] {
  const rows: CostShareRow[] = [];
  for (const p of passages) {
    const service = p.text;
    const classification = classify(service, p.section);
    const benefitType = benefitTypeOf(service, p.section);
    const network = networkOf(service, p.section);
    const anchor = { documentId: p.documentId, ...(p.page !== undefined ? { page: p.page } : {}), ...(p.section !== undefined ? { section: p.section } : {}) };

    const add = (frType: FrType, level: number) =>
      rows.push({ serviceText: service.slice(0, 160), classification, benefitType, frType, level, network, anchor });

    for (const m of service.matchAll(COPAY_RE)) add('copay', Number(m[1]));
    for (const m of service.matchAll(COINS_RE)) add('coinsurance', Number(m[1]));
    for (const m of service.matchAll(DEDUCT_RE)) add('deductible', Number(m[1]!.replace(/,/g, '')));
    for (const m of service.matchAll(DAY_LIMIT_RE)) add('day_limit', Number(m[1]));
    for (const m of service.matchAll(VISIT_LIMIT_RE)) add('visit_limit', Number(m[1]));
  }
  return rows;
}

export interface CostShareLevelFinding {
  classification: Classification;
  frType: FrType;
  network: NetworkCol;
  msLevel: number;
  mhsudLevel: number;
  msServiceText: string;
  mhsudServiceText: string;
  msAnchor: CostShareRow['anchor'];
  mhsudAnchor: CostShareRow['anchor'];
  detail: string;
  authorityRefs: string[];
}

/**
 * Direct cost-share level comparison. Within each (classification × FR type ×
 * network) that has both an M/S and a MH/SUD level, flag when the MH/SUD level
 * is MORE restrictive (higher copay/coins/deductible, or fewer days/visits).
 */
export function compareCostShareLevels(rows: CostShareRow[]): CostShareLevelFinding[] {
  const findings: CostShareLevelFinding[] = [];
  const groups = new Map<string, CostShareRow[]>();
  for (const r of rows) {
    if (r.classification === 'unknown' || r.benefitType === 'unknown') continue;
    const key = `${r.classification}::${r.frType}::${r.network}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
  }

  for (const [key, groupRows] of groups) {
    const [classification, frType] = key.split('::') as [Classification, FrType];
    const ms = groupRows.filter((r) => r.benefitType === 'MS');
    const mh = groupRows.filter((r) => r.benefitType === 'MHSUD');
    if (ms.length === 0 || mh.length === 0) continue;

    const higherWorse = HIGHER_IS_MORE_RESTRICTIVE[frType];
    // Representative M/S level = the LEAST restrictive M/S level (most favorable
    // to the plan's parity position); MH/SUD = its MOST restrictive level.
    const msRep = higherWorse ? Math.min(...ms.map((r) => r.level)) : Math.max(...ms.map((r) => r.level));
    const mhRep = higherWorse ? Math.max(...mh.map((r) => r.level)) : Math.min(...mh.map((r) => r.level));
    const moreRestrictive = higherWorse ? mhRep > msRep : mhRep < msRep;
    if (!moreRestrictive) continue;

    const msRow = ms.find((r) => r.level === msRep)!;
    const mhRow = mh.find((r) => r.level === mhRep)!;
    findings.push({
      classification,
      frType,
      network: msRow.network,
      msLevel: msRep,
      mhsudLevel: mhRep,
      msServiceText: msRow.serviceText,
      mhsudServiceText: mhRow.serviceText,
      msAnchor: msRow.anchor,
      mhsudAnchor: mhRow.anchor,
      detail:
        `In ${classification}, the MH/SUD ${frType.replace('_', ' ')} (${fmt(frType, mhRep)}) is more restrictive than the M/S ${frType.replace('_', ' ')} (${fmt(frType, msRep)}). ` +
        `This is a facial cost-share comparison from the Schedule of Benefits; the full substantially-all/predominant test additionally requires the dollar-weighted claims denominator.`,
      authorityRefs: ['federal:statute', 'federal:2013'],
    });
  }
  return findings;
}

function fmt(frType: FrType, level: number): string {
  if (frType === 'coinsurance') return `${level}%`;
  if (frType === 'copay' || frType === 'deductible') return `$${level}`;
  if (frType === 'day_limit') return `${level} days`;
  return `${level} visits`;
}
