# ADR-068: Floor the likely at one minute per unit so fast plans can use their own history

**Status:** Implemented
**Date:** 2026-09-20
**Ticket/Context:** `.goat-flow/plans/forecast-accuracy/M09-decide-how-fast-plans-get-their-own-range.md` and `M10-give-fast-plans-their-own-range.md` (local working state, not committed evidence)

## Context

Once a plan has three measured milestones, `plans check` advises forecast rates from that plan's own history. Item estimates are positive whole minutes, and their sum must equal the forecast's likely. A plan whose history runs under one minute per work unit therefore gets a likely that no set of items can sum to. Until now the checker handled that in two ways, and both left the plan on the wide default range. Contextual advice discarded its forecast and kept the issued values. Legacy `reforecast required` advice printed the sub-minute rates anyway, and authors could not use them; the footgun in `.goat-flow/learning-loop/footguns/plan-artifacts.md` (search: `integer estimates cannot express sub-minute unit rates`) counts 11 incidents.

A replay on 2026-09-19 rebuilt, in completion order, the forecast each plan's own history would have issued for 110 later milestones. The whole-minute rule discarded 18 of them: 11 of 12 in the fastest plan and 7 of 33 in another. Three options were measured on those 18.

| Option | Outcomes inside | Below | Above | Median width (min) | Median error (min) | Actual total over summed likely |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| A: item estimates may carry decimals | 11 of 18 (61%) | 3 | 4 | 16.5 | 6.9 | 1.75 |
| B: whole-minute items, likely floored at one minute per unit | 11 of 18 (61%) | 3 | 4 | 16.5 | 7.6 | 1.32 |
| C: keep the rule, which means the default 0.5-2.5-6 here | 15 of 18 (83%) | 3 | 0 | 77 | 17.6 | 0.52 |

Every outcome was already known, so these numbers compare options and qualify none.

## Decision

When a plan's history runs under one minute per work unit, the checker floors the advised likely at one minute per unit, keeps the measured low and high, and says so.

1. When the likely is the only bound whole-minute items cannot express, the checker floors the likely rate at 1.00 minute per unit and keeps the measured low and high. One rule owns the condition for both advice paths: `src/cli/plans-effort.ts` (search: `function floorUnallocatableLikely`).
2. The floor applies only when the derived likely minutes fall under the unit count and the published high rate is at least 1.00. A lower high rate could not hold a floored likely, because a copied basis must satisfy the grammar's ordering (`src/cli/plans-effort.ts`, search: `must satisfy low <= likely <= high`). Re-checked on 2026-09-20: of 19 discarded forecasts none had a high rate under 1.00, and the lowest was 1.12.
3. Any other failure keeps the old behaviour: issued values are retained and the attempt is disclosed.
4. The advice says `likely floored` and names the measured rate, so an author can record it in `source:`. Contextual advice: `src/cli/plans-forecast-model.ts` (search: `function computeForecast`). Legacy advice: `src/cli/plans-check-summary.ts` (search: `function readAdvisedLocalBasis`). Guidance: `workflow/skills/goat-plan/references/milestone-examples.md` (search: `likely floored at 1.00 min/unit`).
5. A milestone that copied the floored rates receives no further advice, and saved forecasts are never migrated.
6. The percentile pair for plan history stays 10,90 (`src/cli/config/config-vocabulary.ts`, search: `DEFAULT_FORECAST_BAND_QUANTILES`). It remains a per-project setting.

## Failure Mode Comparison

| Option | What fails | Verdict |
| --- | --- | --- |
| A: decimal item estimates | Strongest case: the likely stays the measured rate, so its median error is lowest (6.9 minutes). It changes the estimate grammar across five patterns, eight more source files and thirteen test and fixture files, plans written with decimals would not parse on an older goat-flow, and it yields the same range as B | Rejected |
| C: keep the rule | Strongest case: it costs nothing and holds 83% of these outcomes. Its range is 77 minutes wide against 16.5, its likely is about double what the work took, and fast plans never leave the default however much history they record | Rejected |
| Widen the percentile pair along with B | Strongest case: B holds 61% where the pair's name suggests 80%. Pooled over all 110 forecasts a wider pair buys coverage only with width (61% at 29 minutes, 69% at 36.5, 78% at 49, against the default's 84% at 58), and with eight or more earlier samples the lowest-to-highest range is as wide as the default. `plans check` already prints each plan's measured coverage | Rejected |
| B: floor the likely | Coverage on the affected forecasts drops from 83% to 61%, and 4 of 18 ran over the high. The floored likely is not a measured rate, so it is labelled | Accepted by the maintainer on 2026-09-20 |

## Consequences

- A fast plan's advised range is about a fifth as wide as the default, and its likely is never under one minute per unit. Actual totals ran 1.32 times the summed floored likely in the replay, so totals in fast plans still tend to run over.
- The sentence that forbade clamping any rate now permits this one floor and forbids every other adjustment. `test/unit/plans-check-floor.test.ts` (search: `plans check: likely floor for fast plans`) and `test/unit/plans-forecast-model.test.ts` (search: `floors only the likely when history runs under one minute per unit`) pin both paths, including a high rate under 1.00 that must still retain issued values.
- The `rule coverage:` replay is unchanged, because the floor moves neither the low nor the high.

## Reversibility

Two-way. Removing the call to the floor rule in both advice paths restores the old behaviour, and no saved forecast depends on it. Revisit if users of fast plans report ranges that miss too often, starting from each plan's `rule coverage:` line.
