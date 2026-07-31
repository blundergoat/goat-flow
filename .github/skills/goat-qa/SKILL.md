---
name: goat-qa
description: "Use when evaluating test coverage gaps, planning test strategy, or assessing testing risk for code changes."
goat-flow-skill-version: "1.14.0"
---
# /goat-qa

## Shared Conventions

Read `.goat-flow/skill-docs/skill-preamble.md` before starting.
On full-depth, also read `.goat-flow/skill-docs/skill-conventions.md`.

## When to Use

goat-qa maps changed code or a codebase area to coverage and prioritized must/should/skip guidance. It neither writes nor runs tests.

## Boundary Commands

- **NEVER:** Run or write tests, verify fixes, review code, or certify merges.
- **ALWAYS:** Map code risk to tests read; return tiers with Verification Integrity.
- **DEFER TO:** Direct test execution, `/goat-debug`, `/goat-review`, `/goat-plan`, or the dispatcher.

| Excuse | Reality |
|--------|---------|
| "CI is green so coverage is fine" | Scanner scored 100% while preflight failed with 8 errors. CI tests what was thought of; gap analysis looks for what wasn't. |
| "Unit tests cover it" | Structural tests that import and snapshot pass at high coverage but miss every behavioural edge. STRUCTURAL is not BEHAVIOURAL. |

## Coverage Depth

| Level | Meaning |
|-------|---------|
| NONE | No matching test file or manual plan |
| STRUCTURAL | Imports, constructs, or snapshots only - no behaviour assertion |
| PARTIAL-BEHAVIOURAL | Happy path or narrow behaviour only; error/edge paths untested |
| BEHAVIOURAL | Meaningful output, side-effect, error-path, or invariant coverage |

### Exhaustive priority matrix

Use this matrix in Standard and Audit modes so every risk/coverage pair lands in exactly one tier:

| Risk | NONE | STRUCTURAL | PARTIAL-BEHAVIOURAL | BEHAVIOURAL |
|------|------|------------|---------------------|-------------|
| CRITICAL | Blocking | Blocking | Blocking | Defer |
| HIGH | Blocking | Blocking | High-value | Defer |
| MEDIUM | High-value | High-value | High-value | Defer |
| LOW | Defer | Defer | Defer | Defer |

Standard maps Blocking to Must test, High-value to Should test, and Defer to Safe to skip. Audit uses the matrix labels directly.

## Step 0 - Intake

**Mode detection - scope wins over vocabulary:**

- Explicit request to preserve a verified fix, prevent regression, or add regression guards → Regression Guard mode
- Explicit diff, PR, branch, changed-file, or recent-change scope → Standard mode (quick depth), even when the request also says "audit", "coverage", or "gaps"
- Explicit codebase area, directory, module, or risk-class coverage audit with no recent-change scope → Audit mode (full depth)
- Bare "audit", "coverage", or "gaps" with no change or area scope → ask whether the user means recent-change Standard or no-diff area Audit

**Depth mapping:** Regression Guard reads cited evidence plus code/tests; Standard reads changes; Audit reads a no-diff area. Scope semantics outrank dispatcher depth.

**Gather:** scope, existing test plan (if any), audience. Check instruction Essential Commands or `package.json` for test/lint commands.

**Standard Scope-Size Gate:** Count changed files before deep analysis. If too large, rank a load-bearing/interface slice; proceed after confirmation.

**Footgun check:** Run the preamble's target-area learning-loop retrieval. Emit matches or an explicit miss; never broad-load a bucket.

**PR / issue link:** benchmark acceptance criteria. With `gh`, read the PR and diff; otherwise record `no-intent-spec`, lowering `safe to skip` confidence.

**No existing tests:** mark coverage `NONE`: "No automated tests; verification falls to human and AI reviewers."

**CHECKPOINT:** Standard: "Analysing [N] changed files against [existing test plan / no test plan]." Audit: "Auditing [scope] against [existing tests / no tests]." Proceed unless scope, audience, or test plan is ambiguous.

## Phase 1 - Change Risk Analysis

Read every changed file. For each, understand WHAT changed and WHY it's risky.

**Diff analysis - not just file names.** Read the actual diff, not just `--stat`; one auth line can outrank 200 CSS lines.

Classify each change:

