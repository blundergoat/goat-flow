---
category: test-shell-environment
last_reviewed: 2026-10-13
---

**Scope:** The shell and process layer under a test - stdin and EOF handling, tools that silently skip paths, inherited permission profiles, and why silent output is not proof a child never ran. Choosing and invoking the runner is [test-execution-environment.md](test-execution-environment.md).

## Lesson: Verify timeout cleanup through the real package-manager process tree

**Status:** active | **Created:** 2026-09-12 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Verify timeout cleanup through the installed package manager before accepting a direct-child fixture as proof that all descendants exit.
**Trigger phase:** ACT
**Caught at:** VERIFY

**Prevention:** Run an isolated package script through the production runner and assert that both its script process and worker exit after timeout. Keep the timeout status and diagnostic assertions, but do not treat them as proof of descendant cleanup. Preserve a failing run before changing the implementation.

**What happened:** During verification, I accepted a passing direct-Node timeout fixture as evidence that Windows cleanup removed the verification tree. The follow-up replaced that fixture with an actual `npm run` script. The runner returned timeout status 124, but the script-process exit assertion failed because the script remained alive.

**Root cause:** The fixture omitted npm's additional process layers. Killing the runner's direct child did not prove that the package script and its worker had stopped.

**Correction:** Windows cleanup now invokes bounded `taskkill /T /F` while npm's root process still exists. The replacement test failed before the fix and passed afterward on Windows; the same focused suite passed on Linux. Evidence anchors: `scripts/preflight-command-runner.mjs` (search: "stopChildProcessGroup") and `test/integration/preflight-progress.test.ts` (search: "times out installed npm with exit 124 and removes its script and worker").

---

## Lesson: The session shell's `grep` is a ugrep wrapper that silently drops `.goat-flow/` subtrees, committed or ignored

**Status:** active | **Created:** 2026-06-13
**Severity:** CORRECTNESS
**Decision changed:** Treat a zero-hit recursive search under `.goat-flow/` as unproven until a known-positive control passes with the same command; use `command grep` for any sweep that must reach ignored plans or logs, and classify a negative search by its exit status rather than by empty output.
**Trigger phase:** READ
**Caught at:** VERIFY
**Incident count:** 10 | **Latest occurrence:** 2026-09-03

**Prevention:** The session shell defines `grep` as a function that execs ugrep with `--ignore-files`, so it applies gitignore-style rules while recursing. `rg` is also a function and ripgrep is not installed at all, so a spawned process calling it exits 127. Three rules follow.

1. **Pick a tool that reaches the tree.** For a sweep that must include gitignored content, use `command grep`, `find ... | xargs grep` (a child process does not inherit the shell function), or explicit file operands, since direct-file grep is unaffected. The canonical form is `command grep -rn --exclude-dir=.git --exclude-dir=scratchpad <pattern> .goat-flow/`. Running the shim with `.goat-flow/` as the working directory also works, because the re-includes then resolve. `grep --no-ignore-files` returns the full set in a Claude Code session, but it is not portable, so written guidance keeps `command grep`.
2. **Know what each tool can see.** Since the 2026-08-18 template change, which added `**/name/**` re-includes plus a logs guard, the shim sees the committed surface from any operand in projects on that template; installs on the older anchored spelling still hide `learning-loop/` and `skill-docs/` until `goat-flow install` refreshes the ignore file, and the `goat-flow-gitignore` audit check names the missing patterns. The ignored `plans/` and `logs/` trees are never visible to the shim, so a bucket-scoped INDEX-first pass is safe while a sweep that must reach local plans or logs is not. When the question is what ships rather than what exists on disk, prefer `git grep`, which searches tracked files by construction so local logs, plans, and scratch artifacts can neither mask a real residue nor manufacture a false one.
3. **Control every zero-hit result.** Before trusting any empty sweep over a gitignored tree, grep for a string you have just read in one of those files; if the control misses, the tool is filtered rather than the tree clean. Treat a suspiciously empty recursive grep over a dot-directory as a wrapper artifact until an ignore-bypassing search reproduces it. For a negative proof, capture and classify the exit status explicitly: 0 means a match was found, 1 means no match, and anything else means the proof failed. Never route no-match and error into one branch, and do not build operand lists with quoted brace expansion.

