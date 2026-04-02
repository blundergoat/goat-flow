---
name: git diff --stat is unreliable for scope detection
status: open
created: 2026-04-03
evidence_type: ACTUAL_MEASURED
---

goat-review (`.claude/skills/goat-review/SKILL.md:42`) and goat-test (`.claude/skills/goat-test/SKILL.md:45`) use `git diff --stat` to auto-detect what changed. In real local work this fails because:

1. It shows unrelated changes (package.json, lockfiles) alongside the target
2. It misses untracked files entirely
3. On a dirty worktree with 20+ changed files, it gives no useful signal about what the user actually wants reviewed

**Evidence:** Found by Codex on healthkit project. `git diff --stat` pointed at unrelated package.json changes instead of the goat-flow files or the code area the agent was asked about.

**Impact:** Auto mode selection (Standard vs Audit) makes the wrong choice. Skills scope to the wrong files. The user has to manually override or accept wrong-scope output.

**Fix:** M14 in `.goat-flow/tasks/0.10.0/M14-auto-mode-selection.md`. Priority order: (1) explicit user input, (2) staged changes, (3) unstaged changes to target area, (4) full git diff. If worktree is very dirty, ask user to specify scope.
