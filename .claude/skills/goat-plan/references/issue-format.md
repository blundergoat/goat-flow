---
goat-flow-reference-version: "1.16.0"
---
# ISSUE.md Format

Write `ISSUE.md` beside the milestones as the GitHub-facing case for the work. It serves requesters, reviewers, and implementers with different technical backgrounds; milestone files remain the executor handoff.

## When to emit it

- Standard and high-risk plans always include `ISSUE.md`.
- Small plans include it only for a requested GitHub brief, multiple milestones, or shared requirements and budget.
- Standard output targets at most 800 words and 60 nonblank lines.
- High-risk output above 1,200 words names the safety reason requiring extra detail.

## Writing rules

Write for GitHub readers across technical levels. The floor is a reader with no coding background: a product owner, operations person, or client must be able to act on every prose sentence in Outcome, At a glance, the problem and benefit sections, and Out of scope.

- Cut words, never facts: prefer the shortest version that keeps every distinct fact; a fact may live in its named home (milestone, test, table row) instead of being restated.
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

The headings below are the default output order. The snippets are illustrative input/output shape only, never repository evidence.

## Outcome

State the smallest complete result in one or two plain-language sentences.

```markdown
# <Outcome-focused issue title>

## Outcome

<What becomes true, who benefits, and the boundary of the useful result.>
```

## At a glance

Put delivery decisions before background. Use the seven rows below and keep each answer concise.

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

Name the problem and its cost in plain words, not the implementation. Ground bullets in observed evidence where available.

```markdown
## What problem are we solving

- <Current problem, and the concrete cost to affected users or maintainers.>
- <Evidence showing the problem is material enough to address now.>
```

## Who benefits and how

Use two to six bullets in plain language. Lead with the bold reader group when benefits differ by reader, or with the bold claim when one benefit serves everyone; gloss roles in plain words, cite measured baselines when available, and avoid marketing claims.

```markdown
## Who benefits and how

- **Requesters** (whoever asked for this) see <observable improvement over the current experience>.
- **Reviewers** (whoever approves it) find <decision> faster: <concrete change in review work>.
- **Implementers** (whoever builds it) receive <concrete change in execution or recovery work>.
```

Mention unchanged safeguards or delayed payoff only when materially relevant; never invent either to fill the section.

## Requirements

State testable requirements without file-level detail. During authoring and close-out, map every bullet to a milestone outcome and proof claim; stop on any gap.

```markdown
## Requirements

- <Observable requirement and acceptance boundary expressed in stakeholder language.>
- <Required safety, compatibility, documentation, or operational outcome when relevant.>
```

## Tasks

Show three to six delivery phases, not duplicated milestone tasks; after the ` = ` estimate a line carries nothing else, and human actions are named in At a glance instead. Tasks remain open at authoring and close only after verified delivery.

```markdown
## Tasks

*Times are the coding agent's working time, not calendar time; waiting on people is excluded.*

- [ ] <One delivery phase stated in plain language for issue readers.> = <agent-time range>
- [ ] <Next delivery phase with one outcome and no executor-only detail.> = <agent-time range>
```

Every ISSUE delivery band is derived from milestone forecasts; reconcile Tasks with the "How long will it take?" answer. ISSUE bands summarize estimates and never input a milestone estimate. Exclude prerequisites from the subtotal.

## Out of scope

List only the one to three tempting, ambiguous, or high-cost exclusions, each with why reviewers might otherwise expect it. Do not repeat the "What is left out?" row verbatim: the row lists, this section explains.

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
| How long will it take? | 6-9 hours of agent work |
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
- [ ] Prove searches return in under one second. = 1-2h

## Out of scope

- Ranking changes: this work is about speed, and reordering results would hide whether speed improved.
```

Before finishing, check that a reader outside engineering could act on every prose sentence.
