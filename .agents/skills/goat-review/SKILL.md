---
name: goat-review
description: "Structured code review and quality audit with RFC 2119 severity, diff-aware analysis, footgun matching, negative verification, simplify mode for readability, and instruction-file audit mode."
goat-flow-skill-version: "1.0.0"
---
# /goat-review

## Shared Conventions

### Severity & Evidence
- **Severity order:** SECURITY > CORRECTNESS > INTEGRATION > PERFORMANCE > STYLE. Order findings by severity, not by file or discovery order.
- **Evidence:** Every finding needs `file:line`. Tag as OBSERVED (directly verified in code) or INFERRED (deduced - state what direct evidence is missing). Before presenting findings, re-read each cited `file:line` to confirm accuracy. MUST NOT fabricate file paths, function names, or behaviour.

### Human Gates
- **BLOCKING GATE** - agent MUST stop and wait for human decision. Used for: scope approval, phase transitions, final output review. Do NOT auto-advance.
- **CHECKPOINT** - agent presents status and continues unless interrupted. Used for: progress reports, intermediate findings. Format: "Phase N complete. [summary]. Continuing to Phase N+1."

### Adaptive Step 0
1. Read the user's invocation for context already provided
2. For each Step 0 question: if answer is clear from context → **confirm** ("I see [answer]. Correct?"). Otherwise → **ask**
3. If ALL questions answered by invocation → condensed confirmation, proceed
4. If user says "skip Step 0" → confirm understanding, proceed

**Gate rule:** Step 0 MUST end with the agent presenting its understanding and waiting for the user before Phase 1. Auto-detect pre-fills context - it does not replace confirmation. Bare invocation = zero context = ask all structural questions and wait.

### Stuck Protocol
If 3 consecutive reads produce no new signal: (1) present what you have so far, (2) state what you were looking for and didn't find, (3) ask to redirect, narrow scope, or close.

### Ceremony Level
| Complexity | Ceremony |
|------------|----------|
| Hotfix / Small Feature | Skip: closing ceremony, flush rule, footgun annotations, goat-plan Phases 2-3 |
| Standard | Full phases, gates at major decisions |
| System / Infrastructure | Full phases + cross-boundary verification + rollback planning |

**Sub-agent mode:** GATEs become CHECKPOINTs automatically. Step 0 proceeds with auto-detected scope.

### Footgun Fast-Path
If Step 0 footgun check matches a known trap: (1) surface match immediately, (2) offer mitigation path from the entry, (3) still require READ + VERIFY on actual files - footguns are incident records, not executable specs, (4) do NOT skip to implementation on a match alone.

### Flush Protocol
If 10+ tool calls pass without a gate/checkpoint (skip for Hotfix/Small Feature): (1) write 3-sentence status to `.goat-flow/tasks/handoff.md` (what, where, next), (2) if working from a plan/milestone file: tick all completed checkboxes NOW before continuing, (3) ask: continue, compact, or redirect? Counter resets at every BLOCKING GATE, CHECKPOINT, or human message. Handoff file is transient - do not commit.

### Learning Loop
After completing the skill, check if this run uncovered anything worth logging:
- Behavioural mistake → add `## Lesson:` or `## Pattern:` entry to relevant category bucket in `ai-docs/lessons/` or `.goat-flow/lessons/`
- Architectural trap with `file:line` evidence → add `## Footgun:` entry to relevant category bucket in `ai-docs/footguns/` or `.goat-flow/footguns/`
- Route team-wide entries to `ai-docs/`; session-only entries to `.goat-flow/`
- Match entry format to existing entries in the target bucket file. Do not append to a monolithic log or directory README.

### Recovery
When a skill fails mid-execution (context limit, sub-agent dies, tool error):
- Partial completion → identify last completed step (last `[x]` checkbox), resume from next
- Missing artifacts → return to the step that generates them, re-execute
- User wants restart → archive current output to handoff, re-run from Step 0
- User wants to skip → document skip reason in output, proceed to closing
- Sub-agent/autonomous mode → write `.goat-flow/tasks/handoff.md` with enough context to resume

### Working Memory
For tasks exceeding 5 turns: maintain state in `.goat-flow/tasks/todo.md`. If interrupted or compacted, write `.goat-flow/tasks/handoff.md`.

### Autonomy Awareness
Before proposing actions that change files, check the instruction file's Ask First boundaries. If the proposed change crosses a boundary, flag it: "This change touches [boundary]. Proceeding requires approval per Ask First rules."

