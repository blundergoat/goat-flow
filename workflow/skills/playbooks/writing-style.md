---
goat-flow-reference-version: "1.15.1"
---
# Writing Style

Use this when producing or editing prose a person will read; the Scope Gate table lists the surfaces. It names common reader-cost patterns in generated prose, and the cases where those same shapes are correct and must be left alone.

Sibling playbooks own their formats: `changelog.md` owns changelog structure, `release-notes.md` owns per-release narrative shape. This playbook owns how the sentences inside them read.

## Availability Check

Documentary discipline reference; no CLI probe applies. Mechanical checks may catch residue or placeholders, but none prove factual accuracy, semantic preservation, or a correct exception. Load this file when a task produces or edits human-read prose, then apply the Scope Gate first. A review authorizes diagnosis, not an unrequested rewrite.

## Intent

Generated prose fails readers in a specific way: fluent, agreeable, and empty. It announces before it acts, inflates ordinary facts into milestones, cushions every negative, and repeats its own shape until the argument disappears.

The customer is a maintainer reading a release note during an incident, or a reviewer scanning a decision record for the constraint that matters. The failure this prevents is prose that costs reading time and returns nothing. The goal is readability, never disguised authorship.

## Scope Gate

Apply this before editing anything. Running the rules on an exempt surface is worse than not running them at all, because the exemptions below are load-bearing.

Resolve conflicts in this order: verified facts and safety; the user's task, audience, and required meaning; project-documented style and supplied voice; this playbook's defaults. Integrity outranks style. Lower layers never change higher ones.

| Surface | Rules apply? |
|---|---|
| Release notes, changelog prose, review and report narrative | Yes |
| Decision records, README and documentation prose | Yes |
| Issue and pull-request bodies, commit message bodies | Yes |
| `ISSUE.md`, milestone narrative, and testing-plan narrative | Yes |
| Learning-loop entry bodies (footguns, lessons, patterns, decisions) | Yes - body prose only |
| Any in-scope surface under roughly 40 words | Correctness and residue only |
| Comments and replies addressed to a person | Correctness and residue only |
| Skill files, playbooks and other agent-read references, shared preambles, instruction files, hook output | No |
| Code blocks, fixed schema fields, task/proof checklists, commands, approved requirements and acceptance/proof/verification/exit criteria, tables, INDEX and catalogue formats | No |
| Direct quotations, cited titles, and examples of a pattern | No |

**Mixed planning artifacts.** Apply the prose rules to `ISSUE.md` bodies and the Objective, Context, Scope, assumptions, rollback, and testing-rationale prose in milestone or testing-plan output; the exempt rows cover the rest, including deliberate control repetition.

If an exempt control surface conflicts with a source of truth, report the discrepancy to the owning workflow; do not silently rewrite it as style work.

**Replies are deliberately narrow.** Apply only the correctness pass and residue checks. The social-meaning guard and Colleague check constrain even those edits; no other style rule applies.

**Why short prose stops early.** Below roughly 40 words - a one-line changelog entry, a commit body, a brief issue comment - there is no structure to audit, and editing past correctness trades a working sentence for a differently worded one. Length never makes an exempt surface editable.

**Why agent-read control text is exempt.** In a skill file, playbook, preamble, or instruction file, emphasis and repetition are compliance mechanisms, not style defects. A rule stated three times is stated three times on purpose, because an agent that skips a pass is a real cost. Route problems there to the file's own contract.

**Why learning-loop entry bodies are in scope.** Footgun, lesson, pattern, and decision entries are retrieved by agents but verified by people, so the body follows the prose rules. The retrieval machinery stays exempt as fixed schema: frontmatter, schema lines (`**Status:**`, `**Created:**`, `**Evidence:**`), anchors, and generated INDEX files.

**Why tables, code, and catalogues are exempt.** Parallel structure is the point. A table with varied row shapes is a worse table.

**Why examples are exempt.** Text discussing a pattern is not using it. The bad-example column below is not a defect in this file.

## Correctness and Meaning

Run this before every style rule on every in-scope surface, against the source of truth: the diff, manifest, issue, decision, evidence, or cited source described.

