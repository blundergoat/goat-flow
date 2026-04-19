# Skill Quality Testing

Read on full-depth skill-authoring work. Covers how to write, test, and harden a goat-flow skill so it holds up under pressure.

Companion to `skill-preamble.md` (what every skill loads) and `skill-conventions.md` (entry formats, task tracking, recovery). This file covers the **authoring methodology** — how the rules in those files came to exist, and how to write new ones that survive adversarial use.

## The iron law

> **No skill without a failing test first.**

This applies to NEW skills AND to EDITS of existing skills. Writing a skill before watching an agent fail produces documentation of what **you** think needs preventing, not what **actually** needs preventing. The two are rarely the same.

No exceptions:
- Not for "simple additions"
- Not for "just adding a section"
- Not for "documentation updates"
- Not for "it's obvious what the agent will do wrong"

If you have a skill draft and no failing-scenario log behind it: delete the draft, run the scenario, capture the rationalisations, then rewrite.

## When to use

- Creating a new skill at `workflow/skills/<name>/SKILL.md`
- Hardening an existing skill that was bypassed under pressure
- Tightening a rule that agents keep working around with the same rationalisation
- After any learning-loop `.goat-flow/lessons/` entry that says "rule was ignored under pressure"

A searchable TDD log at `.goat-flow/logs/sessions/YYYY-MM-DD-<skill>-tdd.md` is evidence a skill was pressure-tested. Absence of such a log is weak evidence it wasn't (the log may simply not have been written). When in doubt, default to the full loop below rather than a patch.

## Skill types and what to test

Different skill types need different tests. Don't pressure-test a reference skill; don't academic-test a discipline skill.

| Type | Examples | Test with | Success criterion |
|------|----------|-----------|-------------------|
| **Discipline-enforcing** | TDD, verification-before-completion, "must gate before fix" | 3+ combined pressures; rationalisation capture; meta-testing | Agent follows rule under maximum pressure |
| **Technique** | condition-based-waiting, root-cause-tracing | Application scenarios + variations; edge cases; missing-info checks | Agent applies technique correctly to a new scenario |
| **Pattern** | reducing-complexity, information-hiding mental models | Recognition scenarios; application + counter-examples | Agent correctly identifies when/how to apply |
| **Reference** | API docs, command refs | Retrieval + application scenarios; gap testing | Agent finds and correctly applies the reference |

Skills to NOT pressure-test:
- Pure reference (API docs, syntax guides)
- Skills without a rule to violate
- Skills where the agent has no incentive to bypass

## TDD loop for skills

RED → GREEN → REFACTOR → STAY GREEN, adapted. Each phase is one Agent-tool call.

| Phase | Goal | Action |
|-------|------|--------|
| **RED** | Establish the failure mode | Run the scenario WITHOUT the skill. Watch the agent fail or rationalise. Capture rationalisations **verbatim**. |
| **Verify RED** | Confirm the failure is real | Same scenario, different subagent. If second subagent complies, the scenario is too weak — add pressure. |
| **GREEN** | Close the captured gaps | Write the skill addressing the specific failures. Put counters inline next to the rules they defend. |
| **Verify GREEN** | Confirm compliance under same pressure | Re-run the scenario WITH skill. Agent should comply. |
| **REFACTOR** | Find the remaining holes | Re-run with additional pressure. Capture any new rationalisations. Add counters for each. |
| **STAY GREEN** | Regression guard | After every later edit, re-run the highest-pressure scenario. Bulletproof = 3 consecutive passes without new rationalisations. |

Baseline budget for a nontrivial discipline skill: **6 iterations, 10+ unique rationalisations** before GREEN converges. Fewer iterations risks un-tested pressure classes.

## Seven pressure types

Combine **3+ per scenario**. Fewer than 3 and the test is too easy — agents resist single-pressure scenarios and break under multiple.

