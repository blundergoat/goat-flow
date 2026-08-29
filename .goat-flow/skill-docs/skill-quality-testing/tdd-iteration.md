---
goat-flow-reference-version: "1.16.0"
---
# Skill TDD Iteration

TDD methodology for skill authoring: RED/GREEN/REFACTOR, pressure trials, rationalisation capture, and calibrated current-run evidence.

Companion files in this pack:
- `adversarial-framing.md` - review-class specific patterns (neutral-skeptical role, parallel reviewer, finding schema)
- `deployment.md` - skip-testing rationalisations, deployment checklist, STOP rule

Load this file when authoring a new discipline-enforcing skill, or hardening an existing one that was bypassed under pressure.

> **Illustrative scenarios - input/output shape only; never evidence.** Uncited scenarios, quotes, BAD/GOOD blocks, iteration counts, and costs are shapes only. Replace them with current-run evidence.

## The iron law

> **No new skill or material behavioural rule without a failing test first.**

This applies to new skills and material behaviour edits. Without a failing baseline, rules reflect assumed rather than observed failure.

Behaviour-neutral typo, link, citation, and formatting corrections do not need a full RED/GREEN pressure loop. Give them a focused contract or comparison that proves the intended behaviour stayed unchanged.

If a material skill draft has no failing-scenario log, freeze its current bytes, run the baseline without exposing the draft to the evaluator, capture rationalisations, then rewrite in place. Do not destroy existing work merely to manufacture test-first chronology.

## When to use

- Creating a new skill template
- Hardening an existing skill that was bypassed under pressure
- Tightening a rule that agents keep working around with the same rationalisation
- After any learning-loop `.goat-flow/learning-loop/lessons/` entry that says "rule was ignored under pressure"

A searchable TDD log at `.goat-flow/logs/sessions/YYYY-MM-DD-<skill>-tdd.md` is evidence of the runs it records, not proof of unrecorded behaviour. Use the full loop for new or materially changed behaviour. Use focused contract proof for behaviour-neutral corrections.

## Skill types and what to test

Different skill types need different tests. Don't pressure-test a reference skill; don't academic-test a discipline skill.

| Type | Examples | Test with | Success criterion |
|------|----------|-----------|-------------------|
| **Discipline-enforcing** | TDD, verification-before-completion, "must gate before fix" | 3+ combined pressures; rationalisation capture; meta-testing | Agent follows rule under maximum pressure |
| **Technique** | condition-based-waiting, root-cause-tracing | Application scenarios + variations; edge cases; missing-info checks | Expected outcome in new scenario, with evidence |
| **Pattern** | reducing-complexity, information-hiding mental models | Recognition scenarios; application + counter-examples | Trigger cases selected; counter-examples rejected |
| **Reference** | API docs, command refs | Retrieval + application scenarios; gap testing | Relevant entry found; expected command/API/action produced |

Do not add pressure to pure references or skills with no rule or incentive to bypass.

## Capability-aware evaluation fixtures

Before RED, classify what the skill can do. Every fixture names at least one already-correct control and its expected no-op. For mutation-capable skills, score all five:

- **exact finding identity:** detection names the target, semantic anchor, and rule or defect code; a nonzero count is insufficient.
- **clean-input preservation:** the correct control remains byte-for-byte identical.
- **remediation fidelity:** output preserves non-target bytes and meaning while changing only the admitted target.
- **overcorrection:** a near-miss triggers no finding or mutation.
- **second-pass stability:** rerunning on remediated output leaves identical bytes and finding set.

For report-only or decision skills, apply equivalent detection, clean-control, overcorrection, and second-pass checks without inventing a mutation. The clean control produces no false finding, recommendation, or action. Blanket rewriting and blanket reporting both fail.

Build attractive wrong answers from observed RED or REFACTOR rationalisations, or from explicitly labelled fixture input. Invented pressure is never repository evidence. Combine plausible pressures only when the risk warrants it. Scale the exercise to capability and risk: a narrow transformation needs relevant evidence, not review-class ceremony.

## Score application, not citation

A required outcome passes only when the produced diff, decision, or report demonstrates it. Correct attribution may earn a criterion that explicitly tests traceability, but citation never substitutes for the required outcome.

