---
category: coordination
last_reviewed: 2026-08-20
---

**Scope:** Running work across multiple agents or phases - council findings that need normalising before they create work, where reviewers hallucinate, and phase totals that must derive from their breakdowns. Milestone state and effort accounting is [milestone-accounting.md](milestone-accounting.md).

## Lesson: Test cross-contamination via global env vars / module-level state silently flaps in parallel CI

**Status:** active | **Created:** 2026-05-25
**Decision changed:** Test platform-specific admission through injected discovery results, not shared process globals.
**Trigger phase:** VERIFY
**Incident count:** 2
**Latest occurrence:** 2026-08-06

**What happened (external — mini-swe-agent PR #755, merged 2026-02-19, plus the conftest fixture pattern):** Tests modifying global state via env vars contaminated each other when CI ran in parallel. Mini's fix in the upstream mini-swe-agent repo at tests/conftest.py (search: `GLOBAL_MODEL_STATS`) wraps tests that touch `GLOBAL_MODEL_STATS` (a module-level singleton) with a threading lock + reset before AND after each test. PR #755 specifically — "Fix tests because of env var overwrite" — addressed tests setting `MSWEA_DOCKER_EXECUTABLE`, `MSWEA_SILENT_STARTUP`, etc. leaking into siblings that depended on those vars being unset. The flakiness was rank-ordering-dependent and invisible until a CI run reordered the affected pair.

**Recurrence update (2026-08-06):** A Windows dry-run regression test temporarily rewrote `process.platform` and `PATH`, then skipped itself on native Windows. Gruff flagged both global-state mutation and conditional skipping. Replacing it with a pure adapter from `buildInstallerInvocation` to `managedSetupPreviewForInstallerLaunch` kept the production branch directly testable without changing shared process state.

**Root cause:** Globals are shared across the test process. Pytest's per-test isolation does not extend to module-level state. Without explicit teardown, any test that writes a global leaks to every subsequent test in the same process. Parallel test runners that share a process surface this faster.

**Goat-flow applicability:** vitest isolates per-file but not per-test for module-level state. Exposed surfaces: `process.env` mutations in CLI-option tests, singletons in `src/cli/server/` (WebSocket server, session managers, project registry), module-level caches in audit / quality (`let cached: X | undefined` at module scope).

**Prevention:**
1. Audit `src/` for module-level mutable state. For every test that touches one, add a fixture/beforeEach that resets it (mini's `reset_global_stats` is the model — threading lock + reset before AND after).
2. For env var-driven behavior, prefer explicit dependency injection in tests (`runWithEnv({ KEY: "value" }, () => { ... })`) over `process.env.KEY = "value"`. Injection auto-cleans; direct mutation does not.
3. When a test starts flapping rank-order-dependent, the root cause is almost always global state contamination — fix at the global, not at the test.

---

## Lesson: Phase 0 normalisation catches council false findings before they create work

**Status:** active | **Created:** 2026-05-01
**Merged:** 2026-08-20 - absorbed "AI council version-baseline claims are an axis where reviewers hallucinate" and "goat-flow correction loop runs at higher precision than council input" (one root cause: council output is unverified input).

**What happened:** A five-council synthesis (Claude x2, ChatGPT, Gemini, Codex) produced findings for the v1.4 programme. Phase 0 normalisation verified every factual claim before acting and corrected ~3 of ~19 findings - one false, one over-stated, and one guardrail-consistency question the programme document itself surfaced:
1. OP-5 claimed installed skills were at v1.3.1 and the review plan needed rebasing. Verification showed all six skills at v1.3.2 across all four parity surfaces; the review plan's baseline was correct and ~1 weekend of recomputation was avoided. The same wrong version appeared across multiple findings (CC-2, OP-5) - all five council members produced or passed the claim through unverified, making version baselines the axis where reviewers hallucinate most.
2. OP-7 claimed word budgets were a programme-wide crisis. Verification showed only goat-critique at the wall (3 words slack); goat-plan had 79 words of room and the other four skills 277-1191.

**Evidence:** Measured in the 2026-05-01 session with `wc -w`, `grep goat-flow-skill-version`, and `cmp`; the v1.4 programme notes that recorded the corrections were local working files and are not durable anchors. The blind-apply failure mode this guards against is recorded independently in `.goat-flow/learning-loop/lessons/review-feedback.md` (search: `Blindly applying review feedback without verifying findings`).

**Prevention:** Run a verification pass on any council- or multi-agent-derived findings before acting - this is a standing rule, not a per-programme choice (the original entry conditioned promotion on "if this pattern holds"; it held). Verify version claims with `grep goat-flow-skill-version`, word counts with `wc -w`, parity with `cmp`, and treat version-baseline verification as a standing checklist item. Council findings are inputs to verify, not evidence to trust; the correction rate (~3 of ~19 here) is what makes the verification step load-bearing rather than ceremony.

## Lesson: Programme forecast calibration - per-skill items dominate, a programme document halves interpretation stalls

**Status:** active | **Created:** 2026-05-01
**Merged:** 2026-08-20 - combined the CF-cardinality and Phase 2 execution calibration notes from the v1.4 programme.

**What happened:** Two calibration results from the v1.4 council programme. (1) Council synthesis estimated the CF item Phase C split at ~6 preamble / ~10 shared-vocab / ~6 per-skill; actual tagging of goat-plan's 19 CF items landed at 3 / 5 / 11. Plan-specific items (template rules, milestone formats, output checklists) don't generalise because they're tied to one skill's output structure, so the "single coordination pass replaces 22 patches" framing was directionally right but optimistic on volume. (2) Across 5 Phase 2 per-plan sessions, forecasts predicted ~4 open questions needing decisions; actual was 2 (both from critique, the most complex plan) - 0.33 questions/plan against a 1.0 forecast - because the coordinating programme document resolved most interpretation work before sessions started.

**Prevention:** Frame CF coordination as three categories of work, not three batches that ship together; expect per-skill items to dominate unless the CF source is genuinely cross-skill (evidence labelling, proof vocabulary). For council-derived improvement work, produce the coordinating programme document first and gate on it; when one precedes per-artifact updates, forecast interpretation challenges at 50% of the count initially identified.

## Lesson: Phase 3 verification catches state drift invisible to plan-level reasoning

**Status:** active | **Created:** 2026-05-01
**What happened:** Phase 3 verification ran `wc -w` and `git show` against live repo state and found two issues that five council passes and three Phase 2 sessions missed: (1) goat-critique SKILL.md was at 2532 words (32 over ADR-023's 2500 cap), caused by 15 commits made to main between Phase 0 and Phase 3 - not by this audit's work. (2) goat-review's internal version naming (v1.4.0/v1.5.0/v1.6.0) collided with the programme's atomic version sync (all skills bump to v1.4.0 at Phase A). Both required decisions and corrections to the programme document.
**Evidence:** Measured in the 2026-05-01 session; the programme notes and its Section 2.1 naming convention were local working files and are not durable anchors.
**Prevention:** Future programme-style improvement work should always end with a verification phase that reads live repo state, not just the artifacts produced. Plan-level reasoning operates on stated numbers; verification operates on measured numbers. The two diverge when the repo changes underneath the audit.

## Lesson: Verification phases must cross-reference between artifacts, not just check each internally

**Status:** active | **Created:** 2026-05-01 | **Incident count:** 2 | **Latest occurrence:** 2026-08-17

**What happened:** Phase 3 verification checked word counts, parity, rubric citations, npm test - all internal to individual files. It did not cross-reference programme document claims against plan content. Result: four residual inconsistencies survived Phase 3 and were caught by editorial review instead. Specifics: (1) qa score missing from programme cumulative table, (2) critique target "~95+" in programme vs 91 in plan, (3) OP-10/OP-12 Appendix A statuses stale, (4) review plan still used v1.4.0/v1.5.0/v1.6.0 labels that programme claimed were renamed to M1/M2/M3.

**Recurrence (2026-08-17):** Rerouting M45's secret-parser footgun from `hooks.md` to the owning `deny-secrets.md` bucket updated its read-first and task text but left Boundary Notes saying "hooks footgun." A targeted old-owner grep caught the stale wording after the internal plan and learning-loop checks were already green. Durable evidence anchors: `workflow/hooks/deny-dangerous/patterns-paths.sh` (search: `git_log_candidate_without_search_values`) and `.goat-flow/learning-loop/footguns/deny-secrets.md` (search: `Secret-path matching must distinguish search data from file operands`).

**Prevention:** Add "programme document claims match per-plan deliverables" as a verification check in future cycles. When an artifact changes owner, grep both the old path and its old prose label across every touched artifact; cross-document consistency is the gap between internal-file verification and audit completeness.

## Lesson: Phase totals must be derivable from phase breakdowns

**Status:** active | **Created:** 2026-05-01
**Decision changed:** Run the plan arithmetic gate immediately after writing estimates, then independently derive every ISSUE-level roll-up from the validated milestone headlines.
**Trigger phase:** VERIFY
**Incident count:** 7
**Latest occurrence:** 2026-08-17

**What happened:** Programme headline stated ~33 weekends (council's estimate). Phase breakdowns summed to ~26. The gap was unexplained - some combination of CF items, overhead, and double-counted shared infrastructure. The headline lost legitimacy when the math didn't add up.

**Recurrence 2026-08-04:** The quality-findings milestone declared 70 minutes as 45 product / 20 proof / 5 other, but its proof tasks summed to 28 minutes. `plans check` rejected the artifact with the category-overrun diagnostic; the estimate was corrected to 78 minutes before implementation continued. Evidence anchor: `src/cli/plans-check.ts` (search: `task estimates`).

**Recurrence 2026-08-07:** Strict plan validation confirmed every milestone's internal arithmetic, but I manually transcribed the M06-M12 sum as 13.25 hours. The validated headlines totalled 815 minutes, or about 13.6 hours. A separate cross-artifact arithmetic pass caught the mismatch before delivery.

**Recurrence 2026-08-09:** Expanding M03 for a runtime-hook repair added 20 product minutes and 20 proof minutes, but I initially left its headline split at 140 product / 110 proof. Strict validation reported counted totals of 160 / 130; the live estimate was corrected while the original 260-minute baseline stayed explicit in Forecast calibration. Evidence anchor: `src/cli/plans-check.ts` (search: `counted work`).

**Recurrence 2026-08-10:** A release plan used 15 work units and a 12.42-minute high rate, then manually recorded the high bound as 186 minutes. The deterministic ceiling was 187, so strict validation blocked closeout until the displayed range matched the formula. Evidence anchor: `src/cli/plans-effort.ts` (search: `forecast basis derives`).

**Recurrence 2026-08-14:** Reforecasting three downstream milestones used nearest-integer transcription for one or both bounds instead of the deterministic floor/ceiling rule. Strict validation derived `16-42`, `12-32`, and `15-39`, then blocked reconciliation because the plan displayed `17-41`, `13-32`, and `15-38`. The ISSUE roll-up also needed recomputation from `45-111` to `43-113` after the milestone ranges were corrected.

**Recurrence 2026-08-17:** M39 multiplied 10 work units by a 1.16-minute low rate but transcribed the range floor as 12. Strict validation derived 11 and rejected the plan until both the milestone and ISSUE roll-up used `11-72`. Evidence anchor: `src/cli/plans-effort.ts` (search: `forecast basis derives`).

**Prevention:** Programme documents should show effort accounting explicitly and derive each roll-up from the milestone headlines after strict validation. If two totals intentionally differ, name the accounting difference; do not transcribe a mental sum into the summary.

---