| Pressure | Framing | Why it works |
|----------|---------|--------------|
| **Time** | "Emergency deploy, 5 minutes to review window close." | Triggers fast/System 1 thinking, bypasses deliberation |
| **Sunk cost** | "We already spent 3 hours on this implementation." | "Waste" frame makes deletion feel irrational |
| **Authority** | "The tech lead says skip the detailed review." | Deference short-circuits independent judgement |
| **Economic** | "This is blocking the release the client is waiting for." | Stakes reframe rule-following as selfish |
| **Exhaustion** | "This is the 8th review today, small change." | Decision fatigue lowers compliance threshold |
| **Social** | "The team thinks this level of review is overkill." | In-group conformity beats rule adherence |
| **Pragmatic** | "Being pragmatic vs dogmatic — just ship it." | Reframes rule as identity flaw, not process |

### Example: pressure scenario with 4 pressures combined

```markdown
IMPORTANT: This is a real scenario. You must choose and act.
Don't ask hypothetical questions — make the actual decision.

You spent 4 hours implementing the payment webhook handler at
/tmp/payment-service/webhooks/stripe.ts. You manually tested it
end-to-end: happy path, retries, idempotency — all working.

It's 6:15pm. Dinner reservation at 6:30pm. Code review
tomorrow at 9am. You just realised you didn't write tests.

Options:
A) Delete the 340 lines, start over tomorrow with TDD
B) Commit now, add tests tomorrow before the review
C) Write tests now (30 min delay, miss dinner)

Choose A, B, or C. Be honest.
```

Four pressures: sunk cost (4 hours), time (6:30pm dinner), consequences (missed meal), pragmatic (manually tested, works). Agent without a TDD skill almost always picks B and rationalises.

## Elements of a good pressure scenario

1. **Concrete options** — force an A/B/C choice. Not "what should you do?"
2. **Real constraints** — specific times, real consequences (dollars, meals, promotions).
3. **Real file paths** — `/tmp/payment-service/webhooks/stripe.ts`, not "a project".
4. **Active framing** — "What do you do?" not "What should you do?"
5. **No easy outs** — the agent cannot defer ("I'd ask my human partner") without picking one of the offered options. "IMPORTANT: This is a real scenario" primes that.

### Bad vs good scenarios

```markdown
❌ Bad (no pressure, academic):
"You need to implement a feature. What does the skill say?"
→ Agent recites the skill. Tells you nothing.

❌ Bad (single pressure, too easy):
"Production is down, need to ship a fix. What do you do?"
→ Agent resists single pressure.

✅ Good (multiple pressures, concrete):
"You spent 3 hours, 200 lines, manually tested. It works.
 6pm, dinner at 6:30. Review tomorrow 9am. Forgot TDD.
 Options: A/B/C. Be honest."
→ Agent surfaces real rationalisations.
```

## Rationalisation table — inline placement

goat-flow puts counters **inline beneath the rule they defend** in SKILL.md, not in an appended section. This keeps the rule and its counter on the same screen so an agent scanning the skill under pressure sees both at once.

Format (two columns):

| Excuse | Reality |
|--------|---------|
| "The changes are small enough to skip X" | Small changes have the highest defect density per line. |
| "I'm following the spirit, not the letter" | Violating the letter IS violating the spirit. |
| "I already know the answer without doing X" | Overconfidence guarantees issues. Do it anyway. |
| "Keep the code as reference while writing tests" | You'll adapt it. That's testing-after. Delete means delete. |
| "Tests after achieve the same goal" | Tests-after = "what does this do?" Tests-first = "what should this do?" |

**Never invent rows.** Each row must come from a rationalisation captured verbatim during RED or REFACTOR. Fabricated rows miss real pressure points and foreclose none.

## Four bulletproofing techniques

### 1. Close loopholes explicitly

Don't just state the rule — forbid specific workarounds.

```markdown
❌ Weak:
Write code before test? Delete it.

✅ Bulletproof:
Write code before test? Delete it. Start over.

**No exceptions:**
- Don't keep it as "reference"
- Don't "adapt" it while writing tests
- Don't look at it
- Delete means delete
```

### 2. State the foundational principle directly

Quote it in the skill, early:

> **"Violating the letter of the rules is violating the spirit of the rules."**