| Risk | What it means | Examples |
|------|-------------|---------|
| CRITICAL | If this breaks, users are directly affected or security is compromised | Auth logic, payment flow, data mutation, permission checks, API contracts |
| HIGH | Business logic or integration that affects correctness | Calculations, state transitions, cross-service calls, database queries |
| MEDIUM | Internal logic with limited blast radius | Utilities, validators, formatters, isolated components |
| LOW | Cosmetic, config, or changes with no behavioural impact | Styling, copy, constants, type-only changes |

For each CRITICAL/HIGH change, trace callers, consumers, user-visible flows, downstream services, and matched footguns/lessons.

**Output: Change Risk Map**

| File | Lines Changed | What Changed (plain English) | Risk | Blast Radius | User-Visible Impact |
|------|-------------|---------------------------|------|-------------|-------------------|

**CHECKPOINT:** "Risk map complete. [N] CRITICAL, [M] HIGH risk changes. Proceeding to gap analysis."

## Phase 2 - Gap Analysis

Compare risk and coverage bidirectionally:
- With a test plan, map every case and CRITICAL/HIGH/MEDIUM change in both directions.
- Without one, map every changed behaviour to automated tests and flag gaps.
- Read each matched test file and classify coverage depth; record unavailable tests in Verification Integrity.
- Apply the exhaustive priority matrix to every changed behaviour. Blocking/High-value gaps are **Undertested risk**; evidence-backed test-to-risk mismatches are **Misaligned effort**.

For CRITICAL items with no coverage, annotate why: new path / missed coverage on existing path / hard-to-test.

**Intent vs Reality Diff (when intent spec exists):** If a PR, issue, test plan, or user-provided acceptance criteria is available, add:

| Expected Behaviour | Observed Code Behaviour | Gap | Risk |

Map each stated expectation to the code path that implements it. Gaps between intent and code are undertested-risk candidates.

**BLOCKING GATE (auto-released on explicit test-plan intent):** Present gap analysis plus Verification Integrity, then stop and ask "Continue to Phase 3, or adjust first?" - unless the invocation already gave explicit "what should I test" / "test plan" intent, in which case treat it as a CHECKPOINT and continue through Phase 3 without pausing. Reserve diagrams for Phase 3; then suggest `/goat-plan`.

**Illustrative scenario - input/output shape only; never evidence.**

**Worked Standard example:** A terminal-launch diff is HIGH risk. Read its smoke tests; safe to skip more PTY timing tests only when current target evidence proves timing code is unchanged.

## Phase 3 - Targeted Testing Plan

Based on the gaps, produce a focused plan and order by risk.

**Must test (matrix Blocking):** table with what breaks and grounded effort estimate; if effort is unknown, write `unknown - needs harness/project context`
**Should test if time allows (matrix High-value):** same format, lower priority
**Safe to skip this round (matrix Defer):** name considered areas and why they can wait
**Misaligned effort:** deprioritise plan cases not mapped to current changes

**CHECKPOINT:** "Targeted testing plan ready. Want a flow diagram for any CRITICAL item?"

---

## Audit Mode

For a codebase area with no recent change. Audit mode analyses existing load-bearing files, coverage depth, and structural-vs-behavioural gaps. It does NOT read a diff; skip Phase 1.

### A1 - Scope

Declare the audit boundary explicitly. Supported shapes:
- A directory (e.g. `src/payments/`) - every source file inside.
- A module (e.g. `src/reporting/`) - the module's entry point and direct callees.
- A risk class (e.g. "everything touching auth tokens") - files you would need to read to verify the claim.

If unsure, ask the user before A1.5.

### A1.5 - Scope-Size Gate

Count files before deep analysis. If too large, rank a load-bearing/interface slice; proceed after scope confirmation.

### A2 - Inventory and Risk Ranking

Without any diff, classify each in-scope file by its *role*, not its recency:

| Role | Examples |
|------|----------|
| Load-bearing | auth, payments, permission checks, data mutation, migration |
| Interface boundary | API routes, CLI commands, public exports |
| Integration glue | config loaders, filesystem bridges, external clients |
| UI / presentation | views, templates, styling |
| Support | types, constants, pure helpers |

Load-bearing + Interface files get CRITICAL or HIGH risk ratings by default.

