---
category: verification-preflight
last_reviewed: 2026-09-05
---

**Scope:** Adding, tuning, and trusting a repo-wide gate - dependency-audit baselines, count locks and provenance dates, what a PASS line does and does not prove, and the shell mechanics of the commands a gate runs. Formatter and lint debt is [verification-formatting.md](verification-formatting.md); an ad-hoc search that corrupts a file is [verification-scanners.md](verification-scanners.md).

## Lesson: Preflight PASS output still needs exit-status proof

**Status:** active | **Created:** 2026-06-07
**Incident count:** 2 | **Latest occurrence:** 2026-07-12

**Prevention:** When a shell gate has an EXIT trap or report renderer, capture both its summary and `$?` before treating it as final evidence; a green report line is not sufficient if the process status disagrees. End no-op-safe renderer helpers with `return 0`, make zero-match parser pipelines explicit with `|| true`, and keep the closeout an explicit error-count branch. Evidence anchors: `scripts/preflight-checks.sh` (search: `_emit_section_row`), `scripts/preflight-checks.sh` (search: `if [[ "$errors" -gt 0 ]]; then`).

**What happened:** During the M04 directory-restructure closeout, `bash scripts/preflight-checks.sh` rendered `PASS   49 checks · 0 warnings · 54.0s` while the process returned exit 1; an explicit capture reproduced the contradiction as `PASS   49 checks · 0 warnings · 53.1s` followed by `exit=1`.

**Root cause:** Preflight had successful no-op paths that returned 1 under `set -euo pipefail`: renderer helpers returned false when no expansion, phase change, or active section existed, and the code-map parser used `grep` inside command substitution without `|| true`, so a zero-match parse aborted. The EXIT trap preserved the non-zero status although no check had failed.

**Recurrence 2026-07-12:** The new preflight runner passed focused checks, but `Doc/code drift` failed until `.goat-flow/code-map.md` listed the runner; keep the top-level script inventory current. `scripts/preflight-checks.sh` (search: `code-map.md scripts list drifts from scripts/ filesystem`).

---

## Lesson: Attribute composite audit exits to the structured failing scope

**Status:** active | **Created:** 2026-08-28
**Decision changed:** Inspect each structured audit scope before attributing a composite command's nonzero exit to a prominent rendered status row.
**Trigger phase:** VERIFY
**Caught at:** VERIFY

**Prevention:** When one command renders several independent statuses, capture its exit and structured output together, and identify the scope whose status changes the exit before proposing a repair; a visible `FAIL` row can be advisory to that command. Evidence anchors: `scripts/preflight-checks.sh` (search: `audit --check-content reported drift`), `src/cli/audit/audit.ts` (search: `const hasRequiredDanger = requiredHookSurfaces.some`).

**What happened:** M41 Task 6 preflight rendered ineffective hook coverage above a failing content-lint section, and the command failure was first attributed to stale provider capture. The JSON audit showed the blocking finding was ADR-064's retired semantic anchor; after that anchor was repaired the audit exited zero with content status `pass` while still reporting two required hook surfaces as ineffective.

**Root cause:** The most prominent failure label was treated as the exit owner instead of the command's structured scope statuses.

---

## Lesson: New dependency-audit gates need a baseline audit first

**Status:** active | **Created:** 2026-05-21
**Decision changed:** Prove the current dependency tree and bound the registry call before trusting an audit gate; adjacent integration tests use a local protocol endpoint while release proof stays live.
**Trigger phase:** SCOPE
**Caught at:** VERIFY
**Incident count:** 3 | **Latest occurrence:** 2026-09-04

**Prevention:** Before adding or trusting a repo-wide dependency-audit gate, run the raw audit command against the current tree and give its registry call an inner deadline below the outer caller's limit. If it finds vulnerabilities, include the smallest compatible dependency update or stop before wiring a failing gate. Evidence anchors: `scripts/preflight-checks.sh` (search: `Dependency Audit`), `package.json` (search: `"ws": "^8.20.1"`).

**What happened:** Adding `npm audit` to preflight and CI, the first fresh audit failed on the existing direct `ws@8.20.0` dependency; the gate wiring was correct, but merging it alone would have made local preflight and CI fail immediately. The repair patched the dependency, synced `package-lock.json`, and reran both before the gate was claimed working.

