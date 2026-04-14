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

## Footgun: Advisory hooks create unfixable quality warning after setup (RESOLVED)

**Status:** resolved | **Created:** 2026-04-13 | **Resolved:** 2026-04-14 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** Users complete all 6 setup steps correctly. They run `audit --harness` and immediately see verification at 85% with recommendation "Set claude post-turn hook to exit non-zero on validation failure, or set GOAT_LINT_ENFORCE=1."

**Resolution:** Hook scripts now ship in enforce mode by default (`GOAT_LINT_ENFORCE` defaults to 1). Users can opt out with `GOAT_LINT_ENFORCE=0`. The quality auditor correctly detects enforce vs advisory mode.

---

## Footgun: post-turn hook swallows failures with || true

**Status:** resolved (goat-flow) / active (consumer projects) | **Created:** 2026-04-03 | **Updated:** 2026-04-14 | **Evidence:** ACTUAL_MEASURED

Consumer project post-turn hook scripts with `|| true` after lint/type-check commands never exit non-zero when validation fails, which hides lint failures.

**Evidence (cross-project — not goat-flow's own hooks):** Found independently by Codex critiques on the-summit-chatroom (`.claude/hooks/stop-lint.sh:22`, `:29`, `:37` all swallow failure) and blundergoat-platform. Note: these line numbers are from those projects' hooks, not goat-flow's.

**goat-flow status:** Resolved. goat-flow's own `stop-lint.sh` defaults to enforce mode (`GOAT_LINT_ENFORCE` defaults to 1) since v1.1.0.

**Consumer project status:** Still active for projects set up before the enforce-by-default change.

**Related:** `deny-dangerous.sh` parses `.command // .input` but template says `.tool_input.command` per `workflow/hooks/deny-dangerous.sh`. (format-file.sh was removed from goat-flow core in v1.1.0 as a project-specific preference.)

**Prevention:** Setup templates now ship enforce-by-default hooks. Existing consumer projects should update their `stop-lint.sh` to default `GOAT_LINT_ENFORCE` to 1.

---

## Footgun: Codex hooks registered in config.toml instead of hooks.json

**Status:** resolved | **Created:** 2026-04-15 | **Evidence:** ACTUAL_MEASURED

Codex hook registrations (`[hooks.stop]`, `[hooks.session_start]`, `[hooks.after_tool_use]`) were in `.codex/config.toml`. The official Codex docs (`developers.openai.com/codex/hooks`, `developers.openai.com/codex/config-reference`) specify hooks go in `.codex/hooks.json` — a separate file with a JSON structure matching Claude's settings.json hook format. config.toml only has `[features] codex_hooks = true` to enable the hooks engine.

**Evidence:** `workflow/hooks/agent-config/codex.toml` (pre-fix) had `[hooks.session_start] command = "bash .codex/hooks/session-start.sh"`. The official config reference says hooks.json is the only hook definition surface. The TOML hook sections were silently ignored by Codex — hooks never actually fired.

**Impact:** All Codex hooks (stop-lint, session-start, after-tool-use) were dead code. The audit's hook fact extraction parsed TOML and reported hooks as registered, masking the issue.

**Fix:** Moved hook definitions to `.codex/hooks.json`. Updated fact extraction (`src/cli/facts/agent/hooks.ts`) to read hooks.json for Codex using the same `readHooksObject` + `normalizeEventConfig` functions Claude/Gemini use. Removed TOML hook parsing functions. Updated template, install script, and setup guide.

**Prevention:** When adding agent-specific features, verify against the agent's official documentation — not assumptions from other agents' patterns. The fact that Claude uses settings.json for hooks doesn't mean Codex uses config.toml for hooks.
