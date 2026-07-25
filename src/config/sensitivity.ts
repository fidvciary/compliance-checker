/**
 * Sensitivity configuration — the precision/recall dial.
 *
 * Default is 'balanced'. 'aggressive' is the "flag any chance of a parity gap"
 * posture: it widens thresholds, reports near-significant statistics, drops the
 * warning-sign requirement-cue gate, and turns "applies to both" suppressions
 * into low-confidence "verify comparability" items instead of dropping them.
 * Every extra flag it surfaces is LOW confidence and therefore LOW risk, so the
 * risk ranking keeps them at the bottom of the list rather than drowning the
 * real signals.
 *
 * Sensitivity never changes the non-negotiables: it can only lower the bar for
 * *surfacing an indicator to review*, never promote something to a violation or
 * bypass the attorney gate.
 */

export type SensitivityLevel = 'conservative' | 'balanced' | 'aggressive';

export interface SensitivityConfig {
  level: SensitivityLevel;
  /** Proximity band (fraction) for QTL THRESHOLD_PROXIMATE routing. */
  qtlEpsilon: number;
  /** As-written scope asymmetry: flag when |diff| exceeds this many points... */
  scopePointTolerance: number;
  /** ...or the MH/SUD-to-M/S ratio meets this. */
  scopeRatio: number;
  /** Significance threshold for treating an outcome disparity as a warning sign. */
  statAlpha: number;
  /** Aggressive: also surface near-significant (statAlpha..nearSignificantAlpha) as low-confidence. */
  reportNearSignificant: boolean;
  nearSignificantAlpha: number;
  /** When MH context comes only from the section heading, also require a requirement cue. */
  warningSignRequireCueForSection: boolean;
  /** Aggressive: emit "applies to both" passages as low-confidence verify items instead of suppressing. */
  emitAppliesToBothAsVerify: boolean;
}

export const SENSITIVITY_PRESETS: Record<SensitivityLevel, SensitivityConfig> = {
  conservative: {
    level: 'conservative',
    qtlEpsilon: 0.01,
    scopePointTolerance: 15,
    scopeRatio: 2.0,
    statAlpha: 0.05,
    reportNearSignificant: false,
    nearSignificantAlpha: 0.05,
    warningSignRequireCueForSection: true,
    emitAppliesToBothAsVerify: false,
  },
  balanced: {
    level: 'balanced',
    qtlEpsilon: 0.02,
    scopePointTolerance: 10,
    scopeRatio: 1.5,
    statAlpha: 0.05,
    reportNearSignificant: false,
    nearSignificantAlpha: 0.05,
    warningSignRequireCueForSection: true,
    emitAppliesToBothAsVerify: false,
  },
  aggressive: {
    level: 'aggressive',
    qtlEpsilon: 0.05,
    scopePointTolerance: 3,
    scopeRatio: 1.15,
    statAlpha: 0.05,
    reportNearSignificant: true,
    nearSignificantAlpha: 0.10,
    warningSignRequireCueForSection: false,
    emitAppliesToBothAsVerify: true,
  },
};

export function resolveSensitivity(level: SensitivityLevel = 'balanced'): SensitivityConfig {
  return SENSITIVITY_PRESETS[level];
}