- Correct typos, wrong word forms, dangling subjects, and broken parallelism.
- Check names, numbers, units, versions, flags, options, and paths.
- Open a cited document, issue, or benchmark and confirm it supports the claim.
- Match claim strength and specificity to the evidence. Do not inflate a narrow result or hedge a supported conclusion.
- Connect named attribution to a specific inspectable point; otherwise name the evidence or remove the prestige cue.
- Preserve claims, constraints, uncertainty, and provenance. Do not turn a proposal into a decision, an assumption into a fact, an optional action into a required one, or a planned or pending check into a passed check.

A fluent false sentence is worse than a clumsy true one. Style never outranks this gate.

## Before Editing Existing Prose

Classify source material as human-authored, generated, mixed, or unknown. Protect strong human passages; edit them only for correctness or a diagnosed defect. Quirks, abruptness, and interpersonal softeners are not defects by themselves. In mixed prose, repair weak generated passages without smoothing the protected ones into one register.

Unknown provenance starts conservative: lightest effective edit, and ask about authorship only when it changes the result. Rewrite weak generated prose from verified claims, not synonym substitutions; transcripts supply material, not a shape.

## Register

Choose the register from the artifact, reader, and supplied voice before applying generic rules. Neutral and conventional are valid voices; do not decorate them for distinctiveness.

- Documentation and decisions stay plain and precise about ownership, evidence, and uncertainty.
- Reports and reviews keep necessary terminology, hedging, citations, and causal relationships; learning-loop bodies share this register.
- Release and changelog prose states user impact and keeps caveats.
- Issues and pull requests lead with the decision, behaviour, or action.

The Scope Gate governs every register; replies stay correctness-and-residue-only surfaces whose social meaning must survive.

## Fix on Sight

These diagnose reader cost, not authorship. A diagnosed instance justifies an edit; a pattern count does not. When labels overlap, record the primary cost once. If known-good prose repeatedly triggers a label without that cost, narrow the rule. Rewrite from verified meaning, not synonym substitution.

**Assistant voice.** The register of a helpful chat reply rather than a document.

| Instead of | Write |
|---|---|
| `Here's how I'd think about it:` | The thought itself. |
| `Let me walk you through the change.` | The change. |
| A caveat attached to every claim | The claim, and a caveat on the edge case that actually exists. |
| `In conclusion,` plus a restatement | Nothing. End on the last concrete point. |
| Defining a term the reader already uses | Nothing. Trust the reader. |

**Announcing before doing.** `First, let's look at the config.` Delete the announcement and show the config. This includes the heading warm-up, a line under a heading that restates it.

**Significance inflation and tailing participles.** `The flag was renamed, ensuring a more consistent experience.` The participle clause is always positive and always vague, which is the signal. Write what happened: `The flag was renamed. Scripts using the old name fail at startup.` Same rule for `marks a pivotal moment` and `stands as a testament to`.

**Authority tropes.** `The real question is`, `at its core`, `what really matters here`. Each promises a deeper reading, then delivers the claim that was already coming. Delete the frame and make the claim.

**Aphorisms that gesture instead of compress.** Keep the `X is the Y of Z` formula only when the image replaces an explanation. `An untested backup is a rumour` earns its place; `Observability is the compound interest of incident response` states nothing.

**Uniform positivity.** Every negative cushioned, every section resolving upward. If a change is a regression for one group of users, say so plainly and stop. A complaint that goes nowhere beats a manufactured resolution.

**Contrastive negation, when the distinction is fake.** `This isn't a rewrite, it's a refactor.` Keep it only when you can explain the difference between the halves in a full sentence. Otherwise state the positive half and delete the negative one.

**Canonical terminology.** One canonical noun per technical referent; repeat it or use an unambiguous pronoun. Do not cycle between `config`, `configuration`, and `settings file` for one surface.

**Copula avoidance.** `Serves as the foundation for` is `is the base of`; `provides support for` is `supports`. When `is` or `has` carries the meaning, use it.

