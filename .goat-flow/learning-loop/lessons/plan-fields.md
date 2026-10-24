---
category: plan-fields
last_reviewed: 2026-10-21
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

## Lesson: Read a plan patch's applied history before trusting its hash or checker

**Status:** active | **Created:** 2026-10-21
**Decision changed:** Apply a prepared plan patch to a scratch copy and read every changed forecast-history block before applying it to the live milestone.
**Trigger phase:** ACT
**Caught at:** ACT

**Prevention:** A recorded after-hash proves only that the patch reproduces the bytes it was prepared to produce. Strict plan checking does not compare prose history blocks with the forecasts they claim to preserve. Preview the applied text, confirm each older record still sits under its own heading, and add a new history block rather than editing an existing one. The rule being protected lives in `workflow/skills/goat-plan/references/milestone-examples.md` (search: `never overwrite the original`).

**What happened:** A 1.19.0 M03 forecast amendment matched its recorded after-hash and passed strict validation. Its applied text put the new 107-minute forecast, with a 51-335 range that disagreed with the live 50-336 header, in place of the original 85-minute record under the 2026-10-17 heading. It also merged the 68- and 85-minute records under the new 2026-10-21 heading. A scratch-copy preview caught it before application, and both blocks were restored afterwards. A strict check of a plan copy holding the scrambled milestone also exited zero with no milestone warning.

**Root cause:** The author treated hash reproduction and a passing checker as proof that preserved history was intact. Saved forecast revisions are only machine-checked in the JSON `## Forecast records` section, `src/cli/plans-forecast-context.ts` (search: `Forecast records requires exactly one JSON fence`); a prose history block in a text fence has no equivalent check.
