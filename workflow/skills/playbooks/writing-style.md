---
goat-flow-reference-version: "1.16.0"
---
# Writing Style

Use this first for human-read prose in the Scope Gate. Sibling playbooks own diagnostics and release surfaces; load one only on its objective trigger.

## Availability Check

This is a discipline reference, not a CLI. Mechanical checks may locate candidates, but none prove factual accuracy, preserved meaning, or a correct exception. Apply the Scope Gate first. A review authorizes diagnosis, not an unrequested rewrite.

## Project Authority

Project-documented prose policy governs voice, terminology, shape, and punctuation. When no designated project standard exists, use this playbook's defaults. Explicit current instructions and the authoritative project hierarchy remain controlling. Project policy and generic defaults cannot override safety, accepted architecture, verified facts, evidence requirements, or verification gates.

## Intent

Protect meaning before style and spend context in proportion to the defect. A small edit gets the core pass; longer prose earns a sibling only on its objective trigger.

Remove prose that costs the reader time and returns nothing, but do not flatten a working voice to disguise authorship. Readability and truth are the goals.

## Scope Gate

Apply this before editing. Running the rules on an exempt surface is harmful because its exemptions are load-bearing.

Resolve conflicts in this order: verified facts and safety; the user's task, audience, and required meaning; project-documented style and supplied voice; this playbook's defaults. Integrity outranks style. Lower layers never change higher ones.

| Surface | Rules apply? |
|---|---|
| Release notes, changelog prose, review and report narrative | Yes |
| Decision records, README and documentation prose | Yes |
| Issue and pull-request bodies, commit message bodies | Yes |
| `ISSUE.md`, milestone narrative, and testing-plan narrative | Yes |
| Learning-loop entry bodies (footguns, lessons, patterns, decisions) | Yes - body prose only |
| Review comments and replies to a person | Correctness and residue only |
| Code comments and docstrings | No - see `code-comments.md` |
| Skill files, playbooks and other agent-read references, shared preambles, instruction files, hook output | No |
| Code blocks, fixed schema fields, task/proof checklists, commands, approved requirements and acceptance/proof/verification/exit criteria, tables, INDEX and catalogue formats | No |
| Direct quotations, cited titles, and examples of a pattern | No |

**Mixed planning artifacts.** Apply the prose rules to `ISSUE.md` bodies and the Objective, Context, Scope, assumptions, rollback, and testing-rationale prose in milestone or testing-plan output; the exempt rows cover the rest, including deliberate control repetition.

If an exempt control surface conflicts with a source of truth, report the discrepancy to the owning workflow; do not silently rewrite it as style work.

**Replies are deliberately narrow.** Apply only the correctness pass and residue checks. The social-meaning guard and Colleague check constrain even those edits; no other style rule applies unless the user asks.

**Why agent-read control text is exempt.** In a skill, playbook, preamble, or instruction file, emphasis and repetition are compliance mechanisms. Route problems there to the file's own contract.

**Why learning-loop entry bodies are in scope.** People verify these entries, so body prose follows the rules. Retrieval machinery stays exempt: frontmatter, schema lines, anchors, and generated INDEX files.

**Why parallel forms and examples are exempt.** Uniformity is useful in tables, code, and catalogues. Examples are exempt from stylistic rewriting, not correctness, syntax, or security.

## Diagnostic Router

Run the core gates in this file first. Load one sibling only when the draft shows its objective trigger:

- Load [`writing-sentence-diagnostics.md`](./writing-sentence-diagnostics.md) when a sentence-level reader cost remains after correctness: assistant framing, vague inflation, unclear actors, leaked scaffolding, repeated cadence, punctuation residue, or a mismatch between the prose and what its reader already knows.
- Load [`writing-structure-diagnostics.md`](./writing-structure-diagnostics.md) when a document-level assembly defect remains: duplicated representations, append seams, compound list entries, non-parallel lists, padded triads, irrelevant chronology, or an order that hides causality and action.
- Load `changelog.md` or `release-notes.md` before either diagnostic when that surface owns audience, version, release state, or output shape. Surface policy decides what belongs; diagnostics may only refine prose already admitted by that owner.

Do not load either diagnostic playbook for a small edit that passes the minimum core checks. Counts, detector scores, or a wish to make prose feel less generated are not objective triggers. If both triggers exist, repair structure before sentences.

The router grants no rewrite authority. Keep scope and apply the lightest effective edit.

## Correctness and Meaning

Run this before every style rule on every in-scope surface, against the source of truth: the diff, manifest, issue, decision, evidence, or cited source described.

- Correct typos, wrong word forms, dangling subjects, and broken parallelism.
- Check names, numbers, units, versions, flags, options, and paths; a code identifier named in prose must resolve in a fresh clone - never a gitignored path - and a diagram abbreviation is marked or spelled out once.
- Open a cited document, issue, or benchmark and confirm it supports the claim.
- When prose describes code behaviour, open the function, query, or getter it describes and confirm the claim; code is a citation like any other.
- Match claim strength and specificity to the evidence. Do not inflate a narrow result or hedge a supported conclusion.
- A scope claim is checked against the diff. `comments only` is false when the diff changes executable code, configuration, or schemas. `no behavioural changes` needs implementation evidence; a rename may be non-behavioural but is never `comments only`.
- Connect named attribution to a specific inspectable point; otherwise name the evidence or remove the prestige cue.
- Preserve claims, constraints, uncertainty, and provenance. Do not turn a proposal into a decision, an assumption into a fact, an optional action into a required one, or a planned or pending check into a passed check.

