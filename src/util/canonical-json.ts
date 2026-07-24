/**
 * Deterministic ("canonical") JSON serialization.
 *
 * Report reproducibility (Non-negotiable #5) requires that identical logical
 * content always serializes to byte-identical output. `JSON.stringify` does not
 * guarantee key ordering across objects built by different code paths, so we
 * sort object keys recursively and emit a stable form.
 *
 * This is used for:
 *   - hashing audit entries (hash chain)
 *   - hashing rendered LLM prompts (prompt-version pinning)
 *   - the content hash an attorney approves (attorney gate)
 *   - byte-level reproducibility assertions in tests
 */

export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };

function canonicalize(value: unknown): Json {
  if (value === null || value === undefined) return null;

  const t = typeof value;
  if (t === 'boolean' || t === 'string') return value as Json;

  if (t === 'number') {
    if (!Number.isFinite(value as number)) {
      // NaN / Infinity are not representable in JSON and must never silently
      // become null in a compliance artifact — surface them.
      throw new Error(`Non-finite number cannot be canonicalized: ${String(value)}`);
    }
    return value as number;
  }

  if (Array.isArray(value)) {
    return value.map((v) => canonicalize(v));
  }

  if (t === 'object') {
    // Support objects exposing toJSON (e.g. Date) the same way JSON.stringify would.
    const maybe = value as { toJSON?: () => unknown };
    if (typeof maybe.toJSON === 'function') {
      return canonicalize(maybe.toJSON());
    }
    const obj = value as Record<string, unknown>;
    const out: Record<string, Json> = {};
    for (const key of Object.keys(obj).sort()) {
      const v = obj[key];
      if (v === undefined) continue; // omit undefined, matching JSON.stringify
      out[key] = canonicalize(v);
    }
    return out;
  }

  throw new Error(`Cannot canonicalize value of type ${t}`);
}

/** Serialize `value` to a canonical (stable, key-sorted) JSON string. */
export function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/** Canonical JSON with 2-space indentation, for human-readable stable artifacts. */
export function canonicalStringifyPretty(value: unknown): string {
  return JSON.stringify(canonicalize(value), null, 2);
}
