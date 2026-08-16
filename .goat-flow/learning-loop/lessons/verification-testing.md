---
category: verification-testing
last_reviewed: 2026-08-14
---

**Scope:** What a test must actually establish - observable contracts over incidental shape, deadlines independent of the thing under test, telling a transient failure apart from a regression, and the ways a passing suite still fails to prove its claim. Proving a guard or scanner works is [verification-scanners.md](verification-scanners.md); building fixtures is [test-fixtures.md](test-fixtures.md).

## Lesson: Timeout completion needs a deadline independent of child close

**Status:** active | **Created:** 2026-07-12
**Decision changed:** Treat a timeout response as incomplete proof until the host-facing call also returns within its wall-clock bound.
**Trigger phase:** VERIFY
**Incident count:** 2 | **Latest occurrence:** 2026-08-09

**What happened:** The seven-skill pressure matrix reproduced a preflight runner that exceeded its hard timeout window after process-group escalation. A detached test helper escaped the group, inherited stdout/stderr, and held those pipes open, so Node delayed the child's `close` event after the direct process exited.

**Recurrence 2026-08-09:** M03 preflight first reported `bounds gruff hooks with a timeout-specific response` as transient because its automatic full-suite retry passed. Running that named test directly reproduced the failure in 2.02 seconds: the launcher emitted the expected timeout message and status but missed its 1.5-second return bound. A deterministic fixture then wrote a marker after starting the background child and reproduced the same wait, ruling out an early Bash kill. Evidence anchors: `workflow/hooks/run-with-bash.mjs` (search: `hook exceeded its deadline and was killed`) and `test/unit/hook-launcher.test.ts` (search: `returns promptly after a started hook descendant exceeds its deadline`).

**Root cause:** Both timeout paths treated direct-child termination as completion. A descendant retaining inherited output handles could keep the host-facing call open; the hook launcher also killed Bash without bounding the process tree it had started.

**Fix:** The preflight runner uses a one-shot cleanup deadline and closes its local capture streams. The hook launcher now starts a detached POSIX process group, uses Windows tree termination on native Windows, stops that tree at the configured deadline, and delivers one timeout result without waiting for a late close event. Evidence anchors: `scripts/preflight-command-runner.mjs` (search: `cleanup deadline reached after process-group escalation`) and `workflow/hooks/run-with-bash.mjs` (search: `function stopHookProcessTree`).

**Prevention:** Test timeout runners with a confirmed-started descendant that retains an inherited output handle. Assert the marker, response mode, timeout message, and wall-clock bound; a kill signal or timeout message alone does not prove the user regains control.

---

## Lesson: Delegated pressure runs need persistent recovery state

**Status:** active | **Created:** 2026-07-12

**What happened:** M33 launched a long `goat-critique` run with `codex exec --ephemeral`. The run persisted Phase 1–4 evidence but was interrupted before synthesis; `codex exec resume` then failed with `no rollout found`, so the otherwise detailed attempt remained UNVERIFIED and had to be repeated.

**Root cause:** The runner contract optimized for session cleanup even though delegated critique is expensive and its completion evidence spans multiple agent results plus a meta-audit.

**Prevention:** Use persistent native sessions for delegated or multi-turn pressure tests. Keep ephemeral sessions for single-turn probes only; record the thread ID early and prove a recovery path before treating a long run as the sole release evidence.

---

## Lesson: Cache-behaviour tests need observable contracts

**Status:** active | **Created:** 2026-05-20

**What happened:** While replacing a flaky Quality cache timing assertion, my first counter-based test tried to observe deny-hook self-test executions by monkeypatching `child_process.execFileSync`. The route path imports `execFileSync` as a named binding before the test patch, so the counter stayed at zero and the focused dashboard integration test failed even though the product behavior was the target.

**Root cause:** I swapped a timing smell for an implementation-observation smell. Imported Node builtins and transitive helpers are not a reliable public signal for cache behavior.

**Prevention:** For server cache behavior, expose a narrow response/debug contract or inject an explicit dependency, then assert that contract at the route boundary. Avoid timing ratios and late monkeypatches of already-imported helpers. Evidence anchors: `src/cli/server/dashboard-quality-routes.ts` (search: `getOrRunQualityAudit`), `test/integration/dashboard-server-dashboard-api-quality.test.ts` (search: `reuses cached quality audits unless fresh=true is requested`), `src/cli/audit/check-agent-deny-mechanism.ts` (search: `checkHookSelfTest`).

