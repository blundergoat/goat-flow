---
name: goat-qa
description: "Use when evaluating test coverage gaps, planning test strategy, or assessing testing risk for code changes."
goat-flow-skill-version: "1.10.1"
---
# /goat-qa

## Shared Conventions

Read `.goat-flow/skill-docs/skill-preamble.md` before starting.
On full-depth, also read `.goat-flow/skill-docs/skill-conventions.md`.

## When to Use

goat-qa is a **testing gap analyser**: it maps changed code or a codebase area to coverage and outputs prioritized must/should/skip guidance. It does not write tests or run full test commands.

**Invoke when:**
- Feature branch is ready for testing and you want to know what to focus on
- QA has a test plan and you want to verify it covers the actual code changes
- You're reviewing a PR and want to know what the tests miss
- You want to find manual testing gaps before a release
- You need a QA handoff artifact (flow diagram, risk matrix, manual test plan)

**NOT this skill:** Run-test requests → run them directly. Test failures or fix verification → /goat-debug. Code quality → /goat-review. Milestones → /goat-plan. Feature briefs → dispatcher. Merge certification → /goat-review plus Proof Gate.

| Excuse | Reality |
|--------|---------|
| "CI is green so coverage is fine" | Scanner scored 100% while preflight failed with 8 errors. CI tests what was thought of; gap analysis looks for what wasn't. |
| "Unit tests cover it" | Structural tests that import and snapshot pass at high coverage but miss every behavioural edge. STRUCTURAL is not BEHAVIOURAL. |
| "Coverage report says 80%" | Coverage measures shape, not truth. 20+ content-accuracy failures survived a structural pass that reported high coverage. |
| "Doer ran the tests, so we're covered" | Doer-verifier is theater in single-agent context. The verifier must have a context boundary the doer did not cross. |

## Coverage Depth

Canonical coverage vocabulary used in Standard, Audit, and cross-skill output.

| Level | Meaning |
|-------|---------|
| NONE | No matching test file or manual plan |
| STRUCTURAL | Imports, constructs, or snapshots only - no behaviour assertion |
| PARTIAL-BEHAVIOURAL | Happy path or narrow behaviour only; error/edge paths untested |
| BEHAVIOURAL | Meaningful output, side-effect, error-path, or invariant coverage |

## Step 0 - Intake

**Mode detection - confirm, don't silently decide:**

- Changed files + no specific ask → offer standard or audit
- "audit"/"coverage"/"gaps" → Audit mode (full depth)
- "verify coverage"/"what's risky"/"what should I test" or scoped files → Standard mode (quick depth)

**Depth mapping:** Standard = quick changed-file analysis. Audit = full codebase-area analysis. Dispatcher depth maps quick → Standard, full → Audit.

If mode and scope are clear, state "Running [mode] on [scope]." and proceed. Ask only on ambiguity.

**Gather:** changed scope, existing test plan (if any), audience. Check the instruction file's Essential Commands section or `package.json` scripts for test/lint commands.

**Footgun check:** Use the preamble's grep-first learning-loop retrieval on `.goat-flow/learning-loop/footguns/`, `.goat-flow/learning-loop/lessons/`, `.goat-flow/learning-loop/patterns/`, and `.goat-flow/learning-loop/decisions/` for the target area. Surface matches or an explicit retrieval miss; do not broad-load any bucket.

**PR / issue link (strongly encouraged):** ask for PR/issue before Phase 1. Acceptance criteria are the benchmark. If `gh` is available, use `gh pr view` + `gh pr diff`; otherwise note `no-intent-spec`, which degrades `safe to skip` confidence.

If arriving from the dispatcher with context already gathered, confirm and proceed.

**No existing tests:** risk analysis still applies. Mark coverage `NONE` and state: "This project has no automated tests. Verification falls to human and AI reviewers."

**CHECKPOINT:** "Analysing [N] changed files against [existing test plan / no test plan]. Audience: [dev/tester/both]." Proceed unless scope, audience, or test plan is ambiguous.

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

**For each CRITICAL/HIGH change, trace the blast radius:**
- What depends on this code? (callers, consumers, downstream services)
- What user-visible flows pass through this code path?
- Has this area broken before? (check footguns/lessons)

**Output: Change Risk Map**

| File | Lines Changed | What Changed (plain English) | Risk | Blast Radius | User-Visible Impact |
|------|-------------|---------------------------|------|-------------|-------------------|

**CHECKPOINT:** "Risk map complete. [N] CRITICAL, [M] HIGH risk changes. Proceeding to gap analysis."

## Phase 2 - Gap Analysis

