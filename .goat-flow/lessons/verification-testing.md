---
category: verification-testing
last_reviewed: 2026-05-02
---

## Lesson: Formatter verification must preserve repo style flags

**Status:** active | **Created:** 2026-04-03

**What happened:** While tightening scanner messages, verification included a `prettier --write` pass on three rubric files without the repo's single-quote flag. The code was still valid, but the formatter rewrote quote style across entire files and created a much larger diff than intended.
**Root cause:** Treated formatting as a neutral cleanup step instead of part of the blast radius. The command matched the tool, but not the repo's existing style contract.
**Fix:** When formatting targeted files during verification, use the same style flags the repo already uses or the same invocation pattern that previous maintenance/test scripts used. Always check `git diff --stat` immediately after formatter runs to catch accidental blast-radius expansion.

**2026-04-25 amendment:** The same trap recurred on `docs/site/goat-flow-landing.html`: a targeted stale-copy edit plus broad `prettier --write` rewrote most of the hand-authored landing page. Keep formatter scopes to touched files that are already formatter-owned, and read `git diff --stat` before running expensive gates so formatting churn can be reverted before verification evidence is collected.

---
## Lesson: Workflow parser refactors need both fixture coverage and typecheck

**Status:** active | **Created:** 2026-04-03

**What happened:** While tightening CI-validation checks, the first pass on the workflow `run:` parser read the wrong regex capture group and then used a router heuristic that only matched commands containing the word `router`. The focused regression suite and `tsc` both failed before the broader test run finished.
**Root cause:** Changed parsing and heuristics together without first validating the extracted command shape. The new regression covered the shell pattern, but the implementation still assumed the old capture layout and overfit to existing workflow wording.
**Fix:** For parser refactors, verify in this order: (1) print/exercise the extracted intermediate values, (2) run the focused regression suite, (3) run `npx tsc --noEmit`, then (4) run the full test suite. Heuristics should match behavior patterns like `grep ... | while read ... [ ! -e ]`, not just keywords in step names.

---
## Lesson: Rubric honesty changes need both in-memory and disk-backed fixture sync

**Status:** historical | **Created:** 2026-04-03 | **Reason:** Rubric/scanner system removed per ADR-013; specific check IDs no longer exist

**What happened:** Tightened `2.2.2` so a registered stop hook only passes when it also runs real validation commands. The new focused regression passed immediately, but the disk-backed `failing-known` fixture still expected the old failure set and broke on the next verification step.
**Root cause:** Updated the rubric logic and the in-memory regression corpus first, but forgot that `test/fixtures/projects/failing-known/fixture.json` and `test/fixtures/project-fixtures.test.ts` also encode expected failing check IDs. Scanner honesty work touches more than one fixture layer.
**Fix:** Whenever a rubric check changes semantics, verify in this order: (1) focused in-memory regression, (2) disk-backed fixture corpus, (3) full suite. Search for the check ID in `test/fixtures/` before treating the change as complete.

---
## Lesson: New blocking checks can break passing fixtures even when the scanner is correct

**Status:** historical | **Created:** 2026-04-03 | **Reason:** Scanner/rubric system removed per ADR-013

**What happened:** Added a new deny-hook check for pipe-to-shell blocking. The focused scanner regression passed, but the next full-suite run dropped both disk-backed `passing-minimal` and `passing-full` from `100` to `99`.
**Root cause:** The new rubric requirement was correct, but the "passing" fixture baseline still used settings-based deny rules that blocked `rm -rf`, force push, and `chmod 777` without also blocking `curl | bash` / `wget | sh`. Positive fixtures are just as sensitive to new honesty checks as failing fixtures.
**Fix:** When adding a new required check, audit both failure fixtures and passing baselines. For rubric changes, verify in this order: (1) focused regression, (2) disk-backed passing fixtures, (3) disk-backed failing fixtures, (4) full suite. If a positive fixture drops, update the fixture input first, not the expected score.

