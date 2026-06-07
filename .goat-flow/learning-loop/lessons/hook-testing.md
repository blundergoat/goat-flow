---
category: hook-testing
last_reviewed: 2026-06-07
---

## Lesson: deny-dangerous self-test missed a whole false-positive class while green

**Status:** active | **Created:** 2026-06-06

**What happened:** A downstream agent hit `Policy destructive: Complex command substitution` on benign `$()` inside a `for` loop, yet `deny-dangerous.sh --self-test=smoke` reported `executed=23, skipped=0` PASS. The corpus had no allow case for a command substitution containing a control operator (`||`/`;`), nor for arithmetic `$(())`, nor for a `.env.example` read carrying `2>&1` - so three real false-positive classes shipped behind a green suite.

**Root cause:** The corpus over-indexed on dangerous block cases plus a few canonical allow cases. Parser regressions surface as false positives on benign-but-structurally-varied input (operators inside substitutions, arithmetic, redirects on allowlisted reads), which the curated allow set did not vary.

**Prevention:** For guardrail parsers, vary shell *structure* in the allow corpus, not just verbs: substitutions with/without inner operators, quoted vs unquoted, arithmetic expansion, process substitution, and redirects (`2>&1`, `2>/dev/null`, redirect-to-other-file) on allowlisted-readable files - each paired with its dangerous counterpart. A green smoke run proves only the cases present. Also: when a report fingers a downstream rule (a catch-all), trace the token that rule sees back to the tokenizer before relaxing it - here the catch-all was correct and the orphan `$(` was manufactured upstream by the segment splitter. Evidence anchors: `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `unquoted subst with || fallback`), (search: `arithmetic expansion`), (search: `.env.example read with stderr dup`); root-cause anchor in `.goat-flow/learning-loop/footguns/deny-dangerous.md` (search: `track substitution depth`).

---

## Lesson: Copilot JSON hook probes must use Copilot-shaped payloads

**Status:** active | **Created:** 2026-06-07

**What happened:** During M07-M10 verification, I first tried to manually prove the no-jq Copilot deny path by setting `HOOK_OUTPUT_MODE=json` and invoking `deny-dangerous.sh --check`. The hook returned the normal stderr `BLOCKED:` message with exit 2, which looked like a contract mismatch. Re-running the probe with the actual Copilot payload shape, no `--check`, and `GOAT_DENY_FORCE_NO_JQ=1` returned `{"permissionDecision":"deny",...}` and `no-jq-copilot exit:0`.

**Root cause:** I invented an output-mode environment switch instead of reading the hook's `detect_output_mode` path and existing self-test helper. Copilot JSON mode is selected from payload shape (`toolName` / `toolArgs`), and Copilot denies intentionally exit 0 so the host can consume the JSON decision.

**Prevention:** Manual Copilot/no-jq hook probes must copy the self-test contract: feed a top-level Copilot payload such as `{"toolName":"bash","toolArgs":"{\"command\":\"...\"}"}` to `bash workflow/hooks/deny-dangerous.sh` without `--check`, with `GOAT_DENY_FORCE_NO_JQ=1` only when testing the fallback parser. Evidence anchors: `workflow/hooks/deny-dangerous.sh` (search: `detect_output_mode`) and `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `expect_no_jq_copilot_block`).

---

## Lesson: Codex sandbox hook probes must distinguish direct Bash from Node child-process

**Status:** active | **Created:** 2026-06-05

**What happened:** During the v1.9.1 quality follow-up, I first rejected a Codex sandbox finding after `codex sandbox --permissions-profile goat-flow ... bash .goat-flow/hooks/deny-dangerous/deny-dangerous-self-test.sh --self-test=smoke` passed. A stricter repro then showed the real failing layer: the same sandbox allowed direct Bash, but a Node script using `execFileSync("bash", ["-n", hook])` and `spawnSync("bash", ...)` returned `EPERM`. The audit therefore reported `bash -n failed` even though direct `bash -n` on the hook passed.

**Root cause:** I treated direct shell execution as equivalent to the Node child-process path used by audit and preflight. Codex's managed sandbox can allow the initial Bash process while blocking child processes spawned from Node, so direct hook self-tests are necessary but not sufficient evidence for TypeScript validation gates.

