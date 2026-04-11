---
name: goat-test
description: "Testing gap analyser. Compares code changes against testing coverage to find undertested risks and misaligned test effort."
goat-flow-skill-version: "1.1.0"
---
# /goat-test

## Shared Conventions

Read `.goat-flow/skill-preamble.md` for shared conventions.
On full-depth, also read `.goat-flow/skill-conventions.md`.
If unavailable, use these essentials:
- Severity: SECURITY > CORRECTNESS > INTEGRATION > PERFORMANCE > STYLE
- Evidence: every finding MUST include file or file:line, tag OBSERVED vs INFERRED
- Learning loop: check .goat-flow/lessons/ and .goat-flow/footguns/ after completion
- Gates: BLOCKING GATE = stop and wait. CHECKPOINT = continue unless interrupted.

## When to Use

goat-test is a **testing gap analyser**. It compares what changed in the code against what's being tested and finds the mismatches.

**What it does:**
- Reads the diff (feature branch vs main, or staged changes)
- Understands what's risky in those changes
- Compares against existing testing coverage (manual test plans, automated tests, or nothing)
- Finds gaps in BOTH directions: undertested risks and wasted test effort
- Produces a prioritised "test THIS, skip THAT" recommendation

**What it does NOT do:**
- Write test code — ask the coding agent
- Run tests — just run them
- Generate test infrastructure — ask the coding agent

**Invoke when:**
- Feature branch is ready for testing and you want to know what to focus on
- QA has a test plan and you want to verify it covers the actual code changes
- You're reviewing a PR and want to know what the tests miss
- You want to find manual testing gaps before a release
- You need a QA handoff artifact (flow diagram, risk matrix, manual test plan)

**NOT this skill:** Running tests → just run them. Debugging test failures → /goat-debug. Code quality → /goat-review. Planning milestones → /goat-plan. Feature briefs → dispatcher Planning Route.

## Step 0 — Intake

**Mode detection — confirm, don't silently decide:**

| Changes exist? | User said... | Mode |
|---------------|-------------|------|
| Yes | nothing specific | Suggest: "Changes detected in [files]. Analyse the changes, or audit the broader area?" |
| Yes | "audit" / "coverage" / "gaps" | Audit mode |
| Yes | "test this" / "verify" / "what's risky" | Standard mode |
| No | nothing specific | Audit mode |
| No | names specific files | Audit mode scoped to those files |

Confirm: "Running [mode] on [scope]. Correct?"

**Gather:**
1. **What changed?** Read the diff. Auto-detect: `git diff main...HEAD --stat` or `git diff --cached --stat` or user-specified files.
2. **Is there an existing test plan?** Ask: "Do you have a manual test plan, test cases, or QA checklist for these changes? Paste it, point me to a file, or say 'none' and I'll work from the code alone."
3. **Who's the audience?** Developer (pre-PR self-check), tester (QA planning), or both?
4. **Footgun check:** Read `.goat-flow/footguns/` for entries mentioning the changed area. Known traps = higher testing priority.
5. **Toolchain check:** Read `.goat-flow/config.yaml` `toolchain:` section. Use these commands for test/lint/build — not generic guesses.

If arriving from the dispatcher with context already gathered, confirm and proceed.

**No existing tests detected:** If the project has no test files, the risk analysis still applies. Flag coverage as "NONE" for all files. Note: "This project has no automated tests. All verification falls to human and AI reviewers."

**CHECKPOINT:** "Analysing [N] changed files against [existing test plan / no test plan]. Audience: [dev/tester/both]. Proceed?"

## Phase 1 — Change Risk Analysis

Read every changed file. For each, understand WHAT changed and WHY it's risky.

**Diff analysis — not just file names.** Read the actual diff, not just `--stat`. A one-line change to an auth check is CRITICAL. A 200-line change to a CSS file is LOW.

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

## Phase 2 — Gap Analysis

Compare the Change Risk Map against testing coverage. Find mismatches in both directions.

### If a test plan was provided:

Read the test plan. For each test case, map it to a specific code change:

| Test Case | Maps to Change | Covers Risk? | Gap Assessment |
|-----------|---------------|-------------|---------------|

Then check the reverse — for each CRITICAL/HIGH code change, is there a test case that covers it?

| Code Change | Risk | Covered by Test Case? | Gap |
|------------|------|---------------------|-----|

**Two types of gaps:**
- **Undertested risk:** CRITICAL/HIGH code change with no matching test case, or a test case that tests the area but not the actual risk
- **Misaligned effort:** Test cases that don't map to any code change in this branch — effort spent testing things that haven't changed

### If no test plan was provided:

Check automated test coverage instead:
1. Do test files exist for the changed source files?
2. If yes: do the tests cover the SPECIFIC behaviour that changed, or just the file in general?
3. If no: flag as untested

Then produce the same gap table, using automated tests instead of manual test cases.

### Cross-reference check:

For CRITICAL items with no coverage (manual or automated):
- Is this a new code path (no prior coverage expected)?
- Is this a change to an existing path that existing tests SHOULD catch but don't?
- Is this a change that's INHERENTLY hard to test (timing, external dependencies, visual)?

