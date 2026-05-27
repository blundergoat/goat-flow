---
category: hook-testing
last_reviewed: 2026-05-28
---

## Lesson: Restoring coverage by cloning a monolith is not a real split

**Status:** active | **Created:** 2026-05-27

**What happened:** While restoring lost pre-M10 monolith coverage after the guardrail split, I copied the old parser/checker body into all three split hooks: `guard-destructive-shell.sh`, `guard-secret-paths.sh`, and `guard-repository-writes.sh`. Each file sets a different `GOAT_GUARD_SCOPE` and `reason_in_scope` filters which `block` calls actually exit, so runtime behavior is mostly separated. The implementation is still structurally wrong: every file carries unrelated parsers and checks for secrets, repository writes, destructive shell commands, and npm token deletion.

**Root cause:** I optimized for recovering behavior quickly after finding dropped coverage, but I skipped the design step that should have extracted shared parsing into one source or generated the three guards from one policy table. That turned "split hooks" into three scoped copies of a monolith.

**Prevention:** When splitting a safety hook, define the ownership boundary before porting code. If the hooks must stay self-contained, generate or review each file from explicit function sets: common payload parsing is allowed, but secret, repository, and destructive policy helpers must not cross guard boundaries. A line-count spike across every split file is a review blocker until the duplication is explained or removed. Evidence anchors: `workflow/hooks/guard-destructive-shell.sh` (search: `rm_has_recursive`), `workflow/hooks/guard-secret-paths.sh` (search: `is_secret_path_touch`), `workflow/hooks/guard-repository-writes.sh` (search: `is_gh_write_operation`), and `workflow/hooks/guard-destructive-shell.sh` (search: `npm token delete/revoke`).

## Lesson: Keep generated Bash regexes out of inline conditionals

**Status:** active | **Created:** 2026-05-27

**What happened:** While regenerating the self-contained split hooks, inline Bash EREs lost escaping for `>`, `|`, `<<<`, and quote classes. `bash -n` caught parse failures, and the full guardrails self-test caught `bash -c "echo ok; rm -rf /"` returning exit 0 because the inline quote regex captured only `r` instead of the inner command.

**Root cause:** I generated Bash through JavaScript strings and left complex regexes directly inside `[[ ... =~ ... ]]`, where shell parsing and string escaping both matter.

**Prevention:** In hook scripts, put EREs containing shell metacharacters or quote classes into named variables before matching. Run `bash -n` before mirror fanout, then run the central full self-test before treating behavior as restored. Evidence anchors: `workflow/hooks/guard-common.sh` (search: `shell_c_re`), `workflow/hooks/guard-common.sh` (search: `redirect_append_re`), and `workflow/hooks/guardrails-self-test.sh` (search: `bash -c chained rm`).

## Lesson: Dynamic hook helpers need explicit ShellCheck handling

**Status:** active | **Created:** 2026-05-27

**What happened:** After extracting `guard-common.sh`, I expected `# shellcheck source=guard-common.sh` above the runtime-computed source line to satisfy linting. The repo's hook lint command does not run ShellCheck with `-x`, so ShellCheck failed or warned every mirrored policy hook with SC1091/SC1090 before any behavior checks could matter.

**Root cause:** I treated the source directive as enough without checking it against the exact lint invocation used by preflight and CI.

**Prevention:** For sourced hook helpers resolved through runtime variables, shellcheck the helper as its own input and suppress SC1090/SC1091 only on the dynamic `source` line in each thin policy hook. Verify the workflow and installed mirrors with the same no-`-x` ShellCheck command used by preflight. Evidence anchors: `workflow/hooks/guard-common.sh` (search: `Shared helper library sourced`) and `workflow/hooks/guard-destructive-shell.sh` (search: `shellcheck disable=SC1090,SC1091`).

