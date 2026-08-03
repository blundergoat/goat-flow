---
goat-flow-reference-version: "1.15.0"
---
# Writing Style

Use this when producing or editing prose a person will read: release notes, changelog entries, review and report narrative, decision records, README and documentation prose, issue and pull-request bodies, commit message bodies. It names the patterns that make generated text read as generated, and it names the cases where those same patterns are correct and must be left alone.

Sibling playbooks own their formats. `changelog.md` owns changelog structure and `release-notes.md` owns per-release narrative shape; this playbook owns how the sentences inside them read.

## Availability Check

Documentary discipline reference. No CLI probe applies: there is no tool to detect and no command that proves the rules are satisfied. Mechanical checks may catch residue or placeholders; none prove factual accuracy, semantic preservation, or correct exceptions. Load this file when a task produces or edits human-read prose, then apply the Scope Gate before the first edit.

## Intent

Generated prose fails readers in a specific way. It is fluent, agreeable, and empty. It announces before it acts, inflates ordinary facts into milestones, cushions every negative, and repeats its own section shape until the argument disappears into the machinery. The reader notices the effort and does not find the content.

The customer is a maintainer reading a release note during an incident, a reviewer scanning a decision record for the constraint that matters, or a user deciding whether an upgrade breaks them. The failure this prevents is prose that costs reading time and returns nothing.

The goal is readability. It is never disguising who wrote something.

## Scope Gate

Apply this before editing anything. Running the rules on an exempt surface is worse than not running them at all, because the exemptions below are load-bearing.

Project-documented style in instruction files, style guides, and enforced linters outranks this playbook's taste; the Integrity rules below outrank every style source.

| Surface | Rules apply? |
|---|---|
| Release notes, changelog prose, review and report narrative | Yes |
| Decision records, README and documentation prose | Yes |
| Issue and pull-request bodies, commit message bodies | Yes |
| `ISSUE.md`, milestone narrative, and testing-plan narrative | Yes |
| Comments and replies addressed to a person | Correctness and residue only |
| Skill files, playbooks and other agent-read references, shared preambles, instruction files, hook output | No |
| Code blocks, fixed schema fields, task/proof checklists, commands, approved requirements and acceptance/proof/verification/exit criteria, tables, INDEX and catalogue formats | No |
| Direct quotations, cited titles, and examples of a pattern | No |

**Mixed planning artifacts.** Apply the prose rules to `ISSUE.md` bodies and the Objective, Context, Scope, assumptions, rollback, and testing-rationale prose in milestone or testing-plan output. Leave fixed schema fields, exact paths, commands, approved requirements and acceptance/proof/verification/exit criteria, task/proof checklists, and deliberate control repetition unchanged.

If an exempt control surface conflicts with a source of truth, report the discrepancy to the owning workflow; do not silently rewrite it as style work.

**Replies are deliberately narrow.** Apply only the correctness pass and residue checks. The social-meaning guard and Colleague check constrain even those edits; no other style rule applies.

**Why agent-read control text is exempt.** In a skill file, playbook, preamble, or instruction file, emphasis and repetition are compliance mechanisms rather than style defects. A rule stated three times is stated three times on purpose, because an agent that skips one pass is a real cost while a reader who finds the repetition tedious is not. Editing those files for prose style strips out the redundancy that makes them work. Route genuine problems there to the file's own contract, never to this playbook.

**Why tables, code, and catalogues are exempt.** Parallel structure is the point in all three. A table with varied row shapes is a worse table.

**Why examples are exempt.** Text discussing a pattern is not using it. The bad-example column below is not a defect in this file.

## Correctness and Meaning

Run this before every style rule on every in-scope surface. Verify prose against its source of truth: the diff, manifest, issue, decision, evidence, or cited source being described.

- Correct typos, wrong word forms, dangling subjects, and broken parallelism.
- Check names, numbers, units, versions, flags, options, and paths against the source of truth.
- Open a cited document, issue, or benchmark and confirm it supports the claim.
- Preserve claims, constraints, uncertainty, and provenance. Do not turn a proposal into a decision, an assumption into a fact, an optional action into a required one, or a planned or pending check into a passed check.

A fluent false sentence is worse than a clumsy true one. Style never outranks this gate.

## Before Editing Existing Prose

Classify known source material as human-authored, generated, mixed, or unknown. Line-edit strong human-authored passages only for correctness or a diagnosed defect. In mixed prose, repair weak generated passages without smoothing voice-bearing human passages into one uniform register.

Unknown provenance starts conservative. Use the lightest effective edit, and ask about authorship only when the answer would materially change the result.

## Fix on Sight

One of these is enough to lose a technical reader. Each is worth fixing alone, without waiting for a second signal. Rewrite a flagged sentence from its verified meaning; do not swap a flagged word for a synonym.

