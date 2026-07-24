import type { Ruleset, RulesetRole } from './types.js';

/**
 * The set of rulesets in play for a single run, each tagged active or advisory.
 *
 * A run is parameterized like:
 *   --rulesets federal:statute,federal:2013,guidance:*,state:ct --advisory federal:2024
 *
 * A finding carries the ruleset IDs it depends on. If EVERY ruleset a finding
 * depends on is advisory, the finding is segregated into the advisory report
 * section and labeled "ADVISORY — NOT CURRENTLY FEDERALLY ENFORCED". If it
 * depends on at least one active ruleset, it is a required-now finding.
 */

/** Selector supports exact ids ('federal:2013') and namespace wildcards ('guidance:*'). */
export function matchesSelector(id: string, selector: string): boolean {
  if (selector === '*') return true;
  if (selector.endsWith(':*')) {
    const ns = selector.slice(0, -2);
    return id === ns || id.startsWith(`${ns}:`);
  }
  return id === selector;
}

function selectIds(all: Ruleset[], selectors: string[]): Set<string> {
  const out = new Set<string>();
  for (const rs of all) {
    if (selectors.some((sel) => matchesSelector(rs.id, sel))) out.add(rs.id);
  }
  return out;
}

export interface RegistryConfig {
  /** Selectors for active (required-now) rulesets. */
  active: string[];
  /** Selectors for advisory (prudent-but-not-enforced) rulesets. */
  advisory: string[];
}

export class RulesetRegistry {
  private readonly byId = new Map<string, Ruleset>();
  private readonly role = new Map<string, RulesetRole>();

  constructor(all: Ruleset[], config: RegistryConfig) {
    for (const rs of all) this.byId.set(rs.id, rs);

    const activeIds = selectIds(all, config.active);
    const advisoryIds = selectIds(all, config.advisory);

    // A ruleset selected as active wins over advisory (active is stronger).
    for (const id of advisoryIds) this.role.set(id, 'advisory');
    for (const id of activeIds) this.role.set(id, 'active');

    // Integrity guard: a ruleset marked non_enforced_federal / not_yet_proposed
    // must not be silently treated as active. If a caller selects it as active,
    // that is allowed (they may be modeling a future state) but it is surfaced.
    for (const id of activeIds) {
      const rs = this.byId.get(id);
      if (rs && (rs.enforcement_status === 'non_enforced_federal' || rs.enforcement_status === 'not_yet_proposed')) {
        this.warnings.push(
          `Ruleset '${id}' has enforcement_status '${rs.enforcement_status}' but was selected as ACTIVE. ` +
            `Findings depending on it will be treated as required-now. Confirm this is intended.`,
        );
      }
    }

    // Any selector that matched nothing is surfaced rather than silently ignored.
    for (const sel of [...config.active, ...config.advisory]) {
      if (!all.some((rs) => matchesSelector(rs.id, sel))) {
        this.warnings.push(`Ruleset selector '${sel}' matched no loaded ruleset.`);
      }
    }
  }

  readonly warnings: string[] = [];

  get(id: string): Ruleset | undefined {
    return this.byId.get(id);
  }

  roleOf(id: string): RulesetRole | undefined {
    return this.role.get(id);
  }

  /** True if the given ruleset id is in play (active or advisory) for this run. */
  isSelected(id: string): boolean {
    return this.role.has(id);
  }

  activeRulesets(): Ruleset[] {
    return [...this.role.entries()]
      .filter(([, role]) => role === 'active')
      .map(([id]) => this.byId.get(id)!)
      .filter(Boolean);
  }

  advisoryRulesets(): Ruleset[] {
    return [...this.role.entries()]
      .filter(([, role]) => role === 'advisory')
      .map(([id]) => this.byId.get(id)!)
      .filter(Boolean);
  }

  /**
   * Classify a finding by the rulesets it depends on.
   *  - 'active'   : at least one dependency is active → required-now
   *  - 'advisory' : all dependencies are advisory → segregated advisory section
   *  - 'unselected': depends on ruleset(s) not in this run's set (finding should
   *                  not have been produced; caller decides how to surface)
   */
  classifyFinding(authorityRefs: string[]): 'active' | 'advisory' | 'unselected' {
    if (authorityRefs.length === 0) return 'unselected';
    let anyActive = false;
    let anySelected = false;
    for (const ref of authorityRefs) {
      const role = this.role.get(ref);
      if (role === 'active') anyActive = true;
      if (role) anySelected = true;
    }
    if (anyActive) return 'active';
    if (anySelected) return 'advisory';
    return 'unselected';
  }

  /** Summary for the report cover page. */
  coverSummary(): { active: string[]; advisory: string[] } {
    return {
      active: this.activeRulesets().map((r) => r.id).sort(),
      advisory: this.advisoryRulesets().map((r) => r.id).sort(),
    };
  }
}