Evidence anchors: `type grep` in-session (search: `--ignore-files`), `workflow/setup/reference/goat-flow-gitignore` (search: `Ignore everything by default`), `CLAUDE.md` (search: `Recursive searches under`), `test/integration/gitignore-shape.test.ts` (search: `carries the logs subdirectory guard and depends on it`), `src/cli/audit/check-goat-flow.ts` (search: `REQUIRED_GOAT_FLOW_GITIGNORE_PATTERNS`).

**What happened:** During the review, a recursive shim grep for `plan-checkbox-guard` under `.goat-flow` returned nothing although the milestone file and the then-current ADR both matched when grepped directly. `type grep` showed the session shell defines `grep` as a function that execs ugrep with `--ignore-files --hidden`, and that flag applies gitignore-style rules during recursion, so any sweep descending into `.goat-flow/plans/` or `.goat-flow/logs/` silently returns clean. The rejected guard decision is preserved in `.goat-flow/learning-loop/decisions/ADR-037-separate-post-turn-safety-from-validation.md` (search: `shipped and reverted`).

**Root cause:** A search command's apparent result was treated as filesystem truth without proving the command had searched the intended operands successfully. Ignore filtering can produce a false clean, a shell wrapper can misreport tool availability, and control flow can collapse an invocation error into the same branch as a legitimate no-match.

**Incident ledger:**

**Recurrences 2026-06-14, 2026-08-06, 2026-08-09 (ripgrep honouring the ignore file):** Three sweeps over `.goat-flow/plans/` returned no matches for content the milestones demonstrably contained: new milestone headings under 1.12.1, old-version references during a 12-directory roadmap shift, and host-timeout premises during the 1.15.1 reconciliation. Each was recovered by rerunning with `--no-ignore`, and the 2026-08-06 case needed `--hidden` as well. The corrected commands now carry both flags so a clean result cannot depend on repository ignore rules. `workflow/setup/reference/goat-flow-gitignore` (search: `plans/`), `.goat-flow/plans/.gitignore` (search: `*`), `src/cli/facts/shared/learning-loop-common.ts` (search: `gitignored path used as durable evidence anchor`).
**Recurrence 2026-07-03 (false conclusion survived several rounds):** Recursive greps for stale roadmap tokens over `.goat-flow/plans/` returned zero hits and the reviewer concluded the stale classes were phantom, although the reviewed plans themselves warned to bypass the ignore rules. The tell was that a pattern known to exist, read from a plan moments earlier, also returned zero; `find` piped to `xargs grep` then found more than 25 live files per class.
**Recurrence 2026-08-04 (removal-completeness claim):** After deleting a commit-subject gate script and pruning its references, a recursive sweep found nothing and reported zero residual references to the user, while 17 references survived in the skipped logs and plans trees. The miss surfaced by luck on an unrelated task, when a sweep missed a line read from that file moments before. Removal-completeness claims are the highest-risk use of this tool, because a false clean and a real clean are the same empty output. `.goat-flow/skill-docs/playbooks/hook-policy-testing.md` (search: `mode=smoke, executed=`).
**Recurrence 2026-08-10 (the wrapper masked a missing binary):** Two playbook-contract cases failed with `rg: command not found` while `command -v rg` in the session answered `rg`, so the failure was first called a sanitized-PATH harness artifact. `type rg` showed a function and a child shell found nothing: ripgrep is not installed here at all. The real defect was the shipped playbook, whose documented registration check hard-required ripgrep and exited 127 for any consumer without it. `workflow/skills/playbooks/hook-policy-testing.md` (search: `Ripgrep is not installed on every consumer machine`).
**Recurrence 2026-08-15 (error read as no-match):** A brace-shaped list of Markdown operands was quoted in one search command, so Bash passed the braces literally, the search emitted an I/O error for the nonexistent path, and the surrounding conditional converted that error into the same success message used for a genuine no-match. The result was discarded and the sweep rerun with explicit operands. The incident's plan files are gitignored and are therefore not cited as durable anchors.
**Recurrence 2026-08-18 (committed trees are dropped too, correcting the original explanation):** Verifying that a deleted ADR had no remaining references, a recursive shim grep from the repository root returned nothing, and `stats --check` then surfaced four live references one at a time. Re-measured with a tracked needle, the shim from the root found 2 files, the same command with `.goat-flow/` as the working directory found 10, `git grep` found 10, and `command grep` found 99, of which 55 were under logs, 34 under plans, and 8 under learning-loop. The shim does not only skip the ignored trees: `.goat-flow/.gitignore` opens with a catch-all, and ugrep matches the re-includes against the path as passed rather than relative to that ignore file, so only depth-one file re-includes survive. A three-file fixture reproduces it, `--hidden` is already in the shim's flags so hidden-directory skipping is not the cause, and `git grep` is no substitute here because it is tracked-only and missed the 89 files under plans and logs.
**Recurrence 2026-09-03:** During activation, a default ripgrep search ran against the ignored milestone tree. The result was discarded before use and the lookup rerun with `command grep`, which reached the expected plan state. `AGENTS.md` (search: `Recursive searches under`).

