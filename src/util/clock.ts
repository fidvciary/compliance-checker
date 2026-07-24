/**
 * Injectable time source.
 *
 * The audit log and report records are timestamped, but reproducibility tests
 * and golden fixtures need deterministic time. All engine code takes a `Clock`
 * rather than calling `Date.now()` directly.
 */
export interface Clock {
  /** ISO-8601 timestamp (UTC). */
  now(): string;
}

export const systemClock: Clock = {
  now: () => new Date().toISOString(),
};

/** A clock that returns a fixed instant, optionally advancing by a step on each call. */
export function fixedClock(iso: string, stepMs = 0): Clock {
  let t = new Date(iso).getTime();
  return {
    now(): string {
      const out = new Date(t).toISOString();
      t += stepMs;
      return out;
    },
  };
}