**Multi-model verification:** When possible, use a DIFFERENT model for verification than the coding agent. Cross-model verification catches model-specific blind spots.

**BLOCKING GATE:** Present the gap analysis. "Here are the testing gaps. Want me to produce a targeted testing plan, a QA flow diagram, or both?" After gap analysis, suggest `/goat-plan` to add testing tasks to the current milestone.

## Phase 3 — Targeted Testing Plan

Based on the gaps from Phase 2, produce a focused testing plan. This is the "test THIS, skip THAT" output.

**Must test (CRITICAL gaps):**

| What to test | Why it matters | How to test it | What "broken" looks like | Time |
|-------------|---------------|---------------|------------------------|------|

**Should test if time allows (MEDIUM gaps):**
Same format, lower priority.

**Safe to skip this round:**
For each LOW-risk change or well-covered area, state why.

**Misaligned effort (if test plan was provided):**
Test cases from the provided plan that don't match any code change in this branch — deprioritise unless regression-testing.

**Time budget:** Total estimated time for "must test" items.

**CHECKPOINT:** Present the plan. "Targeted testing plan ready. Want a flow diagram for any of the CRITICAL items?"

## Phase 4 — Flow Diagram

Triggered when the user asks for a visual flow, or when Phase 3 identifies a CRITICAL user-visible flow that benefits from visual representation.

Build a Mermaid flowchart:
- **Actors:** USER actions vs SYSTEM responses (use subgraphs)
- **Happy path first:** Main success flow as the spine
- **Branch points:** Error states, edge cases, validation failures — especially those identified as gaps in Phase 2
- **Highlight undertested branches:** Mark nodes that correspond to CRITICAL gaps: `style node fill:#ff6b6b`
- **Size:** 8-15 nodes per diagram. Split into sub-flows if larger.
- **Labels:** Action language ("User clicks Submit") not implementation language ("POST /api/submit")

After the diagram, produce a testing annotation table:

| Node | Test Action | What "pass" looks like | Edge cases | Gap status |
|------|------------|----------------------|------------|-----------|

**CHECKPOINT:** "Flow diagram and annotations ready. Want me to expand any branch or produce diagrams for other flows?"

---

## Audit Mode

Analyse test coverage of an existing area with no recent changes.

### A1 — Scope
Declare: files/directories to audit, existing test files.

**CHECKPOINT:** "Auditing test coverage for [area]. [N] source files, [M] test files. Proceed?"

### A2 — Coverage Analysis
For each source file: does a test exist? Does it test behaviour or just existence? Rate risk of each gap.

Cross-check: integration tests, mock-heavy tests hiding real failures, implementation-detail tests.

### A3 — Gap Report

| File | Test File | What's Tested | What's NOT Tested | Risk of Gap |
|------|-----------|--------------|-------------------|------------|

**Recommendations:** Ordered by risk. State WHAT to test and WHY — the coding agent handles the writing.

**BLOCKING GATE:** Present gap report.

## Regression Guard Mode

After a bug fix, identify what needs locking down.

1. **Identify the fix:** What changed? Which code path was broken?
2. **Define the invariant:** State as a sentence: "[component] must [behaviour] when [condition]."
3. **Assess existing coverage:** Is this invariant tested? If yes, why didn't the test catch the bug?
4. **Recommend the guard:** What test type (unit/integration/e2e), what it should assert. Link to footgun/lesson entry.
5. **Hand off:** "Ask the coding agent to write a test that asserts: [invariant]."

**Output:** Bug, root cause, invariant, existing coverage gap, recommended test, footgun link.

## Constraints

- goat-test is a testing GAP ANALYSER — it finds mismatches between code changes and testing coverage
- MUST read the actual diff, not just file names — a one-line auth change outranks a 200-line CSS change
- MUST classify every change by risk level with plain-English description of what changed
- MUST trace blast radius for CRITICAL/HIGH changes
- MUST compare changes against existing testing coverage (manual plan, automated tests, or neither)
- MUST find gaps in BOTH directions: undertested risks AND misaligned test effort
- MUST produce "must test / should test / safe to skip" tiers with rationale for skips
- MUST include time estimates for manual testing items
- MUST include Verification Integrity section
- MUST NOT generate test code — hand off to the coding agent
- Universal constraints from skill-preamble.md apply.
- Audit mode: MUST include gap report with risk-of-gap ratings
- Flow diagrams: MUST use action language not implementation language
- Flow diagrams: MUST stay within 8-15 nodes, split if larger
- Flow diagrams: MUST highlight undertested nodes from gap analysis
- Flow diagrams: MUST include testing annotation table with gap status per node
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

## Time Budget  <!-- total estimated minutes for "must test" items -->

## Verification Integrity
- Changes by: [agent/developer]
- Gap analysis by: [this invocation]
- Testing by: [who executes]
- Doer-verifier separation: [FULL / PARTIAL / NONE]

## Regression Guards  <!-- only if fixing a bug -->
## Flow Diagram  <!-- only on request -->
```
