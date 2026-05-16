---
category: audit-contracts
last_reviewed: 2026-05-17
---

## Lesson: Additive audit report fields need renderer defaults

**Status:** active | **Created:** 2026-05-17

**What happened:** M09 added `AuditReport.enforcement` and updated the main audit fixtures, but the first full `npm test` run failed in an older contract fixture that called `renderAuditText` with a minimal report object lacking the new field. The new report producer was correct; the text renderer had become stricter than historical report-shaped fixtures.

**Root cause:** I treated an additive report field as universally present at every renderer call site. Tests had multiple report construction paths, and only the obvious unit helper was updated before the full suite.

**Prevention:** When adding fields to `AuditReport` or other shared CLI/dashboard payloads, grep for direct renderer/reader fixture construction and either update every fixture or make consumers default missing additive fields. Evidence anchors: `src/cli/audit/render.ts` (search: `const enforcement = report.enforcement ?? []`), `test/contract/command-phrases.test.ts` (search: `renderAuditText does not mention scan`).
