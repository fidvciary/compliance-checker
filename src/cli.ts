#!/usr/bin/env node
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runAnalysis, RULESETS_DIR, CASELAW_DIR, type AnalysisInput } from './pipeline.js';
import { loadRulesetsFromDir } from './rulesets/loader.js';
import { loadCaselawFromDir } from './analysis/caselaw/loader.js';
import { CaselawRegistry } from './analysis/caselaw/registry.js';
import { renderMarkdown } from './report/report-model.js';
import { AttorneyReviewGate } from './attorney/review-gate.js';
import { buildDemoInput } from './demo.js';
import { compareSeverity } from './findings/finding.js';
import { scanPlanDocumentFile, describeDocumentScan, extractWarningSignPassages } from './ingestion/document-scan.js';

/**
 * `parity` CLI. Subcommands:
 *   analyze [--demo | --input <json>] [--scope both] [--rulesets ...] [--advisory ...]
 *           [--jurisdiction CT] [--nqtl-set core] [--plan-year 2025] [--output ./out]
 *   rulesets            list loaded rulesets + enforcement status
 *   verify-caselaw      list the case-law verification queue (all ship inactive)
 */

function parseFlags(argv: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    }
  }
  return flags;
}

function list(v: string | boolean | undefined): string[] {
  return typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];
}

function cmdRulesets(): void {
  const rulesets = loadRulesetsFromDir(RULESETS_DIR);
  console.log('Loaded rulesets:\n');
  for (const r of rulesets.sort((a, b) => a.id.localeCompare(b.id))) {
    console.log(`  ${r.id.padEnd(22)} [${r.enforcement_status.padEnd(20)}] ${r.jurisdiction.padEnd(8)} ${r.title}`);
  }
  console.log('\nOnly enforced rulesets should be selected as --rulesets; non_enforced_federal (e.g. federal:2024) belongs under --advisory.');
}

function cmdVerifyCaselaw(): void {
  const rules = loadCaselawFromDir(CASELAW_DIR);
  const reg = new CaselawRegistry(rules);
  const q = reg.verificationQueue();
  console.log(`Case-law verification queue (${q.length} rules; ${q.filter((x) => x.verified).length} verified):\n`);
  for (const item of q) {
    console.log(`  [${item.verified ? 'VERIFIED' : 'INACTIVE '}] ${item.id}`);
    console.log(`      ${item.caseName}`);
    console.log(`      ${item.citation}\n`);
  }
  console.log('All rules ship INACTIVE. An attorney must confirm each citation/holding/posture and set verified_by +');
  console.log('verified_date + active:true before the rule can fire. See caselaw/README.md.');
}

