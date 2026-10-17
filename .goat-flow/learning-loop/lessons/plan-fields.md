---
category: plan-fields
last_reviewed: 2026-10-18
---

## Lesson: Copy machine-parsed forecast fields without shortening their grammar

**Status:** active | **Created:** 2026-10-18
**Incident count:** 2
**Latest occurrence:** 2026-10-18
**Decision changed:** Copy the forecast field's canonical grammar before writing a milestone, then run strict validation before starting its timer.
**Trigger phase:** ACT
**Caught at:** VERIFY

**Prevention:** Keep required timing phrases intact even when shortening surrounding prose. `src/cli/plans-effort.ts` (search: `FORECAST_RANGE_GRAMMAR`) owns the accepted forecast-range shape.

**What happened:** The first strict check for the preflight performance work rejected a forecast range that omitted the required phrase describing its recorded milestone timeline. Restoring that phrase made validation succeed before the timer started.

**Root cause:** A machine-parsed field was shortened as ordinary prose without checking its literal grammar.

**Recurrence 2026-10-18:** A CI milestone draft put procedure paragraphs after each final task. Strict validation reported one task missing an estimate in each milestone, with product totals and work-unit counts short by that item. `src/cli/plans-export.ts` (search: `readChecklistItems`) treats text through the next checkbox or heading as the task body; `src/cli/plans-effort.ts` (search: `TASK_ESTIMATE_PATTERN`) requires the estimate at the end. Move free-standing procedure text before `## Tasks` or into another existing section; do not change the totals or parser to conceal the missing estimate.
