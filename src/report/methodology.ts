import type { ReportAppendix } from './report-model.js';
import { MINIMUM_CELL_SIZE } from '../in-operation/metrics.js';

/**
 * Auto-generated methodology appendix (Module 11).
 *
 * The standalone methodology document: maps every computation to the specific
 * guidance requirement it satisfies, states every assumption, and states every
 * limitation. Generated per report — not maintained by hand — so it always
 * matches the engine version that produced the findings.
 */

export interface MethodologyConfig {
  scope: 'as-written' | 'in-operation' | 'both';
  qtlEpsilon: number;
  projectionMethod: string;
  samplePeriod: string | null;
  statisticalConfidence: number; // e.g., 0.95
  multipleComparisonsCorrection: string; // 'Benjamini-Hochberg'
  aggregationNote?: string; // e.g., 24-month aggregation used
}

export function buildMethodologyAppendix(cfg: MethodologyConfig): ReportAppendix {
  const lines: string[] = [];

  lines.push('This methodology appendix is generated automatically for this report and describes exactly how each');
  lines.push('computation was performed, the assumptions made, and the limitations that qualify the results. It is');
  lines.push('the record that distinguishes this analysis from boilerplate.');
  lines.push('');

  lines.push('### Computation-to-authority mapping');
  lines.push('');
  lines.push('| Computation | Method | Authority satisfied |');
  lines.push('|---|---|---|');
  lines.push('| Classification | Deterministic code maps (CMS POS, NUBC revenue, CPT/HCPCS); unmappable claims quarantined | 29 CFR § 2590.712(c)(2)(ii) |');
  lines.push('| Intermediate care housing | RTC → inpatient (SNF/rehab analog); PHP/IOP → outpatient (intensive-outpatient analog) | DOL intermediate-care position |');
  lines.push('| Substantially-all test | Plan-payment dollars; applies iff 3·numerator ≥ 2·denominator (exact) | 29 CFR § 2590.712(c)(3)(i)(A) |');
  lines.push('| Predominant test | Single-level majority, else most-restrictive-first combination to > ½; least restrictive level in the minimal combination | 29 CFR § 2590.712(c)(3)(i)(B) |');
  lines.push('| Cumulative FR / dollar limits | Bright-line structural checks | 29 CFR § 2590.712(c)(3)(v), (b) |');
  lines.push('| NQTL six-step | One record per NQTL × classification × subclass (no combining) | 45 CFR § 146.137(c) |');
  lines.push('| Factor/source symmetry | M/S vs MH/SUD cross-check | Self-Compliance Tool NQTL section |');
  lines.push('| Warning-sign scan | Deterministic rule table; verbatim plan-language quotes | DOL Warning Signs I–V |');
  lines.push('| As-written comparability | Structured side-by-side asymmetry tests | 29 CFR § 2590.712(c)(4)(i) |');
  lines.push('| In-operation metrics | Two-proportion z / Fisher exact; BH correction; effect size | Self-Compliance Tool Appendix II (warning signs) |');
  lines.push('| Litigation exposure | Attorney-verified case-law rule pack (active rules only) | Case law / enforcement actions |');
  lines.push('');

  lines.push('### Assumptions');
  lines.push('');
  lines.push(`- **Classification tie-break (comorbidity):** benefit type is decided by (1) MH/SUD-specific procedure code, then (2) behavioral-health provider taxonomy, then (3) primary diagnosis in F10–F99. A medical primary diagnosis with an MH/SUD *secondary* diagnosis is classified M/S (primary governs) and the comorbidity is flagged. F01–F09 neurocognitive codes are not auto-assigned to MH/SUD.`);
  lines.push(`- **Projection method (QTL denominator):** ${cfg.projectionMethod}.`);
  lines.push(`- **QTL threshold epsilon:** results within ${(cfg.qtlEpsilon * 100).toFixed(1)} percentage points of the ⅔ or ½ threshold are flagged THRESHOLD_PROXIMATE and routed to attorney review with the underlying computation exposed.`);
  if (cfg.scope !== 'as-written') {
    lines.push(`- **Statistical tests:** two-proportion z-test at ${(cfg.statisticalConfidence * 100).toFixed(0)}% confidence, with Fisher's exact test substituted when an expected cell count is below 5. Disparity ratio, absolute difference, p-value, and the confidence interval on the difference are all reported.`);
    lines.push(`- **Multiple-comparisons correction:** ${cfg.multipleComparisonsCorrection} applied across the finding family; both raw and adjusted p-values are reported.`);
    lines.push(`- **Minimum cell size:** n ≥ ${MINIMUM_CELL_SIZE} required on both the MH/SUD and M/S sides; below this the metric is reported as INSUFFICIENT_DATA with the actual n, not a computed result.`);
    lines.push(`- **Effect size:** Cohen's h is reported alongside significance; a statistically significant but practically negligible disparity is labeled as such.`);
    lines.push(`- **Sample period:** ${cfg.samplePeriod ?? 'n/a'}.${cfg.aggregationNote ? ` ${cfg.aggregationNote}` : ''}`);
  }
  lines.push('');

  lines.push('### Limitations');
  lines.push('');
  lines.push('- **Cash-pay and out-of-network MH/SUD care that never generates a claim is invisible to any claims-based analysis.** This systematically *understates* access problems for MH/SUD.');
  lines.push('- **Provider-directory accuracy is a known limitation;** network-adequacy figures derived from directories may overstate available capacity.');
  lines.push('- **Prior-authorization and precertification data commonly live with the TPA or a separate UM vendor** and may not be present in the claims file; missing metrics are documented, not silently skipped.');
  lines.push('- **Outcome data alone cannot establish comparability.** In-operation disparities are warning signs warranting process investigation, never determinations of noncompliance.');
  if (cfg.scope === 'as-written') {
    lines.push('- **This run is as-written only.** In-operation analysis (Step 5) was not performed; an as-written-only analysis is a diagnostic and does not satisfy 42 U.S.C. § 300gg-26(a)(8)(A)(iv), which requires demonstration as written **and** in operation.');
  }
  lines.push('- **AI-drafted conclusions are excluded from any FINAL artifact** until a licensed attorney reviews and approves them; the engine\'s deterministic findings are not legal conclusions.');

  return { id: 'appendix-methodology', title: 'Appendix — Methodology', body: lines.join('\n') };
}
