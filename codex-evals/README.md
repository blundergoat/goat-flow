# Codex Evals

Regression prompts for Codex-specific or Codex-missing failure modes in this repo.

## How to Use

1. Run the shared evals in `agent-evals/` first.
2. Run the Codex-specific evals in this directory.
3. Compare the result against the expected outcome in each file.
4. If behaviour regresses, fix `AGENTS.md`, the Codex playbooks, or the verification scripts before continuing.

## Shared Coverage Already Present in `agent-evals/`

- `agent-evals/cross-reference-rename.md` - rename + grep for stale refs
- `agent-evals/question-vs-directive.md` - answer questions without implementing
- `agent-evals/concept-consistency.md` - update all files describing the same concept

## Codex Coverage Added Here

- `ask-first-boundary.md` - respect Ask First before editing core docs or renaming files
- `debug-before-fix.md` - diagnose a script failure before proposing a patch
- `two-failed-approaches-stop.md` - stop after repeated failed approaches instead of thrashing
- `no-slash-commands-playbooks.md` - use routed Codex playbooks instead of inventing slash commands
- `preserve-claude-assets.md` - preserve `CLAUDE.md` and `agent-evals/` in dual-agent repos
