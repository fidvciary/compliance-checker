import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadCaselawFromDir, parseCaselawRule } from '../src/analysis/caselaw/loader.js';
import { CaselawRegistry, venueWeight } from '../src/analysis/caselaw/registry.js';
import { CaselawActivationError } from '../src/analysis/caselaw/rule-schema.js';
import { evaluateExpression } from '../src/analysis/caselaw/expression.js';
import { evalDetection } from '../src/analysis/caselaw/predicates.js';

const here = dirname(fileURLToPath(import.meta.url));
const caselawDir = join(here, '..', 'caselaw');

describe('detection expression evaluator', () => {
  const t = () => true;
  const f = () => false;
  it('evaluates AND/OR/NOT/parentheses', () => {
    expect(evaluateExpression('a AND b', (n) => n === 'a' || n === 'b')).toBe(true);
    expect(evaluateExpression('a AND NOT b', (n) => n === 'a')).toBe(true);
    expect(evaluateExpression('a OR b', () => false)).toBe(false);
    expect(evaluateExpression('(a OR b) AND c', (n) => n === 'a' || n === 'c')).toBe(true);
    expect(evaluateExpression('NOT (a AND b)', (n) => n === 'a')).toBe(true);
  });
  it('parses predicate argument lists', () => {
    expect(evaluateExpression('aligns_with(ASAM | LOCUS)', (n, args) => args.includes('ASAM'))).toBe(true);
    expect(evaluateExpression('aligns_with(ASAM | LOCUS)', (n, args) => args.includes('MCG'))).toBe(false);
  });
  it('rejects trailing garbage', () => {
    expect(() => evaluateExpression('a b', t)).toThrow();
  });
});

describe('predicate evaluation over plan facts', () => {
  it('fires the Wit GASC test on proprietary non-aligned criteria', () => {
    expect(
      evalDetection('criteria_source_is_proprietary AND NOT aligns_with(ASAM | LOCUS | CALOCUS | AACAP)', {
        mhsudCriteriaSource: 'proprietary',
        mhsudCriteriaStandards: [],
      }),
    ).toBe(true);
  });
  it('does not fire when criteria align with ASAM', () => {
    expect(
      evalDetection('criteria_source_is_proprietary AND NOT aligns_with(ASAM | LOCUS | CALOCUS | AACAP)', {
        mhsudCriteriaSource: 'proprietary',
        mhsudCriteriaStandards: ['ASAM'],
      }),
    ).toBe(false);
  });
  it('throws on an unregistered predicate', () => {
    expect(() => evalDetection('made_up_predicate', {})).toThrow(/Unknown case-law detection predicate/);
  });
});

describe('activation gate (THE point of the module)', () => {
  it('loads all seed rules and every one ships INACTIVE', () => {
    const rules = loadCaselawFromDir(caselawDir);
    expect(rules.length).toBeGreaterThanOrEqual(17);
    expect(rules.every((r) => r.active === false)).toBe(true);
    expect(rules.every((r) => r.verified_by === null && r.verified_date === null)).toBe(true);
  });

  it('refuses to load an active rule that is not attorney-verified', () => {
    const bad = `
id: x.y
authority_type: case_law
case_name: Test
citation: Test
jurisdiction: 9th Cir.
precedential_weight: binding_circuit
theory: t
scope: as_written
detection: []
finding_template: f
remediation_prompt: r
verified_by: null
verified_date: null
active: true
`;
    expect(() => parseCaselawRule(bad)).toThrow(CaselawActivationError);
  });

  it('accepts an active rule once verified', () => {
    const good = `
id: x.y
authority_type: case_law
case_name: Test
citation: Test
jurisdiction: 9th Cir.
precedential_weight: binding_circuit
theory: t
scope: as_written
detection:
  - target: t
    test: dual_um_vendor
finding_template: f
remediation_prompt: r
verified_by: "JD"
verified_date: "2026-07-01"
active: true
`;
    const rule = parseCaselawRule(good);
    expect(rule.active).toBe(true);
  });
});

describe('registry — only active rules fire', () => {
  const rules = loadCaselawFromDir(caselawDir);

  it('evaluates to zero hits with the shipped (all-inactive) pack even when facts match', () => {
    const reg = new CaselawRegistry(rules);
    const hits = reg.evaluate({ dualUmVendor: true, wildernessExclusion: true, abaExclusion: true });
    expect(hits).toHaveLength(0);
    expect(reg.inactiveRules().length).toBe(rules.length);
  });

  it('fires only after a rule is activated', () => {
    const activated = rules.map((r) =>
      r.id === 'nqtl.dual_um_vendor' ? { ...r, verified_by: 'JD', verified_date: '2026-07-01', active: true } : r,
    );
    const reg = new CaselawRegistry(activated);
    const hits = reg.evaluate({ dualUmVendor: true }, { venueState: 'CT' });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.ruleId).toBe('nqtl.dual_um_vendor');
    expect(hits[0]!.track).toBe('litigation');
  });

  it('reference-only rules (empty detection) never fire even when activated', () => {
    const activated = rules.map((r) =>
      r.id === 'smith_golden_rule.no_analog_required'
        ? { ...r, verified_by: 'JD', verified_date: '2026-07-01', active: true }
        : r,
    );
    const reg = new CaselawRegistry(activated);
    expect(reg.evaluate({})).toHaveLength(0);
  });

  it('exposes a verification queue', () => {
    const reg = new CaselawRegistry(rules);
    const queue = reg.verificationQueue();
    expect(queue.every((q) => q.verified === false)).toBe(true);
    expect(queue.find((q) => q.id === 'wit_ubh.gasc_deviation')).toBeDefined();
  });
});

describe('venue weighting', () => {
  const rules = loadCaselawFromDir(caselawDir);
  const wit = rules.find((r) => r.id === 'danny_p.room_and_board')!; // 9th Cir. binding_circuit

  it('is binding in a 9th-Circuit venue (CA)', () => {
    expect(venueWeight(wit, 'CA').label).toBe('binding_in_venue');
  });
  it('is only persuasive in a 2nd-Circuit venue (CT)', () => {
    expect(venueWeight(wit, 'CT').label).toBe('persuasive_out_of_circuit');
  });
  it('treats settlements/regulator findings as enforcement posture', () => {
    const walsh = rules.find((r) => r.id === 'dol_ubh_settlement.oon_rate_reduction')!;
    expect(venueWeight(walsh, 'NY').label).toBe('enforcement_posture');
  });
});
