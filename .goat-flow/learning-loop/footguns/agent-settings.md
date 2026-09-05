---
category: agent-settings
last_reviewed: 2026-09-05
---

## Footgun: Settings-layer deny globs match guarded phrases quoted inside benign read-only commands

**Status:** active | **Created:** 2026-07-03 | **Evidence:** ACTUAL_MEASURED
**hallucination-risk:** high

**Prevention:**
1. Keep guarded phrases out of the Bash command string when investigating deny or push content: use file-read and search tools instead of shell `grep`, `echo`, or `sed`, or grep a fragment that omits the guarded token. Prefer footgun and lesson titles that avoid guarded literals so future title-greps do not trip the globs.
2. Do not weaken the settings globs (ADR-025), and do not probe with split-variable reconstructions of guarded phrases; the guard rightly refuses evasion-shaped commands.
3. To test hook-layer classification, pipe a JSON payload file into `.goat-flow/hooks/deny-dangerous.sh` or use its `--self-test` modes.

**Symptoms:** A read-only Bash call is denied with `Permission to use Bash with command ... has been denied` and no `BLOCKED:` output. On 2026-07-03 a `sed` whose address quoted a footgun title containing a push phrase and a `grep` whose pattern quoted a push example were both denied before `deny-dangerous.sh` ran, so the block is easy to misattribute to the hook.

**Why it happens:** Settings deny globs match as substrings across the whole command string, quoted arguments included. `.claude/settings.json` and the template `workflow/hooks/agent-config/claude.json` (search: `Bash(*git push*)`, search: `Bash(*git commit*)`) deny any command whose text mentions a guarded phrase. Since 2026-09-02 these are the only settings-layer Bash denies, because the `sudo`, `mkfs`, `dd`, and `git reset --hard` globs were retired under ADR-065 in favour of the hook's tokenizing parser. The hook layer does not share the trap: piping the same text as a `tool_input.command` payload into `.goat-flow/hooks/deny-dangerous.sh` (search: `tool_input.command`) exits 0 for both denied shapes, and the self-test keeps read-only allow canaries at `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `expect_allow`). The bluntness is deliberate per `.goat-flow/learning-loop/decisions/ADR-025-block-all-git-push.md`.

**Evidence:** `.claude/settings.json` (search: `Bash(*git push*)`) and `workflow/hooks/agent-config/claude.json` (search: `Bash(*git commit*)`). On 2026-09-02 two more read-only greps were denied while investigating this rule set, one quoting `sudo ` and one quoting the commit and push phrases, before the redundant globs were retired. The hook-layer sibling is the resolved entry "Deny hook blocks read-only commands with dangerous string literals" in `deny-shell.md`.

## Footgun: Installed settings.json deny patterns can silently drift from workflow templates

**Status:** active | **Created:** 2026-04-26 | **Evidence:** ACTUAL_MEASURED

**Prevention:** After changing any deny pattern in `workflow/hooks/agent-config/*.json`, run `bash scripts/preflight-checks.sh` and confirm `Agent Config Parity` passes. Review installed files against their workflow template, not only against other agent mirrors, and extend the parity map and `covers()` validation whenever a new agent config surface is added.

**Symptoms:** An agent performs an action the template blocks, such as `git push origin feature-branch`, because the installed `.claude/settings.json` drifted to a weaker pattern than the template it was installed from.

**Why it happens:** The template had `Bash(*git push*)` while the installed copy drifted to `Bash(*git push*--force*)`. Preflight then covered skill files and shared references but not settings deny patterns. Its `Agent Config Parity` section now verifies installed settings with `covers()`, so the remaining trap is skipping the check or changing deny semantics without updating the parity rules.

**Evidence:** `workflow/hooks/agent-config/claude.json` (search: `git push`) and `.claude/settings.json` (search: `git push`), fixed 2026-04-26 per ADR-025; `scripts/preflight-checks.sh` (search: `Agent Config Parity`).

## Footgun: Re-adding a removed agent tool (MultiEdit) reprints "matches no known tool" every launch

**Status:** active | **Created:** 2026-06-07 | **Evidence:** ACTUAL_MEASURED
**Incident count:** 3 | **Latest occurrence:** 2026-07-16

**Prevention:**
1. When you remove or rename anything that ships into a user-owned config, add both a template guard and an upgrade migration, plus a test that seeds the old value in an existing file and asserts the upgrade prunes it. A template-only test passes while every already-installed project stays broken.
2. When mirroring permission or hook entries for a tool, confirm the tool exists and that its rule form is matched: file permission checks match only `Edit(path)` and `Read(path)`; `Write` and `NotebookEdit` are hook-matcher-only.
3. When you edit a `workflow/hooks/*.sh` template, re-sync the installed `.goat-flow/hooks/` copy in the same change, or `audit` drift (search: `differs from the current goat-flow template`) fails.

**Symptoms:** Claude Code printed `Permission deny rule "MultiEdit(**/secrets/**)" matches no known tool — check for typos.` twelve times on every launch. Claude Code v2.x folded `MultiEdit` into `Edit` and validates deny rules against known tools at startup, and the issue had already been fixed once (CHANGELOG: "Stale `MultiEdit` permission rules removed (Claude Code v2.x)") before it silently returned.

