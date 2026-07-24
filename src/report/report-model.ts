import { contentHash } from '../util/hash.js';
import type { Finding } from '../findings/finding.js';

/**
 * Module 11 — report model + deterministic Markdown renderer.
 *
 * A report is a structured object rendered to Markdown (the canonical, stable
 * artifact; a PDF/DOCX adapter renders from the same object). The DETERMINISTIC
 * body — cover, sections, appendices, findings — is what the content hash
 * covers, so an issued report is byte-reproducible from the audit log
 * (Non-negotiable #5). Volatile metadata (createdAt) is excluded from the hash.
 */

export type ReportType = 'comparative_analysis' | 'self_compliance_tool';

export type ReportStatus =
  | 'generated'
  | 'pending_attorney_review'
  | 'attorney_approved'
  | 'final'
  | 'attorney_returned';

export type EvaluationScope = 'as-written' | 'in-operation' | 'both';

export interface AttorneyRecord {
  userId: string;
  name: string;
  barJurisdiction: string;
  timestamp: string;
  approvedContentHash: string;
}

export interface CoverPage {
  title: string;
  scope: EvaluationScope;
  planYear: number;
  samplePeriod: string | null;
  rulesetsActive: string[];
  rulesetsAdvisory: string[];
  jurisdiction: string;
  dataSources: Array<{ artifact: string; provenance: string }>;
  status: ReportStatus;
  attorneyOfRecord: AttorneyRecord | null;
  /** On-its-face scope limitation (e.g., as-written-only is not a compliant comparative analysis). */
  scopeLimitation: string | null;
}

export interface ReportBlock {
  heading: string;
  level: 2 | 3 | 4;
  body: string;
  /** Findings referenced in this block, rendered with their review-status banner. */
  findingRefs?: string[];
}

export interface ReportSection {
  id: string;
  title: string;
  blocks: ReportBlock[];
}

export interface ReportAppendix {
  id: string;
  title: string;
  body: string;
}

export interface ReportRecord {
  id: string;
  type: ReportType;
  status: ReportStatus;
  cover: CoverPage;
  sections: ReportSection[];
  appendices: ReportAppendix[];
  findings: Finding[];
  createdAt: string; // volatile — excluded from contentHash
  supersedes: string | null;
}

const DRAFT_BANNER =
  '> **DRAFT — PENDING ATTORNEY REVIEW. NOT LEGAL ADVICE.** This proposed conclusion was AI-drafted and is ' +
  'structurally excluded from any FINAL artifact until a licensed attorney reviews and approves it.';

/**
 * The deterministic body used for hashing + reproducibility. Excludes volatile
 * metadata (createdAt) AND approval metadata that the attorney gate mutates
 * (report/cover status and attorneyOfRecord) — otherwise the approval hash would
 * change as a side effect of approval and could never be finalized.
 */
export function deterministicBody(report: ReportRecord): unknown {
  const { attorneyOfRecord: _a, status: _s, ...coverContent } = report.cover;
  return {
    id: report.id,
    type: report.type,
    cover: coverContent,
    sections: report.sections,
    appendices: report.appendices,
    findings: report.findings.map((f) => ({
      id: f.id,
      scope: f.scope,
      track: f.track,
      severity: f.severity,
      authorityRefs: f.authorityRefs,
      title: f.title,
      investigationQuestion: f.investigationQuestion,
      advisory: f.advisory ?? false,
    })),
    supersedes: report.supersedes,
  };
}

export function reportContentHash(report: ReportRecord): string {
  return contentHash(deterministicBody(report));
}