**Prevention:** When a sandbox finding involves audit/preflight hook checks, reproduce the exact runtime layer: direct hook script, configured command smoke, and a Node `child_process` probe. Audit and preflight diagnostics must surface `EPERM`/`ENOENT`/timeout as environment failures instead of syntax or hook-behavior defects. Evidence anchors: `src/cli/audit/check-agent-deny-mechanism.ts` (search: `spawnFailureFor`), `scripts/preflight-checks.sh` (search: `spawnFailureMessage`), and `test/unit/audit-command/agent-deny-hooks.test.ts` (search: `reports sandbox spawn denial`).

**Updated 2026-06-05:** A follow-up probe showed two subtler cases: Node `execFileSync` / `spawnSync` can attach `EPERM` error metadata while also reporting a successful child status and expected stdout/stderr, and `spawnSync(..., { input })` can hang while a shell-side `printf` pipe completes. Treating any `result.error` as fatal caused a false audit failure after the hook had actually completed; pushing runtime JSON through Node-owned stdin caused configured-command smoke timeouts. Prevention: check `status` before classifying child-process errors, and feed hook runtime payloads through a shell-side pipe when validating from Node in the Codex sandbox. Evidence anchors: `src/cli/audit/check-agent-deny-mechanism.ts` (search: `pipeSmokePayloadTo`), `scripts/preflight-checks.sh` (search: `GOAT_HOOK_SMOKE_PAYLOAD`), and `test/unit/audit-command/agent-deny-hooks.test.ts` (search: `ignores sandbox error metadata when hook commands completed`).

---

## Lesson: Manual hook matrices must avoid live-guard self-interference

**Status:** active | **Created:** 2026-06-03

**What happened:** During a manual pass over `.goat-flow/hooks/deny-dangerous.sh` and `.goat-flow/hooks/gruff-code-quality.sh`, my first all-in-one shell harness was blocked by the active PreToolUse guard for having more than 50 chained segments. Smaller batches then tripped the same live guard with command substitution, fixed `printf | bash hook` payload replay, and literal `.env.example` strings in the outer verification command. A temporary gruff harness also leaked `/tmp/goat-flow-gruff-case.*` directories because root creation happened inside command substitutions, so the parent cleanup array never recorded them.

**Root cause:** I treated the verification shell as neutral while testing the same guardrail family that inspects shell text. The outer command was itself subject to `deny-dangerous.sh`, so payload replay patterns that are safe inside a test harness (`pipe to bash`, literal secret paths, long case bodies) were blocked before the hook under test ran.

**Prevention:** For manual guardrail matrices, either run one direct case at a time or create a temporary harness file whose invocation command is boring (`bash tmp_harness.sh`). Construct secret-path payloads from variables when the outer live guard would otherwise see them, avoid `printf | bash hook` in favor of here-strings or files, and record temp roots in the parent shell before using command substitution. Evidence anchors: `.goat-flow/hooks/deny-dangerous.sh` (search: `Command has more than 50 chained segments`), `.goat-flow/hooks/deny-dangerous/patterns-shell.sh` (search: `Pipe to shell`), and `.goat-flow/learning-loop/lessons/verification-testing.md` (search: `Temp cleanup must satisfy destructive-command hooks`).

---

## Lesson: Format patched hook test fixtures before full preflight

**Status:** active | **Created:** 2026-06-02

**What happened:** While porting gruff-py's native changed-region hook path into `workflow/hooks/gruff-code-quality.sh`, the focused hook test, shellcheck, and typecheck passed, but the first `bash scripts/preflight-checks.sh` run failed the TypeScript gate because Prettier found one unformatted file after the new integration-test fixture was added.

**Root cause:** I hand-edited a TypeScript hook test fixture with a long embedded shell script and assertion, then went straight to full preflight instead of running the targeted Prettier check on the changed test file.

**Prevention:** After patching TypeScript hook tests with template literals, long strings, or generated fixture scripts, run `npx prettier --check <changed-test-file>` before full preflight, or format the changed file immediately. If preflight reports a Prettier-only failure, format the changed file, rerun the focused test, then rerun preflight. Evidence anchors: `test/integration/gruff-code-quality-smoke.test.ts` (search: `writeNativeChangedRegionGruffPy`) and `scripts/preflight-checks.sh` (search: `Prettier`).

