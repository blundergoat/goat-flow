# Step 01 - System Overview

Read this first. This is what you're installing and why.

## Before you begin

1. Read your agent config file (`workflow/setup/agents/claude.md`, `workflow/setup/agents/codex.md`, etc.) for paths and agent-specific setup.
2. This setup configures one agent. Only modify instruction files, hooks, and settings belonging to the agent specified in the agent config file. **Exception:** Step 03 includes a narrow cross-agent task - deleting stale goat-flow skill directories from other agents and removing references to deleted skills from their instruction files. This is cleanup only (deletion of known-stale artifacts), not creation or modification of other agents' active surfaces.

## State check

If `.goat-flow/config.yaml` exists and its version matches the current goat-flow release, AND `goat-flow audit . --agent {agent}` passes, AND `goat-flow audit . --agent {agent} --harness` passes, verify cold-path truth before stopping: spot-check that architecture doc claims match code reality (dashboard views, check counts, component paths). If structural audit + harness + cold-path spot-check all pass, **STOP**. If the version matches but audit fails or skills/instruction file/preamble are missing, continue with setup to repair the incomplete install.

If the version is older, there is no maintained in-place upgrade guide. Refresh the current agent files, then continue through the current numbered setup flow:
- **Always run the installer first** - on any version mismatch, before touching anything else:
  ```bash
  npx @blundergoat/goat-flow@latest install . --agent {agent}
  ```
  The installer is the only path that overwrites `.goat-flow/.gitignore` from the current template. **Pre-1.6.1 installs have a stale `.goat-flow/.gitignore`** that is missing the `!skill-playbooks/` and `!skill-playbooks/**` un-ignore entries. The playbook files exist on disk but git silently hides them, so teammates and CI never see them. Skipping the installer leaves this misconfigured.
- After the installer overwrites `.goat-flow/.gitignore`, run `git add .goat-flow/skill-playbooks/ .goat-flow/skill-reference/` to track files that were previously hidden. The `goat-flow-gitignore` audit check (in `goat-flow audit . --agent {agent}`) confirms the exceptions are present; fix any failure before moving on.
- Then continue with `workflow/setup/02-instruction-file.md` and the remaining numbered setup steps.
- If you encounter legacy flat learning-loop docs, old skill names, or legacy task-state files, promote durable content into `.goat-flow/lessons/`, `.goat-flow/footguns/`, or `.goat-flow/decisions/` before removing them. Session logs are local continuity only.

## What goat-flow is

A framework that gives AI coding agents structured planning (with multi-perspective critique via `/goat-critique`), durable project knowledge, local continuity notes, and mechanical safety guardrails. Three layers:

1. **Instruction file** (CLAUDE.md / AGENTS.md / `.github/copilot-instructions.md`) - The execution loop, autonomy tiers, definition of done, and router table. Loaded every turn.
2. **Skills** (6 functional + 1 dispatcher) - Plan (milestone task files), critique (`/goat-critique` multi-perspective analysis), QA, review, secure, debug. Feature briefs are handled by the dispatcher's Planning Route. Loaded on demand via slash commands. Install verbatim from templates - do NOT adapt, compress, or rewrite skill content.
3. **.goat-flow/ learning loop** - Footguns (architectural traps with file evidence), lessons (behavioural mistakes), decisions (ADRs), patterns (successful approaches), and optional local instruction files. Durable project knowledge lives in committed files; session logs and task files stay local to the checkout.

Every project gets the full system. The components are lightweight infrastructure, not ceremony proportional to codebase size.

## Setup session log

Create `.goat-flow/logs/sessions/` if it doesn't exist, then use one shared local file for the whole setup: `.goat-flow/logs/sessions/YYYY-MM-DD-setup.md`

- If resuming after compaction, read the latest setup session log first and continue from the next incomplete step.
- After each numbered step, append one progress marker line (for example: `Step 03 complete: 7 skills installed`).
- Step 06 finalises the same local continuity file with the audit result, file manifest, time spent, and tokens if available.

## File ownership

Setup creates/edits files in `.goat-flow/`, the agent's instruction file (CLAUDE.md / AGENTS.md / `.github/copilot-instructions.md`), and the agent's own directories (see agent config file for "Owns" list - skills, hooks, settings). Everything else in the project is hands-off - do not modify source code, tests, CI, or other agents' files.

NEXT: proceed to `02-instruction-file.md`
