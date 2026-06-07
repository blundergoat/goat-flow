---
category: verification-preflight
last_reviewed: 2026-06-07
---

## Lesson: Formatter verification must preserve repo style flags

**Status:** active | **Created:** 2026-04-03

**What happened:** While tightening scanner messages, verification included a `prettier --write` pass on three rubric files without the repo's single-quote flag. The code was still valid, but the formatter rewrote quote style across entire files and created a much larger diff than intended.
**Root cause:** Treated formatting as a neutral cleanup step instead of part of the blast radius. The command matched the tool, but not the repo's existing style contract.
**Fix:** When formatting targeted files during verification, use the same style flags the repo already uses or the same invocation pattern that previous maintenance/test scripts used. Always check `git diff --stat` immediately after formatter runs to catch accidental blast-radius expansion.

**2026-04-25 amendment:** The same trap recurred on `docs/site/goat-flow-landing.html`: a targeted stale-copy edit plus broad `prettier --write` rewrote most of the hand-authored landing page. Keep formatter scopes to touched files that are already formatter-owned, and read `git diff --stat` before running expensive gates so formatting churn can be reverted before verification evidence is collected.

---

## Lesson: Repo-wide preflight can be blocked by unrelated formatter drift

**Status:** active | **Created:** 2026-04-18

**What happened:** After deleting the dedicated setup validator and rewiring preflight around the remaining script surface, focused verification passed (`shellcheck`, `npm run typecheck`, targeted smoke/unit tests, and exact grep for the removed path). But `bash scripts/preflight-checks.sh` still failed because `scripts/prettier-check.sh` reported four unformatted files that were outside the change set: `src/cli/classify-state.ts`, `src/dashboard/app.ts`, `test/integration/preamble-sync.test.ts`, and `test/unit/quality-command.test.ts`.

**Root cause:** Preflight is repo-wide, not diff-scoped. A local task can leave its own files clean and still inherit unrelated formatter debt already present in the worktree or committed baseline. If that debt is not separated from task-local regressions, the final report becomes ambiguous about whether the task itself broke verification.

**Fix:** Format any touched files first, then rerun the focused checks. If preflight still fails, run the narrower verifier (`scripts/prettier-check.sh` or equivalent) to identify whether the remaining failures are in untouched files. Report that split explicitly instead of calling preflight a task regression.

**Recurrence update (2026-04-21):** A v1.2.2 version-bump run had `npm test` fail only because the installer round-trip fixture runs full preflight and found committed formatter drift in `src/dashboard/index.html`, a file outside the version-bump edit set. `npm run format:check` reproduced the same single-file failure.

**Recurrence update (2026-05-10):** PR #35 review-feedback fixes passed focused dashboard/terminal tests and `npm run typecheck`, but targeted `npx prettier --check ...` still failed on touched file `test/smoke/dashboard-endpoints.test.ts` after adding a terminal timing regression. Running `npx prettier --write test/smoke/dashboard-endpoints.test.ts` fixed the local formatter blocker before rerunning the checks.

**Recurrence update (2026-05-19):** While fixing Workspace terminal waiting status, focused `test/unit/dashboard-terminal-launch.test.ts` passed but targeted `npx prettier --check src/dashboard/views/workspace.html src/dashboard/dashboard-terminal.ts test/unit/dashboard-terminal-launch.test.ts` failed on the touched test file after adding longer source-regex assertions. Running the same touched-file set through `npx prettier --write ...` fixed the local formatter blocker before rerunning the focused terminal test.

**Recurrence update (2026-05-19):** While adding audit concern limit fields and terminal boundary tests, a touched-file `npx prettier --check` over the edited CLI, dashboard, and unit-test files failed on the touched test files. Running the same touched-file set through `npx prettier --write ...` fixed the local formatter blocker before rerunning `npm run typecheck` and the targeted unit tests.