**Updated 2026-06-03:** The same check caught formatting drift in a TypeScript audit message patch before full preflight. Evidence anchor: `src/cli/audit/check-agent-deny-mechanism.ts` (search: `configured hook command exited before`).

---

## Lesson: Restoring coverage by cloning a monolith is not a real split

**Status:** active | **Created:** 2026-05-27

**What happened:** While restoring lost pre-M10 monolith coverage after the guardrail split, I copied the old parser/checker body into all three split hooks: `patterns-shell.sh`, `patterns-paths.sh`, and `patterns-writes.sh`. Each file sets a different `GOAT_GUARD_SCOPE` and `reason_in_scope` filters which `block` calls actually exit, so runtime behavior is mostly separated. The implementation is still structurally wrong: every file carries unrelated parsers and checks for secrets, repository writes, destructive shell commands, and npm token deletion.

**Root cause:** I optimized for recovering behavior quickly after finding dropped coverage, but I skipped the design step that should have extracted shared parsing into one source or generated the three guards from one policy table. That turned "split hooks" into three scoped copies of a monolith.

**Prevention:** When splitting a safety hook, define the ownership boundary before porting code. If the hooks must stay self-contained, generate or review each file from explicit function sets: common payload parsing is allowed, but secret, repository, and destructive policy helpers must not cross guard boundaries. A line-count spike across every split file is a review blocker until the duplication is explained or removed. Evidence anchors: `workflow/hooks/deny-dangerous/patterns-shell.sh` (search: `rm_has_recursive`), `workflow/hooks/deny-dangerous/patterns-paths.sh` (search: `is_secret_path_touch`), `workflow/hooks/deny-dangerous/patterns-writes.sh` (search: `is_gh_write_operation`), and `workflow/hooks/deny-dangerous/patterns-shell.sh` (search: `npm token delete/revoke`).

## Lesson: Keep generated Bash regexes out of inline conditionals

**Status:** active | **Created:** 2026-05-27

**What happened:** While regenerating the self-contained split hooks, inline Bash EREs lost escaping for `>`, `|`, `<<<`, and quote classes. `bash -n` caught parse failures, and the full deny-dangerous self-test caught `bash -c "echo ok; rm -rf /"` returning exit 0 because the inline quote regex captured only `r` instead of the inner command.

**Root cause:** I generated Bash through JavaScript strings and left complex regexes directly inside `[[ ... =~ ... ]]`, where shell parsing and string escaping both matter.

**Prevention:** In hook scripts, put EREs containing shell metacharacters or quote classes into named variables before matching. Run `bash -n` before mirror fanout, then run the central full self-test before treating behavior as restored. Evidence anchors: `workflow/hooks/deny-dangerous.sh` (search: `shell_c_re`), `workflow/hooks/deny-dangerous.sh` (search: `redirect_append_re`), and `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `bash -c chained rm`).

## Lesson: Dynamic hook helpers need explicit ShellCheck handling

**Status:** active | **Created:** 2026-05-27

**What happened:** After extracting `deny-dangerous.sh`, I expected `# shellcheck source=deny-dangerous.sh` above the runtime-computed source line to satisfy linting. The repo's hook lint command does not run ShellCheck with `-x`, so ShellCheck failed or warned every mirrored policy hook with SC1091/SC1090 before any behavior checks could matter.

**Root cause:** I treated the source directive as enough without checking it against the exact lint invocation used by preflight and CI.

**Prevention:** For sourced hook helpers resolved through runtime variables, shellcheck the helper as its own input and suppress SC1090/SC1091 only on the dynamic `source` line in the dispatcher. Verify the workflow and installed mirrors with the same no-`-x` ShellCheck command used by preflight. Evidence anchors: `workflow/hooks/deny-dangerous.sh` (search: `source "$GOAT_HOOK_LIB_DIR/patterns-shell.sh"`) and `workflow/hooks/deny-dangerous.sh` (search: `shellcheck disable=SC1090,SC1091`).

**Updated 2026-05-27:** M12 moved git parsing into `deny-dangerous.sh`, but ShellCheck still warned in thin hooks with SC2154 because helper-owned output variables (`__goat_git_rest`, `__goat_git_aliased_push`) were assigned dynamically in the sourced file. Initialize helper output variables in each thin hook before first reference so static analysis sees the contract. Evidence anchors: `workflow/hooks/deny-dangerous/patterns-writes.sh` (search: `__goat_git_aliased_push=0`) and `workflow/hooks/deny-dangerous/patterns-paths.sh` (search: `__goat_git_rest=""`).