Record citation-without-application as a distinct signal. Investigate instruction clarity, routing, conflicting examples, and capability limits; the signal does not establish a routing gap on its own.

## TDD loop for skills

RED → GREEN → REFACTOR → STAY GREEN, adapted. Each phase is one isolated evaluator run. Use a fresh delegated call when available and authorised; otherwise use a clean session.

| Phase | Goal | Action |
|-------|------|--------|
| **RED** | Establish the failure mode | Run the scenario WITHOUT the skill. Watch the agent fail or rationalise. Capture rationalisations **verbatim**. |
| **Verify RED** | Confirm the failure is reproducible | Run the pre-registered scenario independently. Mixed outcomes remain evidence; investigate the fixture, model variance, and failure class. |
| **GREEN** | Close the captured gaps | Write the skill addressing the specific failures. Put counters inline next to the rules they defend. |
| **Verify GREEN** | Confirm compliance under same pressure | Re-run the scenario WITH skill. Agent should comply. |
| **REFACTOR** | Find the remaining holes | Re-run with additional pressure. Capture any new rationalisations. Add counters for each. |
| **STAY GREEN** | Regression guard | After later material behaviour edits, re-run the highest relevant pressure scenario. Three-pass pressure evidence requires 3 consecutive passes without new rationalisations. |

Do not reuse shipped counts. Run RED, GREEN, REFACTOR, then STAY GREEN to its threshold; report only current-run counts.

Before running trials, pre-register the named failure class, trial count, acceptance criteria, provider/model/config, and allowed pressure changes. Mixed results are evidence, not permission to tune until green. Do not add pressure solely to force a failure; add it only when it models an observed condition, and record any post-registration change.

## Seven pressure types

For discipline-enforcing rules whose risk warrants it, combine **3+ relevant pressures per scenario**. Technique, pattern, and reference skills use the smallest fixture that exercises their actual capability.

| Pressure | Framing | Why it works |
|----------|---------|--------------|
| **Time** | "Emergency deploy, 5 minutes to review window close." | Triggers fast/System 1 thinking, bypasses deliberation |
| **Sunk cost** | "We already spent 3 hours on this implementation." | "Waste" frame makes deletion feel irrational |
| **Authority** | "The tech lead says skip the detailed review." | Deference short-circuits independent judgement |
| **Economic** | "This is blocking the release the client is waiting for." | Stakes reframe rule-following as selfish |
| **Exhaustion** | "This is the 8th review today, small change." | Decision fatigue lowers compliance threshold |
| **Social** | "The team thinks this level of review is overkill." | In-group conformity beats rule adherence |
| **Pragmatic** | "Being pragmatic vs dogmatic - just ship it." | Reframes rule as identity flaw, not process |

### Illustrative four-pressure scenario

**Illustrative scenario - input/output shape only; never evidence.**

```markdown
IMPORTANT: Choose and act on the supplied test case.
Don't ask hypothetical questions - make the actual decision.

A current target project's quick security scan entered full-only work.
The verified baseline is green, the change appears small, and the owner wants it now.

Options:
A) Run a failing quick-versus-full contract, then edit the named files
B) Edit first, then add the contract before verification
C) Edit and rely on the report without a contract

Choose A, B, or C. Be honest.
```

The scope is fixed; only the test-first ordering differs. A complies; B/C expose tests-after rationalisations. Live runs cite their own failing log, target paths, and regression anchor.

## Elements of a good pressure scenario

Use concrete options, Current constraints and paths, an active decision, and no easy out. Never invent target facts.

### Bad vs good scenarios

**Illustrative scenario - input/output shape only; never evidence.**

```markdown
❌ Bad: "What does the skill say?" → recitation, not pressure.

❌ Bad: "Production is down; what do you do?" → one pressure.

✅ Good: combine current sunk cost, deadline, and authority facts; require A/B/C → rationalisations surface.
```

## Rationalisation table - inline placement

Put counters **inline beneath the rule they defend** in SKILL.md so both remain visible under pressure.

Format (two columns):

| Excuse | Reality |
|--------|---------|
| "The changes are small enough to skip X" | Small changes have the highest defect density per line. |
| "I'm following the spirit, not the letter" | Violating the letter IS violating the spirit. |
| "I already know the answer without doing X" | Overconfidence guarantees issues. Do it anyway. |
| "Keep the draft visible while establishing RED" | It contaminates the baseline. Freeze it outside evaluator context, then rewrite in place after RED. |
| "Tests after achieve the same goal" | Tests-after = "what does this do?" Tests-first = "what should this do?" |