**Recurrence update (2026-05-20):** During the M37 Workspace terminal waiting/detach double-check, focused `test/unit/dashboard-terminal-launch.test.ts` and `npm run typecheck` were clean, but targeted `npx prettier --check src/dashboard/dashboard-terminal.ts src/dashboard/app.ts src/dashboard/views/workspace.html test/unit/dashboard-terminal-launch.test.ts .goat-flow/learning-loop/footguns/dashboard.md .goat-flow/plans/1.7.0/M37-workspace-terminal-waiting-and-detach.md` failed on `src/dashboard/dashboard-terminal.ts` and `test/unit/dashboard-terminal-launch.test.ts`. Running `npx prettier --write src/dashboard/dashboard-terminal.ts test/unit/dashboard-terminal-launch.test.ts` fixed the task-local formatter blocker before rerunning the focused unit test, typecheck, and Prettier check.

**Recurrence update (2026-06-07):** While syncing Codex secret-path permission templates, focused unit/integration tests, `shellcheck`, `bash -n`, and `npm run typecheck` were clean, but the first full `bash scripts/preflight-checks.sh` failed its TypeScript gate because Prettier found one touched source file unformatted. Running `npx prettier --write src/cli/facts/agent/settings.ts`, then rerunning `npm run format:check`, `npm run typecheck`, and preflight produced a clean final gate.

**Prevention:**
1. When preflight fails, immediately identify whether the failing files are in `git status` for the current task.
2. Treat repo-wide formatter failures in untouched files as residual baseline debt, not silent task fallout.
3. Keep the final verification section split between "checks that passed for this change" and "repo-wide checks still blocked by unrelated drift."

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

## Lesson: Preflight PASS output still needs exit-status proof

**Status:** active | **Created:** 2026-06-07

**What happened:** During the M04 directory restructure closeout, `bash scripts/preflight-checks.sh` rendered `PASS   49 checks · 0 warnings · 54.0s`, but the process returned exit code 1. An explicit capture reproduced the contradiction: the tail showed `PASS   49 checks · 0 warnings · 53.1s` followed by `exit=1`.

**Root cause:** Preflight had multiple successful no-op paths that returned 1 under `set -euo pipefail`. Renderer helpers returned false when no expansion, phase change, or active section existed; the code-map script-list parser also used `grep` inside command substitution without `|| true`, so a zero-match parse aborted before the comparison could report a normal failure. The EXIT trap preserved the non-zero status even though no check had failed.

**Fix:** End no-op-safe renderer helpers (`_record_section_elapsed`, `_emit_phase_if_changed`, `_emit_section_row`, and `section`) with `return 0`, make zero-match parser pipelines explicit with `|| true`, and keep the script closeout as an explicit `if [[ "$errors" -gt 0 ]]; then exit 1; fi; exit 0`. Evidence anchors: `scripts/preflight-checks.sh` (search: `_emit_section_row`) and `scripts/preflight-checks.sh` (search: `if [[ "$errors" -gt 0 ]]; then`).

**Prevention:** When a shell gate has an EXIT trap or report renderer, capture both its human-readable summary and `$?` before treating it as final evidence. A green report line is not sufficient if the process status disagrees.

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

## Lesson: New tests need formatter gate before verification claims

**Status:** active | **Created:** 2026-04-25

**What happened:** Added source coverage for the M01 security preset contract and the focused test passed, but `npx prettier --check src/dashboard/preset-prompts.json <changed test file>` failed on the new file.

**Root cause:** I treated the focused behavioral test as the first verification result for a new test file without running the repo formatter gate first.

**Recurrence update (2026-05-17):** M11 SARIF added `src/cli/audit/sarif.ts`, `test/unit/audit-sarif.test.ts`, and a small CLI route edit. The focused SARIF tests passed first, but the next scoped formatter check failed on all three touched TypeScript files. Running `npx prettier --write src/cli/audit/sarif.ts src/cli/cli.ts test/unit/audit-sarif.test.ts` fixed the task-local formatter blocker before typecheck/full tests. Evidence anchors: `src/cli/audit/sarif.ts` (search: `buildAuditSarifLog`), `test/unit/audit-sarif.test.ts` (search: `routes audit --format sarif through the CLI renderer`).