---
## Lesson: Regressions caught too late - tests run at milestone granularity, not edit granularity

**Status:** active | **Created:** 2026-04-05

**What happened:** Claude Insights reported 68 buggy-code friction events across 112 sessions (61% of sessions had at least one). The `/goat-qa` skill generates test plans after implementation, and `stop-lint.sh` runs linting after every turn, but neither catches logic regressions mid-implementation. Tests only run when the user explicitly asks or when a milestone completes. Regressions introduced in turn 3 of a 10-turn implementation aren't caught until the end, when the debugging context is stale.

**Root cause:** The verification loop runs at the wrong granularity. Lint after every turn catches syntax. Tests after every milestone catch logic. The gap between these two is where regressions hide.

**Prevention:**
1. Consider an optional post-write hook that runs the project's test command after file changes (configured via `config.yaml`, off by default)
2. Skills with implementation phases should include a "run tests" checkpoint every N edits, not just at phase boundaries
3. For test-heavy projects (1000+ tests), a focused test subset (changed files only) avoids the full-suite penalty while still catching regressions early

---
## Lesson: `npm test -- <file>` can still run the full suite

**Status:** active | **Created:** 2026-04-18

**What happened:** A focused verification run used `npm test -- test/unit/quality-command.test.ts`, expecting only the quality prompt tests to run. In this repo, `package.json` defines `test` as `node --import tsx --test test/*/*.test.ts`, so npm appended the file argument without removing the existing glob. The command still executed the full suite and surfaced unrelated audit failures, obscuring whether the changed file actually passed its own regression.

**Root cause:** Assumed npm positional passthrough would replace the script's built-in test target. It only appends arguments, so any existing glob or file list in the script still runs unless the underlying command supports overriding it.

**Fix:** For focused test verification in this repo, invoke the underlying command directly: `node --import tsx --test test/unit/quality-command.test.ts`. Reserve `npm test` for deliberate full-suite runs.

---
## Lesson: Repo-wide preflight can be blocked by unrelated formatter drift

**Status:** active | **Created:** 2026-04-18

**What happened:** After deleting the dedicated setup validator and rewiring preflight around the remaining script surface, focused verification passed (`shellcheck`, `npm run typecheck`, targeted smoke/unit tests, and exact grep for the removed path). But `bash scripts/preflight-checks.sh` still failed because `scripts/prettier-check.sh` reported four unformatted files that were outside the change set: `src/cli/classify-state.ts`, `src/dashboard/app.ts`, `test/integration/preamble-sync.test.ts`, and `test/unit/quality-command.test.ts`.

**Root cause:** Preflight is repo-wide, not diff-scoped. A local task can leave its own files clean and still inherit unrelated formatter debt already present in the worktree or committed baseline. If that debt is not separated from task-local regressions, the final report becomes ambiguous about whether the task itself broke verification.

**Fix:** Format any touched files first, then rerun the focused checks. If preflight still fails, run the narrower verifier (`scripts/prettier-check.sh` or equivalent) to identify whether the remaining failures are in untouched files. Report that split explicitly instead of calling preflight a task regression.

**Recurrence update (2026-04-21):** A v1.2.2 version-bump run had `npm test` fail only because the installer round-trip fixture runs full preflight and found committed formatter drift in `src/dashboard/index.html`, a file outside the version-bump edit set. `npm run format:check` reproduced the same single-file failure.

**Prevention:**
1. When preflight fails, immediately identify whether the failing files are in `git status` for the current task.
2. Treat repo-wide formatter failures in untouched files as residual baseline debt, not silent task fallout.
3. Keep the final verification section split between "checks that passed for this change" and "repo-wide checks still blocked by unrelated drift."

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
## Lesson: Temp-repo preflight harnesses inherit formatting debt from copied test files

**Status:** active | **Created:** 2026-04-19

