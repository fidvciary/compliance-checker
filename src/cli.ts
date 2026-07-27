#!/usr/bin/env node
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runAnalysis, RULESETS_DIR, CASELAW_DIR, type AnalysisInput } from './pipeline.js';
import { loadRulesetsFromDir } from './rulesets/loader.js';
import { loadCaselawFromDir } from './analysis/caselaw/loader.js';
import { CaselawRegistry } from './analysis/caselaw/registry.js';
import { renderMarkdown } from './report/report-model.js';
import { renderReportHtml, renderDocumentScanHtml } from './report/render-html.js';
import { AttorneyReviewGate } from './attorney/review-gate.js';
import { buildDemoInput } from './demo.js';
import { scanPlanDocumentFile, describeDocumentScan, extractWarningSignPassages, extractAllChunks } from './ingestion/document-scan.js';
import { readFileSync as readFileBytes } from 'node:fs';
import { basename } from 'node:path';
import { checkCompliance, type CheckScope, type UploadedFile } from './check.js';
import { renderIssuesHtml } from './report/render-html.js';
import { startServer } from './ui/server.js';

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

  // Extract candidate passages from any plan documents and merge them: warning
  // signs from the fired passages, cost-share levels from all chunks.
  if (typeof flags.documents === 'string') {
    const paths = list(flags.documents);
    const extracted = await extractWarningSignPassages(paths);
    const allChunks = await extractAllChunks(paths);
    input.warningSignPassages = [...(input.warningSignPassages ?? []), ...extracted];
    input.costSharePassages = [...(input.costSharePassages ?? []), ...allChunks];
    console.log(`Extracted ${extracted.length} warning-sign passage(s) and scanned ${allChunks.length} chunks for cost shares from ${paths.length} document(s).`);
  }

  // CLI flag overrides
  if (typeof flags.scope === 'string') input.scope = flags.scope as AnalysisInput['scope'];
  if (typeof flags['plan-year'] === 'string') input.planYear = Number(flags['plan-year']);
  if (typeof flags.jurisdiction === 'string') input.jurisdiction = flags.jurisdiction;
  if (typeof flags['nqtl-set'] === 'string') input.nqtlSet = flags['nqtl-set'] as AnalysisInput['nqtlSet'];
  if (typeof flags.sensitivity === 'string') input.sensitivity = flags.sensitivity as AnalysisInput['sensitivity'];
  if (flags.rulesets) input.rulesetSelectors = { active: list(flags.rulesets), advisory: list(flags.advisory) };

  const outDir = typeof flags.output === 'string' ? flags.output : join(process.cwd(), 'output');
  mkdirSync(outDir, { recursive: true });

  const result = runAnalysis(input);

  // Write DRAFT reports + audit log. Default format is a styled HTML doc plus
  // the Markdown source; --format md|html|both.
  const format = typeof flags.format === 'string' ? flags.format : 'both';
  const writeMd = format === 'md' || format === 'both';
  const writeHtml = format === 'html' || format === 'both';
  if (writeMd) {
    writeFileSync(join(outDir, 'comparative-analysis.draft.md'), renderMarkdown(result.comparativeReport));
    writeFileSync(join(outDir, 'self-compliance-tool.draft.md'), renderMarkdown(result.selfComplianceReport));
  }
  if (writeHtml) {
    writeFileSync(join(outDir, 'comparative-analysis.draft.html'), renderReportHtml(result.comparativeReport));
    writeFileSync(join(outDir, 'self-compliance-tool.draft.html'), renderReportHtml(result.selfComplianceReport));
  }
  writeFileSync(join(outDir, 'audit-log.jsonl'), result.audit.toJSONL());

  const ranked = result.findings.slice().sort((a, b) => (b.risk?.score ?? 0) - (a.risk?.score ?? 0));
  const summary = {
    analysisId: input.analysisId,
    scope: input.scope,
    sensitivity: input.sensitivity ?? 'balanced',
    rulesets: result.registry.coverSummary(),
    findingCount: result.findings.length,
    bySeverity: countBy(result.findings.map((f) => f.severity)),
    byRiskTier: countBy(result.findings.map((f) => f.risk?.tier ?? 'unknown')),
    byTrack: countBy(result.findings.map((f) => f.track)),
    advisoryFindings: result.findings.filter((f) => f.advisory).length,
    auditHeadHash: result.audit.headHash(),
    reportStatus: result.comparativeReport.status,
  };
  writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));

  console.log(`Analysis ${input.analysisId} complete (scope: ${input.scope}, sensitivity: ${summary.sensitivity}).`);
  console.log(`Findings: ${result.findings.length} — by risk tier: ${JSON.stringify(summary.byRiskTier)}`);
  console.log('Top findings (ranked by risk):');
  for (const f of ranked.slice(0, 10)) {
    const risk = f.risk ? `${f.risk.tier} ${f.risk.score}` : '—';
    console.log(`  [risk ${risk.padEnd(12)}] [${f.severity}] (${f.track}${f.advisory ? ', advisory' : ''}) ${f.title}`);
  }
  console.log(`\nReports are DRAFT — NOT a completed comparative analysis until attorney-approved.`);
  const wrote = [
    writeHtml ? 'comparative-analysis.draft.html' : '',
    writeMd ? 'comparative-analysis.draft.md' : '',
    writeHtml ? 'self-compliance-tool.draft.html' : '',
    'audit-log.jsonl', 'summary.json',
  ].filter(Boolean).join(', ');
  console.log(`Wrote: ${wrote} -> ${outDir}`);
  if (writeHtml) console.log(`Open comparative-analysis.draft.html in a browser; Print → Save as PDF for a polished PDF.`);
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
    const format = typeof flags.format === 'string' ? flags.format : 'both';
    if (format === 'md' || format === 'both') writeFileSync(join(flags.output, 'document-scan.md'), description);
    if (format === 'html' || format === 'both') writeFileSync(join(flags.output, 'document-scan.html'), renderDocumentScanHtml(result));
    console.log(`\n(Written to ${flags.output}: document-scan.html + .md — open the .html in a browser, Print → Save as PDF.)`);
  }
}

