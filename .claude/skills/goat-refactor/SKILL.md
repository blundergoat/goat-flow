---
name: goat-refactor
description: "Structured cross-file refactoring with blast radius analysis, both-sides-first reading, rename verification, and absence checks."
goat-flow-skill-version: "0.9.0"
---
# /goat-refactor

## Shared Conventions

- **Severity:** SECURITY > CORRECTNESS > INTEGRATION > PERFORMANCE > STYLE
- **Evidence:** Every finding needs `file:line`. Tag as OBSERVED (verified) or INFERRED (state what's missing). MUST NOT fabricate.
- **Gates:** BLOCKING GATE = must stop for human. CHECKPOINT = report status, continue unless interrupted.
- **Adaptive Step 0:** If context already provided, confirm it — don't re-ask. Only hard-block with zero context.
- **Stuck:** 3 reads with no signal → present what you have, ask to redirect.
- **Learning Loop:** Behavioural mistake → `docs/lessons.md`. Architectural trap → `docs/footguns.md`.
- **Closing:** If incomplete → write `tasks/handoff.md`. Check learning loop. Suggest next skill. If `tasks/logs/` exists → write session summary.

## When to Use

Use for systematic refactoring: cross-file renames, module extraction, interface
changes, namespace restructuring, or any change that touches multiple files and
could break references.

**NOT this skill:**
- Diagnosing a bug → /goat-debug
- Planning a new feature → /goat-plan
- Reviewing a completed change → /goat-review
- Investigating code to understand it → /goat-investigate

## Step 0 — Gather Context

**Structural questions (always ask or confirm):**
1. What are we refactoring? (rename, extract, move, restructure, interface change)
2. What's the blast radius? (single module, cross-module, cross-boundary)

**Illustrative questions (adapt):**
3. <!-- ADAPT: "Which boundaries does this cross? (e.g., API contract, database schema, shared types)" -->
4. <!-- ADAPT: "Are there consumers outside this repo? (npm package, API clients, documentation)" -->

**Auto-detect:** If the user describes a rename, grep for the old name to
estimate scope: `grep -rn 'OldName' --include='*.{ts,py,go,php,rs}' | wc -l`

## Phase 1 — Scope & Impact

Before changing anything:

1. **Declare scope:**
   - Files to change: [list]
   - Files that might break: [list]
   - Files explicitly out of scope: [list]

2. **Read both sides of every interface being changed:**
   If renaming a function, read every caller AND the definition.
   If moving a module, read every importer AND the module itself.
   If changing an API, read the server AND all clients.

3. **Check autonomy tiers:** If any change crosses an Ask First boundary, flag it.

4. **Check footguns:** Read `docs/footguns.md` for entries mentioning the
   affected area. Present matches.

**BLOCKING GATE:** "This refactor touches [N] files across [M] boundaries.
Blast radius: [assessment]. Proceed?"

## Phase 2 — Execute (one layer at a time)

Do NOT change everything at once. Change one side of the interface, verify,
then change the other side.

**For renames:**
1. Change the definition (source of truth)
2. Verify: `grep -rn 'OldName' --include='*.{ts,py,go,php,rs}'` — should find only consumers
3. Update consumers one by one
4. Verify: grep again — should find zero hits
5. Update documentation: `grep -rn 'OldName' --include='*.md'`

**For extractions:**
1. Create the new module/file
2. Move code to new location
3. Update imports in the old location
4. Verify: old location doesn't reference moved code
5. Update external consumers

**For interface changes:**
1. Add the new interface alongside the old one
2. Migrate consumers to new interface
3. Remove old interface
4. Verify: grep for old interface — zero hits

After EACH step, run the project's lint/test commands to catch breakage early.

**CHECKPOINT:** "Step [N] complete. [summary]. Continuing."

## Phase 3 — Verify

Comprehensive verification after all changes:

1. **Absence check:** Grep for every old name/path across the entire repo.
   Include: `*.md`, `*.ts`, `*.py`, `*.go`, `*.php`, `*.rs`, `*.json`, `*.yml`
   Target: ZERO remaining references to old names.

2. **Import/reference check:** Run the project's build or typecheck.
   Broken imports surface immediately.

3. **Doc cross-reference check:** Grep documentation files for old paths.
   Include: `CLAUDE.md`, `AGENTS.md`, `docs/*.md`, `ai/instructions/*.md`,
   `.github/instructions/*.md`, `README.md`

4. **Test verification:** Run the project's test suite.

5. **Multi-agent vocabulary check:** If shared docs exist (docs that multiple
   agents read), verify you didn't introduce agent-specific vocabulary.

**BLOCKING GATE:** Present verification results:
- Old references remaining: [count] (target: 0)
- Build/typecheck: [pass/fail]
- Tests: [pass/fail]
- Doc references updated: [yes/no]

## What I Didn't Refactor

List files/areas that reference the old names but were deliberately skipped:
- [file] — reason: [out of scope / different repo / generated code / etc.]

## Common Failure Modes

1. **Change both sides at once** — breaks everything simultaneously with no way to isolate the cause. One side at a time.
2. **Forget documentation** — code is renamed but CLAUDE.md still references the old path. The doc cross-reference check catches this.
3. **Miss a consumer** — grep only the obvious file types. Include `.md`, `.json`, `.yml`, not just source code.

## Constraints

<!-- FIXED: Do not adapt these -->
- MUST read both sides of every interface before changing either side
- MUST grep for old names after EVERY rename — not just at the end
- MUST change one layer at a time, verify between layers
- MUST check documentation references, not just source code
- MUST run build/typecheck after changes — don't trust grep alone
- MUST NOT fabricate file paths or function names
- MUST flag Ask First boundary crossings before proceeding

## Output Format

```markdown
## Refactoring Summary

**Scope:** [what was refactored]
**Files changed:** [count]
**Boundaries crossed:** [list]

## Verification Results
| Check | Result |
|-------|--------|
| Old references remaining | 0 ✓ / [N] remaining |
| Build/typecheck | pass ✓ / fail |
| Tests | pass ✓ / fail |
| Documentation updated | yes ✓ / [N] stale refs |

## What I Didn't Refactor
- [file] — [reason]

## Remaining Work
- [any follow-up needed]
```

## Chains With

- /goat-review — refactoring done, needs review before merge
- /goat-test — refactoring done, need verification plan
- /goat-investigate — need to understand code before refactoring

**Handoff shape:** `{scope, files_changed, verification_results, remaining_references}`
