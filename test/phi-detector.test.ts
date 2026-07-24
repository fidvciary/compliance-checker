import { describe, it, expect } from 'vitest';
import { parseCsv } from '../src/ingestion/table.js';
import { scanTableForPhi } from '../src/ingestion/phi-detector.js';

function scan(csv: string) {
  return scanTableForPhi(parseCsv(csv, 'test.csv'));
}

describe('PHI gate — rejects each PHI type (fail closed)', () => {
  it('rejects SSN by pattern regardless of column name', () => {
    const r = scan('claim_id,notes\nC1,ref 123-45-6789 on file\nC2,none');
    expect(r.clean).toBe(false);
    expect(r.findings.some((f) => f.type === 'ssn')).toBe(true);
  });

  it('rejects an ssn-named column', () => {
    const r = scan('member_ssn,amount\n111-22-3333,100\n444-55-6666,200');
    expect(r.clean).toBe(false);
    expect(r.findings.find((f) => f.type === 'ssn')?.matchCount).toBe(2);
  });

  it('rejects MRN column', () => {
    const r = scan('medical_record_number,cpt\nMRN0012,99213');
    expect(r.clean).toBe(false);
    expect(r.findings.some((f) => f.type === 'mrn')).toBe(true);
  });

  it('rejects full date of birth', () => {
    const r = scan('date_of_birth,dos\n03/14/1980,2025-02-01\n1975-11-02,2025-02-02');
    expect(r.clean).toBe(false);
    expect(r.findings.some((f) => f.type === 'dob')).toBe(true);
  });

  it('rejects a street address', () => {
    const r = scan('home_address,paid\n123 Main Street,50\n77 Oak Ave,60');
    expect(r.clean).toBe(false);
    expect(r.findings.some((f) => f.type === 'address')).toBe(true);
  });

  it('rejects member name columns', () => {
    const r = scan('member_first_name,member_last_name,amt\nJohn,Smith,10\nJane,Doe,20');
    expect(r.clean).toBe(false);
    expect(r.findings.filter((f) => f.type === 'member_name').length).toBeGreaterThanOrEqual(1);
  });

  it('rejects unhashed member IDs but accepts hashed ones', () => {
    const bad = scan('member_id,amt\nW123456789,10\nW987654321,20');
    expect(bad.clean).toBe(false);
    expect(bad.findings.some((f) => f.type === 'unhashed_member_id')).toBe(true);

    const good = scan(
      'member_id,amt\n' +
        '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08,10\n' +
        '2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae,20',
    );
    expect(good.clean).toBe(true);
  });

  it('catches PHI leaking into a mislabeled column (defense in depth)', () => {
    const r = scan('col_a,col_b\nfoo,call 212-555-1212\nbar,ok');
    expect(r.clean).toBe(false);
    expect(r.findings.some((f) => f.type === 'phone')).toBe(true);
  });

  it('never echoes the PHI value in a finding', () => {
    const r = scan('member_ssn,amt\n111-22-3333,100');
    const serialized = JSON.stringify(r);
    expect(serialized).not.toContain('111-22-3333');
  });
});

describe('PHI gate — adversarial clean data must NOT be flagged (false positives are expensive)', () => {
  it('accepts a fully de-identified claims extract', () => {
    const csv = [
      'member_id,date_of_service,place_of_service,cpt_hcpcs,icd10,billed_amount,allowed_amount,denied',
      '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08,2025-02-01,11,99213,F32.9,180,120,0',
      '2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae,2025-02-03,21,90837,F41.1,200,150,1',
    ].join('\n');
    const r = scan(csv);
    expect(r.clean).toBe(true);
  });

  it('does not treat date_of_service as DOB', () => {
    const r = scan('member_id,date_of_service\nabc,03/14/2025\nabc,04/01/2025');
    // member_id 'abc' is unhashed so it will be flagged; isolate the DOB question:
    expect(r.findings.some((f) => f.type === 'dob')).toBe(false);
  });

  it('does not flag provider names as member PHI', () => {
    const r = scan('provider_name,provider_npi,paid\nSmith Orthopedics,1234567890,500');
    expect(r.findings.some((f) => f.type === 'member_name')).toBe(false);
  });

  it('does not flag a 9-digit claim id as an SSN', () => {
    const r = scan('claim_id,paid\n123456789,50\n987654321,60');
    expect(r.clean).toBe(true);
  });
});
