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

## Patterns

_(Promote here when 3+ entries share a theme.)_