**Root cause:** Adding the gate was treated as separate from proving the current baseline satisfies it, although a dependency-audit gate's first run can reveal already-present supply-chain debt.

**Recurrence 2026-09-04:** M15's installer fixture reached its embedded preflight after the release candidate passed focused checks, but new advisories made the existing `typed-rest-client` override of `qs@6.15.3` fail; raising only that transitive override to `qs@6.16.0` and syncing the lockfile kept the repair inside the existing dependency boundary. `package.json` (search: `"qs": "6.16.0"`).
**Recurrence 2026-09-04 (timeout):** A release suite spent more than 21 minutes before its installer round-trip child returned null status at a 400-second limit, because the embedded preflight called `npm audit` without its own deadline; two later 120-second probes also expired while ordinary registry ping stayed responsive. The repair routes the audit through the process-group runner with a blocking timeout and answers npm's bulk-advisory request on localhost. `scripts/preflight-checks.sh` (search: `GOAT_FLOW_PREFLIGHT_AUDIT_TIMEOUT_SECONDS`), `test/integration/preflight-progress.test.ts` (search: `bounds dependency audit without exposing a release-gate bypass`), `test/integration/audit-drift-checkdrift-installer-round-trip-fixture.test.ts` (search: `startLocalAuditRegistry`).

---

## Lesson: Dependency-audit gates can mutate lockfile metadata

**Status:** active | **Created:** 2026-06-14

**Prevention:** After `npm audit`, `npm test`, or full preflight, run `git status --short --untracked-files=all` before final scope claims. If `package-lock.json` changed and dependency updates are out of scope, inspect it with `git diff --text` and revert only audit-generated metadata drift before rerunning any required check. Evidence anchors: `scripts/preflight-checks.sh` (search: `Dependency Audit`), `package-lock.json` (search: `node_modules/@types/node`).

**What happened:** During M08 self-review, `package-lock.json` appeared in `git status` only after the final verification pass; a forced text diff showed registry metadata churn for transitive dev dependencies such as `@types/node`, `acorn`, `caniuse-lite`, and `eslint`, although dependency updates were out of scope.

**Root cause:** Dependency audit and preflight were treated as read-only for the working tree, but npm tooling can refresh lockfile metadata while producing otherwise passing output.

---

## Lesson: Shared hook refactors need both hook-local proof and repo-wide preflight

**Status:** active | **Created:** 2026-04-21
**Decision changed:** Update fixture assumptions and exact diagnostics with a hook contract, then use the edit tool's native patch grammar before mirror fanout.
**Trigger phase:** ACT
**Caught at:** VERIFY
**Incident count:** 8 | **Latest occurrence:** 2026-08-16

**Prevention:** In Bash regex helpers, copy `BASH_REMATCH[n]` into locals before any recursive call or nested regex operation that can overwrite it. When a hook contract changes root eligibility or user-visible wording, grep adjacent fixtures and exact-message assertions before the first focused run, and classify each fixture by contract intent: positive registration fixtures must be eligible, while negative and migration fixtures must reject an ineligible managed row. Apply mirror edits with the edit tool's accepted patch grammar, anchor repeated heredoc edits with their owning function or contract comment, and prove each source and mirror pair with `diff -u`. Do not stop at the hook's own `--self-test=full`: rerun the repo-wide ShellCheck command over `scripts/`, `workflow/hooks/`, and `.goat-flow/hooks/` and the full `bash scripts/preflight-checks.sh`, because fixture clones exercise stricter paths than isolated hook runs.

**What happened:** A guardrail-hook hardening pass looked correct after the first edit, but the canonical self-test failed because `BASH_REMATCH` was reused after a recursive command-check helper. Once fixed, every hook copy passed its own `--self-test` while full preflight still failed, because the repo-wide ShellCheck profile is stricter than the hook-local path and the installer round-trip fixture clones the checkout before running temp-repo preflight.

**Root cause:** Hook-local proof was treated as sufficient for a change that also crosses the repository lint profile, the installer, and every fixture encoding the old registration contract.

