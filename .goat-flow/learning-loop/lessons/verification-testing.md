---
category: verification-testing
last_reviewed: 2026-08-06
---

## Lesson: Hook fallback fixes must preserve the caller-visible failure signal

**Status:** active | **Created:** 2026-06-03
**Decision changed:** Verify fallback and optimized hook paths against the same adversarial repository configuration, not only the same payload.
**Trigger phase:** VERIFY
**Incident count:** 3 | **Latest occurrence:** 2026-08-03

**What happened:** During PR #47 follow-up fixes, the first deny-dangerous fallback patch set the unsafe JSON status inside helper functions called through command substitution. The focused full self-test still failed the top-level unsupported unicode regression because Bash ran the helpers in subshells and the caller never saw the updated variable. The first gruff staged-hunk patch had a similar over-broad shape: adding cached diff ranges unconditionally widened explicit payload scopes and broke existing changed-range tests before the fallback-only test could be trusted.

**Recurrence 2026-08-03:** The optimized `post-turn-safety` path pinned Git's diff prefixes, but its Bash 3 fallback consumed the repository's default diff format. With `diff.mnemonicPrefix=true`, the fallback stopped recognizing destination headers, skipped a changed credential file, and exited zero while the optimized path blocked it. Pinning `core.quotepath`, mnemonic-prefix behavior, and source/destination prefixes at the fallback's own `git diff` boundary restored parity. Evidence anchors: `workflow/hooks/post-turn-safety.sh` (search: `fallback_scan_diff`) and `test/integration/post-turn-safety-hook-scanning.test.ts` (search: `pins mnemonic Git diff prefixes on both paths`).

**Root cause:** I changed fallback behavior without keeping the failure signal and input grammar at the same boundary the caller observes. For deny-dangerous that meant relying on mutated shell state across `$(...)`; for gruff that meant mixing explicit payload paths and pathless git fallback paths before proving their different contracts; for post-turn-safety it meant allowing repository Git configuration to change only the fallback parser's input shape.

**Prevention:** For hook fallback changes, add the exact regression probe first, then verify that helper return status or source-aware branching reaches the caller boundary. Force compatibility paths under adversarial user and repository configuration, assert parity with the optimized path, and pin any machine-readable Git output grammar at the command that produces it. Keep explicit payload scopes and git-discovered fallback scopes separate until focused tests prove both paths. Evidence anchors: `workflow/hooks/deny-dangerous.sh` (search: `extraction_status`), `workflow/hooks/gruff-code-quality.sh` (search: `payload_file_paths`), `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `top-level unsupported unicode escape`), and `test/integration/gruff-code-quality-smoke.test.ts` (search: `uses staged hunks for pathless fallback files`).

---

## Lesson: Timeout completion needs a deadline independent of child close

**Status:** active | **Created:** 2026-07-12

**What happened:** The seven-skill pressure matrix reproduced a preflight runner that exceeded its hard timeout window after process-group escalation. A detached test helper escaped the group, inherited stdout/stderr, and held those pipes open, so Node delayed the child's `close` event after the direct process exited.

**Root cause:** The timeout path bounded process termination but used `close` as its only result-delivery event. An escaped descriptor holder could therefore hide a known timeout result.

**Fix:** After SIGKILL, use a one-shot result deadline that preserves the observed direct-child status, destroys only local capture streams, emits a cleanup-limit diagnostic, and ignores late events. Evidence anchors: `scripts/preflight-command-runner.mjs` (search: `cleanup deadline reached after process-group escalation`) and `test/integration/preflight-progress.test.ts` (search: `returns after escalation when an escaped descendant retains the capture pipe`).

**Prevention:** Test timeout runners with a descendant that escapes the signalled group while retaining an output descriptor. Assert both status and a wall-clock bound; process-kill proof alone does not prove the caller returns.

---

## Lesson: Delegated pressure runs need persistent recovery state

**Status:** active | **Created:** 2026-07-12

**What happened:** M33 launched a long `goat-critique` run with `codex exec --ephemeral`. The run persisted Phase 1–4 evidence but was interrupted before synthesis; `codex exec resume` then failed with `no rollout found`, so the otherwise detailed attempt remained UNVERIFIED and had to be repeated.

**Root cause:** The runner contract optimized for session cleanup even though delegated critique is expensive and its completion evidence spans multiple agent results plus a meta-audit.

**Prevention:** Use persistent native sessions for delegated or multi-turn pressure tests. Keep ephemeral sessions for single-turn probes only; record the thread ID early and prove a recovery path before treating a long run as the sole release evidence.

---

## Lesson: Gruff-driven direct imports must preserve facade proof

**Status:** active | **Created:** 2026-05-31

**What happened:** During `test-quality` cleanup, gruff's nearby-test requirement pushed several tests from public facade imports to implementation-module imports. The first full `npm test` rerun then failed the installer round-trip preflight because Knip found `8 unused exports/types`, including facade re-exports such as `createAuditFactsView`, `scoreAllArtifacts`, and `normalizeAgentVersionOutput`. The same verification pass caught an order-sensitive dashboard tasks assertion: `/api/tasks` returned `Milestone-malformed.md` before `Milestone-side-menu-navigation.md`, so the test failed with `# fail 1` even though both milestone records were present.

