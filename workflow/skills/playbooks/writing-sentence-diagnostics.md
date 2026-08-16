---
goat-flow-reference-version: "1.15.1"
---
# Writing Sentence Diagnostics

Load this only after `writing-style.md` identifies a sentence-level reader cost. It diagnoses sentences without guessing authorship or authorizing a broad rewrite.

## Availability Check

This is a documentary discipline, not a runnable tool. Confirm the draft is an in-scope human-read surface and that the core correctness pass is complete. Mechanical searches may locate candidates, but no detector proves a defect. If the trigger is document assembly rather than a sentence, use `writing-structure-diagnostics.md` instead.

## Project Authority

Project-documented prose policy governs voice, terminology, shape, and punctuation. When no designated project standard exists, use this playbook's defaults. Explicit current instructions and the authoritative project hierarchy remain controlling. Project policy and generic defaults cannot override safety, accepted architecture, verified facts, evidence requirements, or verification gates.

## Intent

Find the smallest sentence edit that lowers a concrete reader cost while preserving facts, voice, social meaning, and exact public detail. Labels describe observable effects, not whether a person or an agent wrote the text.

## Diagnostic Route

Name the reader cost before editing: the sentence delays its claim, assigns action to the wrong actor, explains knowledge the reader already has, inflates significance, hides a regression, leaks drafting residue, or repeats a cadence that obscures priority.

Use a component as the actor when the component performs the action. Name a person or team only when responsibility is relevant and evidenced. Do not turn a system behaviour into a claim about what people chose, believed, or intended. Passive voice is valid when the actor is unknown, irrelevant, or deliberately withheld.

Read the sentence with its neighbours. A local rewrite is wrong if it breaks a qualification, separates cause from consequence, or changes how a statement about someone's work lands. Record one primary cost when labels overlap, then edit from verified meaning.

## Register

Choose register from the artifact, actual reader, and supplied voice. Neutral and conventional are valid voices; do not decorate them for distinctiveness.

- Documentation and decisions stay plain about ownership, evidence, and uncertainty.
- Reports and reviews retain necessary terminology, hedging, citations, and causal relationships.
- Release and changelog prose follows its surface owner's audience and fact-selection gates.
- Replies to people receive correctness and residue work only unless the user asks for tone changes.

Ask what the reader already knows from the surrounding artifact, product surface, and request. If the reader already knows a term or premise, Do not define it again. If the knowledge is uncertain, preserve the explanation or verify the audience before cutting it.

## Fix on Sight

These patterns diagnose reader cost, not authorship. A found phrase is only a candidate. Edit when its actual use imposes the named cost, and rewrite from verified meaning rather than synonym substitution.

**Assistant voice.** Remove chat scaffolding from documents: `Here's how I'd think about it`, `Let me walk you through`, or `In conclusion` before a restatement. In a real reply, those phrases may carry useful social meaning and are not automatic defects.

**Announcing before doing.** A sentence that merely promises the next sentence can usually go. Keep orientation that supplies scope, risk, or navigation the heading does not.

**Significance inflation.** Replace unsupported importance, confidence, or celebration with the behaviour and consequence. A verified measurement or explicit user reaction may support emphasis; the shape alone does not.

**Authority frames.** Phrases such as `the real question` or `what really matters` add cost when the sentence would make the same claim without them. Keep a frame that distinguishes the current question from a plausible competing one.

**Uniform positivity.** State a visible regression, limitation, or unresolved risk plainly. Do not add reassurance merely to make every paragraph resolve upward.

**Canonical terminology.** Use one noun per technical referent. Repeat it or use an unambiguous pronoun instead of rotating among near-synonyms.

**Residue.** Remove leaked scaffolding, shipped placeholders, tracking parameters on pasted links, broken Markdown, and broken dash spacing. Re-read the repaired sentence so deletion does not weld neighbouring words together.

## Guards Against Misapplication

**Ordinary writing habits are not defects.** Conjunction openers, clean grammar, understatement, short sentences, long sentences, and mixed casual and formal register can all be appropriate. Diagnose the cost in context.

**Counts do not decide.** AI-density, banned-word, and rhythm counts are suspicion signals only. They never diagnose a defect, authorize an edit, or produce a pass/fail result. Use a count to locate a passage, then read it and apply the same evidence gate as any other candidate.

**Punctuation carries meaning.** For new or edited prose, follow active project punctuation policy. Do not run a broad punctuation sweep. Preserve direct quotations, code, approved titles, and untouched history. An em dash, semicolon, fragment, or repeated sentence length is not independently a defect.

**Replies carry social cost.** Hedges, softeners, and a checking question can preserve uncertainty or warmth. Do not split a sentence about a person's work when the split makes it sound accusatory.

## Quick Tests

1. **Read it aloud.** Mark the place where meaning or breath fails, not every long sentence.
2. **Feelings check.** If the sentence tells the reader how to feel about a fact, state the fact unless the reaction is sourced.
3. **Actor check.** Can the named subject perform the verb, and is human responsibility evidenced?
4. **Knowledge check.** Does the explanation answer a likely question, or repeat what this reader already knows?
5. **Neighbour check.** Did the edit preserve qualifications, cause, consequence, and social meaning across sentence boundaries?

## Worked Example

**Illustrative example (not evidence of a real release).**

Before: `This important update improves reliability, ensuring teams can confidently export their work.`

After: `The exporter retries once after a storage timeout. If the retry fails, it preserves the draft and names the unwritten file.`

The revision assigns actions to the component and replaces unsupported importance and reassurance with observable behaviour. It would still be invalid if those behaviours were not verified.

## Verification Gate

1. The core correctness and scope gates passed before this playbook loaded.
2. Every edit names a concrete reader cost and preserves verified meaning, voice, uncertainty, and public identifiers.
3. Actors can perform their verbs; people or teams appear only when responsibility is relevant and evidenced.
4. No lexical, density, rhythm, or punctuation count became a verdict.
5. Direct quotations, code, social meaning, and strong incumbent prose remain protected.
6. The Quick Tests ran against the edited sentences in context.
7. Once the diagnosed costs are gone, stop.

## Related References

- `writing-style.md` - required core correctness, scope, and routing owner.
- `writing-structure-diagnostics.md` - document-level assembly defects that should be repaired first.
- `changelog.md` and `release-notes.md` - release-surface audience and output owners.