**Why it happens:** Commit `4e54072e` added the gruff PostToolUse hook and, modelling on the existing `Edit` and `Write` blocks, re-added 12 `MultiEdit(...)` deny rules and a `"matcher": "MultiEdit"` hook entry to `.claude/settings.json` and `.codex/hooks.json`. The prior fix lived only in CHANGELOG prose; no test asserted the absence, and removed-tool rules warn at launch without failing any build.

**Evidence:** Pre-fix `npm run test:fast` was green with the 12 rules present. At the 2026-06-07 fix, the `Edit(...)` denies already covered the same 12 secret paths, so dropping `MultiEdit(...)` lost no coverage: the deny count moved 57 to 45 with every path retaining Read and Edit; the 2026-07-16 follow-up below removed unmatched Write rules. Sources scrubbed: `.claude/settings.json`, `.codex/hooks.json`, `workflow/hooks/agent-config/claude.json`, `src/cli/server/hooks-registry.ts` (matcher `Edit|Write`), `workflow/install-goat-flow.sh` (`gruffHookEntries`), `workflow/hooks/README.md`, and the self-test in `workflow/hooks/gruff-code-quality.sh`. Guards now in place: `test/unit/agent-config-template-parity.test.ts` (search: `never carries a rule form Claude will not match`) locks every Claude permission rule in the template and `.claude/settings.json` to `{Bash,Read,Edit}`; `test/unit/hook-registrar.test.ts` (search: `Edit|Write`) and `test/integration/setup-install-codex-config-migration.test.ts` (search: `/"matcher": "MultiEdit"/`) lock the gruff matcher.

**Recurrence 2026-06-08, template guard insufficient:** the 1.10.0 fix scrubbed templates and added the parity test, and every real user still saw 13 warnings on launch. All five `gruff-workspace` projects upgraded to 1.10.x still carried 13 `MultiEdit(...)` rules, because `workflow/install-goat-flow.sh` (search: `SETTINGS_MIGRATIONS=()`) ran only Codex migrations on an existing settings file and `migrate_agent_hook_config` rewrites `current.hooks`, never `permissions.deny`. 1.10.1 shipped `migrate_claude_permission_deny` in the same installer (search: `migrate_claude_permission_deny`) as a remove-and-rewrite list rather than an allow-list, because a user may legitimately deny unmanaged tools such as `WebFetch` or `mcp__*`. `test/integration/setup-install.test.ts` (search: `prunes removed-tool`) seeds stale plus valid denies and asserts stale forms are pruned, valid ones survive, and a second run is a no-op; verified on the real gruff-go payload, 13 to 0, idempotent.

**Recurrence 2026-07-16, same class in a new form:** Claude Code warned `Write(**/.env*) is not matched by file permission checks — only Edit(path) rules are` thirteen times while `Write` still existed as a hook matcher. The fix dropped the 13 `Write(...)` denies from the template and `.claude/settings.json` (each path keeps `Read` and `Edit`), gave the migration `UNMATCHED_RULE_REWRITES` (Write and NotebookEdit to Edit, Glob to Read, deduped against covering rules), tightened the parity allow-set to `{Bash,Read,Edit}`, extended the repair to `allow` and `ask` arrays and `.claude/settings.local.json`, and added the `settings-rules-matched` audit check so consumers that never re-run setup still see stale rules flagged.

## Resolved Entries

> Historical record. These entries are no longer active traps.

## Footgun: Claude allow rules cannot re-open paths behind a broader deny

**Status:** resolved | **Created:** 2026-07-16 | **Resolved:** 2026-07-17 | **Evidence:** ACTUAL_MEASURED

**Resolution:** The Claude and Codex templates enumerate real env variants so `.env.example` matches no deny, the installer migrates the broad glob in existing installs, parity tests protect `.env.example`, and the hook self-test verifies the read stays allowed. Anchors: `workflow/hooks/agent-config/claude.json` and `.claude/settings.json` (search: `Read(**/.env)`); `workflow/hooks/agent-config/codex.toml` (search: `env.example stays readable`); `workflow/install-goat-flow.sh` (search: `ENV_DENY_EXPANSIONS`); `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `.env.example read`); `test/unit/agent-config-template-parity.test.ts` (search: `stays readable`).

**Original symptoms:** `.claude/settings.json` shipped `allow: Read(.env.example)` beside `deny: Read(**/.env*)`, and docs claimed the sample file was readable, but the Read tool denied it while the Bash hook allowed `cat .env.example`. Claude Code precedence is deny > ask > allow, so no allow rule re-opens a path a deny glob matches; the Codex template even justified denying `.env.example` on the false premise that Claude could re-allow it.

**Prevention retained:** Never pair an allow rule with a broader deny and expect the allow to win; enumerate the deny so the exempt path matches nothing. When settings and the Bash hook express one policy, assert the exemption on both layers.
