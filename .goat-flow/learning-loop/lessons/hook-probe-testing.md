---
category: hook-probe-testing
last_reviewed: 2026-08-19
---

**Scope:** Driving a hook with realistic input - per-agent payload shapes, sandbox and interpreter controls, registered-path smokes, and grammar probes that catch false positives. The script under test is [hook-script-authoring.md](hook-script-authoring.md).

## Lesson: Interpreter-pipe tests need flag-operand and producer-language controls

**Status:** active | **Created:** 2026-07-05

**What happened:** A review of the local-data-to-interpreter pipe fix found two gaps after the full self-test was green. `cat script.js | node --require ./package.json` returned exit 0 even though Node executed stdin as the program, because the classifier treated the path-shaped `--require` operand as a script file. `printf x | sed '1e echo SED_EXECUTED' | python3 -c ...` also returned exit 0 while the producer executed a command, because `sed`/`awk` were included in a "read-only producer" allowlist.

**Root cause:** The added grammar matrix covered bare interpreters, `-`, `/dev/stdin`, `python -m`, non-path flag values, downloader latching, and script-file allows, but it did not include path-shaped interpreter flag operands or command-capable producer languages. The test corpus proved the intended examples, not the edges where "path-shaped" and "read-only" assumptions break.

**Prevention:** Every interpreter-pipe exemption needs paired controls for (1) a flag operand that looks like a script path but is not positional code, (2) a real script path after that same flag, and (3) producer tools that can execute commands before emitting bytes. Run those controls through the live dispatcher path before declaring the self-test enough. Evidence anchors: `workflow/hooks/deny-dangerous/patterns-shell.sh` (search: `interpreter_option_action`), (search: `is_local_data_pipe_source`), and `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `node require flag operand is not a script file`), (search: `sed producer with shell escape stays blocked`), (search: `local data pipe to node script after require flag`).

---

## Lesson: Copilot JSON hook probes must use Copilot-shaped payloads

**Status:** active | **Created:** 2026-06-07

**What happened:** A cross-version no-jq probe set an invented JSON-mode switch and called the hook's direct-check interface. That produced stderr and exit 2; the real Copilot-shaped payload returned a JSON denial through the host's expected exit path.

**Root cause:** I invented an output-mode environment switch instead of reading the hook's `detect_output_mode` path and existing self-test helper. Copilot JSON mode is selected from payload shape (`toolName` / `toolArgs`), and Copilot denies intentionally exit 0 so the host can consume the JSON decision.

**Prevention:** Manual Copilot/no-jq hook probes must copy the self-test contract: feed a top-level Copilot payload such as `{"toolName":"bash","toolArgs":"{\"command\":\"...\"}"}` to `bash workflow/hooks/deny-dangerous.sh` without `--check`, with `GOAT_DENY_FORCE_NO_JQ=1` only when testing the fallback parser. Evidence anchors: `workflow/hooks/deny-dangerous.sh` (search: `detect_output_mode`) and `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `expect_no_jq_copilot_block`).

---

## Lesson: Codex sandbox hook probes must distinguish direct Bash from Node child-process

**Status:** active | **Created:** 2026-06-05

**What happened:** During the v1.9.1 quality follow-up, I first rejected a Codex sandbox finding after `codex sandbox --permissions-profile goat-flow ... bash .goat-flow/hooks/deny-dangerous/deny-dangerous-self-test.sh --self-test=smoke` passed. A stricter repro then showed the real failing layer: the same sandbox allowed direct Bash, but a Node script using `execFileSync("bash", ["-n", hook])` and `spawnSync("bash", ...)` returned `EPERM`. The audit therefore reported `bash -n failed` even though direct `bash -n` on the hook passed.

**Root cause:** I treated direct shell execution as equivalent to the Node child-process path used by audit and preflight. Codex's managed sandbox can allow the initial Bash process while blocking child processes spawned from Node, so direct hook self-tests are necessary but not sufficient evidence for TypeScript validation gates.

**Prevention:** When a sandbox finding involves audit/preflight hook checks, reproduce the exact runtime layer: direct hook script, configured command smoke, and a Node `child_process` probe. Audit and preflight diagnostics must surface `EPERM`/`ENOENT`/timeout as environment failures instead of syntax or hook-behavior defects. Evidence anchors: `src/cli/audit/check-agent-deny-runtime.ts` (search: `spawnFailureFor`), `scripts/preflight-checks.sh` (search: `spawnFailureMessage`), and `test/unit/audit-command/agent-deny-hooks.test.ts` (search: `reports sandbox spawn denial`).

