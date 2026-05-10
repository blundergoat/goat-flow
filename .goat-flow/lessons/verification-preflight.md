---
category: verification-preflight
last_reviewed: 2026-05-10
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

**What happened:** Added `test/unit/preset-prompts.test.ts` for the M01 security preset contract and the focused test passed, but `npx prettier --check src/dashboard/preset-prompts.json test/unit/preset-prompts.test.ts` failed on the new file.

**Root cause:** I treated the focused behavioral test as the first verification result for a new test file without running the repo formatter gate first.

**Prevention:** After adding or editing TypeScript tests, run `npx prettier --write <changed test files>` before claiming focused test verification. Keep the formatter check in the same verification bundle as the focused test so style failures are corrected before milestone boxes are ticked.

---
## Lesson: Slow installer round-trip catches prompt/test lint debt

**Status:** active | **Created:** 2026-04-26

**What happened:** After fixing quality-prompt and audit-provenance issues, `npm run test:slow` failed in `checkDrift: installer round-trip fixture` because the temp repo's preflight reported one ESLint error and one Prettier failure. The root causes were in the current working tree: `src/cli/prompt/compose-quality.ts` had an over-complex helper, and `test/unit/quality-command.test.ts` needed Prettier formatting. Direct `npx eslint src/cli src/dashboard` and `npm run format:check` reproduced both failures.

**Root cause:** I treated focused unit tests, typecheck, and fast-suite results as enough after changing a prompt helper and test fixture. The slow installer round-trip runs repo preflight inside a copied checkout, so it catches lint and format debt that focused tests do not.

**Prevention:** Before rerunning `npm run test:slow` after prompt/test changes, run `npx eslint src/cli src/dashboard` and `npm run format:check` locally. If the slow round-trip preflight fails, reproduce the reported gate directly in the source checkout before changing installer or drift logic.

---
## Lesson: Format touched TypeScript tests before repo-wide preflight

**Status:** active | **Created:** 2026-04-30

**What happened:** While implementing quality-assessment follow-ups, focused tests and `npm run typecheck` passed, but the first `bash scripts/preflight-checks.sh` run failed at Prettier with `2 unformatted files`. Running `npm run format` touched only the new/edited TypeScript test files, and the fresh preflight rerun passed.

**Root cause:** I treated focused tests plus typecheck as enough before the repo-wide gate even though new TypeScript test assertions had not been formatter-normalized. Preflight records formatter failure before later gates, so fixing format after a failed preflight requires a clean rerun to produce valid final evidence.

**Prevention:** After editing TypeScript tests or prompt/schema fixtures, run `npm run format` or `npm run format:check` before `bash scripts/preflight-checks.sh`. If preflight fails at Prettier, format, inspect the diff, and rerun preflight from scratch before claiming the final gate. Evidence anchors: `test/unit/check-content-quality.test.ts` (search: `discovers current ADR files`), `test/unit/quality-schema.test.ts` (search: `evidence_warning_count`).