**Prevention:** After adding or editing TypeScript tests, run `npx prettier --write <changed test files>` before claiming focused test verification. Keep the formatter check in the same verification bundle as the focused test so style failures are corrected before milestone boxes are ticked.

---

## Lesson: Slow installer round-trip catches prompt/test lint debt

**Status:** active | **Created:** 2026-04-26

**What happened:** After fixing quality-prompt and audit-provenance issues, `npm run test:slow` failed in `checkDrift: installer round-trip fixture` because the temp repo's preflight reported one ESLint error and one Prettier failure. The root causes were in the current working tree: `src/cli/prompt/compose-quality.ts` had an over-complex helper, and `test/unit/quality-command.test.ts` needed Prettier formatting. Direct `npx eslint src/cli src/dashboard` and `npm run format:check` reproduced both failures.

**Root cause:** I treated focused unit tests, typecheck, and fast-suite results as enough after changing a prompt helper and test fixture. The slow installer round-trip runs repo preflight inside a copied checkout, so it catches lint and format debt that focused tests do not.

**Recurrence update (2026-05-24):** Adding registered deny-hook runtime smoke coverage passed focused audit tests and typecheck, but the first full `bash scripts/preflight-checks.sh` failed in the TypeScript gate because `src/cli/audit/check-agent-deny-mechanism.ts` (search: `checkHookRuntimeSmoke`) exceeded ESLint complexity by one branch. Splitting path selection and smoke execution into helpers (`search: runHookRuntimeSmoke`) cleared `npx eslint src/cli/audit/check-agent-setup.ts` and the rerun preflight TypeScript gate.

**Prevention:** Before rerunning `npm run test:slow` after prompt/test changes, run `npx eslint src/cli src/dashboard` and `npm run format:check` locally. If the slow round-trip preflight fails, reproduce the reported gate directly in the source checkout before changing installer or drift logic.

---

## Lesson: Final verification gates need supported scopes and captured logs

**Status:** active | **Created:** 2026-05-19

**What happened:** During the M30-M34 closeout, I ran an ad hoc ESLint command that included ignored test files and a `.mjs` helper outside the TypeScript ESLint project, producing a tooling failure unrelated to the code change. The same final-gate bundle ran `npm test` in parallel with other expensive checks; it reported one failing test but the returned output did not include the failing block. A clean rerun with output captured to a temp log passed (`# tests 881`, `# pass 881`, `# fail 0`).

**Root cause:** I mixed repo-supported verification scopes with improvised paths and treated parallel final gates as interchangeable with a clean final evidence run. That made the first failure ambiguous and forced a rerun to recover the actual evidence.

**Recurrence update (2026-05-19):** The same closeout also added a dashboard markdown performance sanity test whose 500KB fixture was newline-heavy. Focused runs passed, but preflight's concurrent fast-suite runner exceeded the 100ms budget. The fixture still needed to be 500KB, but it needed to measure plain markdown throughput rather than line-break parsing stress.

**Recurrence update (2026-05-26):** The same `test/unit/dashboard-markdown.test.ts` performance sanity test passed standalone and in `npm test`, but failed under preflight's `npm run test:coverage` because Node's coverage instrumentation and full-suite concurrency pushed the 500KB render over hard 100ms/250ms budgets (`expected <100ms, got 115ms` and later `159ms`; the full preflight still needed the retry path at 250ms). The test now uses one coverage-stable sanity budget because the coverage flag was not visible inside the `tsx` test process.

**Recurrence update (2026-05-19):** M01 commit-guidance work added a new helper and tests. Focused `npx tsc --noEmit` and the new test file passed, but the first full preflight failed in the TypeScript gate: `Knip: 2 unused exports/types`. The exported names were internal helper types, not public API. Removing the unnecessary `export` keywords fixed `npx knip`. Evidence anchor: `src/cli/prompt/commit-guidance.ts` (search: `type CommitGuidanceStatus`).

