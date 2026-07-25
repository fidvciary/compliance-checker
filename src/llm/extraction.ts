import type { AuditLog } from '../audit/audit-log.js';
import { recordLlmCall, type LlmCallRecord } from './prompt-pinning.js';
import type { CandidatePassage } from '../analysis/warning-sign-scanner.js';
import type { CostShareRow, FrType } from '../ingestion/schedule-of-benefits.js';
import { extractCostShares as deterministicExtract } from '../ingestion/schedule-of-benefits.js';
import type { PlanFacts } from '../analysis/caselaw/predicates.js';

/**
 * LLM extraction adapter (role a: locate/extract candidate facts from prose).
 *
 * The division of labor is strict (Non-negotiable #3): the LLM only FINDS raw
 * facts that regex struggles with in prose/tables — "service X carries cost
 * share Y", or "the criteria are proprietary". Deterministic code then does all
 * classification and every compliance decision:
 *   - extracted cost-share tuples are classified deterministically and fed to
 *     the SAME compareCostShareLevels engine;
 *   - extracted plan facts feed the SAME case-law predicates, which fire ONLY
 *     attorney-verified (active) rules.
 * So an LLM can never decide whether a rule fired, and its output is validated
 * before use. Every call is prompt-version pinned in the audit log.
 *
 * The client is injectable: pass a real Anthropic-backed client in production,
 * or a FakeLlmClient in tests. This module has NO hard dependency on a live API.
 */

export interface LlmClient {
  /** Return the model's raw text response for a rendered prompt. */
  complete(req: { model: string; system?: string; prompt: string }): Promise<string>;
}

export const EXTRACTION_PROMPTS = {
  costShare: {
    id: 'extract.cost-share',
    version: '1.0.0',
    system:
      'You extract cost-share facts from health-plan benefit text. Return ONLY a JSON array of objects ' +
      '{"serviceText": string, "frType": "copay"|"coinsurance"|"deductible"|"day_limit"|"visit_limit", ' +
      '"level": number, "network": "in_network"|"out_of_network"|"unspecified"}. No prose, no classification, ' +
      'no compliance judgment. If none, return [].',
  },
  planFacts: {
    id: 'extract.plan-facts',
    version: '1.0.0',
    system:
      'You extract structured plan facts for parity screening. Return ONLY a JSON object matching the PlanFacts ' +
      'schema (booleans and enums). Do not judge compliance. Omit fields you cannot determine.',
  },
} as const;

function parseJson<T>(raw: string, ctx: string): T {
  // Tolerate models that wrap JSON in ``` fences.
  const cleaned = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    throw new Error(`LLM ${ctx} did not return valid JSON. Output is non-authoritative and was rejected.`);
  }
}

const VALID_FR_TYPES: FrType[] = ['copay', 'coinsurance', 'deductible', 'day_limit', 'visit_limit'];

export class LlmExtractor {
  constructor(
    private readonly client: LlmClient,
    private readonly model: string,
    private readonly audit?: AuditLog,
  ) {}

  /**
   * Role (a): extract cost-share tuples from prose, then build CostShareRows
   * DETERMINISTICALLY (classification + benefit-typing are not the LLM's job).
   */
  async extractCostShares(text: string, documentId: string, section?: string): Promise<{ rows: CostShareRow[]; call: LlmCallRecord }> {
    const tmpl = EXTRACTION_PROMPTS.costShare;
    const prompt = `${tmpl.system}\n\nTEXT:\n${text}`;
    const call = this.audit
      ? recordLlmCall(this.audit, { promptTemplateId: tmpl.id, promptVersion: tmpl.version, modelId: this.model, renderedPrompt: prompt, role: 'extract' })
      : { promptTemplateId: tmpl.id, promptVersion: tmpl.version, modelId: this.model, promptHash: '' };
    const raw = await this.client.complete({ model: this.model, system: tmpl.system, prompt });
    const tuples = parseJson<Array<{ serviceText: string; frType: string; level: number; network?: string }>>(raw, 'cost-share extraction');

    // Build passages from the LLM tuples and run the DETERMINISTIC extractor so
    // classification/benefit-typing stay in code. We synthesize a normalized
    // sentence per tuple so the deterministic regex/classifier can consume it.
    const passages: CandidatePassage[] = [];
    for (const t of tuples) {
      if (!VALID_FR_TYPES.includes(t.frType as FrType) || typeof t.level !== 'number') continue;
      const unit = t.frType === 'coinsurance' ? `${t.level}% coinsurance` : t.frType === 'copay' ? `$${t.level} copay` : t.frType === 'deductible' ? `$${t.level} deductible` : `limited to ${t.level} ${t.frType === 'day_limit' ? 'days' : 'visits'}`;
      const net = t.network === 'out_of_network' ? ' out-of-network' : t.network === 'in_network' ? ' in-network' : '';
      passages.push({ documentId, ...(section ? { section } : {}), text: `${t.serviceText}${net}: ${unit}` });
    }
    const rows = deterministicExtract(passages);
    return { rows, call };
  }

  /** Role (a): extract plan facts for case-law screening (feeds active rules only). */
  async extractPlanFacts(text: string): Promise<{ facts: PlanFacts; call: LlmCallRecord }> {
    const tmpl = EXTRACTION_PROMPTS.planFacts;
    const prompt = `${tmpl.system}\n\nTEXT:\n${text}`;
    const call = this.audit
      ? recordLlmCall(this.audit, { promptTemplateId: tmpl.id, promptVersion: tmpl.version, modelId: this.model, renderedPrompt: prompt, role: 'extract' })
      : { promptTemplateId: tmpl.id, promptVersion: tmpl.version, modelId: this.model, promptHash: '' };
    const raw = await this.client.complete({ model: this.model, system: tmpl.system, prompt });
    const facts = parseJson<PlanFacts>(raw, 'plan-facts extraction');
    return { facts, call };
  }
}

/** Deterministic fake client for tests / offline runs. Returns canned JSON. */
export class FakeLlmClient implements LlmClient {
  constructor(private readonly responder: (prompt: string) => string) {}
  async complete(req: { model: string; system?: string; prompt: string }): Promise<string> {
    return this.responder(req.prompt);
  }
}
