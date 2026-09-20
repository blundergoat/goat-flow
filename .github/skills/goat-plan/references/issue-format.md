---
goat-flow-reference-version: "1.17.0"
---
# ISSUE.md Format

Write `ISSUE.md` beside milestones for requesters, reviewers and implementers; milestone files remain the executor handoff.

## When to emit it

- Standard and high-risk plans always include `ISSUE.md`.
- Small plans include it only for a requested GitHub brief, multiple milestones, or shared requirements and budget.
- Standard output targets at most 800 words and 60 nonblank lines.
- High-risk output above 1,200 words names the safety reason requiring extra detail.

## Writing rules

Write for GitHub readers across technical levels. Make Outcome, At a glance, problem, benefit and Out of scope prose actionable without coding knowledge.

- Cut words, never facts: reference each fact's named owner (milestone, test, table row) instead of repeating it.
- Use plain professional sentences: neutral tone, everyday words, no compressed noun chains.
- Prose bullets contain 6-25 visible words on one physical line; count after checkbox and Markdown markers but before ` = <agent-time range>`; punctuation adds no words.
- Problem and task lines lean to the short end, and a task line still names each distinct deliverable; mechanism belongs in milestone files.
- Table answers use plain words around real numbers and never drop a condition to get shorter.
- Second person is welcome: "You can archive old projects."
- Name no milestone ID, ADR number, version number, flag, internal file path, or bare command in prose sections; a surface the reader types or sees is not internal.
- The problem section names who is hit; the benefit section names what someone can now do, never what ships.
- When a project term is needed, put the plain phrase first and the term in parentheses: "the step-by-step work plans (milestone files)".
- Keep every prose paragraph and list item on one physical line; split independent decisions into separate bullets.
- Omit empty sections; state an absence only when it protects scope, such as "No database changes."
- Keep executor-only file paths, parser grammar, commands, and test protocols in milestone files.
- Preserve stable requirements in Requirements; completion ticks verified Tasks instead of rewriting requirements as history.
- Milestone files keep their own one-line band (70-120 characters) for the shared problem and benefit sections.

Apply `.goat-flow/skill-docs/playbooks/writing-human-facing-prose.md` to non-checkbox narrative. Keep the decision and necessary facts; shorten repeated explanation and link supporting evidence to its owner. Do not apply prose shortening to exact requirements, commands or acceptance criteria.

Checkbox tasks need a concrete action, affected surface and observable result. Name the relevant command, option, format, screen or data behavior when readers need it to understand the deliverable. A broad label such as "improve validation" is insufficient without saying which input is checked and what changes. Keep executor-only paths and detailed cases in the milestone; specificity must survive that separation.

Avoid these words in prose sections; use the replacement:

| Avoid | Use |
|---|---|
| leverage, utilize | use |
| implement | build, add |
| remediate | fix |
| surface (as a verb) | show |
| latency | delay |
| functionality | feature |
| optimize | speed up |
| robust, performant | name the measured number |

Worked rewrites (illustrative placeholders, never repository evidence):

- BAD: "Search latency remediation restores sub-second dashboard query response for stakeholders."
- GOOD: "Dashboard search takes about 8 seconds, so most people give up before results appear."
- BAD: "Implements M03 cache invalidation per ADR-041 to optimize the v2.1 query path."
- GOOD: "Repeat searches reuse stored results, so common questions get answers in under one second."
- BAD: "Fix three command-line bugs."
- GOOD: "Fix the three command-line problems: audits that overclaim, odd folder names crashing, misspelled options hiding."

## Human-facing exports

Apply these rules when copying milestone content into an issue, PR or handoff. Public readers must understand the result without private plan files. The owner's links are useful inside a local plan; for publication, inline the necessary facts or link an accessible repository artifact instead. Verify that a linked artifact is available to the intended reader.

