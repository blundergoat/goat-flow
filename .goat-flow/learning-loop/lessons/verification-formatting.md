---
category: verification-formatting
last_reviewed: 2026-08-16
---

**Scope:** Formatter, lint, and Knip debt that only surfaces at repo-wide scope - style flags, copied or untracked files that inherit debt, and touched-test formatting before a verification claim. Adding or tuning a preflight gate is [verification-preflight.md](verification-preflight.md).

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

**Recurrence (2026-08-16):** A Copilot file-selector run changed `src/cli/review-validate-anchors.ts` and reported completion after typecheck, but an exact-path Prettier check still rejected the file. The remediation now freezes formatter commands before mutation and makes literal formatter proof mandatory in the receipt.

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
- `workflow/skills/goat-clarity/SKILL.md` (search: `Formatter proof:`).
- `test/contract/skill-hardening-clarity.test.ts` (search: `freezes repository formatter commands and proof before mutation`).

**Prevention:** Format touched TypeScript before focused proof and retain Prettier in final verification. For goat-clarity, freeze the repository-owned check and write commands before mutation; a receipt without literal formatter proof remains incomplete.

**Decision changed:** Run the repository formatter on touched TypeScript before treating a focused GREEN run as milestone verification. | **Trigger phase:** VERIFY | **Incident count:** 17 | **Latest occurrence:** 2026-08-16

---

## Lesson: Slow installer round-trip catches prompt/test lint debt

**Status:** active | **Created:** 2026-04-26

**What happened:** Prompt changes cleared focused tests and typecheck but failed the installer round-trip embedded preflight three times: on 2026-04-26 an over-complex compose-quality.ts helper and unformatted quality-command fixture; on 2026-05-24 checkHookRuntimeSmoke exceeded ESLint complexity by one; on 2026-07-16 PR #56 renderAuditSummary reached complexity 17. Extracting narrow helpers and formatting the fixture cleared the direct gates. The first 2026-07-16 recurrence note also pushed this bucket to 40,353 bytes, so the incident history was consolidated below the cap.

**Root cause:** Focused behavior tests and typecheck do not run the full-source lint and format gates that the copied checkout enforces.

**Prevention:** Before slow installer tests, run the supported source ESLint and format gates. Reproduce a failure directly before changing installer or drift logic. Evidence anchors: `src/cli/prompt/compose-quality-common.ts` (search: `appendScopeSummary`), `src/cli/audit/check-agent-deny-runtime.ts` (search: `verifyConfiguredHookRuntime`), and `test/unit/quality-report-contract.test.ts` (search: `embeds drift and content failures`).

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

## Lesson: Preflight TypeScript gates include Knip binary policy and touched-test formatting

**Status:** active | **Created:** 2026-06-07

**Decision changed:** Run typecheck, ESLint, Knip, and formatting before preflight after TypeScript surface changes. | **Trigger phase:** VERIFY | **Incident count:** 14 | **Latest occurrence:** 2026-08-16

**What happened:** Narrower checks repeatedly cleared before later static gates. On 2026-08-10, typecheck rejected dynamic membership against a literal-tuple union and ESLint found proof-reader and registrar complexity 13/11. Earlier recurrences included formatting drift, an undiscovered worker, and impossible fallback logic.

**Root cause:** Typecheck and runtime tests do not exercise lint complexity, unused-code/binary policy, static fixture reachability, or formatting. A child process launched from a string path can be reachable at runtime but invisible to Knip's dependency graph. Running a memory-heavy analyzer beside other gates can also turn a resource limit into a misleading tool failure.

**Fix and prevention:** After TypeScript changes, run ESLint, Knip, and `npm run format:check` before preflight and fix their exact findings. Keep child-process fixtures statically discoverable with `fileURLToPath(new URL("../fixtures/worker.ts", import.meta.url))`. Run Knip independently with the repository gate's heap and traversal flags; a default `npx knip` OOM is not the gate result. Evidence anchors: `scripts/preflight-checks.sh` (search: `--no-gitignore keeps Knip from walking`), `.goat-flow/learning-loop/footguns/preflight-plumbing.md` (search: `Knip's \`ignore\` cannot shrink`), `knip.json` (search: `ignoreBinaries`), and `test/helpers/concurrent-quality-workers.ts` (search: `quality-capture-concurrency-worker.ts`).

**Measured recurrences:** Static gates have found complexity, impossible conditions, internal-only exports, an undiscovered worker, and a measured Knip heap limit. The latest fix widened dynamic scenario ids through `Set<string>` and separated event matching from gate promotion. Evidence anchors: `src/cli/server/hook-runtime-proof.ts` (search: `requiredScenarioIds`) and (search: `hookSupportGateAfterLocalProof`).

**Recurrence 2026-08-16 (registrar helper extraction):** Moving the provider-case matrix and recursive row counter into the existing helper removed the Gruff file-length error, but the changed multiline import in the original test failed the focused Prettier gate. Formatting the touched test before typecheck and Knip kept the failure local. Evidence anchors: `test/unit/hook-registrar.helpers.ts` (search: `SUPPORTED_PROVIDER_HOOK_CASES`) and `test/unit/hook-registrar.test.ts` (search: `countOwnedCommandRows`).

**Release recurrence (2026-08-09):** Hook notes gained a dated release heading before its manifest snapshot existed, so the full suite failed. Keep notes under `Unreleased` until release identity and its snapshot propagate together. Evidence: `CHANGELOG.md` (search: `## Unreleased`) and `test/unit/manifest.test.ts` (search: `missing manifest snapshots`).

---
