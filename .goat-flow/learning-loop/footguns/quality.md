---
category: quality
last_reviewed: 2026-09-05
---

## Footgun: Audit score tempering fields must survive every renderer

**Status:** active | **Created:** 2026-05-19 | **Evidence:** ACTUAL_MEASURED

**Prevention:** When adding or changing a non-gating audit caveat, update every consumer in the same patch: core type, JSON reader types, text and Markdown renderer, dashboard reader, prompt summary, and at least one unit test that fails if the caveat disappears from a human-facing surface.

**Symptoms:** A harness concern truthfully passes but still needs a visible caveat such as "Verification has no post-turn hook evidence". A renderer, dashboard reader, or prompt summary that drops `AuditConcern.limits` shows a clean PASS/100 while the JSON contract carries the caveat.

**Why it happens:** Audit output fans out through parallel consumers, and a field that tempers a score is load-bearing even though it is non-gating.

**Evidence:** `src/cli/audit/types.ts` (search: `limits: string[]`); `src/cli/audit/render.ts` (search: `Limit:`); `src/dashboard/dashboard-readers.ts` (search: `limits: readStringArray`); `src/cli/prompt/compose-quality-common.ts` (search: `limits: ${concern.limits.join`).

## Footgun: Unsupported runtime capabilities must be skipped, not scored missing

**Status:** active | **Created:** 2026-06-11 | **Evidence:** ACTUAL_MEASURED

**Prevention:** When an audit check depends on a runtime capability, use manifest-backed `supports*` facts to choose between fail and skip. Never award a neutral pass for unavailable capability evidence, and keep a fixture proving the same missing state still fails for a supporting agent.

**Symptoms:** A concern stays capped below 100 for an agent after all fixable setup work is done. Copilot declares `hook_events.post_turn: null`, yet `post-turn-hook-integrity` once lowered its Verification score to 75.

**Why it happens:** Missing evidence and not-applicable evidence look identical unless the check consults capability metadata. A skip stays out of the concern denominator; a neutral pass inflates evidence; a failure punishes an unfixable gap.

**Evidence:** `workflow/manifest.json` (search: `"post_turn": null`); `src/cli/agents/registry.ts` (search: `supportsPostTurnHook`); `src/cli/audit/harness/check-verification.ts` (search: `supportsPostTurnHook === false`); `test/unit/audit-command/scoring-model.test.ts` (search: `skips post-turn hook integrity for agents without a post-turn hook event`) keeps Copilot at 100 while supporting-agent no-hook and masked-hook fixtures keep the 25-point loss.

## Footgun: Structural validation passes while content is still unanswerable

**Status:** active | **Created:** 2026-05-26 | **Evidence:** OBSERVED

**Prevention:** For any audit that gates "ready" on an artifact, pick one content marker (`?`, `TBD`, `Answer:`, `Resolved:`) and count unresolved instances as a finding separate from structural integrity, so a valid spec with five open questions surfaces `unresolved-content: 5` beside the green structural result and re-runs stay resumable. When goat-flow's audit is green but a downstream agent still cannot proceed, capture the missing content check as a new deterministic check before calling it user error.

**Symptoms:** Every required section is present and every structural check is green, but the artifact still holds unanswered questions or placeholder values, so a fresh agent cannot proceed. The audit signal was true and unhelpful.

**Why it happens:** Structural checks are cheap and deterministic, so they accumulate first; content checks need domain-specific markers inside sections. `src/cli/audit/check-goat-flow.ts` (search: `16 setup-scope checks`) asserts presence of `.goat-flow/architecture.md`, `code-map.md`, and siblings without reading them, and milestone files under `.goat-flow/plans/**` are not inspected at all. `src/cli/audit/check-content-quality.ts` (search: `runContentQualityChecks`) is the deterministic layer that owns such markers.

**Evidence:** External: `kennyjpowers/claude-flow` PR #6 ("Feat: spec open questions workflow", merged 2025-11-22) added a command whose only job is to find unresolved `?` questions inside an otherwise valid spec, detecting resolved ones by `Answer:` presence; its specification (search: `only checks structural completeness (18 required sections), not whether open questions have been answered. There's a gap between "structurally valid" and "implementation-ready."`) states the gap. Related local rule: `.goat-flow/learning-loop/patterns/verification.md` (search: `Non-gating audit gaps belong in explicit limits`). The tempering-fields entry above protects caveats that exist; this entry is about caveats that should exist at all.

## Footgun: Audit checks must not prescribe machine-specific shared content

**Status:** active | **Created:** 2026-05-27 | **Evidence:** ACTUAL_MEASURED