**What happened:** The new M14 round-trip integration test cloned the repo into a tmpdir, patched the temp copy, and ran `bash scripts/preflight-checks.sh`. Installer, parity, and drift logic were correct, but the first verification run still failed because the cloned `test/integration/audit-drift.test.ts` was not formatted, and preflight's formatter gate checks `test/**/*.ts`, not just the files patched inside the tmp repo after cloning.

**Root cause:** Treated the tmp repo like a narrow scratch fixture instead of a full repo clone. Formatting only the temp-mutated files under-approximated the real preflight surface, so the harness initially proved a weaker condition than the milestone claimed.

**Fix:** For tmp-repo preflight coverage, either keep the source test file formatted in the real checkout before cloning or explicitly format any copied `src/**/*.ts` and `test/**/*.ts` files that changed in the source repo. Assume preflight sees the entire cloned repo, not only the temp patch set.

**Prevention update (2026-04-20):**
1. Treat any unformatted tracked file in the real checkout as a blocker for `checkDrift` round-trip fixtures, because the temp repo inherits that formatting debt before its own assertions run.
2. After touching `src/**/*.ts` or `test/**/*.ts`, run the formatter before trusting installer/preflight round-trip tests as evidence about drift logic.

---
## Lesson: New server helper files still count as repo-wide formatting debt

**Status:** active | **Created:** 2026-04-20

**What happened:** Extracting setup-detection helpers out of `src/cli/server/dashboard.ts` passed `npm run typecheck` and the focused dashboard integration suite, but `bash scripts/preflight-checks.sh` still failed. The real checkout had three unformatted server files (`src/cli/server/dashboard.ts`, `src/cli/server/setup-detect.ts`, `src/cli/server/dashboard-assets.ts`), so preflight's Prettier gate failed locally and the installer round-trip fixture failed too because it clones the current checkout before running temp-repo preflight.

**Root cause:** Treated the structural refactor like a code-only change and stopped at type/runtime verification. In this repo, formatting debt in the source checkout is not isolated: the round-trip fixture inherits it and replays the same formatter failure inside the temp clone.

**Fix:** Run Prettier on every touched `src/**/*.ts` file before trusting preflight or fixture-backed drift tests. Re-run the focused failing test (`test/integration/audit-drift.test.ts`) after formatting, not just the original happy-path suite.

**Prevention:**
1. After adding a new TypeScript helper file, treat `prettier --check` as part of the focused verification, not only the final repo-wide gate.
2. When preflight and the installer round-trip fixture fail together on formatting, fix the real checkout first; the temp fixture will usually heal with it.

**Prevention update (2026-04-20):**
1. This pattern recurred on the next dashboard-server split when `src/cli/server/dashboard-routes.ts` and the rewritten `dashboard.ts` were left unformatted. Treat any new `src/cli/server/*.ts` extraction as high-risk for this exact preflight + round-trip failure pair.

---
## Lesson: Untracked source-shadow files can poison lint, formatter, and drift gates together

**Status:** active | **Created:** 2026-04-20

**What happened:** A tiny Prompts view color tweak looked unrelated to the TypeScript gates, but the first verification rerun still failed preflight and the installer round-trip fixture. The real blocker was an untracked JavaScript shadow file sitting next to the canonical `src/cli/types.ts`. ESLint tried to parse the stray `.js` file against the TypeScript project config, Prettier treated it as a source file under `src/**/*.{ts,js,html}`, and the fixture cloned the same bad state into its temp repo.

**Root cause:** A generated or accidental source-shadow file under `src/` can evade attention because typecheck and the visible diff for the requested change point elsewhere. The repo gates scan the filesystem, not just tracked TS files, so an untracked sibling output can contaminate lint/format/drift verification far away from the user-visible edit.

**Fix:** Check `git status` and `git ls-files` when lint/prettier/fixture failures do not match the touched file. If the blocker is an untracked source-shadow file like `src/**/*.js` beside a canonical `src/**/*.ts`, delete it and rerun the exact failing gates.

