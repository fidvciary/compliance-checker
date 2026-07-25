import {
  type Finding,
  type Severity,
  type Confidence,
  assertSeverityInvariant,
} from './finding.js';
import type { RulesetRegistry } from '../rulesets/registry.js';
import type { QtlDetermination } from '../qtl/types.js';
import type { CumulativeFinding, DollarLimitFinding } from '../qtl/cumulative.js';
import type { WarningSignHit, DualAdministratorFinding } from '../analysis/warning-sign-scanner.js';
import type { AsWrittenFinding } from '../analysis/as-written-comparability.js';
import type { CaselawHit } from '../analysis/caselaw/registry.js';
import type { RateComparisonResult } from '../in-operation/metrics.js';
import type { FactorAsymmetry } from '../nqtl/factors.js';
import type { CostShareLevelFinding } from '../ingestion/schedule-of-benefits.js';
import type { Classification } from '../classification/classifications.js';
import type { AuditLog } from '../audit/audit-log.js';

/**
 * Finding synthesis: normalize each engine's output into Finding records with
 * severity, track, and confidence, enforcing the severity invariant and tagging
 * advisory findings (those depending only on non-enforced rulesets).
 */

export interface SynthesisContext {
  analysisId: string;
  registry: RulesetRegistry;
  audit?: AuditLog;
}