- Replace milestone, requirement and proof labels with plain descriptions. Strip risk/proof tags and `(est: ...)` control fields from copied checkboxes. Preserve real public issue numbers and technical names when they identify the work.
- Keep the explicitly labelled coding-agent delivery bands required by this ISSUE format; never translate a milestone's control field into an unlabelled developer estimate such as “about three minutes”.
- Give each checkbox one independently checkable outcome. Start with the operation and name the affected behavior; “finalize the contract” alone supplies neither a concrete change nor a completion check.
- Aim for short task lines; put necessary file paths or symbols beneath technical handoff tasks, one path per bullet. The plain-language ISSUE sections retain their audience rules above.
- State observable evidence: the request appears, the saved value survives reload, the query returns the expected row, or the command exits successfully. “Verify it works” is insufficient. One relevant check may cover several changes.
- Put exact commands and queries in one named location accessible to that reader. Preserve their literal text; refer to that location instead of repeating or paraphrasing the invocation.
- For a bug, reproduce the observed failure before changing it. Otherwise start with prerequisite checks; then order changes, confirmation, cleanup and any required monitoring by dependency.
- When the user drops a design, remove its residue from current tasks and summaries, including unnecessary negative exclusions. Preserve immutable evidence and decision history; retain exclusions readers still need to understand scope.

These export rules also govern ISSUE drafts stored beside milestones. Local storage does not make the requester an executor with access to private files. Replace “the work plan owns detailed tasks” or “requirements map to the milestone checks” with the actual acceptance facts needed here.

For one milestone with several deliverables, allocate shares of its recorded low, likely and high totals across the required delivery phases. Sum the shares back to the original forecast and label them delivery allocations, not independently calibrated forecasts. Avoid counting the milestone twice or collapsing distinct deliverables merely to avoid allocating its total.

Before export, inspect every prose section, table and checklist for unexplained IDs, private pointers and stale alternatives. Check task coverage separately from length: a compact sentence can still hide several deliverables. Use verified technical anchors; the other project's examples describe its incident, not facts about this repository.

Illustrative rewrite, shape only: “Finalize the report metadata contract” becomes “Preserve assessment metadata when saving reports”, followed by the check “Reload the saved report; confirm its assessment metadata is unchanged”. Validation and history loading receive separate change tasks when required; they must not disappear inside the saving task.

The headings below are the default output order. The snippets are illustrative input/output shape only, never repository evidence.

## Outcome

State the smallest complete result in one or two plain-language sentences.

```markdown
# <Outcome-focused issue title>

## Outcome

<What becomes true, who benefits, and the boundary of the useful result.>
```

## At a glance

Lead with delivery decisions; use these seven concise rows.

```markdown
## At a glance

| Question | Answer |
|---|---|
| How long will it take? | <coding-agent range; waiting on people excluded> |
| What must ship? | <smallest complete result> |
| What is left out? | <bare list of the biggest exclusions> |
| Biggest risk? | <dominant uncertainty or failure mode> |
| When do we stop? | <condition requiring rescope or a human decision> |
| How is it proven? | <claims and evidence strategy, without repeated commands> |
| What happens first? | <first concrete action or current milestone> |
```

## What problem are we solving

Name the problem and its cost, grounding claims in observed evidence rather than implementation details.

```markdown
## What problem are we solving

- <Current problem, and the concrete cost to affected users or maintainers.>
- <Evidence showing the problem is material enough to address now.>
```

## Who benefits and how

Use two to six plain bullets. Bold reader groups for differing benefits, or claims for shared benefits; gloss roles, cite available measured baselines, and avoid marketing claims.

```markdown
## Who benefits and how

- **Requesters** (whoever asked for this) see <observable improvement over the current experience>.
- **Reviewers** (whoever approves it) find <decision> faster: <concrete change in review work>.
- **Implementers** (whoever builds it) receive <concrete change in execution or recovery work>.
```

Mention unchanged safeguards or delayed payoff only when relevant; never invent either.

## Requirements

State testable requirements without file-level detail. During authoring and close-out, map every bullet to a milestone outcome and proof claim; stop on any gap.

```markdown
## Requirements

- <Observable requirement and acceptance boundary expressed in stakeholder language.>
- <Required safety, compatibility, documentation, or operational outcome when relevant.>
```

## Tasks

Show three to six delivery phases without duplicating milestone tasks. End lines with the ` = ` estimate; put human actions in At a glance. Tasks remain open at authoring and close only after verified delivery.

```markdown
## Tasks

*Times are the coding agent's working time, not calendar time; waiting on people is excluded.*

- [ ] <One delivery phase stated in plain language for issue readers.> = <agent-time range>
- [ ] <Next delivery phase with one outcome and no executor-only detail.> = <agent-time range>
```

