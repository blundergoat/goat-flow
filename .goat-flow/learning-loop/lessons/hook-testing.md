---
category: hook-testing
last_reviewed: 2026-10-30
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
Evidence: `workflow/hooks/post-turn-safety.sh` (search: `is_excluded_credential_key`, `is_credential_key`).

## Lesson: Secret-scanner tests must not embed literal secret-shaped fixtures

**Status:** active | **Created:** 2026-06-12
**Severity:** INTEGRATION
**Incident count:** 2 | **Latest occurrence:** 2026-09-04

**Prevention:** In secret-scanner tests and shipped self-tests, build secret-shaped fixture values from split constants or helpers so the runtime fixture still exercises the scanner while the committed source holds no contiguous token or private-key pattern. Apply the same rule to harmless structural fixtures the repository scanner classifies as REVIEW, and never add a waiver that could hide a real credential. After adding or editing scanner fixtures, run the scanner against the current repo, not only temp repos. Evidence anchors: `test/integration/post-turn-safety-hook.test.ts` (search: `TEST_AWS_ACCESS_KEY`), `workflow/hooks/post-turn-safety.sh` (search: `synthetic_assignment_prefix`), `test/unit/plans-check-structure.test.ts` (search: `BANNED_IDENTIFIER_CASES`), `test/unit/redact-command.test.ts` (search: `TEST_BEARER_INPUT`).

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

**Prevention:** For guardrail parsers, vary shell structure in the allow corpus rather than only verbs: substitutions with and without inner operators, quoted against unquoted, arithmetic expansion, process substitution, and redirects (`2>&1`, `2>/dev/null`, redirect-to-other-file) on allowlisted-readable files, each paired with its dangerous counterpart. A green smoke run proves only the cases present. When a report fingers a downstream catch-all rule, trace the token that rule sees back to the tokenizer before relaxing it. Evidence anchors: `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `unquoted subst with || fallback`), `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `arithmetic expansion`), `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `.env.example read with stderr dup`), `.goat-flow/learning-loop/footguns/deny-shell.md` (search: `track substitution depth`).

**What happened:** A downstream agent hit `Policy destructive: Complex command substitution` on benign `$()` inside a `for` loop while `deny-dangerous.sh --self-test=smoke` reported `executed=23, skipped=0` PASS. The corpus had no allow case for a substitution containing a control operator, nor for arithmetic `$(())`, nor for a `.env.example` read carrying `2>&1`, so three false-positive classes shipped behind a green suite. The catch-all was correct; the orphan `$(` was manufactured upstream by the segment splitter.

**Root cause:** The corpus over-indexed on dangerous block cases plus a few canonical allow cases, while parser regressions surface as false positives on benign but structurally varied input.

## Lesson: Exact hook-copy assertions must derive from owned policy text

**Status:** active | **Created:** 2026-08-24
**Severity:** INTEGRATION
**Decision changed:** Before adding an exact block-copy assertion, read the source-owned block reason or capture attributed classifier output; never infer the expected fragment from the command.
**Trigger phase:** ACT
**Caught at:** VERIFY
**Incident count:** 2 | **Latest occurrence:** 2026-09-27

**Prevention:** Before writing an `expect_block_message` case, locate the owning block reason or capture the hook's attributed output, then reuse a stable source-owned fragment. Run the full central self-test after the RED fixture and after implementation; a verdict-only integration pass is not copy proof. Evidence anchors: `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `dangerous nested command substitution`), `workflow/hooks/deny-dangerous/patterns-writes.sh` (search: `Destructive git operation`).

**What happened:** The change added exact-copy self-test cases for nested deletion and a background hard reset, expecting "Recursive deletion" where the runtime says "rm -r without safe scoping", then "git reset --hard" where the policy says only "reset --hard"; the full self-test failed two verification iterations although the verdict-only matrix was green.

**Root cause:** Expected copy was derived from each fixture's intent and command text instead of the block reason owned by the policy module, and a scope-only integration assertion cannot catch that mismatch.

**Recurrence 2026-09-27:** A preflight drift test expected a contiguous path; `diff -qr` reported `Only in <directory>: <filename>`. Require the verdict and filename, not an invented path. That case retired with Bash preflight checks on 2026-10-18; related completeness coverage: `test/integration/preflight-deny-policy.test.ts` (search: `requires complete canonical runtime in the documented verification command`).

---

## Lesson: Restoring coverage by cloning a monolith is not a real split

**Status:** active | **Created:** 2026-05-27