function advisoryOf(registry: RulesetRegistry, authorityRefs: string[]): boolean {
  // Only ruleset refs participate in advisory classification; caselaw refs are litigation-track.
  const rulesetRefs = authorityRefs.filter((r) => !r.startsWith('caselaw:'));
  if (rulesetRefs.length === 0) return false;
  return registry.classifyFinding(rulesetRefs) === 'advisory';
}

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${String(counter).padStart(4, '0')}`;
}

/** Reset the deterministic id counter (call at the start of a run for reproducibility). */
export function resetFindingIds(): void {
  counter = 0;
}

function make(ctx: SynthesisContext, partial: Omit<Finding, 'id' | 'analysisId' | 'proposedConclusion' | 'attorneyDisposition' | 'advisory'> & { idPrefix: string }): Finding {
  const { idPrefix, ...rest } = partial;
  const finding: Finding = {
    id: nextId(idPrefix),
    analysisId: ctx.analysisId,
    proposedConclusion: null, // LLM drafting is separate and attorney-gated
    attorneyDisposition: null,
    advisory: advisoryOf(ctx.registry, rest.authorityRefs),
    ...rest,
  };
  assertSeverityInvariant(finding);
  ctx.audit?.append('finding.synthesized', 'engine', {
    id: finding.id,
    scope: finding.scope,
    track: finding.track,
    severity: finding.severity,
    advisory: finding.advisory,
  });
  return finding;
}

// ---- QTL / FR ----
export function fromQtl(ctx: SynthesisContext, d: QtlDetermination): Finding | null {
  if (d.compliance.verdict === 'compliant' || d.compliance.verdict === 'not_evaluated') return null;
  const severity: Severity = d.compliance.verdict === 'facial_violation' ? 'facial_violation' : 'significant_indicator';
  const confidence: Confidence = d.compliance.verdict === 'threshold_proximate' ? 'medium' : 'high';
  return make(ctx, {
    idPrefix: 'QTL',
    nqtlId: undefined,
    classificationId: d.classification,
    scope: 'structural',
    track: 'regulatory',
    authorityRefs: d.authorityRefs,
    evidence: [
      {
        kind: 'computation',
        description: `Substantially-all + predominant test for ${d.frQtlTypeId}`,
        values: {
          denominator: d.substantiallyAll.denominatorDollars,
          numerator: d.substantiallyAll.numeratorDollars,
          ratio: round(d.substantiallyAll.ratio, 4),
          substantiallyAllApplies: d.substantiallyAll.applies,
          predominantLevel: d.predominant?.predominantLevel ?? null,
          allowedMaxLevel: d.compliance.allowedMaxLevel,
          mhsudLevel: d.compliance.mhsudLevel,
          projectionMethod: d.projectionMethod,
        },
      },
    ],
    severity,
    confidence,
    investigationQuestion:
      d.compliance.verdict === 'threshold_proximate'
        ? `${d.frQtlTypeId} result is within epsilon of a regulatory threshold in ${d.classification}; attorney review of the underlying computation is required.`
        : `Re-derive the ${d.frQtlTypeId} substantially-all/predominant computation for ${d.classification} and confirm the MH/SUD level applied.`,
    title: `QTL/FR parity — ${d.frQtlTypeId} (${d.classification})`,
    detail: d.compliance.rationale,
  });
}

export function fromCumulative(ctx: SynthesisContext, c: CumulativeFinding): Finding {
  return make(ctx, {
    idPrefix: 'CUM',
    classificationId: c.classification,
    scope: 'structural',
    track: 'regulatory',
    authorityRefs: ['federal:statute', 'federal:2013'],
    evidence: [{ kind: 'computation', description: c.type, values: { citation: c.citation } }],
    severity: 'facial_violation',
    confidence: 'high',
    investigationQuestion: `Confirm the separate MH/SUD ${c.type === 'separate_deductible' ? 'deductible' : 'out-of-pocket maximum'} in ${c.classification} and remove it.`,
    title: `Cumulative FR — ${c.type} (${c.classification})`,
    detail: c.detail,
  });
}

export function fromDollarLimit(ctx: SynthesisContext, d: DollarLimitFinding): Finding {
  return make(ctx, {
    idPrefix: 'DLL',
    scope: 'structural',
    track: 'regulatory',
    authorityRefs: ['federal:statute', 'federal:2013'],
    evidence: [{ kind: 'computation', description: d.scope, values: { citation: d.citation } }],
    severity: 'facial_violation',
    confidence: 'high',
    investigationQuestion: `Confirm and remove the ${d.scope.replace('_', ' ')} MH/SUD dollar limit.`,
    title: `Aggregate dollar limit — ${d.scope}`,
    detail: d.detail,
  });
}

// ---- Warning signs ----
export function fromWarningSign(ctx: SynthesisContext, h: WarningSignHit): Finding {
  return make(ctx, {
    idPrefix: 'WS',
    scope: 'as_written',
    track: 'regulatory',
    authorityRefs: h.authorityRefs,
    evidence: [{ kind: 'document', sourceDocumentId: h.passage.documentId, ...(h.passage.page !== undefined ? { page: h.passage.page } : {}), ...(h.passage.section !== undefined ? { section: h.passage.section } : {}), quotedText: h.passage.text }],
    severity: 'potential_indicator',
    // A firm rule match on verbatim language is high confidence; a weak
    // (aggressive-mode "applies to both — verify") hit is low confidence.
    confidence: h.weak ? 'low' : 'high',
    investigationQuestion: `${h.rationale}${h.note ? ' ' + h.note : ' Determine whether a comparable M/S provision exists and whether the factors and evidentiary standards are applied no more stringently.'}`,
    title: `Warning sign ${h.category}${h.weak ? ' (verify)' : ''} — ${h.ruleName}`,
    detail: `Matched plan language: "${h.passage.text}" (${h.citation}).`,
  });
}

export function fromDualAdministrator(ctx: SynthesisContext, d: DualAdministratorFinding): Finding {
  return make(ctx, {
    idPrefix: 'DUAL',
    scope: 'structural',
    track: 'both',
    authorityRefs: d.authorityRefs,
    evidence: [{ kind: 'computation', description: d.function, values: { type: d.type } }],
    severity: 'significant_indicator',
    confidence: 'high',
    investigationQuestion: d.detail,
    title: `Dual administrator — ${d.function} (${d.type})`,
    detail: d.detail,
  });
}

// ---- As-written comparability ----
export function fromAsWritten(ctx: SynthesisContext, a: AsWrittenFinding): Finding {
  return make(ctx, {
    idPrefix: 'AW',
    nqtlId: a.nqtlId,
    classificationId: a.classification,
    scope: 'as_written',
    track: 'regulatory',
    authorityRefs: a.authorityRefs,
    evidence: [{ kind: 'computation', description: a.asymmetryType, values: { ms: a.msValue, mhsud: a.mhsudValue, direction: a.direction } }],
    severity: a.suggestedSeverity,
    confidence: 'medium',
    investigationQuestion: `${a.detail} Determine whether this asymmetry reflects comparable factors applied no more stringently for MH/SUD.`,
    title: `As-written ${a.asymmetryType} asymmetry — ${a.nqtlId} (${a.classification})`,
    detail: a.detail,
  });
}

export function fromFactorAsymmetry(ctx: SynthesisContext, nqtlId: string, classification: Classification, a: FactorAsymmetry): Finding {
  return make(ctx, {
    idPrefix: 'FAC',
    nqtlId,
    classificationId: classification,
    scope: 'as_written',
    track: 'regulatory',
    authorityRefs: ['federal:2013', 'guidance:self-compliance-tool'],
    evidence: [{ kind: 'computation', description: a.type, values: { item: a.item } }],
    severity: 'significant_indicator',
    confidence: 'high',
    investigationQuestion: `${a.detail} A factor/evidentiary-source asymmetry is the single most frequently cited exam failure; confirm and reconcile.`,
    title: `Factor/source asymmetry — ${a.item} (${nqtlId}, ${classification})`,
    detail: a.detail,
  });
}

// ---- Schedule-of-benefits cost-share level comparison ----
export function fromCostShareLevel(ctx: SynthesisContext, c: CostShareLevelFinding): Finding {
  return make(ctx, {
    idPrefix: 'CS',
    classificationId: c.classification,
    scope: 'as_written',
    track: 'regulatory',
    authorityRefs: c.authorityRefs,
    evidence: [
      { kind: 'computation', description: `${c.frType} level comparison (${c.classification})`, values: { msLevel: c.msLevel, mhsudLevel: c.mhsudLevel, network: c.network } },
      { kind: 'document', sourceDocumentId: c.mhsudAnchor.documentId, ...(c.mhsudAnchor.page !== undefined ? { page: c.mhsudAnchor.page } : {}), ...(c.mhsudAnchor.section !== undefined ? { section: c.mhsudAnchor.section } : {}), quotedText: c.mhsudServiceText },
    ],
    severity: 'significant_indicator',
    confidence: 'high', // direct numeric comparison of stated cost shares
    investigationQuestion:
      `${c.detail} Confirm the M/S predominant level with claims dollars; if M/S cost sharing is uniform, a higher MH/SUD level exceeds the predominant and is a facial parity failure.`,
    title: `Cost-share level — MH/SUD more restrictive ${c.frType} (${c.classification})`,
    detail: c.detail,
  });
}

// ---- Case law ----
export function fromCaselaw(ctx: SynthesisContext, h: CaselawHit): Finding {
  const severity: Severity =
    h.venueWeight.label === 'binding_in_venue' ? 'significant_indicator' : 'potential_indicator';
  return make(ctx, {
    idPrefix: 'CASE',
    scope: h.scope === 'in_operation' ? 'in_operation' : 'as_written',
    track: 'litigation',
    authorityRefs: h.authorityRefs,
    evidence: [{ kind: 'computation', description: h.caseName, values: { citation: h.citation, weight: h.precedentialWeight, venue: h.venueWeight.label } }],
    // A litigation-track theory keyed to a fact pattern is never a "facial
    // violation" of statute/regulation — it is an exposure indicator.
    severity,
    confidence: h.venueWeight.label === 'binding_in_venue' ? 'high' : 'medium',
    investigationQuestion: `${h.finding} ${h.venueWeight.rationale} Remediation: ${h.remediation}`,
    title: `Litigation exposure — ${h.caseName}`,
    detail: h.note ? `${h.theory} NOTE: ${h.note}` : h.theory,
  });
}

// ---- In-operation ----
export function fromInOperation(ctx: SynthesisContext, r: RateComparisonResult): Finding | null {
  if (r.status === 'insufficient_data') {
    return make(ctx, {
      idPrefix: 'OP',
      classificationId: r.classification,
      ...(r.subclassKey ? { subclassificationId: r.subclassKey } : {}),
      scope: 'in_operation',
      track: 'regulatory',
      authorityRefs: r.authorityRefs,
      evidence: [{ kind: 'computation', description: `${r.metricId} (insufficient data)`, values: { nMhsud: r.nMhsud, nMs: r.nMs } }],
      severity: 'insufficient_data',
      confidence: 'low',
      investigationQuestion: r.investigationQuestion,
      title: `In-operation ${r.label} — insufficient data (${r.classification})`,
      detail: r.insufficientReason ?? 'Insufficient data.',
    });
  }
  // Near-significant (aggressive sensitivity): emit as a LOW-confidence potential indicator.
  if (!r.significant && r.nearSignificant) {
    return make(ctx, {
      idPrefix: 'OP',
      classificationId: r.classification,
      ...(r.subclassKey ? { subclassificationId: r.subclassKey } : {}),
      scope: 'in_operation',
      track: 'regulatory',
      authorityRefs: r.authorityRefs,
      evidence: [{ kind: 'statistical', metric: r.metricId, msValue: round(r.rateMs, 4), mhsudValue: round(r.rateMhsud, 4), ratio: Number.isFinite(r.ratio) ? round(r.ratio, 3) : r.ratio, diff: round(r.diff, 4), nMs: r.nMs, nMhsud: r.nMhsud, ...(r.pValue !== undefined ? { pValue: r.pValue } : {}), ...(r.pAdjusted !== undefined ? { pAdjusted: r.pAdjusted } : {}), ...(r.testUsed ? { testUsed: r.testUsed } : {}) }],
      severity: 'potential_indicator',
      confidence: 'low',
      investigationQuestion: r.investigationQuestion,
      title: `In-operation ${r.label} — near-significant (verify) — ${r.classification}`,
      detail: r.investigationQuestion,
    });
  }
  // Not significant or not adverse or practically negligible → compliant/indicator.
  if (!r.significant || !r.adverseToMhsud) return null; // reported in appendix but not a warning-sign finding
  const severity: Severity = r.practicallyNegligible ? 'potential_indicator' : 'significant_indicator';
  const confidence: Confidence =
    r.practicallyNegligible ? 'low' : (r.pAdjusted ?? 1) < 0.01 && r.effectSize && r.effectSize.magnitude !== 'negligible' ? 'high' : 'medium';
  return make(ctx, {
    idPrefix: 'OP',
    classificationId: r.classification,
    ...(r.subclassKey ? { subclassificationId: r.subclassKey } : {}),
    scope: 'in_operation',
    track: 'regulatory',
    authorityRefs: r.authorityRefs,
    evidence: [
      {
        kind: 'statistical',
        metric: r.metricId,
        msValue: round(r.rateMs, 4),
        mhsudValue: round(r.rateMhsud, 4),
        ratio: Number.isFinite(r.ratio) ? round(r.ratio, 3) : r.ratio,
        diff: round(r.diff, 4),
        nMs: r.nMs,
        nMhsud: r.nMhsud,
        ...(r.pValue !== undefined ? { pValue: r.pValue } : {}),
        ...(r.pAdjusted !== undefined ? { pAdjusted: r.pAdjusted } : {}),
        ...(r.ciLow !== undefined ? { ciLow: round(r.ciLow, 4) } : {}),
        ...(r.ciHigh !== undefined ? { ciHigh: round(r.ciHigh, 4) } : {}),
        ...(r.testUsed ? { testUsed: r.testUsed } : {}),
      },
    ],
    severity,
    confidence,
    investigationQuestion: r.investigationQuestion,
    title: `In-operation ${r.label} disparity — ${r.classification}`,
    detail: r.investigationQuestion,
  });
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round((n + Number.EPSILON) * f) / f;
}