### A3 - Coverage Analysis

For each in-scope file:
1. Inventory named behaviours/invariants with a code anchor and risk before coverage; CRITICAL/HIGH/MEDIUM inventory must be exhaustive.
2. Create one row per named behaviour; files may have multiple rows/labels.
3. Search all tests and exported-symbol references. No matching test/manual plan → coverage `NONE`.
4. Read matches; classify assertions for that behaviour. Flag mocks/skipped integrations.

A file summary cannot promote a row. BEHAVIOURAL applies only to the named behaviour/invariant actually asserted.

Misaligned effort is an observed test-to-risk mismatch. Evidence must show duplicate tests adding no distinct branch/invariant while higher-risk behaviour is uncovered; mock-heavy/structural tests displacing user-visible or error paths; or deeper LOW-risk coverage beside uncovered CRITICAL/HIGH paths. Do not infer misalignment from high coverage alone or recommend deleting safety coverage. If no item meets these evidence conditions, report `none found` and name the comparison.

### A4 - Gap Report

Rank each behaviour row by `Risk × uncovered fraction`: CRITICAL=4, HIGH=3, MEDIUM=2, LOW=1; NONE=1.0, STRUCTURAL=0.66, PARTIAL-BEHAVIOURAL=0.33, BEHAVIOURAL=0. Output:

- **Blocking gaps** - every matrix Blocking pair: CRITICAL with any coverage gap, plus HIGH with NONE or STRUCTURAL. One line per behaviour/invariant: file + code anchor, missing assertion, and test to add.
- **High-value additions** - every matrix High-value pair: HIGH with PARTIAL-BEHAVIOURAL, plus MEDIUM with any coverage gap. Describe the untested path.
- **Defer** - every matrix Defer pair: LOW-risk rows or a named behaviour with BEHAVIOURAL coverage. A BEHAVIOURAL row never defers uncovered sibling behaviours in the same file.
- **Misaligned effort** - evidence-backed test-to-risk mismatches, or `none found` with named comparison.

**Illustrative scenario - input/output shape only; never evidence.**

**Worked Audit example:** Read tests, not filenames: integration coverage can make a file PARTIAL-BEHAVIOURAL. Classify `<target-project>/src/content-check.ts` as NONE only after checking unit, integration, and exported-symbol references.

**BLOCKING GATE:** Present gap report; wait for human decision before generating a testing plan response. Create no plan file unless separately approved. After approval, preserve the A4 tiers in the Audit post-gate template below.

## Regression Guard Mode

After a verified fix, cite its source; define 1-2 human-readable invariants; compare existing tests/manual coverage; emit the standalone template plus Verification Integrity. Do NOT verify the fix. This mode replaces the phase flow; skip Phases 1-3.

## Constraints

- goat-qa is a testing GAP ANALYSER - it finds mismatches between code (changed or existing) and testing coverage
- MUST compare in-scope code against existing testing coverage (manual plan, automated tests, or neither)
- MUST assess gaps in BOTH directions: undertested risks AND misaligned test effort; report `none found` rather than inventing either
- MUST use the declared mode's priority tiers: Standard uses "must test / should test / safe to skip"; Audit uses "Blocking / High-value / Defer"
- MUST include Verification Integrity section
- MUST apply the Proof Gate from `skill-preamble.md` to every claim made in the gap analysis or testing plan
- MUST tag every finding/claim row with proof class `RUNTIME | CONTRACT-GREP | STATIC | NOT-REPRODUCED`
- MUST NOT generate test code - hand off to the coding agent
- Universal constraints from skill-preamble.md apply; per-mode MUSTs live in the phase bodies (Phase 1 diff/risk/blast-radius; Audit A2/A4), not restated here.
- If flow diagrams are requested, use Mermaid flowcharts (8-15 nodes, happy path first, annotate gap status per node).
- Regression guard: MUST state invariants as human-readable sentences; MUST cite prior fix-verification source; MUST NOT verify the fix itself
- MUST defend zero-gap results explicitly: state what was checked and why no gaps surfaced. Zero gaps without justification is an error condition, not a clean bill.

## Output Format

After analysis, read `references/output-templates.md` and select only the template matching the mode and gate reached. Do not load the reference during intake; the phase bodies above define analysis and gate behaviour.
