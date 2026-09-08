---
category: skill-trial-evidence
last_reviewed: 2026-09-08
---

**Scope:** Skill-trial evidence: validate produced output, observe the action behind a behavioural claim, and run every evaluation fixture.
General evidence claims belong in [agent-evidence-claims.md](agent-evidence-claims.md).

## Lesson: Score a skill's output grammar with its validator, not by reading the report

**Status:** active | **Created:** 2026-09-07 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** When a milestone's success criterion is that produced output validates, the acceptance test is the validator's result on produced output, and by-eye grammar scoring is a lead only.
**Trigger phase:** SCOPE
**Caught at:** VERIFY

**Prevention:** Before scoring any produced report as conforming, save it and run the repository's validator on it; score from the violation list. Do this on the baseline runs too, so the failure classes you register are the ones the parser enforces rather than the ones you noticed. When a produced report cannot reach the validator under its run conditions, say the grammar claim is unverified rather than scoring it by inspection.

**What happened:** Twelve isolated goat-review runs were scored by reading. Four format classes looked fixed between baseline and candidate. Running `goat-flow review validate-draft` on one candidate report afterwards returned 12 violations. Two were regressions the candidate wording had caused: a sentence saying Pass 2 refutations "carry no R-ID" had led three runs to drop refuted IDs from the disposition map, and a rule against inventing tokens had led four runs to park disclosures as extra evidence keys. Five further classes had gone unregistered because no eye caught them: code-span-wrapped JSON and a dropped literal `exactly once` in every one of the twelve reports, an empty `Gate authority` object, extra evidence keys, and conclusion precedence. The milestone had predicted this exact failure in its own stop condition, "measuring compliance by cited text while the agent skips the corresponding code check".

**Root cause:** The parser's grammar is literal and the reviewer's reading is semantic, so a report that means the right thing can fail every row. Evidence anchors: `src/cli/review-validate-common.ts` (search: `FULL_REVIEW_SIZE_VALUE`), `src/cli/review-validate-sections.ts` (search: `validateFinalDispositions`), and the corrected root `workflow/skills/goat-review/SKILL.md` (search: `refutations keep a distinct R-ID`).

## Lesson: A structural gap in skill text is not evidence of a behavioural gap

**Status:** active | **Created:** 2026-09-07 | **Evidence:** OBSERVED
**Decision changed:** Bind behavioural claims to an observed decision or action; neither missing wording nor correct recitation proves how an agent uses guidance. Run the baseline before sizing a behavioural correction.

**Prevention:** Search the skill text for the route, then test the behaviour anyway. Score application on the report's own opened-file trace, never on detection alone, because a seeded defect can be reachable by another path. Keep the seeded rule out of the fixture's code comments; a docstring that states the invariant makes the defect generically discoverable and the fixture stops discriminating. If the baseline passes, record the KEEP and reduce the task to a pointer or nothing; the iron law forbids a new mandatory rule with no failing test behind it.

Before ticking any RUNTIME or [agent-evaluated] proof item, name the specific decision or action the trial required, the observable outcome, and its supporting artifact or trace, distinct from wording reproduced. If the trial only elicits quotation or explanation, the behavioural claim is **UNVERIFIED** and stays unticked even when every mechanical gate is green. Correct attribution may earn an explicit traceability criterion only. Identify prompting in the claim: asking both arms to flag disagreement permits a prompted comparison, not an unprompted failure rate. When both arms already make the correct decision, report preservation or reduced ambiguity rather than claiming a wrong decision was fixed.

**What happened:** A milestone sized its two largest tasks on the premise that reviewers miss a project's own coding standards, supported by a grep showing the shipped skill had no route to them. The baseline runs disproved the premise: with a fixture project whose instruction file named its standards directory, every applicable run found the rules, cited them, applied them to code decisions, and left two documented exceptions alone. The route the skill text lacked was supplied by the reviewed project's instruction file and the shared preamble's INDEX-first retrieval. One seeded rule-only defect was also found in a project with no standards at all, through a docstring in the fixture's own constants module that stated the invariant, so detection had to be discounted and the trace used instead. With approval, the two tasks shrank to a heading fix and one sentence, and the effort moved to format failures the same runs had measured.

**Root cause:** Absence in one document was read as absence in the system; the converse error treats corrected wording as demonstrated behaviour. Skills run inside instruction files, preambles and project guidance. The evidence must show the resulting action, not just one layer's text. Evidence anchors: `.goat-flow/skill-docs/skill-quality-testing/tdd-iteration.md` (search: `Score application, not citation`), `.goat-flow/skill-docs/skill-preamble.md` (search: `Learning-Loop Retrieval`), `workflow/skills/goat-review/SKILL.md` (search: `**Project guidance:**`).