**Updated 2026-06-05:** A follow-up probe showed two subtler cases: Node `execFileSync` / `spawnSync` can attach `EPERM` error metadata while also reporting a successful child status and expected stdout/stderr, and `spawnSync(..., { input })` can hang while a shell-side `printf` pipe completes. Treating any `result.error` as fatal caused a false audit failure after the hook had actually completed; pushing runtime JSON through Node-owned stdin caused configured-command smoke timeouts. Prevention: check `status` before classifying child-process errors, and feed hook runtime payloads through a shell-side pipe when validating from Node in the Codex sandbox. Evidence anchors: `src/cli/audit/check-agent-deny-runtime.ts` (search: `pipeRuntimeProbeTo`), `scripts/preflight-checks.sh` (search: `GOAT_HOOK_SMOKE_PAYLOAD`), and `test/unit/audit-command/agent-deny-hooks.test.ts` (search: `ignores sandbox error metadata when hook commands completed`).

---

## Lesson: Configured hook smoke must verify the registered guard path

**Status:** active | **Created:** 2026-05-27 | **Incident count:** 10 | **Latest occurrence:** 2026-08-16

**Decision changed:** Treat configured replay as a safe-and-dangerous semantic matrix, and make mocks identify the command boundary rather than infer it from call order.

**Trigger phase:** VERIFY

**What happened:** A configured-hook review found that audit and preflight smoke tests launched hook scripts directly, so they could pass even when an agent config contained a stale command string or a command shape that exited before the hook started. The fix parses `.claude/settings.json`, `.codex/hooks.json`, `.agents/hooks.json`, and `.github/hooks/hooks.json`, requires an exact configured guard script path, then runs that script with runtime-shaped safe and dangerous payloads.

**Root cause:** The verification target was the hook file, not the runtime contract. That missed stale paths, executable-bit loss, and shell-substitution assumptions before guard code could run.

**Recurrence 2026-08-09:** Expanding configured replay from one dangerous probe to safe-plus-dangerous exposed two mocks that returned a deny result for every spawn. The first correction encoded a fixed call count and failed again because its implicit project path did not create the expected descendant replay. The fixture was rewound to distinguish the configured launcher from the later direct `bash` replay by semantic command shape. Evidence anchor: `test/unit/audit-command/agent-deny-hooks.test.ts` (search: `configuredRuntimeProbeCalls`).

**Recurrence 2026-08-09 (drift fixture):** The timeout-drift test changed `60` to `90` and expected a pass, but its direct `bash .goat-flow/hooks/post-turn-safety.sh` command was independently stale under the new command-identity contract. Rebuilding the fixture from `buildAgentHookCommand` and mutating only the timeout restored a true single-axis test. Evidence anchor: `test/integration/audit-drift-checkdrift-hook-templates.test.ts` (search: `postTurnSafetySpec`).

**Recurrence 2026-08-09 (outcome wording):** The comment and naming pass changed the user-visible probe outcome from `safe allow` to `allow`, but one focused assertion still matched `safe`. The audit suite caught the stale contract before final proof. Evidence anchor: `src/cli/audit/check-agent-deny-runtime.ts` (search: `expectedOutcome`).

**Recurrence 2026-08-10:** A recursive self-test created a fixture repository but invoked its hook from the framework working directory, so it scanned the wrong checkout. Resolve the hook path, enter the fixture, then invoke it. Evidence: `workflow/hooks/post-turn-safety.sh` (search: `The recursive hook resolves the current project`).

**Recurrence 2026-08-09 (support metadata):** A matrix-helper refactor treated `unsupportedAgents` like a boolean map and compared its values with literal `true`; the registry actually stores non-empty reason strings. Cross-agent install tests then expected Codex Gruff and Antigravity/Copilot post-turn hooks to install. Evidence anchor: `test/integration/setup-install-agent-matrix.test.ts` (search: `shouldInstallHook`).

**Recurrence 2026-08-09 (namespaced launcher mode):** Generated commands moved from one-word response modes to a six-field delivery contract, but the startup bootstrap still matched only the legacy words. Registrar fixtures then showed Claude Gruff, Antigravity policy, and Copilot policy startup failures all falling through to the generic policy response. Decoding the generated provider and response kind before choosing startup output restored each user-facing contract. Evidence anchors: `src/cli/server/agent-hook-command.ts` (search: `hasNamespacedResponseMode`) and `test/unit/hook-registrar.helpers.ts` (search: `assertHookUnavailableResponse`).

