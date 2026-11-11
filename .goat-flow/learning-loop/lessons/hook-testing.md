---
category: hook-testing
last_reviewed: 2026-11-11
---

**Scope:** Hook test coverage strategy - what a self-test or fixture actually exercises, which suites and CI jobs run a changed hook, fixtures that must not carry real secrets, and splits that only look like coverage. What a run proves about a provider is [hook-support-evidence.md](hook-support-evidence.md); the script under test is [hook-script-authoring.md](hook-script-authoring.md); driving it with payloads is [hook-probe-testing.md](hook-probe-testing.md).

## Lesson: Source verification must distinguish absent and incomplete trees

**Status:** active | **Created:** 2026-09-27
**Decision changed:** When source checks are optional for consumers, detect the source directory and validate every required member; do not use one required member as the availability gate.
**Trigger phase:** ACT
**Caught at:** VERIFY

**Prevention:** Exercise complete source, incomplete source, and consumer-only trees through the documented command. Incomplete source must fail before running suites; consumers without source still verify their installed runtime. Evidence: `workflow/skills/playbooks/hook-policy-testing.md` (search: `if test -d workflow/hooks`), `test/integration/preflight-deny-policy.test.ts` (search: `requires complete canonical runtime in the documented verification command`).

**What happened:** The hook-testing playbook guarded all parity checks with the canonical dispatcher's existence. Running its published command after removing only that dispatcher from a fixture exited `0` and ran both installed suites. The source tree was incomplete, but verification treated it as absent.

## Lesson: Hook tests should inspect executable lines when checking failure masking

**Status:** active | **Created:** 2026-06-11
**Severity:** INTEGRATION
**Incident count:** 2 | **Latest occurrence:** 2026-10-03

**Prevention:** When testing shell hook safety markers such as `|| true`, filter out blank and comment lines before matching, and keep separate assertions for operator-facing comments when the wording itself matters. Evidence anchors: `test/unit/audit-command/hook-facts.test.ts` (search: `detects validation commands that mask failure with || true`), `src/cli/facts/agent/hooks.ts` (search: `lineSwallowsValidationFailure`).

**What happened:** A focused post-turn hook test failed because it searched an entire shell script for `|| true`; the script correctly warned against adding `|| true` in a comment, while the production detector ignores comments and checks executable validation lines.

**Root cause:** The test asserted a policy token against raw file text instead of mirroring the runtime and audit parser boundary, which made a documentation warning look like executable failure masking.

**Recurrence 2026-10-03:** The comment-wrap audit mistook Bash case patterns beginning with `*` for comments and reported two false failures.
Use shell comment markers for Bash; reserve multiline `*` markers for parsed TypeScript/JavaScript comments.
Evidence: `test/fixtures/hooks-bash/workflow/hooks/post-turn-safety.sh` (search: `is_excluded_credential_key`, `is_credential_key`).

## Lesson: Secret-scanner tests must not embed literal secret-shaped fixtures

**Status:** active | **Created:** 2026-06-12
**Severity:** INTEGRATION
**Incident count:** 2 | **Latest occurrence:** 2026-09-04

**Prevention:** In secret-scanner tests and shipped self-tests, build secret-shaped fixture values from split constants or helpers so the runtime fixture still exercises the scanner while the committed source holds no contiguous token or private-key pattern. Apply the same rule to harmless structural fixtures the repository scanner classifies as REVIEW, and never add a waiver that could hide a real credential. After adding or editing scanner fixtures, run the scanner against the current repo, not only temp repos. Evidence anchors: `test/integration/post-turn-safety-hook.test.ts` (search: `TEST_AWS_ACCESS_KEY`), `test/fixtures/hooks-bash/workflow/hooks/post-turn-safety.sh` (search: `synthetic_assignment_prefix`), `test/unit/plans-check-structure.test.ts` (search: `BANNED_IDENTIFIER_CASES`), `test/unit/redact-command.test.ts` (search: `TEST_BEARER_INPUT`).

**What happened:** After `post-turn-safety` became the default Stop hook, the Codex Stop command blocked this repo because the changed safety-hook test source embedded literal secret-shaped fixtures; the fixtures were fake, but the hook scans changed source text and cannot know a token-shaped string in a test file is harmless.

