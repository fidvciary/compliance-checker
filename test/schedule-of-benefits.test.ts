import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { extractCostShares, compareCostShareLevels } from '../src/ingestion/schedule-of-benefits.js';
import { scanPlanDocumentFile } from '../src/ingestion/document-scan.js';
import { planDocumentFromText } from '../src/ingestion/document-reader.js';
import { chunkDocument } from '../src/ingestion/document-chunker.js';
import { LlmExtractor, FakeLlmClient } from '../src/llm/extraction.js';
import { AuditLog } from '../src/audit/audit-log.js';
import { fixedClock } from '../src/util/clock.js';

const here = dirname(fileURLToPath(import.meta.url));
const sobFixture = join(here, 'fixtures', 'summary-of-benefits.txt');

describe('schedule-of-benefits cost-share extraction', () => {
  it('extracts copay and coinsurance levels with classification + benefit type', () => {
    const doc = planDocumentFromText(
      '*TOCLVL2*Mental Health and Substance Use Disorder Benefits*TOCLVL2*\n\nOutpatient mental health office visit: $50 copay in-network.',
      'sob',
    );
    const rows = extractCostShares(chunkDocument(doc, { documentId: 'sob' }));
    const copay = rows.find((r) => r.frType === 'copay');
    expect(copay).toBeDefined();
    expect(copay!.level).toBe(50);
    expect(copay!.benefitType).toBe('MHSUD');
    expect(copay!.classification).toBe('outpatient_in_network');
  });

  it('flags a MH/SUD copay ($50) higher than the M/S office-visit copay ($25)', async () => {
    const result = await scanPlanDocumentFile(sobFixture);
    const copayFinding = result.costShareLevels.find((c) => c.frType === 'copay' && c.classification === 'outpatient_in_network');
    expect(copayFinding).toBeDefined();
    expect(copayFinding!.mhsudLevel).toBe(50);
    expect(copayFinding!.msLevel).toBe(25);
  });

  it('does NOT flag equal coinsurance (20% inpatient both sides)', async () => {
    const result = await scanPlanDocumentFile(sobFixture);
    const inpatientCoins = result.costShareLevels.find((c) => c.frType === 'coinsurance' && c.classification.startsWith('inpatient'));
    // inpatient MH coinsurance 20% == outpatient surgery 20% but different classifications;
    // there is no M/S inpatient coinsurance row, so no comparison fires.
    expect(inpatientCoins).toBeUndefined();
  });

  it('surfaces the cost-share comparison in the document description', async () => {
    const { describeDocumentScan } = await import('../src/ingestion/document-scan.js');
    const result = await scanPlanDocumentFile(sobFixture);
    const desc = describeDocumentScan(result);
    expect(desc).toMatch(/Cost-share level comparison/);
    expect(desc).toMatch(/MH\/SUD \$50 vs M\/S \$25/);
  });
});

describe('LLM extraction adapter (role a) — prose the regex would miss', () => {
  it('extracts cost shares via an injected client, then classifies deterministically', async () => {
    const audit = new AuditLog(fixedClock('2026-07-24T00:00:00Z', 1));
    // A prose sentence with no clean "$50 copay" token adjacency the regex keys on.
    const client = new FakeLlmClient(() =>
      JSON.stringify([
        { serviceText: 'Behavioral health outpatient therapy', frType: 'copay', level: 60, network: 'in_network' },
        { serviceText: 'Primary care office visit', frType: 'copay', level: 20, network: 'in_network' },
      ]),
    );
    const extractor = new LlmExtractor(client, 'claude-x', audit);
    const { rows, call } = await extractor.extractCostShares('...prose...', 'sob');
    expect(rows.length).toBe(2);
    expect(rows.find((r) => r.benefitType === 'MHSUD')!.level).toBe(60);
    // deterministic comparison on the LLM-extracted rows
    const findings = compareCostShareLevels(rows);
    expect(findings.some((f) => f.mhsudLevel === 60 && f.msLevel === 20)).toBe(true);
    // prompt pinning recorded
    expect(call.promptHash).toMatch(/^[a-f0-9]{64}$/);
    expect(audit.filter('llm.call').length).toBe(1);
  });

  it('rejects non-JSON LLM output (non-authoritative, fails closed)', async () => {
    const client = new FakeLlmClient(() => 'I think the copay is fifty dollars.');
    const extractor = new LlmExtractor(client, 'claude-x');
    await expect(extractor.extractCostShares('x', 'sob')).rejects.toThrow(/did not return valid JSON/);
  });

  it('tolerates ```json fenced output', async () => {
    const client = new FakeLlmClient(() => '```json\n[{"serviceText":"MH visit","frType":"copay","level":45,"network":"in_network"}]\n```');
    const extractor = new LlmExtractor(client, 'claude-x');
    const { rows } = await extractor.extractCostShares('x', 'sob');
    expect(rows[0]!.level).toBe(45);
  });
});
