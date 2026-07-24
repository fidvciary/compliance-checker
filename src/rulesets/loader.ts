import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import yaml from 'js-yaml';
import type {
  Ruleset,
  AuthorityType,
  EnforcementStatus,
  AppliesTo,
} from './types.js';

const AUTHORITY_TYPES: AuthorityType[] = [
  'statute',
  'regulation',
  'subregulatory_guidance',
  'case_law',
  'enforcement_action',
];
const ENFORCEMENT_STATUSES: EnforcementStatus[] = [
  'enforced',
  'non_enforced_federal',
  'not_yet_proposed',
  'sunset',
];
const APPLIES_TO: AppliesTo[] = ['self_funded', 'fully_insured', 'both'];

function requireString(v: unknown, field: string, ctx: string): string {
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(`Ruleset ${ctx}: field '${field}' must be a non-empty string`);
  }
  return v;
}

function optionalDate(v: unknown, field: string, ctx: string): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) {
    throw new Error(`Ruleset ${ctx}: field '${field}' must be an ISO date or null`);
  }
  return v;
}

function validateRuleset(raw: unknown, ctx: string): Ruleset {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`Ruleset ${ctx}: file must contain a mapping`);
  }
  const r = raw as Record<string, unknown>;

  const authority_type = requireString(r.authority_type, 'authority_type', ctx) as AuthorityType;
  if (!AUTHORITY_TYPES.includes(authority_type)) {
    throw new Error(`Ruleset ${ctx}: invalid authority_type '${authority_type}'`);
  }
  const enforcement_status = requireString(
    r.enforcement_status,
    'enforcement_status',
    ctx,
  ) as EnforcementStatus;
  if (!ENFORCEMENT_STATUSES.includes(enforcement_status)) {
    throw new Error(`Ruleset ${ctx}: invalid enforcement_status '${enforcement_status}'`);
  }
  const applies_to = requireString(r.applies_to, 'applies_to', ctx) as AppliesTo;
  if (!APPLIES_TO.includes(applies_to)) {
    throw new Error(`Ruleset ${ctx}: invalid applies_to '${applies_to}'`);
  }

  const provisionsRaw = Array.isArray(r.provisions) ? r.provisions : [];
  const provisions = provisionsRaw.map((p, i) => {
    const pr = p as Record<string, unknown>;
    return {
      id: requireString(pr.id, `provisions[${i}].id`, ctx),
      citation: requireString(pr.citation, `provisions[${i}].citation`, ctx),
      summary: requireString(pr.summary, `provisions[${i}].summary`, ctx),
      tags: Array.isArray(pr.tags) ? (pr.tags as string[]) : undefined,
    };
  });

  return {
    id: requireString(r.id, 'id', ctx),
    title: requireString(r.title, 'title', ctx),
    authority_type,
    citation: requireString(r.citation, 'citation', ctx),
    enforcement_status,
    effective_date: optionalDate(r.effective_date, 'effective_date', ctx),
    sunset_date: optionalDate(r.sunset_date, 'sunset_date', ctx),
    applies_to,
    jurisdiction: requireString(r.jurisdiction, 'jurisdiction', ctx),
    note: typeof r.note === 'string' ? r.note : undefined,
    provisions,
    source_file: ctx,
  };
}

/** Parse a single ruleset YAML string. */
export function parseRuleset(text: string, ctx = '<inline>'): Ruleset {
  const raw = yaml.load(text);
  return validateRuleset(raw, ctx);
}

/**
 * Recursively load every *.yaml/*.yml file under `rootDir` as a ruleset.
 * Enforces that ruleset IDs are globally unique.
 */
export function loadRulesetsFromDir(rootDir: string): Ruleset[] {
  const found: Ruleset[] = [];
  const seen = new Map<string, string>();

  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full);
      } else if (name.endsWith('.yaml') || name.endsWith('.yml')) {
        const rel = relative(rootDir, full);
        const rs = validateRuleset(yaml.load(readFileSync(full, 'utf8')), rel);
        if (seen.has(rs.id)) {
          throw new Error(
            `Duplicate ruleset id '${rs.id}' in ${rel} (already defined in ${seen.get(rs.id)})`,
          );
        }
        seen.set(rs.id, rel);
        found.push(rs);
      }
    }
  };

  walk(rootDir);
  return found;
}
