---
goat-flow-reference-version: "1.18.0"
---
# ISSUE.md Format

Write `ISSUE.md` beside milestones for requesters, reviewers and implementers; milestone files remain the executor handoff.

## When to emit it

- Standard and high-risk plans always include `ISSUE.md`.
- Small plans include it only for a requested GitHub brief, multiple milestones, or shared requirements and budget; when they do, they use every section below, including the per-task benefit list and the before-and-after table.
- Standard output targets about 800 words of prose outside tables and headings, about 1,500 words and 70 nonblank lines in all.
- High-risk prose above 1,200 words names the safety reason requiring extra detail.

## Writing rules

Write for GitHub readers across technical levels. Make Outcome, At a glance, problem, benefit, task benefits, before-and-after and Out of scope prose actionable without coding knowledge.

- Cut words, never facts: reference each fact's named owner (milestone, test, table row) instead of repeating it.
- Use plain professional sentences: neutral tone, everyday words, no compressed noun chains.
- Prose bullets contain 6-25 visible words on one physical line; count after checkbox and Markdown markers but before ` = <likely> min`; punctuation adds no words.
- Problem and task lines lean to the short end, and a task line still names each distinct deliverable; mechanism belongs in milestone files.
- At a glance answers use plain words around real numbers, stay within 25 words, and never drop a condition to get shorter. Before and After cells carry the words users hear or see and have no word cap.
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
- Keep the labelled coding-agent likely minutes this ISSUE format requires; never translate a milestone's control field into an unlabelled developer estimate such as “about three minutes”.
- Give each checkbox one independently checkable outcome. Start with the operation and name the affected behavior; “finalize the contract” alone supplies neither a concrete change nor a completion check.
- Aim for short task lines; put necessary file paths or symbols beneath technical handoff tasks, one path per bullet. The plain-language ISSUE sections retain their audience rules above.
- State observable evidence: the request appears, the saved value survives reload, the query returns the expected row, or the command exits successfully. “Verify it works” is insufficient. One relevant check may cover several changes.
- Put exact commands and queries in one named location accessible to that reader. Preserve their literal text; refer to that location instead of repeating or paraphrasing the invocation.
- For a bug, reproduce the observed failure before changing it. Otherwise start with prerequisite checks; then order changes, confirmation, cleanup and any required monitoring by dependency.
- When the user drops a design, remove its residue from current tasks and summaries, including unnecessary negative exclusions. Preserve immutable evidence and decision history; retain exclusions readers still need to understand scope.

These export rules also govern ISSUE drafts stored beside milestones. Local storage does not make the requester an executor with access to private files. Replace “the work plan owns detailed tasks” or “requirements map to the milestone checks” with the actual acceptance facts needed here.

Before delivery, read every ISSUE without the milestone open. Replace private task/proof references with needed acceptance facts; removing IDs while sending readers to unavailable material is insufficient.

Compare saved first/final drafts and claim only visible corrections; an unchanged valid draft is a valid second pass. Run commands on the saved artifact, separating structural acceptance, task coverage, and forecast evidence.

For one milestone with several deliverables, allocate shares of its recorded likely total across the required delivery phases. Sum the shares back to the milestone's likely figure and label them allocations, not independently calibrated forecasts. Avoid counting the milestone twice or collapsing distinct deliverables merely to avoid allocating its total.

Before export, inspect every prose section, table and checklist for unexplained IDs, private pointers and stale alternatives. Check task coverage separately from length: a compact sentence can still hide several deliverables. Use verified technical anchors; the other project's examples describe its incident, not facts about this repository.

Illustrative rewrite, shape only: “Finalize the report metadata contract” becomes “Preserve assessment metadata when saving reports”, followed by the check “Reload the saved report; confirm its assessment metadata is unchanged”. Validation and history loading receive separate change tasks when required; they must not disappear inside the saving task.

### Plan progress updates

New plans contain `_PROGRESS.md`, initially only `# Plan and implementation progress`. Existing plans adopt it only on explicit request. This summary reports planning decisions and implementation outcomes for issue readers; milestones retain task state and acceptance.

After meaningful planning or implementation batches and at handoff, compare plan amendments, completed tasks, observed evidence and saved entries. Prepend `## YYYY-MM-DD: <short subject>` below the title, newest first even on the same day. Name the change in the subject. Normally write three to five short outcome bullets, a brief `Checks:` line naming actual verification and gaps, then a final `Next:` line. Use fewer bullets for sparse results; never pad or invent completion. Update during implementation, without waiting for milestone completion.

Aim for 100-150 characters per bullet, excluding the list marker. This is a preference, not a limit: shorter bullets are fine, and useful or important detail may run longer. Never pad a bullet or cut facts to meet the target.

State each outcome's completion level: **planned** means specified future work; **implemented** means changes made; **verified** means named checks support the stated scope; **accepted** means recorded human acceptance of that work. Report only relevant levels. Distinguish plan validation from implementation verification, and plan or scope approval from milestone acceptance. Report planning changes and completed implementation when both occurred.

End every entry with `Next:` naming the next action and its owner. If a human decision is needed, name the work or evidence to review, the decision, and what approval allows. Use existing gates; do not add approval requirements. If nothing remains, say so.

Use hyphens, colons or commas where appropriate; do not use em dashes.

Report each outcome once. An unchanged resume or empty batch writes nothing. Material approval, verification or rework changes may prepend a short dated correction without new completed tasks: say what changed and refer to the affected outcome plainly. Preserve earlier entries verbatim.

