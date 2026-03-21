---
name: goat-preflight
description: "Run preflight checks before starting or finishing work"
---
# GOAT Preflight

## When to Use

Use before starting meaningful work, after meaningful changes, and before declaring a task complete.

## Constraints

- MUST run `bash scripts/context-validate.sh`
- MUST run `bash -n scripts/*.sh scripts/maintenance/*.sh`
- SHOULD run `shellcheck scripts/*.sh scripts/maintenance/*.sh` when `shellcheck` is available
- SHOULD run `bash scripts/deny-dangerous.sh --self-test`
- MAY note skipped optional checks when the tool is unavailable
- MUST NOT claim PASS if any MUST check fails
- MUST NOT modify files while running preflight

## Process

1. Run context validation.
2. Run Bash syntax checks on project scripts.
3. Run `shellcheck` if available.
4. Run the deny-policy self-test.
5. Summarise each command with PASS/FAIL and any skipped optional checks.

## Output

```md
## Preflight Results
- [PASS/FAIL] Context validate: `bash scripts/context-validate.sh`
- [PASS/FAIL] Bash syntax: `bash -n scripts/*.sh scripts/maintenance/*.sh`
- [PASS/FAIL/SKIP] Shellcheck: `shellcheck scripts/*.sh scripts/maintenance/*.sh`
- [PASS/FAIL] Deny policy self-test: `bash scripts/deny-dangerous.sh --self-test`

Overall: PASS / FAIL
```