---

## Lesson: Proof captures use fresh paths instead of pre-truncation

**Status:** active | **Created:** 2026-09-03
**Decision changed:** Give each proof command a fresh capture path instead of clearing and reusing a temporary file.
**Trigger phase:** VERIFY
**Caught at:** VERIFY
**Incident count:** 1 | **Latest occurrence:** 2026-09-03

**Prevention:** Create a fresh temporary directory and one never-reused output path per proof command. Let the producer create its capture, then inspect the exit status and bytes; do not clear a capture with a null-command redirect or another truncation pattern, which the guard classifies as destructive. Evidence anchor: `workflow/hooks/deny-dangerous/patterns-shell.sh` (search: `Null-command (: / true) followed by redirect truncates the target`).

**What happened:** The whitespace-check wrapper initialised its `check.out` capture with a null-command redirect before running two no-index checks, so the deny hook blocked the entire command and no verification ran. The retry used separate new output paths and completed.

**Root cause:** A temporary capture was treated as disposable and reused, although write-once paths are simpler and preserve each command's evidence.

---

## Lesson: Hook tests should feed stdin through files when child `cat` must see EOF

**Status:** active | **Created:** 2026-06-13
**Severity:** INTEGRATION
**Incident count:** 3 | **Latest occurrence:** 2026-09-28

**Prevention:** When a test executes an installed hook that reads stdin with `cat`, write the payload to a temp file and pass an open read-only descriptor or shell redirection rather than the runner's `input` option. Capture hook stderr explicitly when the hook launches nested runtimes. Evidence anchors: `test/integration/gruff-code-quality-smoke.helpers.ts` (search: `runHook`), `test/unit/hook-registrar.helpers.ts` (search: `runPayloadProcess`).

**What happened:** A hook integration test repeatedly timed out when it invoked the hook through `spawnSync` with an `input` string. Tracing with `bash -x` showed the hook stalled at its `payload="$(cat)"` line: the child saw the payload bytes but never received EOF in this sandbox. The same sequence completed from a normal shell with file redirection and produced the expected exit codes.

**Root cause:** The runner's `input` option was assumed equivalent to a real stdin file for hook scripts. In this environment it is not reliable for hooks that read all of stdin with `cat`, which makes correct hook behaviour look like a product hang.

**Recurrence 2026-06-14:** A Codex workspace-terminal `bash scripts/preflight-checks.sh` run reached the test phase and then stayed silent; process inspection showed the only remaining workers were `test/integration/gruff-code-quality-contract.test.ts` and `test/integration/gruff-code-quality-smoke.test.ts`, each blocked under the hook at its stdin read, because the shared helper still passed the payload through the runner's `input` option and needed the same file-redirection fix.

**Recurrence 2026-09-28:** Verification stalled in the provider-payload policy tests. A finite input file restored the unchanged 134-case operands corpus. The shared `test/helpers/check-installed-policy.ts` helper (search: `runHookWithPayload`) now supplies a private read-only descriptor and closes and removes it after each call. Owning runs passed all 134 operands, 215 policy, 118 GraphQL and 124 native-shell cases without changing their assertions. Evidence: `test/integration/deny-dangerous-operands.test.ts` (search: `classify`), `test/integration/deny-dangerous-policy.test.ts` (search: `runStdinPolicyCheck`), `test/integration/deny-git-graphql.test.ts` and `test/integration/deny-native-shells.test.ts` (search: `runHookWithPayload`). The same finite-input repair later restored all 30 cases in `test/integration/gruff-code-quality-contract.test.ts` (search: `runProviderLauncher`); its real Node launcher and provider feedback assertions remain in place. The 2026-09-29 continuation applied finite input and private output captures to `test/integration/gruff-code-quality-quiet-feedback.test.ts` (search: `deliveredContext`); all 12 original cases passed, including the three saved-handler feedback cases that had stalled.