**Prevention:** When splitting a safety hook, define the ownership boundary before porting code. If the hooks must stay self-contained, generate or review each file from explicit function sets: common payload parsing may be shared, but secret, repository, and destructive policy helpers must not cross guard boundaries. A line-count spike across every split file is a review blocker until the duplication is explained or removed. Evidence anchors: `workflow/hooks/deny-dangerous/patterns-shell.sh` (search: `rm_has_recursive`), `workflow/hooks/deny-dangerous/patterns-paths.sh` (search: `is_secret_path_touch`), `workflow/hooks/deny-dangerous/patterns-writes.sh` (search: `is_gh_write_operation`), `workflow/hooks/deny-dangerous/patterns-shell.sh` (search: `npm token delete/revoke`).

**What happened:** Restoring lost guardrail coverage copied one parser and checker into all three scoped hooks; runtime filters separated outcomes, but every hook still carried unrelated secret, write, and destructive-command logic.

**Root cause:** The work optimized for recovering behaviour quickly after finding dropped coverage and skipped the design step that should have extracted shared parsing into one source or generated the three guards from one policy table.

## Lesson: Contract fixtures need a real payload for each branch they model

**Status:** active | **Created:** 2026-09-19
**Severity:** INTEGRATION
**Decision changed:** Before writing a fixture for an analyzer error or refusal branch, capture that branch from a real executable; a measured clean envelope does not measure its error fields.
**Trigger phase:** ACT
**Caught at:** VERIFY
**Incident count:** 7 | **Latest occurrence:** 2026-10-12

**Prevention:** Measure clean, finding, config-refusal, fatal and ignored-operand branches separately. Use a scratch project for refusals, then run the finished consumer against the real executables. Evidence: `test/integration/gruff-code-quality-smoke.helpers.ts` (search: `shows the analyzer's own message`); `workflow/hooks/gruff-code-quality.sh` (search: `if type == "object" then (.message // tostring)`).

**What happened:** The Gruff v2 clean fixture came from a real gruff-ts run, but its refused-config fixture guessed that `config.error` was a string. Protocol tests passed. Running all five real ports with a missing `schemaVersion` exposed an object with `message` and `remediation`; the hook displayed raw JSON. The hook now reads the message and the fixture uses that measured shape.

**Root cause:** One measured payload was treated as proof of the whole envelope's shape, so the unmeasured error branch was modelled from the field name.

**Recurrence 2026-09-22:** A Codex renewal control used tool API fields `exec_command` and `cmd`; the Git policy returned zero because this was not its shell-event contract. The configured extractor required `Bash` and `tool_input.command`. Six corrected controls preserved production bytes/exits, and a live CLI 0.155.1 capture observed that field and both denials. Evidence: `src/cli/hooks-runtime-evidence.ts` (search: `tool_name: "Bash"`); `workflow/hooks/deny-dangerous/guard-runtime.sh` (search: `tool_is_shell_command`, `.tool_input.command`); `workflow/hooks/README.md` (search: `On 2026-09-21,`).


**Recurrence 2026-10-11:** A supervised timeout probe expected legacy exit 2 from managed Claude. The adapter correctly returned exit 0 with JSON denial. Reading its schema test corrected the probe to require the denial and timeout reason; the regex and busy-loop reproductions then passed on WSL and native Windows. A zero exit can carry denial, and pre-timeout output cannot establish completed allowance. Evidence: `workflow/hooks/hook-provider-adapters.mjs` (search: `adaptPreToolResult`); `test/unit/hook-provider-adapters.test.ts` (search: `preserves pre-tool blocking across provider schemas`).