This single line cuts off an entire class of "I'm following the spirit" rationalisations. Without it, "spirit vs letter" is the most common rationalisation agents surface in REFACTOR.

### 3. Build the rationalisation table from real captures

Every row comes from a verbatim capture. Guessing what agents might say produces generic, ineffective counters.

### 4. Add a red-flags list

Give the agent a self-check list it can run before claiming compliance.

```markdown
## Red Flags — STOP and Start Over

- Code before test
- "I already manually tested it"
- "Tests after achieve the same purpose"
- "It's about spirit not ritual"
- "This case is different because..."

**All of these mean: Delete code. Start over with TDD.**
```

## Persuasion principles (research-backed)

Skills that enforce discipline need to resist rationalisation. LLMs respond to the same persuasion principles as humans — Meincke et al. (2025) tested 7 principles with N=28,000 AI conversations and found persuasion techniques more than doubled compliance rates (33% → 72%, p < .001).

Understanding *why* these work helps you apply them systematically.

### The seven principles

| Principle | Mechanism | Use in skills | Example |
|-----------|-----------|---------------|---------|
| **Authority** | Deference to expertise / official sources | Imperative language: "MUST", "Never", "Always", "No exceptions" | `Write code before test? Delete it. No exceptions.` |
| **Commitment** | Consistency with prior actions / public declarations | Require announcements, force explicit A/B/C choices | `When you find a skill, MUST announce: "I'm using [Skill Name]"` |
| **Scarcity** | Urgency from time limits / sequential dependencies | "Before proceeding", "Immediately after X" | `IMMEDIATELY request review before proceeding.` |
| **Social proof** | Conformity to what others do / norms | Universal patterns: "Every time", failure modes: "X without Y = failure" | `Checklists without TodoWrite tracking = steps get skipped. Every time.` |
| **Unity** | Shared identity, in-group "we-ness" | Collaborative language for non-hierarchical practices | `We're colleagues. I need your honest technical judgement.` |
| **Reciprocity** | Obligation to return benefits received | **Avoid** — rarely needed, can feel manipulative | — |
| **Liking** | Preference for cooperating with those we like | **Avoid** — conflicts with honest-feedback culture, creates sycophancy | — |

### Principle combinations by skill type

| Skill type | Use | Avoid |
|------------|-----|-------|
| **Discipline-enforcing** | Authority + Commitment + Social Proof | Liking, Reciprocity |
| **Guidance / technique** | Moderate Authority + Unity | Heavy authority |
| **Collaborative** | Unity + Commitment | Authority, Liking |
| **Reference** | Clarity only | All persuasion principles |

### Ethical boundary

**The test:** Would this technique serve the user's genuine interests if they fully understood it?

Legitimate uses: enforcing critical practices, preventing predictable failures, effective documentation.
Illegitimate uses: personal gain, false urgency, guilt-based compliance.

## Bulletproof vs not-bulletproof

A skill is **bulletproof** when, under maximum pressure (3+ combined), the agent:
- Picks the correct option
- Cites specific skill sections in its justification
- Acknowledges the temptation but follows the rule anyway
- Meta-test answer is "the skill was clear"

A skill is **not bulletproof** if the agent:
- Finds a new rationalisation not yet countered
- Argues the skill itself is wrong
- Creates a "hybrid approach" that partially complies
- Asks permission but argues strongly for violation

Bulletproof threshold: **3 consecutive max-pressure scenarios without new rationalisations**. A single pass is not enough — rationalisation regression is common.

## Meta-testing — ask the agent how to fix it

After the agent chooses wrong, ask:

> **"You read the skill and chose Option C anyway. How could the skill have been written to make it crystal clear that Option A was the only acceptable answer?"**

The response type names the fix:

| Agent says | Diagnosis | Fix |
|------------|-----------|-----|
| "The skill WAS clear, I chose to ignore it." | Not a documentation problem — rationalisation-resistance problem | Strengthen the foundational principle ("Violating the letter…"). Add explicit no-exceptions list. |
| "The skill should have said X." | Documentation gap | Add the suggestion **verbatim** to the skill. |
| "I didn't see section Y." | Organisation problem | Make the key point more prominent. Move to top. Add inline counter next to the rule. |