**Manufactured engagement closers.** Do not end a document on an invitation its type does not warrant: `Let us know what you think!` A pointer such as `Report issues at the tracker` routes action and is not engagement bait.

**Residue.** Mechanical evidence that text was pasted rather than written.

- Leaked scaffolding: `Certainly!`, `I hope this helps`, `Let me know if you'd like`.
- Placeholder text that shipped: `[INSERT EXAMPLE]`, `[link TBC]`, unresolved notes to self.
- Markdown that will not render where it landed.
- Tracking parameters left on pasted URLs.
- Broken dash spacing. Removing a dash without closing the gap welds `config-the` together mid-sentence. Read the repaired sentence.

## Structure

Run these before sentence-level work on anything longer than a few paragraphs. When a document reads as assembled, the shape is the cause and the sentences are fine.

**Duplicate representation.** The same content as prose, then a table, then a bullet list. Each is clear alone; together they read as padding. Keep the most informative one.

**Fractal summaries.** A closing section that restates the document's own structure to a reader who just read it. Cut it: the recap will not fix the structure problem that produced it.

**Repeated section templates.** Three or more sections running the identical movement, such as `[problem] → [what breaks] → [the fix is X]`. Catalogue-shaped repetition is exempt: a repeated option-and-tradeoff beat aids scanning. Repetition is defective only when it hides priority or causality.

**Framework stacking.** Two frameworks, models, or taxonomies introduced side by side and then never used apart. The opening teaches vocabulary the document does not need. Keep the one it actually uses.

**Process bleed.** Do not narrate the drafting session instead of describing the result. Write verified facts in the reader's order; keep chronology only when the sequence explains a cause or constraint. Illustrative before: `We inspected the parser, ran a fixture, and then found the flag is ignored.` After: `The parser ignores the flag when the fixture omits a value.`

**Filler.** `In order to` is `to`. `It is important to note that` is nothing. One instance per section is unremarkable; three is padding.

**The bolded-bullet restatement test.** The defect is restatement, not boldface:

- Restatement, so fix it: `**Scalability:** The system is designed to be scalable.`
- Reference label, so keep it: `**Blast radius:** Search every consumer before changing an exported type.`

The bolded word in the first is the whole sentence; in the second it is an index entry. Reference-list labels remain valid whenever the sentence carries information the label does not.

## Guards Against Misapplication

Each rule above has a shape it misfires on. Check the guard before acting.

**Tables and code are intentionally parallel.** Do not vary a table row or code sample to read as less mechanical. That is the same error as writing a worse table on purpose.

**Plan uniformity is control grammar, not template slop.** Milestone headings, status fields, task/proof/exit structure, Definitions of Done, and repeated gates are execution interfaces. Do not vary or delete them to make a plan feel less templated.

**Precision is not a defect.** Exact versions, flag names, error strings, counts, and paths are the highest-value content here. Do not generalise a number or swap an identifier for a category word so prose reads as less mechanical. A reader searching for `--no-cache` needs the flag, not "the relevant option".

**Ordinary writing habits are not defects.** Conjunction openers (`And`, `But`, `Because`), clean grammar, understatement, and mixed casual and formal register are normal human writing. None is evidence a passage needs work.

**Replies to people carry social meaning.** Hedges, softeners, and punctuation can express uncertainty, warmth, or a checking question: `just`, `though`, `maybe`, `I think`, `sorry`, and a trailing question mark on a statement - `You seemed sure the migration was reversible?` - which is a checking move, not a grammar error. A full stop there tells the reader what they think. Change them only for a diagnosed defect or requested tone; when drafting a new reply, choose the tone deliberately.

**Sentence length carries social cost in prose about a person's work.** Do not split a sentence about someone's change or missed step. `The check was added late and never ran` becomes `It never ran.` alone, which accuses where the original did not.

## Integrity

These outrank every style rule here. A more readable document that breaks one of them is a worse document.