The same continuation reached saved Codex replay and the preflight ESLint verdict fixture. The first handler-matrix repair left two Codex cases failing because their separate helper still defaulted to pipe input. Finite input restored 27 passing cases; the three Windows-only skips and explicit Windows pipe variants remain unchanged. The full hook-sync recovery suite passed all 12 cases after the same replay repair and private CLI output capture. The ESLint verdict suite had exceeded 20 seconds; finite input then restored both original cases. Evidence: `test/integration/hook-command-spawn-matrix.test.ts` (search: `runRegisteredCodexHandler`), `test/integration/hook-sync-recovery.test.ts` (search: `replaySavedCodexCommand`) and `test/integration/preflight-eslint.test.ts` (search: `runPreflightLintClassifier`). Inspect each process helper separately; one repaired transport does not cover every caller in the file.

The later quality-save and redaction fixtures stalled for 25 and 20 seconds respectively while their CLI readers waited for stdin EOF. Private finite input and output captures restored all 47 quality-subcommand and 23 redaction cases, preserving the real CLI, raw input bytes and safety assertions. The redaction file contained both a shared helper and one separate inline spawn; both required repair. Evidence: `test/unit/quality-subcommands.test.ts` (search: `runQualityCommand`) and `test/unit/redact-command.test.ts` (search: `runRedact`, `writes only scrubbed stdin to an explicit output file`).

---

## Lesson: A hook's silent output is not proof of non-execution - verify through the test harness

**Status:** active | **Created:** 2026-06-01

**Prevention:** To prove a PostToolUse hook's behaviour changed, run it through the project's test harness and mirror its fixture setup exactly rather than writing an ad-hoc shell repro. If you must reproduce by hand, replicate the root resolution (git against pwd), the pinned `PATH` including `jq`, and the config and binary preconditions, and never discard stderr. Treat a silent hook run as inconclusive until every fail-soft early exit is ruled out. To prove a regression test guards a fix, run it against the pre-fix revision and confirm it fails. Evidence anchors: `workflow/hooks/gruff-code-quality.sh` (search: `repo_root`), `workflow/hooks/gruff-code-quality.sh` (search: `no changed lines detected`), `test/integration/gruff-code-quality-smoke.test.ts` (search: `does not discover binaries from the removed`).

**What happened:** Proving the hook no longer discovers binaries from a removed glob, ad-hoc bash repros ran the old and new hook against a planted binary and both printed nothing, so the before-and-after looked identical and the fix unprovable. The isolated discovery loop showed the old glob clearly resolved the binary, so the repros were wrong rather than the fix: they had run `git init` in the temp repo and discarded stderr.

**Root cause:** The hook resolves its root with `git rev-parse --show-toplevel` falling back to `pwd`, then fail-soft exits silently at several early gates when config, `jq`, the binary, or a changed range is missing. The smoke fixtures deliberately do not initialise git, so the fallback resolves the planted files; adding `git init` made the root resolve elsewhere and the hook bailed before discovery, while discarding stderr hid the diagnostic. A silent run looked like the binary was never executed when it was really an early exit.

**Fix:** Verify through the node test harness, which already encodes the right preconditions, and prove the guard by swapping the pre-fix hook in: the regression failed against the pre-fix commit and passed against the fix, which is a real before-and-after.

---

## Lesson: Nested Claude permission probes inherit the host session's profile without full env isolation

**Status:** active | **Created:** 2026-07-31
**Decision changed:** Before reading any nested permission-probe result as ground truth, prove the child ran with a clean local profile and include a positive-control row that an existing rule provably allows.
**Trigger phase:** VERIFY

**Prevention:** Always include a positive-control row that an existing rule provably allows, such as a plain version command through the source CLI. A control that executes beside a denied target is a valid negative verdict; a denied control voids the probe and should be reported as a harness fault rather than a matcher verdict. Keep `env -i HOME="$HOME" PATH="$PATH" TERM=xterm SHELL=/bin/bash` as cheap hygiene, but do not treat env stripping or init-event marker greps as proof in either direction. The real launch environment is a dashboard server spawn rather than an interactive session, so mirror that flag set when reproducing it. Evidence anchor: `src/cli/server/terminal-spawn.ts` (search: `CLAUDE_REPORTING_ARGS`).

