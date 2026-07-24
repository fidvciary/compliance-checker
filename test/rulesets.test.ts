import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadRulesetsFromDir, parseRuleset } from '../src/rulesets/loader.js';
import { RulesetRegistry, matchesSelector } from '../src/rulesets/registry.js';

const here = dirname(fileURLToPath(import.meta.url));
const rulesetsDir = join(here, '..', 'rulesets');

describe('ruleset loader', () => {
  it('loads all shipped rulesets with unique ids', () => {
    const all = loadRulesetsFromDir(rulesetsDir);
    const ids = all.map((r) => r.id);
    expect(ids).toContain('federal:statute');
    expect(ids).toContain('federal:2013');
    expect(ids).toContain('federal:2024');
    expect(ids).toContain('guidance:warning-signs');
    expect(new Set(ids).size).toBe(ids.length); // uniqueness enforced
  });

  it('marks the 2024 rule as federally non-enforced', () => {
    const all = loadRulesetsFromDir(rulesetsDir);
    const r2024 = all.find((r) => r.id === 'federal:2024')!;
    expect(r2024.enforcement_status).toBe('non_enforced_federal');
    expect(r2024.note).toMatch(/ERIC/i);
  });

  it('rejects an invalid enforcement_status', () => {
    const bad = `
id: "x"
title: "x"
authority_type: regulation
citation: "x"
enforcement_status: totally_made_up
effective_date: null
sunset_date: null
applies_to: both
jurisdiction: federal
`;
    expect(() => parseRuleset(bad)).toThrow(/invalid enforcement_status/);
  });
});

describe('selector matching', () => {
  it('matches exact ids and namespace wildcards', () => {
    expect(matchesSelector('federal:2013', 'federal:2013')).toBe(true);
    expect(matchesSelector('guidance:warning-signs', 'guidance:*')).toBe(true);
    expect(matchesSelector('state:ct', 'guidance:*')).toBe(false);
    expect(matchesSelector('anything', '*')).toBe(true);
  });
});

describe('RulesetRegistry', () => {
  const all = loadRulesetsFromDir(rulesetsDir);

  it('classifies a finding by active vs advisory dependencies', () => {
    const reg = new RulesetRegistry(all, {
      active: ['federal:statute', 'federal:2013', 'guidance:*', 'state:ct'],
      advisory: ['federal:2024'],
    });
    // depends on an active ruleset -> required now
    expect(reg.classifyFinding(['federal:2013'])).toBe('active');
    // depends only on the advisory 2024 rule -> segregated advisory
    expect(reg.classifyFinding(['federal:2024'])).toBe('advisory');
    // mixed -> active wins
    expect(reg.classifyFinding(['federal:2024', 'federal:statute'])).toBe('active');
    // depends on a ruleset not in the run
    expect(reg.classifyFinding(['state:ny'])).toBe('unselected');
  });

  it('warns when an advisory-status ruleset is selected as active', () => {
    const reg = new RulesetRegistry(all, { active: ['federal:2024'], advisory: [] });
    expect(reg.warnings.some((w) => /ACTIVE/.test(w))).toBe(true);
  });

  it('warns on selectors that match nothing', () => {
    const reg = new RulesetRegistry(all, { active: ['federal:9999'], advisory: [] });
    expect(reg.warnings.some((w) => /matched no loaded ruleset/.test(w))).toBe(true);
  });

  it('exposes a stable cover summary', () => {
    const reg = new RulesetRegistry(all, {
      active: ['federal:statute', 'federal:2013'],
      advisory: ['federal:2024'],
    });
    expect(reg.coverSummary()).toEqual({
      active: ['federal:2013', 'federal:statute'],
      advisory: ['federal:2024'],
    });
  });
});