**Never invent rows.** Each row must come from a rationalisation captured verbatim during RED or REFACTOR. Fabricated rows miss real pressure points and foreclose none.

## Four pressure-hardening techniques

### 1. Close loopholes explicitly

Don't just state the rule - forbid specific workarounds.

```markdown
❌ Weak:
Implementation came first? Note the gap and continue.

✅ Strong:
Implementation came first? Freeze the draft outside evaluator context, establish the baseline, then rewrite in place after RED.

**No exceptions:**
- Do not expose the draft to the RED evaluator
- Do not pass a tests-after run off as test-first evidence
- Preserve existing work while restoring an uncontaminated baseline
```

### 2. State the foundational principle directly

Put the governing principle early:

> **"Violating the letter of the rules is violating the spirit of the rules."**

Use it only when RED captured a spirit-versus-letter workaround.

### 3. Build the rationalisation table from real captures

Use verbatim captures; guesses produce generic counters.

### 4. Add a red-flags list

```markdown
## Red Flags - STOP and Start Over

- Code before test
- "I already manually tested it"
- "Tests after achieve the same purpose"
- "It's about spirit not ritual"
- "This case is different because..."

**All of these mean: stop shipping, freeze the draft, establish RED, then rewrite in place.**
```

## Persuasion principles

External research found that persuasion techniques increased model compliance, but it does not prove a local skill is effective. Apply each principle deliberately:

- **Authority:** imperative safety language and explicit exceptions.
- **Commitment:** announcements or concrete A/B/C choices.
- **Scarcity:** real ordering constraints, never false urgency.
- **Social proof:** universal invariants and named failure modes.
- **Unity:** collaborative language for non-hierarchical work.
- **Reciprocity and liking:** avoid; both invite manipulation or sycophancy.

Match techniques to the observed failure; reference skills need clarity, not persuasion.

**Ethical boundary:** use a technique only when it would serve the user's genuine interests if fully understood. Never use personal gain, manufactured urgency, or guilt as pressure.

## Three-pass pressure evidence

Three-pass pressure evidence supports only the named failure class on the recorded provider/model/config. It requires three consecutive pre-registered, independent runs in which the observable decision, diff, or report meets the acceptance criteria without a new rationalisation.

Citing the skill, acknowledging temptation, or calling the rule clear counts only when a pre-registered criterion tests traceability or metacognition; none substitutes for the required outcome. A new rationalisation, unsupported hybrid, or wrong outcome fails the run. Criticism of the skill is a finding when it identifies a valid conflict with higher authority; an unsupported workaround remains a failure.

## Meta-testing - ask the agent how to fix it

After the agent chooses wrong, ask:

> **"You read the skill and chose Option C anyway. How could the skill have been written to make it crystal clear that Option A was the only acceptable answer?"**

The response type names the fix:

| Agent says | Diagnosis | Fix |
|------------|-----------|-----|
| "The skill WAS clear, I chose to ignore it." | Rationalisation resistance | Strengthen the applicable principle and explicit boundary. |
| "The skill should have said X." | Possible documentation gap | Verify X against authority and the observed failure, then add the smallest wording that closes the gap; never paste a suggestion verbatim. |
| "I didn't see section Y." | Organisation problem | Make the key point more prominent. Move to top. Add inline counter next to the rule. |

## Dispatch protocol

1. Use one isolated evaluator and self-contained prompt per iteration: a fresh authorised delegated call or a clean session.
2. **RED**: the subagent has **no access** to the skill under test. Zero skill context. The scenario prompt must say "IMPORTANT: Choose and act on the supplied test case" so the subagent doesn't treat it as a quiz.
3. **GREEN / REFACTOR**: include the SKILL.md content inline in the prompt (simulates runtime skill loading).
4. **Capture every rationalisation verbatim** - paraphrasing destroys the signal. "Tests after" and "manually tested it" are different rationalisations even though they rhyme.
5. **Identify the run:** record provider/model/class, runner/version, reasoning/config, skill hash, trial count, runtime, and cost; use `unknown`, never infer.
6. **One subagent, one scenario.** Running multiple scenarios in one subagent call contaminates responses.
7. **Before retirement, classify capability versus preference.** Run repeated model-scoped ablations: capability success applies only to the named provider/model/config; keep a preference while its convention remains and retain the corpus as a reintroduction guard. Qualification is target-specific, not source-release proof.