**Root cause:** The test generated dangerous fixture content by storing the exact dangerous strings in the source file, although it only needed that value inside a temporary repo at runtime.

**Recurrence 2026-09-04:** The mandatory pre-release source scan exited 1 with 17 REVIEW rows across two shipped-hook mirrors and three test files; inspection found synthetic scanner and redaction strings plus three harmless `token:` fields. Splitting only their source spelling preserved the runtime data, and the repeated scan reported no high-signal findings while the hook self-test and 102 focused tests passed. `scripts/maintenance/scan-secrets.sh` (search: `INVESTIGATION REQUIRED`).

## Lesson: Drift render helpers must apply every hook toggle

**Status:** active | **Created:** 2026-06-11

**Prevention:** When refactoring generated-state or drift-render code, separate "apply all mutations" from "did anything change?" helpers, and do not use short-circuiting array methods (`some`, `find`, `every`) when each item may mutate the rendered artifact. Add focused drift tests with at least two enabled optional hooks so skipped later entries fail visibly. Evidence anchors: `src/cli/audit/check-drift-hooks.ts` (search: `applyExplicitHookToggles`), `test/integration/audit-drift-checkdrift-hook-templates.test.ts` (search: `allows Copilot hook config entries for enabled optional hooks`).

**What happened:** Reducing ESLint complexity in `expectedHookConfig` replaced the Copilot hook-toggle loop with `Array.some`, so `npm run test:fast` failed the well-configured repo audit: `some` stopped after applying `deny-dangerous`, skipped the enabled `gruff-code-quality` toggle, and made `.github/hooks/hooks.json` look drifted.

**Root cause:** "Did any toggle change?" was treated as the only outcome, but the loop also had side effects that must run for every hook spec; short-circuiting preserved the boolean and lost later config entries.

## Lesson: deny-dangerous self-test missed a whole false-positive class while green

**Status:** active | **Created:** 2026-06-06

**Prevention:** For guardrail parsers, vary shell structure in the allow corpus rather than only verbs: substitutions with and without inner operators, quoted against unquoted, arithmetic expansion, process substitution, and redirects (`2>&1`, `2>/dev/null`, redirect-to-other-file) on allowlisted-readable files, each paired with its dangerous counterpart. A green smoke run proves only the cases present. When a report fingers a downstream catch-all rule, trace the token that rule sees back to the tokenizer before relaxing it. Evidence anchors: `test/fixtures/hooks-bash/workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `unquoted subst with || fallback`), `test/fixtures/hooks-bash/workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `arithmetic expansion`), `test/fixtures/hooks-bash/workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `.env.example read with stderr dup`), `.goat-flow/learning-loop/footguns/deny-shell.md` (search: `track substitution depth`).

**What happened:** A downstream agent hit `Policy destructive: Complex command substitution` on benign `$()` inside a `for` loop while `deny-dangerous.sh --self-test=smoke` reported `executed=23, skipped=0` PASS. The corpus had no allow case for a substitution containing a control operator, nor for arithmetic `$(())`, nor for a `.env.example` read carrying `2>&1`, so three false-positive classes shipped behind a green suite. The catch-all was correct; the orphan `$(` was manufactured upstream by the segment splitter.

**Root cause:** The corpus over-indexed on dangerous block cases plus a few canonical allow cases, while parser regressions surface as false positives on benign but structurally varied input.

## Lesson: Exact hook-copy assertions must derive from owned policy text

**Status:** active | **Created:** 2026-08-24
**Severity:** INTEGRATION
**Decision changed:** Before adding an exact block-copy assertion, read the source-owned block reason or capture attributed classifier output; never infer the expected fragment from the command.
**Trigger phase:** ACT
**Caught at:** VERIFY
**Incident count:** 2 | **Latest occurrence:** 2026-09-27

**Prevention:** Before writing an `expect_block_message` case, locate the owning block reason or capture the hook's attributed output, then reuse a stable source-owned fragment. Run the full central self-test after the RED fixture and after implementation; a verdict-only integration pass is not copy proof. Evidence anchors: `test/fixtures/hooks-bash/workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `dangerous nested command substitution`), `test/fixtures/hooks-bash/workflow/hooks/deny-dangerous/patterns-writes.sh` (search: `Destructive git operation`).