### Closing Protocol
1. If incomplete → write `.goat-flow/tasks/handoff.md` (Date, Status, Current State, Key Decisions, Errors & Corrections, Learnings, Known Risks, Next Step, Context Files)
2. Check Learning Loop for anything worth logging
3. Write session log to `.goat-flow/logs/sessions/YYYY-MM-DD-slug.md` (what happened, files changed, decisions, learnings)
4. Suggest most relevant next skill (see Chains With)

## When to Use

Use when reviewing a diff, PR, or specific set of changes before they ship.
Also use for systematic quality audits of a codebase area - before releases,
after major changes, or when code quality is uncertain.
Also use for reviewing instruction files for staleness - see modes below.
Also use for improving readability, naming, and code clarity - see Simplify Mode.

**NOT this skill:**
- OWASP-driven security assessment → /goat-security
- Understanding unfamiliar code before changing it → /goat-debug (investigate mode)
- Generating test instructions → /goat-test

## Step 0 - Gather Context

**Structural questions (always ask or confirm):**
1. Which files or area? (or I'll run `git diff` to find recent changes)
2. What's the concern? (performance, security, correctness, readability - or "general review")
3. Diff review or full audit? (I'll auto-detect from whether changes exist)

**Project-specific questions:**
4. Is this responding to a Codex critique, scanner regression, or dashboard bug report?
5. Riskiest change first, or full sweep?

**Escape hatch:** If the user says "just review what changed" or provides minimal info, auto-detect scope from `git diff --stat` and proceed.

**Auto-detect mode (unless user explicitly specifies):**

Scope detection priority: (1) explicit user input, (2) staged changes to target, (3) unstaged changes to target, (4) git diff. If user names a specific file, use THAT - not the full worktree diff. If worktree is very dirty (20+ changed files), ask user to specify scope.

- User names a diff/PR/commits → **Standard mode** (Phases 0-4)
- User names a file AND `git diff --stat` shows changes to it → **Standard mode**
- User names a file AND no changes exist → **Audit mode** (Phases A1-A3)
- Target is **instruction files** → **Instruction mode** (Phases 1i-3i)
- Goal is **readability/cleanup** → **Simplify mode** (Phases S1-S4)
- User explicitly says "audit" or "standard" → respect override

If `ai-docs/coding-standards/code-review.md` exists, load it and apply project-specific
review standards alongside these defaults.

**Footgun check:** If `ai-docs/footguns/` or `.goat-flow/footguns/` exists, read entries mentioning the target area from both locations. If a match is found, present it: "This area has a known issue: [footgun]. Relevant?"

**Contradiction check:** If the user's stated complexity doesn't match the actual scope, flag it:
- "hotfix" but 5+ files affected → likely Standard or System
- "small feature" but crosses 3+ boundaries → likely System
- "quick test" but 20+ functions in target → warn scope is larger than implied
Surface the mismatch, suggest re-classification. Don't silently proceed.

**Before proceeding:** present what you know and what you still need. Wait for the user to confirm scope, mode, and concerns before entering Phase 1.

## Phase 0 - Spec Compliance (conditional)

If `requirements-{feature}.md` or `TODO_*_prime.md` exists for the feature
being reviewed, check each acceptance criterion against the implementation.
If no spec exists, skip this phase - zero cost.

## Phase 1 - Scope Confirmation

**CHECKPOINT:** "I'll review [N] files about [area]. Focus on [concern]?
Anything I should prioritize?"

## Phase 2 - Review

Review the DIFF for issues. Read FULL FILES for context. Do not flag
pre-existing issues as part of this change - note them separately.

**Severity-ordered scan:**
1. Security: injection, auth bypass, secret exposure, permission escalation
2. Correctness: logic errors, edge cases, null handling, race conditions
3. Integration: API contract changes, cross-boundary effects, breaking changes
4. Performance: O(n²) in hot paths, unbounded queries, memory leaks
5. Style: naming, formatting, convention violations (lowest priority)

**Cross-cutting checks:**
- Autonomy tier violations: does this change cross an Ask First boundary?
- Footgun matching: check each finding against `ai-docs/footguns/` and `.goat-flow/footguns/`. Output: `MATCH: [entry]` or `CLEAR`
  *Example:* "Finding: Renamed `UserService` → `AccountService`. Footgun check:
  `ai-docs/footguns/` or `.goat-flow/footguns/` entry 'cross-reference fragility'. MATCH - grep for
  `UserService` across all `.md` files."
- Pattern drift: does new code use a different pattern than existing codebase? Don't assume it's wrong - ask: "Intentional divergence?"
- Downstream impact: "What breaks if this change has a bug?" - map the cascade
- Test execution gaps: tests exist but weren't run against the changed path (different from "no test exists")
- Glossary consistency: if `ai-docs/glossary.md` exists, flag terms used inconsistently in the diff (different name for same concept)

**Self-check:** Before presenting, re-verify `file:line` references for all MUST-fix findings.

## Phase 3 - Present Findings

Use the Output Format template below. Additional required sections for reviews:

**Pre-existing Issues** (not blocking this change):
- [issue] - `file:line` - existed before this diff

**Breaking Changes:**
- [change] - affects: [consumers] - migration needed: [yes/no]

**Test Execution Gaps:**
- [test exists at file:line] but doesn't exercise the changed path because [reason]

**What's Good:**
- Specific positive observations (not generic praise)

**BLOCKING GATE:** Present findings. Offer:
(a) drill into a specific finding
(b) review a related area
(c) check test coverage
(d) something else

## Phase 4 - DoD Gate Check

Verify the project's Definition of Done against this change:
1. `shellcheck` passes on changed `.sh` files
2. No broken cross-references introduced
3. No unapproved boundary changes (see CLAUDE.md Ask First list)
4. Logs updated if VERIFY caught a failure
5. Working notes current
6. Grep old pattern after renames - zero remaining

**CHECKPOINT:** "DoD check: [pass/partial/fail]. [Details]."

## Audit Mode

Activated when Step 0 target is a codebase area (not a specific diff or PR).
Use for systematic quality review - before releases, after major changes,
or when code quality is uncertain.

**Scope guidance:** For >20 files, recommend splitting into focused audits.

**Phase A1 - Scan:**

Scan categories, weighted by audit purpose. GOAT Flow priorities: cross-reference accuracy, rubric-to-fact alignment, template-to-installed drift.

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
Use sub-agents for independent audit areas (e.g., rubric checks, skill templates, setup prompts in parallel).

**Recurrence check:** Before reporting, search `ai-docs/footguns/` and `.goat-flow/footguns/` for entries
in the scanned area. Cross-reference findings with known footguns.

**Phase A2 - Verify & Self-Check:**

**A) Negative verification:** For each finding, attempt to DISPROVE it.
Re-read the code at the cited `file:line`. Look for evidence that contradicts
the finding. The goal is adversarial: "Can I prove this finding is wrong?"
Remove genuine false positives.

*Example:* "Finding: No input validation on `/api/users`. Disproof attempt:
checked middleware chain - `express-validator` at `middleware.ts:12` handles
this route. Result: FALSE POSITIVE, removed."

**B) Fabrication self-check:** Re-verify every `file:line` reference.
Does the file exist? Does the cited line contain what the finding claims?

