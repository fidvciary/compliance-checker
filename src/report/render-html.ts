import type { ReportRecord, CoverPage } from './report-model.js';
import type { Finding, RiskTier } from '../findings/finding.js';
import { compareSeverity } from '../findings/finding.js';
import { mdToHtml, escapeHtml } from './markdown-lite.js';
import type { DocumentScanResult } from '../ingestion/document-scan.js';
import type { CheckResult } from '../check.js';

/**
 * Self-contained, print-friendly HTML renderer for a ReportRecord.
 *
 * Digestible up top (status banner, at-a-glance summary, risk dashboard, ranked
 * headline findings) and thorough throughout (every finding as a colour-coded
 * card with evidence, the six-step sections, and the full appendices). No
 * external assets — open in any browser and "Print → Save as PDF" for a polished
 * PDF. The DRAFT / attorney-gate semantics of the Markdown renderer are mirrored.
 */

const TIER_ORDER: RiskTier[] = ['critical', 'high', 'medium', 'low', 'informational'];
const TIER_LABEL: Record<RiskTier, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  informational: 'Info',
};

function byRisk(a: Finding, b: Finding): number {
  return (b.risk?.score ?? 0) - (a.risk?.score ?? 0) || compareSeverity(a, b);
}

const CSS = `
:root{
  --ink:#1e2430; --muted:#5b6472; --line:#e4e7ec; --bg:#f4f5f7; --card:#ffffff;
  --accent:#1f4e79;
  --critical:#b3261e; --critical-bg:#fdecea; --high:#b45309; --high-bg:#fff4e5;
  --medium:#8a6d00; --medium-bg:#fdf6e3; --low:#475569; --low-bg:#f1f5f9;
  --info:#64748b; --info-bg:#f3f5f8; --advisory:#6d28d9; --advisory-bg:#f3effe;
  --draft:#8a6d00; --draft-bg:#fdf6e3;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
  font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  -webkit-font-smoothing:antialiased;}
.doc{max-width:900px;margin:32px auto;background:var(--card);padding:48px 56px;
  border:1px solid var(--line);border-radius:10px;box-shadow:0 1px 3px rgba(16,24,40,.06);}
h1{font-size:26px;line-height:1.25;margin:0 0 4px;font-weight:700;letter-spacing:-.01em}
h2{font-size:19px;margin:36px 0 12px;padding-bottom:6px;border-bottom:2px solid var(--line);letter-spacing:-.01em}
h3{font-size:16px;margin:20px 0 8px}
h4{font-size:14px;margin:14px 0 6px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
p{margin:8px 0}
a{color:var(--accent)}
.sub{color:var(--muted);margin:0 0 16px;font-size:14px}
.status-pill{display:inline-block;font-weight:700;font-size:12px;letter-spacing:.05em;
  padding:5px 12px;border-radius:999px;text-transform:uppercase}
.status-draft{background:var(--draft-bg);color:var(--draft);border:1px solid #eadfa0}
.status-final{background:#e7f4ec;color:#1a7f43;border:1px solid #b7e0c6}
.callout{background:var(--draft-bg);border:1px solid #eadfa0;border-left:4px solid var(--draft);
  padding:12px 16px;border-radius:6px;margin:16px 0;font-size:14px}
.meta{display:grid;grid-template-columns:150px 1fr;gap:6px 16px;margin:16px 0;font-size:14px}
.meta dt{color:var(--muted)}
.meta dd{margin:0}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}
.chip{font-size:12px;padding:3px 9px;border-radius:6px;background:#eef1f5;color:#3a4250;border:1px solid var(--line)}
.chip.adv{background:var(--advisory-bg);color:var(--advisory);border-color:#e3d9fb}
.dash{display:flex;gap:10px;flex-wrap:wrap;margin:14px 0 4px}
.tier-stat{flex:1;min-width:110px;border:1px solid var(--line);border-radius:8px;padding:10px 12px;text-align:center}
.tier-stat .n{font-size:24px;font-weight:700;line-height:1}
.tier-stat .l{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin-top:4px}
.tier-stat.critical .n{color:var(--critical)} .tier-stat.high .n{color:var(--high)}
.tier-stat.medium .n{color:var(--medium)} .tier-stat.low .n{color:var(--low)}
.tier-stat.informational .n{color:var(--info)}
.toc{font-size:14px;margin:8px 0 0;columns:2;color:var(--accent)}
.toc a{display:block;padding:2px 0;text-decoration:none}
.finding{border:1px solid var(--line);border-left:5px solid var(--low);border-radius:8px;
  padding:16px 18px;margin:14px 0;background:#fff;break-inside:avoid}
.finding.critical{border-left-color:var(--critical)} .finding.high{border-left-color:var(--high)}
.finding.medium{border-left-color:var(--medium)} .finding.low{border-left-color:var(--low)}
.finding.informational{border-left-color:var(--info)}
.f-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px}
.badge{font-size:11px;font-weight:700;letter-spacing:.03em;padding:3px 8px;border-radius:6px;white-space:nowrap}
.badge.critical{background:var(--critical-bg);color:var(--critical)}
.badge.high{background:var(--high-bg);color:var(--high)}
.badge.medium{background:var(--medium-bg);color:var(--medium)}
.badge.low{background:var(--low-bg);color:var(--low)}
.badge.informational{background:var(--info-bg);color:var(--info)}
.badge.sev{background:#eef1f5;color:#3a4250}
.badge.adv{background:var(--advisory-bg);color:var(--advisory)}
.f-title{font-size:15px;font-weight:650;flex:1;min-width:220px}
.f-meta{display:flex;flex-wrap:wrap;gap:4px 18px;font-size:12.5px;color:var(--muted);margin:2px 0 8px}
.iq{background:#f7f9fb;border-radius:6px;padding:10px 12px;font-size:14px;margin:8px 0}
.iq b{color:var(--ink)}
blockquote{margin:8px 0;padding:8px 14px;border-left:3px solid var(--line);color:#3a4250;
  background:#fafbfc;font-style:italic;border-radius:0 6px 6px 0}
.cite{font-size:12px;color:var(--muted);font-style:normal;margin-top:4px}
.ev-table{width:100%;border-collapse:collapse;font-size:13px;margin:8px 0}
.ev-table td{padding:3px 8px;border-bottom:1px solid var(--line)}
.ev-table td:first-child{color:var(--muted);width:44%}
.draft-banner{background:var(--draft-bg);border:1px solid #eadfa0;border-radius:6px;padding:10px 12px;
  font-size:13px;margin:8px 0;color:#6b551a}
.table-wrap{overflow-x:auto;margin:10px 0}
table{border-collapse:collapse;width:100%;font-size:13px}
th,td{border:1px solid var(--line);padding:6px 10px;text-align:left;vertical-align:top}
th{background:#f4f6f8;font-weight:650}
code{background:#f1f3f6;padding:1px 5px;border-radius:4px;font-size:12.5px;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.empty{color:var(--muted);font-style:italic}
footer{margin-top:36px;padding-top:16px;border-top:1px solid var(--line);font-size:12px;color:var(--muted)}
@media print{
  body{background:#fff} .doc{box-shadow:none;border:none;margin:0;max-width:none;padding:0}
  .toc{display:none} h2{page-break-after:avoid} .finding{page-break-inside:avoid}
}
`;

