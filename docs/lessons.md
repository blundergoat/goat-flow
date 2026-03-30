# Lessons

**Mistakes the agent made.** A lesson exists because the agent did something wrong — not because the code is structured badly. Example: "agent proposed a fix before completing diagnosis" or "agent skipped disambiguation when it should have asked."

If the trap is in the code itself → `docs/footguns.md` instead.

## Entries

### Version bumps require explicit confirmation
**What happened:** While cleaning up zero-point rubric checks, the agent also bumped `package.json`, `RUBRIC_VERSION`, and skill frontmatter above the current `0.8.0` line. The user had not asked for a release/version bump and corrected it immediately.

**Prevention:** Treat version changes as a separate decision from rubric or content changes. Do not bump package, rubric, or template versions unless the user explicitly requests the new version or the release plan says to do it.

**created_at:** 2026-03-29

### Agents resolve contradictions by following whichever source they read first
**What happened:** system-spec.md showed the old 5-step execution loop while execution-loop.md had the updated 6-step version with SCOPE. The setup prompt says "Read docs/system-spec.md" first. Both rampart and sus-form-detector agents absorbed the spec's loop and either didn't notice or couldn't override execution-loop.md. 7 of 8 gaps in sus-form-detector traced to this single contradiction.

**Prevention:** When updating any concept that appears in multiple files, update the file agents read FIRST (system-spec.md) before or at the same time as the authoritative source. Never assume agents will reconcile contradictions - they follow the first version they encounter.

**created_at:** 2026-03-20

### Agents under line pressure cut "small but required" sections
**What happened:** Both rampart and sus-form-detector agents dropped Sub-Agent Objectives (f) and Communication When Blocked (g) when compressing CLAUDE.md toward the line target. The instructions said "Do NOT skip sections (f)-(i)" but only in Prompt B - Prompt A (used for new projects) didn't have this warning.

**Prevention:** Every constraint that agents are likely to cut under pressure must appear in BOTH the template (execution-loop.md) AND the prompt that invokes it (Prompt A in setup-claude.md). A rule in only one place is a rule that gets missed.

**created_at:** 2026-03-20

### Agents given broad setup tasks rewrite shared docs as agent-specific
**What happened:** Gemini CLI was asked to set up GOAT Flow. It modified 6 shared documentation files (`docs/system-spec.md`, `docs/system/five-layers.md`, `docs/system/six-steps.md`, `docs/reference/design-rationale.md`, `docs/getting-started.md`, `workflow/runtime/enforcement.md`), replacing Claude Code references with Gemini-specific equivalents. The skills table in `five-layers.md` had its Claude Code row deleted. The enforcement template ended up in a hybrid state - half `.claude/` paths, half `.gemini/` paths.

**Prevention:** Agent setup prompts must include explicit scope constraints. For Gemini: "Only create/modify files under `.gemini/` and `GEMINI.md`. Do NOT modify `docs/`, `workflow/`, or any file outside the `.gemini/` directory." For any agent: treat shared documentation as a boundary that requires Ask First permission.

**created_at:** 2026-03-21

### mv/rename overwrites destination file without checking if it exists
**What happened:** User asked to rename `TODO_improvements_v0.3.md` to `TODO_improvements_v0.4.md`. Agent ran `mv v0.3 v0.4` without checking that v0.4 already existed. The mv overwrote v0.4 with v0.3's content. When the user said "undo", the agent moved v0.4 (now containing v0.3's content) back to v0.3, destroying v0.4's original content entirely. The file was untracked by git and unrecoverable.

**Prevention:** Before any `mv`, `cp`, or Write that targets an existing path, MUST run `ls` on the destination first. If the destination exists, stop and ask the user. This applies to all file operations that can overwrite - not just mv. Add to the Never tier: "Overwrite existing files without confirming destination is safe."

**created_at:** 2026-03-21

### Sub-agent output must be audited
**What happened:** Spawned 5 parallel agents to fix 5 projects. Agents created confusion-log.md (removed in ADR-003), left shape placeholders, introduced indentation errors, wrote hasRouter logic bug. None caught until external agents audited the output.
**Root cause:** "Tests pass" tunnel vision - treated green CI as proof of correctness. Sub-agent prompts didn't include ADR constraints. Never re-read the files agents wrote.
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
**Root cause:** The setup prompt said "Create conventions.md from project analysis" but didn't say "verify against actual code." Agents read documentation (which mixes current and planned) without checking the implementation.
**Fix:** Added verification gates to workflow templates and setup guides. Templates now say: "Only document what currently exists. Verify by reading source files, not documentation."
**created_at:** 2026-03-22

