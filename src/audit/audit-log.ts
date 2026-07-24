import { contentHash } from '../util/hash.js';
import { canonicalStringify } from '../util/canonical-json.js';
import type { Clock } from '../util/clock.js';
import { systemClock } from '../util/clock.js';

/**
 * Append-only, hash-chained audit log (Non-negotiable #5).
 *
 * Every ingestion, rule evaluation, LLM call, attorney action, and report
 * issuance writes an immutable record. Each entry embeds the hash of the prior
 * entry, so any retroactive mutation breaks the chain and is detectable by
 * `verifyChain()`. Issued reports must be reproducible from this log alone; the
 * deterministic content that goes into a report is therefore captured here.
 *
 * There is intentionally NO update or delete method. Corrections are modeled at
 * the report layer as a new version with a supersession pointer, never as a
 * mutation of an existing entry.
 */

export type AuditEventType =
  | 'ingestion.received'
  | 'ingestion.phi_rejected'
  | 'ingestion.accepted'
  | 'ruleset.loaded'
  | 'classification.assigned'
  | 'classification.quarantined'
  | 'rule.evaluated'
  | 'qtl.computed'
  | 'nqtl.scaffolded'
  | 'warning_sign.matched'
  | 'caselaw.evaluated'
  | 'inoperation.tested'
  | 'finding.synthesized'
  | 'llm.call'
  | 'linter.run'
  | 'attorney.action'
  | 'report.generated'
  | 'report.issued'
  | 'report.superseded';

export interface AuditEntry {
  /** Monotonic sequence number, starting at 0. */
  readonly seq: number;
  readonly timestamp: string;
  /** Who or what performed the action: 'engine', 'llm:<model>', 'attorney:<id>', etc. */
  readonly actor: string;
  readonly eventType: AuditEventType;
  /** Structured, canonicalizable payload describing the event. */
  readonly payload: unknown;
  /** Hash of the previous entry ('GENESIS' for seq 0). */
  readonly prevHash: string;
  /** SHA-256 over the canonical form of {seq,timestamp,actor,eventType,payload,prevHash}. */
  readonly entryHash: string;
}

const GENESIS = 'GENESIS';

function computeEntryHash(fields: Omit<AuditEntry, 'entryHash'>): string {
  return contentHash({
    seq: fields.seq,
    timestamp: fields.timestamp,
    actor: fields.actor,
    eventType: fields.eventType,
    payload: fields.payload,
    prevHash: fields.prevHash,
  });
}

export class AuditLog {
  private readonly entries: AuditEntry[] = [];

  constructor(private readonly clock: Clock = systemClock) {}

  /** Append an event. Returns the created (immutable) entry. */
  append(eventType: AuditEventType, actor: string, payload: unknown): AuditEntry {
    const seq = this.entries.length;
    const prevHash = seq === 0 ? GENESIS : this.entries[seq - 1]!.entryHash;
    // Deep-clone the payload so a caller holding the original reference cannot
    // mutate what was recorded. An audit record is immutable from the instant
    // it is written; that guarantee must not depend on caller discipline.
    const frozenPayload = structuredClone(payload);
    const base: Omit<AuditEntry, 'entryHash'> = {
      seq,
      timestamp: this.clock.now(),
      actor,
      eventType,
      payload: frozenPayload,
      prevHash,
    };
    const entry: AuditEntry = { ...base, entryHash: computeEntryHash(base) };
    this.entries.push(entry);
    return entry;
  }

  /** All entries in append order (defensive copy). */
  all(): readonly AuditEntry[] {
    return this.entries.slice();
  }

  filter(eventType: AuditEventType): AuditEntry[] {
    return this.entries.filter((e) => e.eventType === eventType);
  }

  get length(): number {
    return this.entries.length;
  }

  /**
   * Verify the hash chain is intact. Returns the seq of the first broken entry,
   * or null if the whole chain is valid.
   */
  verifyChain(): { valid: true } | { valid: false; brokenAtSeq: number; reason: string } {
    let prevHash = GENESIS;
    for (const e of this.entries) {
      if (e.prevHash !== prevHash) {
        return { valid: false, brokenAtSeq: e.seq, reason: 'prevHash mismatch' };
      }
      const recomputed = computeEntryHash({
        seq: e.seq,
        timestamp: e.timestamp,
        actor: e.actor,
        eventType: e.eventType,
        payload: e.payload,
        prevHash: e.prevHash,
      });
      if (recomputed !== e.entryHash) {
        return { valid: false, brokenAtSeq: e.seq, reason: 'entryHash mismatch (payload altered)' };
      }
      prevHash = e.entryHash;
    }
    return { valid: true };
  }

  /** The head hash — a single value that commits to the entire log history. */
  headHash(): string {
    return this.entries.length === 0 ? GENESIS : this.entries[this.entries.length - 1]!.entryHash;
  }

  /** Serialize to newline-delimited JSON (append-only log file format). */
  toJSONL(): string {
    return this.entries.map((e) => canonicalStringify(e)).join('\n');
  }

  /** Reconstruct a log from JSONL and verify the chain on load. */
  static fromJSONL(jsonl: string, clock: Clock = systemClock): AuditLog {
    const log = new AuditLog(clock);
    const lines = jsonl.split('\n').filter((l) => l.trim().length > 0);
    for (const line of lines) {
      log.entries.push(JSON.parse(line) as AuditEntry);
    }
    const check = log.verifyChain();
    if (!check.valid) {
      throw new Error(`Audit log integrity failure at seq ${check.brokenAtSeq}: ${check.reason}`);
    }
    return log;
  }
}