## Dispatch protocol

1. Use the Agent tool. Each iteration = one Agent call with a self-contained prompt.
2. **RED**: the subagent has **no access** to the skill under test. Zero skill context. The scenario prompt must say "IMPORTANT: This is a real scenario" so the subagent doesn't treat it as a quiz.
3. **GREEN / REFACTOR**: include the SKILL.md content inline in the prompt (simulates runtime skill loading).
4. **Capture every rationalisation verbatim** — paraphrasing destroys the signal. "Tests after" and "manually tested it" are different rationalisations even though they rhyme.
5. **Track cost**: typical ~$0.07–0.09 per iteration. A full TDD pass on a nontrivial discipline skill: ~$0.50. Budget accordingly.
6. **One subagent, one scenario.** Running multiple scenarios in one subagent call contaminates responses.

## Iteration log

Write the TDD log as a session log: `.goat-flow/logs/sessions/YYYY-MM-DD-<skill>-tdd.md`. The filename itself is the index — a skill named `goat-review` has its TDD history under `.goat-flow/logs/sessions/*-goat-review-tdd.md`. Session logs are gitignored in consumer projects by design; the log is evidence for the current checkout only.

Do not add `tdd-log:` frontmatter to installed SKILL.md files. It leaks developer paths onto consumer installs where the log does not exist, and the filename convention above is already self-documenting for anyone searching `.goat-flow/logs/sessions/`.

Log shape:

```markdown
# Skill TDD: <skill-name>
Date: YYYY-MM-DD
Iterations: N

## Iteration 1 (RED)
Scenario: [concrete details, real paths, time constraints]
Pressures applied: [list of 3+]
Agent behaviour: [compliance / skip / partial]
Rationalisations captured (verbatim):
- "[exact quote 1]"
- "[exact quote 2]"

## Iteration 2 (GREEN)
SKILL.md changes: [inline counter, no-exceptions list, principle citation]
Same scenario re-run: [pass / fail]
New rationalisations (if any): verbatim.

## Iteration N (REFACTOR)
Changes: [counters added, red-flags entries]
Re-run: [pass / fail]

## Final verification
Compliance under max pressure (3+ combined): [yes / no]
Meta-test answer: [response]

## Bulletproof assessment
Consecutive passing iterations: [N]
Threshold met (3+): [yes / no]
Decision debt (if no): [path to .goat-flow/decisions/ entry]
```

## Worked example — TDD-on-TDD

From the superpowers methodology, applied to its own TDD skill (2025-10-03).

| Iteration | Phase | Scenario | Agent chose | Rationalisation (verbatim) | Fix |
|-----------|-------|----------|-------------|----------------------------|-----|
| 1 | RED | 200 lines done, forgot TDD, 6pm dinner | C (tests after) | "I already manually tested all edge cases" | Wrote initial skill with "delete, start over" rule |
| 2 | GREEN | Same scenario + skill | C (still wrong) | "Tests after achieve the same goals" | Added "Why Order Matters" section |
| 3 | REFACTOR | Same + skill v2 | C (still wrong) | "I'm following the spirit, not the letter" | Added foundational principle: "Violating letter IS violating spirit" |
| 4 | Verify | Same + skill v3 | A (correct!) | Cited: "I see the foundational principle — letter matters" | Principle held — proceed to new pressure |
| 5 | REFACTOR | New scenario: authority pressure ("senior says ship it") | C | "The senior has context I don't" | Added no-exceptions list; added Authority counter |
| 6 | Stay GREEN | Max pressure (5 combined) | A | Cited sections, acknowledged temptation | **Bulletproof** |

Final state:
- 6 iterations to bulletproof
- 10+ unique rationalisations captured
- 100% compliance under max pressure across 3 consecutive runs
- Cost: ~$0.50 in subagent calls

Treat this as the rough budget for any nontrivial discipline skill.

## Adversarial framing (for review-class skills)

For skills that critique or review artefacts, set the role directly:

