import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import yaml from 'js-yaml';
import {
  type CaselawRule,
  type CaselawAuthorityType,
  type PrecedentialWeight,
  type CaselawScope,
  assertActivationInvariant,
} from './rule-schema.js';
import { PREDICATES } from './predicates.js';
import { evaluateExpression } from './expression.js';

const AUTHORITY_TYPES: CaselawAuthorityType[] = ['case_law', 'enforcement_action', 'regulator_finding'];
const WEIGHTS: PrecedentialWeight[] = [
  'binding_scotus',
  'binding_circuit',
  'persuasive_circuit',
  'persuasive_district',
  'settlement',
  'regulator_finding',
];
const SCOPES: CaselawScope[] = ['as_written', 'in_operation', 'both'];

function str(v: unknown, field: string, ctx: string): string {
  if (typeof v !== 'string' || v.length === 0) throw new Error(`Case-law rule ${ctx}: '${field}' must be a non-empty string`);
  return v;
}

function validateRule(raw: unknown, ctx: string): CaselawRule {
  if (typeof raw !== 'object' || raw === null) throw new Error(`Case-law rule ${ctx}: must be a mapping`);
  const r = raw as Record<string, unknown>;

  const authority_type = str(r.authority_type, 'authority_type', ctx) as CaselawAuthorityType;
  if (!AUTHORITY_TYPES.includes(authority_type)) throw new Error(`Case-law rule ${ctx}: invalid authority_type '${authority_type}'`);
  const precedential_weight = str(r.precedential_weight, 'precedential_weight', ctx) as PrecedentialWeight;
  if (!WEIGHTS.includes(precedential_weight)) throw new Error(`Case-law rule ${ctx}: invalid precedential_weight '${precedential_weight}'`);
  const scope = str(r.scope, 'scope', ctx) as CaselawScope;
  if (!SCOPES.includes(scope)) throw new Error(`Case-law rule ${ctx}: invalid scope '${scope}'`);

  const detectionRaw = Array.isArray(r.detection) ? r.detection : [];
  const detection = detectionRaw.map((d, i) => {
    const dr = d as Record<string, unknown>;
    const test = str(dr.test, `detection[${i}].test`, ctx);
    // Validate the expression parses and references only registered predicates.
    try {
      evaluateExpression(test, (name) => {
        if (!PREDICATES[name]) throw new Error(`unknown predicate '${name}'`);
        return false;
      });
    } catch (e) {
      throw new Error(`Case-law rule ${ctx}: detection[${i}].test invalid — ${(e as Error).message}`);
    }
    return { target: str(dr.target, `detection[${i}].target`, ctx), test };
  });

  const rule: CaselawRule = {
    id: str(r.id, 'id', ctx),
    authority_type,
    case_name: str(r.case_name, 'case_name', ctx),
    citation: str(r.citation, 'citation', ctx),
    jurisdiction: str(r.jurisdiction, 'jurisdiction', ctx),
    precedential_weight,
    theory: str(r.theory, 'theory', ctx),
    scope,
    detection,
    detection_mode: r.detection_mode === 'any' ? 'any' : 'all',
    finding_template: str(r.finding_template, 'finding_template', ctx),
    remediation_prompt: str(r.remediation_prompt, 'remediation_prompt', ctx),
    verified_by: typeof r.verified_by === 'string' && r.verified_by.length > 0 ? r.verified_by : null,
    verified_date: typeof r.verified_date === 'string' && r.verified_date.length > 0 ? r.verified_date : null,
    active: r.active === true,
    note: typeof r.note === 'string' ? r.note : undefined,
    source_file: ctx,
  };

  // THE GATE: refuse to load an active rule that is not attorney-verified.
  assertActivationInvariant(rule);
  return rule;
}

export function parseCaselawRule(text: string, ctx = '<inline>'): CaselawRule {
  return validateRule(yaml.load(text), ctx);
}

/** Load every *.yaml under `rootDir` as a case-law rule (one authority per file). */
export function loadCaselawFromDir(rootDir: string): CaselawRule[] {
  const rules: CaselawRule[] = [];
  const seen = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (name.endsWith('.yaml') || name.endsWith('.yml')) {
        const rel = relative(rootDir, full);
        const rule = validateRule(yaml.load(readFileSync(full, 'utf8')), rel);
        if (seen.has(rule.id)) throw new Error(`Duplicate case-law rule id '${rule.id}' (${rel} and ${seen.get(rule.id)})`);
        seen.set(rule.id, rel);
        rules.push(rule);
      }
    }
  };
  walk(rootDir);
  return rules;
}