**Prevention:** Use the repo's supported scopes for final gates (`npx eslint src/cli src/dashboard`, `npm run format:check`, `npx knip --no-progress`). Run full `npm test` alone or capture it to a log before starting parallel expensive checks. When Knip reports configuration hints after a dependency starts being used for real, remove the temporary ignore entry instead of carrying it forward. For performance sanity tests that run in the default fast suite and preflight coverage suite, keep fixtures representative of the named budget and set a threshold that is stable under coverage instrumentation instead of tuning to a focused local run. Evidence anchors: `package.json` (search: `test:fast`), `test/unit/dashboard-markdown.test.ts` (search: `const budgetMs = 750`), `knip.json` (search: `ignoreDependencies`).

---

## Lesson: New dependency-audit gates need a baseline audit first

**Status:** active | **Created:** 2026-05-21

**What happened:** While adding `npm audit` to preflight and CI, the first fresh audit failed on the existing direct `ws@8.20.0` dependency. The gate wiring was correct, but merging it alone would have made both local preflight and CI fail immediately.

**Root cause:** I treated "add the gate" as separate from proving the current baseline satisfies the gate. Dependency-audit gates are different from pure syntax checks because their first run can reveal already-present supply-chain debt.

**Fix:** Patch the direct dependency to the current non-vulnerable release, sync `package-lock.json`, then rerun `npm audit` and full preflight before claiming the new gate works. Evidence anchors: `scripts/preflight-checks.sh` (search: `Dependency Audit`), `package.json` (search: `"ws": "^8.20.1"`).

**Prevention:** Before adding a repo-wide dependency-audit gate, run the raw audit command first. If it finds baseline vulnerabilities, either include the smallest compatible dependency update in the same change or stop and report the blocker before wiring a failing gate.

---

## Lesson: Format touched TypeScript tests before repo-wide preflight

**Status:** active | **Created:** 2026-04-30

**What happened:** While implementing quality-assessment follow-ups, focused tests and `npm run typecheck` passed, but the first `bash scripts/preflight-checks.sh` run failed at Prettier with `2 unformatted files`. Running `npm run format` touched only the new/edited TypeScript test files, and the fresh preflight rerun passed.

**Root cause:** I treated focused tests plus typecheck as enough before the repo-wide gate even though new TypeScript test assertions had not been formatter-normalized. Preflight records formatter failure before later gates, so fixing format after a failed preflight requires a clean rerun to produce valid final evidence.

**Prevention:** After editing TypeScript tests or prompt/schema fixtures, run `npm run format` or `npm run format:check` before `bash scripts/preflight-checks.sh`. If preflight fails at Prettier, format, inspect the diff, and rerun preflight from scratch before claiming the final gate. Evidence anchors: `test/unit/check-content-quality.test.ts` (search: `discovers current ADR files`), `src/cli/quality/schema-types.ts` (search: `evidence_warning_count`).

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

**What happened:** A guardrail-hook hardening pass looked correct after the first edit, but the canonical self-test immediately failed because `BASH_REMATCH` was reused after a recursive command-check helper. After fixing that, the hook copies all passed their own `--self-test`, yet full `bash scripts/preflight-checks.sh` still failed because the repo-wide shellcheck profile was stricter than the hook-local path. The installer round-trip fixture failed for the same reason because it clones the current checkout before running temp-repo preflight.

**Prevention:**
1. In Bash regex helpers, copy `BASH_REMATCH[n]` into local variables before any recursive call or nested regex operation that can overwrite it.
2. For shared hook templates, do not stop at `bash workflow/hooks/deny-dangerous.sh --self-test=full`; also rerun the repo-wide `shellcheck scripts/*.sh scripts/maintenance/*.sh scripts/installers/*.sh workflow/hooks/*.sh workflow/hooks/deny-dangerous/*.sh .goat-flow/hooks/*.sh .goat-flow/hooks/deny-dangerous/*.sh` and full `bash scripts/preflight-checks.sh`, because fixture clones exercise stricter paths than isolated hook runs.

---

## Lesson: Hook renames must include learning-loop and router-table drift

**Status:** active | **Created:** 2026-05-25

