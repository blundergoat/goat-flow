---
name: goat-review
description: "Structured code review and quality audit with RFC 2119 severity, diff-aware analysis, footgun matching, negative verification, and instruction-file audit mode."
goat-flow-skill-version: "0.9.0"
---
# /goat-review

## Shared Conventions

- **Severity:** SECURITY > CORRECTNESS > INTEGRATION > PERFORMANCE > STYLE
- **Evidence:** Every finding needs `file:line`. Tag as OBSERVED (verified) or INFERRED (state what's missing). MUST NOT fabricate.
- **Gates:** BLOCKING GATE = must stop for human. CHECKPOINT = report status, continue unless interrupted.
- **Adaptive Step 0:** If context already provided, confirm it — don't re-ask. Only hard-block with zero context.
- **Stuck:** 3 reads with no signal → present what you have, ask to redirect.
- **Flush:** 10+ tool calls without a gate/checkpoint → write 3-sentence status to `tasks/scratchpad.md`, ask to continue/compact/redirect.
- **Learning Loop:** Behavioural mistake → `docs/lessons.md`. Architectural trap → `docs/footguns.md`.
- **Closing:** If incomplete → write `tasks/handoff.md`. Check learning loop. Suggest next skill.

## When to Use

Use when reviewing a diff, PR, or specific set of changes before they ship.
Also use for systematic quality audits of a codebase area — before releases,
after major changes, or when code quality is uncertain.
Also use for reviewing instruction files for staleness — see modes below.

**NOT this skill:**
- OWASP-driven security assessment → /goat-security
- Understanding unfamiliar code before changing it → /goat-investigate
- Generating test instructions → /goat-test
- Making code more readable → /goat-simplify

## Step 0 — Gather Context

<!-- ADAPT: Replace illustrative questions with project-specific review concerns -->

**Structural questions (always ask or confirm):**
1. What should I review? (PR, recent commits, specific files, codebase area, instruction files)
2. Any specific concerns? (performance, security, a tricky area, instruction drift)

**Illustrative questions (adapt):**
3. <!-- ADAPT: "Is this responding to external feedback? (Copilot, another agent, team review)" -->
4. Riskiest change first, or full sweep?

**Auto-detect:** Read `git diff --stat` to pre-fill scope. Present: "I see
[N] files changed in [areas]. Reviewing [scope]. Correct?"

**Mode routing:**
- If target is **instruction files** → activate Instruction Review Mode.
- If target is a **codebase area** (not a specific diff) → activate Audit Mode.
- Otherwise → standard diff review (Phases 0-4 below).

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
  *Example:* "Finding: Renamed `UserService` → `AccountService`. Footgun check:
  `docs/footguns.md` entry 'cross-reference fragility'. MATCH — grep for
  `UserService` across all `.md` files."
- Pattern drift: does new code use a different pattern than existing codebase? Don't assume it's wrong — ask: "Intentional divergence?"
- Downstream impact: "What breaks if this change has a bug?" — map the cascade
- Test execution gaps: tests exist but weren't run against the changed path (different from "no test exists")
- Glossary consistency: if `docs/glossary.md` exists, flag terms used inconsistently in the diff (different name for same concept)

**Self-check:** Before presenting, re-verify `file:line` references for all MUST-fix findings.

## Phase 3 — Present Findings

Use the Output Format template below. Additional required sections for reviews:

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

## Audit Mode

Activated when Step 0 target is a codebase area (not a specific diff or PR).
Use for systematic quality review — before releases, after major changes,
or when code quality is uncertain.

**Scope guidance:** For >20 files, recommend splitting into focused audits.

**Phase A1 — Scan:**
<!-- ADAPT: Adjust category list and weights for your project -->

Scan categories, weighted by audit purpose:

| Category | Security audit | Consistency audit | General |
|----------|---------------|-------------------|---------|
| Security | Critical | Medium | High |
| Correctness | High | Medium | High |
| Cross-reference integrity | Medium | Critical | Medium |
| Test coverage | Medium | Low | High |
| Performance | Low | Low | Medium |
| Consistency | Low | Critical | Medium |
| Style | Low | Low | Low |

For each finding, log: category, `file:line`, description, severity.
<!-- ADAPT: Use your agent's parallel execution capability, or scan areas sequentially. -->

**Recurrence check:** Before reporting, search `docs/footguns.md` for entries
in the scanned area. Cross-reference findings with known footguns.

**Phase A2 — Verify & Self-Check:**

**A) Negative verification:** For each finding, attempt to DISPROVE it.
Re-read the code at the cited `file:line`. Look for evidence that contradicts
the finding. The goal is adversarial: "Can I prove this finding is wrong?"
Remove genuine false positives.