**Root cause:** I treated "direct implementation import for gruff" and "facade import for Knip/API stability" as mutually exclusive, and one endpoint test asserted incidental filesystem ordering instead of selecting the record that carried the behavior under test.

**Recurrence 2026-05-31:** Deleting 25 low-quality tests produced the same shape from the other direction: `npx knip` flagged production exports that only deleted tests imported, `npm run typecheck` caught the route inventory left behind for the deleted route-classification test, and the installer round-trip preflight caught hidden `.goat-flow` anchors that still cited deleted test paths.

**Prevention:** When direct imports are needed to prove a nearby implementation module, keep stable facade exports exercised with explicit alignment assertions in existing nearby tests. For endpoint arrays that do not declare a sort contract, select records by semantic identifier before asserting fields. Evidence anchors: `src/cli/audit/audit.ts` (search: `createAuditFactsView`), `src/cli/quality/skill-quality.ts` (search: `scoreAllArtifacts`), `test/integration/dashboard-tasks-api.test.ts` (search: `milestoneByFilename`).

---

## Lesson: Security parser fixes need focused parser proof

**Status:** active | **Created:** 2026-05-30

**What happened:** During the M00 security cleanup, I replaced dynamic `bash -lc` hook smoke execution with fixed-vector guard-script execution. The first parser used a dynamic RegExp and failed focused audit tests with `Invalid regular expression`; typecheck also caught `split(...)[0]` as possibly undefined. After switching to a literal `.sh` token scan and updating the stale assertion, the focused audit/install tests reported `# pass 153` / `# fail 0`. The learning-loop stats check then caught two stale anchors that still referenced the old test name, and full preflight caught an unnecessary `String(...)` conversion copied forward from the old hook-testing lesson.

**Root cause:** I treated shell-command parsing as a small cleanup after removing the risky spawn path. The safer behavior changed the test contract, and the first parser shape had its own syntax hazard.

**Prevention:** For security changes that parse shell or agent-config command strings, run the focused parser/contract tests immediately, avoid dynamic regex construction when a literal token scan is enough, run `goat-flow stats --check` after renaming test anchors that learning-loop artifacts cite, and let current type/lint evidence override stale lesson text. Evidence anchors: `src/cli/audit/check-agent-deny-runtime.ts` (search: `extractConfiguredScriptPath`), `test/unit/audit-command/agent-deny-hooks.test.ts` (search: `hides the script path in shell text`).

---

## Lesson: Gruff side-effect comments must name the side effect

**Status:** active | **Created:** 2026-05-30

**What happened:** During the M00 gruff docs continuation, the first internal-helper comment batch cleared `docs.missing-internal-function-doc` but left the full snapshot at only 175 findings down because gruff then reported `docs.missing-side-effect-doc` on helpers that write fixture files or spawn tools. Retuning those comments to explicitly say `Writes` or `Spawns` moved the full snapshot to `summary error=0 warning=121 advisory=598 total=719` and both doc clusters to zero.

