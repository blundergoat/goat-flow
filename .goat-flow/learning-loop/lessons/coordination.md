---
category: coordination
last_reviewed: 2026-08-14
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

**Created:** 2026-05-01
**What happened:** A five-council synthesis (Claude x2, ChatGPT, Gemini, Codex) produced findings for the v1.4 programme. Phase 0 normalisation verified every factual claim before acting. Two corrections surfaced:
1. OP-5 claimed installed skills were at v1.3.1 and the review plan needed rebasing. Verification showed all six skills at v1.3.2 across all four parity surfaces. The review plan's baseline was correct. ~1 weekend of recomputation work avoided.
2. OP-7 claimed word budgets were a programme-wide crisis. Verification showed only goat-critique is at the wall (3 words slack). goat-plan has 79 words of room. The other four skills have 277-1191 words of slack.
**Evidence:** The v1.4 programme notes (search: `Finding investigated and rejected: OP-5`) document both corrections with `wc -w` and `grep` output from the verification session.
**Prevention:** Always run Phase 0 normalisation on council synthesis findings before acting on them. Verify version claims with `grep goat-flow-skill-version`, word counts with `wc -w`, and parity with `cmp`. Council findings are inputs to verify, not evidence to trust.

## Lesson: AI council version-baseline claims are an axis where reviewers hallucinate

**Created:** 2026-05-01
**What happened:** The council synthesis stated "installed skills are v1.3.1" across multiple findings (CC-2, OP-5). All five council members either produced or passed through this claim without verification. The actual version was v1.3.2 - a one-increment error that would have cascaded into unnecessary score recomputation across the review plan.
**Prevention:** When a council pass produces version-number claims, Phase 0 must verify them against the actual codebase. Version numbers are cheap to check (`grep goat-flow-skill-version`) and expensive to get wrong (downstream score computations, rebase work). Add "version baseline verification" as a standing Phase 0 checklist item for future council synthesis passes.

## Lesson: goat-flow correction loop runs at higher precision than council input

**Created:** 2026-05-01
**What happened:** Across Phase 0 and Phase 1 of the v1.4 programme, the framework's structured intake filtered three corrections from council input: one false finding (OP-5), one over-stated finding (OP-7), and one guardrail-consistency question (critique score gap) that the programme document itself surfaced. The correction rate (~3 findings corrected out of ~19) suggests the council pass produces useful but noisy input, and the Phase 0 verification step is load-bearing infrastructure, not ceremony.
**Prevention:** If this pattern holds across Phase 2 per-plan updates, promote Phase 0 verification from "v1.4 programme requirement" to "standing requirement for any council-derived improvement work." The cost of Phase 0 (~1 weekend) is small relative to the rework it prevents.

## Lesson: CF coordination cardinality forecast was directionally correct but per-skill bucket was larger than expected

**Created:** 2026-05-01
**What happened:** Council synthesis estimated CF item Phase C split at ~6 preamble / ~10 shared-vocab / ~6 per-skill. Actual tagging of goat-plan's 19 CF items landed at 3 preamble / 5 shared-vocab / 11 per-skill. Plan-specific items (template rules, milestone formats, output checklists) don't generalise because they're tied to plan's specific output structure. The "single coordination pass replaces 22 patches" framing was directionally right but optimistic on volume - more work happens inside individual plan ships than as a coordinated batch.
**Prevention:** When forecasting CF coordination, frame as "3 categories of work" rather than "3 batches that ship together." Per-skill items will dominate unless the CF source is genuinely cross-skill (e.g. evidence labelling, proof vocabulary).

## Lesson: Phase 2 per-plan execution averaged better than forecast when programme document resolved ambiguity upfront

**Created:** 2026-05-01
**What happened:** Across 5 Phase 2 per-plan sessions, forecasts predicted a total of ~4 open questions requiring decisions. Actual: 2 (both from critique, the most complex plan). Debug, plan, qa, and review all ran with zero open questions. The programme document (Phase 1) resolved most interpretation work before sessions started, converting per-plan updates into mechanical execution.
**Prevention:** Validates the "programme document before per-plan work" sequencing. For future council-derived improvement work, always produce the coordinating programme document first and gate on it before touching individual plans. The cost is one extra phase; the payoff is per-plan sessions that run without interpretation stalls. Calibration: when a programme document precedes per-artifact updates, forecast at 50% of the interpretation challenges initially identified (Phase 2 averaged 0.33 questions/plan vs forecast 1.0).

