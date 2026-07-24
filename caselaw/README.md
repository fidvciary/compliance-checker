# Case-law & enforcement rule pack

This directory is the litigation-track rule pack — the product differentiator.
Each YAML file encodes one judicially-recognized or regulator-established parity
violation theory as a **deterministic detector**: structured `detection` tests
over registered predicates (`src/analysis/caselaw/predicates.ts`), plus the
authority metadata (citation, jurisdiction, precedential weight) and the finding
and remediation templates.

## The activation gate (non-negotiable)

**Every rule ships `active: false` and does not fire.** The loader
(`src/analysis/caselaw/loader.ts`) enforces the invariant:

> A rule may be `active: true` **only** when both `verified_by` and
> `verified_date` are populated.

Attempting to load an `active: true` rule without verification is a hard error
(`CaselawActivationError`). This forces an attorney verification pass before any
rule can fire against a customer's plan.

## Before you activate a rule

Per the build spec's verification instruction, **several seed citations are given
from working memory and at least some contain errors** in reporter volume, year,
or court. Before setting `active: true`:

1. Pull the actual opinion / consent judgment / exam report.
2. Confirm the **citation** (reporter, volume, page, year, court).
3. Confirm the **holding** actually supports the theory as stated.
4. Check **subsequent history** (reversal, vacatur, injunction status). *Wit v.
   UBH* in particular has a complex 9th Circuit history.
5. Confirm **current validity** and the **precedential weight** for the relevant
   venue.
6. Populate `verified_by` (attorney id/initials) and `verified_date` (ISO date),
   then set `active: true`.

A wrong citation in a compliance deliverable is worse than a missing one.

## Reference-only rules

Some entries (`smith_golden_rule.no_analog_required`,
`ew_healthnet.plan_term_comparator`, `state.md_exam_findings`) have **empty
`detection`**. They are comparator-methodology / exemplar references that shape
how *other* rules search for M/S analogs; they never emit a standalone finding
even once activated.

## Self-funded / ERISA-preemption caveat

State authorities (CT reimbursement findings, MD exam reports) generally
addressed **fully-insured** products. Direct application to **self-funded ERISA**
plans is limited by preemption. Where a rule carries a `note`, that caveat is
surfaced in the report rather than asserted away.

## Two-track reporting

These rules populate **Track 2 — Litigation** (fact patterns that have survived
motions to dismiss or produced adverse judgments/settlements), reported
separately from **Track 1 — Regulatory** (statute/regulation/guidance). Venue
weighting (`venueWeight` in `registry.ts`) surfaces how much practical weight a
theory carries for the plan sponsor's likely forum.
