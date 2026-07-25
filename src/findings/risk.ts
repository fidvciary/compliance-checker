import type { Finding, Severity, Confidence, RiskAssessment, RiskTier } from './finding.js';

/**
 * Risk scoring + ranking (recall-first posture support).
 *
 * When the engine is run in a high-sensitivity mode it surfaces MANY possible
 * parity gaps — including low-confidence ones — because most plans have gaps
 * somewhere. The risk score is what makes that usable: it ranks findings so an
 * attorney works top-down and low-confidence noise sorts to the bottom.
 *
 * A risk score is NOT a determination. A high score means "most worth a human's
 * time," not "confirmed violation." Nothing here changes the non-negotiables:
 * in-operation findings remain warning signs, facial_violation stays reserved
 * for bright-line cases, and the attorney gate still governs FINAL output.
 */

const SEVERITY_BASE: Record<Severity, number> = {
  facial_violation: 85,
  significant_indicator: 55,
  documentation_gap: 45,
  potential_indicator: 30,
  insufficient_data: 12,
  compliant: 0,
};

const CONFIDENCE_MULT: Record<Confidence, number> = {
  high: 1.0,
  medium: 0.82,
  low: 0.6,
};

function tierFor(score: number): RiskTier {
  if (score >= 80) return 'critical';
  if (score >= 60) return 'high';
  if (score >= 40) return 'medium';
  if (score >= 20) return 'low';
  return 'informational';
}

/** Magnitude bonus (0-15) from the finding's evidence — bigger disparity = higher. */
function magnitudeBonus(f: Finding): number {
  let m = 0;
  for (const e of f.evidence) {
    if (e.kind === 'statistical') {
      const ratio = Number.isFinite(e.ratio) ? Math.max(e.ratio, e.ratio === 0 ? 0 : 1 / e.ratio) : 4;
      if (ratio >= 3) m = Math.max(m, 13);
      else if (ratio >= 2) m = Math.max(m, 9);
      else if (ratio >= 1.5) m = Math.max(m, 6);
      else m = Math.max(m, 3);
      if ((e.pAdjusted ?? 1) < 0.001) m += 2;
      // A large absolute difference matters even when the ratio is modest.
      if (Math.abs(e.diff) >= 0.15) m += 2;
    } else if (e.kind === 'computation') {
      const v = e.values as Record<string, unknown>;
      // QTL: substantially-all failed while applied to MH/SUD, or predominant exceeded.
      if (v.substantiallyAllApplies === false) m = Math.max(m, 12);
      else if (typeof v.mhsudLevel === 'number' && typeof v.allowedMaxLevel === 'number' && v.allowedMaxLevel > 0) {
        const over = Math.abs((v.mhsudLevel - v.allowedMaxLevel) / v.allowedMaxLevel);
        m = Math.max(m, Math.min(12, Math.round(over * 20)));
      } else m = Math.max(m, 6);
    } else if (e.kind === 'document') {
      m = Math.max(m, 5); // as-written language match
    }
  }
  return Math.min(15, m);
}

/** Litigation-track venue bump (venue weight is already partly baked into severity). */
function venueBonus(f: Finding): number {
  if (f.track === 'litigation' || f.track === 'both') {
    return f.severity === 'significant_indicator' ? 8 : 3;
  }
  return 0;
}

export function scoreFinding(f: Finding): RiskAssessment {
  const base = SEVERITY_BASE[f.severity];
  const confMult = CONFIDENCE_MULT[f.confidence];
  // Advisory findings depend only on the non-enforced 2024 rule → half the
  // current practical risk (prudent to prepare, not required now).
  const enforceMult = f.advisory ? 0.5 : 1.0;
  const mag = magnitudeBonus(f);
  const venue = venueBonus(f);

  const raw = base * confMult * enforceMult + mag + venue;
  const score = Math.max(0, Math.min(100, Math.round(raw)));
  return {
    score,
    tier: tierFor(score),
    factors: {
      severityBase: base,
      confidenceMult: confMult,
      enforceMult,
      magnitudeBonus: mag,
      venueBonus: venue,
    },
  };
}

/** Assign risk to every finding (mutates) and return them sorted highest-risk first. */
export function assignAndRankRisk(findings: Finding[]): Finding[] {
  for (const f of findings) f.risk = scoreFinding(f);
  return [...findings].sort((a, b) => (b.risk?.score ?? 0) - (a.risk?.score ?? 0));
}

export function riskTierCounts(findings: Finding[]): Record<RiskTier, number> {
  const counts: Record<RiskTier, number> = { critical: 0, high: 0, medium: 0, low: 0, informational: 0 };
  for (const f of findings) if (f.risk) counts[f.risk.tier] += 1;
  return counts;
}