**Recurrence update (2026-08-06):** Windows discovery described its purpose and fallback but did not explicitly name the `where.exe` process side effect. Adding that concrete process action cleared the three targeted side-effect findings.

**Root cause:** I wrote purpose comments for side-effecting helpers but did not include analyzer-recognised side-effect language. For gruff-ts docs rules, a human-useful purpose sentence is not enough when the helper mutates filesystem state or runs a subprocess.

**Prevention:** For helpers that write files, mutate fixtures, or run subprocesses, include the side effect in plain maintainer language (`Write`, `Run`, `filesystem`) instead of a generic purpose sentence. After large docs batches, check the full rule delta, not only the original docs cluster. Evidence anchors: `test/integration/audit-drift.helpers.ts` (search: `Write canonical skill stubs`), `test/integration/setup-install.helpers.ts` (search: `Run the shell installer`), `CHANGELOG.md` (search: `gruff-ts cleanup follow-up`).

---

## Lesson: Cache-behaviour tests need observable contracts

**Status:** active | **Created:** 2026-05-20

**What happened:** While replacing a flaky Quality cache timing assertion, my first counter-based test tried to observe deny-hook self-test executions by monkeypatching `child_process.execFileSync`. The route path imports `execFileSync` as a named binding before the test patch, so the counter stayed at zero and the focused dashboard integration test failed even though the product behavior was the target.

**Root cause:** I swapped a timing smell for an implementation-observation smell. Imported Node builtins and transitive helpers are not a reliable public signal for cache behavior.

**Prevention:** For server cache behavior, expose a narrow response/debug contract or inject an explicit dependency, then assert that contract at the route boundary. Avoid timing ratios and late monkeypatches of already-imported helpers. Evidence anchors: `src/cli/server/dashboard-quality-routes.ts` (search: `getOrRunQualityAudit`), `test/integration/dashboard-server-dashboard-api-quality.test.ts` (search: `reuses cached quality audits unless fresh=true is requested`), `src/cli/audit/check-agent-deny-mechanism.ts` (search: `checkHookSelfTest`).

---

## Lesson: guardrail self-test needs no-space redirect and false-positive probes

**Status:** active | **Created:** 2026-04-24

**What happened:** `bash .claude/hooks/deny-dangerous-self-test.sh --self-test=full` passed, but live repros still showed a bypass for `echo foo>.env`, `echo foo>>.env`, `echo foo>|.env`, and `echo foo>.env.example` because the hook only treated `>` as a redirect when followed by whitespace. The same pass also left unescaped `.env` / `.env.example` regexes in place, so benign names like `aenv`, `xenv.local`, and `aenv.example` were misclassified as secret or sample-env paths.

**Root cause:** I trusted the existing self-test matrix too early. It covered spaced redirects (`> .env`, `>| .env.example`) and canonical `.env` names, but not the no-space shell forms or near-miss filenames that reveal wildcard-dot false positives.

**Fix:** Escape the leading dots in the `.env` / `.env.example` regexes, detect redirect targets without requiring whitespace, and add self-test cases for `>.env`, `>>.env`, `>|.env.example`, `aenv`, `xenv.local`, and `aenv.example`.

**Prevention:**
1. For shell-hook path regexes, test both positive and negative examples: canonical secret names, no-space redirect forms, and near-miss filenames that differ by one character.
2. Do not treat `--self-test` as sufficient evidence for shell parsing changes until it includes the exact reproduction strings that originally demonstrated the bug.

---

## Lesson: Shell metacharacters in verification searches can corrupt source files

**Status:** active | **Created:** 2026-04-26

**What happened:** During M05b verification, a malformed `rg` command accidentally left a literal `>` outside the quoted search pattern. The shell interpreted it as output redirection and truncated `src/dashboard/views/home.html` to an empty file. The mistake was caught by `wc -l`, `git diff`, and the dashboard HTML regression before final verification, then the Home template was restored.

