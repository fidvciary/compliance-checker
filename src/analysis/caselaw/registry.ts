import type { CaselawRule } from './rule-schema.js';
import { evalDetection, type PlanFacts } from './predicates.js';
import type { AuditLog } from '../../audit/audit-log.js';

/**
 * Case-law rule registry + evaluator (litigation track).
 *
 * Only ACTIVE (attorney-verified) rules fire. Inactive rules are retained and
 * listed for the verification queue but never evaluated. Findings are keyed to
 * the case-law pack (Track 2 — Litigation), separate from regulatory findings
 * (Track 1). Venue weighting surfaces how much practical weight a theory carries
 * for the plan sponsor's likely forum.
 */

export interface CaselawHit {
  ruleId: string;
  caseName: string;
  citation: string;
  jurisdiction: string;
  precedentialWeight: CaselawRule['precedential_weight'];
  scope: CaselawRule['scope'];
  theory: string;
  finding: string; // from finding_template
  remediation: string;
  matchedTargets: string[];
  venueWeight: VenueWeight;
  authorityRefs: string[];
  note?: string;
  track: 'litigation';
}

export interface VenueWeight {
  label: 'binding_in_venue' | 'persuasive_out_of_circuit' | 'persuasive' | 'enforcement_posture' | 'unknown';
  rationale: string;
}

// State → federal circuit (subset covering the seed-rule and data-call states).
const STATE_TO_CIRCUIT: Record<string, number> = {
  ME: 1, MA: 1, NH: 1, RI: 1, PR: 1,
  CT: 2, NY: 2, VT: 2,
  DE: 3, NJ: 3, PA: 3,
  MD: 4, NC: 4, SC: 4, VA: 4, WV: 4,
  LA: 5, MS: 5, TX: 5,
  KY: 6, MI: 6, OH: 6, TN: 6,
  IL: 7, IN: 7, WI: 7,
  AR: 8, IA: 8, MN: 8, MO: 8, NE: 8, ND: 8, SD: 8,
  AK: 9, AZ: 9, CA: 9, HI: 9, ID: 9, MT: 9, NV: 9, OR: 9, WA: 9,
  CO: 10, KS: 10, NM: 10, OK: 10, UT: 10, WY: 10,
  AL: 11, FL: 11, GA: 11,
  DC: 0, // D.C. Circuit
};

function circuitOfRule(jurisdiction: string): number | null {
  const m = /(\d{1,2})(?:st|nd|rd|th)\s*Cir/i.exec(jurisdiction);
  if (m) return Number(m[1]);
  if (/D\.?C\.?\s*Cir/i.test(jurisdiction)) return 0;
  return null;
}

export function venueWeight(rule: CaselawRule, venueState: string | undefined): VenueWeight {
  const weight = rule.precedential_weight;
  if (weight === 'settlement' || weight === 'regulator_finding') {
    return {
      label: 'enforcement_posture',
      rationale: `${rule.case_name} is a ${weight.replace('_', ' ')}; it illustrates an enforcement/settlement posture rather than binding precedent, but reflects a theory regulators or courts have credited.`,
    };
  }
  const venueCircuit = venueState ? STATE_TO_CIRCUIT[venueState.toUpperCase()] : undefined;
  const ruleCircuit = circuitOfRule(rule.jurisdiction);
  if (weight === 'binding_scotus') {
    return { label: 'binding_in_venue', rationale: 'Supreme Court authority is binding in every venue.' };
  }
  if (venueCircuit === undefined || ruleCircuit === null) {
    return { label: 'unknown', rationale: 'Venue or rule circuit could not be determined; treat weight cautiously.' };
  }
  if ((weight === 'binding_circuit' || weight === 'persuasive_circuit') && ruleCircuit === venueCircuit) {
    return { label: 'binding_in_venue', rationale: `${rule.case_name} is ${weight.replace('_', ' ')} authority in the ${ordinal(ruleCircuit)} Circuit, which governs the plan sponsor's venue (${venueState}).` };
  }
  if (weight === 'binding_circuit') {
    return { label: 'persuasive_out_of_circuit', rationale: `${rule.case_name} is binding in the ${ordinal(ruleCircuit)} Circuit but only persuasive in the plan sponsor's ${ordinal(venueCircuit)} Circuit venue (${venueState}).` };
  }
  return { label: 'persuasive', rationale: `${rule.case_name} is persuasive authority in the plan sponsor's venue (${venueState}).` };
}

function ordinal(n: number): string {
  if (n === 0) return 'D.C.';
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]!);
}

export class CaselawRegistry {
  constructor(private readonly rules: CaselawRule[]) {}

  activeRules(): CaselawRule[] {
    return this.rules.filter((r) => r.active);
  }

  /** Rules awaiting attorney verification (the ship state for all seed rules). */
  inactiveRules(): CaselawRule[] {
    return this.rules.filter((r) => !r.active);
  }

  verificationQueue(): Array<{ id: string; caseName: string; citation: string; verified: boolean }> {
    return this.rules.map((r) => ({
      id: r.id,
      caseName: r.case_name,
      citation: r.citation,
      verified: !!(r.verified_by && r.verified_date),
    }));
  }

  /** Evaluate ONLY active rules against plan facts. Inactive rules never fire. */
  evaluate(facts: PlanFacts, opts: { venueState?: string; audit?: AuditLog } = {}): CaselawHit[] {
    const hits: CaselawHit[] = [];
    for (const rule of this.activeRules()) {
      const results = rule.detection.map((d) => ({ target: d.target, pass: evalDetection(d.test, facts) }));
      // A rule with no detection tests is a comparator-methodology / reference
      // exemplar (e.g., Smith v. Golden Rule, E.W. v. Health Net, MD exam
      // reports). It never auto-fires as a violation — an empty 'all' must not
      // vacuously match.
      const matched =
        rule.detection.length === 0
          ? false
          : rule.detection_mode === 'any'
            ? results.some((r) => r.pass)
            : results.every((r) => r.pass);
      opts.audit?.append('caselaw.evaluated', 'engine', { ruleId: rule.id, matched, active: true });
      if (!matched) continue;
      hits.push({
        ruleId: rule.id,
        caseName: rule.case_name,
        citation: rule.citation,
        jurisdiction: rule.jurisdiction,
        precedentialWeight: rule.precedential_weight,
        scope: rule.scope,
        theory: rule.theory,
        finding: rule.finding_template,
        remediation: rule.remediation_prompt,
        matchedTargets: results.filter((r) => r.pass).map((r) => r.target),
        venueWeight: venueWeight(rule, opts.venueState),
        authorityRefs: [`caselaw:${rule.id}`],
        ...(rule.note ? { note: rule.note } : {}),
        track: 'litigation',
      });
    }
    return hits;
  }
}
