import type { Classification } from '../classification/classifications.js';

/**
 * Cumulative financial requirements (§ 2590.712(c)(3)(v)) and aggregate
 * lifetime / annual dollar limits (§ 2590.712(b)).
 *
 * These are BRIGHT-LINE prohibitions — facial violations requiring no
 * comparative judgment:
 *   - No separate MH/SUD deductible that accumulates separately from the M/S
 *     deductible in a classification.
 *   - No separate MH/SUD out-of-pocket maximum.
 *   - No MH/SUD-only (or lower-for-MH/SUD) aggregate lifetime or annual dollar
 *     limit.
 */

export interface CumulativeInput {
  classification: Classification;
  /** True when the plan maintains a MH/SUD deductible that accumulates separately from M/S. */
  separateMhsudDeductible: boolean;
  /** True when the plan maintains a MH/SUD out-of-pocket maximum separate from M/S. */
  separateMhsudOutOfPocketMax: boolean;
}

export interface CumulativeFinding {
  classification: Classification;
  type: 'separate_deductible' | 'separate_oop_max';
  isFacialViolation: boolean;
  citation: string;
  detail: string;
}

export function evaluateCumulative(input: CumulativeInput): CumulativeFinding[] {
  const findings: CumulativeFinding[] = [];
  if (input.separateMhsudDeductible) {
    findings.push({
      classification: input.classification,
      type: 'separate_deductible',
      isFacialViolation: true,
      citation: '29 CFR § 2590.712(c)(3)(v)',
      detail:
        'The plan applies a separate MH/SUD deductible that accumulates separately from the ' +
        'medical/surgical deductible in this classification. Separate cumulative financial ' +
        'requirements for MH/SUD are prohibited — a bright-line facial violation.',
    });
  }
  if (input.separateMhsudOutOfPocketMax) {
    findings.push({
      classification: input.classification,
      type: 'separate_oop_max',
      isFacialViolation: true,
      citation: '29 CFR § 2590.712(c)(3)(v)',
      detail:
        'The plan applies a separate MH/SUD out-of-pocket maximum. Separate cumulative financial ' +
        'requirements for MH/SUD are prohibited — a bright-line facial violation.',
    });
  }
  return findings;
}

export interface DollarLimitInput {
  scope: 'aggregate_lifetime' | 'annual';
  /** Dollar limit applied to MH/SUD benefits, or null if none. */
  mhsudLimit: number | null;
  /** Dollar limit applied to M/S benefits, or null if none. */
  msLimit: number | null;
}

export interface DollarLimitFinding {
  scope: 'aggregate_lifetime' | 'annual';
  isFacialViolation: boolean;
  citation: string;
  detail: string;
}

/**
 * Aggregate lifetime / annual dollar limits (§ 2590.712(b)). An MH/SUD-only limit,
 * or a MH/SUD limit lower than the M/S limit, is a facial violation.
 */
export function evaluateDollarLimit(input: DollarLimitInput): DollarLimitFinding | null {
  if (input.mhsudLimit == null) return null; // no MH/SUD dollar limit → nothing to flag
  const msNone = input.msLimit == null;
  const mhsudLower = input.msLimit != null && input.mhsudLimit < input.msLimit;
  if (msNone || mhsudLower) {
    return {
      scope: input.scope,
      isFacialViolation: true,
      citation: '29 CFR § 2590.712(b)',
      detail: msNone
        ? `An ${input.scope.replace('_', ' ')} dollar limit of $${input.mhsudLimit} applies to MH/SUD benefits ` +
          `with no corresponding limit on M/S benefits. A MH/SUD-only aggregate dollar limit is a facial violation.`
        : `The ${input.scope.replace('_', ' ')} dollar limit on MH/SUD benefits ($${input.mhsudLimit}) is lower than ` +
          `the limit on M/S benefits ($${input.msLimit}). A lower MH/SUD dollar limit is a facial violation.`,
    };
  }
  return null;
}
