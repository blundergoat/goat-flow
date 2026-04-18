---
category: hooks
last_reviewed: 2026-04-15
---

## Footgun: post-turn hook swallows failures with || true

**Status:** resolved (goat-flow) / active (consumer projects) | **Created:** 2026-04-03 | **Updated:** 2026-04-14 | **Evidence:** ACTUAL_MEASURED

Consumer project post-turn hook scripts with `|| true` after lint/type-check commands never exit non-zero when validation fails, which hides lint failures.

**Evidence (cross-project - not goat-flow's own hooks):** Found independently by Codex critiques on the-summit-chatroom (the consumer project's `.claude/hooks/stop-lint.sh` had `|| true` at lines 22, 29, and 37) and blundergoat-platform. Line numbers are from those projects' hooks; goat-flow itself no longer ships a `stop-lint.sh` — this evidence does not point at an in-repo file.

**goat-flow status:** Resolved. goat-flow removed `stop-lint.sh` from core in v1.1.0 (ADR-015). Post-turn lint hooks are project-specific, not shipped by goat-flow.

**Consumer project status:** Still active for projects set up before v1.1.0 that have their own `stop-lint.sh` with `|| true` swallowing failures.

**Related (resolved):** `deny-dangerous.sh` field-path mismatch (`.command // .input` vs `.tool_input.command`) was fixed - both installed and template copies now use `.tool_input.command // empty`. (format-file.sh was removed from goat-flow core in v1.1.0 as a project-specific preference.)

**Prevention:** Setup templates now ship enforce-by-default hooks. Existing consumer projects should update their `stop-lint.sh` to default `GOAT_LINT_ENFORCE` to 1.

---

## Footgun: Codex has no compaction notification hook

**Status:** active (platform limitation) | **Created:** 2026-04-15 | **Evidence:** ACTUAL_MEASURED

Codex `hooks.json` only supports `PreToolUse`. Claude and Gemini have `Notification` hooks on `compact` that help with context recovery. Codex agents lose this signal after compaction. Not fixable until Codex adds Notification hook support.

---

## Resolved Entries

> Historical record. These entries are no longer active traps.

- **git diff --stat is unreliable for scope detection** (resolved 2026-04-03) - Skill templates rewritten in M17; auto-detect now uses staged changes first, then falls back to unstaged and full diff.
- **Advisory hooks create unfixable quality warning after setup** (resolved 2026-04-14) - Hook scripts now ship in enforce mode by default (`GOAT_LINT_ENFORCE` defaults to 1).
- **Codex hooks registered in config.toml instead of hooks.json** (resolved 2026-04-15) - Moved hook definitions to `.codex/hooks.json` per official Codex docs; TOML hook sections were silently ignored.
- **Codex hook migrations drift across live files, templates, installer, and docs** (resolved 2026-04-15) - Restored missing `.codex/hooks/deny-dangerous.sh` and aligned all four Codex hook surfaces (live files, templates, installer, docs).
- **Deny hook blocks read-only commands containing dangerous string literals** (resolved 2026-04-17) - `.claude/hooks/deny-dangerous.sh` now includes a read-only tool whitelist (grep, rg, cat, head, tail, less, more, wc, file, diff, printf, echo, read, sed-without-`-i`) that skips pattern matching when the command verb is read-only AND there is no output redirection or pipe. Pipe-to-shell (`| bash`, `| python`) still blocks regardless of verb. Self-test covers 5 false-positive cases and 2 bypass-attempt cases (`.claude/hooks/deny-dangerous.sh:88-96`). Template at `workflow/hooks/deny-dangerous.sh` and per-agent hooks at `.codex/hooks/` and `.gemini/hooks/` synced to the same implementation (2026-04-17).
