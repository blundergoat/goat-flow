---
category: verification-testing
last_reviewed: 2026-06-01
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

**Prevention:** For security changes that parse shell or agent-config command strings, run the focused parser/contract tests immediately, avoid dynamic regex construction when a literal token scan is enough, run `goat-flow stats --check` after renaming test anchors that learning-loop artifacts cite, and let current type/lint evidence override stale lesson text. Evidence anchors: `src/cli/audit/check-agent-deny-mechanism.ts` (search: `extractConfiguredScriptPath`), `test/unit/audit-command/agent-deny-hooks.test.ts` (search: `hides the script path in shell text`).
---

## Lesson: Gruff side-effect comments must name the side effect

**Status:** active | **Created:** 2026-05-30

**What happened:** During the M00 gruff docs continuation, the first internal-helper comment batch cleared `docs.missing-internal-function-doc` but left the full snapshot at only 175 findings down because gruff then reported `docs.missing-side-effect-doc` on helpers that write fixture files or spawn tools. Retuning those comments to explicitly say `Writes` or `Spawns` moved the full snapshot to `summary error=0 warning=121 advisory=598 total=719` and both doc clusters to zero.

**Root cause:** I wrote purpose comments for side-effecting helpers but did not include analyzer-recognised side-effect language. For gruff-ts docs rules, a human-useful purpose sentence is not enough when the helper mutates filesystem state or runs a subprocess.

**Prevention:** For helpers that write files, mutate fixtures, or run subprocesses, include the side effect in plain maintainer language (`Write`, `Run`, `filesystem`) instead of a generic purpose sentence. After large docs batches, check the full rule delta, not only the original docs cluster. Evidence anchors: `test/integration/audit-drift.helpers.ts` (search: `Write canonical skill stubs`), `test/integration/setup-install.helpers.ts` (search: `Run the shell installer`), `CHANGELOG.md` (search: `gruff-ts cleanup follow-up`).

---

## Lesson: Cache-behaviour tests need observable contracts

**Status:** active | **Created:** 2026-05-20

**What happened:** While replacing a flaky Quality cache timing assertion, my first counter-based test tried to observe deny-hook self-test executions by monkeypatching `child_process.execFileSync`. The route path imports `execFileSync` as a named binding before the test patch, so the counter stayed at zero and the focused dashboard integration test failed even though the product behavior was the target.

**Root cause:** I swapped a timing smell for an implementation-observation smell. Imported Node builtins and transitive helpers are not a reliable public signal for cache behavior.

**Prevention:** For server cache behavior, expose a narrow response/debug contract or inject an explicit dependency, then assert that contract at the route boundary. Avoid timing ratios and late monkeypatches of already-imported helpers. Evidence anchors: `src/cli/server/dashboard-quality-routes.ts` (search: `getOrRunQualityAudit`), `test/integration/dashboard-server-dashboard-api-quality.test.ts` (search: `reuses cached quality audits unless fresh=true is requested`), `src/cli/audit/check-agent-deny-mechanism.ts` (search: `checkHookSelfTest`).

---

## Lesson: Reference-pack wording fixes must check word budget immediately

**Status:** active | **Created:** 2026-05-19

**What happened:** Wording/schema edits repeatedly breached ADR-023 word caps: `skill-quality-testing/tdd-iteration.md` hit 3022/3008 words, `skill-preamble.md` exceeded 1500, and on 2026-05-22 proof-class fields pushed `goat-qa/SKILL.md` to 2578+.

**Root cause:** Treated prose edits as tiny while changing files governed by hard word-budget contracts.

**Prevention:** For any skill/reference/playbook wording change, measure the affected file before broad validation and budget wording cuts in the same patch. Run `node --import tsx --test test/contract/skill-hardening-contracts.test.ts`. Evidence anchors: `test/contract/skill-hardening-contracts.test.ts` (search: `functional skills stay within the 2500-word cap across all mirrors`), `test/contract/skill-hardening-contracts.test.ts` (search: `progressive reference packs stay within the 3000-word cap per file`), `workflow/skills/goat-qa/SKILL.md` (search: `Proof classes:`).
---