**Recurrence 2026-09-07:** The original M29 review record credited redaction, recovery and learning-entry application from retrieval answers. It preserved green mechanical results while the later review withdrew those original application claims; section identity supported a static preservation claim only. No original linked action receipts supported the behavioural promotion. The prompted-disagreement limitation belongs to the neighboring M40 debug comparison: both arms were asked to flag conflicts, and some already reached the same correct decision. These records support the action-versus-citation discriminator; no unprompted failure rate was established. Tracked rule: `.goat-flow/skill-docs/skill-quality-testing/tdd-iteration.md` (search: `Score application, not citation`, `Bad vs good scenarios`); it already requires the produced diff, decision or report to demonstrate the outcome.


---

## Lesson: Evidence tooling is evidence, so run the fixture and re-derive every count

**Status:** active | **Created:** 2026-09-07 | **Evidence:** OBSERVED
**Decision changed:** Execute every evaluation fixture and re-derive run counts from artifacts before any claim rests on them; a scorer and its fixtures are graded material, not scaffolding.
**Trigger phase:** VERIFY
**Caught at:** VERIFY

**Prevention:** Before an evidence record is offered for approval, run each fixture's own test suite and confirm every expected failure is one you designed. Before reporting a completed-run total, reconcile unique evaluator session IDs with their terminal results and required artifacts. Count registered, started, completed and blocked runs separately; multiple case/arm results from one invocation are not independent runs, and a continuation does not create a fresh session. Map each proof item to completed case IDs and supporting outputs; an aggregate count cannot cover an unrun case. Give each scorer a deliberately wrong input per fixture and confirm it fails, because a scorer proven only against a passing input has not been proven at all. When a scorer and a report disagree, read the report rows first: the scorer is the newer, less reviewed artifact.

**What happened:** A self-audit of 1.17.0 M25, requested before approval, found five defects in work already reported as verified. The evidence record claimed "five isolated runs" when the runner logs showed four, and claimed three of them were mis-scored on the first pass when all four were. An F1 fixture asserted `roundToCents(1.005) === 1.01`, which is false because `1.005 * 100` is `100.49999999999999`; the fixture had never been executed. Two F2 fixture tests called `assert.snapshot`, which does not exist on `node:assert`. The F2 scorer matched behaviours only by symbol, so a report that split one function into invariant rows labelled by file and branch scored a false failure, which also showed the original pass had been partly luck. One F2 criterion forbade `NONE` anywhere in a file whose uncovered invariants correctly carried it.

**Root cause:** The fixtures and scorer were treated as apparatus rather than as claims. Every rule applied to the thing under test, that assertions are verified before they are believed and counts are derived rather than recalled, applies equally to the instrument doing the testing. Recurrence is likeliest when a scorer is corrected mid-run: four scorer corrections were needed across M25's four runs, each found by reading flagged rows rather than trusting the number and each re-proved against golden and wrong inputs before the result was accepted. Evidence anchors: `.goat-flow/skill-docs/skill-quality-testing/tdd-iteration.md` (search: `Score application, not citation`), `test/contract/skill-hardening-skills-2.test.ts` (search: `defines each goat-qa coverage depth by the evidence that earns it`).


**Recurrence 2026-09-07 (shared-guidance review):** The M29 application-proof mistake is recorded under `A structural gap in skill text is not evidence of a behavioural gap`. Its repair omitted the pending report from the first two persistence fixtures; both evaluators correctly stopped before writing. Record those as blocked fixture runs, supply the missing input, and preserve the proof gate. Preflight fixture prerequisites before delegation, and score the requested action rather than a rule citation. The repair scorer also mistook an extra valid proof checkbox and absence of the word `retrospective` for failures. Read the actual task identities and resulting entry; automate exact byte/state/schema checks, not keyword proxies for semantic decisions. The approval continuation also matched a hooks-file digest against the main Codex config until rereading the recorded pair. Keep the source path and expected digest together when checking continuity; a valid hash attached to the wrong file reports false drift. Evidence: `workflow/skills/goat-review/references/examples.md` (search: `Pre-persistence Proof Envelope`) and `.goat-flow/skill-docs/skill-quality-testing/tdd-iteration.md` (search: `Score application, not citation`).


**Verification boundary 2026-09-07:** The available M40 record lists eight case/arm results but explicitly identifies six evaluator sessions; counting its rows as independent runs would inflate the total. Tracked protocol: `.goat-flow/skill-docs/skill-quality-testing/tdd-iteration.md` (search: `report only current-run counts`, `Before running trials`).