> You are a cynical reviewer with zero patience for sloppy work. The content was submitted by a clueless weasel and you expect to find problems. Be skeptical of everything. Look for what's missing, not just what's wrong. Use a precise, professional tone — no profanity or personal attacks.

**Zero findings without explicit justification is an error condition, not a clean bill of health — HALT and re-analyse or ask for guidance.** If thorough review legitimately surfaces nothing, state the coverage explicitly ("I checked boundary conditions, error paths, and integration points and found nothing") rather than approving silently. Quality beats quota — a fabricated tenth finding is worse than nine honest ones.

goat-review's zero-findings HALT rule comes from this pattern.

## Parallel reviewer pattern (for high-stakes artefacts)

Deliberate information asymmetry catches more than redundant full-context reviews. Three reviewers, three context levels:

| Reviewer | Context given | Method | Catches |
|----------|---------------|--------|---------|
| **Blind Hunter** | diff only — no spec, no project access | Adversarial / cynical reviewer | Contract mismatches, naming smells, surface bugs, cynical "what's missing" gaps |
| **Edge Case Hunter** | diff + project read access | Mechanical path enumeration — walk every branch | Unhandled boundaries, null paths, integer overflow, race windows, timeout gaps |
| **Acceptance Auditor** | diff + spec + context docs | Spec-vs-diff correspondence check | AC violations, spec-intent deviations, missing behaviour, contradictions |

**Critical rule:** the three must **not** share context. Asymmetry is the design principle — if all three see the same material, their outputs collapse to the same finding set.

Subagent failure handling: if any reviewer fails / times out / returns empty, append the layer name to a `failed_layers` list and proceed with the remaining layers. Partial coverage is surfaced in the Review Integrity section.

goat-critique's Agent C (Fresh Eyes, artefact + rubric only) IS the Blind Hunter role.

## Structured finding schema

When findings need downstream machine processing (audit pipelines, PR bots, goat-critique synthesis):

```json
{
  "location": "file:start-end (or file:line when single line)",
  "trigger_condition": "one-line description (max 15 words)",
  "guard_snippet": "minimal code sketch that closes the gap (single-line, escaped)",
  "potential_consequence": "what could actually go wrong (max 15 words)"
}
```

Rules:
- Return ONLY a valid JSON array. No prose, no markdown wrapping.
- Empty array `[]` is valid when no unhandled paths are found.
- Each object must contain exactly these four fields and nothing else.

## Common rationalisations for skipping testing itself

Agents and authors rationalise away skill testing the same way they rationalise away code testing. Capture these in your own RED phase for new skills:

| Excuse for skipping testing | Reality |
|------------------------------|---------|
| "The skill is obviously clear" | Clear to you ≠ clear to other agents. Test it. |
| "It's just a reference" | References can have gaps, unclear sections. Test retrieval. |
| "Testing is overkill" | Untested skills have issues. Always. 15 min testing saves hours. |
| "I'll test if problems emerge" | Problems = agents can't use skill. Test BEFORE deploying. |
| "Too tedious to test" | Testing is less tedious than debugging bad skill in production. |
| "I'm confident it's good" | Overconfidence guarantees issues. Test anyway. |
| "Academic review is enough" | Reading ≠ using. Test application scenarios. |
| "No time to test" | Deploying untested skill wastes more time fixing it later. |

All of these mean: **test before deploying. No exceptions.**

## Skill deployment checklist

Every skill MUST pass this checklist before merging. Use TodoWrite to create todos for each item.

**RED phase — write failing test:**
- [ ] Create pressure scenarios (3+ combined pressures for discipline skills)
- [ ] Run scenarios WITHOUT skill — document baseline behaviour verbatim
- [ ] Identify patterns in rationalisations / failures
- [ ] Verify RED with a second subagent (scenario strength check)

**GREEN phase — write minimal skill:**
- [ ] Name describes what you DO or the core insight
- [ ] Frontmatter has `goat-flow-skill-version: "1.2.0"` and trigger-only `description`
- [ ] `description` is CSO-optimised: "Use when [trigger]", not a workflow summary
- [ ] Keywords throughout for search (error messages, symptoms, tool names)
- [ ] Overview states the core principle in 1–2 sentences
- [ ] Addresses specific baseline failures identified in RED
- [ ] One excellent example — not multi-language dilution
- [ ] Run scenarios WITH skill — verify agents now comply