**Updated 2026-05-27:** M12 moved git parsing into `guard-common.sh`, but ShellCheck still warned in thin hooks with SC2154 because helper-owned output variables (`__goat_git_rest`, `__goat_git_aliased_push`) were assigned dynamically in the sourced file. Initialize helper output variables in each thin hook before first reference so static analysis sees the contract. Evidence anchors: `workflow/hooks/guard-repository-writes.sh` (search: `__goat_git_aliased_push=0`) and `workflow/hooks/guard-secret-paths.sh` (search: `__goat_git_rest=""`).

## Lesson: Shared hook helpers need missing-dependency runtime tests

**Status:** active | **Created:** 2026-05-27

**What happened:** After splitting the guard hooks through `guard-common.sh`, PreToolUse started reporting hook failures with exit code 127 when a thin policy hook could not load the shared helper. The script used `set -uo pipefail`, so a failed `source` did not stop execution; the hook then reached `main "$@"` before `main` existed.

**Root cause:** I tested normal installed mirrors but did not test the degraded install shape where a policy hook exists without its required shared helper. That missed the actual failure users see during partial installs, stale mirrors, or interrupted setup.

**Prevention:** Any Bash hook that sources a shared helper must guard the source path explicitly and include a self-test that runs the hook from a temp directory without the helper. The expected result is a fail-closed guardrail message, never exit 127. Evidence anchors: `workflow/hooks/guard-destructive-shell.sh` (search: `guard_common_unavailable`) and `workflow/hooks/guardrails-self-test.sh` (search: `expect_missing_common_fails_closed`).

## Lesson: Codex hook commands should not depend on shell substitution

**Status:** active | **Created:** 2026-05-27

**What happened:** The live Codex hook config kept reporting three PreToolUse failures with exit code 127 even after the scripts themselves passed. The registered commands were `bash "$(git rev-parse --show-toplevel)/.codex/hooks/..."`, so Codex could fail before the guard script started when command substitution was not resolved in the hook runner context.

**Root cause:** I assumed the Claude-style hook command string was safe for Codex too. The audit parser only needed to see the hook script path, but the runtime needed a command shape Codex can execute directly.

**Prevention:** For Codex `.codex/hooks.json`, register direct project-local script paths such as `.codex/hooks/guard-repository-writes.sh` and verify the exact configured commands from the JSON file, not only direct `bash hook.sh` calls. Evidence anchors: `.codex/hooks.json` (search: `.codex/hooks/guard-repository-writes.sh`) and `src/cli/server/agent-hook-writer.ts` (search: `if (agent.id === "codex") return path`).

## Lesson: Configured-command smoke must execute the registered string

**Status:** active | **Created:** 2026-05-27

**What happened:** M12 found that audit and preflight smoke tests launched hook scripts directly, so they could pass even when an agent config contained a stale command string or a command shape that exited before the hook started. The fix parses `.claude/settings.json`, `.codex/hooks.json`, `.agents/hooks.json`, and `.github/hooks/hooks.json`, then runs each registered guard command with a runtime-shaped safe deny payload.

**Root cause:** The verification target was the hook file, not the runtime contract. That missed exit 126/127 failures caused by stale paths, executable-bit loss, or shell-substitution assumptions.

**Prevention:** Hook verification must include exact configured-command replay in addition to direct script self-tests. Fail hard on exit 126/127, assert the agent-specific deny stream, and coerce `spawnSync` streams with `String(...)` before regex matching because TypeScript can type them as `string | Buffer`. Evidence anchors: `src/cli/audit/check-agent-setup.ts` (search: `runConfiguredHookCommandSmoke`), `scripts/preflight-checks.sh` (search: `configured_hook_smoke_output`), and `test/unit/audit-command.test.ts` (search: `exact configured hook command exits 127`).

## Lesson: Hook parser regressions need false-positive grammar probes

**Status:** active | **Created:** 2026-05-27

**What happened:** M12 closed three parser gaps that the headline block tests missed: `pwsh --command` was allowed while single-dash PowerShell eval forms were blocked, `git --git-dir /tmp/repo push` was allowed while `git --git-dir=/tmp/repo push` was covered, and `git status # .env` plus `jq -r .key file.json` were falsely blocked as secret reads.