**Recurrence 2026-06-14:** While verifying a `goat-qa` skill-doc edit, an `rg` pattern included Markdown backticks around `initialInput`. The deny-dangerous hook blocked it as command substitution before execution. No files were changed by the blocked command, but the verification pass still had to be rerun with a safer pattern. Evidence anchors: `workflow/skills/goat-qa/SKILL.md` (search: `safe to skip more PTY timing tests`) and `.goat-flow/learning-loop/lessons/verification-testing.md` (search: `Shell metacharacters in verification searches can corrupt source files`).

**Recurrences 2026-07-17 and 2026-07-19:** Double-quoted `rg` patterns containing Markdown backticks were blocked before execution. Single-quoting the whole pattern fixed both searches without changing files. Evidence: `workflow/hooks/deny-dangerous.sh` (search: `Backtick command substitution hides nested execution`).

**Root cause:** The search pattern contained shell-significant characters (`>` in HTML text, later backticks in Markdown text) and the command was assembled too casually. A read-only verification command stopped being read-only because the shell parsed the pattern before `rg` ever ran.

**Prevention:** Quote every search pattern containing `<`, `>`, `|`, backticks, or quotes as a single shell argument, or pass it via a safer command form. After any complex shell search over generated/HTML-heavy files, run `git diff --stat` or `wc -l` on touched files before continuing verification.

---

## Lesson: Contract tests pin doctrine wording and path semantics

**Status:** active | **Created:** 2026-04-25

**What happened:** While removing one forbidden phrase and changing dashboard quality report ownership, the first full `npm test` run failed two contract-style checks: `test/contract/skill-hardening-contracts.test.ts` still required the established "hardening debt" evidence language, and a dashboard prompt-source assertion still expected the old relative quality-report path message.

**Root cause:** I treated wording cleanup and path-semantics changes as local edits, but these surfaces are intentionally pinned by tests because agents consume the exact phrasing.

**Recurrence 2026-05-17:** During M10 path validation hardening, the first full `npm test` run caught `test/smoke/dashboard-endpoints.test.ts` still asserting the old `Invalid project path` terminal error wording after `validateProjectPath` moved to the shared `LocalPathValidationError` contract. Evidence anchors: `src/cli/server/local-paths.ts` (search: `Local path validation failed`), `test/smoke/dashboard-endpoints.test.ts` (search: `rejects missing and file project paths before PTY launch`).

**Recurrence 2026-07-13:** M20's first manual JSON probe parsed the report, then failed because it assumed a root `groups` key instead of the implemented `surfaces` groups. Re-reading the locked fixture showed the report was correct; the probe was rewritten against `goat-flow.context-report.v1`. Evidence anchor: `test/unit/context-report.test.ts` (search: `renders parseable JSON without telemetry or provider state`).

**Recurrence 2026-07-19:** A `setupPrompt` fixture landed in the preceding subtest, so RED failed with `setupPrompt is not defined` instead of the intended prompt-copy assertion. Moving the fixture into its consumer produced the real failure. Evidence: `test/contract/command-phrases.test.ts` (search: `keeps git-history correlations as candidates until semantic proof exists`).

**Recurrence 2026-07-29:** Pins include section adjacency: inserting an `## Effort Estimates` section between the illustrative-scenario label and `## Assumption Tracking` in `goat-plan/references/milestone-examples.md` failed `test/contract/skill-hardening-shared-3.test.ts` (search: `scenario label must immediately precede the assumption block`); moving the section above the label fixed it.

**Recurrence 2026-08-03:** The first GREEN wording for oversized review scope and critique context merging pushed `goat-review` and `goat-critique` from 2495/2494 words to 2592/2531. The focused skill-contract run rejected both before broader verification; budget-neutral rewrites finished at 2498/2495. Evidence anchors: `workflow/skills/goat-review/SKILL.md` (search: `never guess commit windows`), `workflow/skills/goat-critique/SKILL.md` (search: `never replace baseline context`), `test/contract/skill-hardening-review-1.test.ts` (search: `stops oversized inferred branch scopes before review begins`). TDD receipts: `.goat-flow/logs/sessions/2026-08-03-goat-review-tdd.md` and `.goat-flow/logs/sessions/2026-08-03-goat-critique-tdd.md`.

