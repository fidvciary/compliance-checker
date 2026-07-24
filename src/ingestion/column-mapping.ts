import type { CanonicalDataset } from './canonical-schema.js';
import { fieldsForDataset } from './canonical-schema.js';
import { templatesFor } from './tpa-templates.js';

/**
 * Column mapping: resolve a source file's headers onto canonical field names,
 * preferring a TPA template (exact) and falling back to fuzzy header matching.
 * The resulting profile is persistable per employer/TPA so subsequent files map
 * automatically.
 */

export interface MappingProfile {
  employer: string;
  tpa: string;
  dataset: CanonicalDataset;
  /** canonicalField -> source header */
  map: Record<string, string>;
}

export interface MappingSuggestion {
  canonicalField: string;
  sourceHeader: string | null;
  confidence: number; // 0..1
  method: 'template' | 'fuzzy' | 'unmapped';
}

export interface MappingResult {
  suggestions: MappingSuggestion[];
  /** canonicalField -> source header, for confidently-mapped fields only */
  resolved: Record<string, string>;
  unmapped: string[]; // canonical fields with no confident match
  unusedHeaders: string[]; // source headers not mapped to any canonical field
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Token-set Jaccard + character bigram similarity, averaged. */
export function headerSimilarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return 1;
  if (na.length === 0 || nb.length === 0) return 0;

  const ta = new Set(na.split(' '));
  const tb = new Set(nb.split(' '));
  const inter = [...ta].filter((t) => tb.has(t)).length;
  const union = new Set([...ta, ...tb]).size;
  const jaccard = union === 0 ? 0 : inter / union;

  const bigrams = (s: string): Set<string> => {
    const g = new Set<string>();
    const compact = s.replace(/ /g, '');
    for (let i = 0; i < compact.length - 1; i++) g.add(compact.slice(i, i + 2));
    return g;
  };
  const ga = bigrams(na);
  const gb = bigrams(nb);
  const gi = [...ga].filter((x) => gb.has(x)).length;
  const gu = new Set([...ga, ...gb]).size;
  const dice = gu === 0 ? 0 : (2 * gi) / (ga.size + gb.size);

  return 0.5 * jaccard + 0.5 * dice;
}

/**
 * Aliases seed the fuzzy matcher with domain synonyms so e.g. "DOS" maps to
 * date_of_service and "INN_OON" to network_status even without a TPA template.
 */
const FIELD_ALIASES: Record<string, string[]> = {
  member_id_hashed: ['member id', 'member hash', 'mbr id', 'subscriber id hash', 'member id hashed'],
  claim_id: ['claim number', 'clm nbr', 'claim line id', 'claim'],
  date_of_service: ['dos', 'service date', 'svc date'],
  place_of_service: ['pos', 'place of service code'],
  revenue_code: ['rev code', 'rev cd', 'ub revenue'],
  procedure_code: ['proc code', 'cpt', 'hcpcs', 'cpt hcpcs', 'procedure'],
  diagnosis_code: ['icd', 'icd10', 'primary diagnosis', 'diag code', 'dx'],
  diagnosis_code_secondary: ['other diagnoses', 'secondary dx', 'icd other'],
  provider_npi: ['npi', 'rendering npi'],
  provider_taxonomy: ['taxonomy', 'provider taxonomy code'],
  network_status: ['network indicator', 'inn oon', 'in network out of network', 'ntwk ind', 'par status'],
  claim_type: ['form type', 'claim form type', 'professional facility'],
  billed_amount: ['charge', 'charge amount', 'billed'],
  allowed_amount: ['allowed', 'allowed amount'],
  paid_amount: ['plan paid', 'paid amount', 'plan payment'],
  member_cost_share: ['member liability', 'member responsibility', 'member pay', 'patient responsibility'],
  denied_flag: ['denied', 'denial flag', 'deny flag', 'denied indicator'],
  denial_reason_code: ['denial code', 'deny reason', 'carc'],
  pa_requested_flag: ['prior auth required', 'pa required', 'precert required'],
  pa_decision: ['pa decision', 'auth decision', 'precert decision'],
  appeal_level: ['appeal type', 'appeal level'],
  appeal_outcome: ['appeal outcome', 'appeal result', 'overturn'],
  specialty: ['provider specialty', 'specialty'],
  fee_schedule_rate: ['fee schedule', 'contracted rate', 'allowed rate'],
};

const FUZZY_ACCEPT_THRESHOLD = 0.55;

export interface MapOptions {
  dataset: CanonicalDataset;
  tpa?: string;
  /** A persisted profile takes precedence over template + fuzzy. */
  profile?: MappingProfile;
}

export function mapColumns(headers: string[], opts: MapOptions): MappingResult {
  const canonicalFields = fieldsForDataset(opts.dataset).map((f) => f.name);
  const headerSet = new Set(headers);
  const suggestions: MappingSuggestion[] = [];
  const resolved: Record<string, string> = {};

  const templateMap = opts.tpa ? (templatesFor(opts.tpa, opts.dataset)[0]?.map ?? {}) : {};
  const profileMap = opts.profile?.map ?? {};

  for (const cf of canonicalFields) {
    // 1) persisted profile
    if (profileMap[cf] && headerSet.has(profileMap[cf]!)) {
      resolved[cf] = profileMap[cf]!;
      suggestions.push({ canonicalField: cf, sourceHeader: profileMap[cf]!, confidence: 1, method: 'template' });
      continue;
    }
    // 2) TPA template exact match
    if (templateMap[cf] && headerSet.has(templateMap[cf]!)) {
      resolved[cf] = templateMap[cf]!;
      suggestions.push({ canonicalField: cf, sourceHeader: templateMap[cf]!, confidence: 1, method: 'template' });
      continue;
    }
    // 3) fuzzy match against header, using canonical name + aliases
    const candidates = [cf.replace(/_/g, ' '), ...(FIELD_ALIASES[cf] ?? [])];
    let best: { header: string; score: number } | null = null;
    for (const header of headers) {
      for (const cand of candidates) {
        const score = headerSimilarity(header, cand);
        if (!best || score > best.score) best = { header, score };
      }
    }
    if (best && best.score >= FUZZY_ACCEPT_THRESHOLD) {
      resolved[cf] = best.header;
      suggestions.push({ canonicalField: cf, sourceHeader: best.header, confidence: round(best.score), method: 'fuzzy' });
    } else {
      suggestions.push({
        canonicalField: cf,
        sourceHeader: best?.header ?? null,
        confidence: best ? round(best.score) : 0,
        method: 'unmapped',
      });
    }
  }

  const mappedHeaders = new Set(Object.values(resolved));
  return {
    suggestions,
    resolved,
    unmapped: canonicalFields.filter((cf) => !(cf in resolved)),
    unusedHeaders: headers.filter((h) => !mappedHeaders.has(h)),
  };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
