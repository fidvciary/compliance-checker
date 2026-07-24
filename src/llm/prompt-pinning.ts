import { contentHash } from '../util/hash.js';
import type { AuditLog } from '../audit/audit-log.js';
import type { CandidatePassage } from '../analysis/warning-sign-scanner.js';

/**
 * LLM boundary + prompt-version pinning (Non-negotiable #6 and #3).
 *
 * The LLM has EXACTLY TWO allowed roles in this engine:
 *   (a) locate/extract candidate plan language from unstructured documents, and
 *   (b) draft narrative prose.
 * An LLM never decides whether a rule fired and never produces a legal
 * conclusion that reaches a FINAL artifact. Its outputs are non-authoritative:
 * extracted passages are fed to the DETERMINISTIC warning-sign scanner, and
 * drafted narrative is gated by the sufficiency linter and the attorney review
 * gate.
 *
 * Every LLM call is recorded with prompt_template_id, prompt_version, model_id,
 * and a hash of the rendered prompt. Reports store the set of prompt versions
 * used (collected via `collectPromptVersions`).
 */

export interface LlmCallRecord {
  promptTemplateId: string;
  promptVersion: string;
  modelId: string;
  /** SHA-256 of the exact rendered prompt string. */
  promptHash: string;
}

export interface LlmCallSpec {
  promptTemplateId: string;
  promptVersion: string;
  modelId: string;
  renderedPrompt: string;
  /** 'extract' (role a) or 'draft' (role b). */
  role: 'extract' | 'draft';
}

/** Record an LLM call in the audit log with prompt-version pinning. */
export function recordLlmCall(audit: AuditLog, spec: LlmCallSpec): LlmCallRecord {
  const promptHash = contentHash(spec.renderedPrompt);
  audit.append('llm.call', `llm:${spec.modelId}`, {
    role: spec.role,
    promptTemplateId: spec.promptTemplateId,
    promptVersion: spec.promptVersion,
    modelId: spec.modelId,
    promptHash,
  });
  return { promptTemplateId: spec.promptTemplateId, promptVersion: spec.promptVersion, modelId: spec.modelId, promptHash };
}

/** Collect the distinct prompt versions used in a run, for the report record. */
export function collectPromptVersions(records: LlmCallRecord[]): Array<{ promptTemplateId: string; promptVersion: string; modelId: string }> {
  const seen = new Map<string, { promptTemplateId: string; promptVersion: string; modelId: string }>();
  for (const r of records) {
    const key = `${r.promptTemplateId}@${r.promptVersion}#${r.modelId}`;
    if (!seen.has(key)) seen.set(key, { promptTemplateId: r.promptTemplateId, promptVersion: r.promptVersion, modelId: r.modelId });
  }
  return [...seen.values()];
}

/**
 * Role (a): candidate-passage extraction. A real adapter implements this against
 * an LLM; the returned passages are NON-AUTHORITATIVE and are handed to the
 * deterministic warning-sign scanner, which is what classifies them.
 */
export interface CandidateExtractor {
  extractCandidatePassages(documentId: string, text: string, spec: Omit<LlmCallSpec, 'renderedPrompt' | 'role'>): Promise<CandidatePassage[]>;
}

/**
 * Role (b): narrative drafting. A real adapter implements this; every draft is
 * emitted with status DRAFT_PENDING_ATTORNEY_REVIEW, run through the sufficiency
 * linter, and cannot reach a FINAL artifact without attorney approval.
 */
export interface NarrativeDrafter {
  draftNarrative(context: string, spec: Omit<LlmCallSpec, 'renderedPrompt' | 'role'>): Promise<{ text: string; call: LlmCallRecord }>;
}