**Prevention:** Search tests for changed prose and adjacent commands. Keep fixtures inside their consuming subtest and re-read the block before RED. Update a contract only when product semantics change; preserve unrelated doctrine. Before drafting in a near-cap skill, measure the current word budget; replace or condense existing wording, or move detail into a progressive reference, before GREEN.
---

## Lesson: Split transient preflight test failures from task regressions

**Status:** active | **Created:** 2026-04-26

**What happened:** A quality-report fix removed the ESLint error that had been blocking `bash scripts/preflight-checks.sh`. Two subsequent preflight runs reached the fast test phase but failed on different tests: first `agent deny hook template comparison`, then `harness does not affect build-only result`. A direct `npm run test:fast` run immediately after those failures completed with `# pass 373` and `# fail 0`.

**Root cause:** I initially treated the preflight failure as a likely task regression because it appeared inside the final gate. The changing failed test names and the direct fast-suite pass showed the correct split: the task-local ESLint/preflight regression was fixed, while the preflight wrapper still surfaced intermittent fast-suite failures that need separate investigation.

**Prevention:** When preflight fails in the test phase after unrelated gate fixes, rerun the named failing test area and then the exact fast-suite command directly before changing task files again. The preflight wrapper now reruns `test:fast` once when the first test-phase attempt fails; a retry pass records a warning with the initial `not ok` lines instead of failing the whole gate. Report the split explicitly: which original gate was fixed, which direct test summary passed, and whether preflight isolated a transient first-run failure.
---

## Lesson: Temp cleanup must satisfy destructive-command hooks

**Status:** active | **Created:** 2026-05-08
**Incident count:** 2 | **Latest occurrence:** 2026-08-03

**What happened:** While smoke-testing `scripts/install-browser-tools.sh` wrapper-guard behavior, a temp-directory cleanup command used `rm -rf "$tmpdir"`. The PreToolUse hook blocked the command with `BLOCKED: rm -r without safe scoping. Specify an explicit target path.` The smoke test had to be rerun with non-recursive cleanup: `rm -f "$tmpdir/browser-use"; rmdir "$tmpdir"`.

**Recurrence 2026-08-03:** A packaged-release smoke again placed variable-scoped `rm -rf` in the same shell program as the validation. The hook rejected the complete command before `mktemp` ran, so no validation state was created. The rerun omitted destructive cleanup and retained its printed `/tmp/goat-flow-release-check.*` directory as disposable local evidence.

**Root cause:** Treated a `mktemp` path as self-evidently safe, but the hook cannot prove variable-scoped recursive deletion is bounded.

**Prevention:** For verification scratch space, prefer non-recursive cleanup (`rm -f` known files, then `rmdir`) or an explicit literal temp path pattern that satisfies the hook. Do not combine validation and variable-scoped `rm -rf` in the same command.

---

## Lesson: Hook regex edits need syntax probes before self-test fanout

**Status:** active | **Created:** 2026-04-27

**What happened:** While hardening the git-mutation guardrail against quoted and wrapper-prefixed `git push` bypasses, the first focused self-test failed every safe case because a Bash `[[ =~ ]]` expression with an inline `)` regex caused a parse error before the command checks could run. Later manual probes caught more wrapper-option misses after the self-test was green: `command -p git push`, `env -- git push`, and `/usr/bin/time -f %E git push` still returned exit 0 until option-bearing wrapper forms were added. The same verification pass caught a repeated VM-test mistake: `assert.deepEqual` compared a VM-created array with a host-realm array and failed despite matching printed structure.

**Root cause:** I edited a shell regex directly inside `[[ ... =~ ... ]]` instead of moving the pattern to a variable, which is safer for regex metacharacters that the Bash parser can see. I also forgot the existing VM cross-realm lesson when adding a new classic-script helper test.

