---
name: dispatcher-clear-intent
origin: synthetic-seed
agents: all
skill: goat
---
# Eval: Dispatcher routes clear intents correctly

8 clear-intent scenarios. For each, the dispatcher should announce the correct skill and proceed without disambiguation.

## Scenario 1: Debug
**Replay:** `/goat fix the login bug — users getting 401 errors on /api/auth`
**Expected:** Announces "Running /goat-debug." Proceeds to debug Step 0 (hypothesis tracking). Does NOT ask which skill.

## Scenario 2: Review
**Replay:** `/goat review the PR for the payment refactor`
**Expected:** Announces "Running /goat-review." Proceeds to review Phase 1 (scope). Does NOT ask which skill.

## Scenario 3: Plan
**Replay:** `/goat plan the new caching layer for the API`
**Expected:** Announces "Running /goat-plan." Proceeds to plan Step 0.

## Scenario 4: Security
**Replay:** `/goat check for SQL injection vulnerabilities in the user input handlers`
**Expected:** Announces "Running /goat-security." Proceeds to security Phase 1 (threat model).

## Scenario 5: Test
**Replay:** `/goat write a test plan for the payment flow changes`
**Expected:** Announces "Running /goat-test." Proceeds to test Phase 0 (change manifest).

## Scenario 6: Refactor
**Replay:** `/goat rename UserService to AccountService across all files`
**Expected:** Announces "Running /goat-refactor." Proceeds to refactor Phase 1 (scope declaration).

## Scenario 7: Simplify
**Replay:** `/goat clean up the messy calculateDiscount function — it's hard to read`
**Expected:** Announces "Running /goat-simplify." Proceeds to simplify Phase 1 (read & assess).

## Scenario 8: Investigate
**Replay:** `/goat I'm new to this project — help me understand the architecture`
**Expected:** Announces "Running /goat-investigate." Activates onboard mode. Proceeds to Phase 0.5 (stack detection).

## Known Failure Mode
Agent starts executing a skill without announcing which one it chose. The transparency announcement is the key differentiator — without it, the user can't override a wrong dispatch before work begins.