**What happened:** The M10 split from the old command-safety hook to three guardrail hooks passed focused hook self-tests and the fast test suite, but `bash scripts/preflight-checks.sh` still failed. The failures were not in hook execution: stale learning-loop evidence pointed at deleted files, `.goat-flow/code-map.md` listed hook scripts under `scripts/`, `.goat-flow/architecture.md` omitted the new `hooks` dashboard view from the exact view inventory, and `.github/copilot-instructions.md` still routed to the old Copilot hook path.

**Recurrence update (2026-05-26):** A follow-up double-check used `rg` with the milestone exclusions and returned no hits, but the exact M10 `git grep` acceptance command still found tracked stale references in `.gemini/settings.json`, `.github/git-commit-instructions.md`, and `.goat-flow/learning-loop/decisions/`. The issue was not hook behavior; the search tool choice under-counted tracked files hidden by ignore rules.

**Recurrence update (2026-05-27):** M12 hook hardening passed functional hook checks, but the stale-name closeout grep still found active references to the old gruff hook id in `.goat-flow/architecture.md`, `.goat-flow/code-map.md`, and `.goat-flow/learning-loop/lessons/dashboard-testing.md` after the hook had already been renamed to `gruff-code-quality`. The remaining exact old-id hits are now limited to the migration alias and its regression tests.

**Prevention:** After hook file renames, run the full preflight before declaring the rename done and treat drift failures as part of the hook change, not documentation cleanup. For the final old-name proof, use the milestone's exact `git grep` command over tracked files, then optionally run `rg --hidden --no-ignore` only to find local ignored residue. Evidence anchors: `scripts/preflight-checks.sh` (search: `Learning-loop schema`), `scripts/preflight-checks.sh` (search: `Dashboard view names drift`), `.github/copilot-instructions.md` (search: `deny-dangerous.sh --self-test=smoke`).

---

## Lesson: New harness checks need count locks and provenance date proof

**Status:** active | **Created:** 2026-05-16 | **Merged during:** M11 learning-loop consolidation

**What happened:** Adding the `evidence-before-claims` harness metric passed focused check tests, but the full suite still failed because a provenance-schema count lock expected the old registered-check total. The self-audit JSON also showed the new check using the old default `verified_on` date until its provenance was explicitly set.

**Root cause:** Visible count docs and type-distribution tests were updated, but deeper provenance-count locks and JSON evidence freshness were not checked.

**Prevention:** After adding or removing any audit check, grep for `registered build and harness checks`, `HARNESS_CHECKS.length`, the old total count, and the new check id across `test/` and `docs/`. Then run a JSON audit parse that prints the new check's `id`, `type`, `impact`, and `provenance.verified_on`.

## Lesson: Learning-loop content gates need tracked, durable paths

**Status:** active | **Created:** 2026-05-27 | **Merged during:** M11 learning-loop consolidation

**What happened:** Multiple verification failures came from citing paths that were not durable repo truth: gitignored task files in ADRs, ignored `.goat-flow` paths hidden by normal `rg`, unresolved optional skill-path examples, and fake external PR paths formatted as repo-local code spans.

**Recurrence update (2026-05-27):** During the M11 learning-loop consolidation, `stats --check` passed after lesson files were merged and renamed, but the targeted audit unit suite failed with `Invalid audit check provenance` because `src/cli/audit/harness/check-context.ts` still cited the deleted `auditor-and-rubric.md` lesson, and `src/cli/audit/harness/check-verification.ts` still cited the deleted `verification-review.md` and `agent-behavior-trust.md` lessons. The markdown cross-reference grep was clean; the stale paths lived in code-owned provenance metadata.

**Root cause:** Filesystem/path checks prove that a local path currently resolves, not that the reference is committed, portable, or appropriate for a durable lesson/ADR. Ignored local workspaces and external examples require different citation forms from repo-local files.

