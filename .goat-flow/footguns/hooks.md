---
category: hooks
---

## Footgun: git diff --stat is unreliable for scope detection

**Status:** resolved | **Created:** 2026-04-03 | **Evidence:** ACTUAL_MEASURED

Skill templates rewritten in M17; this pattern no longer applies.

goat-review (`.claude/skills/goat-review/SKILL.md:42`) and goat-test (`.claude/skills/goat-test/SKILL.md:45`) use `git diff --stat` to auto-detect what changed. In real local work this fails because:

1. It shows unrelated changes (package.json, lockfiles) alongside the target
2. It misses untracked files entirely
3. On a dirty worktree with 20+ changed files, it gives no useful signal about what the user actually wants reviewed

**Evidence:** Found by Codex on healthkit project. `git diff --stat` pointed at unrelated package.json changes instead of the goat-flow files or the code area the agent was asked about.

**Impact:** Auto mode selection (Standard vs Audit) makes the wrong choice. Skills scope to the wrong files. The user has to manually override or accept wrong-scope output.

**Fix:** M14 in `.goat-flow/tasks/0.10.0/M14-auto-mode-selection.md`. Priority order: (1) explicit user input, (2) staged changes, (3) unstaged changes to target area, (4) full git diff. If worktree is very dirty, ask user to specify scope.

---

## Footgun: Advisory hooks create unfixable quality warning after setup

**Status:** active | **Created:** 2026-04-13 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** Users complete all 6 setup steps correctly. They run `audit --quality` and immediately see verification at 85% with recommendation "Set claude post-turn hook to exit non-zero on validation failure, or set GOAT_LINT_ENFORCE=1." They were never told about `GOAT_LINT_ENFORCE` during setup. The framework audits its own shipped default as a deficiency with no setup-path resolution.

**Why it happens:** Hook scripts ship in advisory mode (exit 0 always via `|| true` patterns). The quality auditor correctly detects this. But `GOAT_LINT_ENFORCE` appears in `stop-lint.sh` and `quality-checks.ts` only - it's never mentioned in setup steps 01-06, hook configuration docs, or the setup prompt generator.

**Evidence:**
- `.claude/hooks/stop-lint.sh` - exits 0 regardless of validation results
- `src/cli/audit/quality-checks.ts` - flags advisory mode, recommends GOAT_LINT_ENFORCE=1
- `grep GOAT_LINT_ENFORCE workflow/setup/` - 0 matches
- `audit --quality --agent claude` output: verification 85%, overall 97 (A)

**Fix:** Either ship hooks in enforce mode with an opt-out, or add an explicit Step 04/06 note about `GOAT_LINT_ENFORCE=1` so users know how to reach 100% verification.

---

## Footgun: post-turn hook swallows failures with || true

**Status:** open | **Created:** 2026-04-03 | **Evidence:** ACTUAL_MEASURED

Project post-turn hook scripts with `|| true` after lint/type-check commands never exit non-zero when validation fails, which hides lint failures. CLAUDE.md claims PHPStan level 10 enforcement, but the hook doesn't enforce it.

**Evidence:** Found independently by Codex critiques on the-summit-chatroom (`.claude/hooks/stop-lint.sh:22`, `:29`, `:37` all swallow failure) and blundergoat-platform.

**Related:** `deny-dangerous.sh` parses `.command // .input` but template says `.tool_input.command` per `workflow/hooks/deny-dangerous.sh` (originally enforcement.md:69). (format-file.sh was removed from goat-flow core in v1.1.0 as a project-specific preference.)

**Impact:** The entire hook enforcement layer is dishonest. Projects pass the audit's verification concern while hooks never actually block anything.

**Fix:** M19 in `.goat-flow/tasks/0.10.0/M19-setup-reliability.md`. Remove `|| true`, fix JSON key mismatches, add smoke-test to setup completion.
