---
category: audit-contracts
last_reviewed: 2026-05-20
---

## Lesson: Audit check skip semantics need both unit and integration fixture updates

**Status:** active | **Created:** 2026-05-20

**What happened:** While making `instruction-file-skill-reference-pointer` fail when the shared reference/playbook pack is absent, the focused unit test was updated but the first full `npm test` run still failed four `test/integration/audit-build.test.ts` cases. The integration fixture still asserted `skillReferenceCheck.skip?.(ctx)` was `false` or `true`; the production check was now correctly non-skippable and returned `undefined`.

**Root cause:** I treated the unit audit report contract as the only caller. Integration tests also assert the lower-level `BuildCheck` shape, including optional `skip` behavior. Removing the skip gate also left unused directory constants that `npm run typecheck` caught before the full suite.

**Prevention:** When changing an audit check from optional/skippable to mandatory, grep for both the check id and `skip?.` before verification. Update unit report expectations and integration `BuildCheck` assertions in the same edit, then run `npm run typecheck` before `npm test`. Evidence anchors: `src/cli/audit/check-goat-flow.ts` (search: `instruction-file-skill-reference-pointer`), `test/unit/audit-command.test.ts` (search: `fails when the project has no skill-reference or skill-playbooks pack`), `test/integration/audit-build.test.ts` (search: `fails when the project has no shared reference/playbook pack`).

---

## Lesson: Additive audit report fields need renderer defaults

**Status:** active | **Created:** 2026-05-17

**What happened:** M09 added `AuditReport.enforcement` and updated the main audit fixtures, but the first full `npm test` run failed in an older contract fixture that called `renderAuditText` with a minimal report object lacking the new field. The new report producer was correct; the text renderer had become stricter than historical report-shaped fixtures.

**Root cause:** I treated an additive report field as universally present at every renderer call site. Tests had multiple report construction paths, and only the obvious unit helper was updated before the full suite.

**Prevention:** When adding fields to `AuditReport` or other shared CLI/dashboard payloads, grep for direct renderer/reader fixture construction and either update every fixture or make consumers default missing additive fields. Evidence anchors: `src/cli/audit/render.ts` (search: `Array.isArray(report.enforcement)`), `test/contract/command-phrases.test.ts` (search: `renderAuditText does not mention scan`).