**Prevention:** Before closing add/rename/delete or learning-loop edits, run both a tracked-state check (`git status --short` / `git ls-files --error-unmatch <path>`) and the relevant old-pattern grep. Include source-owned provenance and detector metadata in the grep, not only markdown artifacts. Use `rg -uu` when ignored `.goat-flow` workspace state is the target. In durable artifacts, cite committed repo files, public URLs, or prose descriptions for external paths; do not backtick fake repo-local examples. When documenting deleted paths in a durable artifact, name the old filename or quote the failing command output in the milestone, but do not write the deleted path as if it still resolves. Evidence anchors: `src/cli/audit/harness/check-context.ts` (search: `boundary-guidance-present`) and `src/cli/audit/harness/check-verification.ts` (search: `evidence-before-claims`).

---

## Lesson: Pipe input cannot share stdin with heredoc scripts

**Status:** active | **Created:** 2026-05-24

**What happened:** While adding npm override review logic to `scripts/dependency-update.sh`, the first verification run failed ShellCheck with `SC2259` because the code piped `npm view ... --json` into `node --input-type=module - ... <<'NODE'`. The heredoc supplied Node's stdin for the script body, so the piped registry JSON would not have reached `process.stdin`.

**Root cause:** I treated heredoc script input and piped data input as independent streams. For `node -`, they compete for stdin; the heredoc wins and discards the pipe.

**Fix:** Store the command output in a variable and feed it with a here-string to a `node --eval` script, or pass data through a file descriptor explicitly. Evidence anchor: `scripts/dependency-update.sh` (search: `latest_dependencies="$(npm view`).

**Prevention:** After adding shell code that combines pipes, heredocs, or process substitutions, run `shellcheck` before smoke testing the behavior. Treat `SC2259` as a correctness failure, not style noise.

---

## Lesson: Preflight TypeScript gates include Knip binary policy and touched-test formatting

**Status:** active | **Created:** 2026-06-07

**What happened:** During the M07-M10 closeout, focused hook checks, typecheck, focused tests, `npm test`, and `npm publish --dry-run` were clean, but the first full `bash scripts/preflight-checks.sh` still failed in the TypeScript section with `Knip: 4 unused exports/types` and `Prettier (1 unformatted files)`. Direct reproduction showed `npx knip` reporting unlisted command binaries (`where`, `which`, `diff`) and `npm run format:check` reporting `test/unit/hook-registrar.test.ts`.

**Root cause:** I treated the focused behavioral and type gates as enough before preflight after touching CLI spawn logic and tests. Knip's binary-policy check is separate from typecheck and can be exposed by local tool/lockfile movement, while Prettier still checks all touched TypeScript tests even when they pass at runtime.

**Fix:** Add intentional platform/probe commands to `knip.json` `ignoreBinaries`, format the touched hook-registrar test, rerun `npx knip` and `npm run format:check`, then rerun full preflight from scratch. Evidence anchors: `knip.json` (search: `ignoreBinaries`), `src/cli/install-invocation.ts` (search: `buildInstallerSpawnSpec`), `test/unit/hook-registrar.test.ts` (search: `generated Claude launchers`).

**Prevention:** Before full preflight after changing CLI command spawning, hook launchers, or TypeScript tests, run the direct sub-gates that preflight will aggregate: `npx knip` and `npm run format:check`. If preflight reports the TypeScript section as failed, reproduce the subtool reports directly and fix those exact findings before collecting final pass evidence.

---

## Lesson: Verification grep patterns must not carry Markdown backticks into Bash

**Status:** active | **Created:** 2026-06-07

**What happened:** During the M04 review-cleanup verification, a stale-path `rg` sweep embedded a Markdown-formatted fragment inside a double-quoted shell pattern. Bash treated the backticks around `decisions/` as command substitution, printed `/bin/bash: line 1: decisions/: No such file or directory`, and then ran `rg` with a mangled pattern that produced noisy, unusable output.

**Root cause:** I copied prose-review formatting into an executable shell regex instead of making the verification command a plain shell argument.

**Fix:** Discard the malformed output and rerun the sweep with a single-quoted regex that contains no Markdown quoting.

**Prevention:** Before trusting a verification grep, check the command output for shell diagnostics as well as `rg` matches. When searching for literal Markdown text, use single quotes plus `-e` patterns or `rg -F` fixed-string searches instead of embedding backticks in a double-quoted regex.

---
