---
category: refactoring
last_reviewed: 2026-05-18
---

## Pattern: Verify structural renames with a repo-wide grep
**Context:** Renaming setup files, moving shared references, or changing canonical doc paths.
**Approach:** Update the replacement file first, grep the old path across active docs/code, fix every live reference, then rerun validation (`bash scripts/preflight-checks.sh` plus the relevant `goat-flow audit` command) before closing the task.

## Pattern: Skill consolidation requires a full grep after every merge
**Context:** Renaming, merging, or deleting skills.
**Approach:** After any skill rename/merge/delete: (1) grep entire repo for every old name, (2) check every installed skill root listed in `workflow/manifest.json` (search: `"skills_dir"`), (3) check constants + types + test fixtures, (4) run the full test suite + audit. Don't trust "it builds and tests pass" - read the changed files.
