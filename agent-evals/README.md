# Agent Evals

Regression tests from real incidents. Each file contains a replay prompt that verifies Claude Code handles a known failure mode correctly.

## How to Use

1. Pick an eval file
2. Paste the replay prompt into Claude Code
3. Verify the agent's response matches the expected outcome
4. If behaviour has regressed, investigate what changed (CLAUDE.md edit, skill change, model update)

## When to Run

- After modifying CLAUDE.md or any skill file
- After upgrading the Claude model version
- During the quarterly shrink audit
- When adding or removing rules

## Files

| Eval | Tests |
|------|-------|
| `cross-reference-rename.md` | Agent greps for old paths after renaming a file |
| `question-vs-directive.md` | Agent answers questions without implementing |
| `concept-consistency.md` | Agent updates all files when editing a shared concept |