*Example:* "Finding: No input validation on `/api/users`. Disproof attempt:
checked middleware chain — `express-validator` at `middleware.ts:12` handles
this route. Result: FALSE POSITIVE, removed."

**B) Fabrication self-check:** Re-verify every `file:line` reference.
Does the file exist? Does the cited line contain what the finding claims?

**Self-diagnostic ratios:**
- If >50% of findings removed → initial scan was too noisy. Note this.
- If >20% removed by fabrication check → agent was confabulating. Flag to user.

**Phase A3 — Rank & Rollup:**

Rank surviving findings by severity (see Shared Conventions above).

**Pattern rollup:** If 3+ findings share a root cause, group them:
"This is a systemic pattern, not [N] separate issues: [pattern description]."

**Out-of-scope findings:** Issues discovered outside the declared scope go
in a separate section — don't bury them, but don't let them dilute the audit.

**Anti-fix discipline:** Audit findings report problems — they don't propose fixes.
Review your output for fix language. Rephrase any recommendations as findings.

**BLOCKING GATE:** Present findings using the Output Format template below. Offer:
(a) drill into a specific finding
(b) expand to a related area
(c) check a specific category more deeply
(d) close the audit

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
4. **Fix proposals in audit mode** — agent recommends solutions instead of reporting findings. The anti-fix discipline check prevents this.
5. **Rubber-stamp self-check** — agent confirms its own findings without re-reading. The fabrication ratio threshold catches this.

## Constraints

<!-- FIXED: Do not adapt these -->
- MUST review the diff for issues, read full files for context
- MUST NOT flag pre-existing issues as part of this change (review mode)
- MUST check each finding against `docs/footguns.md` (MATCH/CLEAR)
- MUST order findings by severity, not by file or discovery order
- MUST NOT fabricate file paths or function names
- MUST NOT make file edits in review or audit mode — report findings only. Only edit if user explicitly says "implement".
- MUST NOT auto-edit instruction files in instruction review mode
- MUST attempt to disprove each finding in audit mode (negative verification)
- MUST NOT propose fixes in audit mode — audit reports only
- MUST re-verify file:line references in audit self-check
- MUST group 3+ related audit findings as systemic patterns
- Conversational: present findings, then let the human drill in. One-shot dumps miss architectural problems.

## Output Format

```markdown
## TL;DR
<!-- 3 sentences: what was reviewed, what was found, what matters most -->

## Findings

### MUST Fix (Blocking)
- **[title]** — `file:line` — [description]
  Footgun match: MATCH [entry] | CLEAR
  Evidence: OBSERVED | INFERRED (missing: [what direct evidence is needed])

### SHOULD Fix
- **[title]** — `file:line` — [description]

### MAY Fix (Optional)
- **[title]** — `file:line` — [description]

## Pre-existing Issues
<!-- Not blocking this change, but worth noting (review mode) -->
- [issue] — `file:line` — existed before this diff

## Breaking Changes
- [change] — affects: [consumers] — migration needed: [yes/no]

## Test Execution Gaps
- [test at file:line] doesn't exercise changed path because [reason]

## Patterns
<!-- If 3+ findings share a root cause, group as systemic issue (audit mode) -->

## What's Good
<!-- Specific positive observations, not generic praise -->

## What I Didn't Examine
<!-- Files in blast radius not reviewed/audited and why -->
```

Output should be compatible with standard GitHub/GitLab PR review templates.

## Chains With

- /goat-debug — review/audit finds a specific bug → diagnosis needed
- /goat-plan — review reveals missing requirements → planning needed
- /goat-test — review finds coverage gaps → test plan needed
- /goat-security — review/audit finds security concern → deeper assessment
- /goat-simplify — review finds readability issues → simplification needed

**Handoff shape:** `{scope, mode, findings_by_severity, breaking_changes, coverage_gaps, patterns}`
