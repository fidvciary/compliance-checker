import type { AvailabilityMatrix } from '../ingestion/availability-matrix.js';
import { requiredFieldsForDataset, fieldsForDataset } from '../ingestion/canonical-schema.js';
import type { ReportAppendix } from './report-model.js';

/**
 * TPA data-request letter generator + data-unavailability documentation.
 *
 * Given the availability matrix, produce (a) a letter naming the exact fields,
 * file types, and sample period needed, addressed to the TPA/UM vendor, and
 * (b) the "relevant data temporarily unavailable / no data exist" documentation
 * that § 146.136(c)(4)(iii)(A)(3) contemplates. A "cannot test, here's why,
 * here's the letter to send your TPA" output is a first-class deliverable.
 */

export interface TpaLetterConfig {
  employerName: string;
  planName: string;
  tpaName: string;
  planYear: number;
  samplePeriod: string;
  requesterName: string;
  requesterTitle: string;
}

export function generateTpaRequestLetter(matrix: AvailabilityMatrix, cfg: TpaLetterConfig): string {
  // Which datasets are implicated by the blocked features, and which fields.
  const missingByDataset = new Map<string, Set<string>>();
  for (const b of matrix.blocked) {
    for (const ds of b.feature.requiredDatasets) {
      const set = missingByDataset.get(ds) ?? new Set<string>();
      // If the whole dataset is missing, request its required fields; otherwise the specific missing fields.
      const fields = b.missingDatasets.includes(ds) ? requiredFieldsForDataset(ds).map((f) => f.name) : b.missingFields;
      fields.forEach((f) => set.add(f));
      missingByDataset.set(ds, set);
    }
  }

  const lines: string[] = [];
  lines.push(`[Date]`);
  lines.push('');
  lines.push(`${cfg.tpaName}`);
  lines.push(`Re: MHPAEA comparative-analysis data request — ${cfg.planName} (plan year ${cfg.planYear})`);
  lines.push('');
  lines.push(`To whom it may concern,`);
  lines.push('');
  lines.push(
    `${cfg.employerName}, as plan sponsor and a fiduciary of the ${cfg.planName}, is completing the mental health ` +
      `parity (MHPAEA) comparative analysis required by 42 U.S.C. § 300gg-26(a)(8). To evaluate the plan "in operation" ` +
      `we require the following data, which resides in your systems. Please provide de-identified extracts for the ` +
      `sample period ${cfg.samplePeriod}. Do NOT include member names, SSNs, MRNs, full dates of birth, addresses, or ` +
      `un-hashed member identifiers — our ingestion process rejects any file containing protected health information.`,
  );
  lines.push('');

  if (missingByDataset.size === 0) {
    lines.push('All data required for the requested analysis appears to be available; no additional extracts are needed at this time.');
  } else {
    for (const [dataset, fields] of [...missingByDataset.entries()].sort()) {
      lines.push(`**${datasetLabel(dataset)}** (preferred format: ${preferredFormat(dataset)})`);
      const allFields = fieldsForDataset(dataset as never);
      for (const fieldName of [...fields].sort()) {
        const def = allFields.find((f) => f.name === fieldName);
        lines.push(`  - \`${fieldName}\`${def ? ` — ${def.description}` : ''}`);
      }
      lines.push('');
    }
    lines.push('Please also provide a data dictionary for the extracts and identify any field that is unavailable, ');
    lines.push('together with the reason and the date by which it can be produced.');
  }

  lines.push('');
  lines.push(`Under 45 CFR § 146.136(c)(4)(iii)(A)(3), where relevant data are unavailable the plan must document why; `);
  lines.push(`your written explanation for any field you cannot produce will be incorporated into the plan's analysis.`);
  lines.push('');
  lines.push(`Please respond within 30 days.`);
  lines.push('');
  lines.push(`Sincerely,`);
  lines.push(`${cfg.requesterName}, ${cfg.requesterTitle}`);
  lines.push(`${cfg.employerName}`);

  return lines.join('\n');
}

/** Data-unavailability documentation appendix (the § 146.136(c)(4)(iii) record). */
export function buildDataUnavailabilityAppendix(matrix: AvailabilityMatrix): ReportAppendix {
  const lines: string[] = [];
  lines.push('This appendix documents which in-operation tests could and could not be run, and why, satisfying the');
  lines.push('"relevant data temporarily unavailable / no data exist" explanation contemplated by 45 CFR');
  lines.push('§ 146.136(c)(4)(iii)(A)(3). Missing tests are documented here rather than silently skipped.');
  lines.push('');
  lines.push('### Tests that could be run');
  lines.push('');
  if (matrix.runnable.length === 0) lines.push('_None._');
  for (const r of matrix.runnable) lines.push(`- ${r.feature.label}`);
  lines.push('');
  lines.push('### Tests that could NOT be run');
  lines.push('');
  if (matrix.blocked.length === 0) lines.push('_None — all contemplated tests were runnable._');
  for (const b of matrix.blocked) {
    lines.push(`- **${b.feature.label}** — ${b.reason} Required artifact: ${b.feature.sourceArtifact}.`);
  }
  lines.push('');
  if (matrix.missingArtifacts.length) {
    lines.push('### Artifacts to request (see the generated TPA data-request letter)');
    lines.push('');
    for (const a of matrix.missingArtifacts) lines.push(`- ${a}`);
  }
  return { id: 'appendix-data-availability', title: 'Appendix — Data Availability & Unavailability', body: lines.join('\n') };
}

function datasetLabel(ds: string): string {
  const map: Record<string, string> = {
    claims: 'Claims extract (professional + facility)',
    remittance: 'Remittance / adjudication data (835)',
    prior_auth: 'Prior authorization / precertification log',
    concurrent_review: 'Concurrent / continued-stay review log',
    appeals: 'Appeals and external review log',
    network: 'Network directory + credentialing roster',
    reimbursement: 'Provider reimbursement / fee schedule extract',
  };
  return map[ds] ?? ds;
}

function preferredFormat(ds: string): string {
  const map: Record<string, string> = {
    claims: 'CSV/XLSX or 837',
    remittance: '835 (preferred) or CSV',
    prior_auth: 'CSV/XLSX',
    concurrent_review: 'CSV/XLSX',
    appeals: 'CSV/XLSX',
    network: 'CSV/XLSX',
    reimbursement: 'CSV/XLSX + CMS Medicare PFS reference (CY, locality)',
  };
  return map[ds] ?? 'CSV/XLSX';
}
