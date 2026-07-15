---
category: agent-settings
last_reviewed: 2026-07-16
---

## Footgun: Settings-layer deny globs match guarded phrases quoted inside benign read-only commands

**Status:** active | **Created:** 2026-07-03 | **Evidence:** ACTUAL_MEASURED
**hallucination-risk:** high

**Symptoms:** Read-only Bash calls are denied with `Permission to use Bash with command ... has been denied` and no `BLOCKED:` policy output: a `sed` whose address quoted a footgun title containing a push phrase and a `grep` whose pattern quoted a wrapper-prefixed push example were both denied (2026-07-03 quality assessment). `deny-dangerous.sh` never ran - the agent-settings permission layer denied the call first - so the block is easy to misattribute to the hook.

**Why it happens:** Settings deny globs match as substrings across the whole command string, quoted arguments included: `.claude/settings.json` and the template `workflow/hooks/agent-config/claude.json` (search: `Bash(*git push*)`, search: `Bash(*sudo *)`) deny any command whose text merely mentions a guarded phrase. The hardest layer of the enforcement gradient is the least grammar-aware. The deny-dangerous hook layer does NOT share this trap: piping the same command text as a `tool_input.command` JSON payload into `.goat-flow/hooks/deny-dangerous.sh` (search: `tool_input.command`) exits 0 for both denied shapes (verified 2026-07-03), and the hook self-test keeps read-only allow canaries in `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `expect_allow`) - see the resolved entry "Deny hook blocks read-only commands with dangerous string literals" in `deny-dangerous.md`. Only the settings globs over-match, and per `.goat-flow/learning-loop/decisions/ADR-025-block-all-git-push.md` their bluntness is deliberate.

**Evidence:**
- `.claude/settings.json` (search: `Bash(*git push*)`) and `workflow/hooks/agent-config/claude.json` (search: `Bash(*sudo *)`) - the substring deny globs shipped to every Claude install.
- 2026-07-03 session: two denials of read-only evidence commands quoting deny-dangerous bucket entries; stdin probes of the identical command text through the hook returned exit 0.

**Prevention:**
1. Keep guarded phrases out of the Bash command string when investigating deny/push content: use file-read/search tools instead of shell `grep`/`echo`/`sed`, or grep a fragment that omits the guarded token. Prefer new footgun/lesson titles that avoid guarded literals so future title-greps do not trip the globs.
2. Do not weaken the settings globs to fix this (ADR-025), and do not probe with split-variable reconstructions of guarded phrases - the guard rightly refuses evasion-shaped commands.
3. To test hook-layer classification legitimately, pipe a JSON payload file into `.goat-flow/hooks/deny-dangerous.sh` or run its sanctioned `--self-test` modes; command-line reconstruction of guarded strings is indistinguishable from evasion.

## Footgun: Installed settings.json deny patterns can silently drift from workflow templates

**Status:** active | **Created:** 2026-04-26 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** An agent can perform an action (e.g. `git push origin feature-branch`) that the workflow template blocks, because the installed settings.json drifted to a weaker deny pattern than the template it was installed from (or the hook only blocks a narrower set). Now covered by preflight's Agent Config Parity check, so the active trap is skipping that check or changing deny semantics without updating the parity rules.

**Why it happens:** `workflow/hooks/agent-config/claude.json` is the install template for `.claude/settings.json`. The template had `Bash(*git push*)` (block all push) but the installed copy drifted to `Bash(*git push*--force*)` (block force only). At incident time, preflight covered skill files and shared references but not settings.json deny patterns; the `Agent Config Parity` section now verifies installed settings with `covers()`.

**Evidence:**
- `workflow/hooks/agent-config/claude.json` (search: `git push`) - template had the correct blanket pattern; `.claude/settings.json` (search: `git push`) - installed copy had drifted to force-only, fixed 2026-04-26 per ADR-025.
- `scripts/preflight-checks.sh` (search: `Agent Config Parity`) - parity check validates installed agent settings against workflow templates.

**Prevention:**
1. After changing any deny pattern in a settings template (`workflow/hooks/agent-config/*.json`), run `bash scripts/preflight-checks.sh` and confirm `Agent Config Parity` still passes.
2. When reviewing hook or settings changes, compare the installed file against its workflow template, not just the other agent mirrors.
3. If a new agent config surface is added, extend the Agent Config Parity map and `covers()` validation in the same change.

## Footgun: Re-adding a removed agent tool (MultiEdit) reprints "matches no known tool" every launch

**Status:** active | **Created:** 2026-06-07 | **Evidence:** ACTUAL_MEASURED

**Regression symptom:** Claude Code printed `Permission deny rule "MultiEdit(**/secrets/**)" matches no known tool — check for typos.` (x12) on every launch. Claude Code v2.x removed the `MultiEdit` tool (folded into `Edit`), and permission deny rules are validated against known tools at startup, so each `MultiEdit(...)` deny rule warns. This exact issue was fixed once already (CHANGELOG: "Stale `MultiEdit` permission rules removed (Claude Code v2.x)") and then silently came back.

**Why it happened:** Commit `4e54072e` ("add gruff code quality hook and update matcher for multi-edit events") added the gruff PostToolUse hook and, modelling on the existing `Edit`/`Write` blocks, re-added 12 `MultiEdit(...)` deny rules plus a `"matcher": "MultiEdit"` hook entry to `.claude/settings.json` and `.codex/hooks.json`. Mirroring the `Edit`/`Write` pattern *looks* correct, but `MultiEdit` no longer exists. The prior fix lived only in CHANGELOG prose and a few file edits — **no test asserted the absence of MultiEdit**, so re-adding it kept every check green and shipped. Same blind spot as [the silent settings-drift footgun above]; deny rules referencing removed tools warn but never fail a build.

**Evidence:**
- Removed-tool deny rules surface as launch-time warnings, not test failures: pre-fix `npm run test:fast` was green with the 12 `MultiEdit(...)` rules present.
- The `Edit(...)` deny rules covering the same 12 secret paths already exist, so dropping the `MultiEdit(...)` rules loses zero coverage (verified: deny count 57 → 45, all paths retain Read/Edit/Write).
- Sources scrubbed: `.claude/settings.json`, `.codex/hooks.json`, template `workflow/hooks/agent-config/claude.json`, generators `src/cli/server/hooks-registry.ts` (matcher `Edit|Write`) + `workflow/install-goat-flow.sh` (`gruffHookEntries`), docs `workflow/hooks/README.md`, and the hook self-test in `workflow/hooks/gruff-code-quality.sh` (synced to the installed `.goat-flow/hooks/` copy or `audit` drift fails).

**Prevention:**
1. A "fixed" config regression needs a test, not just a CHANGELOG line. Guards now in place: `test/unit/agent-config-template-parity.test.ts` (search: `never carries a rule form Claude will not match`) locks every Claude permission rule (deny/allow/ask) in the template AND `.claude/settings.json` to `{Bash,Read,Edit}` (see 2026-07-16 follow-up); `test/unit/hook-registrar.test.ts` (search: `Edit|Write`) and `test/integration/setup-install-migrations.test.ts` (search: `/"matcher": "MultiEdit"/`) lock the gruff matcher.
2. When mirroring permission or hook entries for a new tool, confirm the tool exists AND its permission-rule form is matched — file permission checks only match `Edit(path)`/`Read(path)` rules; `Write`/`NotebookEdit` are hook-matcher-only.
3. Editing a `workflow/hooks/*.sh` template means re-syncing the installed `.goat-flow/hooks/` copy in the same change; `audit` drift (search: `hook template ... and installed copy ... differ`) fails otherwise.

**Follow-up (2026-06-08): the template guard was necessary but NOT sufficient — upgrades didn't clean existing installs.** The 1.10.0 fix above scrubbed the templates and added `test/unit/agent-config-template-parity.test.ts` (allow-set `{Bash,Read,Edit,Write}`). Both green — yet every real user still saw the 13 warnings on launch. All five `gruff-workspace` projects (`gruff-go|rs|ts|php|py`), upgraded to 1.10.x, still carried 13 `MultiEdit(...)` rules in `.claude/settings.json`. Root cause: `workflow/install-goat-flow.sh` settings block (search: `SETTINGS_MIGRATIONS=()`) only ran *Codex* migrations on an existing settings file; for Claude it fell through to "exists, skipped", and the Claude hook-config migration `migrate_agent_hook_config` only rewrites `current.hooks`, never `permissions.deny`. **A test on the template can't see the thousands of user-owned installed files that already hold the bad value.** Removing/renaming anything that lands in a user-owned config (a deny rule, a hook matcher, a config key) needs an UPGRADE MIGRATION that prunes the orphaned value from existing files — not just a clean template (cf. the standing rule: upgrades MUST prune orphaned/renamed artifacts).

Fix shipped 1.10.1: `migrate_claude_permission_deny` in `workflow/install-goat-flow.sh` (search: `migrate_claude_permission_deny`), invoked under `[[ "$AGENT" == "claude" ]]` in the settings block. **Remove/rewrite-list, not allow-list:** it originally stripped only `REMOVED_CLAUDE_TOOLS = {MultiEdit}`, never "anything not in the allow-set" — a user may legitimately deny valid unmanaged tools (`WebFetch`, `mcp__*`), and clobbering those in a user-owned file is data loss. Keep the migration lists in sync with the template allow-set when Claude's toolset changes. Regression test: `test/integration/setup-install-migrations.test.ts` (search: `prunes removed-tool`) seeds an existing settings file with stale + valid denies and asserts stale forms are pruned or rewritten, valid ones survive, and a second run is a no-op. Verified 1.10.1 on the real gruff-go payload: 13 → 0, JSON valid, idempotent.

**Follow-up (2026-07-16): same class, new form — `Write(path)` rules warn while the tool still exists.** Claude Code now warns `Write(**/.env*) is not matched by file permission checks — only Edit(path) rules are` (x13; the release note flags `Write`/`NotebookEdit`/`Glob` rules alike; `Write` stays valid as a hook matcher). Fix mirrored the MultiEdit playbook: the 13 `Write(...)` denies dropped from the template and `.claude/settings.json` (each path keeps `Read`/`Edit`; `Edit` covers all file-editing tools), the migration gained `UNMATCHED_RULE_REWRITES` (Write/NotebookEdit→Edit, Glob→Read, deduped against covering rules), and the parity allow-set tightened to `{Bash,Read,Edit}` across both files. The same pass extended the repair to `allow`/`ask` arrays and `.claude/settings.local.json`, expanded the broad env read deny per the allow-behind-deny footgun below, and added the `settings-rules-matched` audit check so consumer projects that never re-run setup still see stale rules flagged.

**Prevention (4):** When you remove or rename anything that ships into a user-owned config, add BOTH a template guard AND an upgrade migration, and a test that seeds the OLD value in an *existing* file then asserts the upgrade prunes it. A template-only test is false confidence — it passes while every already-installed project stays broken.

## Footgun: Claude allow rules cannot re-open paths behind a broader deny

**Status:** active | **Created:** 2026-07-16 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** `.claude/settings.json` shipped `allow: Read(.env.example), Read(**/.env.example)` next to `deny: Read(**/.env*)`, and the docs claimed the sample file was readable (`docs/harness-audit.md`, `workflow/hooks/README.md`). In practice the Read tool was denied on `.env.example` while the Bash deny hook allowed `cat .env.example` — the two layers disagreed and the allow entries were dead config.

**Why it happens:** Claude Code permission precedence is deny > ask > allow; a deny glob that matches a path cannot be re-opened by any allow rule, and `**/.env*` matches `.env.example`. The Codex template even justified denying `.env.example` on the (false) premise that Claude COULD re-allow it, so the wrong doctrine propagated across three surfaces before anyone probed the actual behaviour.

**Evidence:**
- `workflow/hooks/agent-config/claude.json` and `.claude/settings.json` (search: `Read(**/.env)`) — env read denies are enumerated per variant since 2026-07-16 so `.env.example` matches no deny; `Edit(**/.env*)` still blocks writes.
- `workflow/hooks/agent-config/codex.toml` (search: `env.example stays readable`) — Codex mirrors the enumerated set; the installer migration expands the broad glob in existing installs (search in `workflow/install-goat-flow.sh`: `ENV_READ_DENY_EXPANSION`).
- `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `.env.example read`) — the Bash hook always had the intended policy (reads allowed, writes blocked).

**Prevention:**
1. Never pair an allow rule with a broader deny and expect the allow to win — if an exemption is needed, enumerate the deny so the exempt path simply doesn't match any deny rule.
2. When settings and the Bash hook express the same policy, assert the exemption path on BOTH layers (parity test: `test/unit/agent-config-template-parity.test.ts`, search: `stays readable`; hook self-test: `expect_allow paths "cat .env.example"`).