**Assistant voice.** The register of a helpful chat reply rather than a document.

| Instead of | Write |
|---|---|
| `Here's how I'd think about it:` | The thought itself. |
| `Let me walk you through the change.` | The change. |
| A caveat attached to every claim | The claim, and a caveat on the edge case that actually exists. |
| `In conclusion,` plus a restatement | Nothing. End on the last concrete point. |
| Defining a term the reader already uses | Nothing. Trust the reader. |

**Announcing before doing.** `First, let's look at the config.` Delete the announcement and show the config. This includes the heading warm-up: a line under a heading that restates the heading before real content starts.

**Significance inflation and tailing participles.** `The flag was renamed, ensuring a more consistent experience.` The participle clause is always positive and always vague, which is the signal. Write what happened: `The flag was renamed. Scripts using the old name fail at startup.` The same rule kills `marks a pivotal moment`, `stands as a testament to`, and `the evolving landscape of`.

**Uniform positivity.** Every negative cushioned, every section resolving upward. If a change is a regression for one group of users, say so plainly and stop. A complaint that goes nowhere is more useful to a reader than a resolution that was manufactured.

**Contrastive negation, when the distinction is fake.** `This isn't a rewrite, it's a refactor.` Keep the construction only when the two halves are genuinely different and you can explain the difference in a full sentence. If you cannot, the sentence is rhythm standing in for an argument: state the positive half and delete the negative one.

**Canonical terminology.** Use one canonical noun per technical referent. Repeat it or use an unambiguous pronoun; do not cycle between `config`, `configuration`, and `settings file` when all three name the same surface.

**Manufactured engagement closers.** Do not end a document on an invitation the document type does not warrant: `Let us know what you think!` A plain navigation pointer such as `Report issues at the tracker` routes action; it is not engagement bait.

**Residue.** Mechanical evidence that text was pasted rather than written.

- Leaked scaffolding: `Certainly!`, `I hope this helps`, `Let me know if you'd like`.
- Placeholder text that shipped: `[INSERT EXAMPLE]`, `[link TBC]`, unresolved notes to self.
- Markdown that will not render where it landed.
- Tracking parameters left on pasted URLs.
- Broken dash spacing. Removing a dash without closing the gap leaves `config-the` or `startup-which` welded together mid-sentence. Read the repaired sentence, do not trust the replacement.

## Structure

Run these before sentence-level work on anything longer than a few paragraphs. When a document reads as assembled, the shape is usually the cause and the sentences are usually fine.

**Duplicate representation.** The same content as prose, then a table, then a bullet list. Each is clear alone; together they read as padding. Keep the representation carrying the most information and delete the rest.

**Fractal summaries.** A closing section that restates the document's own structure back to a reader who just read it. Cut it. A document that needs a recap of itself has a structure problem the recap will not fix.

**Repeated section templates.** Three or more sections running the identical movement, such as `[problem] → [what breaks] → [the fix is X]`. The content changes and the machinery does not, which is what the reader feels.

**Process bleed.** Do not narrate the drafting or build session instead of describing the result. Write verified facts in the reader's order; keep chronology only when the sequence itself explains a cause, decision, or constraint. Illustrative before: `We inspected the parser, ran a fixture, and then found the flag is ignored.` Illustrative after: `The parser ignores the flag when the fixture omits a value.`

**Filler.** `In order to` is `to`. `It is important to note that` is nothing. One instance per section is unremarkable; three is padding.

**The bolded-bullet restatement test.** The defect is restatement, not boldface. Apply the test before flagging:

- Restatement, so fix it: `**Scalability:** The system is designed to be scalable.`
- Reference label, so keep it: `**Blast radius:** Search every consumer before changing an exported type.`

The bolded word in the first example is the whole sentence. In the second it is an index entry and the sentence carries new content.

## Guards Against Misapplication

These exist because each rule above has a shape it misfires on. Check the guard before acting on the rule.

**Catalogue uniformity is not template uniformity.** A section running six `[option] → [tradeoff]` beats because it is surveying six options is a reference table rendered as prose. Its uniformity is what makes it scannable. The repeated-template rule fires when repetition is the shape of the *argument*, not when it is the shape of the *catalogue*.

**Tables and code are intentionally parallel.** Do not vary a table row or a code sample to make it read as less mechanical. That is the same error as writing a worse table on purpose.

**Reference-list labels are not restatement.** A fast scan sees the bold token and stops there, so a working index reads as the defect it is not. Run the restatement test against the sentence, never against the formatting.

**Plan uniformity is control grammar, not template slop.** Milestone headings, status fields, task/proof/exit structure, Definitions of Done, and repeated gates are execution and recovery interfaces. Do not vary or delete them to make the plan feel less templated.