---

## Lesson: Contract tests pin doctrine wording and path semantics

**Status:** active | **Created:** 2026-04-25

**What happened:** While removing one forbidden phrase and changing dashboard quality report ownership, the first full `npm test` run failed two contract-style checks: a skill-hardening contract (now `test/contract/skill-hardening-shared-3.test.ts`, search: `hardening debt`) still required the established "hardening debt" evidence language, and a dashboard prompt-source assertion still expected the old relative quality-report path message.

**Root cause:** I treated wording cleanup and path-semantics changes as local edits, but these surfaces are intentionally pinned by tests because agents consume the exact phrasing.

**Recurrence 2026-05-17:** During M10 path validation hardening, the first full `npm test` run caught `test/smoke/dashboard-endpoints.test.ts` still asserting the old `Invalid project path` terminal error wording after `validateProjectPath` moved to the shared `LocalPathValidationError` contract. Evidence anchors: `src/cli/server/local-paths.ts` (search: `Local path validation failed`), `test/smoke/dashboard-endpoints.test.ts` (search: `rejects missing and file project paths before PTY launch`).

**Recurrence 2026-07-13:** M20's first manual JSON probe parsed the report, then failed because it assumed a root `groups` key instead of the implemented `surfaces` groups. Re-reading the locked fixture showed the report was correct; the probe was rewritten against `goat-flow.context-report.v1`. Evidence anchor: `test/unit/context-report.test.ts` (search: `renders parseable JSON without telemetry or provider state`).

**Recurrence 2026-07-19:** A `setupPrompt` fixture landed in the preceding subtest, so RED failed with `setupPrompt is not defined` instead of the intended prompt-copy assertion. Moving the fixture into its consumer produced the real failure. Evidence: `test/contract/command-phrases.test.ts` (search: `keeps git-history correlations as candidates until semantic proof exists`).

**Recurrence 2026-07-29:** Pins include section adjacency: inserting an `## Effort Estimates` section between the illustrative-scenario label and `## Assumption Tracking` in `goat-plan/references/milestone-examples.md` failed `test/contract/skill-hardening-shared-3.test.ts` (search: `scenario label must immediately precede the assumption block`); moving the section above the label fixed it.

**Recurrence 2026-08-03:** The first GREEN wording for oversized review scope and critique context merging pushed `goat-review` and `goat-critique` from 2495/2494 words to 2592/2531. The focused skill-contract run rejected both before broader verification; budget-neutral rewrites finished at 2498/2495. Evidence anchors: `workflow/skills/goat-review/SKILL.md` (search: `never guess commit windows`), `workflow/skills/goat-critique/SKILL.md` (search: `never replace baseline context`), `test/contract/skill-hardening-review-1.test.ts` (search: `stops oversized inferred branch scopes before review begins`). TDD receipts: `.goat-flow/logs/sessions/2026-08-03-goat-review-tdd.md` and `.goat-flow/logs/sessions/2026-08-03-goat-critique-tdd.md`.

**Recurrence 2026-08-09:** A new milestone roadmap first failed strict validation because six mid-implementation proof items had no parseable estimates. After that arithmetic was corrected, `plans check --strict` passed while 24 `Read first` anchors still named stale paths or paraphrases absent from their files. A separate exact path and `rg -F` anchor audit exposed the cold-start failures. Treat each validator as proof only of its named contract: run strict plan validation for structure and estimates, then independently verify every referenced path and semantic anchor. Evidence anchors: `src/cli/plans-check.ts` (search: `mid-proof item(s) missing an (est: ...) entry`) and `test/unit/plans-check-lifecycle.test.ts` (search: `strict mode rejects unestimated testing and mid-proof work`).

**Recurrence 2026-08-09:** M03 correctly qualified goat-debug's boundary command as `ALWAYS in Diagnose mode`, but the first full `npm test` run exposed a shared contract that still required the exact unqualified `ALWAYS` label. The focused goat-debug contract passed because it covered the new wording; the shared contract now accepts only the canonical label or that explicit Diagnose qualifier. Evidence anchors: `workflow/skills/goat-debug/SKILL.md` (search: `ALWAYS in Diagnose mode`) and `test/contract/skill-hardening-shared-1.test.ts` (search: `keeps canonical skill boundaries explicit and route-focused`).

