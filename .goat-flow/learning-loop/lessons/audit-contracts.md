---
category: audit-contracts
last_reviewed: 2026-07-18
---

## Lesson: Artifact scanners need explicit mirror maps and command grammar controls

**Status:** active | **Created:** 2026-07-12

**What happened:** The first live M01 artifact-integrity audit failed two valid files after focused fixtures were green. References to the installed `.goat-flow/skill-docs/skill-quality-testing/README.md` were resolved by directory convention to a nonexistent canonical `skill-quality-testing/README.md`, even though the explicit mirror maps that installed README from `skill-quality-testing.md`. The removed-command scanner also treated prose saying "goat-flow check IDs" as an invocation of the retired `check` command.

**Root cause:** I validated common path and token shapes without pressure-testing the repository's exceptional source/install mapping or a producer-language prose control. The implementation had the authoritative mirror table and CLI registry available but used a naming convention and a broad word-boundary regex instead.

**Prevention:** Artifact reference resolution must consult the exact installed-to-canonical mirror map before applying path conventions. Removed-command checks must distinguish executable code-span/shell grammar from product prose, with paired positive and negative fixtures. Run the live combined audit after focused tests because real documentation supplies exceptions synthetic fixtures miss. Evidence anchors: `src/cli/audit/check-artifact-integrity.ts` (search: `SHARED_ARTIFACT_MIRRORS`), `src/cli/audit/check-factual-claims.ts` (search: `REMOVED_COMMAND_CHECKS`), and `test/integration/audit-drift-artifact-integrity.test.ts` (search: `resolves installed shared-document paths`).

---

## Lesson: Audit check skip semantics need both unit and integration fixture updates

**Status:** active | **Created:** 2026-05-20

**What happened:** While making `instruction-file-skill-docs-pointer` fail when the shared skill-docs/playbook pack is absent, the focused unit test was updated but the first full `npm test` run still failed four `test/integration/audit-build.test.ts` cases. The integration fixture still asserted `skillDocsCheck.skip?.(ctx)` was `false` or `true`; the production check was now correctly non-skippable and returned `undefined`.

**Root cause:** I treated the unit audit report contract as the only caller. Integration tests also assert the lower-level `BuildCheck` shape, including optional `skip` behavior. Removing the skip gate also left unused directory constants that `npm run typecheck` caught before the full suite.

**Prevention:** When changing an audit check from optional/skippable to mandatory, grep for both the check id and `skip?.` before verification. Update unit report expectations and integration `BuildCheck` assertions in the same edit, then run `npm run typecheck` before `npm test`. Evidence anchors: `src/cli/audit/check-goat-flow.ts` (search: `instruction-file-skill-docs-pointer`), `test/integration/audit-build.test.ts` (search: `fails when the project has no shared reference/playbook pack`).

**Recurrence update (2026-07-13):** M06 added two required session-README gitignore exceptions. The live audit passed, but the first integration run failed because `HEALTHY_GOAT_FLOW_GITIGNORE` and the audit-command project writer still modeled the old contract. Updating both healthy fixtures cleared the exact 95-test suite.

---

## Lesson: Additive audit report fields need renderer defaults

**Status:** active | **Created:** 2026-05-17

**What happened:** M09 added `AuditReport.enforcement` and updated the main audit fixtures, but the first full `npm test` run failed in an older contract fixture that called `renderAuditText` with a minimal report object lacking the new field. The new report producer was correct; the text renderer had become stricter than historical report-shaped fixtures.

**Root cause:** I treated an additive report field as universally present at every renderer call site. Tests had multiple report construction paths, and only the obvious unit helper was updated before the full suite.

**Prevention:** When adding fields to `AuditReport` or other shared CLI/dashboard payloads, grep for direct renderer/reader fixture construction and either update every fixture or make consumers default missing additive fields. Evidence anchors: `src/cli/audit/render.ts` (search: `Array.isArray(report.enforcement)`), `test/contract/command-phrases.test.ts` (search: `renderAuditText does not mention scan`).

---

## Lesson: Repair paths must come from target evidence, not rule provenance

**Status:** active | **Created:** 2026-07-14

**Decision changed:** Resolve repair files from failure copy, selected-agent detail, or one unambiguous target path before generic provenance. | **Trigger phase:** VERIFY

**What happened:** M24's first empty-target readiness run displayed `Create AGENTS.md (CLAUDE.md)`. The action named the Codex instruction file, but the citation came from a multi-agent provenance list and pointed at Claude's file.

