---
category: verification-preflight
last_reviewed: 2026-08-12
---

## Lesson: Formatter verification must preserve repo style flags

**Status:** active | **Created:** 2026-04-03

**What happened:** Formatter verification twice rewrote more than intended: rubric files lost the repo's quote style, then a narrow landing-page edit reformatted most of the hand-authored HTML. On 2026-07-19, a scoped check also included `.gitignore`; Prettier correctly failed because that file has no inferred parser.

**Root cause:** Formatting was treated as neutral cleanup instead of a file-type and blast-radius contract.

**Prevention:** Use the repository scripts and their owned extensions (`package.json`, search: `"format:check"`). Scope direct Prettier calls only to formatter-owned files; verify files such as `.gitignore` with byte parity or `git diff --check`. Inspect `git diff --stat` after any formatter write.

---

## Lesson: Repo-wide preflight can be blocked by unrelated formatter drift

**Status:** active | **Created:** 2026-04-18

**What happened:** After deleting the dedicated setup validator and rewiring preflight around the remaining script surface, focused verification passed (`shellcheck`, `npm run typecheck`, targeted smoke/unit tests, and exact grep for the removed path). But `bash scripts/preflight-checks.sh` still failed because `scripts/prettier-check.sh` reported four unformatted files that were outside the change set: `src/cli/classify-state.ts`, `src/dashboard/app.ts`, `test/integration/preamble-sync.test.ts`, and `test/unit/quality-command.test.ts`.

**Root cause:** Preflight is repo-wide, not diff-scoped. A local task can leave its own files clean and still inherit unrelated formatter debt already present in the worktree or committed baseline. If that debt is not separated from task-local regressions, the final report becomes ambiguous about whether the task itself broke verification.

**Fix:** Format any touched files first, then rerun the focused checks. If preflight still fails, run the narrower verifier (`scripts/prettier-check.sh` or equivalent) to identify whether the remaining failures are in untouched files. Report that split explicitly instead of calling preflight a task regression.

**Recurrence update (2026-04-21):** A v1.2.2 version-bump run had `npm test` fail only because the installer round-trip fixture runs full preflight and found committed formatter drift in `src/dashboard/index.html`, a file *outside* the edit set. `npm run format:check` reproduced the same single-file failure. This is the distinct case: untouched committed debt, not task fallout.

