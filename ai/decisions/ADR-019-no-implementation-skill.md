# ADR-019: No implementation skill — extend existing skills instead

**Status:** Accepted
**Date:** 2026-04-03
**Context:** Two independent Codex critiques (the-summit-chatroom, ambient-scribe) identified that "fix this bug" and "build this feature" have no routing destination. /goat-debug stops at diagnosis, /goat-plan stops at the plan. Six independent reviewers (3 sub-agents, Codex, Claude, Gemini) evaluated four options.

## Options evaluated

- **Option A: goat-doer + goat-verifier** — Two new skills. Rejected 6/6. Doer-verifier in single-agent context is theater; the verifier has full context of the doer's reasoning.
- **Option B: goat-implement** — One new skill. Rejected 5/6. Gemini favored it but for DoD enforcement (hooks), not code editing. Implementation is "the thing the agent does when it's not running a skill."
- **Option C: Extend existing skills** — No new skills. Favored 5/6. goat-debug already has fix phases (D3/D4). goat-plan needs Phase 5 (Execute). The gap is carry-through, not capability.
- **Option D: Mode, not skill** — Codex's variant of C. The system spec already defines Implement as a core execution mode. The bug is no user-facing path into it. Fix the dispatcher routing, not the skill set.

## Decision

**Option C/D combined. No new skills.**

Three changes:
1. **Dispatcher learns intent → mode routing.** Investigation verbs (understand, diagnose, explain) stay read-only. Implementation verbs (fix, build, change) carry through to implementation after the diagnosis/planning phase completes.
2. **goat-plan gets Phase 5 (Execute).** Per-milestone implementation with checkpoints. Only triggers when user approved and intent was "build/create."
3. **config.local.yaml persona.** `persona: investigator` locks out Implement mode across all skills for non-developer users (testers, service team, monitoring).

## Rationale

- The system spec (`docs/system-spec.md:154`, `docs/system-spec.md:185`) already defines Implement as a core execution mode
- ADR-017 says edits happen in the normal ACT step, not inside goat-plan
- Skills must NOT jump into implementation early — investigation/diagnosis/planning must complete first
- Real verification comes from /goat-review or /goat-test in a fresh invocation, not from the same agent re-reading its own diff
- Adding skills increases the count that critics already say is too many (ADR-017 consolidated 9→6 for this reason)

## Consequences

- Supersedes ADR-016's canonical skill count. Dispatcher is now "5 skills + dispatcher alias"
- goat-plan grows by ~15 lines (Phase 5)
- Dispatcher routing table gains implementation-intent rows
- .goat-flow/config.yaml gains `persona` field
- .goat-flow/config.local.yaml (gitignored) gains override support