**What happened:** The change added exact-copy self-test cases for nested deletion and a background hard reset, expecting "Recursive deletion" where the runtime says "rm -r without safe scoping", then "git reset --hard" where the policy says only "reset --hard"; the full self-test failed two verification iterations although the verdict-only matrix was green.

**Root cause:** Expected copy was derived from each fixture's intent and command text instead of the block reason owned by the policy module, and a scope-only integration assertion cannot catch that mismatch.

**Recurrence 2026-09-27:** A preflight drift test expected a contiguous path; `diff -qr` reported `Only in <directory>: <filename>`. Require the verdict and filename, not an invented path. That case retired with Bash preflight checks on 2026-10-18; related completeness coverage: `test/integration/preflight-deny-policy.test.ts` (search: `requires complete canonical runtime in the documented verification command`).

---

## Lesson: Restoring coverage by cloning a monolith is not a real split

**Status:** active | **Created:** 2026-05-27

**Prevention:** When splitting a safety hook, define the ownership boundary before porting code. If the hooks must stay self-contained, generate or review each file from explicit function sets: common payload parsing may be shared, but secret, repository, and destructive policy helpers must not cross guard boundaries. A line-count spike across every split file is a review blocker until the duplication is explained or removed. Evidence anchors: `test/fixtures/hooks-bash/workflow/hooks/deny-dangerous/patterns-shell.sh` (search: `rm_has_recursive`), `test/fixtures/hooks-bash/workflow/hooks/deny-dangerous/patterns-paths.sh` (search: `is_secret_path_touch`), `test/fixtures/hooks-bash/workflow/hooks/deny-dangerous/patterns-writes.sh` (search: `is_gh_write_operation`), `test/fixtures/hooks-bash/workflow/hooks/deny-dangerous/patterns-shell.sh` (search: `npm token delete/revoke`).

**What happened:** Restoring lost guardrail coverage copied one parser and checker into all three scoped hooks; runtime filters separated outcomes, but every hook still carried unrelated secret, write, and destructive-command logic.

**Root cause:** The work optimized for recovering behaviour quickly after finding dropped coverage and skipped the design step that should have extracted shared parsing into one source or generated the three guards from one policy table.

## Lesson: Contract fixtures need a real payload for each branch they model

**Status:** active | **Created:** 2026-09-19
**Severity:** INTEGRATION
**Decision changed:** Before writing a fixture for an analyzer error or refusal branch, capture that branch from a real executable; a measured clean envelope does not measure its error fields.
**Trigger phase:** ACT
**Caught at:** VERIFY
**Incident count:** 7 | **Latest occurrence:** 2026-10-12

**Prevention:** Measure clean, finding, config-refusal, fatal and ignored-operand branches separately. Use a scratch project for refusals, then run the finished consumer against the real executables. Evidence: `test/integration/gruff-code-quality-smoke.helpers.ts` (search: `shows the analyzer's own message`); `test/fixtures/hooks-bash/workflow/hooks/gruff-code-quality.sh` (search: `if type == "object" then (.message // tostring)`).

**What happened:** The Gruff v2 clean fixture came from a real gruff-ts run, but its refused-config fixture guessed that `config.error` was a string. Protocol tests passed. Running all five real ports with a missing `schemaVersion` exposed an object with `message` and `remediation`; the hook displayed raw JSON. The hook now reads the message and the fixture uses that measured shape.

**Root cause:** One measured payload was treated as proof of the whole envelope's shape, so the unmeasured error branch was modelled from the field name.

**Recurrence 2026-09-22:** A Codex renewal control used tool API fields `exec_command` and `cmd`; the Git policy returned zero because this was not its shell-event contract. The configured extractor required `Bash` and `tool_input.command`. Six corrected controls preserved production bytes/exits, and a live CLI 0.155.1 capture observed that field and both denials. Evidence: `src/cli/hooks-runtime-evidence.ts` (search: `tool_name: "Bash"`); `test/fixtures/hooks-bash/workflow/hooks/deny-dangerous/guard-runtime.sh` (search: `tool_is_shell_command`, `.tool_input.command`); `workflow/hooks/README.md` (search: `On 2026-09-21,`).