**Prevention:** After changing Bash hook regexes, run `bash -n <hook>` before interpreting self-test failures; if the regex contains `(`, `)`, `{`, or `}`, prefer a named regex variable. For command wrapper deny rules, probe both bare wrappers and option-bearing wrappers before mirror fanout (`command -p`, `env --`, `env -C`, `time -f`, quoted time formats). For VM-loaded dashboard helper tests, compare scalar fields/lengths or normalize arrays into the host realm. Evidence anchors: `workflow/hooks/deny-dangerous/patterns-writes.sh` (search: `is_git_push`), `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `sudo git push`), `src/dashboard/views/quality.html` (search: `qualityHistoryRows.length`).
---

## Lesson: Scanner hardening must test block and allow cases together

**Status:** active | **Created:** 2026-06-14

**What happened:** During M08 post-turn safety hardening, live probes showed three false negatives: bare `sk-...` tokens, `export API_KEY=...`, and quoted credential assignments containing `#`. The first parser patch still failed the new exported/quoted tests because key extraction tried to parse and classify sensitive keys in one POSIX ERE. Splitting key extraction from keyword classification fixed those cases, but the next focused run failed existing placeholder tests because `API_KEY=your_api_key_here` had only been allowed when the old key parser missed `API_KEY` entirely.

**Root cause:** I tested new must-block probes before accounting for must-allow placeholders that were accidentally protected by the old false negative.

**Prevention:** For credential-scanner changes, run a matrix that includes must-block misses and must-allow placeholder assignments after each parser edit. Parse/normalize the assignment key first, classify it second, and expect a broader key match to require explicit placeholder allowlist proof. Evidence anchors: `workflow/hooks/post-turn-safety.sh` (search: `scan_env_assignment`), `test/integration/post-turn-safety-hook.test.ts` (search: `blocks exported credential assignments`), and `test/integration/post-turn-safety-hook.test.ts` (search: `allows safe placeholders in env examples`).

**Recurrence 2026-08-02:** The PR #57 scanner-parity fix first lost the raw assignment key because a placeholder helper overwrote Bash's global `BASH_REMATCH`, then broader forced-fallback fixtures exposed Docker space-form and multi-assignment drift, dotted config-reference drift, npm secondary-assignment drift, and quoted-password mismatches. The complete native-versus-fallback finding-set comparison caught these after the initial named examples agreed. Capture regex matches before calling helpers, and compare normalized findings across the full existing block-and-allow corpus rather than treating a few equal exit codes as parity. Evidence anchors: `workflow/hooks/post-turn-safety.sh` (search: `scan_literal_credential_assignment`), and `test/integration/post-turn-safety-hook.helpers.ts` (search: `hookFindingSignatures`).

**Recurrence 2026-08-02:** PR #57 review found `plans time` rejecting `stop --discard-open` under the clock reversal whose own error names discard as the remedy. The suite had a discard case and a reversal case; neither crossed. Rule: when an error names a recovery path, test that path under the condition raising it. Evidence: `src/cli/plans-time.ts` (search: `if (transition.discardOpen) return;`), `test/unit/plans-time.test.ts` (search: `lets discard-open recover a span the clock reversed under`).

---

## Lesson: Scanner scope gates need parser-shape fixtures for each claimed file family

**Status:** active | **Created:** 2026-06-14

**What happened:** While reducing `post-turn-safety` generic credential-assignment false positives, I scoped `scan_env_assignment` to env/config-shaped files and included Dockerfiles in that scope. The first live matrix still allowed `ARG CLIENT_SECRET=LiteralDockerSecret123` because the parser only recognized bare `KEY=value` and `export KEY=value`, not Dockerfile `ARG`/`ENV` prefixes. A follow-up review then found two more parser-shape misses: camelCase config keys such as `clientSecret` normalized to `clientsecret` instead of `client_secret`, and Dockerfile multi-assignment `ENV SAFE=x API_TOKEN=...` inspected only one extracted key/value shape.

**Root cause:** I verified the path gate broadly but did not pair every newly claimed file family and naming convention with a syntax-shaped fixture. The gate said "Dockerfile" while the parser still only understood shell/env assignment syntax, and the key classifier said "credential-shaped keys" without proving common config casing.