**What happened:** An approved probe of a trailing-wildcard heredoc matcher launched a nested print-mode session with a settings overlay from inside an interactive session and with no positive-control row. Both probe rows returned the generic denial, which cannot distinguish a rule that did not match from an overlay that was never consulted, so the run produced no verdict; reading it as a disqualification would have activated the milestone's kill criterion on unproven evidence. The ambiguity was first blamed on host-session contamination, because the child's init event showed cloud-looking markers and the environment carried surviving session variables.

**Root cause:** There was no positive control. The corrected rerun under a stripped environment displayed the same init markers while its control row executed, proving those markers reflect this machine's logged-in CLI state rather than session attachment, and that init-roster inspection is not a contamination test. Only a control row that an existing rule provably allows converts a denial into evidence.

**Outcome 2026-07-31:** With the control proven, the heredoc row's denial became a valid measurement: the trailing-wildcard prefix form does not match multi-line quoted-heredoc Bash commands on the tested Claude Code build.

---

## Lesson: Missing-helper self-tests must close stdin

**Status:** active | **Created:** 2026-05-27

**Prevention:** Redirect stdin from `/dev/null` in any self-test that deliberately runs a degraded hook or helper, and include the missing-helper branch in smoke mode so startup failures surface quickly. Evidence anchors: `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `expect_missing_common_fails_closed`), `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `run_common_dependency_checks`).

**What happened:** The full deny-dangerous self-test hung on an interactive terminal while copying a thin hook into a temp directory without its shared helper. The copied hook reached the missing-helper branch before `--check` parsing and then read from the inherited terminal instead of receiving closed stdin.

**Root cause:** The missing-dependency test proved fail-closed behaviour only when stdin was already closed, and an interactive terminal changed the control flow enough to hide the pass or fail line behind a blocked read.

---

## Lesson: Keep analyzer fixture programs outside the analyzed change set

**Status:** active | **Created:** 2026-10-12 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Store executable mock programs outside a fixture project when the tested hook inventories that project's changed files.
**Trigger phase:** ACT | **Caught at:** VERIFY

**Prevention:** Put Node analyzer programs in a separate disposable directory. Leave only the launcher required by the reference transport inside the project, and expose an explicit Node invocation for restricted consumers. Preserve the original behavior assertion when correcting fixture placement.

**What happened:** During M07, converting a Bash Gruff mock to Node added `bin/gruff-ts.mjs` inside the fixture project. The Antigravity test without a file path failed: the hook inventoried that untracked source file and the mock returned an old finding. The focused run recorded 41 passes and one failure. Moving the program outside the analyzed project retained the assertion and produced 42 passes with no failures.

**Root cause:** The mock's implementation became an input to the behavior under test. The old extensionless launcher had not entered the source-file inventory, so an apparently equivalent fixture conversion changed the test's scope.

**Evidence:** `test/integration/gruff-code-quality-smoke.helpers.ts` (search: `writeNodeAnalyzer`, `fixtureAnalyzerInvocation`); `test/integration/gruff-code-quality-smoke.test.ts` (search: `runs for Antigravity file-tool payloads without a file path`). The restricted clean control also invokes the Node analyzer directly and checks its finding payload in `test/integration/restricted-env-controls.test.ts` (search: `clean restricted consumer`).

**Verification follow-up 2026-10-12:** The M07 full preflight then found six new warning identities across five edited fixture owners; the earlier scoped scans had omitted some owners. The generated child source also made argv and environment references appear inside parent file-writing calls. Separate source generators now make that boundary explicit. The process guard's executable resolution was extracted without changing PATH order, journal reads use caller-owned paths, and the executable-search catch documents why missing candidates continue. The complete warning ratchet returned zero accepted identities and occurrences; both Node 20.11.0 and 24.21.0 restriction/selector runs retained seven passes and zero failures or skips. Run the ratchet across the complete changed surface before the expensive suite. Evidence anchors: test/helpers/spawn-guard.mjs (search: resolveGuardExecutable), test/integration/restricted-env-controls.test.ts (search: negativeControlScript), and test/integration/post-turn-safety-hook.helpers.ts (search: commandFaultSource).

## Lesson: Query WSL identity before changing its version