**Prevention:** Before adding an audit check, ask whether the user can satisfy it with content that stays true across machines and checkouts. If not, redesign the check or its remediation wording before shipping.

**Symptoms:** A deterministic check is satisfiable but pushes users toward committed content that is wrong for other developers, machines, or checkouts.

**Why it happens:** The original workspace-boundary guidance encouraged hardcoded absolute paths in version-controlled instruction files, which made them stale anywhere except the author's checkout.

**Evidence:** `.goat-flow/learning-loop/decisions/ADR-026-keep-workspace-boundary-path-agnostic.md` (search: `path-agnostic`) keeps the boundary concept, requires portable remediation, and moves current paths into runtime prompts.

## Footgun: Advisory warnings without enforcement train users to ignore output

**Status:** active | **Created:** 2026-05-27 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Optional missing metadata remains visible in structured facts; warnings are reserved for malformed supplied values.
**Trigger phase:** SCOPE
**Caught at:** VERIFY
**Incident count:** 2
**Latest occurrence:** 2026-07-17

**Prevention:** An advisory warning needs an enforcement timeline, a migration path, or removal. A warning that fires on 100% of the corpus is not a safety net.

**Symptoms:** A command prints the same wall of warnings on every run; they never fail the gate and have no migration path, so users and agents scroll past them, including the ones that will matter.

**Why it happens:** Metadata warnings are easy to add, and without backfill or a deadline the stream becomes permanent noise.

**Evidence:** `stats --check` once warned for every ADR missing optional Author(s) and Ticket/Context fields; the pipeline is anchored at `src/cli/stats/stats.ts` (search: `Collect advisory learning-loop warnings`), and `.goat-flow/learning-loop/decisions/README.md` (search: `Author(s):`) still recommends the metadata without forcing warnings. **Recurrence 2026-07-17:** `stats --check` passed while emitting 35 warning groups for 342 missing optional `Decision changed` values; `hasDecisionChangedGuidance` stays in JSON and absence-only warnings were removed from `src/cli/stats/stats.ts` (search: `describeMemoryQualityIssues`).

---

## Resolved Entries

> Historical record. These entries are no longer active traps.

## Footgun: CI gates run only on pull_request, so direct pushes and merges bypass format/lint/test enforcement

**Status:** resolved | **Created:** 2026-07-04 | **Resolved:** 2026-07-04 | **Evidence:** ACTUAL_MEASURED
**hallucination-risk:** high

**Resolution:** `.github/workflows/ci.yml` (search: `push:`) declares both `push` and `pull_request` triggers for `[main, dev]` since 2026-07-04, and the 17 stale files were formatted in the same change; preflight returned `PASS 75 checks`.

**Original symptoms:** `bash scripts/preflight-checks.sh` failed on a clean `dev` checkout with `Prettier (17 unformatted files)` last touched weeks earlier while CI was green. The workflow had only a `pull_request` trigger, so direct commits to `main` or `dev` and merge commits never ran `npm run format:check`, shellcheck, or tests. The step (search: `npm run format:check`) existed the whole time; a reviewer who read the steps concluded CI enforced formatting, and a quality assessment that saw the failure claimed no enforcement point existed.

**Prevention retained:** When verifying a CI enforcement claim, read the workflow's `on:` block, not only its steps; a present gate step proves nothing about when it runs.

## Footgun: Metric checks inflated harness concern scores to 100% even when the capability was absent

**Status:** resolved | **Created:** 2026-04-30 | **Resolved:** 2026-04-30 | **Evidence:** ACTUAL_MEASURED

**Resolution:** Three layers were fixed separately. `computeHarness` in `src/cli/audit/audit.ts` (search: `counts[check.concern].total++`) treats metric-type degraded evidence as score-only; `agentScore()` in `home.html`, `quality.html`, and `setup.html` counts score-only metric failures in dashboard percentages and labels them warnings; `buildScope` in `src/cli/audit/audit.ts` (search: `impact === "scope-fail"`) keeps score-only failures out of the scope failure filter, so a failing metric no longer flips `harness.status` and `overall.status` to fail.

**Original symptoms:** `audit --harness` reported Verification and Recovery at 100 while its own findings said "no structured toolchain.test configured" and "26 milestone files at 0%"; all four quality-assessment agents named it the top structural flaw across 16 reports. The `AuditConcern` contract already separated metric counts from gating checks, but the score and scope calculations lacked their own handling.

**Prevention retained:** The metric contract has three enforcement points: concern score, dashboard display, and scope status. `integrity` gates status, `advisory` gates status unless acknowledged, `metric` lowers scores but never creates a scope failure. Verify that check type and impact are intentional when adding harness checks.