async function cmdServe(flags: Record<string, string | boolean>): Promise<void> {
  const port = typeof flags.port === 'string' ? Number(flags.port) : 4732;
  startServer({ port });
  await new Promise(() => {}); // keep the process alive
}

async function cmdCheck(flags: Record<string, string | boolean>, positional: string[]): Promise<void> {
  if (positional.length === 0) {
    console.error('Usage: parity check <plan.pdf> [claims.csv ...] [--scope as-written|everything] [--sensitivity balanced|aggressive] [--jurisdiction CT] [--output ./out]');
    process.exit(2);
    return;
  }
  const scope: CheckScope = flags.scope === 'everything' ? 'everything' : 'as-written';
  const files: UploadedFile[] = positional.map((p) => ({ name: basename(p), bytes: readFileBytes(p) }));
  const result = await checkCompliance(files, {
    scope,
    ...(typeof flags.sensitivity === 'string' ? { sensitivity: flags.sensitivity as never } : {}),
    ...(typeof flags.jurisdiction === 'string' ? { jurisdiction: flags.jurisdiction } : {}),
  });

  for (const p of result.phiRejections) console.log(`\n${p.report}\n`);
  console.log(`Parity check (${result.scope}, ${result.sensitivity}) — ${result.issues.length} issue(s) flagged:\n`);
  for (const f of result.issues) {
    const risk = f.risk ? `${f.risk.tier} ${f.risk.score}` : '—';
    console.log(`  [risk ${risk.padEnd(12)}] [${f.severity}] (${f.track}) ${f.title}`);
  }
  if (result.issues.length === 0) console.log('  (none flagged in what was analyzed — absence of flags is not a determination of compliance)');
  if (typeof flags.output === 'string') {
    mkdirSync(flags.output, { recursive: true });
    writeFileSync(join(flags.output, 'compliance-check.html'), renderIssuesHtml(result));
    console.log(`\nWrote compliance-check.html -> ${flags.output} (open in a browser; Print → Save as PDF).`);
  }
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  const positional = rest.filter((a) => !a.startsWith('--'));
  switch (cmd) {
    case 'serve':
      await cmdServe(parseFlags(rest));
      break;
    case 'check':
      await cmdCheck(parseFlags(rest), positional);
      break;
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
      console.log('parity — MHPAEA parity compliance checker\n');
      console.log('Usage:');
      console.log('  parity serve [--port 4732]                          # ← web UI: upload a plan, flag issues');
      console.log('  parity check <plan.pdf> [claims.csv] [--scope as-written|everything] [--sensitivity aggressive] [--output ./out]');
      console.log('  parity scan-document <plan.pdf|plan.txt> [--output ./out] [--format html|md|both]   # upload a plan → screen');
      console.log('  parity analyze --demo [--scope both] [--sensitivity aggressive] [--format html|md|both] [--output ./out]');
      console.log('  parity analyze --documents <plan.pdf,...> [--sensitivity aggressive] [--output ./out]   # doc → full report');
      console.log('  parity analyze --input <analysis-input.json> --rulesets federal:statute,federal:2013,guidance:* --advisory federal:2024');
      console.log('  parity rulesets');
      console.log('  parity verify-caselaw');
      if (cmd && cmd !== 'help' && cmd !== '--help') process.exit(2);
  }
}

void main();