**Recurrence 2026-08-16:** I told the user that relocating goat-security's exception tuple and Compliance Mode into a reference would cut "~3,000 chars" and reach the skill-quality 10/10 token tier, estimating from a glance rather than measuring. Measured, the two sections were 1,328 and 1,546 chars, and the pointers left behind reduced the net to 2,395; the skill stayed at 5,151 tokens against a 5,000 boundary. The plan the user approved on that estimate could not deliver its stated outcome, and the shortfall only surfaced after the moves and contract retargets were done. Evidence anchors: `.goat-flow/learning-loop/footguns/skill-authoring.md` (search: `Dense functional skills satisfy the ADR-023 word cap`) and `src/cli/quality/skill-quality-metrics.ts` (search: `tokens > 5000`).

**Prevention:** Search tests for changed prose and adjacent commands. Keep fixtures inside their consuming subtest and re-read the block before RED. Update a contract only when product semantics change; preserve unrelated doctrine. Before drafting in a near-cap skill, measure the current word budget; replace or condense existing wording, or move detail into a progressive reference, before GREEN. Before quoting a budget or score outcome to the user, measure the exact sizes involved (moved sections minus the pointer text that replaces them) with the same function the gate uses, and state the measured margin.
---

## Lesson: Split transient preflight test failures from task regressions

**Status:** active | **Created:** 2026-04-26

**What happened:** A quality-report fix removed the ESLint error that had been blocking `bash scripts/preflight-checks.sh`. Two subsequent preflight runs reached the fast test phase but failed on different tests: first `agent deny hook template comparison`, then `harness does not affect build-only result`. A direct `npm run test:fast` run immediately after those failures completed with `# pass 373` and `# fail 0`.

**Root cause:** I initially treated the preflight failure as a likely task regression because it appeared inside the final gate. The changing failed test names and the direct fast-suite pass showed the correct split: the task-local ESLint/preflight regression was fixed, while the preflight wrapper still surfaced intermittent fast-suite failures that need separate investigation.

**Prevention:** When preflight fails in the test phase after unrelated gate fixes, rerun the named failing test area and then the exact fast-suite command directly before changing task files again. The preflight wrapper now reruns `test:fast` once when the first test-phase attempt fails; a retry pass records a warning with the initial `not ok` lines instead of failing the whole gate. Report the split explicitly: which original gate was fixed, which direct test summary passed, and whether preflight isolated a transient first-run failure.

**Recurrence 2026-08-17 (concurrent mirror save):** After the M39 ESLint fix cleared preflight's TypeScript stage, the fast suite observed a changelog mirror mismatch while playbook edits were in progress. The immediate isolated sync suite passed `26/26`, and a direct diff between the two changelog paths was empty, so no task file was changed in response. Rerun the full gate only after the mirrored writes are quiescent. Evidence anchors: `test/integration/preamble-sync.test.ts` (search: `template and installed changelog.md match`), `.goat-flow/skill-docs/playbooks/changelog.md`, and `workflow/skills/playbooks/changelog.md`.
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

**Prevention:** Optional verification gets a separate status and cannot create degradation by absence alone. Name forbidden flags and pin each path. Evidence: `workflow/skills/goat-review/SKILL.md` (search: `Optional skip is not degradation`) and `test/contract/skill-hardening-review-3.test.ts` (search: `solely because the user declined`; search: `keeps an unselected optional Spec Drift pass out of review degradation`).

---

## Lesson: Depth headings do not create runtime stop boundaries

**Status:** active | **Created:** 2026-07-12

**What happened:** On 2026-07-12, goat-security Quick Scan entered a Full-only specialist phase and waited about eight minutes. On 2026-07-18, goat-debug Investigate made an explicit read-only scope wait at I1. In both cases, headings implied flow but did not define the runtime boundary.

**Prevention:** Every branch needs an explicit stop or continue rule plus a contract; headings are orientation, not control flow. Evidence: `workflow/skills/goat-security/SKILL.md` (search: `Quick-stop boundary`), `workflow/skills/goat-debug/SKILL.md` (search: `continue to I2 without waiting`), `test/contract/skill-hardening-security-1.test.ts` (search: `Quick Scan out of Full-only specialist work`), and `test/contract/skill-hardening-shared-2.test.ts` (search: `lets an explicit read-only investigation pass its scope checkpoint`).