**Recurrence 2026-08-16 (contract fanout):** The explicit post-turn root contract made a synthetic non-Git fixture ineligible until it created the Git boundary it asserted; the deny corpus caught one diagnostic still expecting the retired `git push` wording after policy expanded to `send-pack`; and the first mirror patch used unified-diff coordinate headers that `apply_patch` rejected, where its native bare `@@` form applied cleanly. `test/integration/hook-effective-state.test.ts` (search: `initializeDisposableGitProject(projectPath)`), `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `Git publication is not allowed`), `workflow/hooks/gruff-code-quality.sh` (search: `Usage:`).
**Recurrence 2026-08-16 (installer):** Full preflight found the standalone installer still rebuilding post-turn registrations without the new root gate, plus three complexity errors, one internal-only exported type, two unformatted tests, and a stale semantic anchor from the controller split. The first correction patched an identical `const fs` line in the manifest heredoc instead of the hook-migration heredoc, and the focused suite raised `ReferenceError: childProcess is not defined` before replacing any staged target. `workflow/install-goat-flow.sh` (search: `postTurnRootContractAllowsRegistration`), `test/integration/setup-install-write-set.test.ts` (search: `install must not rewrite a disabled hook state`), `src/cli/server/hook-registrar.ts` (search: `relativePathEscapesRoot`).
**Recurrence 2026-08-16 (cross-agent fixtures):** The full suite failed because cross-agent fixtures kept targets non-Git while asserting Codex and Claude received a Stop registration; they now require policy registration and explicitly reject the ineligible Stop row, with the 18-case matrix green. `test/integration/setup-install-agent-matrix.test.ts` (search: `This fixture is intentionally non-Git`).
**Recurrence 2026-08-16 (migration fixtures):** Three upgrade and force-install fixtures kept targets non-Git while expecting setup to restore the managed post-turn row; search migration and conflict-resolution suites for the old contract, not only the primary matrix. `test/integration/setup-install-codex-config-migration.test.ts` (search: `without creating Git state`), `test/integration/setup-install-migrations.test.ts` (search: `prunes retired plan checkbox guard config`), `test/integration/setup-install-preview.test.ts` (search: `limits force to managed conflicts`).
**Recurrence 2026-08-16 (inverse case):** The primary installer suite had two fixtures asserting the eligible registration path from ordinary non-Git folders; they now initialize disposable Git roots and retain the exact timeout and Stop-response assertions. `test/integration/setup-install.test.ts` (search: `registers Claude post-turn safety with the registry timeout`).

---

## Lesson: Hook renames must include learning-loop and router-table drift

**Status:** active | **Created:** 2026-05-25
**Decision changed:** Before accepting a file or symbol rename, grep durable references and ignored working plans for the old name, then run `stats --check`.
**Trigger phase:** VERIFY
**Incident count:** 7 | **Latest occurrence:** 2026-09-04

**Prevention:** After a file or code-symbol rename, run full preflight and treat drift failures as part of the rename, not documentation cleanup. Use the milestone's exact tracked-file grep, run `stats --check`, then run the required ignored-state search for active plans and local artifacts. Scope zero-hit assertions to the migrated surface and classify remaining hits against explicit downstream ownership. Evidence anchors: `scripts/preflight-checks.sh` (search: `Learning-loop schema`), `scripts/preflight-checks.sh` (search: `Dashboard view names drift`), `.github/copilot-instructions.md` (search: `deny-dangerous.sh --self-test=smoke`).

**What happened:** The M10 split from the old command-safety hook into three guardrail hooks passed focused self-tests and the fast suite, but preflight failed outside hook execution: stale learning-loop evidence pointed at deleted files, the code map listed hook scripts under `scripts/`, the architecture doc omitted the new `hooks` dashboard view, and the Copilot instruction file still routed to the old hook path.

**Root cause:** A rename was treated as a code change, although durable evidence anchors, orientation docs, and instruction routes all encode the old name and only repo-wide gates read them.

**Recurrence 2026-05-26:** A double-check used `rg` with the milestone exclusions and returned no hits, but the exact `git grep` acceptance command found tracked stale references in `.gemini/settings.json`, `.github/git-commit-instructions.md`, and the decisions directory; the search tool choice under-counted tracked files hidden by ignore rules.
**Recurrence 2026-05-27:** M12 hook hardening passed functional checks while the closeout grep found active references to the old gruff hook id in `.goat-flow/architecture.md`, `.goat-flow/code-map.md`, and `.goat-flow/learning-loop/lessons/dashboard-testing.md` after the rename to `gruff-code-quality`; the remaining exact hits are now limited to the migration alias and its regression tests.
**Recurrence 2026-08-14:** Moving the final-gate lesson between buckets cleared a bucket-size failure, but `stats --check` found a sibling bucket still citing the old file for the moved Prevention anchor; update tracked semantic-anchor references in the same edit as an entry move. `.goat-flow/learning-loop/lessons/verification-testing.md` (search: `A predecessor may exempt one named RED fixture`), `.goat-flow/learning-loop/lessons/agent-evidence-claims.md` (search: `A predecessor may exempt one named RED fixture`).
**Recurrence 2026-08-22:** An optional private rename from `isMainModule` to `isDirectCliLaunch` passed focused help, drift, typecheck, and Gruff checks, but `stats --check` found the ESM-launch footgun still using the old symbol as its durable anchor; restoring the stable symbol fixed the reference without widening scope. `src/cli/cli.ts` (search: `function isMainModule`), `.goat-flow/learning-loop/footguns/cli.md` (search: `isMainModule`).
**Recurrence 2026-08-27:** M41 Task 6 replaced a v1 preview-fixture helper and preview reader with v2 successors; focused tests and typecheck passed, but `stats --check` found the fixture-comment lesson searching for the removed helper and the content audit found ADR-064 searching for the retired reader call. A closeout grep then over-scoped the retired call across all source and flagged consumers intentionally reserved for later tasks. `test/integration/setup-install-preview.test.ts` (search: `downgradeManagedStateToSevenCodexSkills`), `src/cli/managed-setup-preview.ts` (search: `const baseline = readManagedSetupV2Baseline`), `.goat-flow/learning-loop/decisions/ADR-064-one-managed-path-one-baseline.md` (search: `# ADR-064: Give each managed path one install baseline`).
**Recurrence 2026-09-04:** Replacing a direct `npm audit` shell substitution with the bounded command runner removed an exact source string cited by the lockfile-metadata lesson; shell and runner checks passed, but the installer fixture's embedded preflight rejected the stale anchor before reaching its drift assertion. `scripts/preflight-checks.sh` (search: `Dependency Audit`).

