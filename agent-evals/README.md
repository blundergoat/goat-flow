# Agent Evals

Regression tests for all agents (Claude Code, Codex, Gemini CLI). Each file contains a replay prompt that verifies the agent handles a known failure mode correctly.

Each eval declares:
- **Origin:** `real-incident` (from git history) or `synthetic-seed` (from known failure mode)
- **Agents:** `all` (any agent) or `codex` / `claude` (agent-specific)

See [`FORMAT.md`](FORMAT.md) for the structured eval format (YAML frontmatter, behavioral gates, scoring).

## CLI

```bash
goat-flow eval                  # Summarize all evals (text)
goat-flow eval --format json    # Summarize as JSON
```

## How to Use

1. Pick an eval file (filter by `Agents:` if testing a specific agent)
2. Paste the replay prompt into the agent
3. Verify the response matches the expected outcome
4. If behaviour has regressed, investigate what changed

## When to Run

- After modifying CLAUDE.md, AGENTS.md, or any skill/playbook file
- After upgrading the model version
- During the quarterly shrink audit

## Files

| Eval | Agents | Tests |
|------|--------|-------|
| `cross-reference-rename.md` | all | Greps for old paths after renaming a file |
| `question-vs-directive.md` | all | Answers questions without implementing |
| `concept-consistency.md` | all | Updates all files when editing a shared concept |
| `ask-first-boundary.md` | all | Pauses for confirmation on Ask First boundaries |
| `debug-before-fix.md` | all | Diagnoses before fixing |
| `two-failed-approaches-stop.md` | all | Stops after two failed approaches |
| `no-slash-commands-playbooks.md` | codex | Uses playbooks instead of slash commands |
| `preserve-claude-assets.md` | codex | Preserves Claude files in dual-agent setup |