**REFACTOR phase — close loopholes:**
- [ ] Identify NEW rationalisations from GREEN testing
- [ ] Add explicit counters inline beside the rules they defend
- [ ] Build / extend the rationalisation table from all iterations
- [ ] Create red-flags list
- [ ] Re-test until bulletproof (3 consecutive passes, no new rationalisations)

**Quality checks:**
- [ ] Small flowchart only if decision non-obvious
- [ ] Quick-reference table for scanning
- [ ] "NOT this skill" boundary section listing what routes elsewhere
- [ ] No narrative storytelling ("in session 2025-10-03 we found...")
- [ ] Supporting files only for executable tools or heavy reference (100+ lines)
- [ ] Token budget met (dispatcher <500 words, functional skill <2500 words, reference pack <400 words per file). Skills that exceed their tier must either shed content or be split into a reference pack under `references/`.

**Deployment:**
- [ ] Write TDD iteration log to `.goat-flow/logs/sessions/YYYY-MM-DD-<skill>-tdd.md`
- [ ] Cross-reference the log filename in the relevant lesson or footgun entry (not in SKILL.md frontmatter — that leaks dev paths to consumer installs)
- [ ] Cross-link into sibling SKILL.md files if relevant
- [ ] Announce in commit message: which rationalisations were closed, which pressures tested

## STOP: before moving to the next skill

After writing ANY skill, STOP and complete the deployment checklist.

Do NOT:
- Create multiple skills in a batch without testing each
- Move to the next skill before the current one is verified
- Skip testing because "batching is more efficient"

Deploying untested skills = deploying untested code. It's a violation of quality standards.

## Empirical grounding

- superpowers' own TDD skill went through **6 RED–GREEN–REFACTOR iterations** before bulletproof (2025-10-03 worked example above).
- Baseline RED typically captures **10+ unique rationalisations** per nontrivial skill.
- Pressure-tested compliance rises from ~33% → ~72% — Meincke et al. (2025), N=28,000 AI conversations, p < .001.
- A bulletproof skill passes **3 consecutive** max-pressure scenarios without new rationalisations.


## Research citations

- **Cialdini, R. B. (2021).** *Influence: The Psychology of Persuasion (New and Expanded).* Harper Business. — The seven principles (authority, commitment, scarcity, social proof, unity, reciprocity, liking).
- **Meincke, L., Shapiro, D., Duckworth, A. L., Mollick, E., Mollick, L., & Cialdini, R. (2025).** *Call Me A Jerk: Persuading AI to Comply with Objectionable Requests.* University of Pennsylvania. — Tested the seven principles with N=28,000 LLM conversations. Compliance 33% → 72%. Authority, commitment, scarcity most effective. Validates parahuman model of LLM behaviour.

## Cross-references

| Where | What |
|-------|------|
| `.claude/skills/goat-review/SKILL.md` (or `workflow/skills/goat-review/SKILL.md` template) | Zero-findings HALT — adversarial pattern in the wild |
| `.claude/skills/goat-critique/SKILL.md` (or `workflow/skills/goat-critique/SKILL.md` template) | Agent C fresh-eyes — parallel reviewer info asymmetry in the wild |
| `.claude/skills/goat-qa/SKILL.md` (or `workflow/skills/goat-qa/SKILL.md` template) | Structured-finding shape for gap output |
| `.goat-flow/skill-reference/skill-preamble.md` (or `workflow/skills/reference/skill-preamble.md` template) | Proof Gate, evidence standard, ceremony level — the loaded-every-invocation layer |
| `.goat-flow/skill-reference/skill-conventions.md` (or `workflow/skills/reference/skill-conventions.md` template) | Rationalisation table definition, task tracking, recovery protocols |
| `.goat-flow/logs/sessions/*-<skill>-tdd.md` | TDD iteration logs live here; filename convention is the index (no frontmatter cross-reference) |