**Root cause:** The tests covered obvious dangerous strings and a few equals-valued options, but not valid long-option space forms, shell comments, or dotted query syntax that resembles key-file extensions.

**Prevention:** For shell hooks, build regression matrices from valid CLI grammar and common inert syntax, not only incident strings. Include single-dash and double-dash eval flags, equals-valued and space-valued global options, unquoted shell comments, quoted `#`, jq/yq dotted queries, and filename controls such as `private.key`, `deploy.pem`, and `prod.pfx`. Evidence anchors: `workflow/hooks/guardrails-self-test.sh` (search: `powershell double-dash command remove-item`), `workflow/hooks/guardrails-self-test.sh` (search: `git --git-dir push`), and `workflow/hooks/guardrails-self-test.sh` (search: `jq bare key query`).

## Lesson: Missing-helper self-tests must close stdin

**Status:** active | **Created:** 2026-05-27

**What happened:** `guardrails-self-test.sh --self-test=full` hung on an interactive terminal while copying a thin hook into a temp directory without `guard-common.sh`. The copied hook hit the missing-helper branch before `--check` parsing, then read from the inherited terminal instead of receiving closed stdin.

**Root cause:** The missing-dependency test proved fail-closed behavior only when stdin was already closed. Interactive terminals changed the control flow enough to hide the PASS/FAIL line behind a blocked read.

**Prevention:** Any self-test that intentionally runs a degraded hook or helper must redirect stdin from `/dev/null`, and smoke mode should include the missing-helper branch so startup failures are caught quickly. Evidence anchors: `workflow/hooks/guardrails-self-test.sh` (search: `expect_missing_common_fails_closed`) and `workflow/hooks/guardrails-self-test.sh` (search: `run_common_dependency_checks`).

---

## Lesson: Normalize agent hook payload variants before field access

**Status:** active | **Created:** 2026-05-26

**What happened:** While adding Antigravity hook payload support, I changed the guardrail jq extractor to read `.toolArgs.command` directly. Copilot can send `toolArgs` as a JSON string, so jq errored before reaching the `fromjson?` fallback. `bash workflow/hooks/guardrails-self-test.sh --self-test=full` caught three Copilot deny regressions before the change shipped.

**Root cause:** I added a new agent payload shape without first normalizing the existing polymorphic field shape shared by another agent. The fallback was present, but the earlier direct field access made it unreachable for string payloads.

**Prevention:** For hook payload parsing, normalize variant fields first, then read subfields. Keep self-tests for every registered agent payload shape in `workflow/hooks/guardrails-self-test.sh` (search: `expect_copilot_block`, `expect_antigravity_block`) and run the full self-test after every extractor edit. Evidence anchors: `workflow/hooks/guard-common.sh` (search: `def extract_command(value)`) and `workflow/hooks/guardrails-self-test.sh` (search: `expect_antigravity_secret_file_block`).

## Lesson: Hook write-block tests must vary valid CLI grammar

**Status:** active | **Created:** 2026-05-20

**What happened:** The first GitHub CLI write-block fix covered the reported `gh issue comment ... --body-file ...` command, `gh api` writes, direct read-only controls, and one pre-topic `--repo` form. A follow-up review still found valid write shapes returning exit 0: `gh issue --repo owner/repo comment 64620 --body hi` and `printf '%s\n' body | xargs -I{} gh issue comment 64620 --body {}`.

**Root cause:** I tested the incident shape and a few nearby commands, but not the CLI grammar surface. GitHub CLI accepts inherited flags after the topic, and shell pipeline consumers can move the real command behind a wrapper such as `xargs`.

**Prevention:** For hook rules that classify write-capable CLI commands, build the regression set as a grammar matrix before mirror fanout: direct incident form, global flags before topic, inherited flags after topic, short flag forms, shell wrappers, pipeline consumers such as `xargs`, write-method API forms, and read-only allow controls. Evidence anchors: `workflow/hooks/guard-repository-writes.sh` (search: `is_gh_write_operation`), `workflow/hooks/guardrails-self-test.sh` (search: `gh issue comment`).
