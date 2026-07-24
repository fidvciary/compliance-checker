import { contentHash } from '../util/hash.js';
import type { Classification, Subclassification } from './classifications.js';
import { CLASSIFICATIONS } from './classifications.js';

/**
 * Classification consistency lock (Module 3; WV submission-form rule).
 *
 * Once classifications and sub-classifications are set, they are SHARED between
 * QTL testing and NQTL testing. Reclassifying between the two, or sub-classifying
 * for one analysis and not the other, is prohibited. This is enforced at the
 * data-model level, not by convention:
 *
 *   - A single ClassificationScheme is built, then `lock()`ed into an immutable
 *     LockedClassificationScheme with a content hash.
 *   - Both the QTL engine and the NQTL engine receive the SAME locked scheme.
 *   - Any classification/sub-classification used by an engine is validated
 *     against the locked scheme (`assertInScope`); anything outside it throws.
 *   - Each engine's result carries the scheme hash; `assertSchemesConsistent`
 *     fails the run if the two hashes differ.
 */

export class ClassificationScheme {
  private readonly inScope = new Set<Classification>();
  private readonly subclasses = new Map<Classification, Map<string, Subclassification>>();
  private locked = false;

  addClassification(c: Classification): this {
    if (this.locked) throw new Error('ClassificationScheme is locked; cannot add classification.');
    this.inScope.add(c);
    return this;
  }

  /** Declare a sub-classification for a classification (must be in scope). */
  addSubclassification(c: Classification, sub: Subclassification): this {
    if (this.locked) throw new Error('ClassificationScheme is locked; cannot add sub-classification.');
    if (!this.inScope.has(c)) {
      throw new Error(`Cannot sub-classify '${c}': add the classification to scope first.`);
    }
    const key = `${sub.kind}:${sub.value}`;
    const map = this.subclasses.get(c) ?? new Map<string, Subclassification>();
    map.set(key, sub);
    this.subclasses.set(c, map);
    return this;
  }

  /** Convenience: put all six classifications in scope. */
  useAllClassifications(): this {
    for (const c of CLASSIFICATIONS) this.addClassification(c);
    return this;
  }

  lock(): LockedClassificationScheme {
    this.locked = true;
    const classifications = [...this.inScope].sort();
    const subs: Record<string, string[]> = {};
    for (const [c, map] of this.subclasses) {
      subs[c] = [...map.values()].map((s) => `${s.kind}:${s.value}`).sort();
    }
    return new LockedClassificationScheme(classifications, subs);
  }
}

export class LockedClassificationScheme {
  readonly hash: string;
  constructor(
    readonly classifications: Classification[],
    /** classification -> sorted subclassification keys */
    readonly subclassifications: Record<string, string[]>,
  ) {
    // Freeze so neither engine can mutate the shared scheme post-lock.
    Object.freeze(this.classifications);
    Object.freeze(this.subclassifications);
    for (const k of Object.keys(this.subclassifications)) Object.freeze(this.subclassifications[k]);
    this.hash = contentHash({ classifications, subclassifications });
    Object.freeze(this);
  }

  has(c: Classification): boolean {
    return this.classifications.includes(c);
  }

  subclassesFor(c: Classification): string[] {
    return this.subclassifications[c] ?? [];
  }

  /** Throws if a classification (and optional subclass key) is not in the locked scheme. */
  assertInScope(c: Classification, subKey?: string): void {
    if (!this.has(c)) {
      throw new Error(
        `Classification '${c}' is not in the locked scheme (consistency lock). ` +
          `An engine may not introduce a classification the shared scheme does not contain.`,
      );
    }
    if (subKey !== undefined && !this.subclassesFor(c).includes(subKey)) {
      throw new Error(
        `Sub-classification '${subKey}' is not declared for '${c}' in the locked scheme. ` +
          `Sub-classifying for one analysis but not the other is prohibited.`,
      );
    }
  }
}

/**
 * Assert two engines used the identical locked scheme. QTL and NQTL results each
 * record the scheme hash they read; a mismatch means the classification basis
 * diverged and the run must fail rather than emit an inconsistent report.
 */
export function assertSchemesConsistent(qtlSchemeHash: string, nqtlSchemeHash: string): void {
  if (qtlSchemeHash !== nqtlSchemeHash) {
    throw new Error(
      'Consistency lock violation: QTL and NQTL analyses used different classification schemes ' +
        `(${qtlSchemeHash.slice(0, 12)} vs ${nqtlSchemeHash.slice(0, 12)}). ` +
        'Classifications must be shared between QTL and NQTL testing.',
    );
  }
}