Compare risk vs coverage in both directions:
- If a test plan exists, map cases to CRITICAL/HIGH changes and check reverse coverage.
- If no plan exists, map changed files to automated tests and flag explicit behavior gaps.
- For each changed file, read the matched test file (if any) and classify using Coverage Depth. If tests are unavailable, record `tests not read` in Verification Integrity.
- Classify gaps as:
  - **Undertested risk**
  - **Misaligned effort**

For CRITICAL items with no coverage, annotate why: new path / missed coverage on existing path / hard-to-test.

**Intent vs Reality Diff (when intent spec exists):** If a PR, issue, test plan, or user-provided acceptance criteria is available, add:

| Expected Behaviour | Observed Code Behaviour | Gap | Risk |

Map each stated expectation to the code path that implements it. Gaps between intent and code are undertested-risk candidates.

**Cross-agent verification:** suggest a different agent/model for blind-spot checks.

**BLOCKING GATE:** Present gap analysis plus Verification Integrity and stop. Ask: "Continue to Phase 3, or adjust the analysis first?" For explicit "what should I test" or "test plan" intent, continue through Phase 3 in the same response. Reserve diagrams for Phase 3. After the plan, suggest `/goat-plan` for milestone tasks.

## Phase 3 - Targeted Testing Plan

Based on the gaps, produce a focused plan and order by risk.

**Must test (CRITICAL gaps):** table with what breaks and grounded effort estimate; if effort is unknown, write `unknown - needs harness/project context`
**Should test if time allows (MEDIUM gaps):** same format, lower priority
**Safe to skip this round:** low-risk or adequately covered areas
**Misaligned effort:** deprioritise plan cases not mapped to current changes

**CHECKPOINT:** "Targeted testing plan ready. Want a flow diagram for any CRITICAL item?"

## Phase 4 - Flow Diagram

For flow diagrams, use Mermaid flowcharts with 8-15 nodes per diagram, happy path first, then branch points for error states and edge cases.

---

## Audit Mode

For a codebase area with no recent change. Audit mode analyses existing load-bearing files, coverage depth, and structural-vs-behavioural gaps. It does NOT read a diff; skip Phase 1.

### A1 - Scope

Declare the audit boundary explicitly. Supported shapes:
- A directory (e.g. `src/cli/audit/`) - every source file inside.
- A module (e.g. `src/cli/quality/`) - the module's entry point and direct callees.
- A risk class (e.g. "everything touching auth tokens") - files you would need to read to verify the claim.

If unsure, ask the user before A1.5.

### A1.5 - Scope-Size Gate

Inventory approximate file count before deep analysis. If too large, present a ranked slice prioritising load-bearing and interface-boundary files. Proceed to A2 only after manageable scope is confirmed.

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
1. Does a test file exist? If not → coverage `NONE`.
2. If yes, read the test. Does it assert behaviour (outputs, side effects, error paths) or only construct the unit?
3. Flag mock-heavy tests (everything mocked = behaviour untested) and integration-only blind spots (suite skips when the external service is unavailable).

Record coverage using the Coverage Depth vocabulary above.

### A4 - Gap Report

Rank gaps by `Risk × (1 - CoverageLevel)` descending. Output:

- **Blocking gaps** - CRITICAL-risk file with NONE or STRUCTURAL coverage. One line per file: missing behaviour + the test the user should add.
- **High-value additions** - HIGH-risk file with PARTIAL coverage. Describe the untested path.
- **Defer** - LOW-risk or already well-covered files. Name them explicitly so the user sees what was considered and why.

**BLOCKING GATE:** Present gap report; wait for human decision before generating plan files.

## Regression Guard Mode

Post-verification guard planning. Cite the prior fix verification source, define 1-2 invariants, assess coverage, then hand off guard tests. This mode does NOT verify the fix itself.

## Constraints

- goat-qa is a testing GAP ANALYSER - it finds mismatches between code (changed or existing) and testing coverage
- MUST compare in-scope code against existing testing coverage (manual plan, automated tests, or neither)
- MUST find gaps in BOTH directions: undertested risks AND misaligned test effort
- MUST produce "must test / should test / safe to skip" tiers with rationale for skips
- MUST include Verification Integrity section
- MUST apply the Proof Gate from `skill-preamble.md` to every claim made in the gap analysis or testing plan
- MUST tag every finding/claim row with proof class `RUNTIME | CONTRACT-GREP | STATIC | NOT-REPRODUCED`
- MUST NOT generate test code - hand off to the coding agent
- Universal constraints from skill-preamble.md apply.
- Standard mode: MUST read the actual diff, not just file names - a one-line auth change outranks a 200-line CSS change
- Standard mode: MUST classify every change by risk level with plain-English description of what changed
- Standard mode: MUST trace blast radius for CRITICAL/HIGH changes
- Audit mode: MUST classify every in-scope file by role (load-bearing, interface, glue, UI, support), not by recency; MUST NOT read a diff or ask for one
- Audit mode: MUST include a risk-ranked gap report with blocking-gap / high-value-addition / defer tiers
- If flow diagrams are requested, use Mermaid flowcharts (8-15 nodes, happy path first, annotate gap status per node).
- Regression guard: MUST state invariants as human-readable sentences; MUST cite prior fix-verification source; MUST NOT verify the fix itself
- MUST defend zero-gap results explicitly: state what was checked and why no gaps surfaced. Zero gaps without justification is an error condition, not a clean bill.