---

## Lesson: A documentation pass can push a file past a size gate it was written to enforce

**Status:** active | **Created:** 2026-08-07
**Incident count:** 3 | **Latest occurrence:** 2026-08-10

**What happened:** Applying the mandatory comment standard to `scripts/check-gruff-warning-ratchet.mjs` grew it from 626 to 783 lines, past the 750-line `size.file-length` threshold. The warning-debt ratchet then reported its own checker as new debt on the very run that was meant to prove the release clean.

**Root cause:** I treated comment work as free of quality-gate consequences. Doc comments on every function, context lines on every branch, and null/empty meaning on every tag add real lines, so a file already near a size threshold crosses it.

**Recurrence 2026-08-10:** Expanding current hook-capability evidence pushed `.goat-flow/learning-loop/footguns/docs-and-crossrefs.md` to 40,372 bytes against the 40,000-byte bucket limit. Compressing the new entry below the existing ceiling preserved its decisions and semantic anchors without creating another retrieval bucket. Evidence anchors: `src/cli/stats/stats.ts` (search: `BUCKET_SIZE_WARN_BYTES`) and `.goat-flow/learning-loop/footguns/docs-and-crossrefs.md` (search: `Agent capability metadata goes stale when upstream docs add hooks`).

**Recurrence 2026-08-10 (playbook prose):** Adding a reader-selection section and an anti-template rule to `.goat-flow/skill-docs/playbooks/code-comments.md` took it from 2,856 to 3,180 words against the 3,000-word ADR-023 progressive cap. Trimming duplicate representation - a fractal summary restating the worked example, and a PHP class-file rule stated in four places - restored it to 2,983 with no rule lost. Evidence anchor: `test/contract/skill-hardening-contracts.test.ts` (search: `progressive reference packs stay within`).

**Recurrence 2026-08-12:** Recording two verification corrections pushed `.goat-flow/learning-loop/lessons/verification-preflight.md` to 40,736 bytes. `stats --check` stopped closeout; consolidating the new gate rule into its existing Prevention reduced the bucket to 39,999 bytes without dropping the decision or evidence anchor. Evidence: `.goat-flow/learning-loop/lessons/agent-evidence-claims.md` (search: `A predecessor may exempt one named RED fixture`).

**Prevention:** Before commenting a file that sits within about 20% of its size threshold, check the current count and plan the split first. Splitting by responsibility is the fix, never accepting the new finding: an oversized file created by the same change that added the gate is exactly what the gate exists to stop. Evidence anchors: `scripts/check-gruff-warning-ratchet.mjs` (search: `Release gate that stops reviewed Gruff warning debt`), `scripts/gruff-warning-ratchet-checks.mjs` (search: `The rules that decide whether Gruff warning debt regressed`), `scripts/ratchet-failure-report.mjs` (search: `Collects everything blocking a warning-ratchet run`).

---

## Lesson: A failed multi-file patch can preserve earlier edits

**Status:** active | **Created:** 2026-08-09
**Decision changed:** Inspect every target after a failed multi-file patch; never assume the operation was atomic.
**Trigger phase:** ACT
**Incident count:** 2 | **Latest occurrence:** 2026-08-09

**What happened:** During peer-plan synthesis, one patch updated the roadmap issue and provider-contract milestone, then failed when a later post-turn hunk used a near-match instead of the file's exact wording. The failure named only the unmatched hunk, which made the operation look rejected as a whole; a target-by-target read showed the earlier file edits had persisted.

**Recurrence:** While preparing the M00 rollback patch in disposable copies, a malformed Markdown-list hunk failed after earlier file hunks in the same request. A target-by-target diff found no retained edits this time. The patch surface has now shown both partial and atomic-looking failures, so inspection remains the recovery contract.

**Root cause:** I treated a multi-file patch as a transaction and reasoned from the final failing hunk instead of checking the state of every target. The retry therefore risked applying already-landed edits twice or building new hunks against stale bytes.

**Prevention:** Prefer one file or independently recoverable hunk group per patch when source is changing concurrently. After any patch failure, inspect timestamps and exact semantic anchors across every target before retrying, then generate the retry from current bytes. The affected artifacts were gitignored milestone files, so they are deliberately not cited as durable learning-loop anchors; the evidence was the failed patch result followed by the same-session target-by-target read.