---

## Lesson: New harness checks need count locks and provenance date proof

**Status:** active | **Created:** 2026-05-16 | **Merged during:** M11 learning-loop consolidation
**Incident count:** 3 | **Latest occurrence:** 2026-06-08

**Prevention:** After adding or removing any audit check, grep for `registered build and harness checks`, `HARNESS_CHECKS.length`, the old total, and the new check id across `test/`, `docs/`, the instruction files, `.goat-flow/` orientation docs (`glossary.md`, `code-map.md`), and learning-loop anchors. Then run a JSON audit parse printing the new check's `id`, `type`, `impact`, and `provenance.verified_on`. Re-run full preflight until clean: its `Doc/code drift` and `Learning-loop schema` checks are the only gates that catch the doc and anchor cascade, and fixing one count string can break an anchor that searched for it.

**What happened:** Adding the `evidence-before-claims` harness metric passed focused check tests, but the full suite failed on a provenance-schema count lock expecting the old registered-check total, and the self-audit JSON showed the new check using the default `verified_on` date until its provenance was set explicitly.

**Root cause:** Visible count docs and type-distribution tests were updated while deeper provenance-count locks and JSON evidence freshness were not.

**Recurrence 2026-06-08:** Adding the `hook-version` setup check (setup 15 to 16, total 36 to 37) passed `npm test` 621/621, which caught only the hardcoded total in `test/unit/provenance-types.test.ts`, while preflight found six more stale references: `.goat-flow/architecture.md` build and sub-breakdown counts, `CLAUDE.md`, `AGENTS.md`, and `CONTRIBUTING.md` at `15 setup`, and two learning-loop anchors in `.goat-flow/learning-loop/footguns/quality.md` and `.goat-flow/learning-loop/lessons/review-feedback.md` (search: `20 build checks`). Fixing the architecture count then broke that second anchor, which surfaced only on the second preflight run. The manifest needed no edit because `facts.checks.setup` is computed from `SETUP_CHECKS.length`.
**Recurrence 2026-06-08 (glossary straggler):** The same bump left `.goat-flow/glossary.md` stale at `setup-scope (15 checks)`, which neither `npm test` nor preflight flags, because the glossary's prose count sits outside both the architecture-count and anchor gates; it shipped to the branch and surfaced in manual review.

