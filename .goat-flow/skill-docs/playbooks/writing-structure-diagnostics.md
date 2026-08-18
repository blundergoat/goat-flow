---
goat-flow-reference-version: "1.16.0"
---
# Writing Structure Diagnostics

Load this after `writing-style.md` identifies a document-level assembly defect. Repair shape before sentence polish so discarded sections do not consume review effort.

## Availability Check

This is a documentary discipline, not a runnable tool. Confirm the artifact is an in-scope human-read surface, read it as a whole, and complete the core correctness pass first. If the cost exists inside otherwise sound sentences, route to `writing-sentence-diagnostics.md`.

## Project Authority

Project-documented prose policy governs voice, terminology, shape, and punctuation. When no designated project standard exists, use this playbook's defaults. Explicit current instructions and the authoritative project hierarchy remain controlling. Project policy and generic defaults cannot override safety, accepted architecture, verified facts, evidence requirements, or verification gates.

## Intent

Make the document's hierarchy, causality, and action visible without deleting distinct facts or forcing intentionally parallel controls to vary. Diagnose an observable navigation or comprehension cost, not a template-like appearance.

## Diagnostic Route

Map each section or list item to its unique job. Mark facts that appear more than once, late additions that bypass the established order, entries carrying several unrelated claims, and sequences whose chronology hides cause. If the map is sound, stop and leave sentences to their owner.

Preserve required schemas, project conventions, reader-facing categories, and facts before consolidating. A shorter document that loses one distinct risk, action, limitation, or version fact is not cleaner.

## Structure

**Duplicate representation.** The same content appears as prose, then a table, then bullets. Keep the representation that best serves comparison, sequence, or explanation; preserve any unique fact from the others.

**Append seam.** A late paragraph or bullet repeats an earlier topic because it was added where the writer stopped rather than where the reader expects it. Merge it with its owner or move it beside the premise it qualifies.

**Compound entries.** One bullet contains several independent behaviours, risks, or actions. Split it only when each part deserves separate scanning, classification, or ownership. Do not split a causal unit merely to shorten it.

**Parallel lists.** Items at one level must represent the same kind of thing. Separate actions from evidence, benefits from constraints, or symptoms from causes when mixing them makes comparison false. Parallel grammar is useful when the underlying units are parallel.

**Causal prose.** Put the observed behaviour before its consequence and the required action after the reason for it. Keep a dependency or qualification next to the claim it changes.

**Padded triads.** Three adjacent headings or bullets may be one real distinction plus two restatements. Keep every independently useful fact; remove only members whose deletion changes no decision or action.

**Process bleed.** Write verified facts in the reader's order rather than narrating the drafting session. Keep chronology only when the sequence explains a cause or constraint. Inspection order is not automatically product behaviour.

**Repeated templates.** Catalogue-shaped repetition is exempt when the repeated option-and-tradeoff shape improves scanning. Repetition is defective only when it hides priority, causality, or a missing distinction.

**Reference labels.** A bold label is useful when the sentence adds information the label cannot carry. Reference-list labels remain valid; remove a line only when the label and body are genuine restatements.

## Guards Against Misapplication

**Tables and code are intentionally parallel.** Do not vary a row, schema example, or command merely to make it feel less mechanical.

**Plan uniformity is control grammar.** Status fields, task and proof checklists, exit criteria, and repeated gates are execution interfaces. Do not consolidate away required control repetition.

**History can be causal evidence.** Preserve chronology in incident reports, migrations, decisions, and release history when order establishes responsibility, compatibility, or why a constraint exists.

## Quick Tests

1. **One-job map.** Can each section or item state its unique reader job in one phrase?
2. **Deletion test.** Would removing this representation lose a distinct fact, comparison, risk, or action?
3. **Append test.** Does the ending introduce a topic whose owner appeared earlier?
4. **Parallelism test.** Are neighbouring items comparable units rather than mixed actions, evidence, and outcomes?
5. **Causality test.** Can the reader distinguish what happened, why it matters, and what to do next?

## Worked Structural Examples

**Illustrative examples (not evidence of real documents).**

- Append seam: a final "Authentication" bullet moves into the earlier authentication section instead of creating a second owner.
- Compound entry: one bullet about a new flag and an unrelated timeout fix becomes two entries because they have different affected users and release categories.
- Preserved parallelism: a configuration table keeps identical row grammar because variation would make comparison harder.

## Verification Gate

1. The core correctness and Scope Gate passed before structural edits.
2. Every consolidation preserves unique facts, public detail, qualifications, chronology, and required actions.
3. Section and list units have truthful ownership and comparable levels.
4. Tables, schemas, catalogues, and plan controls retain useful parallelism.
5. Sentence-level issues were not used to justify unrelated structural rewriting.
6. The Quick Tests ran on the resulting whole document; once the diagnosed assembly costs are gone, stop.

## Related References

- `writing-style.md` - required core correctness, scope, and routing owner.
- `writing-sentence-diagnostics.md` - sentence work after structure is sound.
- `changelog.md` and `release-notes.md` - release-specific structure and audience owners.