**Status:** active | **Created:** 2026-10-12 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Query the installed WSL version before requesting a conversion, and require hosted execution evidence after changing provisioning.
**Trigger phase:** ACT
**Caught at:** VERIFY

**Prevention:** Use `wsl --list --verbose` to inspect the target distribution and check the command status. Convert only when the requested version is absent, then query again. Keep the kernel check and fail on unavailable identity or a failed conversion. A conversion command is a state change, not an idempotent readiness probe.

**What happened:** PR #69's `hook-port-controls-wsl` job installed Ubuntu and successfully launched its echo command. The subsequent unconditional `wsl --set-version Ubuntu-22.04 2` reported that the distribution was already the requested version, followed by `WSL_E_VM_MODE_INVALID_STATE`. The workflow threw `WSL2 conversion failed` before reaching its identity listing or restricted controls. Treating an already-satisfied conversion as a safe probe blocked the intended proof.

**Evidence:** `.github/workflows/ci.yml` (search: `Require WSL2`, `WSL2 conversion failed`); [failed hosted job](https://github.com/blundergoat/goat-flow/actions/runs/38199639896/job/114649958758). A disposable PowerShell branch fixture reproduced the old failure and exercised seven proposed success/refusal paths. That fixture does not establish hosted WSL2 kernel availability or passing restricted controls; rerun the original hosted job before accepting that proof.

---

## Lesson: Provision native build dependencies in fresh WSL distributions

**Status:** active | **Created:** 2026-10-12 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Inspect native dependency install scripts before treating a fresh WSL distribution as equivalent to a provisioned Linux CI runner.
**Trigger phase:** ACT
**Caught at:** VERIFY

**Prevention:** Provision the build prerequisites required by locked native dependencies before installation. Preserve install-script output when diagnosing an optional package that disappears: a successful npm exit does not prove that every optional dependency installed.

**What happened:** I added the hosted WSL controls with curl, Git and archive tools, but omitted Python and a compiler toolchain. After the WSL identity correction, the [next hosted job](https://github.com/blundergoat/goat-flow/actions/runs/38208889365/job/114678400988) passed its identity and kernel checks, then failed compilation because `node-pty` was absent despite a successful `npm ci`.

**Evidence and limit:** `package.json` (search: `optionalDependencies`) pins `node-pty` 1.1.0. That package's install script falls back to `node-gyp rebuild` because it ships no Linux prebuild. In two disposable installs on Node 22.22.1/npm 10.9.4, making `make` unavailable produced exit zero with `node-pty` absent; the otherwise identical install with the compiler available retained the package. This proves the omission mechanism, not the hosted machine's exact failure: the hosted job used npm 11.19.0 and did not retain its optional-package failure detail. `.github/workflows/ci.yml` (search: `WSL floor and LTS controls`) owns provisioning; `src/cli/server/terminal.ts` (search: `type NodePtyModule`) still requires the package's types at build time. Hosted execution remains open.

---

## Lesson: Keep native dependencies local to each test platform

**Status:** active | **Created:** 2026-10-12 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Check the test loader's native dependencies before replaying a Windows test from a WSL checkout.
**Trigger phase:** READ
**Caught at:** VERIFY

**Prevention:** Use dependencies installed for the executing platform. If a disposable JavaScript translation can isolate the failing contract, retain the original test and production source hashes, preserve assertions and fixtures, and identify that run as reduced proof rather than the original hosted reproduction.

**What happened:** I invoked native Windows Node against `test/integration/preflight-progress.test.ts` and `test/integration/gruff-warning-ratchet.test.ts` in the WSL checkout. The loader failed before either suite ran because the installed `esbuild` binary was `linux-x64`, while Windows required `win32-x64`. A disposable TypeScript-erasure translation of the unchanged npm-timeout case then passed on local Windows Node 24.9.0 with a byte-identical copy of the production runner. The reduced case also passed on a native Windows temporary volume using the hosted job's Node 22.23.3/npm 10.9.9 versions; the temporary copy was removed afterward.

**Evidence and limit:** `package-lock.json` (search: `node_modules/@esbuild/linux-x64`, `node_modules/@esbuild/win32-x64`) records separate native packages. `test/integration/preflight-progress.test.ts` (search: `times out installed npm with exit 124 and removes its script and worker`) owns the original contract. The local reduced pass does not explain or clear the [hosted Node 22 cleanup failure](https://github.com/blundergoat/goat-flow/actions/runs/38208889365/job/114678400808); retain that failure and capture the cleanup command's result before choosing a fix.

---

## Lesson: Reproduce CI prerequisites before replaying its test command

**Status:** active | **Created:** 2026-10-12 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Reproduce the preceding install and build steps before treating a local replay as the hosted job's reproduction.
**Trigger phase:** READ
**Caught at:** VERIFY
**Incident count:** 3 | **Latest occurrence:** 2026-10-13

**Prevention:** Read the failing job's complete setup, then recreate its dependencies and generated artifacts before running the original command. Preserve an incomplete-setup failure separately; it cannot explain a different hosted assertion.

**What happened:** I copied the current source into a disposable native Windows directory, installed its locked dependencies with Node 22.23.3/npm 10.9.9, and ran the original two-suite command before building. The npm cleanup case passed, but the installed analyzer smoke failed with `design.package-bin-missing` because the package binary was absent. CI had run `npm run build` first. After running that build and the unchanged warning ratchet, the original command reported `# pass 45`, `# fail 0`, `# skipped 2`.

**Evidence and limit:** `.github/workflows/ci.yml` (search: `Build package binary`, `Verification launch contracts`) owns the preceding setup. `test/integration/gruff-warning-ratchet.test.ts` (search: `launches the installed analyzer through the production ratchet`) checks the built package. The original command remains `node --import tsx --test test/integration/preflight-progress.test.ts test/integration/gruff-warning-ratchet.test.ts`. This local pass does not explain or clear the hosted Windows npm-cleanup failure; its hosted result still needs a rerun.


**Verification follow-up 2026-10-12:** Linting the extracted `WSL floor and LTS controls` body without an interpreter produced SC2148 because the inline CI script has no shebang. Its action already declares Bash. Running `shellcheck --shell=bash` on the same extracted bytes exited zero. Reproduce the workflow's interpreter as well as its install/build prerequisites when validating extracted shell blocks; this check-setup failure was not evidence of a workflow defect.

**Recurrence 2026-10-13 (Windows replay setup):** I attempted the current registered-Windows-override case directly through a WSL UNC source path; native Node reported that the test file was not found. A disposable native copy then failed dependency-junction setup through cmd, and a later module load failed because that partial copy omitted scripts/check-hook-parity.mjs. The original test body never ran. Stop after repeated setup corrections, retain each failure, and inspect the full import/setup boundary before another replay. Evidence anchors: test/integration/hook-command-spawn-matrix.test.ts (search: "delivers allow and exit-2 deny results through Codex's registered Windows override") and test/integration/gruff-code-quality-smoke.helpers.ts (search: "check-hook-parity.mjs"). The native probe used Node 24.9.0; the CI contract uses 20.11.0, so it cannot clear the hosted timeout.


---

## Lesson: Keep frozen reference fixtures outside any parent Git repository

**Status:** active | **Created:** 2026-10-12 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Separate saved diagnostic logs from temporary reference projects, and verify Git-root isolation before replaying a hook.
**Trigger phase:** ACT
**Caught at:** VERIFY

**Prevention:** Save scripts and logs in the requested plan directory, but create reference projects outside every Git checkout. Before executing a fixture, run `git -C <fixture> rev-parse --show-toplevel`; a returned parent root invalidates isolation. Record the temporary path separately and preserve failed diagnostic evidence.

**What happened:** While investigating M07's hosted C.UTF-8 extraction timeout, I set TMPDIR beneath this workspace's plan logs to keep receipts together. The frozen smoke group reported two failures. Git queried from the generated reference project returned the controlling goat-flow root, so the run could select live policy dependencies. I stopped only the owned replay processes, retained its log and scratch state, then created an isolated reference directory outside Git. The unchanged smoke group then reported 49 captured assertions and zero failures. The full replay was still running at that checkpoint.

**Evidence and limit:** `scripts/check-hook-parity.mjs` (search: `materializeReference`, `tmpdir()`); `test/fixtures/hooks-bash/.goat-flow/hooks/deny-dangerous.sh` (search: `git rev-parse --show-toplevel`, `GOAT_FLOW_ROOT`). This proves a local reproduction setup error. It does not explain the separate hosted Bash timeout, identify its case, or establish complete hosted parity.
