import {
  type ReportRecord,
  type ReportSection,
  type ReportAppendix,
  type CoverPage,
  type EvaluationScope,
} from './report-model.js';
import { buildMethodologyAppendix, type MethodologyConfig } from './methodology.js';
import { compareSeverity, type Finding } from '../findings/finding.js';

/**
 * DOL Self-Compliance Tool report — mirrors Sections A–H plus Appendix I
 * (documentation checklist) and Appendix II (reimbursement rate comparison), so
 * an investigator sees their own framework.
 */

export interface ReimbursementRow {
  code: string; // CPT/HCPCS
  description: string;
  specialtyGroup: 'M/S comparison' | 'MH/SUD';
  percentOfMedicare: number | null;
  locality?: string;
}

export interface SelfComplianceToolInput {
  analysisId: string;
  scope: EvaluationScope;
  planYear: number;
  samplePeriod: string | null;
  jurisdiction: string;
  rulesetsActive: string[];
  rulesetsAdvisory: string[];
  dataSources: Array<{ artifact: string; provenance: string }>;
  findings: Finding[];
  reimbursementTable: ReimbursementRow[];
  methodology: MethodologyConfig;
  createdAt: string;
}

const SECTIONS: Array<{ id: string; letter: string; title: string; body: string }> = [
  { id: 'A', letter: 'A', title: 'Annual & Lifetime Dollar Limits', body: 'Confirms no aggregate lifetime or annual dollar limits are applied to MH/SUD benefits more restrictively than to M/S benefits.' },
  { id: 'B', letter: 'B', title: 'Financial Requirements & QTLs', body: 'Applies the substantially-all and predominant tests per classification. See the FR/QTL worksheet.' },
  { id: 'C', letter: 'C', title: 'Cumulative Financial Requirements', body: 'Confirms no separate MH/SUD deductible or out-of-pocket maximum (bright-line prohibition).' },
  { id: 'D', letter: 'D', title: 'NQTLs — Design & Application', body: 'Six-step comparative analysis per NQTL × classification; factor/evidentiary-source symmetry cross-check.' },
  { id: 'E', letter: 'E', title: 'NQTLs — Warning Signs', body: 'Deterministic scan against DOL Warning Signs Categories I–V, with verbatim plan-language quotes.' },
  { id: 'F', letter: 'F', title: 'Disclosure Requirements', body: 'Availability of medical-necessity criteria and denial reasons on request (29 CFR § 2590.712(d)).' },
  { id: 'G', letter: 'G', title: 'In-Operation Data Analysis', body: 'Outcome metrics per classification, framed as warning signs warranting further review — never determinations of noncompliance.' },
  { id: 'H', letter: 'H', title: 'Compliance Program & Recordkeeping', body: 'Append-only audit log; prompt-version pinning; attorney review gate; report reproducibility.' },
];

export function buildSelfComplianceToolReport(input: SelfComplianceToolInput): ReportRecord {
  const cover: CoverPage = {
    title: 'DOL Self-Compliance Tool Report (MHPAEA)',
    scope: input.scope,
    planYear: input.planYear,
    samplePeriod: input.samplePeriod,
    rulesetsActive: input.rulesetsActive,
    rulesetsAdvisory: input.rulesetsAdvisory,
    jurisdiction: input.jurisdiction,
    dataSources: input.dataSources,
    status: 'generated',
    attorneyOfRecord: null,
    scopeLimitation:
      input.scope === 'as-written'
        ? 'As-written only: Section G (in-operation) was not performed; see 42 U.S.C. § 300gg-26(a)(8)(A)(iv).'
        : null,
  };

  // Map findings into the relevant Self-Compliance Tool section by scope/type.
  const sectionForFinding = (f: Finding): string => {
    if (f.title.startsWith('Cumulative FR')) return 'C';
    if (f.title.startsWith('Aggregate dollar limit')) return 'A';
    if (f.title.startsWith('QTL/FR parity')) return 'B';
    if (f.title.startsWith('Warning sign')) return 'E';
    if (f.scope === 'in_operation') return 'G';
    return 'D';
  };

  const sections: ReportSection[] = SECTIONS.map((s) => {
    const relevant = input.findings.filter((f) => sectionForFinding(f) === s.letter).slice().sort(compareSeverity);
    return {
      id: `section-${s.letter}`,
      title: `Section ${s.letter} — ${s.title}`,
      blocks: [
        { heading: `Section ${s.letter}`, level: 3, body: s.body, findingRefs: relevant.map((f) => f.id) },
      ],
    };
  });

  const appendices: ReportAppendix[] = [
    buildAppendixIChecklist(input.findings),
    buildAppendixIIReimbursement(input.reimbursementTable),
    buildMethodologyAppendix(input.methodology),
  ];

  return {
    id: `${input.analysisId}-sct`,
    type: 'self_compliance_tool',
    status: 'generated',
    cover,
    sections,
    appendices,
    findings: input.findings,
    createdAt: input.createdAt,
    supersedes: null,
  };
}

function buildAppendixIChecklist(findings: Finding[]): ReportAppendix {
  const facial = findings.filter((f) => f.severity === 'facial_violation').length;
  const sig = findings.filter((f) => f.severity === 'significant_indicator').length;
  const gaps = findings.filter((f) => f.severity === 'documentation_gap').length;
  const lines: string[] = [];
  lines.push('Documentation checklist (Self-Compliance Tool Appendix I).');
  lines.push('');
  lines.push('| Item | Status |');
  lines.push('|---|---|');
  lines.push(`| Plan documents / SPD / wrap ingested | see cover data sources |`);
  lines.push(`| FR/QTL worksheet completed | yes |`);
  lines.push(`| Six-step NQTL analyses (per classification) | yes |`);
  lines.push(`| Warning-sign scan | yes |`);
  lines.push(`| In-operation data analysis | scope-dependent |`);
  lines.push(`| Facial violations identified | ${facial} |`);
  lines.push(`| Significant indicators identified | ${sig} |`);
  lines.push(`| Documentation gaps identified | ${gaps} |`);
  lines.push(`| Attorney review completed | no (draft) |`);
  return { id: 'appendix-I', title: 'Appendix I — Documentation Checklist', body: lines.join('\n') };
}

function buildAppendixIIReimbursement(rows: ReimbursementRow[]): ReportAppendix {
  const lines: string[] = [];
  lines.push('Reimbursement rate comparison as a percentage of Medicare (Self-Compliance Tool Appendix II).');
  lines.push('Standard M/S comparison specialties vs MH/SUD E&M and psychotherapy codes.');
  lines.push('');
  lines.push('| Code | Description | Group | % of Medicare | Locality |');
  lines.push('|---|---|---|---|---|');
  for (const r of rows) {
    lines.push(`| ${r.code} | ${r.description} | ${r.specialtyGroup} | ${r.percentOfMedicare != null ? `${r.percentOfMedicare}%` : 'n/a'} | ${r.locality ?? 'n/a'} |`);
  }
  if (rows.length === 0) lines.push('| _no reimbursement data provided_ | | | | |');
  lines.push('');
  lines.push('A materially lower percent-of-Medicare for MH/SUD codes than for the M/S comparison specialties is a ');
  lines.push('network-composition / reimbursement warning sign warranting further review.');
  return { id: 'appendix-II', title: 'Appendix II — Reimbursement Rate Comparison', body: lines.join('\n') };
}