## Lesson: Shared hook helpers need missing-dependency runtime tests

**Status:** active | **Created:** 2026-05-27

**What happened:** After splitting the guard hooks through `deny-dangerous.sh`, PreToolUse started reporting hook failures with exit code 127 when a thin policy hook could not load the shared helper. The script used `set -uo pipefail`, so a failed `source` did not stop execution; the hook then reached `main "$@"` before `main` existed.

**Root cause:** I tested normal installed mirrors but did not test the degraded install shape where a policy hook exists without its required shared helper. That missed the actual failure users see during partial installs, stale mirrors, or interrupted setup.

**Prevention:** Any Bash hook that sources a shared helper must guard the source path explicitly and include a self-test that runs the hook from a temp directory without the helper. The expected result is a fail-closed guardrail message, never exit 127. Evidence anchors: `workflow/hooks/deny-dangerous.sh` (search: `deny_dangerous_unavailable`) and `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `expect_missing_common_fails_closed`).

## Lesson: Codex hook commands should not depend on shell substitution

**Status:** active | **Created:** 2026-05-27

**What happened:** The live Codex hook config kept reporting three PreToolUse failures with exit code 127 even after the scripts themselves passed. The registered commands were `bash "$(git rev-parse --show-toplevel)/.codex/hooks/..."`, so Codex could fail before the guard script started when command substitution was not resolved in the hook runner context.

**Root cause:** I assumed the Claude-style hook command string was safe for Codex too. The audit parser only needed to see the hook script path, but the runtime needed a command shape Codex can execute directly.

**Prevention:** For Codex `.codex/hooks.json`, register direct project-local script paths such as `.goat-flow/hooks/deny-dangerous.sh` and verify the exact configured commands from the JSON file, not only direct `bash hook.sh` calls. Evidence anchors: `.codex/hooks.json` (search: `.goat-flow/hooks/deny-dangerous.sh`) and `src/cli/server/agent-hook-writer.ts` (search: `if (agent.id === "codex") return path`).

## Lesson: Configured hook smoke must verify the registered guard path

**Status:** active | **Created:** 2026-05-27

**What happened:** M12 found that audit and preflight smoke tests launched hook scripts directly, so they could pass even when an agent config contained a stale command string or a command shape that exited before the hook started. The fix parses `.claude/settings.json`, `.codex/hooks.json`, `.agents/hooks.json`, and `.github/hooks/hooks.json`, requires an exact configured guard script path, then runs that script with a runtime-shaped safe deny payload.

**Root cause:** The verification target was the hook file, not the runtime contract. That missed stale paths, executable-bit loss, and shell-substitution assumptions before guard code could run.

**Prevention:** Hook verification must include configured guard-script replay in addition to direct script self-tests. Reject commands that hide the script path inside shell text, fail hard on exit 126/127 for the extracted script, and assert the agent-specific deny stream from the configured script path. Evidence anchors: `src/cli/audit/check-agent-deny-mechanism.ts` (search: `runConfiguredHookCommandSmoke`), `scripts/preflight-checks.sh` (search: `configured_hook_smoke_output`), and `test/unit/audit-command/agent-deny-hooks.test.ts` (search: `hides the script path in shell text`).

## Lesson: Hook parser regressions need false-positive grammar probes

**Status:** active | **Created:** 2026-05-27

**What happened:** M12 closed three parser gaps that the headline block tests missed: `pwsh --command` was allowed while single-dash PowerShell eval forms were blocked, `git --git-dir /tmp/repo push` was allowed while `git --git-dir=/tmp/repo push` was covered, and `git status # .env` plus `jq -r .key file.json` were falsely blocked as secret reads.

**Root cause:** The tests covered obvious dangerous strings and a few equals-valued options, but not valid long-option space forms, shell comments, or dotted query syntax that resembles key-file extensions.

