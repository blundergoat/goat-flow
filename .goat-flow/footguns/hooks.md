---
category: hooks
---

## Footgun: post-turn hook swallows failures with || true

**Status:** resolved (goat-flow) / active (consumer projects) | **Created:** 2026-04-03 | **Updated:** 2026-04-14 | **Evidence:** ACTUAL_MEASURED

Consumer project post-turn hook scripts with `|| true` after lint/type-check commands never exit non-zero when validation fails, which hides lint failures.

**Evidence (cross-project - not goat-flow's own hooks):** Found independently by Codex critiques on the-summit-chatroom (`.claude/hooks/stop-lint.sh:22`, `:29`, `:37` all swallow failure) and blundergoat-platform. Note: these line numbers are from those projects' hooks, not goat-flow's.

**goat-flow status:** Resolved. goat-flow removed `stop-lint.sh` from core in v1.1.0 (ADR-040). Post-turn lint hooks are project-specific, not shipped by goat-flow.

**Consumer project status:** Still active for projects set up before v1.1.0 that have their own `stop-lint.sh` with `|| true` swallowing failures.

**Related (resolved):** `deny-dangerous.sh` field-path mismatch (`.command // .input` vs `.tool_input.command`) was fixed - both installed and template copies now use `.tool_input.command // empty`. (format-file.sh was removed from goat-flow core in v1.1.0 as a project-specific preference.)

**Prevention:** Setup templates now ship enforce-by-default hooks. Existing consumer projects should update their `stop-lint.sh` to default `GOAT_LINT_ENFORCE` to 1.

---

## Footgun: Deny hook blocks read-only commands containing dangerous string literals

**Status:** active | **Created:** 2026-04-15 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** Harmless inspection commands are blocked because the command text contains a dangerous pattern as data (search term, string literal, regex), not as a shell action. Agent workflows stall on read-only audit/debug tasks.

**Why it happens:** `deny-dangerous.sh` matches dangerous patterns (e.g. `rm -rf`, `chmod 777`, `git push origin main`) via regex on the raw command string. The pattern matching block (search: `rm[[:space:]]+-` in `deny-dangerous.sh`) does not distinguish between shell actions and string data. A grep searching for the text `rm -rf` or a `printf` printing `chmod 777` triggers the same block as the real dangerous command.

**Evidence:**
- Live block during 8-critique analysis (2026-04-15): `grep -A3 "rm -rf\|howToFix" src/cli/audit/check-agent-setup.ts` was blocked because the search pattern contained `rm -rf` as a literal string
- `deny-dangerous.sh` self-test (search: `run_self_test` in `deny-dangerous.sh`) has zero false-positive test cases - it only tests that safe commands pass and dangerous commands block, never that benign commands containing dangerous substrings pass
- The hook's own header acknowledges "Best-effort pattern matching on literal shell commands" but does not list false positives as a known limitation

**Impact:** Agents resort to workarounds (using the Grep tool instead of grep, rephrasing commands) or ask the user to run commands manually. This is especially problematic during code review and security audit where searching for dangerous patterns is the primary task.

**Prevention:**
1. Add false-positive test cases to self-test: `printf '%s\n' 'rm -rf'` should pass, `grep "rm -rf" file.ts` should pass
2. Consider token-aware matching: only match dangerous patterns when they appear as the command verb, not inside quoted strings or as arguments to read-only tools
3. At minimum, whitelist common read-only tools (grep, rg, cat, head, printf, echo) when the dangerous pattern appears only in their arguments

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