## Lesson: Source-regex dashboard tests must tolerate formatter reflow

**Status:** active | **Created:** 2026-05-11

**What happened:** While fixing dashboard terminal paste submission, focused `test/unit/dashboard-terminal-launch.test.ts` first passed. After formatting touched files, the rerun failed only because the "warms xterm" source assertion expected a multi-line `if` block shape that Prettier collapsed into one line. The runtime behavior was still correct; the test was over-specified to formatting.

**Root cause:** A classic-script source grep test used a whitespace-sensitive regex to assert control-flow structure. Formatter reflow changed the syntax layout without changing semantics.

**Fix:** Keep source-regex tests focused on semantic tokens and tolerate formatter-owned whitespace. Evidence anchors: `test/unit/dashboard-terminal-launch/launch-flow-06.test.ts` (search: `warms xterm when the workspace or setup view opens`), `src/dashboard/dashboard-app-init.ts` (search: `view === "workspace" || view === "setup"`).

**Prevention:** After changing source-grep tests for dashboard classic scripts, run Prettier before the focused test rerun. If a regex only protects structure, make whitespace flexible enough for formatter reflow or use a small VM helper test instead.

**Recurrence 2026-05-12:** While self-hosting xterm assets, `test/integration/dashboard-server.test.ts` fetched `/assets/xterm.js` successfully but failed because the assertion looked for `XTerm`, a string not present in the minified upstream bundle. The route was correct; the test anchor was wrong. For vendored/minified assets, assert route status/content type and stable feature strings observed in the actual bundle, such as `bracketedPasteMode`, not package names or branding text.

**Recurrence 2026-05-16:** While moving setup instruction surfaces into manifest-backed agent capabilities, full `npm test` failed because a source-grep prompt test still asserted literal `CLAUDE.md, .claude/settings.json` strings in `dashboard-setup-quality.ts`. The product change was correct; the test had become a stale parallel authority. For manifest-backed refactors, update source-grep tests to assert the data boundary (`workflow/manifest.json` plus injected fields) instead of the old duplicated literals.

**Recurrence 2026-05-27:** While hardening dashboard paste-submit timing in `src/dashboard/dashboard-terminal.ts`, the focused terminal suite passed but `npx prettier --check src/dashboard/dashboard-terminal.ts test/unit/dashboard-terminal-launch.test.ts` flagged `test/unit/dashboard-terminal-launch.test.ts` after long fake-timer assertions were added. Running Prettier on the touched TypeScript files fixed it before the final focused rerun. Prevention unchanged: run Prettier on changed dashboard classic-script tests before claiming verification is complete.

**Recurrence 2026-05-31:** While renaming dashboard classic-script files, `npx prettier --check ... test/unit/dashboard-terminal-launch/helpers.ts` failed after the source-list edit. Running Prettier on the touched helper before rerunning focused tests fixed the formatter-owned diff. Prevention unchanged: format changed dashboard classic-script tests before claiming verification is complete.
---

## Lesson: Regressions caught too late - tests run at milestone granularity, not edit granularity

**Status:** active | **Created:** 2026-04-05

**What happened:** Claude Insights reported 68 buggy-code friction events across 112 sessions (61% of sessions had at least one). The `/goat-qa` skill generates test plans after implementation, and `stop-lint.sh` used to run linting after every turn before its removal from goat-flow core per ADR-015, but neither caught logic regressions mid-implementation. Tests only run when the user explicitly asks or when a milestone completes. Regressions introduced in turn 3 of a 10-turn implementation aren't caught until the end, when the debugging context is stale.

**Root cause:** The verification loop runs at the wrong granularity. Lint after every turn catches syntax. Tests after every milestone catch logic. The gap between these two is where regressions hide.

**Prevention:**
1. Consider an optional post-write hook that runs the project's test command after file changes (configured via `config.yaml`, off by default)
2. Skills with implementation phases should include a "run tests" checkpoint every N edits, not just at phase boundaries
3. For test-heavy projects (1000+ tests), a focused test subset (changed files only) avoids the full-suite penalty while still catching regressions early
---

