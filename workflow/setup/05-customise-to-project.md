# Step 05 - Customise to Project

Steps 02–04 created the structure. This step makes it useful. Stop following templates and start reading the actual codebase to write project-specific content.

This step should take the longest - it's doing real work, not copying templates.

## Preserve existing docs/ surfaces

If existing documentation surfaces exist (e.g., `docs/footguns.md`, `docs/lessons.md`), migrate content into the canonical `.goat-flow/` directories. Merge with any existing `.goat-flow/` content - do not overwrite. Check for inbound references (README, CI, external links) before deleting originals.

All learning loop surfaces use canonical paths: `.goat-flow/learning-loop/footguns/`, `.goat-flow/learning-loop/lessons/`, `.goat-flow/learning-loop/decisions/`. No path overrides in config.yaml.

## Check recovery references for stale paths

If existing instruction files, settings, or local docs reference legacy task-state files or other stale recovery paths, update them to `.goat-flow/plans/` or `.goat-flow/logs/sessions/`. Recovery uses milestone tracking plus optional local session logs; do not add notification hooks for recovery.

## First: resume project context

- Read the 2-3 most recent files in `.goat-flow/logs/sessions/` if they exist
- Check whether `.goat-flow/learning-loop/footguns/`, `.goat-flow/learning-loop/lessons/`, or `.goat-flow/learning-loop/patterns/` already exist
- Merge with what's there - do not replace existing project memory

## Footguns - find real traps in the code

