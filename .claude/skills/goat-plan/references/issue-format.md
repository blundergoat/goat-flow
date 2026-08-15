---
goat-flow-reference-version: "1.15.1"
---
# ISSUE.md Format

Write `ISSUE.md` beside the milestones as the GitHub-facing case for the work. It serves requesters, reviewers, and implementers with different technical backgrounds; milestone files remain the executor handoff.

## When to emit it

- Standard and high-risk plans always include `ISSUE.md`.
- Small plans include it only for a requested GitHub brief, multiple milestones, or shared requirements and budget.
- Standard output targets at most 800 words and 60 nonblank lines.
- High-risk output above 1,200 words names the safety reason requiring extra detail.

## Writing rules

- Write for GitHub readers across technical levels using plain language before implementation terminology.
- Keep every prose paragraph and list item on one physical line; split independent decisions into separate bullets.
- Why, What, and How bullets contain 10-20 visible words on one physical line.
- Count after checkbox and Markdown markers but before ` = <agent-time range>`; punctuation adds no words.
- Omit empty sections; state an absence only when it protects scope, such as “No database changes.”
- Keep executor-only file paths, parser grammar, commands, and test protocols in milestone files.
- Preserve stable requirements in What; completion closes verified How tasks instead of rewriting requirements as history.

The headings below are the default output order. The snippets are illustrative input/output shape only, never repository evidence.

## Outcome

State the smallest complete result in one or two plain-language sentences.

```markdown
# <Outcome-focused issue title>

## Outcome

<What becomes true, who benefits, and the boundary of the useful result.>
```

## At a glance

Put delivery decisions before background. Use the seven rows below and keep each value concise.

```markdown
## At a glance

| Decision | Current plan |
|---|---|
| Delivery | <coding-agent range; human waiting excluded> |
| Must deliver | <smallest complete result> |
| Not included | <important exclusions or ranked cut-first work> |
| Main risk | <dominant uncertainty or failure mode> |
| Stop if | <condition requiring rescope or human decision> |
| Proof | <claims and evidence strategy, without repeated commands> |
| Next step | <first concrete action or current milestone> |
```

## How users will notice the difference

Use two to six before-and-after bullets. Distinguish relevant reader groups, cite measured baselines when available, and avoid marketing claims.

```markdown
## How users will notice the difference

- **Requesters see <difference>.** <Observable improvement compared with the current experience.>
- **Reviewers find <decision> faster.** <Concrete change in review or approval work.>
- **Implementers receive <difference>.** <Concrete change in execution or recovery work.>
```

Mention unchanged safeguards or delayed payoff only when materially relevant; never invent either to fill the section.

## Motivation

Explain the problem and value, not the implementation. Use concise bullets grounded in observed evidence where available.

```markdown
## Motivation

- <Current problem and why it matters to affected users or maintainers.>
- <Evidence showing the problem is material enough to address now.>
```

## What

State testable requirements without file-level detail. During authoring and close-out, map every bullet to a milestone outcome and proof claim; stop on any gap.

```markdown
## What

- <Observable requirement and acceptance boundary expressed in stakeholder language.>
- <Required safety, compatibility, documentation, or operational outcome when relevant.>
```

## How

Show delivery phases, not duplicated milestone tasks. Tasks remain open at authoring and close only after verified delivery.

```markdown
## How

*Estimates are coding-agent time, exclude human waiting, and do not count toward the 10-20-word task limit.*

- [ ] <One delivery phase stated in plain language for issue readers.> = <agent-time range>
- [ ] <Next delivery phase with one outcome and no executor-only detail.> = <agent-time range>
```

Every ISSUE delivery band is derived from milestone forecasts; reconcile How with Delivery. ISSUE bands summarize estimates and never input a milestone estimate. Exclude prerequisites from the subtotal.

## Out of scope

List only exclusions that are tempting, ambiguous, high-cost, or necessary to preserve delivery scope.

```markdown
## Out of scope

- <One meaningful exclusion and why reviewers might otherwise expect it.>
```
