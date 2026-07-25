import {
  type ReportRecord,
  type ReportSection,
  type ReportAppendix,
  type CoverPage,
  type EvaluationScope,
} from './report-model.js';
import { buildMethodologyAppendix, type MethodologyConfig } from './methodology.js';
import { buildDataUnavailabilityAppendix } from './tpa-request-letter.js';
import { compareSeverity, type Finding } from '../findings/finding.js';
import type { SixStepRegistry } from '../nqtl/six-step.js';
import type { QtlDetermination } from '../qtl/types.js';
import type { AvailabilityMatrix } from '../ingestion/availability-matrix.js';
import { getNqtl } from '../nqtl/nqtl-library.js';

/**
 * Comparative-analysis report (six-step, WV/state-form layout), with two-track
 * exposure output (regulatory vs litigation) and advisory findings segregated.
 * Findings are ordered by RISK (desc) so the top of each list is where to focus.
 */

/** Order by risk score (desc), falling back to severity. */
function byRisk(a: Finding, b: Finding): number {
  return (b.risk?.score ?? 0) - (a.risk?.score ?? 0) || compareSeverity(a, b);
}

export interface ComparativeAnalysisInput {
  analysisId: string;
  scope: EvaluationScope;
  planYear: number;
  samplePeriod: string | null;
  jurisdiction: string;
  rulesetsActive: string[];
  rulesetsAdvisory: string[];
  dataSources: Array<{ artifact: string; provenance: string }>;
  sixStep: SixStepRegistry;
  findings: Finding[];
  qtlDeterminations: QtlDetermination[];
  availability: AvailabilityMatrix;
  methodology: MethodologyConfig;
  createdAt: string;
}

const AS_WRITTEN_LIMITATION =
  'This is an AS-WRITTEN analysis. In-operation analysis (Step 5) was not performed. A comparative analysis that ' +
  'omits Step 5 does NOT satisfy 42 U.S.C. § 300gg-26(a)(8)(A)(iv), which requires demonstration as written AND in ' +
  'operation. This document is a diagnostic, not a compliant comparative analysis.';

const IN_OPERATION_LIMITATION =
  'This is an IN-OPERATION-only analysis. Outcome data alone cannot establish comparability; Steps 1–4 (as-written) ' +
  'are required for a compliant comparative analysis.';

function findingsBlock(findings: Finding[], emptyText: string): string {
  if (findings.length === 0) return emptyText;
  return findings
    .slice()
    .sort(byRisk)
    .map((f) => `- **[${f.severity}]** ${f.title} — refs: ${f.authorityRefs.join(', ')}`)
    .join('\n');
}

