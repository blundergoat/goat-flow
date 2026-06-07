---
category: audit-contracts
last_reviewed: 2026-05-31
---

## Lesson: Audit check skip semantics need both unit and integration fixture updates

**Status:** active | **Created:** 2026-05-20

**What happened:** While making `instruction-file-skill-docs-pointer` fail when the shared skill-docs/playbook pack is absent, the focused unit test was updated but the first full `npm test` run still failed four `test/integration/audit-build.test.ts` cases. The integration fixture still asserted `skillDocsCheck.skip?.(ctx)` was `false` or `true`; the production check was now correctly non-skippable and returned `undefined`.

**Root cause:** I treated the unit audit report contract as the only caller. Integration tests also assert the lower-level `BuildCheck` shape, including optional `skip` behavior. Removing the skip gate also left unused directory constants that `npm run typecheck` caught before the full suite.

**Prevention:** When changing an audit check from optional/skippable to mandatory, grep for both the check id and `skip?.` before verification. Update unit report expectations and integration `BuildCheck` assertions in the same edit, then run `npm run typecheck` before `npm test`. Evidence anchors: `src/cli/audit/check-goat-flow.ts` (search: `instruction-file-skill-docs-pointer`), `test/integration/audit-build.test.ts` (search: `fails when the project has no shared reference/playbook pack`).

---

## Lesson: Additive audit report fields need renderer defaults

**Status:** active | **Created:** 2026-05-17

**What happened:** M09 added `AuditReport.enforcement` and updated the main audit fixtures, but the first full `npm test` run failed in an older contract fixture that called `renderAuditText` with a minimal report object lacking the new field. The new report producer was correct; the text renderer had become stricter than historical report-shaped fixtures.

**Root cause:** I treated an additive report field as universally present at every renderer call site. Tests had multiple report construction paths, and only the obvious unit helper was updated before the full suite.

**Prevention:** When adding fields to `AuditReport` or other shared CLI/dashboard payloads, grep for direct renderer/reader fixture construction and either update every fixture or make consumers default missing additive fields. Evidence anchors: `src/cli/audit/render.ts` (search: `Array.isArray(report.enforcement)`), `test/contract/command-phrases.test.ts` (search: `renderAuditText does not mention scan`).

---

## Lesson: Audit fixture expectations must follow detector semantics

**Status:** active | **Created:** 2026-05-27 | **Merged during:** M11 learning-loop consolidation

**What happened:** Historical scanner/rubric changes and current audit detector changes both invalidated "known failing" fixture expectations even when the implementation was correct. The failure mode recurs whenever a check is renamed, tightened, or moves responsibility to a different detector.

**Root cause:** Expected check ids were treated as stable facts instead of outputs of the current detector contract.

**Prevention:** For fixture-driven audit tests, reproduce the failing audit/check output first, capture the current check ids, then update test assertions and fixture metadata together. Do not trust older expected ids after check-contract work.

---

## Lesson: Generic skill quality rules must be portable outside goat-flow

**Status:** active | **Created:** 2026-05-27 | **Merged during:** M11 learning-loop consolidation

**What happened:** The skill-quality evaluator treated `.goat-flow/skill-docs/skill-preamble.md` and the goat-flow Proof Gate as universal requirements, then told uploaded standalone skills to inherit them. The user objected: external skills may never run inside goat-flow.

**Root cause:** The quality rules mixed installed goat-flow skills with generic uploaded/non-goat-flow skills.

**Prevention:** Every generic skill-quality rule must be satisfiable by a standalone skill with no goat-flow files present. Framework inheritance can be credited only for installed artifact paths that actually compose the shared references. Evidence anchors: `src/cli/quality/skill-quality-metrics.ts` (search: `no prerequisites or operating context`) and `src/cli/quality/skill-quality-upload.ts` (search: `standalone artifact`).

---

## Lesson: Quality-report recommendations need ADR reconciliation before gate changes

**Status:** active | **Created:** 2026-05-27 | **Merged during:** M11 learning-loop consolidation

**What happened:** Four same-agent harness quality reports correctly observed that several concern signals were partly structural, then suggested making missing post-turn hooks, task-state semantics, or learning-loop capture hard failures. Current ADRs and lessons showed some of those weak signals were deliberate product contracts.

**Root cause:** Quality reports detect weak presentation, but they do not automatically know which non-gating limits are intentional.

**Prevention:** Before implementing recommendations that change audit status, scoring, or setup gates, reconcile the suggestion against current ADRs and lessons. If the report is right about presentation but wrong about gating, preserve the pass/fail contract and add an explicit limit, warning, or prompt note instead. Evidence anchors: `src/cli/audit/audit.ts` (search: `addNonGatingEvidenceLimits`) and `src/cli/prompt/compose-quality-common.ts` (search: `metrics=${concern.metrics}`).