Apply Human-facing exports and the human-prose playbook. Preserve facts and public technical names; omit private note links, executor IDs and agent-operation details. Posting remains a human action.

Before saving, follow the shared preamble's Durable Local Text Redaction → Plan-summary exception. Always run `/goat-clarity documentation .goat-flow/plans/<selected-plan>/_PROGRESS.md` on each new or revised entry before delivery for concise, natural wording that preserves facts and completion levels. Limit writes to the new entry; older entries are read-only. Compare earlier bytes before/after and require a repeated pass to preserve already-clear text. Every clarity edit follows the same pre-write redaction rule. Failed saving leaves the existing file untouched; unavailable clarity is disclosed as incomplete, never paste-ready.

The headings below are the default ISSUE output order. The snippets are illustrative input/output shape only, never repository evidence.

## Outcome

Write two to five plain sentences: what is true after the work, who can now do what, then the source issue and PR when they exist. No scaffolding sentences, no compressed noun chains, one canonical noun per thing; second person is welcome.

```markdown
# <Outcome-focused issue title>

## Outcome

<What becomes true after the work.> <Who can now do what.> Source: #<issue> and PR #<number>.
```

## At a glance

Lead with delivery decisions; use these seven concise rows.

```markdown
## At a glance

| Question | Answer |
|---|---|
| How long will it take? | About <N> hours of agent work: <M> minutes of likely estimates, waiting on people excluded |
| What must ship? | <smallest complete result> |
| What is left out? | <bare list of the biggest exclusions> |
| Biggest risk? | <dominant uncertainty or failure mode> |
| When do we stop? | <condition requiring rescope or a human decision> |
| How is it proven? | <claims and evidence strategy, without repeated commands> |
| What happens first? | <first concrete action or current milestone> |
```

M is the sum of the Tasks minutes; N is M rounded to the nearest half hour, so 214 minutes shows as 3.5.

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

Show three to six delivery phases without duplicating milestone tasks. Directly below the heading, one plain line totals the open tasks: their count, the summed likely minutes and the same About-N-hours figure as the headline; name completed tasks as excluded with their issued minutes. End task lines with ` = <likely> min`; put human actions in At a glance. Tasks remain open at authoring and close only after verified delivery.

```markdown
## Tasks

<Count> tasks totalling <M> minutes of likely estimates, about <N> hours of agent work.

- [ ] <One delivery phase stated in plain language for issue readers.> = <likely> min
- [ ] <Next delivery phase with one outcome and no executor-only detail.> = <likely> min
```

Each task's minutes are the likely figure from the milestones it covers, the headline number in their Effort estimate lines; milestone files keep their ranges and `Forecast range:` lines. Reconcile Tasks with the "How long will it take?" answer separately: `plans check` ignores ISSUE content. ISSUE minutes never input a milestone estimate. Exclude prerequisites from the sum.

### Forecast presentation

Read `milestone-examples.md` → Effort Estimates before taking likely figures. Keep forecast schemas, ranges, hashes and registration commands in the milestone and its evidence; ISSUE shows likely minutes only.

- For work that has not started, a task's minutes are the sum of its milestones' likely figures; count each milestone once and keep labelled prerequisites outside the sum.
- For active work, tick finished tasks, keep their issued minutes, and state the cutoff for the remaining sum.
- For completed work, keep the issued minutes; recorded Actual and calibration stay in the milestones and the plan's forecast history.
- The "How long will it take?" answer equals the Tasks sum; summed likely figures are a planning estimate, not a calendar schedule or a probability guarantee.

Name the main uncertainty in "Biggest risk?" or one sentence beside the headline: what makes the likely figure fragile and what the next investigation resolves. When scope or required proof changes, revise the affected milestone first, then refresh its task minutes and the headline together. Never shorten a figure by omitting mandatory checks or changing stable Requirements to disguise scope changes.

## What each task gives the user

One bullet per task, in task order, 6-25 words, written from the point of view of whoever gets the benefit: the patient, the practice, the staff member, the person deploying. Each bullet says what they can now do or no longer suffer, never what ships. No milestone IDs, file paths or commands.

```markdown
## What each task gives the user

- <Who gets it, and what they can now do or no longer suffer once this task ships.>
```

## Before and After Goals

One lead sentence saying how to read the table, then a three-column table: Change, Before, After, one row per task in task order. Change is a short label for the task. Before is what the user gets today; After is what they get once that task ships, both in the user's own terms, with the concrete words they hear or see where known. Use bracketed placeholders such as [clinic] or [patient] rather than invented names, and label any illustrative example as illustrative. No sentence announces the section.

```markdown
## Before and After Goals

Before is what <the reader group> gets today; after is what they get once that task ships. Rows follow the task order.

| Change | Before | After |
|---|---|---|
| <Short task label> | <What they get today, with the words they hear or see.> | <What they get once it ships.> |
```

## Out of scope

List one to three tempting, ambiguous or costly exclusions and explain why readers might expect them. Avoid repeating "What is left out?": the row lists, this section explains.

```markdown
## Out of scope

- <One meaningful exclusion and why reviewers might otherwise expect it.>
```

## Worked sample

Read `issue-sample.md` beside this file: an illustrative brief for a made-up home-services product, never repository evidence. Check a draft against it for section order, bullet length, one benefit bullet and one table row per task, and the headline arithmetic.

Before finishing, check that a reader outside engineering could act on every prose sentence.