**Recurrence 2026-10-11:** A supervised timeout probe expected legacy exit 2 from managed Claude. The adapter correctly returned exit 0 with JSON denial. Reading its schema test corrected the probe to require the denial and timeout reason; the regex and busy-loop reproductions then passed on WSL and native Windows. A zero exit can carry denial, and pre-timeout output cannot establish completed allowance. Evidence: `workflow/hooks/hook-provider-adapters.mjs` (search: `adaptPreToolResult`); `test/unit/hook-provider-adapters.test.ts` (search: `preserves pre-tool blocking across provider schemas`).

**Recurrence 2026-10-12:** A parity extraction selected Git assertions with `--policy` while leaving the dangerous dispatcher active; root-fallback returned zero. Matching `GOAT_DENY_DANGEROUS_HOOK` restored smoke/full runs under both locales. A later negative control guessed a nonexistent `echo hello` smoke input and failed before injection. Reading `run_smoke` supplied the actual `echo safe` assertion; the corrected control rejects failed acceptance while capturing complete divergence rows. Evidence: ~~`scripts/check-hook-parity.mjs` (search: `extractSelfTests`); `test/integration/hook-parity-reference.test.ts` (search: `divergence captures failed original assertions`)~~ (retired at commit `2cc5b6d2`); `test/fixtures/hooks-bash/workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `POLICY_ENTRYPOINT`).

**Recurrence 2026-10-12:** A configured Stop probe omitted Codex's required `turn_id` and received an invalid-context block. After correcting the payload, it received clean silent exit 0, but the probe incorrectly tried to parse JSON. Reading both branches corrected these two diagnostics: require native identity fields and compare empty streams for clean Codex Stop. The actual configured command then passed. Evidence: `workflow/hooks/hook-launch-runtime.mjs` (search: `readManagedStopContext`); `workflow/hooks/hook-provider-adapters.mjs` (search: `adaptCleanResult`).

---

## Lesson: A shipped-hook change needs every suite that runs the hook, and the pull request's CI

**Status:** active | **Created:** 2026-09-20 | **Incident count:** 3 | **Latest occurrence:** 2026-11-05
**Severity:** INTEGRATION
**Decision changed:** After changing a shipped hook's behaviour, search the tests for the hook's file name, run every matching suite, including slow-suite files, and read the pull request's CI result before the human gate.
**Trigger phase:** VERIFY
**Caught at:** VERIFY

**Prevention:** Before freezing the write allowlist, inspect the fixtures and assertions in every hook consumer for expectations the behavior change will affect. Include those files in scope before implementation. Named hook suites, `npm test` and preflight do not run the slow suite, where the installer tests execute the installed hook against fixtures. Run `command grep -rln '<hook file name>' test/` and run every file it lists, or the whole slow suite. A shared policy module is reached through the entrypoints that load it, and a test can build the file name from a variable, so also search for each entrypoint's bare name (`deny-dangerous`, not `deny-dangerous.mjs`). When the work sits on a pull request, check its latest CI result (`gh pr checks <number>`) at each handoff: a job that has failed since the change is evidence even when every local gate passed. Evidence anchor: `test/integration/setup-install.test.ts` (search: `runs the installed Gruff hook through a configured binaries override`).

**What happened:** A milestone taught the Gruff hook to respect a project's saved `enabled: false`. An installer test ran the installed hook in a freshly installed project, whose saved choice is off by default, and still expected analysis. That milestone and the next three ran their named Gruff suites, `npm test` and preflight, all green, while CI's `test-slow (5/5)` job failed on every commit of the pull request. The final milestone's release gate hit the same failure, and the user reported the CI job. The test now enables Gruff before running the hook and proves the hook stays quiet while the choice is off.

**Root cause:** Proof was chosen from the files the change was about, not from the files that run the changed script, and the pull request's own CI was never read.

**Recurrence 2026-11-05:** A binary-gap secret-blocking change was scoped before reading an existing scanner fixture. Both owning-suite runs passed 97 tests, but the broader scanner/recovery run failed one of 116: the coverage-only binary fixture embedded an AWS-shaped value and required no hazard finding. The corrected scanner detected it. Work paused for approval to align that fixture and record the missed consumer inspection. Keep coverage-only binary fixtures free of detectable secrets and assert token blocking in the dedicated regression suite. Evidence: `test/integration/post-turn-safety-hook-scanning.test.ts` (search: `reports unscannable untracked paths as incomplete`), whose token-bearing fixture is preserved at commit `d75152e8` and `test/integration/post-turn-safety-binary-gap.test.ts` (search: `binary coverage gaps cannot release secrets`).

**Recurrence 2026-10-30:** Two policy changes made the Node runtime inspect the native PowerShell tool and refuse more PowerShell forms it cannot read. Both were verified with the fast suite, focused policy tests, the full self-tests and preflight. A search for the changed modules' file names does not list `test/integration/deny-native-shells.test.ts`, which reaches them through the `deny-dangerous` and `deny-git-mutations` entrypoints and, on a pull request, runs only in the slow suite. It still expected the native PowerShell tool to be refused with a supported-shell route, and harmless `foreach` blocks, call-operator expressions, `.Invoke()` calls and an expandable string to be allowed. CI's `test-slow (5/5)` job failed six cases after both changes were committed, and the user reported it. The test now asserts the Node refusals and the owning-policy denials, prints a non-expanding string in the quoted-text case, and kept the frozen Bash reference expectations until that reference was retired. Evidence anchor: `test/integration/deny-native-shells.test.ts` (search: `refuses uninspected script blocks`).

---

## Lesson: Finalize extraction normalization before freezing parity outcomes

**Status:** active | **Created:** 2026-10-12 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Freeze capture normalization before building the reference corpus; changes require fresh original captures, not edits to saved expected messages.
**Trigger phase:** ACT
**Caught at:** VERIFY

**Prevention:** Run the complete extractor after its last normalization change, reconcile assertion identities and exact per-locale inputs, then generate the corpus from those captures. Repeat the public extraction command before accepting the baseline. Keep failed reports and distinguish fixture-path normalization from changed policy messages.

**What happened:** The first parity corpus was built before the extractor changed an outside-project path from `$CWD` to `$FIXTURE0`. Fresh C and C.UTF-8 comparisons rejected the saved unavailable-fixture message. The approved rewind repeated all eight original captures and rebuilt the pair. Only fixture-root tokens changed in inputs and messages; assertion identities and verdicts were preserved. Bash also decoded six Unicode-escape inputs differently across locales, so IDs now follow assertions while the reference retains exact per-locale inputs. The working-tree check then rejected an actual U+200B in JSON; escaping it preserved the parsed reference values.

**Evidence:** ~~`scripts/check-hook-parity.mjs` (search: `captureProgram`, `caseRows`, `asserted message drift`); `test/integration/hook-parity.test.ts` (search: `saved pair binds every original case and both mirror bytes`)~~ (retired at commit `2cc5b6d2`). Structural controls passed while fresh extraction failed; pair consistency alone did not prove producer consistency.

---

## Lesson: Interpreter-pipe tests need flag-operand and producer-language controls

**Status:** active | **Created:** 2026-07-05

**Prevention:** Every interpreter-pipe exemption needs paired controls for (1) a flag operand that looks like a script path but is not positional code, (2) a real script path after that same flag, and (3) producer tools that can execute commands before emitting bytes. Run those controls through the live dispatcher path before declaring the self-test enough. Evidence anchors: `test/fixtures/hooks-bash/workflow/hooks/deny-dangerous/patterns-shell.sh` (search: `interpreter_option_action`), (search: `is_local_data_pipe_source`), and `test/fixtures/hooks-bash/workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `node require flag operand is not a script file`), (search: `sed producer with shell escape stays blocked`), (search: `local data pipe to node script after require flag`).

