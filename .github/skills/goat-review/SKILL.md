---
name: goat-review
description: "Structured code review with severity-ordered scan, negative verification, and footgun matching."
goat-flow-skill-version: "1.1.0"
---
# /goat-review

## Shared Conventions

Read `.goat-flow/skill-conventions.md` for full shared conventions.
If unavailable, use these essentials:
- Severity: SECURITY > CORRECTNESS > INTEGRATION > PERFORMANCE > STYLE
- Evidence: every finding MUST include file:line, tag OBSERVED vs INFERRED
- Learning loop: check .goat-flow/lessons/ and .goat-flow/footguns/ after completion
- Gates: BLOCKING GATE = stop and wait. CHECKPOINT = continue unless interrupted.
- Task tracking: tick checkboxes immediately when completed, not at the end.

## When to Use

Use when reviewing a diff, PR, or set of changes. Also for quality audits of a codebase area.

**Boundary:** goat-review owns code quality, style, correctness. goat-security owns threat models, compliance, CVEs, auth boundaries. If you find a security issue, flag it and suggest `/goat-security`.

**NOT this skill:** OWASP assessment -> /goat-security. Understanding code -> /goat-debug. Generating tests -> /goat-test.

## Step 0 - Choose Depth

> "Reviewing [X] -- quick review, or full review with audit depth and DoD cross-checks?"

- If user already says "quick" or "full", confirm and continue.
- If arriving from the dispatcher with depth already chosen, skip the depth question.
- If vague, ask one follow-up covering: which files, what concerns you, diff or audit.
- Auto-detect scope: (1) explicit input, (2) staged changes, (3) unstaged changes, (4) git diff. If 20+ changed files, ask user to narrow.

If `.goat-flow/coding-standards/code-review.md` exists, load and apply it.

**Footgun check:** Read `.goat-flow/footguns/` for entries mentioning the target area. Present matches.

## Quick Review Path

Read diff or named files. Present findings using severity ordering and footgun matching. Keep moving unless user interrupts.

## Full Review Path

**CHECKPOINT:** "I'll review [N] files about [area]. Focus on [concern]?"

### Severity-Ordered Scan

Review the DIFF for issues. Read FULL FILES for context. Do not flag pre-existing issues.

1. **Security:** injection, auth bypass, secret exposure, permission escalation
2. **Correctness:** logic errors, edge cases, null handling, race conditions
3. **Integration:** API contract changes, cross-boundary effects, breaking changes
4. **Performance:** O(n^2) in hot paths, unbounded queries, memory leaks
5. **Style:** naming, formatting, convention violations (lowest priority)

**Cross-cutting:** footgun match each finding (`MATCH: [entry]` or `CLEAR`), check for pattern drift ("Intentional divergence?"), map downstream impact.

**Negative verification:** For each finding, attempt to DISPROVE it. Re-read `file:line`, look for contradicting evidence. Remove false positives. Re-verify every `file:line` reference exists.

**BLOCKING GATE:** Present findings using Output Format below, then pause for human to drill in.

**DoD gate:** (1) tests/lint pass (2) no broken cross-references (3) no unapproved boundary changes (4) grep old pattern after renames.

## Audit Mode

When target is a codebase area (not a diff). For >20 files, recommend splitting.

Scan using severity ordering above. For each finding, run negative verification and fabrication self-check. Group 3+ findings sharing a root cause as systemic patterns. Report problems only -- do not propose fixes.

**BLOCKING GATE:** Present findings, then pause.

## Instruction Review Mode

For reviewing instruction files (CLAUDE.md, .goat-flow/coding-standards/, etc.). Gather signals from `git log`, `.goat-flow/lessons/`, `.goat-flow/footguns/`. Check for missing, misleading, stale, or outdated rules. Present proposals in a table for human approval. MUST NOT auto-edit instruction files.

## Simplify Mode

For readability improvement. MUST NOT change behavior. Scan for: cryptic names, code needing comments to explain intent, deep nesting (>3 levels), magic numbers, dead code. Present ordered by impact. If a rename crosses file boundaries or changes a public API, redirect to /goat-plan. Apply changes one file at a time only after human approval; grep for old names after each rename.

## Constraints

- MUST review diff for issues, read full files for context
- MUST NOT flag pre-existing issues as part of this change
- MUST check each finding against `.goat-flow/footguns/` (MATCH/CLEAR)
- MUST order findings by severity, not by file or discovery order
- MUST NOT fabricate file paths or function names
- MUST NOT make file edits in review or audit mode unless user says "implement"
- MUST attempt to disprove each finding (negative verification)
- MUST group 3+ related findings as systemic patterns
- Conversational: present findings, then let human drill in

## Output Format

```markdown
## TL;DR  <!-- what was reviewed, found, matters most -->
## Findings
### MUST Fix - **[title]** `file:line` [desc] | Footgun: MATCH/CLEAR | Evidence: OBSERVED/INFERRED
### SHOULD Fix - **[title]** `file:line` [desc]
### MAY Fix - **[title]** `file:line` [desc]
## Pre-existing Issues | Breaking Changes | What's Good | What I Didn't Examine
```

## Chains With

- /goat-debug - review finds a bug -> diagnosis needed
- /goat-plan - review reveals missing requirements -> planning needed
- /goat-test - review finds coverage gaps -> test plan needed
- /goat-security - review finds security concern -> deeper assessment

**Handoff shape:** `{scope, mode, findings_by_severity, breaking_changes, coverage_gaps, patterns}`
