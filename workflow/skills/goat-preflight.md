# Prompt: Create /goat-preflight Skill

Paste this into your coding agent to create the `/goat-preflight` skill for your project.

---

## The Prompt

```
Create the /goat-preflight skill for this project.

When to use: before starting any task, after meaningful code changes,
or as a final gate before declaring a task complete.

Purpose: mechanical build verification before any task begins or after
any meaningful change. This is a hard gate — the task is not done if
preflight fails.

Stack:
- Type-check: [your command, e.g., npx tsc --noEmit, composer analyse]
- Lint: [your command, e.g., npm run lint, composer analyse]
- Build/compile: [your command, e.g., npm run build, cargo build]
- Test: [your command, e.g., npm test, composer test, cargo test]
- Format check: [your command, e.g., npm run format:check, composer cs:check]

Write the skill file to: .claude/skills/goat-preflight/SKILL.md
(For Codex: docs/codex-playbooks/goat-preflight.md)

The skill MUST:
- Run type-check + lint + compile (in that order)
- Report complete ONLY if all MUST items pass
- Output a clear pass/fail checklist with the command and result for each step

The skill SHOULD:
- Run the full test suite
- Run the formatter check

The skill MAY:
- Skip the formatter check during active debugging sessions

The skill MUST NOT:
- Report "complete" or "all clear" if any MUST item fails
- Skip steps silently — every step must be shown with its result
- Modify any code (preflight is read-only verification)

Use RFC 2119 language (MUST/SHOULD/MAY/MUST NOT) in the skill file.

Output format:
## Preflight Results
- [PASS/FAIL] Type-check: `[command]`
- [PASS/FAIL] Lint: `[command]`
- [PASS/FAIL] Build: `[command]`
- [PASS/FAIL] Tests: `[command]` ([N] passed, [N] failed)
- [PASS/FAIL] Format: `[command]`

Overall: PASS / FAIL ([N]/[N] checks passed)

VERIFICATION:
- Verify skill file exists at the correct path
- Verify MUST/SHOULD/MAY constraints are present
- Verify output format template is included
- Verify the skill references this project's actual commands
```