## Lesson: Semantic drift checks must normalize natural-language lists before claiming mismatch

**Status:** active | **Created:** 2026-04-18

**What happened:** A new semantic-drift check was added for the runner list in `docs/dashboard.md`. The first verification run still failed content audit even after the doc was corrected to "Claude, Codex, and Gemini". The checker split on commas before handling the Oxford-comma `and`, so it parsed the claim as `["Claude", "Codex", "and Gemini"]` and reported a false mismatch against the manifest-backed list.

**Root cause:** The drift check compared human-written prose too literally. It handled exact token matches but not natural-language list formatting, so a doc that was semantically correct still failed verification. The bug was in the checker, not in the docs.

**Fix:** Normalize list items before comparison by stripping a leading `and ` token after the split, then add a regression test that proves the current dashboard wording does not trigger `dashboard-runner-drift`.

**Prevention:**
1. When adding semantic drift checks for prose, test both a known-bad example and the current canonical wording.
2. Normalize natural-language list glue (`and`, Oxford commas, surrounding whitespace) before comparing against code-backed enumerations.
3. Treat a new drift rule that immediately flags corrected docs as a checker bug until the parser is disproven.

---

## Lesson: Filtered manifest ids still need explicit indexed-lookup proof in TypeScript

**Status:** active | **Created:** 2026-04-21

**What happened:** A manifest-backed registry cleanup reused one `loadManifest().agents` snapshot per public call and filtered configured ids with `isKnownAgentId()`. The focused unit tests passed, but the first `npm run typecheck` still failed on the follow-up mapping step because `agents[id]` was treated as possibly `undefined` inside `.map((id) => toRuntimeProfile(id, agents[id]))`. The same verification pass also caught a Prettier reflow issue in the touched registry file.

**Root cause:** Runtime truth from a filter callback does not always carry through to a later indexed `Record<string, T>` lookup strongly enough for TypeScript to discharge `undefined`. The refactor was logically correct, but the type proof at the final lookup site was incomplete. Formatting drift surfaced because the new helper signature changed line wrapping and the file had not yet been reflowed.

**Fix:** Add the explicit proof at the indexed lookup site (`agents[id]!` or a typed-entry helper), run Prettier on the touched TypeScript file, and rerun the exact failing gates.

**Prevention:**
1. After refactoring manifest/registry code that filters ids and then indexes a `Record`, run `npm run typecheck` even if the focused unit tests already pass.
2. When a helper signature or typed callback changes in a touched `.ts` file, include `prettier --check` or `prettier --write` in the focused verification pass before closeout.
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

**Root cause:** The search pattern contained HTML text (`pill-label">`) and the command was assembled too casually. A read-only verification command stopped being read-only because the shell parsed the stray `>` before `rg` ever ran.

**Prevention:** Quote every search pattern containing `<`, `>`, `|`, or quotes as a single shell argument, or pass it via a safer command form. After any complex shell search over generated/HTML-heavy files, run `git diff --stat` or `wc -l` on touched files before continuing verification.

---

## Lesson: Contract tests pin doctrine wording and path semantics

**Status:** active | **Created:** 2026-04-25

**What happened:** While removing one forbidden phrase and changing dashboard quality report ownership, the first full `npm test` run failed two contract-style checks: `test/contract/skill-hardening-contracts.test.ts` still required the established "hardening debt" evidence language, and a dashboard prompt-source assertion still expected the old relative quality-report path message.

**Root cause:** I treated wording cleanup and path-semantics changes as local edits, but these surfaces are intentionally pinned by tests because agents consume the exact phrasing.

**Recurrence 2026-05-17:** During M10 path validation hardening, the first full `npm test` run caught `test/smoke/dashboard-endpoints.test.ts` still asserting the old `Invalid project path` terminal error wording after `validateProjectPath` moved to the shared `LocalPathValidationError` contract. Evidence anchors: `src/cli/server/local-paths.ts` (search: `Local path validation failed`), `test/smoke/dashboard-endpoints.test.ts` (search: `rejects missing and file project paths before PTY launch`).

