---
name: goat-review
description: "Structured code review with severity-ordered scan, negative verification, and footgun matching."
goat-flow-skill-version: "1.1.0"
---
# /goat-review

## Shared Conventions

Read `.goat-flow/skill-preamble.md` for shared conventions.
On full-depth, also read `.goat-flow/skill-conventions.md`.

## When to Use

Use when reviewing a diff, PR, or set of changes. Also for quality audits of a codebase area.

**Boundary:** goat-review owns code quality, style, correctness. goat-security owns threat models, compliance, CVEs, auth boundaries. If you find a security issue, flag it and suggest `/goat-security`.

**NOT this skill:** OWASP assessment → /goat-security. Understanding code → /goat-debug. Generating tests → /goat-test. Planning milestones → /goat-plan. Feature briefs → dispatcher Planning Route.

## Step 0 - Choose Depth

> "Reviewing [X] -- diff review (quick), or area audit with DoD cross-checks (full)?"

- If user already says "quick" or "full", confirm and continue.
- If arriving from the dispatcher with depth already chosen, skip the depth question.
- If vague, ask one follow-up covering: which files, what concerns you, diff or audit.
- Auto-detect scope: (1) explicit input, (2) staged changes, (3) unstaged changes, (4) git diff. If 20+ changed files, ask user to narrow.

**Footgun check:** Read `.goat-flow/footguns/` for entries mentioning the target area. Present matches.

## Diff Review (Quick)

Read the diff and present findings by severity; keep moving unless user interrupts.

### Severity-Ordered Scan

Read full files for context. Ignore pre-existing issues.

- Security: injection, auth bypass, secret exposure, permission escalation
- Correctness: logic errors, edge cases, null/race errors
- Integration: API contract changes, boundary effects, regressions
- Performance: hot-path complexity and memory growth
- Style: naming/formatting/conventions (lowest priority)

**Cross-cutting:** check each finding against `.goat-flow/footguns/`; if a direct match exists, include it. Omit footgun tags when none match.

**Negative verification:** For each finding, attempt to DISPROVE it. Re-read `file:line`, look for contradicting evidence. Remove false positives. Re-verify every `file:line` reference exists.

**BLOCKING GATE:** Present findings using Output Format below, then pause for human to drill in.

**DoD gate:** (1) tests/lint pass (2) no broken cross-references (3) no unapproved boundary changes (4) grep old pattern after renames.

## Area Audit (Full)

When target is a codebase area (not a diff). For >20 files, recommend splitting.

Scan using severity ordering above. Run negative verification and group linked findings as systemic patterns. Propose findings only, no fixes.

**BLOCKING GATE:** Present findings and pause. If calibration is uncertain, consider `/goat-sbao`.

## Constraints

- MUST review diff for issues, read full files for context
- MUST NOT flag pre-existing issues as part of this change
- MUST check each finding against `.goat-flow/footguns/` for matches. Omit footgun tags when no direct match is found.
- MUST order findings by severity, not by file or discovery order
- Universal constraints from skill-preamble.md apply.
- MUST NOT make file edits in review or audit mode unless user says "implement"
- MUST attempt to disprove each finding (negative verification)
- MUST group 3+ related findings as systemic patterns
- Conversational: present findings, then let human drill in

## Output Format

```markdown
## TL;DR  <!-- what was reviewed, found, matters most -->
## Findings
### MUST Fix - **[title]** `file:line` [desc] | Footgun: [entry or none] | Evidence: OBSERVED/INFERRED
### SHOULD Fix - **[title]** `file:line` [desc]
### MAY Fix - **[title]** `file:line` [desc]
## Pre-existing Issues | Breaking Changes | What's Good | What I Didn't Examine
```
