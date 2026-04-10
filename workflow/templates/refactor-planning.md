# Refactor Planning

> **What this is:** A reference template for planning code restructuring (renames,
> extractions, moves, interface changes). Use when you need a structured approach
> to a refactor that crosses multiple files or boundaries.
>
> The goat dispatcher can read this template and walk through it interactively
> when you describe a restructuring task.

Use when restructuring existing code: renames, extractions, moves, interface changes.

## Phase R1 — Blast Radius Analysis

Before changing anything:

1. **Declare scope** (include non-code surfaces — `.md`, `.json`, `.yaml`, config, manifests):
   - Files to change: [list]
   - Files that might break: [list]
   - Non-code surfaces affected: [docs, config, manifests — these often reference renamed code]
   - Files out of scope: [list]

2. **Read both sides of every interface being changed:**
   If renaming: read every caller AND the definition.
   If moving: read every importer AND the module.
   If changing an API: read server AND all clients.

3. **Auto-detect scope:** `rg -n 'OldName' -g '*.ts' -g '*.py' -g '*.go' -g '*.php' -g '*.rs' | wc -l`

4. **Check autonomy tiers:** Flag Ask First boundary crossings.

5. **Check footguns:** Read `.goat-flow/footguns/` for affected area.

**BLOCKING GATE:** "This refactor touches [N] files across [M] boundaries. Blast radius: [assessment]. Proceed?"

## Phase R2 — Execution Sequence

Plan the execution order. Do NOT change everything at once.

**For renames:**
1. Change definition → grep verify → update consumers one-by-one → grep verify
2. Update documentation: `grep -rn 'OldName' --include='*.md'`

**For extractions:**
1. Create new module → move code → update imports → verify old location clean → update consumers

**For interface changes:**
1. Add new interface alongside old → migrate consumers → remove old → grep verify

**Checkpoints:** Run lint/test after EACH step.

## Phase R3 — Verification Plan

Comprehensive verification after all changes:

1. **Absence check:** Grep for every old name/path. Include: `*.md`, `*.json`, `*.yml`. Target: ZERO remaining.
2. **Import/reference check:** Build or typecheck.
3. **Doc cross-reference check:** Grep instruction files and docs for old paths.
4. **Test verification:** Run full test suite.

**BLOCKING GATE:** Present verification plan:
- Old references remaining: [target: 0]
- Build/typecheck: [expected: pass]
- Tests: [expected: pass]
- Doc references: [expected: updated]

"Approve plan and start executing?"