---

## Lesson: Learning-loop content gates need tracked, durable paths

**Status:** active | **Created:** 2026-05-27 | **Merged during:** M11 learning-loop consolidation
**Incident count:** 6 | **Latest occurrence:** 2026-08-10

**Prevention:** Before closing add, rename, delete, or learning-loop edits, run both a tracked-state check (`git status --short`, `git ls-files --error-unmatch <path>`) and the relevant old-pattern grep, including source-owned provenance and detector metadata rather than Markdown alone. Use an ignore-bypassing search when ignored `.goat-flow` workspace state is the target. In durable artifacts cite committed repo files, public URLs, or prose descriptions for external paths, and never backtick a fake repo-local example; when documenting a deleted path, name the old filename in prose rather than writing it as if it resolves. Evidence anchors: `src/cli/audit/harness/check-context.ts` (search: `boundary-guidance-present`), `src/cli/audit/harness/check-verification.ts` (search: `evidence-before-claims`).

**What happened:** Several verification failures came from citing paths that were not durable repo truth: gitignored task files in ADRs, ignored `.goat-flow` paths hidden by a normal search, unresolved optional skill-path examples, and fake external PR paths formatted as repo-local code spans. On 2026-05-27, lesson renames left deleted paths in code-owned audit provenance although Markdown greps passed.

**Root cause:** A filesystem check proves that a path currently resolves, not that the reference is committed, portable, or appropriate for a durable entry; ignored local workspaces and external examples need different citation forms from repo-local files.

**Recurrences 2026-06-10 and 2026-07-19:** `stats --check` caught `bucket-size` after Step 0 and M07 recurrence edits crossed the byte gate, and the first run also caught a bare-path `stale-ref`; both fixes compacted redundant wording, preserved anchors, regenerated indexes, and reran stats. `.goat-flow/learning-loop/lessons/agent-behavior.md` (search: `Step 0 retrieval was advisory`), `src/cli/stats/stats.ts` (search: `BUCKET_SIZE_WARN_BYTES`).
**Recurrence 2026-08-04:** A broad Markdown evidence scan admitted a gitignored nested plan README, and adversarial review exposed a permissive log-README rule plus omitted tool-cache roots; the gate now admits only enumerated committed local-state READMEs. `src/cli/audit/check-content-quality.ts` (search: `COMMITTED_LOCAL_STATE_READMES`).
**Recurrence 2026-08-09:** Two same-day learning edits crossed the bucket cap, the first index refresh swept unrelated generated rows into a rollback patch, and `stats --check` later rejected durable drafts citing ignored planning files. Describe the mechanism without local milestone labels, compact before indexing, diff generated files, and cite tracked sources. `src/cli/learning-loop-index/generate.ts` (search: `generateIndexes`), `src/cli/facts/shared/learning-loop-common.ts` (search: `Local-state paths (plans/scratchpad/logs)`).
**Recurrence 2026-08-10:** Launcher and evidence refactors left two durable search anchors pointing at removed symbols, so repository schema and content gates failed after focused code checks cleared; pair semantic renames with an exact old-name search across durable evidence before preflight. `src/cli/server/agent-hook-command.ts` (search: `legacyHookLaunchMode`), `src/cli/hooks-runtime-evidence.ts` (search: `verifyManagedDenyHook`).

---

## Lesson: Pipe input cannot share stdin with heredoc scripts

**Status:** active | **Created:** 2026-05-24