**Quality standard:** Every footgun entry MUST include:
1. A file-path citation with a grep-friendly semantic anchor (function name, unique string, or `(search: "pattern")`) per ADR-024
2. A non-obvious failure mode (what goes wrong and why it's not obvious)

**Reject these as footguns:**
- "This file changes a lot" - that's git log, not a footgun
- "This module is complex" - that's obvious from reading it
- "Tests are missing for X" - that's a known gap, not a footgun

```bash
grep -rn 'TODO\|FIXME\|HACK\|XXX' src/ --include='*.ts' --include='*.php' --include='*.py' | head -20
git log --oneline -50 | grep -iE 'fix|revert|hotfix|bug|broke|rollback'
```

What looks broken but is intentional? (semi-manual workflows, expected auth failures, known data caveats, deliberately disabled features with re-enablement steps). Route findings to `.goat-flow/learning-loop/footguns/` with a `hallucination-risk: high` tag.

- Read config files for stale project names, hardcoded paths, outdated references
- Write findings to `.goat-flow/learning-loop/footguns/` bucket files with real file paths as evidence
- Every entry MUST cite specific file paths. Use `OBSERVED` when current code or configuration directly demonstrates the trap. Use `ACTUAL_MEASURED` only when the failure was reproduced or measured locally.
- Every bucket file MUST start with YAML frontmatter that includes both `category: <name>` and `last_reviewed: <YYYY-MM-DD, today>`. `goat-flow stats --check` fails without `last_reviewed`. See `workflow/setup/reference/footguns-readme.md` for the exact format.
- Every footgun entry MUST begin with a `**Status:** active | **Created:** YYYY-MM-DD | **Evidence:** <label>` line. Agents scan only entries above `## Resolved Entries`; without `Status` the active/resolved split is undefined.
- Add `hallucination-risk: high` when the area is easy to misread from names alone (generated code, env-specific config, external contracts)
- If `.goat-flow/learning-loop/footguns/` already has entries, MERGE - do not replace

## Lessons - verify incidents surfaced by git history

- Use the same `git log` scan to locate possible incidents, then verify what failed, its root cause, and what should have been done differently.
- A revert, fix, or rollback commit may support a lesson only after the incident and root cause are verified.
- Write verified incidents to `.goat-flow/learning-loop/lessons/` category bucket files.
- Every bucket file MUST start with YAML frontmatter that includes both `category: <name>` and `last_reviewed: <YYYY-MM-DD, today>`. See `workflow/setup/reference/lessons-readme.md` for the exact format.
- If `.goat-flow/learning-loop/lessons/` already has entries, MERGE - do not replace

## Mine git history for candidates

After creating or merging entries backed by direct evidence, mine 2-3 strong candidates from git history:

- High churn may identify an area worth reading.
- Repeated revert, fix, or rollback commits may identify an incident worth reconstructing.
- Files repeatedly committed together may identify coupling worth checking in current code.

History correlations are candidates only. You MUST NOT create a durable footgun or lesson from churn, revert/fix counts, or co-commit frequency alone. Record every unpromoted candidate in the shared setup session log under `History candidates`, including the paths or commits that prompted the investigation.

Promote a candidate only when all three gates pass:

- Current code or configuration supplies a grep-friendly semantic anchor.
- The evidence demonstrates a non-obvious failure mode and verified root cause, not only activity.
- The durable entry changes a future decision by stating what an agent must do differently.

For a promoted footgun, use `OBSERVED` when current code or configuration directly demonstrates the trap. Use `ACTUAL_MEASURED` only when the failure was reproduced or measured locally. A commit hash may support the incident history, but it does not replace the current semantic anchor. If any promotion gate fails, keep the item in the session log instead of weakening the durable evidence standard.

## Patterns - capture memory beyond mistakes

- Ensure `.goat-flow/learning-loop/patterns/` directory exists with `README.md`. Use it for successful repeatable approaches, not incidents

## Regenerate generated learning-loop indexes

After the final footgun, lesson, pattern, or decision edit in this step, regenerate the generated bucket indexes before running the verification gate:

```bash
node --import tsx src/cli/cli.ts index
```

Re-run `goat-flow index` after adding, editing, renaming, or resolving entries; `goat-flow stats --check` fails while the index is stale. See `docs/cli.md` for the lifecycle reference.

## Architecture and code map - make them real

- Review `.goat-flow/architecture.md` and `.goat-flow/code-map.md` created in step 04
- Is it generic or does it reflect the actual system?
- Add: data flows, non-obvious constraints, deliberate trade-offs, deployment topology
- Remove anything that reads like template fill

## Glossary - add real domain terms

- Read the codebase for domain-specific terminology (model names, service names, acronyms)
- Update `.goat-flow/glossary.md` with terms a new contributor would need

## Instruction file - adapt Ask First boundaries

- Review the Ask First section. Are the boundaries specific to this project's real risk areas?
- Are there directories with complex ownership, migration scripts, config that shouldn't be touched?
- Update with real paths and real reasons
- If existing instruction files exist in `.github/instructions/`, reference them from the router table. Keep them as the canonical local-instructions surface.

---

**Verification gate:**
- [ ] Every footgun entry references a real file path in this project
- [ ] Every footgun entry has a grep-friendly semantic anchor, a non-obvious failure mode, and a calibrated `OBSERVED` or `ACTUAL_MEASURED` label
- [ ] Every lesson references a verified incident and root cause; relevant commits support rather than replace that verification
- [ ] No correlation-only history candidate was written as a durable footgun or lesson; unpromoted candidates remain under `History candidates` in the setup session log
- [ ] Generated learning-loop indexes were regenerated after the final learning-loop edit: `node --import tsx src/cli/cli.ts index`
- [ ] Every `.goat-flow/learning-loop/footguns/*.md` and `.goat-flow/learning-loop/lessons/*.md` bucket has `category:` + `last_reviewed:` frontmatter; `node --import tsx src/cli/cli.ts stats --check` exits 0
- [ ] Every `## Footgun:` entry begins with `**Status:**` (active | resolved)
- [ ] `.goat-flow/learning-loop/patterns/README.md` exists
- [ ] If `docs/` surfaces exist, they are referenced (not duplicated) in `.goat-flow/`
- [ ] Recovery references use current paths (not legacy task-state files)
- [ ] If legacy task-state files exist, they are reported in the session log
- [ ] architecture.md mentions at least 2 real components by name
- [ ] glossary.md has at least 3 project-specific terms
- [ ] Ask First boundaries reference real directories that exist on disk

**Progress marker:** Append one line to the shared setup session log:
- `Step 05 complete: project-specific context added`

NEXT: proceed to `06-final-verification.md`