**Recurrence 2026-08-09 (partial hook propagation):** A dormant adapter changed legacy commands and file lists before installer propagation, so the cross-agent matrix passed only 1 of 13 cases. Protocol-gating adapter loads and namespaced modes restored 12; deferring a separate Antigravity support removal restored 13 of 13. Evidence anchors: `src/cli/server/agent-hook-command.ts` (search: `legacyHookLaunchMode`), `workflow/hooks/run-with-bash.mjs` (search: `LEGACY_HOOK_DEADLINES_MS`), and `test/integration/setup-install-agent-matrix.test.ts` (search: `diverged between installer and writer`).

**Recurrence 2026-08-10 (standalone protocol precedence):** The TypeScript writer chose Gruff before provider policy, while the standalone installer checked Copilot first. The matrix passed 43 of 44 cases until precedence matched. The generated contract now removes that second decision. Evidence anchors: `src/cli/server/agent-hook-command.ts` (search: `responseKind === "gruff"`) and `test/integration/setup-install-agent-matrix.test.ts` (search: `diverged between installer and writer`).

**Recurrence 2026-08-16 (overbroad execution sentinel):** The first static-audit regression test counted every `spawnSync` call as target hook execution. A fixed read-only `git rev-parse --show-toplevel` from hook-state inspection made the safe implementation fail `1 !== 0`. Narrowing the sentinel to calls carrying a provider-shaped hook payload separated configured-launcher probes from unrelated bounded subprocesses. Evidence anchor: `test/unit/audit-deny-runtime-flag.test.ts` (search: `GOAT_HOOK_SMOKE_PAYLOAD`).

**Recurrence 2026-08-16 (implicit runtime fixture):** After audit omission became static, the full suite found three configured-launcher drift cases that still expected runtime evidence from a context with no evidence level. The production guard correctly returned no runtime finding; the runtime-focused fixtures now opt into `full` explicitly through `makeRuntimeCtx`, while later template-only fixtures retain the static default. Evidence anchor: `test/unit/audit-command/agent-deny-hooks-drift.test.ts` (search: `makeRuntimeCtx`).

**Prevention:** Verify configured guard replay as well as direct self-tests. Run safe and dangerous payloads from each audited cwd, require policy-specific denial text, reject hidden script paths, and fail on exit 126/127. Test doubles branch on payload and command shape, never spawn order. Build single-axis drift fixtures from the canonical command, then grep renamed outcomes and rerun their message assertions. A non-empty `unsupportedAgents` reason means unsupported. Protocol seams keep legacy commands and files unchanged; support changes update writer and installer atomically. Test both launcher decoding and startup output when a generated mode changes. Evidence anchors: `src/cli/audit/check-agent-deny-runtime.ts` (search: `configuredRuntimeProbes`), `scripts/preflight-checks.sh` (search: `configured_hook_smoke_output`), and `test/unit/audit-command/agent-deny-hooks.test.ts` (search: `hides the script path in shell text`).

## Lesson: Hook parser regressions need false-positive grammar probes

**Status:** active | **Created:** 2026-05-27
**Incident count:** 2 | **Latest occurrence:** 2026-08-19

**What happened:** A parser-hardening pass found missing PowerShell and Git option forms plus false positives for shell comments and dotted query syntax.

**Root cause:** The tests covered obvious dangerous strings and a few equals-valued options, but not valid long-option space forms, shell comments, or dotted query syntax that resembles key-file extensions.

**Recurrence 2026-08-19:** A jq/yq false-positive repair added a quote-aware filter-role parser but tested jq's ordinary `-f` form and yq's bare dotted expression only. Fresh review found protected-file bypasses behind jq short bundles, yq boolean flags, yq implicit inputs, attached expression options, and file-valued options; it also found `yq eval` blocked as shell `eval`. The expanded RED corpus failed 9 of 463 cases before the parser split the two command grammars; the final installed and workflow corpora each pass 470 cases after harmless jq data options were separated from file-reading options. Evidence anchors: `workflow/hooks/deny-dangerous/patterns-paths.sh` (search: `yq auto-detects whether a positional token is an expression or a file`), `workflow/hooks/deny-dangerous/patterns-shell.sh` (`check_destructive_segment`), and `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `jq literal key-looking string argument`; search: `jq bundled raw filter file`; search: `yq eval subcommand key query`).

**Prevention:** For shell hooks, build regression matrices from valid per-command grammar and common inert syntax, not only incident strings. Record whether every short or long option is standalone, consumes one or more values, accepts an equals or attached value, supplies the primary expression, or reads a file. Include CLI subcommands that collide with shell keywords, unquoted comments, quoted `#`, jq/yq dotted queries, and filename controls such as `private.key`, `deploy.pem`, and `prod.pfx`. Evidence anchors: `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `powershell double-dash command remove-item`), (search: `git --git-dir push`), (search: `jq bundled raw filter file`), and (search: `yq eval subcommand key query`).

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