## Output Format

Output shape depends on the mode declared in Step 0. Pick the template that matches the mode you ran.

### Standard mode - Phase 2 output (diff-driven, present at BLOCKING GATE)

```markdown
## TL;DR  <!-- what changed, what's at risk, biggest testing gaps -->

## Change Risk Map
| File | Lines Changed | What Changed | Risk | Blast Radius | User-Visible Impact | Proof Class |

## Gap Analysis
### Undertested Risks  <!-- CRITICAL/HIGH changes with no or partial test coverage -->
| Code Change | Risk | Coverage Depth | Covered By | Gap | Proof Class |

### Misaligned Effort  <!-- test cases that don't match code changes in this branch -->
| Test Case | Maps to Change | Assessment | Proof Class |

## Verification Integrity
- Intent spec: [PR/issue/test plan URL or `no-intent-spec`]
- Tests read: [list]
- Tests not read / unavailable: [list or `none`]
- Commands discovered: [test/lint commands found]
- Commands run: `none` (goat-qa does not execute tests)
- Runtime execution by others: [who ran what, or `none observed`]
- Coverage claim basis: [OBSERVED | INFERRED | UNVERIFIED]
- Proof classes: <N> RUNTIME / <M> CONTRACT-GREP / <K> STATIC / <L> NOT-REPRODUCED
- Analysis confidence: [HIGH | MEDIUM | LOW] - [rationale]
- Evidence limit: [diff/files read and any unavailable runtime/tool context]
- Assessed by: [agent]
```

### Standard mode - Phase 3 output (generate only after Phase 2 gate approval)

```markdown
## Targeted Testing Plan
### Must test before shipping  <!-- CRITICAL gaps with manual steps, failure symptoms, time, proof class -->
### Should test if time allows  <!-- HIGH/MEDIUM gaps, proof class -->
### Safe to skip  <!-- with rationale and proof class -->

## Verification Integrity

- Changes by: [agent/developer]
- Testing by: [who executes]
- Doer-verifier separation: [FULL / PARTIAL / NONE]

## Regression Guards  <!-- post-verification only; cite prior fix-verification source -->
| Invariant | Current Coverage | Recommended Guard | Owner | Proof Class |
## Flow Diagram  <!-- only on request -->
```

### Audit mode (no diff - A1–A4 shape)

```markdown
## TL;DR  <!-- which files carry load-bearing behaviour, coverage shape, biggest gaps -->

## Scope
<!-- Declared boundary from A1: directory, module, or risk class. -->

## Inventory and Risk Ranking
| File | Role | Risk | Proof Class |
<!-- Roles: load-bearing / interface boundary / integration glue / UI / support -->

## Coverage Analysis
| File | Test file | Coverage | Notes | Proof Class |
<!-- Coverage: NONE | STRUCTURAL | PARTIAL-BEHAVIOURAL | BEHAVIOURAL -->

## Gap Report
### Blocking gaps  <!-- CRITICAL-risk + NONE/STRUCTURAL coverage; each item includes proof class -->
### High-value additions  <!-- HIGH-risk + PARTIAL coverage; each item includes proof class -->
### Defer  <!-- LOW-risk or well-covered; each item includes proof class -->

## Verification Integrity
- Intent spec: [audit scope rationale or `no-intent-spec`]
- Tests read: [list]
- Tests not read / unavailable: [list or `none`]
- Commands discovered: [test/lint commands found]
- Commands run: `none` (goat-qa does not execute tests)
- Coverage claim basis: [OBSERVED | INFERRED | UNVERIFIED]
- Proof classes: <N> RUNTIME / <M> CONTRACT-GREP / <K> STATIC / <L> NOT-REPRODUCED
- Analysis confidence: [HIGH | MEDIUM | LOW] - [rationale]
- Assessed by: [agent]
- Would-be testers: [who executes once gaps are filled]

## Flow Diagram  <!-- only on request -->
```