function renderFinding(f: Finding, isFinal: boolean): string {
  const lines: string[] = [];
  const advisoryTag = f.advisory ? ' `ADVISORY — NOT CURRENTLY FEDERALLY ENFORCED`' : '';
  lines.push(`**[${f.severity.toUpperCase()}]${advisoryTag} ${f.title}** _(${f.scope} / ${f.track})_`);
  lines.push('');
  lines.push(`- Authority: ${f.authorityRefs.join(', ')}`);
  lines.push(`- Confidence: ${f.confidence}`);
  lines.push(`- Investigation question: ${f.investigationQuestion}`);
  if (f.evidence.length) {
    for (const e of f.evidence) {
      if (e.kind === 'document') lines.push(`- Evidence (quoted): "${e.quotedText}" — ${e.sourceDocumentId}${e.page ? ` p.${e.page}` : ''}${e.section ? ` §${e.section}` : ''}`);
      else if (e.kind === 'statistical') lines.push(`- Evidence (data): ${e.metric} MH/SUD ${(e.mhsudValue * 100).toFixed(1)}% vs M/S ${(e.msValue * 100).toFixed(1)}%, ratio ${Number.isFinite(e.ratio) ? e.ratio.toFixed(2) : '∞'}, p=${e.pValue?.toExponential(2) ?? 'n/a'}, adj p=${e.pAdjusted?.toExponential(2) ?? 'n/a'}, n=${e.nMhsud}/${e.nMs}, test=${e.testUsed ?? 'n/a'}`);
      else lines.push(`- Evidence (computation): ${e.description} — ${JSON.stringify(e.values)}`);
    }
  }
  // Proposed conclusion + banner (only AI drafts carry the banner; FINAL shows only approved text).
  if (f.proposedConclusion) {
    if (isFinal) {
      if (f.attorneyDisposition && (f.attorneyDisposition.action === 'approved' || f.attorneyDisposition.action === 'edited')) {
        lines.push('');
        lines.push(`Conclusion (attorney-approved): ${f.attorneyDisposition.editedText ?? f.proposedConclusion.text}`);
      }
      // In FINAL, unapproved DRAFT conclusions are structurally excluded (omitted entirely).
    } else {
      lines.push('');
      lines.push(DRAFT_BANNER);
      lines.push('');
      lines.push(`Proposed conclusion (draft): ${f.proposedConclusion.text}`);
    }
  }
  return lines.join('\n');
}

/** Render the report to Markdown. `isFinal` controls DRAFT-banner / exclusion behavior. */
export function renderMarkdown(report: ReportRecord): string {
  const isFinal = report.status === 'final';
  const out: string[] = [];
  const c = report.cover;

  out.push(`# ${c.title}`);
  out.push('');
  out.push(`**Report status:** ${report.status.toUpperCase()}${isFinal ? '' : ' — NOT A COMPLETED COMPARATIVE ANALYSIS UNTIL ATTORNEY-APPROVED'}`);
  out.push('');
  out.push('## Cover');
  out.push('');
  out.push(`- **Evaluation scope:** ${c.scope}`);
  out.push(`- **Plan year:** ${c.planYear}`);
  out.push(`- **Sample period:** ${c.samplePeriod ?? 'n/a (no in-operation data)'}`);
  out.push(`- **Jurisdiction:** ${c.jurisdiction}`);
  out.push(`- **Rulesets (active / required now):** ${c.rulesetsActive.join(', ') || 'none'}`);
  out.push(`- **Rulesets (advisory / not currently federally enforced):** ${c.rulesetsAdvisory.join(', ') || 'none'}`);
  out.push(`- **Data sources & provenance:**`);
  for (const d of c.dataSources) out.push(`  - ${d.artifact} — ${d.provenance}`);
  out.push(`- **Attorney of record:** ${c.attorneyOfRecord ? `${c.attorneyOfRecord.name} (${c.attorneyOfRecord.barJurisdiction}), approved ${c.attorneyOfRecord.timestamp}` : 'none (not finalized)'}`);
  if (c.scopeLimitation) {
    out.push('');
    out.push(`> **Scope limitation (stated on the report's face):** ${c.scopeLimitation}`);
  }
  out.push('');

  for (const section of report.sections) {
    out.push(`## ${section.title}`);
    out.push('');
    for (const block of section.blocks) {
      out.push(`${'#'.repeat(block.level)} ${block.heading}`);
      out.push('');
      if (block.body) {
        out.push(block.body);
        out.push('');
      }
      for (const fid of block.findingRefs ?? []) {
        const f = report.findings.find((x) => x.id === fid);
        if (f) {
          out.push(renderFinding(f, isFinal));
          out.push('');
        }
      }
    }
  }

  for (const appx of report.appendices) {
    out.push(`## ${appx.title}`);
    out.push('');
    out.push(appx.body);
    out.push('');
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}
