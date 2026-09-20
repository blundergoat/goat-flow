# ADR-067: Narrow the cold-start forecast range to 1.0-2.5-6 minutes per work unit

**Status:** Implemented
**Date:** 2026-09-20
**Updated:** 2026-09-20
**Ticket/Context:** `.goat-flow/plans/forecast-accuracy/M07-narrow-the-default-forecast-range.md` and that plan's `EXECUTION.md`, "Replan 2026-09-19" (local working state, not committed evidence)

## Context

A plan with fewer than three measured milestones has no history of its own, so it forecasts from a fixed default: counted work units multiplied by a low, likely and high rate in minutes per unit (`src/cli/plans-check-summary.ts`, search: `function selectedPlanForecastBasis`). The goat-plan skill tells authors to use the same three numbers until the plan has three eligible bases (`workflow/skills/goat-plan/SKILL.md`, search: `until three eligible bases`). The default shipped as 0.5-2.5-10, a twenty-fold range.

On 2026-09-19 the maintainer relayed what users report: the effort estimate is good, and the range is too wide to plan around.

A prospective pilot was meant to qualify a better forecasting method first. It closed without a verdict. It registered 21 forecasts and scored 18, its rules needed every registered case scored and at least 20 of them, and in all 21 cases the old and new methods issued the same forecast. The maintainer chose to change the default on pooled history instead of running a second pilot.

The pooled history is every measured work-unit sample that `plans check` reports across this repository's plan folders. On 2026-09-20 that was 133 samples from seven plans; it was 130 when the decision was made the day before, with the same percentages. Per unit the median is 2.41 minutes, the 10th percentile 0.78, the 90th percentile 6.18 and the mean 3.2. Plan medians run from 0.86 to 2.69.

| Default | Outcomes inside | Below | Above | Median width (min) |
| --- | --- | ---: | ---: | ---: |
| 0.5-2.5-10 (shipped until now) | 125 of 133 (94%) | 5 | 3 | 95 |
| 0.5-2.5-7.5 | 120 of 133 (90%) | 5 | 8 | 70 |
| 0.5-2.5-6 | 113 of 133 (85%) | 5 | 15 | 55 |
| 0.5-2.5-5 | 111 of 133 (83%) | 5 | 17 | 45 |
| 0.75-2.5-6 | 107 of 133 (80%) | 11 | 15 | 53 |

The evidence is exploratory. Every outcome was already known, it comes from one repository with mixed models and executors, and the samples leave out milestones whose counted units changed after their forecast, so the slow tail is understated.

Before shipping 1.17.0, the maintainer explicitly requested `1.0-2.5-6` instead of `0.5-2.5-6`. A fresh pooling on 2026-09-20 reproduced the same 133 reported samples from seven plans: the old range contains 113, with 5 below and 15 above; the requested range contains 96 (72%), with 22 below and 15 above. The replay used raw receipt seconds and each sample's unit count with the shipped floor-low/ceil-high arithmetic. It read the `work-unit sample:` output of `renderCalibrationSummary` across all 79 milestone-bearing plan directories, including `_done`; directories without `M*.md` files were excluded. These local measurements are exploratory, not prospective accuracy evidence.

## Decision

The cold-start forecast default becomes 1.0-2.5-6 minutes per work unit. This amendment raises only the low rate from 0.5 to 1.0 at the maintainer's request; the original decision had already lowered the high from 10 to 6.

1. The cold-start default is 1.0-2.5-6 minutes per work unit. The high stays at 6, the pooled 90th percentile rounded to a whole number.
2. The likely rate stays at 2.5. The pooled median is 2.41 and 72 of 133 samples finish under 2.5, which matches what users report about the estimate.
3. The low rate is 1.0. This is a maintainer-selected default, not a floor on measured historical rates or evidence that the low is feasible for every milestone. The original decision kept 0.5 to avoid the additional below-range outcomes; this amendment reverses that choice.
4. Saved forecasts are never migrated. Milestones issued at 0.5-2.5-10 or 0.5-2.5-6 keep their numbers and still validate, because the checker compares no saved basis with the current default.
5. Every statement of the default moves together: the source constant (`src/cli/plans-check-summary.ts`, search: `function selectedPlanForecastBasis`), the skill sentence above, its reference (`workflow/skills/goat-plan/references/milestone-examples.md`, search: `Below three matching measured bases`), the installed skill copies, `docs/cli.md` (search: `cold-start prior. At three or more`) and `docs/skills.md` (search: `cold prior; otherwise use the rates`).
6. A later change to these rates pools every plan's measured samples first. One plan's history does not set a shipped default.

