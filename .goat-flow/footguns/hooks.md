---
category: hooks
---

## Footgun: post-turn hook swallows failures with || true

**Status:** resolved (goat-flow) / active (consumer projects) | **Created:** 2026-04-03 | **Updated:** 2026-04-14 | **Evidence:** ACTUAL_MEASURED

Consumer project post-turn hook scripts with `|| true` after lint/type-check commands never exit non-zero when validation fails, which hides lint failures.

**Evidence (cross-project — not goat-flow's own hooks):** Found independently by Codex critiques on the-summit-chatroom (`.claude/hooks/stop-lint.sh:22`, `:29`, `:37` all swallow failure) and blundergoat-platform. Note: these line numbers are from those projects' hooks, not goat-flow's.

**goat-flow status:** Resolved. goat-flow removed `stop-lint.sh` from core in v1.1.0 (ADR-040). Post-turn lint hooks are project-specific, not shipped by goat-flow.

**Consumer project status:** Still active for projects set up before v1.1.0 that have their own `stop-lint.sh` with `|| true` swallowing failures.

**Related (resolved):** `deny-dangerous.sh` field-path mismatch (`.command // .input` vs `.tool_input.command`) was fixed — both installed and template copies now use `.tool_input.command // empty`. (format-file.sh was removed from goat-flow core in v1.1.0 as a project-specific preference.)

**Prevention:** Setup templates now ship enforce-by-default hooks. Existing consumer projects should update their `stop-lint.sh` to default `GOAT_LINT_ENFORCE` to 1.

---

## Resolved Entries

> Historical record. These entries are no longer active traps.

- **git diff --stat is unreliable for scope detection** (resolved 2026-04-03) — Skill templates rewritten in M17; auto-detect now uses staged changes first, then falls back to unstaged and full diff.
- **Advisory hooks create unfixable quality warning after setup** (resolved 2026-04-14) — Hook scripts now ship in enforce mode by default (`GOAT_LINT_ENFORCE` defaults to 1).
- **Codex hooks registered in config.toml instead of hooks.json** (resolved 2026-04-15) — Moved hook definitions to `.codex/hooks.json` per official Codex docs; TOML hook sections were silently ignored.
- **Codex hook migrations drift across live files, templates, installer, and docs** (resolved 2026-04-15) — Restored missing `.codex/hooks/deny-dangerous.sh` and aligned all four Codex hook surfaces (live files, templates, installer, docs).
- **Codex has no compaction notification hook** (active, platform limitation, 2026-04-15) — Codex `hooks.json` only supports `PreToolUse`. Claude and Gemini have `Notification` hooks on `compact` that help with context recovery. Codex agents lose this signal after compaction. Not fixable until Codex adds Notification hook support.