**Prevention:** After adding shell code that combines pipes, heredocs, or process substitutions, run `shellcheck` before smoke-testing the behaviour, and treat `SC2259` as a correctness failure rather than style noise. Store the command output in a variable and feed it with a here-string to a `node --eval` script, or pass data through an explicit file descriptor. Evidence anchor: `scripts/dependency-update.sh` (search: `latest_dependencies="$(npm view`).

**What happened:** Adding npm override review logic to `scripts/dependency-update.sh`, the first verification run failed ShellCheck with `SC2259` because the code piped `npm view ... --json` into `node --input-type=module - ... <<'NODE'`; the heredoc supplied Node's stdin for the script body, so the piped registry JSON would never have reached `process.stdin`.

**Root cause:** Heredoc script input and piped data input were treated as independent streams, but for `node -` they compete for stdin and the heredoc wins.

---

## Lesson: Verification grep patterns must not carry Markdown backticks into Bash

**Status:** active | **Created:** 2026-06-07
**Decision changed:** Validate persisted anchors with the literal search shape a future agent will run.
**Trigger phase:** VERIFY
**Incident count:** 13 | **Latest occurrence:** 2026-08-28
**Merged:** 2026-09-05 - absorbed the four blocked-search recurrences (2026-06-14, 2026-07-17, 2026-07-19, 2026-08-23) from `.goat-flow/learning-loop/lessons/verification-scanners.md`, which keeps the redirect-corruption incident; this entry owns Markdown formatting reaching a shell argument.

**Prevention:** Run each persisted anchor exactly as a future agent will: single-quote the whole pattern, or use `-F` with plain tokens, and keep Markdown backticks, emphasis, and code-span punctuation out of shell arguments entirely. Use direct stdin for formatted prose, resolve every path and symbol against current source before persisting it, mark future paths task-owned, and reject unresolved or shell-diagnostic output. Evidence anchors: `workflow/hooks/deny-dangerous.sh` (search: `Backtick command substitution hides nested execution`) blocks the unsafe shape; `src/cli/redact-command.ts` (search: `readFileSync(0`) accepts direct stdin; `.goat-flow/architecture.md` (search: `## Local Data and Evidence Budget`) is a formatting-independent anchor.

**What happened:** Shell commands copied Markdown-formatted anchors into executable arguments. Bash treated the backticks as command substitution, mangled searches, and once ran an embedded CLI name; later PreToolUse checks blocked the same shape before execution, including a redaction draft sent through a generated shell command.

**Root cause:** Persisted search anchors were treated as prose or memory instead of executable contracts for a future agent.

**Recurrence 2026-06-14:** Verifying a `goat-qa` skill-doc edit, an `rg` pattern included Markdown backticks around `initialInput` and the deny hook blocked it as command substitution before execution; no files changed, but the pass was rerun with a safer pattern. `workflow/skills/goat-qa/SKILL.md` (search: `safe to skip more PTY timing tests`).
**Recurrences 2026-07-17 and 2026-07-19:** Double-quoted `rg` patterns containing Markdown backticks were blocked before execution; single-quoting the whole pattern fixed both searches without changing files.
**Recurrence 2026-08-11:** Three plan Context references used remembered paths or symbols, caught by a literal resolver before handoff; resolve every persisted path and anchor, and mark future paths task-owned. `src/cli/hooks-configured-runtime-evidence.ts` (search: `type HookRuntimeVerdict`).
**Recurrence 2026-08-16:** A read-only `rg` pattern copied a milestone's Markdown backticks into a double-quoted argument and PreToolUse rejected the search as command substitution; removing the formatting punctuation preserved the query.
**Recurrence 2026-08-17:** An M43 verification search again placed Markdown backticks inside a double-quoted `rg` argument; a single-quoted plain search expressed the same read-only query safely.
**Recurrence 2026-08-23:** Checking whether revised source comments were cited by learning-loop entries, an `rg` pattern put Markdown backticks inside double-quoted shell text; the hook stopped it before execution and removing the syntax-significant quoting produced the intended read-only search.
**Recurrence 2026-08-28:** A read-only search for the Knip lesson copied its Markdown-formatted `ignore` token into a double-quoted `rg` argument; PreToolUse blocked it before any nested execution or file change, and a single-quoted substitution-free search returned the intended entry.
