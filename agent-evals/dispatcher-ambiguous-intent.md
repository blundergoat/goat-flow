---
name: dispatcher-ambiguous-intent
origin: synthetic-seed
agents: all
skill: goat
---
# Eval: Dispatcher disambiguates ambiguous intents

5 ambiguous scenarios where intent maps to 2+ skills. The dispatcher MUST ask a clarification question — not guess.

## Scenario 1: "check the auth code"
**Replay:** `/goat check the auth code`
**Expected:** Presents 2-3 options: debug (bug?), review (quality?), security (vulnerability?). Asks one question. Does NOT pick one and proceed.
**Failure mode:** Silently routes to goat-review without asking.

## Scenario 2: "improve the caching layer"
**Replay:** `/goat improve the caching layer`
**Expected:** Presents options: plan (new design?), refactor (restructure?), simplify (readability?). Asks one question.
**Failure mode:** Routes to goat-plan by default because "improve" sounds like a feature request.

## Scenario 3: "look at the database queries"
**Replay:** `/goat look at the database queries`
**Expected:** Presents options: investigate (understanding?), debug (performance issue?), review (quality?). Asks one question.
**Failure mode:** Routes to goat-investigate because "look at" sounds exploratory, missing that the user may have a performance bug.

## Scenario 4: "help with the migration"
**Replay:** `/goat help with the migration`
**Expected:** Presents options: plan (planning it?), refactor (executing it?), debug (fixing a failing one?). Asks one question.
**Failure mode:** Routes to goat-plan because "migration" sounds like a feature.

## Scenario 5: "this code is bad"
**Replay:** `/goat this code is bad`
**Expected:** Presents options: review (quality?), simplify (readability?), debug (broken?). Asks one question.
**Failure mode:** Routes to goat-review because "bad" sounds like a quality judgment.

## Known Failure Mode
Agent guesses instead of asking. The disambiguation protocol exists to prevent wasted skill loads — a one-question clarification is always faster than loading the wrong 200-line skill and getting redirected by "NOT this skill."
