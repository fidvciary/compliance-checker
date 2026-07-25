# Fidvciary Parity Engine

A parity compliance analysis engine for **self-funded employer group health plans**.
It ingests plan documents (and, optionally, claims/UM data) and produces a
structured determination of where quantitative treatment limitations (QTLs),
financial requirements (FRs), and nonquantitative treatment limitations (NQTLs)
are **not in parity** between medical/surgical (M/S) and mental health / substance
use disorder (MH/SUD) benefits under MHPAEA.

Every finding is traceable to at least one of three authority sources:

1. **Statute** — MHPAEA (29 U.S.C. § 1185a; 42 U.S.C. § 300gg-26), as amended by CAA 2021 § 203.
2. **Regulation** — 29 CFR § 2590.712 / 45 CFR § 146.136 (2013 rule), 45 CFR § 146.137
   (2024 comparative-analysis rule), and DOL sub-regulatory guidance.
3. **Case law & enforcement actions** — a curated, attorney-verified rule pack of
   judicially recognized and regulator-established parity violation theories.

The engine runs in two selectable evaluation scopes — **as written** and **in operation**
(or both) — mapping to 45 CFR § 146.137(c)(4) and (c)(5).

## The seven hard non-negotiables

These are enforced in code, not by convention:

1. **No AI-generated legal conclusions in a `FINAL` report.** Every proposed
   conclusion is emitted `DRAFT_PENDING_ATTORNEY_REVIEW` and is structurally
   excluded from any `FINAL` artifact. A report cannot become `FINAL` without a
   recorded attorney approval event. *(Module 12)*
2. **PHI is blocked at ingestion, fail-closed.** A detector runs before any row
   reaches the engines; detected PHI rejects the upload with a field-level report.
   Never silently strip and proceed. *(Module 2)*
3. **Deterministic rules stay deterministic.** Warning-sign scanner, case-law
   pack, QTL tests, and statistics are code and lookup tables. The LLM only
   (a) locates candidate plan language and (b) drafts prose. An LLM never decides
   whether a rule fired.
4. **Outcomes are never determinative alone.** Per the DOL Self-Compliance Tool
   Appendix II, disparate outcomes are *warning signs* warranting further review,
   not violations. Every in-operation finding is an investigation question. *(Module 9)*
5. **Append-only audit logging.** Every ingestion, rule evaluation, LLM call,
   attorney action, and report issuance writes an immutable, hash-chained record.
   Issued reports are reproducible from the log. *(Module 1)*
6. **Prompt-version pinning.** Every LLM call records `prompt_template_id`,
   `prompt_version`, `model_id`, and a hash of the rendered prompt.
7. **Ruleset versioning is mandatory.** Rulesets are declarative versioned data,
   never branching logic. The 2024 rule is *not* hard-coded. *(Module 1)*

## Regulatory posture (as of July 2026)

- The **2024 final rule** (89 FR 77586) is under a federal **non-enforcement
  policy** (May 15, 2025, in connection with *ERISA Industry Committee v. HHS*).
  On March 30, 2026 the Departments stated they will not defend it and intend to
  propose replacement regulations (target Dec 31, 2026). It ships as
  `enforcement_status: non_enforced_federal` and its findings are **advisory**.
- The **2013 final rule** and the **CAA 2021** statutory comparative-analysis
  requirement remain **in force and enforced**.
- **State regulators are not bound** by the federal non-enforcement statement.

The engine segregates *required-now* findings from *advisory* findings on this basis.

## Architecture / build order

| Module | Area | Status |
|---|---|---|
| 1 | Versioned ruleset model + loader + audit log | ✅ |
| 2 | Ingestion + PHI gate + column mapping (Aetna/UMR/Meritain) | ✅ |
| 3 | Classification engine + consistency lock | ✅ |
| 4 | QTL/FR parity engine + golden fixtures | ✅ |
| 5 | NQTL inventory + six-step scaffolder | ✅ |
| 6 | Warning-sign scanner (deterministic rule table) | ✅ |
| 7 | Case-law / enforcement rule pack (ships inactive) | ✅ |
| 8 | As-written comparability tests | ✅ |
| 9 | In-operation metrics + statistics | ✅ |
| 10 | Finding synthesis + severity model + sufficiency linter | ✅ |
| 11 | Report generator + methodology + TPA request letter | ✅ |
| 12 | Attorney review gate + CLI | ✅ |