**Prevention:**
1. When preflight suddenly fails with mixed ESLint + Prettier + drift-fixture errors after a small change, scan for untracked source-shadow files under `src/` before changing the requested code again.
2. Treat `src/**/*.js` siblings of tracked `src/**/*.ts` files as suspicious unless the repo intentionally tracks them.

---
## Lesson: Shared hook refactors need both hook-local proof and repo-wide preflight

**Created:** 2026-04-21

**What happened:** A `deny-dangerous.sh` hardening pass looked correct after the first edit, but the canonical self-test immediately failed because `BASH_REMATCH` was reused after a recursive `check_segment` call inside the new command-substitution helper. After fixing that, the hook copies all passed their own `--self-test`, yet full `bash scripts/preflight-checks.sh` still failed because `scripts/deny-dangerous.sh` is linted under the stricter repo-wide `shellcheck scripts/*.sh` profile, which does not exclude `SC2016` the way the hook-directory check does. The installer round-trip fixture failed for the same reason because it clones the current checkout before running temp-repo preflight.

**Prevention:**
1. In Bash regex helpers, copy `BASH_REMATCH[n]` into local variables before any recursive call or nested regex operation that can overwrite it.
2. For shared hook templates, do not stop at `bash workflow/hooks/deny-dangerous.sh --self-test`; also rerun the repo-wide `shellcheck scripts/*.sh scripts/maintenance/*.sh` and full `bash scripts/preflight-checks.sh`, because `scripts/deny-dangerous.sh` and fixture clones exercise stricter paths than the hook directories.

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
## Lesson: Snapshot fixtures can carry metadata beyond the typed numeric contract

**Status:** active | **Created:** 2026-04-24

**What happened:** A backfill for missing v1.2.0–v1.2.4 manifest snapshots added a repo-integration test that `deepEqual`ed `loadSnapshotFacts()` output against numeric expectations. The first verification run failed because the historical `v1.1.0` snapshot already includes an extra `_note` key inside `snapshot_facts`, so the runtime payload was broader than the narrowed TypeScript interface used by the checker.

**Root cause:** I treated the snapshot loader as if it returned only the typed numeric fields, but the JSON contract in the repository also carries human-facing metadata that survives parsing.

**Fix:** Assert the numeric fields individually and allow extra metadata keys in historical snapshot fixtures.

**Prevention:**
1. When adding repo-integration tests for parsed JSON fixtures, inspect the real file shape before using `deepEqual` on a narrowed TypeScript view.
2. For historical compatibility tests, verify the required semantic fields and tolerate additive metadata unless the test is explicitly enforcing exact wire format.

---
## Lesson: Test suite must exercise the published invocation path

**Status:** active | **Created:** 2026-04-24

**What happened:** Commit 918ca3e wrapped the bare `main().catch(...)` call in an `import.meta.url` guard to prevent side effects on import. The guard used `resolve(process.argv[1]) === fileURLToPath(import.meta.url)`, which silently fails when the CLI is invoked through a symlink (the standard npm/npx path). All 359 tests passed because every test imports CLI functions directly or shells out via `node dist/cli/cli.js` - no test invoked the binary through a symlink, which is how every real consumer runs it.

**Root cause:** The test suite verified internal function behavior but never exercised the actual entry-point guard through the `.bin/` symlink path that `npx` uses. The refactor commit was titled "update goat-critique documentation," making it easy to overlook a CLI entry-point change during review.

**Prevention:**
1. `test/integration/main-guard.test.ts` now tests the CLI via a temp-dir symlink - the exact path that broke. This test would have caught the regression.
2. When modifying the entry-point guard or anything that controls whether `main()` runs, verify via symlink invocation, not just direct `node dist/cli/cli.js`.

---
## Lesson: Source-mode CLI proof does not refresh the package binary

