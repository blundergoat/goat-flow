---
goat-flow-reference-version: "1.17.0"
---
# Goat-review Reasoning Traps

Use this catalog after Pass 2 to challenge how the review reasoned, not as evidence about the target.
Every live finding still needs current target-project proof. The inline goat-flow incident summaries
explain why a trap exists; they never substitute for re-reading the reviewed files.

## Evidence-backed goat-flow incidents

### Reachability before severity

**Trap:** A scary label or failed tool output determines severity before the reviewer proves the target
can reach the condition.

**Reality:** PR #44 bots reported Critical/Major failures from an incomplete sandbox; local commands
passed, and a cited shell function was reachable through a trap registration the bot missed.

**Fix:** Reproduce in the target environment, trace caller/input/trigger and shipped exposure, then
derive severity. Framework incident: `External code-review bots that re-run verification commands in their own sandbox produce false-positive Critical findings`.

### Convention from a three-file sample

**Trap:** A small local sample is treated as a repository convention or as proof that a guard is absent.

**Reality:** One critique called a PreToolUse blind spot after checking the apparent surface; a wider
search found the check in `check-constraints.ts` and refuted the finding.

**Fix:** Search the full declared directory and consumers. If both competing patterns have more than
three examples, report no single convention. Framework incident: `Cross-critique review catches cold-path drift that single reviews and preflight miss`.

### Regression without a baseline read

**Trap:** The current hunk is called a regression without reading the current target and its base form.

**Reality:** Review findings were applied as tasks even though other agents had already fixed several
targets; editing the stale claims would have reintroduced defects.

**Fix:** Re-read current HEAD and, for a regression claim, compare `git show <base>:<file>` with the
frozen bundle before assigning a verdict. Framework incident: `Blindly applying review feedback without verifying findings`.

### A finding that contradicts a passing test

**Trap:** A review finding describes the code accurately, so the reviewer treats it as a defect to fix.

**Reality:** Applying a mechanically correct bot finding turned two test failures into twenty-two, because a test
asserted the reported behaviour on purpose.

**Fix:** Before acting, search the test suite and any self-test for the behaviour the finding wants changed. If a
test, decision record, or self-test asserts it deliberately, the finding is a design question for the owner, not a
defect to fix in a review-response pass. Framework incident: `A bot finding that contradicts a passing test is a design question, not a bug`.

### A guard rewrite needs both builds run, not both sources read

**Trap:** A guard, parser, or classifier is called a regression because the diff moved most of its branches.

**Reality:** Four regression suspicions raised from a deny-policy diff were all refuted by running base and head
against one probe matrix. Every verdict was identical; only the messages had changed.

**Fix:** Extract the base version and run both builds against the same inputs, labelling each row `same`,
`newly-blocked`, or `newly-allowed`. Reading the base source says what the code used to say, not what it used to
decide. This extends `Regression without a baseline read` for any surface with a runnable verdict, and proves
nothing about code that has none. Framework incident: `For a guard rewrite, run the base build - reading the base diff cannot tell a message change from a verdict change`.

### An addressed marker is not evidence the fix landed

**Trap:** A review comment marked resolved or addressed is treated as proof the change happened.

**Reality:** A bot appended an addressed marker to a finding whose file still carried the contradictory text at
review time. Two of its other findings were the inverse, describing defects already fixed in later commits.

**Fix:** Re-verify every finding against the selected review state, in both directions: a marker claiming a fix
landed, and a finding claiming a defect remains. Resolution markers describe the commit the author last read, not
the state under review. Framework incident: `A review bot's own "addressed" marker is not evidence the fix landed`.

## Placeholder trap shapes

The following are shipped input/output shapes for consumer evidence. They are not goat-flow incidents.

### Mirror bug on a widened or narrowed guard

**Placeholder trap shape — input/output contract only; never evidence.**

**Trap:** Closing one failure widens or narrows a guard and silently reopens the opposite defect.

**Reality:** A one-axis fix proves only the reported case.

**Fix:** Name and verify one concrete opposite-defect case before accepting the guard.

### Hide, filter, or redact checked on one projection

**Placeholder trap shape — input/output contract only; never evidence.**

**Trap:** One view hides an entity while counts, IDs, raw documents, or detail views still expose it.

**Reality:** Presentation-level filtering is not an end-to-end disclosure boundary.

**Fix:** Check every projection the same entity reaches: `*_count`, `*_ids`, raw output, and detail view.

### Finding outside the diff

**Placeholder trap shape — input/output contract only; never evidence.**

**Trap:** A diff review reports an introduced defect whose primary changed anchor is outside the frozen
bundle hunks.

**Reality:** Context can prove blast radius, but unchanged defects follow Pre-existing separation unless
the changed behavior reaches them.

**Fix:** Confirm the primary changed anchor is in a hunk; otherwise reclassify it or drop the change claim.

### Self-dismissal wording

**Placeholder trap shape — input/output contract only; never evidence.**

**Trap:** A real consequence is followed by “INFO only” or “no action required,” so downstream readers
discard it.

**Reality:** A finding either has concrete harm and an action or it is not a finding.

**Fix:** State the evidence-derived severity/action and stop; otherwise remove the item instead of hedging.
