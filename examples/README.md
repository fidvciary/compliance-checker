# Examples — how to run a plan through the engine

There are two kinds of input, matching the two evaluation scopes:

| Tier | What | Format | Feeds |
|---|---|---|---|
| **A — "as written"** | SPD / plan document, schedule of benefits, UM manual, medical-necessity criteria, vendor map | today: **structured facts** in `analysis-input.json` (in the full product, extracted from the PDF/DOCX by the LLM extraction step) | classification, QTL, warning signs, as-written comparability, case law |
| **B — "in operation"** | claims / remittance / prior-auth / appeals / network / fee-schedule extracts | **CSV/XLSX** (de-identified) | denial rates, PA rates, overturns, reimbursement, QTL denominator |

## What runs today vs. the LLM boundary

- **Runs today, deterministically:** the claims CSV path (PHI gate → column
  mapping → classification) and the full analysis from a **structured
  `analysis-input.json`** (QTL/FR, warning signs, as-written comparability,
  in-operation statistics, case-law pack, findings, two draft reports, audit
  log, attorney gate).
- **The boundary (interface built, live model not wired):** turning an
  **unstructured SPD/PDF** into the structured facts the deterministic engine
  consumes. That is the LLM's *only* job here — see
  `src/llm/prompt-pinning.ts` (`CandidateExtractor`, `NarrativeDrafter`). Until
  an extraction adapter is connected, you supply those facts in the JSON. The
  engine never lets the LLM decide whether a rule fired.

## Path B — upload claims data (CSV)

1. **De-identify first.** The PHI gate fails closed and rejects the whole file
   (without echoing the value) if it sees member names, SSNs, MRNs, full DOBs,
   addresses, or **un-hashed** member IDs. Use a SHA-256 hex hash for the member
   id; drop names/SSN/DOB/address entirely.
2. Use the canonical headers (or a TPA template — Aetna ASO / UMR / Meritain —
   or the fuzzy wizard). See `sample-claims.csv`.

```bash
# The ingestion API: parse -> PHI gate -> map -> classify
# (see examples/ingest snippet in the chat, or src/ingestion/ingest.ts)
```

`sample-claims.csv` classifies like this — note residential MH/SUD (POS 56) is
housed in the **inpatient** classification per the DOL analog:

```
C1002: MHSUD  outpatient               -> outpatient_in_network
C1004: MHSUD  intermediate_residential -> inpatient_out_of_network
C1006: MS     emergency                -> emergency_care
```

## Path A + full run — structured input

```bash
npm run parity -- analyze --input examples/analysis-input.json --output ./out
```

Outputs to `./out/`:
- `comparative-analysis.draft.md` — six-step, two-track (regulatory / litigation)
- `self-compliance-tool.draft.md` — DOL Sections A–H + Appendices I/II
- `audit-log.jsonl` — hash-chained, reproducible
- `summary.json` — finding counts by severity/track + audit head hash

Everything is **DRAFT** until run through the attorney review gate
(`AttorneyReviewGate`): submit → dispose each proposed conclusion →
approve (identity + bar + content hash) → finalize → export FINAL.

## The `analysis-input.json` shape

See `analysis-input.json`. Required: `analysisId`, `planYear`, `scope`
(`as-written` | `in-operation` | `both`), `jurisdiction`, `rulesetSelectors`
(`active` / `advisory`), `nqtlSet` (`core` | `full`). Everything else is
optional and only the sections you provide are analyzed:

- `qtlInputs`, `cumulativeInputs`, `dollarLimitInputs` — FR/QTL math
- `warningSignPassages` (verbatim plan text + anchor), `vendorMap` — as-written
- `asWrittenComparisons`, `factorProfiles` — NQTL comparability
- `planFacts` — case-law detection (litigation track; rules must be attorney-
  activated first — all ship inactive)
- `rateComparisons`, `reimbursementTable` — in-operation

Full field list: `src/pipeline.ts` (`AnalysisInput`).