**Recurrence updates (2026-05-10, 2026-05-19 x2, 2026-05-20, 2026-06-07) - incident count 5, identical mechanism:** focused tests, `shellcheck`, and `npm run typecheck` all passed, then a targeted `npx prettier --check` (or preflight's TypeScript gate) failed on a file the task had *touched*. Every instance resolved the same way: `npx prettier --write` over the touched set, then rerun. Affected files spanned dashboard sources, smoke and unit tests, and `src/cli/facts/agent/settings.ts`. The repeat rate is the finding - formatting a touched file is not optional cleanup, it is a gate.

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

**Recurrence update (2026-07-12):** The new preflight runner passed focused checks, but `Doc/code drift` failed until `.goat-flow/code-map.md` listed it. Keep the top-level script inventory current. Evidence: `scripts/preflight-checks.sh` (search: `code-map.md scripts list drifts from scripts/ filesystem`).

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

**What happened:** M01's focused security-preset test passed before scoped Prettier rejected the new test file.

**Root cause:** I ran behavioural proof before the formatter gate for touched TypeScript.

**Recurrences through 2026-08-12:** M11 SARIF and later contract, setup, dashboard, review, and hook batches repeated the same ordering error. M01 again passed focused tests and typecheck before scoped Prettier rejected its touched TypeScript.

Evidence anchors:

- `src/cli/audit/sarif.ts` (search: `buildAuditSarifLog`); `src/cli/prompt/compose-setup.ts` (search: `contentAuditCommand`).
- `test/contract/skill-hardening-shared-3.test.ts` (search: `requires an evidence budget before optional orchestration`).
- `test/unit/dashboard-skill-quality.test.ts` (search: `shows composition truncation as a partial-evidence warning`).
- `test/integration/skill-author.test.ts` (search: `rejects a symlinked playbook scaffold parent`).
- `test/unit/review-validate-verdict.test.ts` (search: `structuralValidationCases`).
- `test/contract/skill-hardening-review-1.test.ts` (search: `stops oversized inferred branch scopes before review begins`).
- `test/unit/quality-report-contract.test.ts` (search: `cross-variant boundaries`).
- `test/unit/dashboard-terminal-launch/launch-flow-01.test.ts` (search: `denied-probe fallback`).
- `test/integration/post-turn-safety-hook.helpers.ts` (search: `withCommandShim`).
- `src/cli/audit/check-agent-deny-runtime.ts` (search: `configuredRuntimeProbes`).
- `test/contract/skill-hardening-skills-2.test.ts` (search: `truthful goat-critique`).
- `test/unit/hook-launcher.test.ts` (search: `returns promptly after a started hook descendant exceeds its deadline`).
- `src/cli/server/agent-hook-writer.ts` (search: `deriveManagedHookDesiredState`).
- `test/unit/hook-registrar.test.ts` (search: `repairs a duplicate registration`).

**Prevention:** Format touched TypeScript before focused proof; retain Prettier in final verification.

**Decision changed:** Run the repository formatter on touched TypeScript before treating a focused GREEN run as milestone verification. | **Trigger phase:** VERIFY | **Incident count:** 16 | **Latest occurrence:** 2026-08-12

---

## Lesson: Slow installer round-trip catches prompt/test lint debt

**Status:** active | **Created:** 2026-04-26

**What happened:** Prompt changes cleared focused tests and typecheck but failed the installer round-trip embedded preflight three times: on 2026-04-26 an over-complex compose-quality.ts helper and unformatted quality-command fixture; on 2026-05-24 checkHookRuntimeSmoke exceeded ESLint complexity by one; on 2026-07-16 PR #56 renderAuditSummary reached complexity 17. Extracting narrow helpers and formatting the fixture cleared the direct gates. The first 2026-07-16 recurrence note also pushed this bucket to 40,353 bytes, so the incident history was consolidated below the cap.

**Root cause:** Focused behavior tests and typecheck do not run the full-source lint and format gates that the copied checkout enforces.

**Prevention:** Before slow installer tests, run the supported source ESLint and format gates. Reproduce a failure directly before changing installer or drift logic. Evidence anchors: `src/cli/prompt/compose-quality-common.ts` (search: `appendScopeSummary`), `src/cli/audit/check-agent-deny-runtime.ts` (search: `verifyConfiguredHookRuntime`), and `test/unit/quality-report-contract.test.ts` (search: `embeds drift and content failures`).

---

## Lesson: Final verification gates need supported scopes and captured logs

**Status:** active | **Created:** 2026-05-19 | **Incident count:** 4 | **Latest occurrence:** 2026-08-12

**What happened:** Several closeouts sent ignored tests or workflow `.mjs` files to TypeScript-only ESLint. One also ran `npm test` beside expensive checks and lost the failing block; a captured rerun passed (`# tests 881`, `# pass 881`, `# fail 0`).

**Root cause:** I mixed repo-supported verification scopes with improvised paths and treated parallel final gates as interchangeable with a clean final evidence run. That made the first failure ambiguous and forced a rerun to recover the actual evidence.

**Recurrence update (2026-08-09):** A runtime-adapter check again sent workflow `.mjs` to TypeScript-only ESLint. Workflow modules instead use `node --check`, Prettier, targeted Gruff, runtime fixtures, and preflight. Evidence anchors: `workflow/hooks/hook-provider-adapters.mjs` (search: `Decodes bounded provider-neutral hook results`) and `scripts/preflight-checks.sh` (search: `lint_targets[@]`).

**Recurrence update (2026-05-19):** The same closeout also added a dashboard markdown performance sanity test whose 500KB fixture was newline-heavy. Focused runs passed, but preflight's concurrent fast-suite runner exceeded the 100ms budget. The fixture still needed to be 500KB, but it needed to measure plain markdown throughput rather than line-break parsing stress.

**Recurrence update (2026-05-26, 2026-06-14):** The same dashboard markdown performance sanity test (test/unit/dashboard-markdown.test.ts, since removed in 1.13.0 with the markdown viewer) passed standalone and in `npm test`, but failed under preflight's `npm run test:coverage` because Node's coverage instrumentation and full-suite concurrency pushed the 500KB render over hard 100ms/250ms budgets (`expected <100ms, got 115ms` and later `159ms`; the full preflight still needed the retry path at 250ms). A later fixed `750ms` ceiling was still machine-sensitive, so the test now compares the 500KB render against a same-process 100KB baseline with a generous floor.

**Recurrence updates (2026-05-19, 2026-08-08):** Commit-guidance helpers passed focused tests but failed full preflight with `Knip: 2 unused exports/types`; making internal types private fixed it. Later, removing the history detector removed the cited `CommitGuidanceStatus`, so the audit suite failed on a stale learning-loop anchor. Keeping that type as the template-copy result status fixed the reference. Run `goat-flow stats --check` before deleting cited symbols. Evidence anchor: `src/cli/prompt/commit-guidance.ts` (search: `type CommitGuidanceStatus`).

**Recurrence update (2026-07-03):** 1.13.0 milestones each passed their per-file scoped gates, yet the closing `npm run publish:check` failed three ways only a full-tree run surfaces: (1) an integration assertion still matched a CDN string after an asset was vendored locally (`test/integration/dashboard-server.test.ts`, `alpinejs@3` → `/assets/alpine.js`); (2) `appendQualityReportContract` shipped at complexity 21 because scoped eslint had only run the file's own diff, never the whole `src/cli` tree - as in the M01 recurrence above, route branchy `full ? a : b` / `if (full)` lines through small `pushVariant`/`pushFull` helpers so each decision sits in the helper's scope; (3) deleting the `coming-soon` dashboard view left its name in three prose lists (`.goat-flow/code-map.md`, `docs/dashboard.md`, `.goat-flow/architecture.md`) and orphaned 7 backticked learning-loop refs, tripping the round-trip fixture's embedded preflight. Prevention: when a milestone deletes files, moves symbols between modules, or swaps a served asset, run `npm run publish:check` as the FINAL gate - the fast suite and scoped eslint do not exercise full-tree complexity, cold-path doc drift, or learning-loop ref integrity.

**Recurrences (2026-07-12, 2026-08-09):** Two hook-contract batches aimed ESLint at ignored tests; `--no-ignore` then failed outside the parser project. One also omitted Gruff's `analyse` subcommand. Supported Node tests, typecheck, Prettier, and `gruff-ts analyse <file>` produced valid evidence. Anchors: `test/contract/command-phrases.test.ts` (search: `agent mutation and external-write authority`); `test/unit/playbook-contract.test.ts` (search: `assertRegistrationCommandForEachPlaybook`).

**Recurrence update (2026-07-12):** A later testing gate listed ignored unit and integration files in `npx eslint --max-warnings 0`. The corrected gate linted only the changed `src/cli/audit/` files; TypeScript, Prettier, and focused Node tests cover ignored tests. Evidence anchor: `eslint.config.mjs` (search: `"test/**"`).

**Recurrence update (2026-07-13):** A context-report gate hit Prettier on three files, ESLint on out-of-project tests, and Knip on four internal exports. Formatting, scoped source lint/tests, and private types cleared it. Evidence: `test/unit/context-report.test.ts` (search: `static context report`).

**Recurrence update (2026-07-31):** Two audit batches caught ESLint complexity, a Node directory target, a probe without `PATH`, and stale terminal-env smoke expectations. Fixes extracted a helper, targeted `*.test.ts` (91/91), reused `process.env`, and aligned the smoke contract (20/20). Evidence: `src/cli/audit/check-factual-claims.ts` and `test/smoke/dashboard-endpoints.test.ts` (search: `GOAT_CLAUDE_REPORTING_SETTINGS`).

**Recurrence update (2026-08-07):** An EXIT-trap cleanup made the executor reject M05's `test:fast` wrapper before npm ran. Retaining the printed `mktemp` log produced `1580` pass / `0` fail. Gate wrappers no longer bundle destructive cleanup.

**Prevention:** Run supported format, lint, Knip, and test gates with captured output. A predecessor may exempt one named RED fixture only when a blocked dependent owns it: preserve the full failure receipt, run every other test, and keep the green gate downstream. Any extra failure stops. Evidence anchors: `test/integration/setup-install-agent-matrix.test.ts` (search: `must have one exact registration`), `package.json` (search: `test:fast`), and `knip.json` (search: `ignoreDependencies`).

---

## Lesson: New dependency-audit gates need a baseline audit first

**Status:** active | **Created:** 2026-05-21

**What happened:** While adding `npm audit` to preflight and CI, the first fresh audit failed on the existing direct `ws@8.20.0` dependency. The gate wiring was correct, but merging it alone would have made both local preflight and CI fail immediately.

**Root cause:** I treated "add the gate" as separate from proving the current baseline satisfies the gate. Dependency-audit gates are different from pure syntax checks because their first run can reveal already-present supply-chain debt.

**Fix:** Patch the direct dependency to the current non-vulnerable release, sync `package-lock.json`, then rerun `npm audit` and full preflight before claiming the new gate works. Evidence anchors: `scripts/preflight-checks.sh` (search: `Dependency Audit`), `package.json` (search: `"ws": "^8.20.1"`).

**Prevention:** Before adding a repo-wide dependency-audit gate, run the raw audit command first. If it finds baseline vulnerabilities, either include the smallest compatible dependency update in the same change or stop and report the blocker before wiring a failing gate.

---

## Lesson: Dependency-audit gates can mutate lockfile metadata

**Status:** active | **Created:** 2026-06-14

**What happened:** During M08 self-review, `package-lock.json` appeared in `git status` only after the final `npm test` / `bash scripts/preflight-checks.sh` verification pass. A forced text diff showed registry metadata churn for transitive dev dependencies such as `@types/node`, `acorn`, `caniuse-lite`, and `eslint`, even though dependency updates were out of scope. The lockfile was reverted before closeout.

**Root cause:** I treated dependency audit/preflight as read-only for the working tree. In this environment, npm tooling can refresh `package-lock.json` metadata while producing otherwise passing audit/preflight output.

**Prevention:** After `npm audit`, `npm test`, or full preflight, run `git status --short --untracked-files=all` before final scope claims. If `package-lock.json` changed and dependency updates are out of scope, inspect with `git diff --text -- package-lock.json` and revert only audit-generated metadata drift before rerunning any required checks. Evidence anchors: `scripts/preflight-checks.sh` (search: `audit_output=$(npm audit 2>&1)`) and `package-lock.json` (search: `node_modules/@types/node`).

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

**Recurrence update (2026-06-08):** Adding the `hook-version` setup check (setup 15 -> 16, total 36 -> 37) repeated this, and showed the ripple reaches further than `test/` and `docs/`. `npm test` passed 621/621 - it caught only the one hardcoded total in `test/unit/provenance-types.test.ts` (`all 36 registered ... checks` -> 37). But `bash scripts/preflight-checks.sh` then failed on six more stale count references the suite never checks: `.goat-flow/architecture.md` build/sub-breakdown counts, `CLAUDE.md` / `AGENTS.md` / `CONTRIBUTING.md` (`15 setup` -> `16 setup`), and two learning-loop `(search: ...)` anchors (`footguns/quality.md` -> `16 setup-scope checks`, `lessons/review-feedback.md` -> `20 build checks`). Fixing `architecture.md`'s `19 build checks` -> `20 build checks` then cascaded - it broke the `review-feedback.md` anchor that searched for the old string, which only surfaced on the *second* preflight run. The manifest needed no edit: `facts.checks.setup` is computed from `SETUP_CHECKS.length`. **Prevention extension:** after any check-count change, run full preflight - its `Doc/code drift` arch-count check and `Learning-loop schema` stale-ref check are the only gates that catch the doc + anchor cascade, and fixing one count string can break a learning-loop anchor pointing at it, so re-run until clean - and grep count strings (`15 setup`, `19 build`, `36 checks`) across `docs/`, the instruction files, and `.goat-flow/learning-loop/` anchors, not just `test/` and `docs/`. **Further straggler (2026-06-08, review):** the same `setup 15 -> 16` bump also left `.goat-flow/glossary.md` (`setup-scope (15 checks)`) stale, and neither `npm test` nor `preflight` flags it - the glossary's prose count sits outside both the arch-count and learning-loop-anchor gates, so it shipped to the branch and surfaced only in manual review. Widen the count-string grep to `.goat-flow/` orientation docs (`glossary.md`, `code-map.md`), not only `docs/`, the instruction files, and learning-loop anchors. Evidence anchors: `scripts/preflight-checks.sh` (search: `Learning-loop schema`), `.goat-flow/learning-loop/lessons/review-feedback.md` (search: `20 build checks`).

## Lesson: Learning-loop content gates need tracked, durable paths

**Status:** active | **Created:** 2026-05-27 | **Merged during:** M11 learning-loop consolidation

**What happened:** Multiple verification failures came from citing paths that were not durable repo truth: gitignored task files in ADRs, ignored `.goat-flow` paths hidden by normal `rg`, unresolved optional skill-path examples, and fake external PR paths formatted as repo-local code spans.

**2026-05-27:** Lesson renames left deleted paths in code-owned audit provenance even though Markdown greps passed. Evidence: `src/cli/audit/harness/check-context.ts` (search: `boundary-guidance-present`).

**Recurrences (2026-06-10, 2026-07-19):** `stats --check` caught `bucket-size` after Step 0 and M07 recurrence edits crossed `BUCKET_SIZE_WARN_BYTES`; the first run also caught a bare-path `stale-ref`. Both fixes compacted redundant wording, preserved anchors, regenerated indexes, and reran stats. Evidence anchors: `.goat-flow/learning-loop/lessons/agent-behavior.md` (search: `Step 0 retrieval was advisory`) and `src/cli/stats/stats.ts` (search: `BUCKET_SIZE_WARN_BYTES`).

**Recurrence update (2026-08-04):** A broad Markdown evidence scan initially admitted a gitignored nested plan README; adversarial review also exposed a permissive log-README rule and omitted tool-cache roots. The gate now admits only enumerated committed local-state READMEs and excludes ignored agent/tool roots. Evidence: `src/cli/audit/check-content-quality.ts` (search: `COMMITTED_LOCAL_STATE_READMES`).

**2026-08-09:** Two same-day learning edits crossed this bucket cap, and the first index refresh also swept unrelated generated rows into a rollback patch. Later, `stats --check` rejected durable drafts that cited ignored planning files. Describe the failure mechanism without local milestone labels; compact before indexing; diff generated files; cite tracked sources. Evidence anchors: `src/cli/learning-loop-index/generate.ts` (search: `generateIndexes`) and `src/cli/facts/shared/learning-loop-common.ts` (search: `Local-state paths (plans/scratchpad/logs)`).

**2026-08-10:** Launcher and evidence refactors left two durable search anchors pointing at removed symbols, so repository schema and content gates failed after focused code checks cleared. Pair semantic renames with an exact old-name search across durable evidence before preflight. Evidence anchors: `src/cli/server/agent-hook-command.ts` (search: `legacyHookLaunchMode`), `src/cli/hooks-runtime-evidence.ts` (search: `verifyManagedDenyHook`), and `scripts/preflight-checks.sh` (search: `Learning-loop schema`).

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

**Decision changed:** Run typecheck, ESLint, Knip, and formatting before preflight after TypeScript surface changes. | **Trigger phase:** VERIFY | **Incident count:** 13 | **Latest occurrence:** 2026-08-10

**What happened:** Narrower checks repeatedly cleared before later static gates. On 2026-08-10, typecheck rejected dynamic membership against a literal-tuple union and ESLint found proof-reader and registrar complexity 13/11. Earlier recurrences included formatting drift, an undiscovered worker, and impossible fallback logic.

**Root cause:** Typecheck and runtime tests do not exercise lint complexity, unused-code/binary policy, static fixture reachability, or formatting. A child process launched from a string path can be reachable at runtime but invisible to Knip's dependency graph. Running a memory-heavy analyzer beside other gates can also turn a resource limit into a misleading tool failure.

**Fix and prevention:** After TypeScript changes, run ESLint, Knip, and `npm run format:check` before preflight and fix their exact findings. Keep child-process fixtures statically discoverable with `fileURLToPath(new URL("../fixtures/worker.ts", import.meta.url))`. Run Knip independently; if only it reaches the default heap and host headroom was measured, rerun `node --max-old-space-size=8192 node_modules/knip/bin/knip.js` before classifying the crash. Evidence anchors: `knip.json` (search: `ignoreBinaries`), `test/helpers/concurrent-quality-workers.ts` (search: `quality-capture-concurrency-worker.ts`), `src/cli/install-invocation.ts` (search: `buildInstallerSpawnSpec`), and `src/cli/rendered-markdown.ts` (search: `function maskMarkdownSourceLine`).

**Measured recurrences:** Static gates have found complexity, impossible conditions, internal-only exports, an undiscovered worker, and a measured Knip heap limit. The latest fix widened dynamic scenario ids through `Set<string>` and separated event matching from gate promotion. Evidence anchors: `src/cli/server/hook-runtime-proof.ts` (search: `requiredScenarioIds`) and (search: `hookSupportGateAfterLocalProof`).

**Release recurrence (2026-08-09):** Hook notes gained a dated release heading before its manifest snapshot existed, so the full suite failed. Keep notes under `Unreleased` until release identity and its snapshot propagate together. Evidence: `CHANGELOG.md` (search: `## Unreleased`) and `test/unit/manifest.test.ts` (search: `missing manifest snapshots`).

---

## Lesson: Verification grep patterns must not carry Markdown backticks into Bash

**Status:** active | **Created:** 2026-06-07
**Decision changed:** Validate persisted anchors with the literal search shape a future agent will run.
**Incident count:** 6 | **Latest occurrence:** 2026-08-11

**What happened:** Shell commands copied Markdown-formatted anchors into executable arguments. Bash treated backticks as command substitution, mangled searches, and once ran embedded CLI names. Later PreToolUse checks blocked the same shape before execution, including a redaction draft sent through a generated shell command.

**2026-08-11 recurrence:** Three plan Context references used remembered paths or symbols. A literal resolver caught them before handoff. Resolve every persisted path/anchor and mark future paths task-owned. Evidence: `src/cli/hooks-configured-runtime-evidence.ts` (search: `type HookRuntimeVerdict`).

**Root cause:** Persisted search anchors were treated as prose or memory instead of executable future-agent contracts.

**Fix:** Resolve paths and fixed-string anchors against current source before persistence. Keep Markdown formatting out of shell arguments, and require every future path to be task-owned.

**Evidence:** `workflow/hooks/deny-dangerous.sh` (search: `Backtick command substitution hides nested execution`) blocks the unsafe command shape; `src/cli/redact-command.ts` (search: `readFileSync(0`) accepts direct stdin; `.goat-flow/architecture.md` (search: `## Local Data and Evidence Budget`) supplies the formatting-independent anchor.

**Prevention:** Run each persisted anchor exactly as a future agent will. Use `rg -F` with plain tokens, direct stdin for formatted prose, and reject unresolved or shell-diagnostic output.

---