**Status:** active | **Created:** 2026-04-27

**What happened:** A static detector patch made `node --import tsx src/cli/cli.ts audit . --harness --agent claude` pass, but the exact user-facing reproduction `npx goat-flow audit . --harness --agent claude` still failed because `npx` used the package `bin` path in `dist/cli/cli.js`. The built `dist/` copy still contained the old detector until `npm run build` refreshed it.

**Root cause:** I treated source-mode CLI verification as equivalent to the packaged invocation path. In this repo, `npx goat-flow` exercises `package.json` `bin`, so local source edits do not affect that command until the build output is regenerated.

**Prevention:**
1. When fixing a failure reported with `npx goat-flow ...`, rerun that exact command after `npm run build`, even if the `node --import tsx src/cli/cli.ts ...` source path already passes.
2. If source-mode and `npx` results disagree, check `dist/` freshness before changing the business logic again.

---
## Lesson: deny-dangerous self-test needs no-space redirect and false-positive probes

**Status:** active | **Created:** 2026-04-24

**What happened:** `bash .claude/hooks/deny-dangerous.sh --self-test` passed, but live repros still showed a bypass for `echo foo>.env`, `echo foo>>.env`, `echo foo>|.env`, and `echo foo>.env.example` because the hook only treated `>` as a redirect when followed by whitespace. The same pass also left unescaped `.env` / `.env.example` regexes in place, so benign names like `aenv`, `xenv.local`, and `aenv.example` were misclassified as secret or sample-env paths.

**Root cause:** I trusted the existing self-test matrix too early. It covered spaced redirects (`> .env`, `>| .env.example`) and canonical `.env` names, but not the no-space shell forms or near-miss filenames that reveal wildcard-dot false positives.

**Fix:** Escape the leading dots in the `.env` / `.env.example` regexes, detect redirect targets without requiring whitespace, and add self-test cases for `>.env`, `>>.env`, `>|.env.example`, `aenv`, `xenv.local`, and `aenv.example`.

**Prevention:**
1. For shell-hook path regexes, test both positive and negative examples: canonical secret names, no-space redirect forms, and near-miss filenames that differ by one character.
2. Do not treat `--self-test` as sufficient evidence for shell parsing changes until it includes the exact reproduction strings that originally demonstrated the bug.

---
## Lesson: New tests need formatter gate before verification claims

**Status:** active | **Created:** 2026-04-25

**What happened:** Added `test/unit/preset-prompts.test.ts` for the M01 security preset contract and the focused test passed, but `npx prettier --check src/dashboard/preset-prompts.json test/unit/preset-prompts.test.ts` failed on the new file.

**Root cause:** I treated the focused behavioral test as the first verification result for a new test file without running the repo formatter gate first.

**Prevention:** After adding or editing TypeScript tests, run `npx prettier --write <changed test files>` before claiming focused test verification. Keep the formatter check in the same verification bundle as the focused test so style failures are corrected before milestone boxes are ticked.

---
## Lesson: Shell metacharacters in verification searches can corrupt source files

**Status:** active | **Created:** 2026-04-26

**What happened:** During M05b verification, a malformed `rg` command accidentally left a literal `>` outside the quoted search pattern. The shell interpreted it as output redirection and truncated `src/dashboard/views/home.html` to an empty file. The mistake was caught by `wc -l`, `git diff`, and the dashboard HTML regression before final verification, then the Home template was restored.

**Root cause:** The search pattern contained HTML text (`pill-label">`) and the command was assembled too casually. A read-only verification command stopped being read-only because the shell parsed the stray `>` before `rg` ever ran.

**Prevention:** Quote every search pattern containing `<`, `>`, `|`, or quotes as a single shell argument, or pass it via a safer command form. After any complex shell search over generated/HTML-heavy files, run `git diff --stat` or `wc -l` on touched files before continuing verification.