**Replies to people carry social meaning.** In existing prose, hedges, softeners, and punctuation can express uncertainty, warmth, or a checking question. Change them only for a diagnosed defect or requested tone. When drafting a new reply, choose the tone deliberately rather than preserving or deleting these signals by formula.

## Integrity

These outrank every style rule in this file. A more readable document that breaks one of them is a worse document.

- **Never invent an incident, example, metric, quotation, or name.** Not for illustration, not to make a point land. This is the hardest rule to keep while editing for readability, because invented specifics always read better than missing ones.
- **An illustrative example must be labelled as illustrative.** A placeholder scenario that reads as a real event becomes evidence in the next reader's hands.
- **Prefer a visible placeholder to a fabricated detail.** `[NEEDS REAL EXAMPLE]` blocks a release. A convincing invention does not, and ships.
- **Never describe agent-written text as human-authored.** Editing prose so it reads well is legitimate. Claiming a person wrote it is not.
- **Readability is the goal.** Any rule applied to defeat authorship detection has been applied for the wrong reason and will produce worse prose.

## Quick Tests

Cheap enough to run on a finished draft. On anything longer than a few paragraphs, run the first test before sentence edits; a failure needs facts, not polish.

1. **Fifty-subjects swap, at document level.** Could this document survive its subject being replaced by fifty others? If yes, it says nothing specific and needs facts rather than a style pass.
2. **So-what ladder.** Chase each claim with "so what?" until the answer is something only this project could say. Stop when you hit it, or delete the claim.
3. **Read it aloud.** Sentences that cannot be spoken in one breath, and sentences that all land the same way, both surface here and nowhere else.
4. **Feelings check.** Is the sentence telling the reader how to feel about a fact? State the fact instead and let them feel what they feel.
5. **Reader/action check.** Where relevant, does the artifact name the behaviour or decision, affected surface, consequence, evidence or uncertainty, required action, and observable completion condition? A decision record states the strongest case for a rejected option before saying why it lost.
6. **Colleague check.** For a reply to a person, would the exact sentence preserve the intended confidence and social meaning if sent to a colleague?

For a substantial high-stakes plan, decision record, report, or release note, a fresh reader may check whether the decision, action, and uncertainty survive without drafting context. Do not add a reviewer or sub-agent solely for this check without existing authorization.

## Worked Example

**Illustrative example (not evidence of a real release).**

Before:

> Version 2.3.1 marks an important milestone in our ongoing journey toward a more seamless experience, introducing meaningful improvements that help users work more efficiently. We also enhanced export reliability, ensuring teams can confidently complete their workflows.

After:

> Version 2.3.1 retries an export once when the storage service times out. A failed retry leaves the draft in place and names the file that was not written.

The revision removes the announcement, significance claim, and manufactured reassurance. It replaces them with the behaviour and the consequence a reader needs when deciding whether to upgrade.

## Antipatterns

- **Running the rules on a skill file, playbook, preamble, or instruction file.** Strips the deliberate repetition those files rely on for agent compliance, and the loss is invisible until an agent skips a step.
- **Condemning a working index or catalogue for being uniform.** The structure guards exist because this misfire lands hardest on the sections that are easiest to scan.
- **Making a table row or code sample irregular.** Damages the artifact to satisfy a rule that never applied to it.
- **Inventing a specific to replace a vague claim.** Trades a readability problem for a truthfulness problem. Always the wrong trade.
- **Editing past the gate.** Once the Verification Gate passes, stop. Continued editing converges every document toward one flat register, which is its own tell.
- **Treating the rules as writing goals rather than review checks.** Prose written to satisfy this list mechanically acquires a uniform shape of its own.

## Verification Gate

Walk this once against the actual draft. Do not mark an item clean from memory.

1. Scope Gate and, when editing existing prose, source classification applied; no exempt surface was edited for style.
2. Names, numbers, units, versions, flags, paths, and cited claims match their source of truth.
3. Meaning is preserved: status, requirement level, uncertainty, and provenance did not change, and no planned check became passed.
4. No leaked scaffolding, shipped placeholder, or broken dash spacing survives.
5. No assistant-voice framing, announcement, manufactured engagement closer, or closing restatement remains.
6. Every significance claim is a stated fact rather than an inflated one.
7. Every surviving contrastive negation marks a distinction explainable in one sentence.
8. No content appears in more than one representation without a reason; process chronology survives only when causally relevant.
9. Bolded bullets pass the restatement test, and each technical referent keeps one canonical name.
10. Every example, metric, incident, and quotation is real, or is labelled illustrative.
11. Known human-authored passages retain their voice; agent-written prose is not described as human-authored.
12. The six Quick Tests pass at document level.

If the gate passes, stop editing.

## Related References

- `changelog.md` - changelog structure, categories, and cadence. This playbook governs the prose inside the entries.
- `release-notes.md` - per-release narrative shape and user-impact framing. This playbook governs its sentences.