A fluent false sentence is worse than a clumsy true one. Style never outranks this gate.

## Before Editing Existing Prose

Classify source material as human-authored, generated, mixed, or unknown. Protect strong human passages; edit them only for correctness or a diagnosed defect. Quirks, abruptness, and interpersonal softeners are not defects by themselves. In mixed prose, repair weak generated passages without smoothing the protected ones into one register.

Unknown provenance starts conservative: lightest effective edit, and ask about authorship only when it changes the result. Rewrite weak generated prose from verified claims, not synonym substitutions; transcripts supply material, not a shape.

## Audience and Precision

Choose the reader and artifact before changing tone. Do not invent a generic end user or a UI. Preserve what the actual reader knows, can do, and needs; neutral and conventional are valid voices.

**Precision is not a defect.** Exact versions, flag names, error strings, counts, measurements, and paths are often the highest-value content. Do not generalise a number or swap an identifier for a category word so prose reads as less mechanical. A reader searching for `--no-cache` needs the flag, not "the relevant option".

Use one canonical noun per technical referent. Synonym cycling can make one surface look like three. Retain necessary terminology, hedging, citations, and causal relationships. Remove detail only after the surface owner establishes that the reader does not need it.

**Replies to people carry social meaning.** Hedges, softeners, sentence boundaries, and punctuation can express uncertainty, warmth, or a checking question. The Scope Gate sets the permission. Do not split a sentence about someone's work when the split would turn a qualified observation into an accusation. Apply the Colleague check before sending.

Put the decision, behaviour, or action where the reader can find it, but never trade a true public detail for a smooth abstraction.

## Integrity

These outrank every style rule here. A more readable document that breaks one of them is a worse document.

- **Never invent an incident, example, metric, quotation, or name.** Not for illustration, not to make a point land. This is the hardest rule to keep, because invented specifics always read better than missing ones.
- **Never manufacture point of view or texture.** Preserve opinions, uncertainty, humour, irritation, and limitations when the source owns them; otherwise leave them out.
- **An illustrative example must be labelled as illustrative.** A placeholder scenario that reads as a real event becomes evidence in the next reader's hands.
- **Prefer a visible placeholder to a fabricated detail.** `[NEEDS REAL EXAMPLE]` blocks a release. A convincing invention does not, and ships.
- **Never describe agent-written text as human-authored.** Editing prose so it reads well is legitimate; claiming a person wrote it is not.
- **Readability is the goal.** A rule applied to defeat authorship detection was applied for the wrong reason and produces worse prose.

## Quick Tests

Run these on the finished draft. On longer work, use the first test before sentence edits; a failure needs facts, not polish.

1. **Fifty-subjects swap, at document level.** Could this document survive its subject being replaced by fifty others? If yes, it needs facts, not a style pass.
2. **So-what ladder.** Chase each claim with "so what?" until the answer is something only this project could say. Stop there, or delete the claim.
3. **Reader/action check.** Does the artifact name the behaviour or decision, affected surface, consequence, evidence, required action, and completion condition? A decision record states the strongest case for a rejected option before saying why it lost.
4. **Colleague check.** For a reply to a person, would the exact sentence preserve the intended confidence and social meaning if sent to a colleague?
5. **Substitution test.** Swap the subject for a neighbouring concept. If the sentence still reads cleanly, that raises suspicion, not proof; open the source and verify it.

For substantial work, a fresh reader may check that decision, action, and uncertainty survive without drafting context; do not add a reviewer without authorization.

## Minimum Pass

For a small in-scope edit, stop after these checks unless a diagnostic trigger is visible:

1. Open the source of truth and correct factual or grammatical errors.
2. Preserve status, requirement level, uncertainty, attribution, identifiers, and the reader's required action.
3. Classify the incumbent prose and protect a working voice.
4. Remove only obvious residue or text that returns no information.
5. Run the Scope Gate and one relevant Quick Test against the actual result.

The minimum pass is not a shortened rewrite. If the requested change is already satisfied after correctness, leave neighbouring prose alone.

## Stop Rules

If the minimum pass is clean, stop editing. Also stop when the next change would be preference rather than a diagnosed reader cost, when the source cannot support a stronger statement, or when an exemption owns the text. Report an unresolved factual conflict to the artifact owner instead of smoothing it away.

Do not run the sentence or structure playbook merely because it exists. Continued editing converges documents toward one flat register and spends context without improving the reader's decision.

## Verification Gate

Walk this once against the actual draft. Do not mark an item clean from memory.

1. Scope Gate, reader, and source classification applied; no exempt surface edited for style.
2. Names, numbers, units, versions, flags, paths, claim strength, attribution, and cited claims match the source of truth; no identifier or term generalised for smoothness.
3. Meaning preserved: status, requirement level, uncertainty, and provenance unchanged; no planned check became passed.
4. Every example, metric, incident, and quotation is real or labelled illustrative.
5. Protected passages retain their voice and social meaning; agent-written prose is not called human-authored.
6. The minimum pass and relevant Quick Tests ran against the actual draft.
7. Any loaded diagnostic sibling passed its own Verification Gate; an unloaded sibling had no objective trigger.

If the gate passes, stop editing.

## Related References

- `writing-sentence-diagnostics.md` - sentence-level reader costs after the core pass.
- `writing-structure-diagnostics.md` - document-level assembly defects before sentence work.
- `changelog.md` - audience, version state, categories, and cadence for changelog entries.
- `release-notes.md` - audience, evidence selection, and output shape for release narratives.
- `code-comments.md` - code comments and docstrings; this playbook applies only its correctness and integrity gates to that prose.