function tierBadge(f: Finding): string {
  if (!f.risk) return '';
  return `<span class="badge ${f.risk.tier}">RISK ${TIER_LABEL[f.risk.tier].toUpperCase()} · ${f.risk.score}</span>`;
}

function evidenceHtml(f: Finding): string {
  const parts: string[] = [];
  for (const e of f.evidence) {
    if (e.kind === 'document') {
      const anchor = `${escapeHtml(e.sourceDocumentId)}${e.page ? `, p.${e.page}` : ''}${e.section ? ` · ${escapeHtml(e.section)}` : ''}`;
      parts.push(`<blockquote>${escapeHtml(e.quotedText)}<div class="cite">— ${anchor}</div></blockquote>`);
    } else if (e.kind === 'statistical') {
      const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
      parts.push(
        `<table class="ev-table"><tbody>` +
          `<tr><td>MH/SUD vs M/S</td><td><b>${pct(e.mhsudValue)}</b> vs ${pct(e.msValue)}</td></tr>` +
          `<tr><td>Disparity ratio · difference</td><td>${Number.isFinite(e.ratio) ? e.ratio.toFixed(2) : '∞'}× · ${(e.diff * 100).toFixed(1)} pts</td></tr>` +
          `<tr><td>p-value (raw · adjusted)</td><td>${fmtP(e.pValue)} · ${fmtP(e.pAdjusted)}</td></tr>` +
          (e.ciLow !== undefined ? `<tr><td>95% CI on difference</td><td>[${(e.ciLow * 100).toFixed(1)}, ${(e.ciHigh! * 100).toFixed(1)}] pts</td></tr>` : '') +
          `<tr><td>n (MH/SUD · M/S) · test</td><td>${e.nMhsud} · ${e.nMs} · ${escapeHtml(e.testUsed ?? 'n/a')}</td></tr>` +
          `</tbody></table>`,
      );
    } else {
      const rows = Object.entries(e.values)
        .map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(String(v))}</td></tr>`)
        .join('');
      parts.push(`<div class="cite">${escapeHtml(e.description)}</div><table class="ev-table"><tbody>${rows}</tbody></table>`);
    }
  }
  return parts.join('');
}

function fmtP(p: number | undefined): string {
  if (p === undefined) return 'n/a';
  return p < 0.001 ? '<0.001' : p.toFixed(3);
}

function findingCard(f: Finding, isFinal: boolean): string {
  const tier = f.risk?.tier ?? 'low';
  const badges = [
    tierBadge(f),
    `<span class="badge sev">${escapeHtml(f.severity.replace(/_/g, ' ').toUpperCase())}</span>`,
    f.advisory ? `<span class="badge adv">ADVISORY — NOT ENFORCED</span>` : '',
  ].filter(Boolean).join('');

  let conclusion = '';
  if (f.proposedConclusion) {
    if (isFinal) {
      if (f.attorneyDisposition && (f.attorneyDisposition.action === 'approved' || f.attorneyDisposition.action === 'edited')) {
        conclusion = `<p><b>Conclusion (attorney-approved):</b> ${escapeHtml(f.attorneyDisposition.editedText ?? f.proposedConclusion.text)}</p>`;
      }
    } else {
      conclusion = `<div class="draft-banner"><b>DRAFT — PENDING ATTORNEY REVIEW · NOT LEGAL ADVICE.</b> ${escapeHtml(f.proposedConclusion.text)}</div>`;
    }
  }

  return `<article class="finding ${tier}">
    <div class="f-head">${badges}<span class="f-title">${escapeHtml(f.title)}</span></div>
    <div class="f-meta"><span>Scope: ${escapeHtml(f.scope)}</span><span>Track: ${escapeHtml(f.track)}</span><span>Confidence: ${escapeHtml(f.confidence)}</span><span>Authority: ${escapeHtml(f.authorityRefs.join(', '))}</span></div>
    <div class="iq"><b>Investigation question.</b> ${escapeHtml(f.investigationQuestion)}</div>
    ${evidenceHtml(f)}
    ${conclusion}
  </article>`;
}

function coverHtml(c: CoverPage, isFinal: boolean): string {
  const status = isFinal
    ? `<span class="status-pill status-final">Final</span>`
    : `<span class="status-pill status-draft">${escapeHtml(c.status)} — not a completed comparative analysis until attorney-approved</span>`;
  const chip = (id: string, adv = false) => `<span class="chip${adv ? ' adv' : ''}">${escapeHtml(id)}</span>`;
  return `
    <h1>${escapeHtml(c.title)}</h1>
    <p class="sub">MHPAEA parity analysis · plan year ${c.planYear} · ${escapeHtml(c.jurisdiction)}</p>
    <p>${status}</p>
    <dl class="meta">
      <dt>Evaluation scope</dt><dd>${escapeHtml(c.scope)}</dd>
      <dt>Plan year</dt><dd>${c.planYear}</dd>
      <dt>Sample period</dt><dd>${escapeHtml(c.samplePeriod ?? 'n/a (no in-operation data)')}</dd>
      <dt>Jurisdiction</dt><dd>${escapeHtml(c.jurisdiction)}</dd>
      <dt>Attorney of record</dt><dd>${c.attorneyOfRecord ? `${escapeHtml(c.attorneyOfRecord.name)} (${escapeHtml(c.attorneyOfRecord.barJurisdiction)}), ${escapeHtml(c.attorneyOfRecord.timestamp)}` : 'none (not finalized)'}</dd>
    </dl>
    <h4>Rulesets — required now</h4><div class="chips">${c.rulesetsActive.map((r) => chip(r)).join('') || '<span class="empty">none</span>'}</div>
    <h4>Rulesets — advisory (not currently federally enforced)</h4><div class="chips">${c.rulesetsAdvisory.map((r) => chip(r, true)).join('') || '<span class="empty">none</span>'}</div>
    <h4>Data sources &amp; provenance</h4>
    <ul>${c.dataSources.map((d) => `<li>${escapeHtml(d.artifact)} — <span style="color:var(--muted)">${escapeHtml(d.provenance)}</span></li>`).join('') || '<li class="empty">none provided</li>'}</ul>
    ${c.scopeLimitation ? `<div class="callout"><b>Scope limitation (stated on the report's face).</b> ${escapeHtml(c.scopeLimitation)}</div>` : ''}
  `;
}

function riskDashboard(findings: Finding[]): string {
  const counts: Record<RiskTier, number> = { critical: 0, high: 0, medium: 0, low: 0, informational: 0 };
  for (const f of findings) if (f.risk) counts[f.risk.tier] += 1;
  const cells = TIER_ORDER.map(
    (t) => `<div class="tier-stat ${t}"><div class="n">${counts[t]}</div><div class="l">${TIER_LABEL[t]}</div></div>`,
  ).join('');
  return `<div class="dash">${cells}</div>`;
}

export function renderReportHtml(report: ReportRecord): string {
  const isFinal = report.status === 'final';
  const advisory = report.findings.filter((f) => f.advisory);
  const nonAdvisory = report.findings.filter((f) => !f.advisory);
  const regulatory = nonAdvisory.filter((f) => f.track === 'regulatory' || f.track === 'both').slice().sort(byRisk);
  const litigation = nonAdvisory.filter((f) => f.track === 'litigation' || f.track === 'both').slice().sort(byRisk);
  const topFindings = report.findings.slice().sort(byRisk).slice(0, 5);

  const group = (title: string, id: string, fs: Finding[], blurb: string, emptyText: string) =>
    `<h2 id="${id}">${escapeHtml(title)}</h2><p class="sub">${escapeHtml(blurb)}</p>${
      fs.length ? fs.map((f) => findingCard(f, isFinal)).join('') : `<p class="empty">${escapeHtml(emptyText)}</p>`
    }`;

  const sixStep = report.sections
    .filter((s) => s.id.startsWith('sixstep-') || (!['track1', 'track2', 'advisory'].includes(s.id)))
    .map((s) => `<h3>${escapeHtml(s.title)}</h3>${s.blocks.map((b) => `<h4>${escapeHtml(b.heading)}</h4>${mdToHtml(b.body)}`).join('')}`)
    .join('');

  const appendices = report.appendices.map((a) => `<h2 id="${a.id}">${escapeHtml(a.title)}</h2>${mdToHtml(a.body)}`).join('');

  const body = `
    ${coverHtml(report.cover, isFinal)}

    <h2 id="summary">At a glance</h2>
    <p class="sub">${report.findings.length} finding(s), ranked by risk. A risk score reflects how much a human's attention is warranted — it is not a determination of noncompliance.</p>
    ${riskDashboard(report.findings)}
    <h4>Highest-risk findings</h4>
    <ul>${topFindings.map((f) => `<li><b>${f.risk ? `${TIER_LABEL[f.risk.tier]} ${f.risk.score}` : ''}</b> — ${escapeHtml(f.title)}</li>`).join('') || '<li class="empty">none</li>'}</ul>

    <nav class="toc">
      <a href="#summary">At a glance</a>
      <a href="#track1">Track 1 — Regulatory</a>
      <a href="#track2">Track 2 — Litigation</a>
      ${advisory.length ? '<a href="#advisory">Advisory findings</a>' : ''}
      <a href="#sixstep">Six-step analyses</a>
      ${report.appendices.map((a) => `<a href="#${a.id}">${escapeHtml(a.title)}</a>`).join('')}
    </nav>

    ${group('Track 1 — Regulatory: comparative-analysis sufficiency & substantive parity', 'track1', regulatory,
      'Keyed to statute, the 2013 rule, CAA 2021, and DOL guidance that remain in force and enforced.',
      'No required-now regulatory findings.')}

    ${group('Track 2 — Litigation exposure', 'track2', litigation,
      'Keyed to the attorney-verified case-law pack — fact patterns that have survived motions to dismiss or produced adverse judgments/settlements. Often the commercially relevant track for a self-funded plan.',
      'No litigation-track findings (case-law rules ship inactive until attorney-verified).')}

    ${advisory.length ? group('Advisory findings — NOT CURRENTLY FEDERALLY ENFORCED', 'advisory', advisory.slice().sort(byRisk),
      'Depend only on the 2024 final rule, under a federal non-enforcement policy (ERIC v. HHS). Prudent to prepare for; state obligations are unaffected.',
      '') : ''}

    <h2 id="sixstep">Six-step analyses (per NQTL × classification)</h2>
    <p class="sub">One analysis per nonquantitative treatment limitation and classification; analyses may not be combined across classifications.</p>
    ${sixStep || '<p class="empty">No six-step sections.</p>'}

    ${appendices}

    <footer>
      Generated by the Fidvciary parity engine. Every finding is an indicator requiring review, not a legal conclusion.
      AI-drafted conclusions are excluded from any FINAL artifact until a licensed attorney reviews and approves them.
      This document is not legal advice and does not, by itself, satisfy the MHPAEA comparative-analysis requirement.
    </footer>
  `;

  return htmlShell(`${report.cover.title} — ${report.cover.planYear}`, body);
}

function htmlShell(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${CSS}</style></head><body><main class="doc">${body}</main></body></html>`;
}

function fmtLevel(frType: string, level: number): string {
  if (frType === 'coinsurance') return `${level}%`;
  if (frType === 'copay' || frType === 'deductible') return `$${level}`;
  if (frType === 'day_limit') return `${level} days`;
  if (frType === 'visit_limit') return `${level} visits`;
  return String(level);
}

/**
 * Findings-only HTML for the compliance CHECK (no report). Risk dashboard + the
 * flagged issues as colour-coded cards, what was checked, and limitations.
 */
export function renderIssuesHtml(r: CheckResult): string {
  const ranked = r.issues.slice().sort(byRisk);
  const phi = r.phiRejections.length
    ? `<div class="callout" style="background:var(--critical-bg);border-color:#f0b4ae;border-left-color:var(--critical);color:#7a1c15">
        <b>⚠ Upload rejected — protected health information detected.</b> The engine fails closed: these file(s) were NOT analyzed.
        ${r.phiRejections.map((p) => `<div style="margin-top:8px"><b>${escapeHtml(p.file)}</b><pre style="white-space:pre-wrap;font-size:12px;margin:4px 0">${escapeHtml(p.report)}</pre></div>`).join('')}
      </div>`
    : '';

  const body = `
    <h1>Parity compliance check</h1>
    <p class="sub">Mode: <b>${r.scope === 'everything' ? 'Everything (as-written + in-operation)' : 'As-written only'}</b> · thoroughness: ${escapeHtml(r.sensitivity)} · jurisdiction: ${escapeHtml(r.jurisdiction)}</p>
    ${phi}
    <div class="callout"><b>These are flagged issues to review — not determinations of noncompliance or legal advice.</b> Items are ranked by risk (how much a human's attention is warranted). Case-law theories are surfaced as language observations; the underlying rules stay inactive until an attorney verifies them.</div>

    <h2 id="summary">${ranked.length} issue(s) flagged</h2>
    ${riskDashboard(ranked)}

    <h4>What was checked</h4>
    <ul>${r.checked.map((c) => `<li>${escapeHtml(c)}</li>`).join('') || '<li class="empty">Nothing was analyzed — check the uploaded files.</li>'}</ul>
    <details><summary style="cursor:pointer;color:var(--muted);font-size:13px">Limitations &amp; what was not checked</summary>
      <ul>${r.limitations.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>
      ${r.dataAvailability.blocked.length ? `<p class="sub">In-operation tests not runnable (missing data): ${r.dataAvailability.blocked.map((b) => escapeHtml(b.feature.label)).join('; ')}.</p>` : ''}
    </details>

    <h2>Flagged issues (ranked by risk)</h2>
    ${ranked.length ? ranked.map((f) => findingCard(f, false)).join('') : '<p class="empty">No issues were flagged in what was analyzed. (Absence of flags is not a determination of compliance — the dollar-weighted FR/QTL math and in-operation analysis may still be required.)</p>'}

    ${r.errors.length ? `<h4>Files that could not be read</h4><ul>${r.errors.map((e) => `<li>${escapeHtml(e.file)}: ${escapeHtml(e.message)}</li>`).join('')}</ul>` : ''}

    <footer>Fidvciary parity checker. Flags potential parity issues for review; not legal advice, not a completed comparative analysis.</footer>
  `;
  return htmlShell('Parity compliance check', body);
}

/** Styled HTML for the "upload a plan document → what may not be compliant" screen. */
export function renderDocumentScanHtml(r: DocumentScanResult): string {
  const wsByCat = new Map<string, typeof r.warningSigns>();
  for (const h of r.warningSigns) {
    const arr = wsByCat.get(h.category) ?? [];
    arr.push(h);
    wsByCat.set(h.category, arr);
  }

  const wsCards = [...wsByCat.keys()].sort().map((cat) => {
    const items = wsByCat.get(cat)!.map((h) => `
      <article class="finding ${h.weak ? 'informational' : 'medium'}">
        <div class="f-head">
          <span class="badge ${h.weak ? 'informational' : 'medium'}">${h.weak ? 'VERIFY (LOW)' : 'WARNING SIGN'}</span>
          <span class="badge sev">CATEGORY ${escapeHtml(h.category)}</span>
          <span class="f-title">${escapeHtml(h.ruleName)}</span>
        </div>
        <div class="f-meta"><span>${escapeHtml(h.passage.section ?? 'unknown section')}${h.passage.page ? `, p.${h.passage.page}` : ''}</span>${h.occurrences > 1 ? `<span>×${h.occurrences} occurrences</span>` : ''}</div>
        <blockquote>${escapeHtml(h.passage.text)}<div class="cite">— ${escapeHtml(h.citation)}</div></blockquote>
        <div class="iq"><b>Why it may matter.</b> ${escapeHtml(h.note ?? h.rationale)}</div>
      </article>`).join('');
    return `<h3>Category ${escapeHtml(cat)}</h3>${items}`;
  }).join('');

  const litCards = r.litigation.map((o) => `
    <article class="finding low">
      <div class="f-head"><span class="badge low">LITIGATION THEORY</span><span class="f-title">${escapeHtml(o.label)}</span></div>
      <div class="f-meta"><span>Theory: ${escapeHtml(o.caseName)}</span><span>Rule <code>${escapeHtml(o.theoryRuleId)}</code> — inactive pending attorney verification</span><span>${escapeHtml(o.passage.section ?? '')}${o.passage.page ? `, p.${o.passage.page}` : ''}</span></div>
      <blockquote>${escapeHtml(o.passage.text)}</blockquote>
      <div class="iq"><b>Why it may matter.</b> ${escapeHtml(o.why)}</div>
    </article>`).join('');

  const costRows = r.costShareLevels.map((c) => `<tr>
      <td>${escapeHtml(c.classification)}</td><td>${escapeHtml(c.frType.replace('_', ' '))}</td>
      <td><b>${escapeHtml(fmtLevel(c.frType, c.mhsudLevel))}</b></td><td>${escapeHtml(fmtLevel(c.frType, c.msLevel))}</td>
      <td>${escapeHtml(c.mhsudServiceText)}</td>
    </tr>`).join('');

  const dash = `<div class="dash">
    <div class="tier-stat high"><div class="n">${r.warningSigns.length}</div><div class="l">Warning signs</div></div>
    <div class="tier-stat low"><div class="n">${r.litigation.length}</div><div class="l">Litigation-theory</div></div>
    <div class="tier-stat critical"><div class="n">${r.costShareLevels.length}</div><div class="l">Cost-share gaps</div></div>
    <div class="tier-stat informational"><div class="n">${r.passageCount}</div><div class="l">Passages read</div></div>
  </div>`;

  const body = `
    <h1>Plan-document compliance screen</h1>
    <p class="sub">${escapeHtml(r.source)} · ${escapeHtml(r.format)}${r.pageCount ? ` · ${r.pageCount} pages` : ''}</p>
    <div class="callout"><b>What this is.</b> A deterministic, as-written LANGUAGE screen. Each item is an indicator that a provision <i>may</i> not be compliant and warrants review — none is a determination of noncompliance. The dollar-weighted FR/QTL math needs a schedule of benefits with numbers; the "in operation" analysis needs claims data; legal conclusions require attorney review.</div>
    ${dash}
    ${r.phiWarnings.length ? `<div class="callout"><b>⚠ PHI warning.</b> ${r.phiWarnings.map(escapeHtml).join(' ')}</div>` : ''}

    <h2>Cost-share level comparison (Schedule of Benefits)</h2>
    ${r.costShareLevels.length
      ? `<p class="sub">Facial comparison of stated cost shares — a more-restrictive MH/SUD level is flagged. (The full substantially-all/predominant test additionally needs claims dollars.)</p>
         <div class="table-wrap"><table><thead><tr><th>Classification</th><th>Type</th><th>MH/SUD</th><th>M/S</th><th>MH/SUD line</th></tr></thead><tbody>${costRows}</tbody></table></div>`
      : `<p class="empty">No MH/SUD-more-restrictive cost-share levels extracted. If the numeric copays live in a separate Summary of Benefits, provide it.</p>`}

    <h2>DOL Warning Signs (${r.warningSigns.length})</h2>
    ${r.warningSigns.length ? wsCards : '<p class="empty">No DOL Warning Signs matched the plan language. (Absence of language signals does not establish compliance.)</p>'}

    <h2>Litigation-theory language (${r.litigation.length})</h2>
    ${r.litigation.length ? `<p class="sub">Language matching a known case; the corresponding rule does not fire until an attorney verifies and activates it.</p>${litCards}` : '<p class="empty">No litigation-theory language patterns matched.</p>'}

    <h2>Recommended next steps</h2>
    <ol>
      <li>Provide the <b>schedule of benefits</b> (copays, coinsurance, deductibles, day/visit limits by classification) to run the substantially-all and predominant FR/QTL tests.</li>
      <li>Provide <b>de-identified claims data</b> to run the in-operation analysis (denial rates, prior auth, overturns).</li>
      <li>Have counsel review each item; activate the relevant case-law rules after verifying citations.</li>
    </ol>

    <footer>Generated by the Fidvciary parity engine. Not legal advice; not a completed comparative analysis.</footer>
  `;
  return htmlShell(`Plan-document screen — ${r.source}`, body);
}