---
---
## Lesson: Contract tests pin doctrine wording and path semantics

**Status:** active | **Created:** 2026-04-25

**What happened:** While removing one forbidden phrase and changing dashboard quality report ownership, the first full `npm test` run failed two contract-style checks: `test/contract/skill-hardening-contracts.test.ts` still required the established "hardening debt" evidence language, and `test/unit/preset-prompts.test.ts` still asserted the old relative quality-report path message.

**Root cause:** I treated wording cleanup and path-semantics changes as local edits, but these surfaces are intentionally pinned by tests because agents consume the exact phrasing.

**Prevention:** Before broad prose or prompt wording changes, search tests for the exact phrase and adjacent command text. If the product semantics are changing, update the contract test in the same edit; if the test protects unrelated established doctrine, keep that phrase intact.

---

## Lesson: Focused TypeScript tests in this repo need the `tsx` loader

**Status:** active | **Created:** 2026-04-29

**What happened:** The first focused verification run used `node --test test/smoke/dashboard-endpoints.test.ts` and failed with `ERR_MODULE_NOT_FOUND` while resolving the source module at `src/cli/server/terminal.ts`. The code change was not the problem; the test file imports source modules using `.js` specifiers that are resolved correctly when the repo's TypeScript loader is active.

**Root cause:** I ran the focused suite outside the repo's declared test invocation path. `package.json` (search: `"test:fast": "node --import tsx --test`) makes `tsx` part of the contract for source-mode tests, so plain `node --test` is a verification mistake here, not reliable failure evidence.

**Fix:** Re-run focused TypeScript tests with `node --import tsx --test <file>` before treating missing-module output as a real regression.

**Prevention:**
1. When a focused repo test imports `src/**/*.js` from the source tree, check `package.json` for the required loader before running it directly.
2. Treat a plain-Node `ERR_MODULE_NOT_FOUND` on source `.js` specifiers as a likely invocation-path problem until the `tsx`-loaded run fails too.

---
## Lesson: Split transient preflight test failures from task regressions

**Status:** active | **Created:** 2026-04-26

**What happened:** A quality-report fix removed the ESLint error that had been blocking `bash scripts/preflight-checks.sh`. Two subsequent preflight runs reached the fast test phase but failed on different tests: first `agent deny hook template comparison`, then `harness does not affect build-only result`. A direct `npm run test:fast` run immediately after those failures completed with `# pass 373` and `# fail 0`.

**Root cause:** I initially treated the preflight failure as a likely task regression because it appeared inside the final gate. The changing failed test names and the direct fast-suite pass showed the correct split: the task-local ESLint/preflight regression was fixed, while the preflight wrapper still surfaced intermittent fast-suite failures that need separate investigation.

**Prevention:** When preflight fails in the test phase after unrelated gate fixes, rerun the named failing test area and then the exact fast-suite command directly before changing task files again. The preflight wrapper now reruns `test:fast` once when the first test-phase attempt fails; a retry pass records a warning with the initial `not ok` lines instead of failing the whole gate. Report the split explicitly: which original gate was fixed, which direct test summary passed, and whether preflight isolated a transient first-run failure.

---
## Lesson: Slow installer round-trip catches prompt/test lint debt

**Status:** active | **Created:** 2026-04-26

**What happened:** After fixing quality-prompt and audit-provenance issues, `npm run test:slow` failed in `checkDrift: installer round-trip fixture` because the temp repo's preflight reported one ESLint error and one Prettier failure. The root causes were in the current working tree: `src/cli/prompt/compose-quality.ts` had an over-complex helper, and `test/unit/quality-command.test.ts` needed Prettier formatting. Direct `npx eslint src/cli src/dashboard` and `npm run format:check` reproduced both failures.

**Root cause:** I treated focused unit tests, typecheck, and fast-suite results as enough after changing a prompt helper and test fixture. The slow installer round-trip runs repo preflight inside a copied checkout, so it catches lint and format debt that focused tests do not.

