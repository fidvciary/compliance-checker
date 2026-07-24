import { describe, it, expect } from 'vitest';
import { ingestCsv, PhiRejectedError } from '../src/ingestion/ingest.js';
import { mapColumns } from '../src/ingestion/column-mapping.js';
import { buildAvailabilityMatrix } from '../src/ingestion/availability-matrix.js';
import { AuditLog } from '../src/audit/audit-log.js';
import { fixedClock } from '../src/util/clock.js';

const HASH_A = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';
const HASH_B = '2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae';

const cleanClaims = [
  'member_id,claim_id,date_of_service,place_of_service,procedure_code,diagnosis_code,network_status,allowed_amount,paid_amount,denied',
  `${HASH_A},C1,2025-02-01,11,99213,F32.9,IN,180,120,0`,
  `${HASH_B},C2,2025-02-03,21,90837,F41.1,OUT,200,150,1`,
].join('\n');

describe('ingestion — PHI gate is enforced before mapping (fail closed)', () => {
  it('throws PhiRejectedError and records an audit event when PHI is present', () => {
    const audit = new AuditLog(fixedClock('2026-07-01T00:00:00Z', 1));
    const dirty = 'member_name,amount\nJohn Smith,100';
    expect(() => ingestCsv(dirty, 'dirty.csv', { dataset: 'claims', audit })).toThrow(PhiRejectedError);
    const rejected = audit.filter('ingestion.phi_rejected');
    expect(rejected.length).toBe(1);
    // audit payload must not contain PHI values
    expect(JSON.stringify(rejected[0])).not.toContain('John Smith');
  });

  it('accepts a clean de-identified extract and records acceptance', () => {
    const audit = new AuditLog(fixedClock('2026-07-01T00:00:00Z', 1));
    const res = ingestCsv(cleanClaims, 'claims.csv', { dataset: 'claims', audit });
    expect(res.rowCount).toBe(2);
    expect(audit.filter('ingestion.accepted').length).toBe(1);
    expect(audit.filter('ingestion.phi_rejected').length).toBe(0);
  });
});

describe('column mapping', () => {
  it('maps Aetna ASO headers exactly via template', () => {
    const headers = [
      'MEMBER_HASH_ID', 'CLAIM_ID', 'SERVICE_DT', 'POS_CD', 'PROC_CD', 'DIAG_1_CD',
      'NTWK_IND', 'ALLOWED_AMT', 'PLAN_PAID_AMT', 'DENIED_IND',
    ];
    const r = mapColumns(headers, { dataset: 'claims', tpa: 'aetna_aso' });
    expect(r.resolved['allowed_amount']).toBe('ALLOWED_AMT');
    expect(r.resolved['paid_amount']).toBe('PLAN_PAID_AMT');
    expect(r.resolved['denied_flag']).toBe('DENIED_IND');
  });

  it('falls back to fuzzy matching for an unknown TPA', () => {
    const headers = ['Member ID Hashed', 'Claim Number', 'Svc Date', 'CPT/HCPCS', 'Primary Diagnosis', 'INN/OON', 'Allowed', 'Plan Paid', 'Denied'];
    const r = mapColumns(headers, { dataset: 'claims' });
    expect(r.resolved['procedure_code']).toBe('CPT/HCPCS');
    expect(r.resolved['network_status']).toBe('INN/OON');
    expect(r.resolved['allowed_amount']).toBe('Allowed');
    expect(r.suggestions.find((s) => s.canonicalField === 'procedure_code')?.method).toBe('fuzzy');
  });
});

describe('data availability matrix', () => {
  it('reports runnable vs blocked features with the missing artifact', () => {
    const claims = ingestCsv(cleanClaims, 'claims.csv', { dataset: 'claims' });
    const matrix = buildAvailabilityMatrix([claims]);
    // denial_rate needs denied_flag+diagnosis_code+network_status — all present
    expect(matrix.runnable.some((f) => f.feature.id === 'denial_rate')).toBe(true);
    // prior auth features are blocked (no prior_auth dataset)
    const pa = matrix.blocked.find((f) => f.feature.id === 'pa_request_rate');
    expect(pa).toBeDefined();
    expect(pa!.missingDatasets).toContain('prior_auth');
    expect(matrix.missingArtifacts).toContain('Prior auth / precertification log');
  });

  it('blocks denial_rate_by_reason when 835 reason codes are absent', () => {
    const claims = ingestCsv(cleanClaims, 'claims.csv', { dataset: 'claims' });
    const matrix = buildAvailabilityMatrix([claims]);
    const byReason = matrix.blocked.find((f) => f.feature.id === 'denial_rate_by_reason');
    expect(byReason).toBeDefined();
    expect(byReason!.missingFields).toContain('denial_reason_code');
  });
});