**What happened:** A review of the local-data-to-interpreter pipe fix found two gaps after the full self-test was green. `cat script.js | node --require ./package.json` returned exit 0 even though Node executed stdin as the program, because the classifier treated the path-shaped `--require` operand as a script file. `printf x | sed '1e echo SED_EXECUTED' | python3 -c ...` also returned exit 0 while the producer executed a command, because `sed`/`awk` were included in a "read-only producer" allowlist.

**Root cause:** The added grammar matrix covered bare interpreters, `-`, `/dev/stdin`, `python -m`, non-path flag values, downloader latching, and script-file allows, but it did not include path-shaped interpreter flag operands or command-capable producer languages. The test corpus proved the intended examples, not the edges where "path-shaped" and "read-only" assumptions break.

---

## Lesson: Check disposable fixtures before deriving capture packets

**Status:** active | **Created:** 2026-11-05 | **Evidence:** OBSERVED
**Incident count:** 2 | **Latest occurrence:** 2026-11-11
**Decision changed:** Before deriving a capture round, check every disposable fixture root, isolated provider copy and pinned input across all groups before saving the first packet.
**Trigger phase:** READ
**Caught at:** VERIFY

**Prevention:** Treat paths in a prior packet as historical claims until their current existence and hashes are checked. Inventory every group first. Missing temporary roots need a bounded restoration scope before packet checks or native readiness; never interpret them as an empty installed project. Include the global-install pin even when the capture runs from an isolated binary. Select validation by the packet protocol: a Stop-only readiness record can differ from an ordinary provider record. Check these inputs before constructing the new batch.

