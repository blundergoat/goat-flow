---
category: verification-preflight
last_reviewed: 2026-08-23
---

**Scope:** Adding, tuning, and trusting a repo-wide gate - dependency-audit baselines, count locks and provenance dates, what a PASS line does and does not prove, and the shell mechanics of the commands a gate runs. Formatter and lint debt is [verification-formatting.md](verification-formatting.md).

## Lesson: Preflight PASS output still needs exit-status proof

**Status:** active | **Created:** 2026-06-07

**What happened:** During the M04 directory restructure closeout, `bash scripts/preflight-checks.sh` rendered `PASS   49 checks · 0 warnings · 54.0s`, but the process returned exit code 1. An explicit capture reproduced the contradiction: the tail showed `PASS   49 checks · 0 warnings · 53.1s` followed by `exit=1`.

**Root cause:** Preflight had multiple successful no-op paths that returned 1 under `set -euo pipefail`. Renderer helpers returned false when no expansion, phase change, or active section existed; the code-map script-list parser also used `grep` inside command substitution without `|| true`, so a zero-match parse aborted before the comparison could report a normal failure. The EXIT trap preserved the non-zero status even though no check had failed.

**Fix:** End no-op-safe renderer helpers (`_record_section_elapsed`, `_emit_phase_if_changed`, `_emit_section_row`, and `section`) with `return 0`, make zero-match parser pipelines explicit with `|| true`, and keep the script closeout as an explicit `if [[ "$errors" -gt 0 ]]; then exit 1; fi; exit 0`. Evidence anchors: `scripts/preflight-checks.sh` (search: `_emit_section_row`) and `scripts/preflight-checks.sh` (search: `if [[ "$errors" -gt 0 ]]; then`).

**Prevention:** When a shell gate has an EXIT trap or report renderer, capture both its human-readable summary and `$?` before treating it as final evidence. A green report line is not sufficient if the process status disagrees.

**Recurrence update (2026-07-12):** The new preflight runner passed focused checks, but `Doc/code drift` failed until `.goat-flow/code-map.md` listed it. Keep the top-level script inventory current. Evidence: `scripts/preflight-checks.sh` (search: `code-map.md scripts list drifts from scripts/ filesystem`).

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

## Lesson: Shared hook refactors need both hook-local proof and repo-wide preflight

**Status:** active | **Created:** 2026-04-21
**Decision changed:** Update fixture assumptions and exact diagnostics with a hook contract, then use the edit tool's native patch grammar before mirror fanout. | **Trigger phase:** ACT
**Caught at:** VERIFY
**Incident count:** 8 | **Latest occurrence:** 2026-08-16

**What happened:** A guardrail-hook hardening pass looked correct after the first edit, but the canonical self-test immediately failed because `BASH_REMATCH` was reused after a recursive command-check helper. After fixing that, the hook copies all passed their own `--self-test`, yet full `bash scripts/preflight-checks.sh` still failed because the repo-wide shellcheck profile was stricter than the hook-local path. The installer round-trip fixture failed for the same reason because it clones the current checkout before running temp-repo preflight.