**Prevention:** Before broad prose or prompt wording changes, search tests for the exact phrase and adjacent command text. If the product semantics are changing, update the contract test in the same edit; if the test protects unrelated established doctrine, keep that phrase intact.
---

## Lesson: Split transient preflight test failures from task regressions

**Status:** active | **Created:** 2026-04-26

**What happened:** A quality-report fix removed the ESLint error that had been blocking `bash scripts/preflight-checks.sh`. Two subsequent preflight runs reached the fast test phase but failed on different tests: first `agent deny hook template comparison`, then `harness does not affect build-only result`. A direct `npm run test:fast` run immediately after those failures completed with `# pass 373` and `# fail 0`.

**Root cause:** I initially treated the preflight failure as a likely task regression because it appeared inside the final gate. The changing failed test names and the direct fast-suite pass showed the correct split: the task-local ESLint/preflight regression was fixed, while the preflight wrapper still surfaced intermittent fast-suite failures that need separate investigation.

**Prevention:** When preflight fails in the test phase after unrelated gate fixes, rerun the named failing test area and then the exact fast-suite command directly before changing task files again. The preflight wrapper now reruns `test:fast` once when the first test-phase attempt fails; a retry pass records a warning with the initial `not ok` lines instead of failing the whole gate. Report the split explicitly: which original gate was fixed, which direct test summary passed, and whether preflight isolated a transient first-run failure.
---

## Lesson: Temp cleanup must satisfy destructive-command hooks

**Status:** active | **Created:** 2026-05-08

**What happened:** While smoke-testing `scripts/install-browser-tools.sh` wrapper-guard behavior, a temp-directory cleanup command used `rm -rf "$tmpdir"`. The PreToolUse hook blocked the command with `BLOCKED: rm -r without safe scoping. Specify an explicit target path.` The smoke test had to be rerun with non-recursive cleanup: `rm -f "$tmpdir/browser-use"; rmdir "$tmpdir"`.

**Root cause:** Treated a `mktemp` path as self-evidently safe, but the hook cannot prove variable-scoped recursive deletion is bounded.

**Prevention:** For verification scratch space, prefer non-recursive cleanup (`rm -f` known files, then `rmdir`) or an explicit literal temp path pattern that satisfies the hook. Do not combine validation and variable-scoped `rm -rf` in the same command.

---

## Lesson: Hook regex edits need syntax probes before self-test fanout

**Status:** active | **Created:** 2026-04-27

**What happened:** While hardening the git-mutation guardrail against quoted and wrapper-prefixed `git push` bypasses, the first focused self-test failed every safe case because a Bash `[[ =~ ]]` expression with an inline `)` regex caused a parse error before the command checks could run. Later manual probes caught more wrapper-option misses after the self-test was green: `command -p git push`, `env -- git push`, and `/usr/bin/time -f %E git push` still returned exit 0 until option-bearing wrapper forms were added. The same verification pass caught a repeated VM-test mistake: `assert.deepEqual` compared a VM-created array with a host-realm array and failed despite matching printed structure.

**Root cause:** I edited a shell regex directly inside `[[ ... =~ ... ]]` instead of moving the pattern to a variable, which is safer for regex metacharacters that the Bash parser can see. I also forgot the existing VM cross-realm lesson when adding a new classic-script helper test.

**Prevention:** After changing Bash hook regexes, run `bash -n <hook>` before interpreting self-test failures; if the regex contains `(`, `)`, `{`, or `}`, prefer a named regex variable. For command wrapper deny rules, probe both bare wrappers and option-bearing wrappers before mirror fanout (`command -p`, `env --`, `env -C`, `time -f`, quoted time formats). For VM-loaded dashboard helper tests, compare scalar fields/lengths or normalize arrays into the host realm. Evidence anchors: `workflow/hooks/hook-lib/patterns-writes.sh` (search: `is_git_push`), `workflow/hooks/hook-lib/deny-dangerous-self-test.sh` (search: `sudo git push`), `src/dashboard/views/quality.html` (search: `qualityHistoryRows.length`).
---
