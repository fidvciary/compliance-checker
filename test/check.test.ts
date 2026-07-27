import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { checkCompliance, type UploadedFile } from '../src/check.js';
import { aggregateClaimsForInOperation } from '../src/in-operation/claims-aggregation.js';
import { readAnyTable, guessKind } from '../src/ingestion/any-file.js';
import { parseCsv } from '../src/ingestion/table.js';

const here = dirname(fileURLToPath(import.meta.url));
const sob = readFileSync(join(here, 'fixtures', 'summary-of-benefits.txt'));

const HASH = (n: number) => n.toString(16).padStart(64, '0');

/** Build a claims CSV: MH (F-code, 90837) denied at ~25%, M/S (99213) at ~6%, outpatient in-network. */
function claimsCsv(): string {
  const rows = ['member_id,date_of_service,place_of_service,procedure_code,diagnosis_code,network_status,denied_flag'];
  for (let i = 0; i < 100; i++) rows.push(`${HASH(i)},2024-02-01,11,90837,F41.1,IN,${i < 25 ? 1 : 0}`);
  for (let i = 100; i < 200; i++) rows.push(`${HASH(i)},2024-02-01,11,99213,E11.9,IN,${i < 106 ? 1 : 0}`);
  return rows.join('\n');
}

describe('any-file reader', () => {
  it('reads a CSV into a table and guesses kinds', async () => {
    const t = await readAnyTable('claims.csv', Buffer.from('a,b\n1,2'));
    expect(t.headers).toEqual(['a', 'b']);
    expect(guessKind('2024_claims_extract.csv')).toBe('claims');
    expect(guessKind('prior_auth_log.xlsx')).toBe('prior_auth');
    expect(guessKind('plan_spd.pdf')).toBe('plan_document');
    expect(guessKind('Summary_of_Benefits.pdf')).toBe('schedule_of_benefits');
  });
});

describe('claims aggregation', () => {
  it('classifies MH vs M/S and builds a denial-rate comparison', () => {
    const table = parseCsv(claimsCsv(), 'c.csv');
    const records = table.rows; // canonical field names already match here
    const agg = aggregateClaimsForInOperation(records);
    expect(agg.mhsudCount).toBe(100);
    expect(agg.msCount).toBe(100);
    const cmp = agg.rateComparisons.find((r) => r.classification === 'outpatient_in_network');
    expect(cmp).toBeDefined();
    expect(cmp!.mhsud.events).toBe(25);
    expect(cmp!.ms.events).toBe(6);
  });
});

describe('checkCompliance — as-written', () => {
  it('flags issues from an uploaded schedule of benefits, no report produced', async () => {
    const files: UploadedFile[] = [{ name: 'summary-of-benefits.txt', bytes: sob, kind: 'schedule_of_benefits' }];
    const result = await checkCompliance(files, { scope: 'as-written', sensitivity: 'aggressive' });
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues.every((f) => f.risk !== undefined)).toBe(true);
    // the $50 vs $25 copay gap is flagged
    expect(result.issues.some((f) => /Cost-share level/.test(f.title))).toBe(true);
    // as-written mode notes in-operation was not run
    expect(result.limitations.some((l) => /as-written mode/i.test(l))).toBe(true);
  });
});

describe('checkCompliance — everything (in-operation)', () => {
  it('flags an adverse denial-rate disparity from uploaded claims', async () => {
    const files: UploadedFile[] = [
      { name: 'sob.txt', bytes: sob, kind: 'schedule_of_benefits' },
      { name: 'claims.csv', bytes: Buffer.from(claimsCsv()), kind: 'claims' },
    ];
    const result = await checkCompliance(files, { scope: 'everything', sensitivity: 'balanced' });
    expect(result.claimsAnalyzed).not.toBeNull();
    expect(result.claimsAnalyzed!.classified).toBe(200);
    expect(result.issues.some((f) => f.scope === 'in_operation' && /denial rate/i.test(f.title))).toBe(true);
  });

  it('rejects a claims file containing PHI, fail-closed, and analyzes nothing from it', async () => {
    const dirty = 'member_name,ssn,procedure_code,diagnosis_code,denied\nJohn Smith,123-45-6789,90837,F41.1,1';
    const files: UploadedFile[] = [{ name: 'claims.csv', bytes: Buffer.from(dirty), kind: 'claims' }];
    const result = await checkCompliance(files, { scope: 'everything' });
    expect(result.phiRejections.length).toBe(1);
    expect(result.phiRejections[0]!.file).toBe('claims.csv');
    expect(result.claimsAnalyzed).toBeNull();
    // the report never echoes the PHI value
    expect(JSON.stringify(result)).not.toContain('123-45-6789');
  });
});