Every ISSUE delivery band is derived from milestone forecasts; reconcile Tasks with the "How long will it take?" answer separately: `plans check` ignores ISSUE content. ISSUE bands never input a milestone estimate. Exclude prerequisites from the subtotal.

For active work, show recorded effort plus the latest remaining forecast at its named cutoff; keep issued whole forecasts separate. Missing timing means the combined total is unavailable. Label unsupported fast cases provisional and name the investigation checkpoint; never add elapsed work to a whole-work forecast.

### Forecast presentation

Read `milestone-examples.md` → Effort Estimates before deriving delivery bands. Summarize its recorded forecasts in language readers can act on; keep forecast schemas, hashes and registration commands in the milestone and its evidence.

- For work that has not started, derive each delivery phase's low, likely and high from the milestones it covers. Count each milestone once and keep separately labelled prerequisites outside the subtotal.
- For active work, distinguish effort already recorded at a named cutoff, the latest estimate for work remaining at that cutoff, and their combined completion estimate. Explain that these are coding-agent working minutes; waiting for people is excluded.
- For completed work, use recorded Actual with its provenance. A retrospective estimate, incomplete timer or missing receipt cannot become measured time through summary wording. When any required timing is missing, show the known amounts and say the combined total is unavailable.
- Keep the originally issued whole-work forecast available for comparison. A revision changes what remains; it must not erase the original commitment or add elapsed time to work already included in a whole-work estimate.
- Make the "How long will it take?" answer agree with the current Tasks bands. State the cutoff when showing an older snapshot. Summed milestone bounds are a planning window, not a probability guarantee or a calendar schedule.
- When the plan already has measured milestones, state the checker's `plan total:` ratio beside the summed estimate; it reports how this plan's past totals compared with their forecasts and claims no direction for the work ahead.

Explain the main uncertainty beside the range: what evidence supports the fast case, what could make work take longer, and what the next investigation will resolve. When relevant history is sparse or poorly matched, disclose that limitation. Do not present a broad prior or historical percentile span as confidence established by prospective results.

When evidence does not support a feasible fast case, call the lower bound provisional and name the bounded investigation and reforecast checkpoint. If scope or required proof changes, revise the affected milestone first, then refresh the delivery phase and headline together. Never shorten a range by omitting mandatory checks, reusing an old whole-work estimate as a remaining estimate, or changing stable Requirements to disguise scope changes.

## Out of scope

List one to three tempting, ambiguous or costly exclusions and explain why readers might expect them. Avoid repeating "What is left out?": the row lists, this section explains.

```markdown
## Out of scope

- <One meaningful exclusion and why reviewers might otherwise expect it.>
```

## Worked sample

Illustrative placeholder for shape only, never repository evidence; every name and number below is invented.

```markdown
# Dashboard search returns results in under one second

## Outcome

Anyone searching the dashboard gets results in under one second, without changes to how results are ranked.

## At a glance

| Question | Answer |
|---|---|
| How long will it take? | 4-8 hours of agent work |
| What must ship? | Common searches answer in under one second |
| What is left out? | Ranking changes, mobile layout work |
| Biggest risk? | Stored results going stale after edits |
| When do we stop? | If stored results cannot stay current, a human decides |
| How is it proven? | Timed searches before and after the change |
| What happens first? | Measure where search time goes today |

## What problem are we solving

- Dashboard search takes about 8 seconds, so most people give up before results appear.
- Slow search is the top support complaint: 14 reports last month.

## Who benefits and how

- **Requesters** (whoever asked for this) get search answers in under a second instead of eight.
- **Reviewers** (whoever approves it) can approve from two numbers: search time before and after.
- **Implementers** (whoever builds it) get one measurable target and a timed test to prove it.

## Requirements

- Common dashboard searches return results in under one second.
- Existing saved searches keep working unchanged.
- Search results stay current after records are edited.

## Tasks

*Times are the coding agent's working time, not calendar time; waiting on people is excluded.*

- [ ] Measure where search time goes today. = 1-2h
- [ ] Reuse stored results for common searches. = 2-4h
- [ ] Prove search speed, saved searches and fresh results after edits. = 1-2h

## Out of scope

- Ranking changes: this work is about speed, and reordering results would hide whether speed improved.
```

Before finishing, check that a reader outside engineering could act on every prose sentence.
