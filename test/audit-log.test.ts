import { describe, it, expect } from 'vitest';
import { AuditLog } from '../src/audit/audit-log.js';
import { fixedClock } from '../src/util/clock.js';

describe('AuditLog', () => {
  it('is append-only with a monotonic sequence', () => {
    const log = new AuditLog(fixedClock('2026-07-01T00:00:00Z', 1000));
    const a = log.append('ingestion.received', 'engine', { file: 'spd.pdf' });
    const b = log.append('ruleset.loaded', 'engine', { id: 'federal:2013' });
    expect(a.seq).toBe(0);
    expect(b.seq).toBe(1);
    expect(a.prevHash).toBe('GENESIS');
    expect(b.prevHash).toBe(a.entryHash);
    expect(log.length).toBe(2);
  });

  it('produces a valid hash chain', () => {
    const log = new AuditLog(fixedClock('2026-07-01T00:00:00Z'));
    for (let i = 0; i < 10; i++) log.append('rule.evaluated', 'engine', { i });
    expect(log.verifyChain()).toEqual({ valid: true });
  });

  it('detects tampering of a serialized log via the hash chain', () => {
    const log = new AuditLog(fixedClock('2026-07-01T00:00:00Z'));
    log.append('rule.evaluated', 'engine', { verdict: 'compliant' });
    log.append('report.issued', 'engine', { id: 'r1' });
    // A clean round-trip verifies.
    expect(AuditLog.fromJSONL(log.toJSONL()).verifyChain().valid).toBe(true);
    // Editing the log file (the real attack surface) is detected on load.
    const badJsonl = log.toJSONL().replace('"compliant"', '"violation"');
    expect(() => AuditLog.fromJSONL(badJsonl)).toThrow(/integrity failure/i);
  });

  it('is immune to post-hoc mutation of a caller-held payload reference', () => {
    const log = new AuditLog(fixedClock('2026-07-01T00:00:00Z'));
    const payload = { verdict: 'compliant' };
    log.append('rule.evaluated', 'engine', payload);
    payload.verdict = 'violation'; // caller mutates original after recording
    expect(log.verifyChain().valid).toBe(true);
    expect((log.all()[0]!.payload as { verdict: string }).verdict).toBe('compliant');
  });

  it('round-trips through JSONL preserving the chain', () => {
    const log = new AuditLog(fixedClock('2026-07-01T00:00:00Z', 500));
    log.append('ingestion.accepted', 'engine', { rows: 100 });
    log.append('qtl.computed', 'engine', { classification: 'outpatient_in_network' });
    const restored = AuditLog.fromJSONL(log.toJSONL());
    expect(restored.headHash()).toBe(log.headHash());
    expect(restored.length).toBe(2);
  });

  it('reproduces an identical head hash for identical event sequences', () => {
    const build = () => {
      const l = new AuditLog(fixedClock('2026-07-01T00:00:00Z'));
      l.append('ingestion.received', 'engine', { a: 1, b: 2 });
      l.append('rule.evaluated', 'engine', { z: 26, y: 25 });
      return l.headHash();
    };
    expect(build()).toBe(build());
  });
});