**Prevention:** When a scanner scope gate lists file families, add at least one block fixture for each family whose syntax differs from the default parser shape. For Dockerfiles, probe both `ARG KEY=value` / `ENV KEY=value`, `ARG KEY value` / `ENV KEY value`, and multi-assignment `ENV SAFE=x API_TOKEN=...`; for config key classifiers, probe snake_case, uppercase, and camelCase/PascalCase credential names plus excluded suffixes such as `tokenCount`, `secretName`, and `clientSecretId`. Evidence anchors: `workflow/hooks/post-turn-safety.sh` (search: `is_env_assignment_file`), `workflow/hooks/post-turn-safety.sh` (search: `scan_env_assignment`), and `test/integration/post-turn-safety-hook.test.ts` (search: `blocks Dockerfile ARG and ENV credential assignments`).

---

## Lesson: Coverage classification by filename misjudges in both directions

**Status:** active | **Created:** 2026-06-14
**Updated:** 2026-07-19
**Decision changed:** Search the whole test tree and classify each named behaviour/invariant; a file-level label cannot promote uncovered siblings.
**Trigger phase:** VERIFY
**Incident count:** 2
**Latest occurrence:** 2026-07-19

**What happened:** A shipped Audit example classified coverage from same-name unit files and made three NONE/untested claims that integration suites disproved or later invalidated. On 2026-07-19, goat-qa A3's single label per file could likewise let one covered behaviour hide an uncovered sibling; the first correction required only CRITICAL/HIGH rows, leaving MEDIUM/LOW matrix rows ambiguous until manual verification.

**Root cause:** Filename and file-level summaries are lossy coverage proxies. Tests cross filenames, and one source file can contain behaviours with different coverage depths.

**Prevention:** Search all tests and end-to-end invocations before classifying. Inventory every named behaviour/invariant, make CRITICAL/HIGH exhaustive, and assign one coverage row per behaviour. BEHAVIOURAL applies only to what that row proves. Keep shipped examples explicitly non-evidence unless a contract locks live coverage. Evidence anchors: `workflow/skills/goat-qa/SKILL.md` (search: `A file summary cannot promote a row`), `test/contract/skill-hardening-shared-2.test.ts` (search: `keeps covered behaviours from deferring uncovered siblings`), `src/cli/audit/check-goat-flow.ts` (search: `SETUP_CHECKS`) and `test/integration/audit-build.test.ts` (search: `assertBuildChecksPass`).
---

## Lesson: Declined optional verification must not create a degradation flag

**Status:** active | **Created:** 2026-07-12

**What happened:** On 2026-07-12, declining goat-review's optional external refuter incorrectly added `coverage-degraded`; on 2026-07-18, an unselected Spec Drift pass still added `spec-drift-skipped`. Both penalized a complete local review for omitting optional verification.

**Prevention:** Optional verification gets a separate status and cannot create degradation by absence alone. Name forbidden flags and pin each path. Evidence: `workflow/skills/goat-review/SKILL.md` (search: `Preserve only degradation flags`; search: `Optional skip is not degradation`), `test/contract/skill-hardening-contracts.test.ts` (search: `solely because the user declined`; search: `keeps an unselected optional Spec Drift pass out of review degradation`), and local receipt `.goat-flow/logs/sessions/2026-07-18-goat-review-tdd.md`.

---

## Lesson: Depth headings do not create runtime stop boundaries

**Status:** active | **Created:** 2026-07-12

**What happened:** On 2026-07-12, goat-security Quick Scan entered a Full-only specialist phase and waited about eight minutes. On 2026-07-18, goat-debug Investigate made an explicit read-only scope wait at I1. In both cases, headings implied flow but did not define the runtime boundary.

**Prevention:** Every branch needs an explicit stop or continue rule plus a contract; headings are orientation, not control flow. Evidence: `workflow/skills/goat-security/SKILL.md` (search: `Quick-stop boundary`), `workflow/skills/goat-debug/SKILL.md` (search: `continue to I2 without waiting`), `test/contract/skill-hardening-contracts.test.ts` (search: `Quick Scan out of Full-only specialist work`; search: `lets an explicit read-only investigation pass its scope checkpoint`), and local receipt `.goat-flow/logs/sessions/2026-07-18-goat-debug-tdd.md`.

---
