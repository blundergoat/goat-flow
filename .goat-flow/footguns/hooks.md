---
category: hooks
last_reviewed: 2026-04-19
---

## Footgun: Codex has no compaction notification hook

**Status:** active | **Created:** 2026-04-15 | **Evidence:** ACTUAL_MEASURED
**hallucination-risk:** medium — platform support differs across agents; verify against the agent's live hook config before relying on compaction notifications.

Platform limitation, not a repo defect. Codex's hook surface only supports `PreToolUse`; there is no `Notification`/compact event. Claude and Gemini do have `Notification` hooks on `compact` that help with context recovery, so Codex agents lose this signal after compaction.

**Evidence:**
- `.codex/hooks.json` (search: `PreToolUse`) — declares only a `PreToolUse` hook; no `Notification` or `compact` section exists.
- `workflow/manifest.json` (search: `"codex"`) — `agents.codex.hook_events.post_turn` is `null`, confirming no end-of-turn or compaction hook is wired.
- By contrast, `.claude/settings.json` and `.gemini/settings.json` both register a `Notification`/`compact` hook that echoes recovery guidance.

**Prevention:** When designing cross-agent hook behaviour, read the per-agent `hook_events` field in `workflow/manifest.json` before assuming parity; treat Codex's `post_turn: null` as an explicit gap rather than an oversight. Not fixable until Codex adds Notification-hook support.

---

## Resolved Entries

> Historical record. These entries are no longer active traps.

- **Post-turn hook swallows failures with `|| true`** (resolved 2026-04-14) — goat-flow removed `stop-lint.sh` from core in v1.1.0 per ADR-015; post-turn lint hooks are project-specific. Consumer projects on pre-v1.1 installs should update their local `stop-lint.sh` to default `GOAT_LINT_ENFORCE=1`. Originally surfaced by Codex critiques on downstream consumer projects (the-summit-chatroom and blundergoat-platform) where `|| true` after lint commands hid failures; goat-flow itself never shipped the trap.
- **git diff --stat is unreliable for scope detection** (resolved 2026-04-03) - Skill templates rewritten in M17; auto-detect now uses staged changes first, then falls back to unstaged and full diff.
- **Advisory hooks create unfixable quality warning after setup** (resolved 2026-04-14) - Hook scripts now ship in enforce mode by default (`GOAT_LINT_ENFORCE` defaults to 1).
- **Codex hooks registered in config.toml instead of hooks.json** (resolved 2026-04-15) - Moved hook definitions to `.codex/hooks.json` per official Codex docs; TOML hook sections were silently ignored.
- **Codex hook migrations drift across live files, templates, installer, and docs** (resolved 2026-04-15) - Restored missing `.codex/hooks/deny-dangerous.sh` and aligned all four Codex hook surfaces (live files, templates, installer, docs).
- **Deny hook blocks read-only commands containing dangerous string literals** (resolved 2026-04-17) - `.claude/hooks/deny-dangerous.sh` now includes a read-only tool whitelist (grep, rg, cat, head, tail, less, more, wc, file, diff, printf, echo, read, sed-without-`-i`) that skips pattern matching when the command verb is read-only AND there is no output redirection or pipe. Pipe-to-shell (`| bash`, `| python`) still blocks regardless of verb. Self-test covers 5 false-positive cases and 2 bypass-attempt cases (`.claude/hooks/deny-dangerous.sh:88-96`). Template at `workflow/hooks/deny-dangerous.sh` and per-agent hooks at `.codex/hooks/` and `.gemini/hooks/` synced to the same implementation (2026-04-17).