**Prevention:** Before rerunning `npm run test:slow` after prompt/test changes, run `npx eslint src/cli src/dashboard` and `npm run format:check` locally. If the slow round-trip preflight fails, reproduce the reported gate directly in the source checkout before changing installer or drift logic.

---
## Lesson: Serve local HTML over localhost for browser-use evidence

**Status:** active | **Created:** 2026-04-27

**What happened:** During M12 browser-use verification, `browser-use open file:///home/devgoat/projects/goat-flow/docs/site/goat-flow-landing.html` succeeded at navigation but `browser-use state` returned `Empty DOM tree`. Serving the same directory with `python3 -m http.server 4182 --bind 127.0.0.1` and opening `http://127.0.0.1:4182/goat-flow-landing.html` returned the expected rendered page state and screenshot.

**Root cause:** A `file://` URL is not representative enough for local browser evidence in this agent environment. The browser navigation can succeed while DOM/state capture is empty, which makes a false negative look like a page problem.

**Prevention:** For local HTML/browser-use verification, serve the directory over localhost before opening the page. Treat `file://` empty DOM output as a verification-environment issue to rerun over HTTP before drawing conclusions. Evidence anchors: `workflow/skills/reference/browser-use.md` (search: `Local HTML shows an empty DOM`), `.goat-flow/skill-reference/browser-use.md` (search: `serve the directory over localhost`).

---
## Lesson: Hook regex edits need syntax probes before self-test fanout

**Status:** active | **Created:** 2026-04-27

**What happened:** While hardening `deny-dangerous.sh` against quoted and wrapper-prefixed `git push` bypasses, the first focused `bash scripts/deny-dangerous.sh --self-test` failed every safe case because a Bash `[[ =~ ]]` expression with an inline `)` regex caused a parse error before the command checks could run. Later manual probes caught more wrapper-option misses after the self-test was green: `command -p git push`, `env -- git push`, and `/usr/bin/time -f %E git push` still returned exit 0 until option-bearing wrapper forms were added. The same verification pass caught a repeated VM-test mistake: `assert.deepEqual` compared a VM-created array with a host-realm array and failed despite matching printed structure.

**Root cause:** I edited a shell regex directly inside `[[ ... =~ ... ]]` instead of moving the pattern to a variable, which is safer for regex metacharacters that the Bash parser can see. I also forgot the existing VM cross-realm lesson when adding a new classic-script helper test.

**Prevention:** After changing Bash hook regexes, run `bash -n <hook>` before interpreting self-test failures; if the regex contains `(`, `)`, `{`, or `}`, prefer a named regex variable. For command wrapper deny rules, probe both bare wrappers and option-bearing wrappers before mirror fanout (`command -p`, `env --`, `env -C`, `time -f`, quoted time formats). For VM-loaded dashboard helper tests, compare scalar fields/lengths or normalize arrays into the host realm. Evidence anchors: `scripts/deny-dangerous.sh` (search: `normalize_time_prefix`), `scripts/deny-dangerous.sh` (search: `env chdir git push`), `test/unit/dashboard-setup-quality.test.ts` (search: `qualityHistoryRows.length`).

---
## Lesson: Stats fixtures need real files for line-reference assertions

**Status:** active | **Created:** 2026-04-27

**What happened:** While adding ADR-024 enforcement to `stats --check`, the first integration test fixture used `package.json` with a line suffix to trigger an `invalid-line-ref` finding. The temp fixture repo did not contain `package.json`, so the checker correctly reported a stale ref instead and the test failed with "expected an invalid-line-ref finding."

**Root cause:** I reused a familiar root file path without checking the isolated fixture filesystem. The stats extractor validates refs against the temp repo, not the real goat-flow checkout.