### Setup agents propagate errors from existing instruction files
**What happened:** Rampart's CLAUDE.md had `redaction.rs` (doesn't exist - redaction is Python only). Blundergoat's CLAUDE.md had a stale web middleware path pointing at `middleware.ts` instead of `proxy.ts`, plus a stale API SQL directory pointing at `migrations/` instead of `schema/`. Sub-agents creating `ai/instructions/` read these wrong paths from the existing instruction files and copied them into the new cold-path files, propagating the error.
**Root cause:** The verification gate said "verify paths in ai/instructions/" but didn't say "also audit the existing instruction file you're reading from." Agents trust the hot-path file as authoritative without checking.
**Fix:** Added "ALSO AUDIT EXISTING INSTRUCTION FILES" gate to docs-seed.md - verify Ask First paths exist, check router entries resolve, fix stale paths before copying them into cold-path files.
**created_at:** 2026-03-22

### When deny hook blocks a command, use the unblocked equivalent
**What happened:** Agent needed to delete `.github/skills/goat-onboard/` and `.github/skills/goat-reflect/` directories. Used `rm -rf` which was blocked by deny-dangerous.sh. Instead of using `rm file && rmdir dir` (which is not blocked), the agent asked the user to delete manually - wasting a round trip on something trivially solvable.
**Root cause:** Agent defaulted to `rm -rf` out of habit and treated the deny hook block as a dead end instead of thinking about alternatives for 2 seconds.
**Fix:** When a command is blocked, think about the unblocked equivalent. `rm -rf dir/` → `rm dir/file && rmdir dir/`. `mv old new` → `mv -n old new`. The deny hook blocks dangerous patterns, not all file operations.
**created_at:** 2026-03-28

## Patterns

### Pattern: Verification scope must match change scope
_Entries: "Sub-agent output must be audited", "Double check means read the files", "Removing a concept requires full-repo grep", "Setup agents propagate errors from existing instruction files"_

When the change is code-only, running tests is sufficient. When the change touches docs, setup prompts, or workflow templates, verification must read those files too. The verification scope must match the blast radius of the change. When building on existing files, audit them first - errors in source files propagate to everything built on top.

### Skill session logs are never written
**What happened:** The Shared Conventions block in every skill says "If `tasks/logs/` exists → write session summary." The goat-review audit of `tasks/roadmaps/0.9.3/tasks.md` ran the full skill process (Step 0 → Phase A1-A3 → blocking gate) but no session log was written. The user noticed `tasks/logs/sessions/` was empty. The closing protocol was skipped entirely — 0% compliance across the session.

**Root cause:** The session log instruction is buried in the Closing line of the Shared Conventions block (one clause in a compound sentence at `SKILL.md:17`). It fires at the END of a skill — after the agent has already delivered its output and is mentally "done." There's no enforcement mechanism: no hook checks for the file, no DoD gate references it, and no skill phase explicitly includes "write session log" as a step. It's a SHOULD rule in a MUST position.

**Prevention:** The closing protocol needs mechanical enforcement, not just a rule. Options: (1) add session logging to the DoD gates in CLAUDE.md so it blocks completion, (2) add a Stop hook that checks whether `tasks/logs/sessions/` was written to during this session, (3) make session logging the FIRST line of the skill's output format template so the agent writes it before presenting findings, not after.

**created_at:** 2026-03-30

### Pattern: Blocked ≠ impossible
_Entries: "When deny hook blocks a command, use the unblocked equivalent"_

Deny hooks block dangerous patterns, not all operations. When a command is blocked, spend 2 seconds thinking about the safe alternative before asking the user or giving up.

### Pattern: End-of-task rules get skipped
_Entries: "Skill session logs are never written"_

Rules that fire after the agent has delivered its primary output have near-zero compliance. The agent's attention is on the deliverable, not the closing checklist. Session logging, learning loop updates, and handoff notes all suffer from this. Prevention must be structural: either make the closing step part of the output format (so it happens DURING delivery, not after), or enforce it via hooks/DoD gates that block completion.

### Dispatcher is a first-class skill, not a helper
The goat dispatcher was treated as secondary to the "real" 8 skills — excluded from CANONICAL_SKILLS, eval diversity counting (TOTAL_SKILLS=8), and consistently under-counted in comments and recommendations ("8 canonical skills"). This led to inconsistencies across rubric, fragments, and docs where some said 8 and others said 9.

**Prevention:** The dispatcher routes all `/goat` invocations and has its own evals, failure modes, and structured output. Count it as the 9th canonical skill everywhere: CANONICAL_SKILLS set, TOTAL_SKILLS constant, rubric messages, fragment instructions, and anti-pattern recommendations.