## Failure Mode Comparison

The table records the original decision, before the maintainer's low-rate amendment. Its measurements and verdicts remain historical evidence.

| Option | What fails | Verdict |
| --- | --- | --- |
| Keep 0.5-2.5-10 | Strongest case: it holds 94% of outcomes and only 3 of 133 run over. It fails the reader it is for: the median range is 95 minutes wide, and users say they cannot set time aside against it | Rejected |
| 0.5-2.5-7.5 | Strongest case: 90% coverage, with 8 over the top instead of 15. The maintainer considered it on 2026-09-19 and declined it, preferring the narrower range at 85% | Rejected |
| 0.5-2.5-5 | Strongest case: ten minutes narrower again for two more misses. It sits below the measured 90th percentile, so the high would no longer be a measured figure | Rejected |
| 0.5-1.25-5, fitted to the fastest plan | Strongest case: frozen before ten later milestones of that plan ran, it held nine of them, as the shipped default did, with a median error of 10.0 minutes against 22.7. Pooled, only 35 of 133 samples finish under its likely and actual totals run 2.54 times its summed likely, so every slower project would be under-forecast | Rejected |
| Raise the low to 0.75 or 1 | Strongest case: a narrower range from the other side. Misses below the low rise from 5 to 11 or 22 | Rejected |
| Wait for a second prospective pilot | Strongest case: a prospective test is stronger evidence than known outcomes. The first pilot ran across a 27-milestone plan and could not reach a verdict, and the default governs only a plan's first three milestones | Rejected |
| 0.5-2.5-6 | Slow milestones exceed the range more often: 15 of 133 against 3 | Accepted |

The amendment accepts `1.0-2.5-6` for a narrower optimistic bound. Keeping 0.5 would retain more known outcomes inside the range; raising it leaves 22 below instead of 5, without changing the likely or high. The maintainer's explicit choice supersedes the original rejection of a low rate of 1.

## Consequences

- New plans, and plans with fewer than three measured milestones, use the higher optimistic bound. Historical inclusion falls from 113 of 133 (85%) for 0.5-2.5-6 to 96 of 133 (72%) for 1.0-2.5-6; the likely and upper bounds do not change. The original high-rate reduction had narrowed the median range from 95 to 55 minutes and increased above-range outcomes from 3 to 15.
- Plans with three or more measured milestones are unaffected. They already use their own measured rates (`src/cli/plans-check-summary.ts`, search: `MINIMUM_CALIBRATION_SAMPLES`).
- Two tests derive numbers from the default and moved with it: `test/unit/plans-forecast-model.test.ts` (search: `pool cold-prior; 0 samples`) and `test/contract/skill-hardening-plan-1.test.ts` (search: `cold-start prior is missing`). They check CLI arithmetic, unchanged saved files, and the skill/reference defaults in every installed harness. Existing saved-text fixtures retain 0.5-2.5-10 and 0.5-2.5-6 to exercise backward compatibility; measured-history tests retain sub-minute low rates. These deterministic checks do not establish model compliance or predictive accuracy.
- The plan's first requirement, fewer typical-duration errors and narrower ranges without lost coverage on agreed evaluation cases, was never tested. This change trades coverage for width and says so.

## Reversibility

Two-way. The default is one constant and the text that states it, and no saved forecast depends on it. The amendment proceeds with the observed 72% inclusion, below the original 80% revisit threshold, as an explicit maintainer choice rather than an accuracy claim. Revisit on new pooled evidence or reports that the range is too narrow. To repeat the pooling, run `plans check` on every plan folder and collect its `work-unit sample:` lines; compare raw seconds with the bounds derived from each sample's counted units, not rounded displayed rates.