## Lesson: Phase 3 verification catches state drift invisible to plan-level reasoning

**Created:** 2026-05-01
**What happened:** Phase 3 verification ran `wc -w` and `git show` against live repo state and found two issues that five council passes and three Phase 2 sessions missed: (1) goat-critique SKILL.md was at 2532 words (32 over ADR-023's 2500 cap), caused by 15 commits made to main between Phase 0 and Phase 3 - not by this audit's work. (2) goat-review's internal version naming (v1.4.0/v1.5.0/v1.6.0) collided with the programme's atomic version sync (all skills bump to v1.4.0 at Phase A). Both required decisions and corrections to the programme document.
**Evidence:** The v1.4 programme notes (search: `Corrected post-Phase 3 verification`) document the word-count correction. Version naming convention documented in Section 2.1.
**Prevention:** Future programme-style improvement work should always end with a verification phase that reads live repo state, not just the artifacts produced. Plan-level reasoning operates on stated numbers; verification operates on measured numbers. The two diverge when the repo changes underneath the audit.

## Lesson: Verification phases must cross-reference between artifacts, not just check each internally

**Created:** 2026-05-01
**What happened:** Phase 3 verification checked word counts, parity, rubric citations, npm test - all internal to individual files. It did not cross-reference programme document claims against plan content. Result: four residual inconsistencies survived Phase 3 and were caught by editorial review instead. Specifics: (1) qa score missing from programme cumulative table, (2) critique target "~95+" in programme vs 91 in plan, (3) OP-10/OP-12 Appendix A statuses stale, (4) review plan still used v1.4.0/v1.5.0/v1.6.0 labels that programme claimed were renamed to M1/M2/M3.
**Prevention:** Add "programme document claims match per-plan deliverables" as a verification check in future cycles. Cross-document consistency is the gap between internal-file verification and audit completeness.

## Lesson: Phase totals must be derivable from phase breakdowns

**Status:** active | **Created:** 2026-05-01
**Decision changed:** Run the plan arithmetic gate immediately after writing estimates, then independently derive every ISSUE-level roll-up from the validated milestone headlines.
**Trigger phase:** VERIFY
**Incident count:** 6
**Latest occurrence:** 2026-08-10

**What happened:** Programme headline stated ~33 weekends (council's estimate). Phase breakdowns summed to ~26. The gap was unexplained - some combination of CF items, overhead, and double-counted shared infrastructure. The headline lost legitimacy when the math didn't add up.

**Recurrence 2026-08-04:** The quality-findings milestone declared 70 minutes as 45 product / 20 proof / 5 other, but its proof tasks summed to 28 minutes. `plans check` rejected the artifact with the category-overrun diagnostic; the estimate was corrected to 78 minutes before implementation continued. Evidence anchor: `src/cli/plans-check.ts` (search: `task estimates`).

**Recurrence 2026-08-07:** Strict plan validation confirmed every milestone's internal arithmetic, but I manually transcribed the M06-M12 sum as 13.25 hours. The validated headlines totalled 815 minutes, or about 13.6 hours. A separate cross-artifact arithmetic pass caught the mismatch before delivery.

**Recurrence 2026-08-09:** Expanding M03 for a runtime-hook repair added 20 product minutes and 20 proof minutes, but I initially left its headline split at 140 product / 110 proof. Strict validation reported counted totals of 160 / 130; the live estimate was corrected while the original 260-minute baseline stayed explicit in Forecast calibration. Evidence anchor: `src/cli/plans-check.ts` (search: `counted work`).

**Recurrence 2026-08-10:** A release plan used 15 work units and a 12.42-minute high rate, then manually recorded the high bound as 186 minutes. The deterministic ceiling was 187, so strict validation blocked closeout until the displayed range matched the formula. Evidence anchor: `src/cli/plans-effort.ts` (search: `forecast basis derives`).

**Recurrence 2026-08-14:** Reforecasting three downstream milestones used nearest-integer transcription for one or both bounds instead of the deterministic floor/ceiling rule. Strict validation derived `16-42`, `12-32`, and `15-39`, then blocked reconciliation because the plan displayed `17-41`, `13-32`, and `15-38`. The ISSUE roll-up also needed recomputation from `45-111` to `43-113` after the milestone ranges were corrected.

**Prevention:** Programme documents should show effort accounting explicitly and derive each roll-up from the milestone headlines after strict validation. If two totals intentionally differ, name the accounting difference; do not transcribe a mental sum into the summary.

---