async function cmdAnalyze(flags: Record<string, string | boolean>): Promise<void> {
  let input: AnalysisInput;
  if (flags.demo) {
    input = buildDemoInput();
  } else if (typeof flags.input === 'string') {
    input = JSON.parse(readFileSync(flags.input, 'utf8')) as AnalysisInput;
  } else if (typeof flags.documents === 'string') {
    // Start a run from plan document(s) alone (as-written screen -> full report).
    input = {
      analysisId: 'DOC-RUN',
      planYear: new Date().getUTCFullYear(),
      scope: 'as-written',
      jurisdiction: typeof flags.jurisdiction === 'string' ? flags.jurisdiction : 'federal',
      rulesetSelectors: { active: ['federal:statute', 'federal:2013', 'guidance:*'], advisory: ['federal:2024'] },
      nqtlSet: 'core',
    };
  } else {
    console.error('Provide --demo, --input <analysis-input.json>, or --documents <plan.pdf,...>. See README.');
    process.exit(2);
    return;
  }

  // Extract warning-sign candidate passages from any plan documents and merge them.
  if (typeof flags.documents === 'string') {
    const paths = list(flags.documents);
    const extracted = await extractWarningSignPassages(paths);
    input.warningSignPassages = [...(input.warningSignPassages ?? []), ...extracted];
    console.log(`Extracted ${extracted.length} candidate passage(s) from ${paths.length} document(s).`);
  }

  // CLI flag overrides
  if (typeof flags.scope === 'string') input.scope = flags.scope as AnalysisInput['scope'];
  if (typeof flags['plan-year'] === 'string') input.planYear = Number(flags['plan-year']);
  if (typeof flags.jurisdiction === 'string') input.jurisdiction = flags.jurisdiction;
  if (typeof flags['nqtl-set'] === 'string') input.nqtlSet = flags['nqtl-set'] as AnalysisInput['nqtlSet'];
  if (flags.rulesets) input.rulesetSelectors = { active: list(flags.rulesets), advisory: list(flags.advisory) };

  const outDir = typeof flags.output === 'string' ? flags.output : join(process.cwd(), 'output');
  mkdirSync(outDir, { recursive: true });

  const result = runAnalysis(input);

  // Write DRAFT reports + audit log.
  writeFileSync(join(outDir, 'comparative-analysis.draft.md'), renderMarkdown(result.comparativeReport));
  writeFileSync(join(outDir, 'self-compliance-tool.draft.md'), renderMarkdown(result.selfComplianceReport));
  writeFileSync(join(outDir, 'audit-log.jsonl'), result.audit.toJSONL());

  const summary = {
    analysisId: input.analysisId,
    scope: input.scope,
    rulesets: result.registry.coverSummary(),
    findingCount: result.findings.length,
    bySeverity: countBy(result.findings.map((f) => f.severity)),
    byTrack: countBy(result.findings.map((f) => f.track)),
    advisoryFindings: result.findings.filter((f) => f.advisory).length,
    auditHeadHash: result.audit.headHash(),
    reportStatus: result.comparativeReport.status,
  };
  writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));

  console.log(`Analysis ${input.analysisId} complete (scope: ${input.scope}).`);
  console.log(`Findings: ${result.findings.length} (${JSON.stringify(summary.bySeverity)})`);
  console.log('Top findings:');
  for (const f of result.findings.slice().sort(compareSeverity).slice(0, 8)) {
    console.log(`  [${f.severity}] (${f.track}${f.advisory ? ', advisory' : ''}) ${f.title}`);
  }
  console.log(`\nReports are DRAFT — NOT a completed comparative analysis until attorney-approved.`);
  console.log(`Wrote: comparative-analysis.draft.md, self-compliance-tool.draft.md, audit-log.jsonl, summary.json -> ${outDir}`);
  console.log(`\nAttorney gate: submit -> dispose each conclusion -> approve (identity + bar + hash) -> finalize -> export FINAL.`);
  void AttorneyReviewGate; // gate is used programmatically / in tests; CLI emits DRAFT only.
}

function countBy(items: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of items) out[i] = (out[i] ?? 0) + 1;
  return out;
}

async function cmdScanDocument(flags: Record<string, string | boolean>, positional: string[]): Promise<void> {
  const file = positional[0] ?? (typeof flags.file === 'string' ? flags.file : undefined);
  if (!file) {
    console.error('Usage: parity scan-document <plan.pdf|plan.txt> [--output ./out]');
    process.exit(2);
    return;
  }
  const result = await scanPlanDocumentFile(file);
  const description = describeDocumentScan(result);
  console.log(description);
  if (typeof flags.output === 'string') {
    mkdirSync(flags.output, { recursive: true });
    writeFileSync(join(flags.output, 'document-scan.md'), description);
    console.log(`\n(Written to ${join(flags.output, 'document-scan.md')})`);
  }
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  const positional = rest.filter((a) => !a.startsWith('--'));
  switch (cmd) {
    case 'analyze':
      await cmdAnalyze(parseFlags(rest));
      break;
    case 'scan-document':
      await cmdScanDocument(parseFlags(rest), positional);
      break;
    case 'rulesets':
      cmdRulesets();
      break;
    case 'verify-caselaw':
      cmdVerifyCaselaw();
      break;
    default:
      console.log('parity — MHPAEA parity compliance engine\n');
      console.log('Usage:');
      console.log('  parity scan-document <plan.pdf|plan.txt> [--output ./out]   # upload a plan, get a what-may-not-be-compliant screen');
      console.log('  parity analyze --demo [--scope both] [--output ./out]');
      console.log('  parity analyze --input <analysis-input.json> --rulesets federal:statute,federal:2013,guidance:* --advisory federal:2024');
      console.log('  parity rulesets');
      console.log('  parity verify-caselaw');
      if (cmd && cmd !== 'help' && cmd !== '--help') process.exit(2);
  }
}

void main();