**Self-diagnostic ratios:**
- If >50% of findings removed → initial scan was too noisy. Note this.
- If >20% removed by fabrication check → agent was confabulating. Flag to user.

**Phase A3 - Rank & Rollup:**

Rank surviving findings by severity (see Shared Conventions above).

**Pattern rollup:** If 3+ findings share a root cause, group them:
"This is a systemic pattern, not [N] separate issues: [pattern description]."

**Out-of-scope findings:** Issues discovered outside the declared scope go
in a separate section - don't bury them, but don't let them dilute the audit.

**Anti-fix discipline:** Audit findings report problems - they don't propose fixes.
Review your output for fix language. Rephrase any recommendations as findings.

**BLOCKING GATE:** Present findings using the Output Format template below. Offer:
(a) drill into a specific finding
(b) expand to a related area
(c) check a specific category more deeply
(d) close the audit

## Instruction Review Mode

Activated when review target is instruction files (CLAUDE.md, AGENTS.md,
ai-docs/coding-standards/, .github/instructions/).

**Phase 1i - Friction Signal Scan:**
Gather observable signals (not conversation memory - agents can't read prior sessions):
- `git log --oneline -20` for recent activity patterns
- Read `ai-docs/lessons/` and `.goat-flow/lessons/` for entries since last instruction update
- Read `ai-docs/footguns/` and `.goat-flow/footguns/` for entries in areas governed by the instructions
- Check `ai-docs/evals/` for recurring failure patterns

**Phase 2i - Instruction Audit:**
For each instruction file, check:
- Missing rules: friction signals suggest a rule that doesn't exist
- Misleading rules: rules that don't match current code behaviour
- Stale rules: references to files/paths that no longer exist
- Outdated rules: rules from a previous architecture that hasn't been updated

**Phase 3i - Propose Edits:**
Present proposals in diff-like format:

| File | Section | Current | Proposed | Why |
|------|---------|---------|----------|-----|
| CLAUDE.md | Ask First | `src/old-path/` | `src/new-path/` | Path renamed in commit abc123 |

MUST NOT auto-edit instruction files. Present for human approval.
MUST NOT edit `ai-docs/footguns/`, `.goat-flow/footguns/`, `ai-docs/lessons/`, or `.goat-flow/lessons/` - those have their own update standards.

---

## Simplify Mode

Activated when goal is readability improvement. **MUST NOT change behavior.**

**Quick path:** For a single function or ≤50 lines: skip S1 scope confirmation.

### Phase S1 - Read & Assess
**Footgun check:** Read `ai-docs/footguns/` and `.goat-flow/footguns/` for target area.

Read target files. Assess: Can a new reader understand without context? Are names self-explanatory? Do comments add value? Is control flow easy to follow?

### Phase S2 - Identify Opportunities
Scan by impact:

| Category | What to look for | Impact |
|----------|-----------------|--------|
| Naming | Cryptic names, abbreviations, misleading names | High |
| Self-documentation | Code that requires comments to explain intent | High |
| Comment quality | Commented-out code, outdated comments, comments restating code | Medium |
| Complexity | Deep nesting (>3 levels), long functions (>40 lines) | Medium |
| Constants | Magic numbers, hardcoded strings | Medium |
| Dead code | Unused imports, unreachable branches | Low |

**The naming test:** "Would a new reader understand this name without reading the implementation?"

**Refactor boundary:** If a rename crosses file boundaries or changes a public API → redirect to /goat-plan (refactor mode).

**Intentional complexity:** Crypto, parsers, performance-critical paths → flag as "complex by design."

### Phase S3 - Self-Check & Present
Re-read each `file:line`. Is the suggested rename safe? Remove findings where evidence doesn't hold.

Present ordered by impact. **BLOCKING GATE:** (a) implement all, (b) implement selectively, (c) drill in, (d) close

### Phase S4 - Implement (if approved)
Apply one file at a time. After each:
1. Grep for old names - zero remaining
2. Check doc cross-references
3. Run tests/linter - behavior unchanged

If tests fail → revert that change, note as unsafe, continue with rest.

## Common Failure Modes

1. **One-shot dump** - agent produces entire review at once instead of conversational drilling. Present findings by severity tier, pause between tiers.
2. **File-order findings** - agent lists findings in the order files were read, not by severity. Force severity ordering.
3. **Footgun skip** - agent skips footgun matching under token pressure. This is where the highest-value findings come from.
4. **Fix proposals in audit mode** - agent recommends solutions instead of reporting findings. The anti-fix discipline check prevents this.
5. **Rubber-stamp self-check** - agent confirms its own findings without re-reading. The fabrication ratio threshold catches this.

## Constraints

<!-- FIXED: Do not adapt these -->
- MUST review the diff for issues, read full files for context
- MUST NOT flag pre-existing issues as part of this change (review mode)
- MUST check each finding against `ai-docs/footguns/` and `.goat-flow/footguns/` (MATCH/CLEAR)
- MUST order findings by severity, not by file or discovery order
- MUST NOT fabricate file paths or function names
- MUST NOT make file edits in review or audit mode - report findings only. Only edit if user explicitly says "implement".
- MUST NOT auto-edit instruction files in instruction review mode
- MUST attempt to disprove each finding in audit mode (negative verification)
- MUST NOT propose fixes in audit mode - audit reports only
- MUST re-verify file:line references in audit self-check
- MUST group 3+ related audit findings as systemic patterns
- MUST NOT change behavior in simplify mode
- MUST NOT rename public/exported APIs without explicit approval (simplify mode)
- Conversational: present findings, then let the human drill in. One-shot dumps miss architectural problems.

## Output Format

```markdown
## TL;DR
<!-- 3 sentences: what was reviewed, what was found, what matters most -->

## Findings

### MUST Fix (Blocking)
- **[title]** - `file:line` - [description]
  Footgun match: MATCH [entry] | CLEAR
  Evidence: OBSERVED | INFERRED (missing: [what direct evidence is needed])

### SHOULD Fix
- **[title]** - `file:line` - [description]

### MAY Fix (Optional)
- **[title]** - `file:line` - [description]

## Pre-existing Issues
<!-- Not blocking this change, but worth noting (review mode) -->
- [issue] - `file:line` - existed before this diff

## Breaking Changes
- [change] - affects: [consumers] - migration needed: [yes/no]

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

- /goat-debug - review/audit finds a specific bug → diagnosis needed
- /goat-plan - review reveals missing requirements → planning needed
- /goat-test - review finds coverage gaps → test plan needed
- /goat-security - review/audit finds security concern → deeper assessment

**Handoff shape:** `{scope, mode, findings_by_severity, breaking_changes, coverage_gaps, patterns}`
