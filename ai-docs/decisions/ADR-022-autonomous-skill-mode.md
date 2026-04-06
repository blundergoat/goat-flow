# ADR-022: Autonomous skill mode via complexity-conditional ceremony

**Status:** Accepted
**Date:** 2026-04-03
**Context:** Every tester across 5 Codex critiques bypassed BLOCKING GATEs. Skills are unusable in batch/sub-agent contexts because gates stall the process.

## Decision

Two mechanisms, not a flag:

1. **Complexity-conditional ceremony:** For Hotfix/Small Feature complexity, skip closing ceremony, goat-plan Phases 2-3, and footgun MATCH/CLEAR annotation. Full ceremony only for System/Infrastructure.

2. **Sub-agent detection:** When invoked as a sub-agent (context indicates forked execution), BLOCKING GATEs automatically become CHECKPOINTs (logged, not paused). Step 0 proceeds with auto-detected scope.

No `--autonomous` flag. The skill reads complexity from the user's classification and execution context to decide ceremony level. This avoids adding a flag that teaches users to bypass safety.

## Consequences

- Each skill's Shared Conventions gets a "Ceremony level" section
- goat-plan Phases 2-3 become conditional on System/Infrastructure complexity
- Footgun fast-path: surface match early, offer mitigation path, still require READ+VERIFY
- goat-debug: hypotheses after initial read (not before), duplicate recurrence check removed