**2026-08-16 recurrences:** The explicit post-turn root contract made a synthetic non-Git fixture ineligible for registration until the fixture created the Git boundary it asserted. The deny corpus then caught one exact diagnostic still expecting the retired `git push` wording after publication policy expanded to `send-pack`. During mirror fanout, the first patch used conventional unified-diff coordinate headers that `apply_patch` rejected before changing the mirror; its native bare `@@` form applied cleanly. INDEX-first retrieval found no patch-tool candidate after one reworded search, so that edit-tool recurrence is consolidated here with the hook fanout that exposed it. Evidence anchors: `test/integration/hook-effective-state.test.ts` (search: `initializeDisposableGitProject(projectPath)`), `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `Git publication is not allowed`), and `workflow/hooks/gruff-code-quality.sh` (search: `Usage:`).

**Later 2026-08-16 recurrence:** Full preflight found that the standalone installer still rebuilt post-turn registrations without the new root gate, so a later CLI sync changed Claude and Codex bytes. It also found three complexity errors, one internal-only exported type, two unformatted tests, and the controller split's stale semantic anchor. The first installer correction patched an identical `const fs` line in the manifest heredoc instead of the hook-migration heredoc; the focused install suite raised `ReferenceError: childProcess is not defined` before replacing any staged target. Moving the imports under the transform's unique contract comment restored all-agent convergence. Evidence anchors: `workflow/install-goat-flow.sh` (search: `postTurnRootContractAllowsRegistration`), `test/integration/setup-install-write-set.test.ts` (search: `install must not rewrite a disabled hook state`), and `src/cli/server/hook-registrar.ts` (search: `relativePathEscapesRoot`).

**Second preflight recurrence:** After installer convergence was green, the full suite still failed because the cross-agent fixtures deliberately kept targets non-Git while asserting that Codex and Claude received a Stop registration. The fixtures now require policy registration and explicitly reject the ineligible Stop row; their complete 18-case matrix is green. When a contract adds an eligibility gate, update broad fixtures that encode the old happy path even if their focused purpose is installation or repair rather than that gate. Evidence anchor: `test/integration/setup-install-agent-matrix.test.ts` (search: `This fixture is intentionally non-Git`).

**Third preflight recurrence:** Three upgrade and force-install fixtures also kept targets non-Git while expecting setup to restore the managed post-turn row. The corrected assertions preserve user-owned hooks but reject the ineligible managed row and timeout. Search migration and conflict-resolution suites for the old registration contract, not only the primary installer matrix. Evidence anchors: `test/integration/setup-install-codex-config-migration.test.ts` (search: `without creating Git state`), `test/integration/setup-install-migrations.test.ts` (search: `prunes retired plan checkbox guard config`), and `test/integration/setup-install-preview.test.ts` (search: `limits force to managed conflicts`).

**Fourth preflight recurrence:** The primary installer suite had the inverse problem: two fixtures asserted the eligible Claude/Codex registration path but supplied ordinary non-Git folders. They now initialize disposable Git roots and retain the exact timeout and Stop-response assertions. Classify each fixture by contract intent before changing it: make positive registration fixtures eligible, while negative and migration fixtures must reject an ineligible managed row. Evidence anchor: `test/integration/setup-install.test.ts` (search: `registers Claude post-turn safety with the registry timeout`).

**Prevention:**
1. In Bash regex helpers, copy `BASH_REMATCH[n]` into local variables before any recursive call or nested regex operation that can overwrite it.
2. When a hook contract changes root eligibility or user-visible wording, grep adjacent fixtures and exact-message assertions before the first focused run.
3. Apply mirror edits with the current edit tool's accepted patch grammar, and anchor repeated heredoc edits with their owning function or contract comment; then prove each source/mirror pair with `diff -u`.
4. Do not stop at `bash workflow/hooks/deny-dangerous.sh --self-test=full`; also rerun the repo-wide `shellcheck scripts/*.sh scripts/maintenance/*.sh scripts/installers/*.sh workflow/hooks/*.sh workflow/hooks/deny-dangerous/*.sh .goat-flow/hooks/*.sh .goat-flow/hooks/deny-dangerous/*.sh` and full `bash scripts/preflight-checks.sh`, because fixture clones exercise stricter paths than isolated hook runs.

---

## Lesson: Hook renames must include learning-loop and router-table drift

**Status:** active | **Created:** 2026-05-25
**Decision changed:** Before accepting a file or symbol rename, grep durable references and ignored working plans for the old name, then run `stats --check`.
**Trigger phase:** VERIFY
**Incident count:** 5 | **Latest occurrence:** 2026-08-22

**What happened:** The M10 split from the old command-safety hook to three guardrail hooks passed focused hook self-tests and the fast test suite, but `bash scripts/preflight-checks.sh` still failed. The failures were not in hook execution: stale learning-loop evidence pointed at deleted files, `.goat-flow/code-map.md` listed hook scripts under `scripts/`, `.goat-flow/architecture.md` omitted the new `hooks` dashboard view from the exact view inventory, and `.github/copilot-instructions.md` still routed to the old Copilot hook path.

**Recurrence update (2026-05-26):** A follow-up double-check used `rg` with the milestone exclusions and returned no hits, but the exact M10 `git grep` acceptance command still found tracked stale references in `.gemini/settings.json`, `.github/git-commit-instructions.md`, and `.goat-flow/learning-loop/decisions/`. The issue was not hook behavior; the search tool choice under-counted tracked files hidden by ignore rules.

**Recurrence update (2026-05-27):** M12 hook hardening passed functional hook checks, but the stale-name closeout grep still found active references to the old gruff hook id in `.goat-flow/architecture.md`, `.goat-flow/code-map.md`, and `.goat-flow/learning-loop/lessons/dashboard-testing.md` after the hook had already been renamed to `gruff-code-quality`. The remaining exact old-id hits are now limited to the migration alias and its regression tests.

**Recurrence update (2026-08-14):** Moving the final-gate lesson from `.goat-flow/learning-loop/lessons/verification-preflight.md` to `.goat-flow/learning-loop/lessons/agent-evidence-claims.md` cleared the bucket-size failure, but `stats --check` then found `.goat-flow/learning-loop/lessons/verification-testing.md` still cited the old file for the moved Prevention anchor. Update tracked semantic-anchor references in the same edit as an entry move. Evidence anchors: `.goat-flow/learning-loop/lessons/verification-testing.md` (search: `A predecessor may exempt one named RED fixture`) and `.goat-flow/learning-loop/lessons/agent-evidence-claims.md` (search: `A predecessor may exempt one named RED fixture`).

**Recurrence update (2026-08-22):** During M40, an optional private rename from `isMainModule` to `isDirectCliLaunch` passed focused help, drift, typecheck, and Gruff checks.
`stats --check` then found that the ESM-launch footgun still used `isMainModule` as its durable source anchor. Restoring the stable symbol fixed the reference without widening scope.
Evidence anchors: `src/cli/cli.ts` (search: `function isMainModule`) and `.goat-flow/learning-loop/footguns/cli.md` (search: `isMainModule`).

**Prevention:** After a file or code-symbol rename, run the full preflight and treat drift failures as part of the rename, not documentation cleanup.
Use the milestone's exact tracked-file grep, run `stats --check`, then use the required ignored-state search for active plans and local artifacts.
Evidence anchors: `scripts/preflight-checks.sh` (search: `Learning-loop schema`), `scripts/preflight-checks.sh` (search: `Dashboard view names drift`), and
`.github/copilot-instructions.md` (search: `deny-dangerous.sh --self-test=smoke`).

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

## Lesson: Verification grep patterns must not carry Markdown backticks into Bash

**Status:** active | **Created:** 2026-06-07
**Decision changed:** Validate persisted anchors with the literal search shape a future agent will run.
**Incident count:** 8 | **Latest occurrence:** 2026-08-17

**What happened:** Shell commands copied Markdown-formatted anchors into executable arguments. Bash treated backticks as command substitution, mangled searches, and once ran embedded CLI names. Later PreToolUse checks blocked the same shape before execution, including a redaction draft sent through a generated shell command.

**2026-08-11 recurrence:** Three plan Context references used remembered paths or symbols. A literal resolver caught them before handoff. Resolve every persisted path/anchor and mark future paths task-owned. Evidence: `src/cli/hooks-configured-runtime-evidence.ts` (search: `type HookRuntimeVerdict`).

**2026-08-16 recurrence:** A read-only `rg` pattern copied the milestone's Markdown backticks into a double-quoted shell argument, so PreToolUse rejected the search as command substitution before execution. Removing the formatting punctuation preserved the intended query. Evidence: `workflow/hooks/deny-dangerous.sh` (search: `Backtick command substitution hides nested execution`).

**2026-08-17 recurrence:** An M43 verification search again placed Markdown backticks inside a double-quoted `rg` argument. Policy blocked it before execution; a single-quoted plain search expressed the same read-only query safely. Evidence: `workflow/hooks/deny-dangerous.sh` (search: `Backtick command substitution hides nested execution`).

**Root cause:** Persisted search anchors were treated as prose or memory instead of executable future-agent contracts.

**Fix:** Resolve paths and fixed-string anchors against current source before persistence. Keep Markdown formatting out of shell arguments, and require every future path to be task-owned.

**Evidence:** `workflow/hooks/deny-dangerous.sh` (search: `Backtick command substitution hides nested execution`) blocks the unsafe command shape; `src/cli/redact-command.ts` (search: `readFileSync(0`) accepts direct stdin; `.goat-flow/architecture.md` (search: `## Local Data and Evidence Budget`) supplies the formatting-independent anchor.

**Prevention:** Run each persisted anchor exactly as a future agent will. Use `rg -F` with plain tokens, direct stdin for formatted prose, and reject unresolved or shell-diagnostic output.

---
