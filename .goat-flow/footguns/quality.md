---
category: quality
last_reviewed: 2026-04-18
---

## Footgun: Quality reviews disappear unless the response is captured

**Status:** active | **Created:** 2026-04-18 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A quality review happened, but the next session has no prior same-agent context, `goat-flow quality history` reports no saved runs, and `goat-flow quality diff` has nothing to compare.

**Why it happens:** `goat-flow quality . --agent <id>` only composes the prompt. Persistence is a separate local step. Nothing is saved until the agent response is passed through `goat-flow quality capture`, which writes `.json` and `.md` companions under `.goat-flow/logs/quality/`.

**Evidence:**
- `src/cli/cli.ts` (search: `qualitySubcommand === "capture"`) - capture owns persistence and writes saved reports under `.goat-flow/logs/quality/`
- `src/cli/cli.ts` (search: `const result = composeQuality`) - prompt mode emits the prompt and returns; it does not persist report history
- `src/cli/quality/history.ts` (search: `No saved quality history`) - history and diff only read previously saved reports

**Prevention:** After each agent review, save the response and run `goat-flow quality capture --from-file <path>` (or `--from-stdin`) before the session ends. Use `quality history` and `quality diff` only after capture.
