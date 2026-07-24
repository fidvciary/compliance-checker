import { createHash } from 'node:crypto';
import { canonicalStringify } from './canonical-json.js';

/** SHA-256 hex digest of a UTF-8 string. */
export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Content hash of an arbitrary value via canonical JSON.
 * Two logically-equal values hash identically regardless of key insertion order.
 */
export function contentHash(value: unknown): string {
  return sha256(canonicalStringify(value));
}

/** Short, human-referenceable form of a hash (first 12 hex chars). */
export function shortHash(hash: string): string {
  return hash.slice(0, 12);
}