**Recurrence 2026-10-12:** A parity extraction selected Git assertions with `--policy` while leaving the dangerous dispatcher active; root-fallback returned zero. Matching `GOAT_DENY_DANGEROUS_HOOK` restored smoke/full runs under both locales. A later negative control guessed a nonexistent `echo hello` smoke input and failed before injection. Reading `run_smoke` supplied the actual `echo safe` assertion; the corrected control rejects failed acceptance while capturing complete divergence rows. Evidence: `scripts/check-hook-parity.mjs` (search: `extractSelfTests`); `test/integration/hook-parity-reference.test.ts` (search: `divergence captures failed original assertions`); `test/fixtures/hooks-bash/workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `POLICY_ENTRYPOINT`).

**Recurrence 2026-10-12:** A configured Stop probe omitted Codex's required `turn_id` and received an invalid-context block. After correcting the payload, it received clean silent exit 0, but the probe incorrectly tried to parse JSON. Reading both branches corrected these two diagnostics: require native identity fields and compare empty streams for clean Codex Stop. The actual configured command then passed. Evidence: `workflow/hooks/hook-launch-runtime.mjs` (search: `readManagedStopContext`); `workflow/hooks/hook-provider-adapters.mjs` (search: `adaptCleanResult`).

---

## Lesson: A shipped-hook change needs every suite that runs the hook, and the pull request's CI

**Status:** active | **Created:** 2026-09-20 | **Incident count:** 2 | **Latest occurrence:** 2026-10-30
**Severity:** INTEGRATION
**Decision changed:** After changing a shipped hook's behaviour, search the tests for the hook's file name, run every matching suite, including slow-suite files, and read the pull request's CI result before the human gate.
**Trigger phase:** VERIFY
**Caught at:** VERIFY

**Prevention:** Named hook suites, `npm test` and preflight do not run the slow suite, where the installer tests execute the installed hook against fixtures. Run `command grep -rln '<hook file name>' test/` and run every file it lists, or the whole slow suite. A shared policy module is reached through the entrypoints that load it, and a test can build the file name from a variable, so also search for each entrypoint's bare name (`deny-dangerous`, not `deny-dangerous.mjs`). When the work sits on a pull request, check its latest CI result (`gh pr checks <number>`) at each handoff: a job that has failed since the change is evidence even when every local gate passed. Evidence anchor: `test/integration/setup-install.test.ts` (search: `runs the installed Gruff hook through a configured binaries override`).

**What happened:** A milestone taught the Gruff hook to respect a project's saved `enabled: false`. An installer test ran the installed hook in a freshly installed project, whose saved choice is off by default, and still expected analysis. That milestone and the next three ran their named Gruff suites, `npm test` and preflight, all green, while CI's `test-slow (5/5)` job failed on every commit of the pull request. The final milestone's release gate hit the same failure, and the user reported the CI job. The test now enables Gruff before running the hook and proves the hook stays quiet while the choice is off.

**Root cause:** Proof was chosen from the files the change was about, not from the files that run the changed script, and the pull request's own CI was never read.

**Recurrence 2026-10-30:** Two policy changes made the Node runtime inspect the native PowerShell tool and refuse more PowerShell forms it cannot read. Both were verified with the fast suite, focused policy tests, the full self-tests and preflight. A search for the changed modules' file names does not list `test/integration/deny-native-shells.test.ts`, which reaches them through the `deny-dangerous` and `deny-git-mutations` entrypoints and, on a pull request, runs only in the slow suite. It still expected the native PowerShell tool to be refused with a supported-shell route, and harmless `foreach` blocks, call-operator expressions, `.Invoke()` calls and an expandable string to be allowed. CI's `test-slow (5/5)` job failed six cases after both changes were committed, and the user reported it. The test now asserts the Node refusals and the owning-policy denials, prints a non-expanding string in the quoted-text case, and keeps the frozen Bash reference expectations. Evidence anchor: `test/integration/deny-native-shells.test.ts` (search: `refuses uninspected script blocks`).

---

## Lesson: Finalize extraction normalization before freezing parity outcomes

**Status:** active | **Created:** 2026-10-12 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Freeze capture normalization before building the reference corpus; changes require fresh original captures, not edits to saved expected messages.
**Trigger phase:** ACT
**Caught at:** VERIFY

**Prevention:** Run the complete extractor after its last normalization change, reconcile assertion identities and exact per-locale inputs, then generate the corpus from those captures. Repeat the public extraction command before accepting the baseline. Keep failed reports and distinguish fixture-path normalization from changed policy messages.

**What happened:** The first parity corpus was built before the extractor changed an outside-project path from `$CWD` to `$FIXTURE0`. Fresh C and C.UTF-8 comparisons rejected the saved unavailable-fixture message. The approved rewind repeated all eight original captures and rebuilt the pair. Only fixture-root tokens changed in inputs and messages; assertion identities and verdicts were preserved. Bash also decoded six Unicode-escape inputs differently across locales, so IDs now follow assertions while the reference retains exact per-locale inputs. The working-tree check then rejected an actual U+200B in JSON; escaping it preserved the parsed reference values.

**Evidence:** `scripts/check-hook-parity.mjs` (search: `captureProgram`, `caseRows`, `asserted message drift`); `test/integration/hook-parity.test.ts` (search: `saved pair binds every original case and both mirror bytes`). Structural controls passed while fresh extraction failed; pair consistency alone did not prove producer consistency.
