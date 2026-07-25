import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readPlanDocument, planDocumentFromText } from '../src/ingestion/document-reader.js';
import { chunkDocument } from '../src/ingestion/document-chunker.js';
import { scanPlanDocumentText, scanPlanDocumentFile, describeDocumentScan } from '../src/ingestion/document-scan.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, 'fixtures', 'sample-plan.txt');

describe('document reader + chunker', () => {
  it('reads a text plan document', async () => {
    const doc = await readPlanDocument(fixture);
    expect(doc.format).toBe('text');
    expect(doc.text).toMatch(/Mental Health Care Services/);
  });

  it('chunks into anchored passages, tracking section headings', () => {
    const doc = planDocumentFromText('*TOCLVL2*Mental Health Care Services*TOCLVL2*\n\nPrior authorization is required for behavioral health services. It applies to outpatient care.', 'x');
    const passages = chunkDocument(doc, { documentId: 'x' });
    expect(passages.length).toBeGreaterThan(0);
    expect(passages[0]!.section).toBe('Mental Health Care Services');
    // sentence-level splitting
    expect(passages.some((p) => /Prior authorization is required/.test(p.text))).toBe(true);
  });

  it('drops template artifacts and bullet glyphs', () => {
    const doc = planDocumentFromText('*TEMPLATE*X*TEMPLATE*\nl\n\nReal sentence about mental health prior authorization requirements here.', 'x');
    const passages = chunkDocument(doc, { documentId: 'x' });
    expect(passages.every((p) => !p.text.includes('*TEMPLATE*'))).toBe(true);
  });
});

describe('document scan — recall on planted signals', () => {
  it('finds the planted warning signs and litigation-theory language', async () => {
    const result = await scanPlanDocumentFile(fixture);
    const wsRules = result.warningSigns.map((h) => h.ruleId);
    // MH-only preauth, concurrent review cadence, written plan, wilderness, licensure
    expect(wsRules).toContain('I.blanket_preauth_mhsud');
    expect(wsRules).toContain('I.frequent_concurrent_review_mhsud');
    expect(wsRules).toContain('IV.written_plan_mhsud_only');
    expect(wsRules).toContain('V.wilderness_exclusion');
    expect(wsRules).toContain('V.licensure_restriction');
    // litigation-theory language: acute stabilization (Wit) + room & board (Danny P.)
    const theories = result.litigation.map((o) => o.theoryRuleId);
    expect(theories).toContain('wit_ubh.gasc_deviation');
    expect(theories).toContain('danny_p.room_and_board');
  });

  it('does NOT flag the compliant "applies to both medical/surgical and behavioral" precert line', () => {
    const result = scanPlanDocumentText(
      planDocumentFromText(
        'Precertification is required for all inpatient admissions, both medical/surgical and behavioral health, regardless of diagnosis.',
        'x',
      ),
    );
    expect(result.warningSigns).toHaveLength(0);
  });

  it('produces a readable description with verbatim quotes, anchors, and honest caveats', async () => {
    const result = await scanPlanDocumentFile(fixture);
    const desc = describeDocumentScan(result);
    expect(desc).toMatch(/AS-WRITTEN language screen/);
    expect(desc).toMatch(/INACTIVE pending attorney verification/);
    expect(desc).toMatch(/schedule of benefits/); // next-steps caveat
    expect(desc).toMatch(/Wilderness therapy programs are excluded/); // verbatim quote
  });

  it('dedupes repeated boilerplate hits with an occurrence count', () => {
    const repeated = Array.from({ length: 3 }, () => 'Prior authorization is required for outpatient mental health services.').join('\n\n');
    const result = scanPlanDocumentText(planDocumentFromText(repeated, 'x'));
    const preauth = result.warningSigns.filter((h) => h.ruleId === 'I.blanket_preauth_mhsud');
    expect(preauth).toHaveLength(1);
    expect(preauth[0]!.occurrences).toBe(3);
  });
});
