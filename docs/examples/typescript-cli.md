# Case Study: goat-flow (TypeScript CLI + Markdown Docs)

## Project Profile

- **Stack:** TypeScript CLI (scanner), Markdown documentation, Bash maintenance scripts
- **Agents:** Claude Code, Codex, Gemini CLI
- **Setup time:** ~2 days for full system (Phases 0-2)

## Before

No workflow system. Ad-hoc rules in a long CLAUDE.md that mixed project-specific guidance with general engineering advice. Agents fabricated file paths, skipped verification, and repeated mistakes across sessions. No enforcement hooks -- dangerous commands relied on ~70% rule compliance.

## After

Three instruction files, 8 skills across 3 locations, enforcement hooks, and a learning loop.

**Key files created:**

| File | Lines | Purpose |
|------|-------|---------|
| CLAUDE.md | 119 | Claude Code runtime (6-step loop, autonomy, DoD, router) |
| AGENTS.md | 110 | Codex runtime (same loop, Codex-specific boundaries) |
| GEMINI.md | 86 | Gemini CLI runtime (compressed format, same loop) |

**Skills (8 skills x 3 locations = 24 SKILL.md files):**

- `.claude/skills/goat-*/` -- Claude Code skills
- `.agents/skills/goat-*/` -- Shared skills (Codex + Gemini CLI)
- `workflow/skills/` -- Canonical skill templates

Cold-path coding guidelines in `ai/instructions/` (conventions.md, code-review.md, git-commit.md) loaded on demand, keeping instruction files under the 120-line target.

## What the Scanner Caught

The 84-check scanner validates GOAT Flow structure across all three agents. Results after full setup:

- Claude Code: A (100%)
- Codex: A (100%)
- Gemini CLI: A (100%)

Specific catches during development:

1. **Stale cross-references** -- `docs/getting-started.md:162` referenced `workflow/_reference/system-spec.md` (old path). The file had moved to `docs/system-spec.md`. Scanner flagged it; grep confirmed 4 broken references across docs.

2. **Concept duplication drift** -- The execution loop was defined in 4 places (`system-spec.md:126`, `six-steps.md:7`, `getting-started.md:10`, `design-rationale.md:194`). Updating one without the others created conflicting instructions. The spec showed the old 5-step loop while `execution-loop.md` had the 6-step version -- this single contradiction caused 7 of 8 gaps in a downstream project implementation.

3. **Hook event name mismatch** -- Gemini setup was derived from Claude setup by path substitution (`.claude/` to `.gemini/`), but hook event names differ: Claude uses `PreToolUse`/`PostToolUse`/`Stop`, Gemini uses `BeforeTool`/`AfterTool`/`AfterAgent`. Hooks silently failed until the scanner flagged invalid event names.

## Key Wins

**Skills prevented blind debugging.** `/goat-debug` enforces diagnosis-first with file:line evidence before any fix. `/goat-review` in audit mode uses negative verification and fabrication self-check to catch false positives.

**The learning loop captured 9 real incidents.** `docs/lessons.md` holds 9 entries with a pattern section. `docs/footguns.md` holds 7 entries with file:line evidence. Real examples: agents under line pressure cut required sections, `mv` overwrote an untracked file with no git recovery path, sub-agents wrote planned features as current state.

**Enforcement hooks achieved 100% compliance** on binary prohibitions (git commit, git push blocked via permissions deny) versus ~70% with rules alone. The deny-dangerous hook catches `rm -rf`, force push, pipe-to-shell, and `.env` edits before execution.

## Lessons

The biggest lesson: **agents follow whichever source they read first**. When `system-spec.md` (read first per setup instructions) contradicted `execution-loop.md` (the authoritative template), agents absorbed the spec's version and ignored the template. Fix: update the file agents read first, always.

Second: **verification scope must match change scope**. Running tests is sufficient for code changes. For docs/setup/workflow changes, verification must read those files too. "Double check" means read the files, not re-run the tests.