**Prevention:** For shell hooks, build regression matrices from valid CLI grammar and common inert syntax, not only incident strings. Include single-dash and double-dash eval flags, equals-valued and space-valued global options, unquoted shell comments, quoted `#`, jq/yq dotted queries, and filename controls such as `private.key`, `deploy.pem`, and `prod.pfx`. Evidence anchors: `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `powershell double-dash command remove-item`), `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `git --git-dir push`), and `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `jq bare key query`).

## Lesson: Missing-helper self-tests must close stdin

**Status:** active | **Created:** 2026-05-27

**What happened:** `deny-dangerous-self-test.sh --self-test=full` hung on an interactive terminal while copying a thin hook into a temp directory without `deny-dangerous.sh`. The copied hook hit the missing-helper branch before `--check` parsing, then read from the inherited terminal instead of receiving closed stdin.

**Root cause:** The missing-dependency test proved fail-closed behavior only when stdin was already closed. Interactive terminals changed the control flow enough to hide the PASS/FAIL line behind a blocked read.

**Prevention:** Any self-test that intentionally runs a degraded hook or helper must redirect stdin from `/dev/null`, and smoke mode should include the missing-helper branch so startup failures are caught quickly. Evidence anchors: `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `expect_missing_common_fails_closed`) and `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `run_common_dependency_checks`).

---

## Lesson: Normalize agent hook payload variants before field access

**Status:** active | **Created:** 2026-05-26

**What happened:** While adding Antigravity hook payload support, I changed the guardrail jq extractor to read `.toolArgs.command` directly. Copilot can send `toolArgs` as a JSON string, so jq errored before reaching the `fromjson?` fallback. `bash workflow/hooks/deny-dangerous.sh --self-test=full` caught three Copilot deny regressions before the change shipped.

**Root cause:** I added a new agent payload shape without first normalizing the existing polymorphic field shape shared by another agent. The fallback was present, but the earlier direct field access made it unreachable for string payloads.

**Prevention:** For hook payload parsing, normalize variant fields first, then read subfields. Keep self-tests for every registered agent payload shape in `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `expect_copilot_block`, `expect_antigravity_block`) and run the full self-test after every extractor edit. Evidence anchors: `workflow/hooks/deny-dangerous.sh` (search: `def extract_command(value)`) and `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `expect_antigravity_secret_file_block`).

**Updated 2026-06-05:** The same parser gap recurred for file-tool paths instead of shell commands: jq normalized stringified Copilot `toolArgs` for `command`, but the path extractor did not parse stringified `path` / `file_path`. Safe non-bash payloads such as Copilot `view README.md` returned deny JSON until `extract_path` normalized object and string forms. Evidence anchors: `workflow/hooks/deny-dangerous.sh` (search: `def extract_path(value)`) and `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `stringified non-bash file read`).

## Lesson: Hook write-block tests must vary valid CLI grammar

**Status:** active | **Created:** 2026-05-20

**What happened:** The first GitHub CLI write-block fix covered the reported `gh issue comment ... --body-file ...` command, `gh api` writes, direct read-only controls, and one pre-topic `--repo` form. A follow-up review still found valid write shapes returning exit 0: `gh issue --repo owner/repo comment 64620 --body hi` and `printf '%s\n' body | xargs -I{} gh issue comment 64620 --body {}`.

**Root cause:** I tested the incident shape and a few nearby commands, but not the CLI grammar surface. GitHub CLI accepts inherited flags after the topic, and shell pipeline consumers can move the real command behind a wrapper such as `xargs`.

**Prevention:** For hook rules that classify write-capable CLI commands, build the regression set as a grammar matrix before mirror fanout: direct incident form, global flags before topic, inherited flags after topic, short flag forms, shell wrappers, pipeline consumers such as `xargs`, write-method API forms, and read-only allow controls. Evidence anchors: `workflow/hooks/deny-dangerous/patterns-writes.sh` (search: `is_gh_write_operation`), `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `gh issue comment`).

**Note (2026-06-02):** ADR-028 was amended to allow `gh issue comment` and `gh pr comment` through the hook (other `gh` writes still blocked). The specific block this lesson originally described no longer applies to comments, but the methodological lesson - test the CLI grammar matrix, not only the incident command - stands. The grammar matrix in the self-test now covers both blocked (`gh pr review`, `gh workflow run`, `gh api ... -X POST -f body=...`) and allowed (`gh issue comment`, `gh pr comment`) cases, so the prevention rule still has live coverage.