## Layout

```
rulesets/            declarative, versioned regulatory data (YAML)
  federal/  state/  guidance/
caselaw/             case-law & enforcement rule pack (YAML, ships inactive)
src/
  util/              canonical JSON, hashing, clock
  audit/             append-only hash-chained audit log
  rulesets/          ruleset types, loader, active/advisory registry
  ingestion/         PHI gate, column mapping, TPA templates, availability matrix
  classification/    six classifications, code maps, consistency lock
  qtl/               substantially-all / predominant / cumulative FR engine
  nqtl/              NQTL library, six-step scaffolder, factors, sufficiency linter
  analysis/          warning-sign scanner, as-written comparability, caselaw pack
  in-operation/      metrics + statistics (z-test, Fisher, BH correction)
  findings/          finding record + severity model + synthesis
  report/            comparative analysis + Self-Compliance Tool + methodology
  attorney/          report state machine + approval gate
test/                unit + golden-fixture + adversarial tests
```

## Usage

```bash
npm install
npm test                       # run the full test suite
npm run typecheck              # tsc --noEmit

# Upload a plan document (PDF or txt) and get a "what may not be compliant" screen
npm run parity -- scan-document ./plan.pdf --output ./out

# Start a full DRAFT report from plan document(s)
npm run parity -- analyze --documents ./plan.pdf --jurisdiction PA --output ./out

# End-to-end demo (synthetic, de-identified) — writes DRAFT reports + audit log
npm run parity -- analyze --demo --output ./output

# Run an analysis from a structured input file
npm run parity -- analyze \
  --plan-year 2025 \
  --scope both \
  --rulesets federal:statute,federal:2013,guidance:* \
  --advisory federal:2024 \
  --jurisdiction CT \
  --nqtl-set core \
  --input ./analysis-input.json \
  --output ./output

# Inspect loaded rulesets and their enforcement status
npm run parity -- rulesets

# List the case-law verification queue (all rules ship INACTIVE)
npm run parity -- verify-caselaw
```

The `analyze` command writes `comparative-analysis.draft.md`,
`self-compliance-tool.draft.md`, `audit-log.jsonl`, and `summary.json`. Reports
are **DRAFT** until run through the attorney review gate (`AttorneyReviewGate`:
submit → dispose each conclusion → approve with identity+bar+content-hash →
finalize → export FINAL). The CLI emits DRAFT only.

### Test suite (regression gates)

- **QTL golden fixtures** — hand-computed, incl. exact-⅔ boundary,
  no-single-level-over-½ combination, and zero-M/S-benefits cases.
- **PHI detector** — seeded PHI of every type asserts rejection; adversarial
  clean data asserts no false positives.
- **Warning-sign scanner** — recall on a planted corpus + precision on
  compliant look-alikes.
- **Statistics** — z-test, Fisher, and Benjamini–Hochberg validated against
  known values; n<30 short-circuit.
- **Reproducibility** — identical inputs + clock ⇒ identical report content hash
  and identical audit head hash.
- **Attorney gate** — no FINAL export without a recorded approval; post-approval
  mutation invalidates approval.

## Non-goals (v1)

- No claim-level adjudication review or medical-necessity second opinions.
- No determination of whether a specific denial was correct.
- No legal advice, litigation-merits opinions, or DOL-outcome predictions.
- No fully-insured product path.
- **No output is represented as satisfying the comparative-analysis requirement
  without attorney review.** Every artifact says so on its face.

## Citation verification

Every case-law rule ships **inactive** (`active: false`) and does not fire until
an attorney populates `verified_by` and `verified_date`. Several seed citations
are provided from working memory and must be confirmed (reporter volume, year,
court, subsequent history) before activation. A wrong citation in a compliance
deliverable is worse than a missing one. See `caselaw/README.md`.