**Root cause:** I treated the first provenance path as the user's repair location. Audit provenance can explain where a rule comes from or list every supported agent surface; neither proves which target file the selected user must change.

**Fix:** `blockerEvidencePath` now prefers a path named in the failure, then selected-agent structured detail, then exactly one target path. A regression fixture keeps `AGENTS.md` selected when provenance also lists `CLAUDE.md` and Copilot instructions.

**Prevention:** For user-facing remediation, test action text and evidence paths together on an empty selected-agent target. Never convert normative or multi-agent provenance into a repair path without target-specific disambiguation. Evidence anchors: `src/cli/diagnostics/readiness-report.ts` (search: `blockerEvidencePath`), `test/unit/readiness-report.test.ts` (search: `selects the target path named by the failure`).

---

## Lesson: Audit fixture expectations must follow detector semantics

**Status:** active | **Created:** 2026-05-27 | **Merged during:** M11 learning-loop consolidation

**What happened:** Historical scanner/rubric changes and current audit detector changes both invalidated "known failing" fixture expectations even when the implementation was correct. The failure mode recurs whenever a check is renamed, tightened, or moves responsibility to a different detector.

**Root cause:** Expected check ids were treated as stable facts instead of outputs of the current detector contract.

**Prevention:** For fixture-driven audit tests, reproduce the failing audit/check output first, capture the current check ids, then update test assertions and fixture metadata together. A healthy virtual filesystem must also satisfy every newly enforced content invariant; existence-only stubs are no longer healthy after a content detector lands. Do not trust older expected ids or fixture bodies after check-contract work. M12 recurrence anchor: `test/fixtures/projects/index.ts` (search: "healthyPlaybook").

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

---

## Lesson: Inverse metrics need monotonic boundary tests

**Status:** active | **Created:** 2026-07-18
**Decision changed:** When a score names an inverse quantity such as uncovered fraction, verify both endpoint meaning and monotonic direction before trusting the formula.
**Trigger phase:** VERIFY

**What happened:** goat-qa A4 called its multiplier `uncovered fraction` but assigned NONE=0 and BEHAVIOURAL=1.0. The formula therefore ranked a CRITICAL fully covered path above a HIGH path with no coverage. Two isolated RED evaluators preserved the bad result because the explicit arithmetic and release-pressure framing outweighed the contradictory metric name.

**Root cause:** The priority matrix classified buckets correctly, so tests covered bucket membership without checking the independent numeric ranking's direction. The prose label and constants could disagree while every matrix assertion remained green.

**Prevention:** Pin inverse metrics with endpoint and monotonic assertions: no coverage must maximize uncovered fraction, full behavioural coverage must make it zero, and every intermediate level must decrease as coverage improves. Re-run application scenarios with varied risk/coverage combinations rather than checking one literal sequence. Evidence: `workflow/skills/goat-qa/SKILL.md` (search: `Risk × uncovered fraction`), `test/contract/skill-hardening-contracts.test.ts` (search: `uncovered fraction must decrease`), and local receipt `.goat-flow/logs/sessions/2026-07-18-goat-qa-tdd.md`.

---

## Lesson: Mandatory specialist phases need admission and unavailable fallbacks

**Status:** active | **Created:** 2026-07-18
**Decision changed:** A required specialist phase must define admissible independence, authorization, return shape, and non-blocking unavailable behavior beside the trigger.
**Trigger phase:** SCOPE

**What happened:** goat-security required a narrow specialist cross-check when Full Assessment triggers fired but did not define who qualified, whether delegation was authorized, what evidence the specialist returned, or what happened when none was available. In isolated RED runs, one evaluator counted same-context rereading as the specialist while another blocked release indefinitely.

**Root cause:** The word `required` supplied urgency without an executable orchestration contract. Agents filled the four missing decisions differently under release pressure, so the same prose permitted both false independence and unnecessary blocking.

**Prevention:** Put admission and failure behavior next to every mandatory orchestration trigger: independent tool/reviewer, named failure class, structured return, current-session authorization, bounded attempts, and an explicit unavailable outcome that preserves uncertainty without waiting. Evidence: `workflow/skills/goat-security/SKILL.md` (search: `An admissible specialist`; search: `specialist-unavailable`), `test/contract/skill-hardening-contracts.test.ts` (search: `defines goat-security specialist admission and unavailable fallback`), and local receipt `.goat-flow/logs/sessions/2026-07-18-goat-security-tdd.md`.
