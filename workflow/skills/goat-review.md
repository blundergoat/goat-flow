---
name: goat-review
description: "Structured code review with RFC 2119 severity, diff-aware analysis, footgun matching, and instruction-file audit mode."
goat-flow-skill-version: "0.7.0"
---
# /goat-review

> Follows [shared-preamble.md](shared-preamble.md) for severity scale, evidence standard, gates, and learning loop.
> Uses the [Findings Report](output-skeletons.md#findings-report) output skeleton.

## When to Use

Use when reviewing a diff, PR, or specific set of changes before they ship.
Also use for reviewing instruction files (CLAUDE.md, ai/instructions/) for
staleness or drift — see Instruction Review Mode below.

**NOT this skill:**
- Codebase-wide quality sweep (no specific diff) → /goat-audit
- OWASP-driven security assessment → /goat-security
- Understanding unfamiliar code before changing it → /goat-investigate
- Generating test instructions → /goat-test

## Step 0 — Gather Context

<!-- ADAPT: Replace illustrative questions with project-specific review concerns -->

**Structural questions (always ask or confirm):**
1. What should I review? (PR, recent commits, specific files, instruction files, or "everything since last milestone")
2. Any specific concerns? (performance, security, a tricky area, instruction drift)

**Illustrative questions (adapt):**
3. <!-- ADAPT: "Is this responding to external feedback? (Copilot, another agent, team review)" -->
4. Riskiest change first, or full sweep?

**Auto-detect:** Read `git diff --stat` to pre-fill scope. Present: "I see
[N] files changed in [areas]. Reviewing [scope]. Correct?"

If review target is **instruction files** → activate Instruction Review Mode.

If `ai/instructions/code-review.md` exists, load it and apply project-specific
review standards alongside these defaults.

## Phase 0 — Spec Compliance (conditional)

If `requirements-{feature}.md` or `TODO_*_prime.md` exists for the feature
being reviewed, check each acceptance criterion against the implementation.
If no spec exists, skip this phase — zero cost.

## Phase 1 — Scope Confirmation

**CHECKPOINT:** "I'll review [N] files about [area]. Focus on [concern]?
Anything I should prioritize?"

## Phase 2 — Review

Review the DIFF for issues. Read FULL FILES for context. Do not flag
pre-existing issues as part of this change — note them separately.

**Severity-ordered scan:**
1. Security: injection, auth bypass, secret exposure, permission escalation
2. Correctness: logic errors, edge cases, null handling, race conditions
3. Integration: API contract changes, cross-boundary effects, breaking changes
4. Performance: O(n²) in hot paths, unbounded queries, memory leaks
5. Style: naming, formatting, convention violations (lowest priority)

**Cross-cutting checks:**
- Autonomy tier violations: does this change cross an Ask First boundary?
- Footgun matching: check each finding against `docs/footguns.md`. Output: `MATCH: [entry]` or `CLEAR`
- Pattern drift: does new code use a different pattern than existing codebase? Don't assume it's wrong — ask: "Intentional divergence?"
- Downstream impact: "What breaks if this change has a bug?" — map the cascade
- Test execution gaps: tests exist but weren't run against the changed path (different from "no test exists")

**Self-check:** Before presenting, re-verify `file:line` references for all MUST-fix findings.

## Phase 3 — Present Findings

Use the Findings Report skeleton. Additional required sections for reviews:

**Pre-existing Issues** (not blocking this change):
- [issue] — `file:line` — existed before this diff

**Breaking Changes:**
- [change] — affects: [consumers] — migration needed: [yes/no]

**Test Execution Gaps:**
- [test exists at file:line] but doesn't exercise the changed path because [reason]

**What's Good:**
- Specific positive observations (not generic praise)

**BLOCKING GATE:** Present findings. Offer:
(a) drill into a specific finding
(b) review a related area
(c) check test coverage
(d) something else

## Phase 4 — DoD Gate Check

Verify the project's Definition of Done against this change:
<!-- ADAPT: Replace with your project's actual DoD gates -->
1. Tests/lint pass on changed files
2. No broken cross-references introduced
3. No unapproved boundary changes
4. Logs updated if VERIFY caught a failure
5. Working notes current
6. Grep old pattern after renames — zero remaining

**CHECKPOINT:** "DoD check: [pass/partial/fail]. [Details]."

## Instruction Review Mode

Activated when review target is instruction files (CLAUDE.md, AGENTS.md,
ai/instructions/, .github/instructions/).

**Phase 1i — Friction Signal Scan:**
Gather observable signals (not conversation memory — agents can't read prior sessions):
- `git log --oneline -20` for recent activity patterns
- Read `docs/lessons.md` for entries since last instruction update
- Read `docs/footguns.md` for entries in areas governed by the instructions
- Check `agent-evals/` for recurring failure patterns

**Phase 2i — Instruction Audit:**
For each instruction file, check:
- Missing rules: friction signals suggest a rule that doesn't exist
- Misleading rules: rules that don't match current code behaviour
- Stale rules: references to files/paths that no longer exist
- Outdated rules: rules from a previous architecture that hasn't been updated

**Phase 3i — Propose Edits:**
Present proposals in diff-like format:

| File | Section | Current | Proposed | Why |
|------|---------|---------|----------|-----|
| CLAUDE.md | Ask First | `src/old-path/` | `src/new-path/` | Path renamed in commit abc123 |

MUST NOT auto-edit instruction files. Present for human approval.
MUST NOT edit `docs/footguns.md` or `docs/lessons.md` — those have their own update standards.

## Common Failure Modes

1. **One-shot dump** — agent produces entire review at once instead of conversational drilling. Present findings by severity tier, pause between tiers.
2. **File-order findings** — agent lists findings in the order files were read, not by severity. Force severity ordering.
3. **Footgun skip** — agent skips footgun matching under token pressure. This is where the highest-value findings come from.

## Constraints

<!-- FIXED: Do not adapt these -->
- MUST review the diff for issues, read full files for context
- MUST NOT flag pre-existing issues as part of this change
- MUST check each finding against `docs/footguns.md` (MATCH/CLEAR)
- MUST order findings by severity, not by file or discovery order
- MUST NOT fabricate file paths or function names
- MUST NOT auto-edit instruction files in instruction review mode
- Conversational: present findings, then let the human drill in. One-shot dumps miss architectural problems.

## Output Format

Use the Findings Report skeleton from `output-skeletons.md`.
Add Pre-existing Issues, Breaking Changes, Test Execution Gaps, and What's Good sections.
Output should be compatible with standard GitHub/GitLab PR review templates.

## Chains With

- /goat-audit — review surfaces systemic issues → broader sweep needed
- /goat-debug — review finds a specific bug → diagnosis needed
- /goat-plan — review reveals missing requirements → planning needed
- /goat-test — review finds coverage gaps → test plan needed
- /goat-security — review finds security concern → deeper assessment

**Handoff shape:** `{diff_scope, findings_by_severity, breaking_changes, coverage_gaps}`
