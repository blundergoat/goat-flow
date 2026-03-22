# Lessons

Behavioural mistakes made by the agent during this project. Each entry describes what went wrong and how to avoid repeating it.

## Entries

### Agents resolve contradictions by following whichever source they read first
**What happened:** system-spec.md showed the old 5-step execution loop while execution-loop.md had the updated 6-step version with SCOPE. The setup prompt says "Read docs/system-spec.md" first. Both rampart and sus-form-detector agents absorbed the spec's loop and either didn't notice or couldn't override execution-loop.md. 7 of 8 gaps in sus-form-detector traced to this single contradiction.

**Prevention:** When updating any concept that appears in multiple files, update the file agents read FIRST (system-spec.md) before or at the same time as the authoritative source. Never assume agents will reconcile contradictions — they follow the first version they encounter.

**created_at:** 2026-03-20

### Agents under line pressure cut "small but required" sections
**What happened:** Both rampart and sus-form-detector agents dropped Sub-Agent Objectives (f) and Communication When Blocked (g) when compressing CLAUDE.md toward the line target. The instructions said "Do NOT skip sections (f)-(i)" but only in Prompt B — Prompt A (used for new projects) didn't have this warning.

**Prevention:** Every constraint that agents are likely to cut under pressure must appear in BOTH the template (execution-loop.md) AND the prompt that invokes it (Prompt A in setup-claude.md). A rule in only one place is a rule that gets missed.

**created_at:** 2026-03-20

### Agents given broad setup tasks rewrite shared docs as agent-specific
**What happened:** Gemini CLI was asked to set up GOAT Flow. It modified 6 shared documentation files (`docs/system-spec.md`, `docs/system/five-layers.md`, `docs/system/six-steps.md`, `docs/reference/design-rationale.md`, `docs/getting-started.md`, `workflow/runtime/enforcement.md`), replacing Claude Code references with Gemini-specific equivalents. The skills table in `five-layers.md` had its Claude Code row deleted. The enforcement template ended up in a hybrid state — half `.claude/` paths, half `.gemini/` paths.

**Prevention:** Agent setup prompts must include explicit scope constraints. For Gemini: "Only create/modify files under `.gemini/` and `GEMINI.md`. Do NOT modify `docs/`, `workflow/`, or any file outside the `.gemini/` directory." For any agent: treat shared documentation as a boundary that requires Ask First permission.

**created_at:** 2026-03-21

### mv/rename overwrites destination file without checking if it exists
**What happened:** User asked to rename `TODO_improvements_v0.3.md` to `TODO_improvements_v0.4.md`. Agent ran `mv v0.3 v0.4` without checking that v0.4 already existed. The mv overwrote v0.4 with v0.3's content. When the user said "undo", the agent moved v0.4 (now containing v0.3's content) back to v0.3, destroying v0.4's original content entirely. The file was untracked by git and unrecoverable.

**Prevention:** Before any `mv`, `cp`, or Write that targets an existing path, MUST run `ls` on the destination first. If the destination exists, stop and ask the user. This applies to all file operations that can overwrite — not just mv. Add to the Never tier: "Overwrite existing files without confirming destination is safe."

**created_at:** 2026-03-21

### Sub-agent output must be audited
**What happened:** Spawned 5 parallel agents to fix 5 projects. Agents created confusion-log.md (removed in ADR-003), left shape placeholders, introduced indentation errors, wrote hasRouter logic bug. None caught until external agents audited the output.
**Root cause:** "Tests pass" tunnel vision — treated green CI as proof of correctness. Sub-agent prompts didn't include ADR constraints. Never re-read the files agents wrote.
**Fix:** After spawning sub-agents, grep for removed patterns and read key output files. Include ADR constraints in every sub-agent prompt.
**created_at:** 2026-03-22

### "Double check" means read the files, not re-run the tests
**What happened:** User asked to "double check" multiple times. Each time, re-ran typecheck + tests + scan. Never caught stale shape references, documentation inconsistencies, or content quality issues that three external agents found immediately by reading the actual files.
**Root cause:** Interpreted verification as "run the pipeline" instead of "read what changed." Tests only cover what they test.
**Fix:** Added removed-pattern check to preflight. "Double check" should include: (1) run pipeline, (2) grep removed patterns, (3) read 3-5 changed files for content accuracy.
**created_at:** 2026-03-22

### Removing a concept requires full-repo grep, not just code grep
**What happened:** Shape removed from scanner code (ADR-002) but `[APP / LIBRARY / SCRIPT COLLECTION]` survived in 9 setup/workflow/doc files. Confusion-log removed (ADR-003) but agent recreated it because the constraint wasn't in the prompt.
**Root cause:** Grepped `src/` and `test/` but not `setup/`, `workflow/`, `docs/`.
**Fix:** Preflight now enforces removed patterns across all live directories. ADR removals must grep the entire repo.
**created_at:** 2026-03-22

### Sub-agents write aspirational content as current state
**What happened:** Sub-agents creating ai/instructions/ files read docs/architecture.md and roadmap docs, then wrote coding guidelines that included planned features (Playwright browser, SQLite persistence, redaction.rs) as if they were current. Three external agent audits found 5+ inaccuracies per project.
**Root cause:** The setup prompt said "Create base.md from project analysis" but didn't say "verify against actual code." Agents read documentation (which mixes current and planned) without checking the implementation.
**Fix:** Added verification gates to workflow templates and setup guides. Templates now say: "Only document what currently exists. Verify by reading source files, not documentation."
**created_at:** 2026-03-22

### Setup agents propagate errors from existing instruction files
**What happened:** Rampart's CLAUDE.md had `redaction.rs` (doesn't exist — redaction is Python only). Blundergoat's CLAUDE.md had `apps/web/src/middleware.ts` (doesn't exist — project uses `proxy.ts`) and `apps/api/sql/migrations/` (actual path is `sql/schema/`). Sub-agents creating `ai/instructions/` read these wrong paths from the existing instruction files and copied them into the new cold-path files, propagating the error.
**Root cause:** The verification gate said "verify paths in ai/instructions/" but didn't say "also audit the existing instruction file you're reading from." Agents trust the hot-path file as authoritative without checking.
**Fix:** Added "ALSO AUDIT EXISTING INSTRUCTION FILES" gate to docs-seed.md — verify Ask First paths exist, check router entries resolve, fix stale paths before copying them into cold-path files.
**created_at:** 2026-03-22

## Patterns

### Pattern: Verification scope must match change scope
_Entries: "Sub-agent output must be audited", "Double check means read the files", "Removing a concept requires full-repo grep", "Setup agents propagate errors from existing instruction files"_

When the change is code-only, running tests is sufficient. When the change touches docs, setup prompts, or workflow templates, verification must read those files too. The verification scope must match the blast radius of the change. When building on existing files, audit them first — errors in source files propagate to everything built on top.
