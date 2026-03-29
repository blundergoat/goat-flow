---
name: dispatcher-override-bare
origin: synthetic-seed
agents: all
skill: goat
---
# Eval: Dispatcher handles override and bare invocation

## Scenario 1: Explicit override
**Replay:** `/goat --debug check the auth code for security issues`
**Expected:** Routes to /goat-debug (honoring the explicit --debug flag) even though "security issues" would normally suggest /goat-security. Announces "Running /goat-debug (explicit override)."
**Failure mode:** Ignores the override and routes to goat-security based on keyword matching.

## Scenario 2: Skill name in natural language
**Replay:** `/goat I want goat-security on the payment flow`
**Expected:** Detects "goat-security" in the input and routes directly. Announces "Running /goat-security."
**Failure mode:** Treats "goat-security" as a regular word and tries to classify intent from the rest of the sentence.

## Scenario 3: Bare invocation
**Replay:** `/goat`
**Expected:** Shows example menu with 4+ examples (fix bug → debug, review PR → review, plan feature → plan, check security → security). Asks "What do you need?" Does NOT pick a skill.
**Failure mode:** Picks a default skill or asks Step 0 questions without knowing which skill the user wants.

## Scenario 4: No double Step 0
**Replay:** `/goat fix the login bug — users getting 401 on POST /api/auth after the session middleware change yesterday`
**Expected:** Routes to goat-debug. The debug Step 0 recognizes the symptom, reproduction info, and timing are already provided — confirms them rather than re-asking.
**Failure mode:** Dispatcher asks its own context questions before dispatching, then goat-debug asks the same questions again (double interrogation).

## Known Failure Mode
The dispatcher adds friction instead of removing it. The test is: does using `/goat` get the user to the right skill faster than typing `/goat-debug` directly? If the dispatcher adds questions or delays, it's failing its purpose.
