import type { LockedClassificationScheme } from '../classification/consistency-lock.js';
import type { Classification } from '../classification/classifications.js';
import { nqtlsForSet, type NqtlSet, type NqtlDefinition } from './nqtl-library.js';
import { DOL_FACTORS, EVIDENTIARY_SOURCES } from './factors.js';
import { SixStepRegistry, sixStepKey, type SixStepRecord } from './six-step.js';
import type { AuditLog } from '../audit/audit-log.js';

/**
 * Six-step scaffolder.
 *
 * Instantiates one blank six-step record per (NQTL × classification ×
 * sub-classification) for the selected NQTL set, respecting the LOCKED
 * classification scheme (so QTL and NQTL share the same classifications) and the
 * cardinality rule (no combining across classifications). Step 2 is pre-seeded
 * with the DOL standardized factor and evidentiary-source lists so the drafter
 * fills a structured template rather than free-forming.
 */

export interface ScaffoldOptions {
  scheme: LockedClassificationScheme;
  nqtlSet: NqtlSet;
  /** 'as-written' | 'in-operation' | 'both' — controls Step 5's not-performed marker. */
  scope: 'as-written' | 'in-operation' | 'both';
  audit?: AuditLog;
}

function blankRecord(nqtl: NqtlDefinition, classification: Classification, subclassKey: string | undefined, scope: ScaffoldOptions['scope']): SixStepRecord {
  const emptySide = (side: 'MS' | 'MHSUD') => ({ side, factors: [], evidentiarySources: [] as string[] });
  const step5Performed = scope !== 'as-written';
  return {
    id: sixStepKey(nqtl.id, classification, subclassKey),
    nqtlId: nqtl.id,
    classification,
    ...(subclassKey ? { subclassKey } : {}),
    step1: {
      nqtlDescription: nqtl.description,
      planTermRefs: [],
      msBenefitsApplied: [],
      mhsudBenefitsApplied: [],
      narrative: null,
    },
    step2: {
      ms: emptySide('MS'),
      mhsud: emptySide('MHSUD'),
      asymmetries: [],
      narrative: null,
    },
    step3: { narrative: null },
    step4: { findingIds: [], narrative: null },
    step5: {
      performed: step5Performed,
      ...(step5Performed
        ? {}
        : {
            notPerformedReason:
              'In-operation analysis was not performed in this run (scope: as-written). A comparative ' +
              'analysis that omits Step 5 does not satisfy 42 U.S.C. § 300gg-26(a)(8)(A)(iv), which ' +
              'requires demonstration as written AND in operation.',
          }),
      findingIds: [],
      narrative: null,
    },
    step6: { findingIds: [], narrative: null },
  };
}

export interface ScaffoldResult {
  registry: SixStepRegistry;
  /** The standardized lists surfaced to the drafter for Steps 2/3. */
  standardizedFactors: readonly string[];
  standardizedEvidentiarySources: readonly string[];
  recordCount: number;
}

export function scaffoldSixStep(opts: ScaffoldOptions): ScaffoldResult {
  const registry = new SixStepRegistry();
  const nqtls = nqtlsForSet(opts.nqtlSet);

  for (const nqtl of nqtls) {
    // Only classifications that are BOTH in the locked scheme AND applicable to the NQTL.
    const classifications = nqtl.applicableClassifications.filter((c) => opts.scheme.has(c));
    for (const classification of classifications) {
      const subs = opts.scheme.subclassesFor(classification);
      if (subs.length === 0) {
        registry.add(blankRecord(nqtl, classification, undefined, opts.scope));
      } else {
        // One record per sub-classification — sub-classifying for NQTL requires
        // the sub-class to be in the shared locked scheme (consistency lock).
        for (const subKey of subs) {
          registry.add(blankRecord(nqtl, classification, subKey, opts.scope));
        }
      }
    }
  }

  opts.audit?.append('nqtl.scaffolded', 'engine', {
    nqtlSet: opts.nqtlSet,
    scope: opts.scope,
    schemeHash: opts.scheme.hash,
    recordCount: registry.size,
  });

  return {
    registry,
    standardizedFactors: DOL_FACTORS,
    standardizedEvidentiarySources: EVIDENTIARY_SOURCES,
    recordCount: registry.size,
  };
}
