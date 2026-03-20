# /goat-preflight

Mechanical verification before starting any task or declaring a task complete.

## When to Use

Before starting work, after meaningful changes, or as a final gate before declaring done.

## Process

Run each check in order. Report results for every step.

## Checks

### MUST pass (blocking)
1. **Shell syntax check:** `bash -n scripts/maintenance/*.sh`
2. **Shell lint:** `shellcheck scripts/maintenance/*.sh`
3. **Cross-reference integrity:** Grep for any file paths referenced in GEMINI.md router table and verify they exist

### SHOULD pass (non-blocking)
4. **Markdown link check:** Verify internal links in changed .md files resolve to real files
5. **Line count audit:** `wc -l GEMINI.md` — warn if over 120

### MAY skip
6. **Full repo link scan** — MAY skip during active debugging sessions

## Constraints

- MUST NOT report "complete" if any MUST item fails
- MUST NOT skip steps silently — every step shown with its result
- MUST NOT modify any files (preflight is read-only verification)

## Output Format

```
## Preflight Results
- [PASS/FAIL] Shell syntax: `bash -n scripts/maintenance/*.sh`
- [PASS/FAIL] Shell lint: `shellcheck scripts/maintenance/*.sh`
- [PASS/FAIL] Cross-ref integrity: [N] router table paths checked
- [PASS/FAIL] Markdown links: [N] links checked in changed files
- [PASS/FAIL] GEMINI.md line count: [N] lines (target: 120)

Overall: PASS / FAIL ([N]/[N] checks passed)
```
