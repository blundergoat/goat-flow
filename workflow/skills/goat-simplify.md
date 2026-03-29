---
name: goat-simplify
description: "Code readability improvement through naming analysis, self-documentation assessment, comment audit, and complexity reduction."
goat-flow-skill-version: "1.0.0"
---
# /goat-simplify

## Shared Conventions

- **Severity:** SECURITY > CORRECTNESS > INTEGRATION > PERFORMANCE > STYLE
- **Evidence:** Every finding needs `file:line`. Tag as OBSERVED (verified) or INFERRED (state what's missing). MUST NOT fabricate.
- **Gates:** BLOCKING GATE = must stop for human. CHECKPOINT = report status, continue unless interrupted.
- **Adaptive Step 0:** If context already provided, confirm it — don't re-ask. Bare invocation with no arguments = zero context = ask structural questions and WAIT. Auto-detect pre-fills — it does not replace confirmation.
- **Stuck:** 3 reads with no signal → present what you have, ask to redirect.
- **Flush:** 10+ tool calls without a gate/checkpoint → write 3-sentence status to `tasks/scratchpad.md`, ask to continue/compact/redirect.
- **Learning Loop:** Behavioural mistake → `docs/lessons.md`. Architectural trap → `docs/footguns.md`.
- **Closing:** If incomplete → write `tasks/handoff.md`. Check learning loop. Suggest next skill. If `tasks/logs/` exists → write session summary.

## When to Use

Use when code works correctly but is hard to read, follow, or maintain.
The goal is making code speak for itself — easier for humans to understand
and for future agents to work with.

**NOT this skill:**
- Bug diagnosis → /goat-debug
- Cross-file restructuring or public API renames → /goat-refactor
- Quality audit for correctness/security → /goat-review
- Understanding unfamiliar code → /goat-investigate

**Quick path:** For a single function or ≤50 lines: skip Phase 1 scope
confirmation. Read, suggest, implement if approved.

## Step 0 — Gather Context

<!-- ADAPT: Replace illustrative questions with your project's common simplification targets -->

**Structural questions (always ask or confirm):**
1. What code to simplify? (file, module, function, or area)
2. Why? (readability cleanup, onboarding prep, before handoff, tech debt reduction)

**Illustrative questions (adapt):**
3. <!-- ADAPT: "What's the audience? (new contributors, future agents, code reviewers)" -->
4. <!-- ADAPT: "Any naming conventions or style guide? Check linter config (.eslintrc, .rubocop.yml, etc.) if unsure." -->

**Auto-detect:** If a linter/formatter config exists, read it to understand
the project's naming and style conventions before suggesting changes.

**Before proceeding:** present what you know (target files, purpose, conventions) and what you still need. Wait for the user to confirm before entering Phase 1.

## Phase 1 — Read & Assess

**Footgun check:** Read `docs/footguns.md` for entries mentioning the target
area. Present any matches: "This area has a known trap: [entry]. Keep this in mind."

Read the target files. For each, assess readability:
- Can a new reader understand what this does without external context?
- Are names (variables, functions, classes, files) self-explanatory?
- Do comments add value or restate the obvious?
- Is the control flow easy to follow?
- Are there magic numbers, cryptic abbreviations, or misleading names?

**CHECKPOINT:** "I've read [N] files. Main readability issues are in [areas].
Proceeding to analysis."

## Phase 2 — Identify Opportunities

Scan for these categories, ordered by impact on readability:

<!-- ADAPT: Adjust thresholds for your language/framework. Python and Go
tolerate longer functions. JSX hits 3 nesting levels naturally. -->

| Category | What to look for | Impact |
|----------|-----------------|--------|
| Naming | Cryptic names, abbreviations, misleading names, inconsistent conventions | High |
| Self-documentation | Code that requires comments to explain what it does, unclear intent | High |
| Comment quality | Commented-out code, TODO without context, outdated comments, comments restating code | Medium |
| Complexity | Deep nesting (>3 levels), long functions (>40 lines), boolean parameters, flag arguments | Medium |
| Constants | Magic numbers, hardcoded strings that should be named | Medium |
| Dead code | Unused imports, unreachable branches, unused variables | Low |

For each finding: `file:line`, current state, suggested improvement, why it
helps readability.

**The naming test:** For every rename suggestion, answer: "Would a new reader
understand this name without reading the implementation?" If not, try again.

*Example:* "`processData(d, f, true)` at `utils.ts:47` — rename to
`validateUserInput(rawInput, schema, { strict: true })`. Current names
require reading the function body to understand what `d`, `f`, and `true` mean."

**MUST NOT change behavior.** Every suggestion must be semantics-preserving.
If a simplification might change behavior, flag it and skip.

**Refactor boundary:** If a rename affects files beyond the target scope or
changes a public/exported API, flag it and recommend `/goat-refactor` instead
of implementing directly. Local/private renames stay in this skill.

**Intentional complexity:** Crypto implementations, parsers, performance-critical
hot paths, and state machines may be complex by design. Flag as "complex by
design — do not simplify" rather than suggesting changes that could introduce
correctness or performance regressions.

**Comments: what vs why.** Prefer renaming over comments that explain *what* code
does. Use comments for explaining *why* a non-obvious approach was chosen —
that context can't be captured in a name.

## Phase 3 — Self-Check & Present

**Self-check before presenting:** Re-read each cited `file:line`. Does the
code actually look the way the finding claims? Is the suggested rename safe
(not exported, not used in other files beyond scope)? Remove findings where
the evidence doesn't hold up.

Present findings ordered by impact level.

For naming changes: show current → suggested with reasoning.
For structure changes: show current pattern → simplified pattern.

**BLOCKING GATE:** Present findings. Offer:
(a) implement all suggestions
(b) implement selectively — tell me which ones
(c) drill into a specific finding
(d) close without changes

## Phase 4 — Implement (if approved)

Apply changes one file at a time. After each file:
1. Grep for old names to verify zero remaining references
2. Check doc cross-references if anything was renamed
<!-- ADAPT: Replace with your project's test/lint commands -->
3. Run the project's tests and linter to confirm behavior unchanged

**If tests fail after a change:** revert that change, remove it from the
approved list, note it as unsafe, and proceed with remaining changes.

**CHECKPOINT:** "[N] files simplified. Tests: [pass/fail]. Any remaining files to address?"

## Common Failure Modes

1. **Behavior change disguised as simplification** — agent renames a public API or changes error handling. The semantics-preserving constraint prevents this.
2. **Over-commenting** — agent adds comments explaining what code does instead of renaming. The "renaming over commenting" rule prevents this.
3. **Bikeshedding** — agent spends turns on style preferences (single quotes vs double) instead of meaningful readability improvements. The impact ordering prevents this.
4. **Cross-file rename creep** — agent implements a rename that touches 12 files, crossing into refactor territory. The refactor boundary check prevents this.

## Constraints

<!-- FIXED: Do not adapt these -->
- MUST NOT change behavior — readability improvements only
- MUST NOT add comments that explain what code does — rename instead
- MUST use comments only for explaining why (non-obvious design decisions)
- MUST re-verify file:line references before presenting (self-check)
- MUST verify behavior unchanged after implementation (tests + linter)
- MUST NOT fabricate file paths or function names
- MUST NOT rename public/exported APIs without explicit approval
- MUST flag cross-scope renames and redirect to /goat-refactor
- MUST check doc cross-references after renames
- MUST check docs/footguns.md for the target area before suggesting changes

## Output Format

```markdown
## TL;DR
<!-- 3 sentences: what was assessed, main readability issues, suggested approach -->

## Findings

### High Impact
- **[title]** — `file:line`
  Current: [current code/name]
  Suggested: [improvement]
  Why: [how this helps readability]

### Medium Impact
- **[title]** — `file:line`
  Current: [current code/name]
  Suggested: [improvement]
  Why: [how this helps readability]

### Low Impact
- **[title]** — `file:line` — [description]
  Why: [brief reasoning]

## Summary
| Category | Count | Files affected |
|----------|-------|---------------|
| Naming | ... | ... |
| Self-documentation | ... | ... |
| Comment quality | ... | ... |
| Complexity | ... | ... |
| Constants | ... | ... |
| Dead code | ... | ... |

## What I Didn't Examine
<!-- Files/areas skipped and why -->
```

## Chains With

- /goat-refactor — rename crosses file/API boundary → needs cross-file refactoring
- /goat-review — simplified code needs review before merging
- /goat-test — after simplification, verify behavior unchanged

**Handoff shape:** `{scope, findings_by_impact, renames_applied, behavior_verified}`