An inventory goes stale. Repeat it for every pending group immediately before each session, run a screen parser against a saved screen from the pinned provider version before relying on it, and choose the check that matches the fixture's current stage.

**What happened:** Capture preparation saved seven provisional Windows child packets before reaching the first missing WSL root. All nine WSL fixture roots and one isolated provider copy had disappeared from temporary storage. The retained archived provider binary still matched its prior hash, but restoring the roots required new agent configurations outside the write allowlist. Work stopped before any live session or external write.

**Evidence:** The source CLI dry run also refused the absent target with ENOENT. The guard is owned by `src/cli/install-command.ts` (search: `Policy choices or ownership files could not be read safely`); its dry-run branch returns before installer side effects (search: `A dry-run reports the exact managed-template result`).

**Recurrence 2026-11-11:** Three days after a recapture round's packets were built, the remaining WSL sessions stopped on inputs the first inventory had covered but nothing had rechecked. A later commit changed a review module, so four generated CLI files no longer matched the pins in every pending packet. Codex had updated to 0.167.0, which stopped three rows at the version check. One provider's status screen printed a model label its readiness parser could not read. They took two approved metadata updates before the sessions could start. A pre-preparation host check was also run against a fixture that was already prepared, and it reported the approved scanner as drift. The synced rows record the version finally captured: `src/cli/hook-provider-captures.ts` (search: `providerVersion: "0.167.0"`).

## Lesson: Derive capture operator inputs from the packet, not from memory

**Status:** active | **Created:** 2026-11-11 | **Evidence:** OBSERVED
**Incident count:** 3 | **Latest occurrence:** 2026-11-11
**Decision changed:** Before sending a digest or attestation to a capture controller, compute it from the bound packet with a checked helper, and start the dependent command only after that check reports success.
**Trigger phase:** ACT
**Caught at:** VERIFY

**Prevention:** A capture controller validates operator input against its packet: the bundle digest, model descriptor, hook counts and hook owners must match exactly. Values typed from memory fail on the first field that differs, and a failed no-task readiness session still uses up its evidence path. Read digests from the approved artifact. Build an attestation with a helper that checks the rendered screens against the packet and then derives every field from it. Rehearse an input driver against saved screens before the live session. When commands run as separate tool calls, a failed call does not stop the next one, so confirm each result before issuing the command that depends on it.

**What happened:** During a Codex Stop recapture on WSL, a read-only command was first issued with a remembered bundle digest and was refused. Two no-task readiness sessions then failed their attestations: the first sent the model name without its reasoning-effort suffix, and the second left out the hook owners. Neither submitted a task and the single live attempt stayed unused, but each failure needed a new evidence path and a new approval. A helper that derives the attestation from the packet, and a driver rehearsed against the saved screens, completed readiness on the next attempt.

**Evidence:** The row captured after the helper replaced hand-typed input is `src/cli/hook-provider-captures.ts` (search: `capturedAt: "2026-11-11T07:43:00.137Z"`).
