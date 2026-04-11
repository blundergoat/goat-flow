# Step 01 — System Overview

Read this first. This is what you're installing and why.

## Before you begin

1. Read your agent config file (`agents/claude.md`, `agents/codex.md`, etc.) for paths and agent-specific setup.
2. This setup is for **ONE agent**. Only modify files belonging to the agent specified in the agent config file. Do not touch other agents' instruction files, skills, hooks, or settings.

## State check

If `.goat-flow/config.yaml` exists and its version matches the current goat-flow release, **STOP**. The project is already configured. Run `goat-flow scan . --agent {agent}` instead and fix any failing checks.

If the version is older, use the upgrade path instead:
- Old skill names (goat-audit, goat-investigate, etc.) or legacy `docs/footguns.md` / `tasks/todo.md` → run `bash /path/to/goat-flow/scripts/migrate-to-1.1.sh /path/to/project` first (dry-run by default, add `--execute` to apply), then continue with fresh setup
- Version < current → `workflow/setup/upgrade-from-1.0.x.md`

## What goat-flow is

A framework that gives AI coding agents structured planning (with SBAO multi-perspective critique and Mob Elaboration), persistent memory across sessions, and mechanical safety guardrails. Three layers:

1. **Instruction file** (CLAUDE.md / AGENTS.md / GEMINI.md) — The execution loop, autonomy tiers, definition of done, and router table. Loaded every turn.
2. **Skills** (6 functional + 1 dispatcher) — Plan (milestone task files), critique (SBAO multi-perspective analysis), test, review, secure, debug. Feature briefs and mob elaboration are handled by the dispatcher's Planning Route. Loaded on demand via slash commands. Install verbatim from templates — do NOT adapt, compress, or rewrite skill content.
3. **.goat-flow/ learning loop** — Footguns (architectural traps with file:line evidence), lessons (behavioural mistakes), decisions (ADRs), patterns (successful approaches), templates (standalone prompt templates for manual planning sessions), and optional local instruction files. AI extended memory persisting across sessions.

Every project gets the full system. The components are lightweight infrastructure, not ceremony proportional to codebase size.

## Setup session log

Create `.goat-flow/logs/sessions/` if it doesn't exist, then use one shared file for the whole setup: `.goat-flow/logs/sessions/YYYY-MM-DD-setup.md`

- If resuming after compaction, read the latest setup session log first and continue from the next incomplete step.
- After each numbered step, append one progress marker line (for example: `Step 03 complete: 7 skills installed`).
- Step 06 finalises the same file with the scanner result, file manifest, time spent, and tokens if available.

## File ownership

Setup creates/edits files in `.goat-flow/`, the agent's instruction file (CLAUDE.md / AGENTS.md / GEMINI.md), and the agent's own directories (see agent config file for "Owns" list — skills, hooks, settings). Everything else in the project is hands-off — do not modify source code, tests, CI, or other agents' files.

NEXT: proceed to `02-instruction-file.md`
