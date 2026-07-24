import { describe, it, expect } from 'vitest';
import { recordLlmCall, collectPromptVersions } from '../src/llm/prompt-pinning.js';
import { AuditLog } from '../src/audit/audit-log.js';
import { fixedClock } from '../src/util/clock.js';

describe('prompt-version pinning (Non-negotiable #6)', () => {
  it('records prompt_template_id, prompt_version, model_id, and a rendered-prompt hash', () => {
    const audit = new AuditLog(fixedClock('2026-07-24T00:00:00Z', 1));
    const rec = recordLlmCall(audit, {
      promptTemplateId: 'extract.warning-sign.v1',
      promptVersion: '1.2.0',
      modelId: 'claude-x',
      renderedPrompt: 'Extract candidate NQTL passages from: ...',
      role: 'extract',
    });
    expect(rec.promptHash).toMatch(/^[a-f0-9]{64}$/);
    const entry = audit.filter('llm.call')[0]!;
    expect((entry.payload as { promptTemplateId: string }).promptTemplateId).toBe('extract.warning-sign.v1');
    expect((entry.payload as { promptHash: string }).promptHash).toBe(rec.promptHash);
    // the audit payload never stores the raw prompt text, only its hash
    expect(JSON.stringify(entry.payload)).not.toContain('Extract candidate');
  });

  it('hashes identical prompts identically and different prompts differently', () => {
    const audit = new AuditLog(fixedClock('2026-07-24T00:00:00Z', 1));
    const a = recordLlmCall(audit, { promptTemplateId: 't', promptVersion: '1', modelId: 'm', renderedPrompt: 'same', role: 'draft' });
    const b = recordLlmCall(audit, { promptTemplateId: 't', promptVersion: '1', modelId: 'm', renderedPrompt: 'same', role: 'draft' });
    const c = recordLlmCall(audit, { promptTemplateId: 't', promptVersion: '1', modelId: 'm', renderedPrompt: 'different', role: 'draft' });
    expect(a.promptHash).toBe(b.promptHash);
    expect(a.promptHash).not.toBe(c.promptHash);
  });

  it('collects the distinct prompt versions used in a run', () => {
    const versions = collectPromptVersions([
      { promptTemplateId: 't1', promptVersion: '1', modelId: 'm', promptHash: 'x' },
      { promptTemplateId: 't1', promptVersion: '1', modelId: 'm', promptHash: 'y' },
      { promptTemplateId: 't2', promptVersion: '2', modelId: 'm', promptHash: 'z' },
    ]);
    expect(versions).toHaveLength(2);
  });
});
