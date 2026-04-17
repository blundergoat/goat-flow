---
name: goat-test
description: "Testing gap analyser. Compares code changes against testing coverage to find undertested risks and misaligned test effort."
goat-flow-skill-version: "1.1.0"
---
# /goat-test

## Shared Conventions

Read `.goat-flow/skill-preamble.md` for shared conventions.
On full-depth, also read `.goat-flow/skill-conventions.md`.

## When to Use

goat-test is a **testing gap analyser**: it maps changed code to testing coverage and prioritises what to test.

It does not write test code or run full test commands.

Output: prioritized "must test / safe to skip / should test" guidance.

**Invoke when:**
- Feature branch is ready for testing and you want to know what to focus on
- QA has a test plan and you want to verify it covers the actual code changes
- You're reviewing a PR and want to know what the tests miss
- You want to find manual testing gaps before a release
- You need a QA handoff artifact (flow diagram, risk matrix, manual test plan)

**NOT this skill:** Running tests → just run them. Debugging test failures → /goat-debug. Code quality → /goat-review. Planning milestones → /goat-plan. Feature briefs → dispatcher Planning Route.

## Step 0 - Intake

**Mode detection - confirm, don't silently decide:**

- Changed files + no specific ask → offer standard or audit
- "audit"/"coverage"/"gaps" → Audit mode (full depth)
- "test this"/"verify"/"what's risky" or scoped files → Standard mode (quick depth)

**Depth mapping:** Standard mode = quick (analyse changed files). Audit mode = full (analyse a codebase area). If arriving from the dispatcher with depth pre-selected: quick → Standard, full → Audit.

Confirm: "Running [mode] on [scope]. Correct?"

**Gather:** changed scope, existing test plan (if any), audience, footgun context. Check the instruction file's Essential Commands section or `package.json` scripts for test/lint commands.

If arriving from the dispatcher with context already gathered, confirm and proceed.

**No existing tests detected:** If the project has no test files, the risk analysis still applies. Flag coverage as "NONE" for all files. Note: "This project has no automated tests. All verification falls to human and AI reviewers."

**CHECKPOINT:** "Analysing [N] changed files against [existing test plan / no test plan]. Audience: [dev/tester/both]. Proceed?"

## Phase 1 - Change Risk Analysis

Read every changed file. For each, understand WHAT changed and WHY it's risky.

**Diff analysis - not just file names.** Read the actual diff, not just `--stat`. A one-line change to an auth check is CRITICAL. A 200-line change to a CSS file is LOW.

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
- Classify gaps as:
  - **Undertested risk**
  - **Misaligned effort**

For CRITICAL items with no coverage, annotate why: new path / missed coverage on existing path / hard-to-test.

**Cross-agent verification:** Suggest the user run verification with a different agent or model. Cross-agent verification catches blind spots that same-agent testing misses.

**BLOCKING GATE:** Present the gap analysis. "Here are the testing gaps. Want me to produce a targeted testing plan, a QA flow diagram, or both?" After gap analysis, suggest `/goat-plan` to add testing tasks to the current milestone.

## Phase 3 - Targeted Testing Plan

Based on the gaps, produce a focused plan and order by risk.

**Must test (CRITICAL gaps):** table with what breaks and time
**Should test if time allows (MEDIUM gaps):** same format, lower priority
**Safe to skip this round:** low-risk or adequately covered areas
**Misaligned effort:** deprioritise plan cases not mapped to current changes

**CHECKPOINT:** "Targeted testing plan ready. Want a flow diagram for any CRITICAL item?"

## Phase 4 - Flow Diagram

For flow diagrams, use Mermaid flowcharts with 8-15 nodes per diagram, happy path first, then branch points for error states and edge cases.

---

## Audit Mode

Analyse existing code areas with no recent change.

### A1 - Scope
Declare scope and existing test coverage.

### A2 - Coverage Analysis
For each file: test exists? behavior covered or only structure? flag mock-heavy or integration-only blind spots.

### A3 - Gap Report
Produce a risk-ordered table and recommendation list for the coding agent.

**BLOCKING GATE:** Present gap report.

## Regression Guard Mode

After a bug fix: define 1-2 invariants, assess coverage of each invariant, then hand off recommended guard tests to the coding agent.

## Constraints

- goat-test is a testing GAP ANALYSER - it finds mismatches between code changes and testing coverage
- MUST read the actual diff, not just file names - a one-line auth change outranks a 200-line CSS change
- MUST classify every change by risk level with plain-English description of what changed
- MUST trace blast radius for CRITICAL/HIGH changes
- MUST compare changes against existing testing coverage (manual plan, automated tests, or neither)
- MUST find gaps in BOTH directions: undertested risks AND misaligned test effort
- MUST produce "must test / should test / safe to skip" tiers with rationale for skips
- MUST include Verification Integrity section
- MUST NOT generate test code - hand off to the coding agent
- Universal constraints from skill-preamble.md apply.
- Audit mode: MUST include gap report with risk-of-gap ratings
- If flow diagrams are requested, use Mermaid flowcharts (8-15 nodes, happy path first, annotate gap status per node).
- Regression guard: MUST state invariants as human-readable sentences

## Output Format

```markdown
## TL;DR  <!-- what changed, what's at risk, biggest testing gaps -->

## Change Risk Map
| File | Lines Changed | What Changed | Risk | Blast Radius | User-Visible Impact |

## Gap Analysis
### Undertested Risks  <!-- CRITICAL/HIGH changes with no or partial test coverage -->
| Code Change | Risk | Covered By | Gap |

### Misaligned Effort  <!-- test cases that don't match code changes in this branch -->
| Test Case | Maps to Change | Assessment |

## Targeted Testing Plan
### Must test before shipping  <!-- CRITICAL gaps with manual steps, failure symptoms, time -->
### Should test if time allows  <!-- HIGH/MEDIUM gaps -->
### Safe to skip  <!-- with rationale -->

## Verification Integrity

- Changes by: [agent/developer]
- Testing by: [who executes]
- Doer-verifier separation: [FULL / PARTIAL / NONE]

## Regression Guards  <!-- only if fixing a bug -->
## Flow Diagram  <!-- only on request -->
```
