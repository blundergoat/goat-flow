---
category: coordination
last_reviewed: 2026-09-05
---

**Scope:** Running work across multiple agents or phases - council findings that need normalising before they create work, the version baselines where reviewers hallucinate, and cross-artifact verification. Milestone state, effort accounting, and phase-total arithmetic are [milestone-accounting.md](milestone-accounting.md).

## Lesson: Test cross-contamination via global env vars / module-level state silently flaps in parallel CI

**Status:** active | **Created:** 2026-05-25 | **Evidence:** EXTERNAL_REFERENCE
**Decision changed:** Test platform-specific admission through injected discovery results, not shared process globals.
**Trigger phase:** ACT
**Caught at:** VERIFY
**Incident count:** 2 | **Latest occurrence:** 2026-08-06

**Prevention:** Prefer explicit injection over mutating shared process state in a test; a helper that takes the value and restores it afterwards cleans up on every path, while `process.env.KEY = "value"` does not. For any module-level mutable value a test touches, reset it in setup and teardown rather than trusting test order. If flakiness depends on rank order, fix the shared global rather than the test. In this repo the exposed surfaces are `process.env` mutations in CLI-option tests, singletons under `src/cli/server/` such as the WebSocket server, session managers, and project registry, and module-level caches in audit and quality declared as `let cached: X | undefined`.

**Applicability here:** `scripts/run-tests.mjs` drives `node --test`, which runs each test file in its own process, so a leaked global cannot cross files; it is shared by every test inside one file, which is where this class bites. Evidence anchors: `package.json` (search: `"test:fast": "node scripts/run-tests.mjs fast"`), `scripts/run-tests.mjs` (search: `listTestFiles`).

**What happened:** This entry records an external incident rather than a goat-flow one. In the upstream mini-swe-agent repository, PR #755 "Fix tests because of env var overwrite" (merged 2026-02-19) fixed tests that set `MSWEA_DOCKER_EXECUTABLE`, `MSWEA_SILENT_STARTUP`, and similar variables and leaked them into siblings that depended on those variables being unset. The same repository's conftest fixture wraps tests touching the module-level `GLOBAL_MODEL_STATS` singleton with a threading lock plus a reset before and after each test. The flakiness was rank-order dependent and invisible until a CI run reordered the affected pair.

**Root cause:** Globals are shared across a test process, and per-test isolation does not extend to module-level state, so any test that writes a global leaks to every later test in the same process.

**Recurrence 2026-08-06:** A Windows dry-run regression test rewrote `process.platform` and `PATH`, then skipped itself on native Windows; Gruff flagged both the global mutation and the conditional skip. A pure adapter from `buildInstallerInvocation` to `managedSetupPreviewForInstallerLaunch` kept the production branch directly testable without touching shared process state.

---

## Lesson: Phase 0 normalisation catches council false findings before they create work

**Status:** active | **Created:** 2026-05-01
**Merged:** 2026-08-20 - absorbed "AI council version-baseline claims are an axis where reviewers hallucinate" and "goat-flow correction loop runs at higher precision than council input"; one root cause, council output is unverified input.

**Prevention:** Run a verification pass on any council or multi-agent finding before acting; this is a standing rule, not a per-programme choice. Verify version claims with a direct search for the version field, word counts with `wc -w`, and parity with `cmp`, and keep version-baseline verification on the checklist because that is the axis reviewers get wrong most. Council findings are inputs to verify, and the correction rate of roughly 3 in 19 here is what makes the step load-bearing rather than ceremony.

**What happened:** A five-council synthesis produced findings for the v1.4 programme, and Phase 0 corrected about three of nineteen. OP-5 claimed installed skills were at v1.3.1 and the review plan needed rebasing; verification showed all six skills at v1.3.2 across all four parity surfaces, so the baseline was correct and about a weekend of recomputation was avoided. The same wrong version appeared in two findings, produced or passed through unverified by all five members. OP-7 claimed word budgets were a programme-wide crisis; only goat-critique was at the wall with 3 words of slack, while goat-plan had 79 and the other four had 277 to 1191.

**Evidence:** Measured in the 2026-05-01 session with `wc -w`, a skill-version search, and `cmp`; the programme notes recording the corrections were local working files and are not durable anchors. The blind-apply failure this guards against is recorded in `.goat-flow/learning-loop/lessons/review-feedback.md` (search: `Blindly applying review feedback without verifying findings`).

## Lesson: Programme forecast calibration - per-skill items dominate, a programme document halves interpretation stalls

**Status:** active | **Created:** 2026-05-01
**Merged:** 2026-08-20 - combined the CF-cardinality and Phase 2 execution calibration notes from the v1.4 programme.

**Prevention:** Frame cross-file coordination as three categories of work rather than three batches that ship together, and expect per-skill items to dominate unless the source is genuinely cross-skill, such as evidence labelling or proof vocabulary. For council-derived improvement work, produce the coordinating programme document first and gate on it; when one precedes per-artifact updates, forecast interpretation challenges at half the count initially identified.

**What happened:** Two calibration results came out of the v1.4 programme. Council synthesis estimated goat-plan's Phase C split at about 6 preamble, 10 shared-vocabulary, and 6 per-skill items; actual tagging of its 19 items landed at 3, 5, and 11, because plan-specific items such as template rules, milestone formats, and output checklists are tied to one skill's output structure. Across five Phase 2 sessions, forecasts predicted about 4 open questions each and the actual was 2 in total, both from the most complex plan, because the coordinating document resolved most interpretation work before the sessions started.

## Lesson: Phase 3 verification catches state drift invisible to plan-level reasoning

**Status:** active | **Created:** 2026-05-01

**Prevention:** End programme-style improvement work with a verification phase that reads live repository state rather than only the artifacts produced. Plan-level reasoning operates on stated numbers and verification operates on measured ones, and the two diverge when the repo changes underneath the audit.

**What happened:** Phase 3 verification ran `wc -w` and `git show` against live state and found two issues that five council passes and three Phase 2 sessions missed: goat-critique's skill file was at 2532 words, 32 over the ADR-023 cap, caused by 15 commits made to main between Phase 0 and Phase 3 rather than by the audit's own work; and goat-review's internal version naming collided with the programme's atomic version sync. Both required corrections to the programme document.

**Evidence:** Measured in the 2026-05-01 session; the programme notes were local working files and are not durable anchors.

## Lesson: Verification phases must cross-reference between artifacts, not just check each internally

**Status:** active | **Created:** 2026-05-01
**Incident count:** 2 | **Latest occurrence:** 2026-08-17

**Prevention:** Add "programme document claims match per-plan deliverables" as a verification check. When an artifact changes owner, grep both the old path and its old prose label across every touched artifact; cross-document consistency is the gap between internal-file verification and audit completeness.

**What happened:** Phase 3 verification checked word counts, parity, rubric citations, and `npm test`, all internal to individual files, without cross-referencing programme claims against plan content. Four residual inconsistencies survived and were caught by editorial review instead: a missing qa score in the cumulative table, a critique target of "~95+" against 91 in the plan, stale appendix statuses, and a review plan still using version labels the programme claimed were renamed.

**Recurrence 2026-08-17:** Rerouting M45's secret-parser footgun to its owning bucket updated the read-first and task text but left Boundary Notes saying "hooks footgun"; a targeted old-owner grep caught the stale wording after the internal plan and learning-loop checks were green. `workflow/hooks/deny-dangerous/patterns-paths.sh` (search: `git_log_candidate_without_search_values`), `.goat-flow/learning-loop/footguns/deny-secrets.md` (search: `Secret-path matching must distinguish search data from file operands`).
