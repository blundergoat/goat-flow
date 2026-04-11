# Step 05 — Customise to Project

Steps 02–04 created the structure. This step makes it useful. Stop following templates and start reading the actual codebase to write project-specific content.

This step should take the longest — it's doing real work, not copying templates.

## Preserve existing docs/ surfaces — bridge via config

If existing documentation surfaces exist, use them as canonical and point config.yaml to them:

- If `docs/footguns.md` exists → set `footguns: { path: "docs/footguns.md" }` in config.yaml. Do NOT create `.goat-flow/footguns/` with separate content.
- If `docs/lessons.md` exists → set `lessons: { path: "docs/lessons.md" }` in config.yaml. Do NOT create `.goat-flow/lessons/` with separate content.
- Same logic for: decisions, architecture, code-map
- If the existing surface is a directory (e.g., `docs/decisions/`), set the path accordingly

The instruction file's router table must point to the canonical path from config, not to BOTH old and new locations.

If the user explicitly wants consolidation into `.goat-flow/`, migrate content (merge, don't overwrite), update all references, and delete the original. Check for inbound references (README, CI, external links) before deleting.

## Check compaction hooks for stale paths

If existing `settings.json` notification hooks reference `tasks/todo.md`, `tasks/handoff.md`, or other legacy paths, update them to `.goat-flow/tasks/` or `.goat-flow/logs/sessions/`. Stale hook paths cause broken context recovery after compaction.

## First: resume project context

- Read the 2-3 most recent files in `.goat-flow/logs/sessions/` if they exist
- Check whether `.goat-flow/footguns/`, `.goat-flow/lessons/`, or `.goat-flow/patterns.md` already exist
- Merge with what's there — do not replace existing project memory

## Config sync — populate structured context

Update `.goat-flow/config.yaml` with real project data:

- `toolchain:` — populate `test`, `lint`, `build`, `package`, and `format` arrays from the commands you detected in Step 02 or from the actual manifests/scripts
- `ask_first:` — copy the instruction file's real Ask First boundaries into structured `{ path, reason }` entries

Use empty arrays only when the project truly has no command for that slot. Do not invent tool commands.

## Footguns — find real traps in the code

```bash
grep -rn 'TODO\|FIXME\|HACK\|XXX' src/ --include='*.ts' --include='*.php' --include='*.py' | head -20
git log --oneline -50 | grep -iE 'fix|revert|hotfix|bug|broke|rollback'
```

- Read config files for stale project names, hardcoded paths, outdated references
- Write findings to `.goat-flow/footguns/` bucket files with real file paths as evidence
- Every entry MUST cite specific file paths. Use `ACTUAL_MEASURED` evidence labels.
- Add `hallucination-risk: high` when the area is easy to misread from names alone (generated code, env-specific config, external contracts)
- If `.goat-flow/footguns/` already has entries, MERGE — do not replace

## Lessons — extract from git history

- Use the same `git log` scan — for each incident, what was the root cause and what should have been done differently?
- Write to `.goat-flow/lessons/` category bucket files
- If `.goat-flow/lessons/` already has entries, MERGE — do not replace

## Auto-seed the learning loop from strong git signals

After creating or merging the manual entries, seed 2-3 strong candidates from git history:

- High churn (5+ commits) → candidate footgun
- 2+ revert/fix/rollback commits touching the same area → candidate lesson
- 3+ files repeatedly co-committed → candidate coupling footgun

Rules:

- Evidence format for auto-seeded entries is **file path + commit hash**, not fabricated line numbers. `src/auth.ts` is valid evidence. `src/auth.ts:65` pointing at a closing brace is fabricated evidence — never cite a line number unless you have verified it shows the actual trap.
- If you cannot identify the specific code that demonstrates the trap, use the file path without a line number. Path-only evidence is honest; fake line numbers are not.
- Mark each generated entry with `**Source:** git history (auto-seeded)`
- Only seed strong signals. Skip noisy one-off commits

Examples:

- `` `src/auth/login.ts` (12 commits in 30 days, last: abc123) ``
- `` `src/api/users.ts` + `src/db/users.ts` (co-committed 4 times, last: def456) ``

## Patterns — capture memory beyond mistakes

- Ensure `.goat-flow/patterns.md` exists. Use it for successful repeatable approaches, not incidents

## Architecture and code map — make them real

- Review `.goat-flow/architecture.md` and `.goat-flow/code-map.md` created in step 04
- Is it generic or does it reflect the actual system?
- Add: data flows, non-obvious constraints, deliberate trade-offs, deployment topology
- Remove anything that reads like template fill

## Glossary — add real domain terms

- Read the codebase for domain-specific terminology (model names, service names, acronyms)
- Update `.goat-flow/glossary.md` with terms a new contributor would need

## Instruction file — adapt Ask First boundaries

- Review the Ask First section. Are the boundaries specific to this project's real risk areas?
- Are there directories with complex ownership, migration scripts, config that shouldn't be touched?
- Update with real paths and real reasons
- Keep `.goat-flow/config.yaml` `ask_first:` in sync with the final instruction file wording
- If existing instruction files exist in `.github/instructions/` or `ai/instructions/`, reference them from config.yaml and the router table. Do NOT create thin copies in `.goat-flow/coding-standards/` — the existing files are likely better than anything setup can generate

---

**Verification gate:**
- [ ] `.goat-flow/config.yaml` has real `toolchain:` and `ask_first:` entries
- [ ] Every footgun entry references a real file path in this project
- [ ] Every lesson references a real git commit or incident
- [ ] Auto-seeded entries use file path + commit hash evidence (no fabricated line numbers) and include `**Source:** git history (auto-seeded)`
- [ ] `.goat-flow/patterns.md` exists
- [ ] If `docs/` surfaces exist, they are referenced (not duplicated) in `.goat-flow/`
- [ ] Compaction hooks reference current paths (not legacy `tasks/todo.md`)
- [ ] If `tasks/todo.md` or `tasks/handoff.md` exist as stale legacy files, they are reported in the session log
- [ ] architecture.md mentions at least 2 real components by name
- [ ] glossary.md has at least 3 project-specific terms
- [ ] Ask First boundaries reference real directories that exist on disk

**Progress marker:** Append one line to the shared setup session log:
- `Step 05 complete: project-specific context added`

NEXT: proceed to `06-final-verification.md`