- **Never invent an incident, example, metric, quotation, or name.** Not for illustration, not to make a point land. This is the hardest rule to keep, because invented specifics always read better than missing ones.
- **Never manufacture point of view or texture.** Preserve opinions, uncertainty, humour, irritation, and limitations when the source owns them; otherwise leave them out.
- **An illustrative example must be labelled as illustrative.** A placeholder scenario that reads as a real event becomes evidence in the next reader's hands.
- **Prefer a visible placeholder to a fabricated detail.** `[NEEDS REAL EXAMPLE]` blocks a release. A convincing invention does not, and ships.
- **Never describe agent-written text as human-authored.** Editing prose so it reads well is legitimate; claiming a person wrote it is not.
- **Readability is the goal.** A rule applied to defeat authorship detection was applied for the wrong reason and produces worse prose.

## Quick Tests

Cheap enough to run on a finished draft. On anything longer than a few paragraphs, run the first test before sentence edits; a failure needs facts, not polish.

1. **Fifty-subjects swap, at document level.** Could this document survive its subject being replaced by fifty others? If yes, it needs facts, not a style pass.
2. **So-what ladder.** Chase each claim with "so what?" until the answer is something only this project could say. Stop there, or delete the claim.
3. **Read it aloud.** Sentences that cannot be spoken in one breath, and sentences that all land the same way, surface here and nowhere else.
4. **Feelings check.** Is the sentence telling the reader how to feel about a fact? State the fact instead.
5. **Reader/action check.** Does the artifact name the behaviour or decision, affected surface, consequence, evidence, required action, and completion condition? A decision record states the strongest case for a rejected option before saying why it lost.
6. **Colleague check.** For a reply to a person, would the exact sentence preserve the intended confidence and social meaning if sent to a colleague?

On a substantial plan, decision record, or release note, a fresh reader may check whether the decision, action, and uncertainty survive without drafting context. Do not add a reviewer or sub-agent for this without existing authorization.

## Worked Example

**Illustrative example (not evidence of a real release).**

Before:

> Version 2.3.1 marks an important milestone in our ongoing journey toward a more seamless experience. We also enhanced export reliability, ensuring teams can confidently complete their workflows.

After:

> Version 2.3.1 retries an export once when the storage service times out. A failed retry leaves the draft in place and names the file that was not written.

The revision replaces the announcement, significance claim, and reassurance with the behaviour and consequence a reader needs.

## Antipatterns

Each has a rule above; the failure is applying it where it does not belong.

- Running the rules on a skill file, playbook, preamble, or instruction file.
- Condemning a working index or catalogue for being uniform.
- Making a table row or code sample irregular.
- Inventing a specific to replace a vague claim.
- Splitting a sentence about a person's work.
- Running the full pass on a one-line entry.
- **Editing past the gate.** Continued editing converges every document toward one flat register, its own tell.
- **Treating the rules as writing goals rather than review checks.** Prose written to satisfy this list acquires a uniform shape of its own.

## Verification Gate

Walk this once against the actual draft. Do not mark an item clean from memory.

1. Scope Gate, register, and source classification applied; no exempt surface edited for style, nothing under roughly 40 words edited past correctness and residue.
2. Names, numbers, units, versions, flags, paths, claim strength, attribution, and cited claims match the source of truth; no identifier or term generalised for smoothness.
3. Meaning preserved: status, requirement level, uncertainty, and provenance unchanged; no planned check became passed.
4. No leaked scaffolding, shipped placeholder, or broken dash spacing survives.
5. No assistant-voice framing, announcement, authority trope, engagement closer, or closing restatement remains.
6. Every significance claim is a stated fact; every surviving aphorism replaces an explanation.
7. Every surviving contrastive negation marks a distinction explainable in one sentence.
8. No content repeats across representations without a reason; no framework goes unused; chronology survives only when causally relevant.
9. Bolded bullets pass the restatement test; each referent keeps one canonical name.
10. Every example, metric, incident, and quotation is real or labelled illustrative.
11. Protected passages retain their voice; agent-written prose is not called human-authored.
12. The six Quick Tests pass at document level.

If the gate passes, stop editing.

## Related References

- `changelog.md` - changelog structure, categories, and cadence. This playbook governs the prose inside the entries.
- `release-notes.md` - per-release narrative shape and user-impact framing. This playbook governs its sentences.