export function buildComparativeAnalysisReport(input: ComparativeAnalysisInput): ReportRecord {
  const scopeLimitation =
    input.scope === 'as-written' ? AS_WRITTEN_LIMITATION : input.scope === 'in-operation' ? IN_OPERATION_LIMITATION : null;

  const cover: CoverPage = {
    title: 'MHPAEA NQTL Comparative Analysis Report',
    scope: input.scope,
    planYear: input.planYear,
    samplePeriod: input.samplePeriod,
    rulesetsActive: input.rulesetsActive,
    rulesetsAdvisory: input.rulesetsAdvisory,
    jurisdiction: input.jurisdiction,
    dataSources: input.dataSources,
    status: 'generated',
    attorneyOfRecord: null,
    scopeLimitation,
  };

  // Partition findings: regulatory (required now), litigation, advisory-only.
  const advisory = input.findings.filter((f) => f.advisory);
  const nonAdvisory = input.findings.filter((f) => !f.advisory);
  const regulatory = nonAdvisory.filter((f) => f.track === 'regulatory' || f.track === 'both');
  const litigation = nonAdvisory.filter((f) => f.track === 'litigation' || f.track === 'both');

  const sections: ReportSection[] = [];

  // Track 1 — Regulatory
  sections.push({
    id: 'track1',
    title: 'Findings — Track 1 (Regulatory): Comparative-Analysis Sufficiency & Substantive Parity',
    blocks: [
      {
        heading: 'Required-now regulatory findings',
        level: 3,
        body:
          'These findings are keyed to statute, the 2013 final rule, the CAA 2021 comparative-analysis requirement, ' +
          'and DOL sub-regulatory guidance that remain in force and enforced.',
        findingRefs: regulatory.slice().sort(byRisk).map((f) => f.id),
      },
    ],
  });

  // Track 2 — Litigation
  sections.push({
    id: 'track2',
    title: 'Findings — Track 2 (Litigation Exposure)',
    blocks: [
      {
        heading: 'Litigation-exposure findings (attorney-verified case-law pack)',
        level: 3,
        body:
          'These findings are keyed to the case-law / enforcement rule pack — fact patterns that have survived ' +
          'motions to dismiss or produced adverse judgments/settlements. For a mid-market self-funded plan the ' +
          'realistic enforcement trigger is participant litigation or an EBSA complaint, so this track is often the ' +
          'commercially relevant one. Only attorney-verified (active) rules appear here.',
        findingRefs: litigation.slice().sort(byRisk).map((f) => f.id),
      },
    ],
  });

  // Advisory (segregated)
  if (advisory.length > 0) {
    sections.push({
      id: 'advisory',
      title: 'Advisory Findings — NOT CURRENTLY FEDERALLY ENFORCED',
      blocks: [
        {
          heading: 'Advisory (prudent-to-prepare, not required now)',
          level: 3,
          body:
            'These findings depend only on the 2024 final rule, which is under a federal non-enforcement policy ' +
            '(ERIC v. HHS). They are not required now but are prudent to prepare for. State obligations, where ' +
            'applicable, are unaffected by the federal non-enforcement posture.',
          findingRefs: advisory.slice().sort(byRisk).map((f) => f.id),
        },
      ],
    });
  }

  // Six-step sections, one per NQTL × classification (state-form layout).
  const stepSections: ReportSection[] = input.sixStep.all().map((rec) => {
    const nqtl = getNqtl(rec.nqtlId);
    const relevant = input.findings.filter(
      (f) => f.nqtlId === rec.nqtlId && f.classificationId === rec.classification,
    );
    const step5Body = rec.step5.performed
      ? 'In-operation demonstration of comparability and stringency. See in-operation findings and the methodology appendix for data provenance.'
      : `**Step 5 NOT PERFORMED.** ${rec.step5.notPerformedReason ?? ''}`;
    return {
      id: `sixstep-${rec.id}`,
      title: `${nqtl?.name ?? rec.nqtlId} — ${rec.classification}${rec.subclassKey ? ` / ${rec.subclassKey}` : ''}`,
      blocks: [
        { heading: 'Step 1 — NQTL description & plan terms', level: 3, body: rec.step1.nqtlDescription },
        { heading: 'Step 2 — Factors & evidentiary standards', level: 3, body: 'Standardized DOL factor and evidentiary-source lists apply; the M/S vs MH/SUD symmetry cross-check drives any factor/source asymmetry findings below.' },
        { heading: 'Step 3 — How factors are used in design & application', level: 3, body: 'Narrative to be drafted and attorney-reviewed; the sufficiency linter gates the draft.' },
        { heading: 'Step 4 — Comparability & stringency (as written)', level: 3, body: findingsBlock(relevant.filter((f) => f.scope === 'as_written' || f.scope === 'structural'), 'No as-written asymmetry findings for this NQTL × classification.'), findingRefs: relevant.filter((f) => f.scope === 'as_written' || f.scope === 'structural').map((f) => f.id) },
        { heading: 'Step 5 — Comparability & stringency (in operation)', level: 3, body: step5Body, findingRefs: relevant.filter((f) => f.scope === 'in_operation').map((f) => f.id) },
        { heading: 'Step 6 — Findings & conclusions', level: 3, body: 'Conclusions are AI-drafted, linter-gated, and excluded from any FINAL artifact until attorney-approved.' },
      ],
    };
  });
  sections.push(...stepSections);

  // Appendices.
  const appendices: ReportAppendix[] = [
    buildQtlWorksheetAppendix(input.qtlDeterminations),
    buildMethodologyAppendix(input.methodology),
    buildDataUnavailabilityAppendix(input.availability),
  ];

  return {
    id: input.analysisId,
    type: 'comparative_analysis',
    status: 'generated',
    cover,
    sections,
    appendices,
    findings: input.findings,
    createdAt: input.createdAt,
    supersedes: null,
  };
}

function buildQtlWorksheetAppendix(dets: QtlDetermination[]): ReportAppendix {
  const lines: string[] = [];
  lines.push('Full QTL/FR arithmetic, exposed so an examiner can re-derive each result by hand.');
  lines.push('');
  lines.push('| Classification | FR/QTL | S-A ratio | Applies | Predominant | MH/SUD | Verdict |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const d of dets) {
    lines.push(
      `| ${d.classification} | ${d.frQtlTypeId} | ${(d.substantiallyAll.ratio * 100).toFixed(1)}% | ${d.substantiallyAll.applies ? 'yes' : 'no'} | ${d.predominant?.predominantLabel ?? 'n/a'} | ${d.compliance.mhsudLevel ?? 'n/a'} | ${d.compliance.verdict} |`,
    );
  }
  lines.push('');
  lines.push('Each row is backed by the full benefit inventory, dollar denominator, projection method, and per-level tallies in the analysis record.');
  return { id: 'appendix-qtl-worksheet', title: 'Appendix — FR/QTL Worksheet', body: lines.join('\n') };
}