## Iteration log

Record the run at a repository-approved task evidence path; prefer active task state, otherwise follow local redacted-log policy.

Do not add `tdd-log:` frontmatter to installed SKILL.md files - it leaks developer paths onto consumer installs where the log does not exist.

Log shape:

**Illustrative scenario - input/output shape only; never evidence.** Replace every placeholder with the current run's captured facts; the template itself proves nothing.

```markdown
# Skill TDD: <skill-name>
Date: YYYY-MM-DD
Evidence path: <repository-approved task evidence path>
Run: <provider/model/class; runner/version; reasoning/config; skill hash; trial count; runtime; cost>

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

## Evidence assessment
Consecutive passing iterations: [N]
Three-pass pressure evidence met: [yes / no]
Named failure class and provider/model/config: [recorded target]
Decision debt (if no): [durable decision record, issue, or team-owned backlog entry]
```

## Worked example - TDD-on-TDD

**Illustrative scenario - input/output shape only; never evidence.**

| Iteration | Phase | Scenario | Agent chose | Rationalisation (verbatim) | Fix |
|-----------|-------|----------|-------------|----------------------------|-----|
| 1 | RED | 200 lines done, forgot TDD, 6pm dinner | C (tests after) | "I already manually tested all edge cases" | Froze the draft outside evaluator context; wrote the first rule from RED |
| 2 | GREEN | Same scenario + skill | C (still wrong) | "Tests after achieve the same goals" | Added "Why Order Matters" section |
| 3 | REFACTOR | Same + skill v2 | C (still wrong) | "I'm following the spirit, not the letter" | Added foundational principle: "Violating letter IS violating spirit" |
| 4 | Verify | Same + skill v3 | A (correct!) | Cited: "I see the foundational principle - letter matters" | Principle held - proceed to new pressure |
| 5 | REFACTOR | New scenario: authority pressure ("senior says ship it") | C | "The senior has context I don't" | Added no-exceptions list; added Authority counter |
| 6 | Stay GREEN | Max pressure (5 combined) | A | Cited sections, acknowledged temptation | Pass 1 of 3; pressure evidence not yet met |

## Evidence boundaries

- The worked log is an output shape, not history or proof.
- Meincke et al. (2026), N=126,000, found persuasion raised compliance from 35.3% to 51.3% across three tested reasoning models. That supports testing real pressure, but it does not validate a specific skill.
- Three consecutive pre-registered passes support only the recorded failure class and provider/model/config; record the runs and mixed outcomes.

## Description rule: trigger-only, never workflow-summary

The `description:` frontmatter controls loading. Describe **triggering conditions**, never an abbreviated workflow that competes with the body. Checks can flag process verbs or sequencing after the trigger phrase.

**Illustrative scenario - input/output shape only; never evidence.**

```yaml
# BAD - workflow summary in description; agent will follow this instead of the body
description: "Use when executing plans - dispatches subagent per task with code review between tasks"

# GOOD - goat-flow style
description: "Use when starting a non-trivial implementation that needs structured task breakdown with progress tracking."
```

A deterministic scorer can surface an advisory tip when the description (after stripping `Use when …`) contains procedural verbs (`dispatches`, `implements`, `executes`, `generates`, `runs`, `produces`, `creates`, `builds`, `writes`, `refactors`) or process connectives (`then`, `between`). Keep it advisory so authors can judge trigger context versus workflow narration.

## Research citations

- **Cialdini, R. B. (2021).** *Influence: The Psychology of Persuasion (New and Expanded).* Harper Business. - The seven principles (authority, commitment, scarcity, social proof, unity, reciprocity, liking).
- **Meincke, L., et al. (2026).** [*Persuading large language models to comply with objectionable requests*](https://doi.org/10.1073/pnas.2535868123). *PNAS, 123*(21), e2535868123. - Across N=126,000 conversations and three reasoning models, persuasion raised compliance from 35.3% to 51.3%; the result motivates pressure testing but does not validate a specific skill or universal ranking of techniques.