**Prevention:** In temp-repo stats fixtures, cite a file the fixture creates when asserting line-reference behavior. For this path, `.goat-flow/footguns/hooks.md` is created by the fixture and can carry both the bucket body and a self-reference. Evidence anchor: `test/integration/stats-command.test.ts` (search: `missing semantic anchor`).

---
## Lesson: Shared npm build scripts must avoid shell builtins on Windows

**Status:** active | **Created:** 2026-04-29

**What happened:** `npm run dashboard` failed on Windows during `build:dashboard` with `The syntax of the command is incorrect.` even though Git's Unix tools were available on `PATH`. Reproducing the subcommand under `cmd.exe` showed `mkdir -p dist/dashboard` failing before the later copy steps ran.

**Root cause:** npm uses `cmd.exe` by default on Windows when `script-shell` is unset. Mixed shell chains are only partially portable in that setup: external GNU helpers such as `rm`, `cp`, and `chmod` may resolve from Git for Windows, but `cmd` still intercepts builtins like `mkdir` and applies Windows syntax rules.

**Prevention:** For shared npm scripts that create, remove, or copy files, prefer `node:fs` or an explicit cross-platform helper instead of raw `rm -rf`, `mkdir -p`, `cp`, or `chmod` in `package.json`. Evidence anchors: `package.json` (search: `require('node:fs').rmSync`), reproduction command `cmd /d /c "mkdir -p dist/dashboard"` -> `The syntax of the command is incorrect.`

---

## Lesson: Format touched TypeScript tests before repo-wide preflight

**Status:** active | **Created:** 2026-04-30

**What happened:** While implementing quality-assessment follow-ups, focused tests and `npm run typecheck` passed, but the first `bash scripts/preflight-checks.sh` run failed at Prettier with `2 unformatted files`. Running `npm run format` touched only the new/edited TypeScript test files, and the fresh preflight rerun passed.

**Root cause:** I treated focused tests plus typecheck as enough before the repo-wide gate even though new TypeScript test assertions had not been formatter-normalized. Preflight records formatter failure before later gates, so fixing format after a failed preflight requires a clean rerun to produce valid final evidence.

**Prevention:** After editing TypeScript tests or prompt/schema fixtures, run `npm run format` or `npm run format:check` before `bash scripts/preflight-checks.sh`. If preflight fails at Prettier, format, inspect the diff, and rerun preflight from scratch before claiming the final gate. Evidence anchors: `test/unit/check-content-quality.test.ts` (search: `discovers current ADR files`), `test/unit/quality-schema.test.ts` (search: `evidence_warning_count`).

---
## Lesson: Snapshot-table updates must verify the snapshot files, not infer from live state

**Status:** active | **Created:** 2026-05-02

**What happened:** While updating the preset catalog contract after intentionally removing built-in prompts, I added v1.3.1, v1.3.2, and v1.4.0 to the snapshot-claim test expectations. I inferred the v1.3.2 harness count from current live state and set it to 17, but the frozen `workflow/manifest-snapshots/v1.3.2.json` file records 16 harness checks. The focused snapshot test failed until I reread the snapshot file and corrected the expectation and README table.

**Root cause:** I mixed live manifest facts with frozen release-snapshot facts. Snapshot tests are supposed to preserve historical release state, so current repo counts are the wrong source unless the current release snapshot itself is being updated.

**Prevention:** Before editing `EXPECTED_RELEASE_SNAPSHOTS` or `workflow/manifest-snapshots/README.md`, read the matching versioned snapshot JSON files and copy their `snapshot_facts` values. Only update the current release snapshot after confirming the catalog/check change is intentionally part of that release. Evidence anchors: `test/unit/check-snapshot-claims.test.ts` (search: `EXPECTED_RELEASE_SNAPSHOTS`), `workflow/manifest-snapshots/v1.3.2.json` (search: `"checks_harness": 16`), `workflow/manifest-snapshots/v1.4.0.json` (search: `"presets_count": 26`).
