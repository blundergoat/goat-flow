# ADR-019: No implementation skill - extend existing skills instead

**Status:** Accepted (partial). Core decision stands — no implementation skill was added. Phase 5 (Execute) in goat-plan and the `persona` config field in the "Consequences" section were never shipped. Implementation is handled in the ordinary ACT step per the execution loop; goat-plan remains planning-only and can deliver inline/read-only or file-based milestones without an execution phase.
**Date:** 2026-04-03
**Context:** Two independent Codex critiques (the-summit-chatroom, ambient-scribe) identified that "fix this bug" and "build this feature" have no routing destination. /goat-debug stops at diagnosis, /goat-plan stops at the plan. Six independent reviewers (3 sub-agents, Codex, Claude, Gemini) evaluated four options.

## Options evaluated

- **Option A: goat-doer + goat-verifier** - Two new skills. Rejected 6/6. Doer-verifier in single-agent context is theater; the verifier has full context of the doer's reasoning.
- **Option B: goat-implement** - One new skill. Rejected 5/6. Gemini favored it but for DoD enforcement (hooks), not code editing. Implementation is "the thing the agent does when it's not running a skill."
- **Option C: Extend existing skills** - No new skills. Favored 5/6. goat-debug already has fix phases (D3/D4). goat-plan needs Phase 5 (Execute). The gap is carry-through, not capability.
- **Option D: Mode, not skill** - Codex's variant of C. The system spec already defines Implement as a core execution mode. The bug is no user-facing path into it. Fix the dispatcher routing, not the skill set.

## Decision

**Option C/D combined. No new skills.**

Three changes:
1. **Dispatcher learns intent → mode routing.** Investigation verbs (understand, diagnose, explain) stay read-only. Implementation verbs (fix, build, change) carry through to implementation after the diagnosis/planning phase completes.
2. **goat-plan gets Phase 5 (Execute).** Per-milestone implementation with checkpoints. Only triggers when user approved and intent was "build/create."
3. **Local persona override (historical).** `persona: investigator` locks out Implement mode across all skills for non-developer users (testers, service team, monitoring).

**Supersession note (M13):** The old gitignored local config surface was removed. `config.yaml` is now the only machine-readable config surface.

## Rationale

- The execution loop (`docs/system-spec.md:154`, `docs/system-spec.md:185`, retired in v1.1.0; see `workflow/setup/reference/execution-loop.md`) already defines Implement as a core execution mode
- ADR-030 says implementation belongs in the normal ACT step, not inside a separate implementation skill
- Skills must NOT jump into implementation early - investigation/diagnosis/planning must complete first
- Real verification comes from /goat-review or /goat-qa in a fresh invocation, not from the same agent re-reading its own diff
- Adding skills increases the count that critics already say is too many (see ADR-030 for the skill-consolidation doctrine)

## Consequences

- Supersedes the earlier dispatcher-counting split that now lives inside ADR-030. Dispatcher is now "6 skills + dispatcher" (7 total: goat-debug, goat-plan, goat-review, goat-critique, goat-security, goat-qa + goat dispatcher).
- Dispatcher routing table gains implementation-intent rows (shipped).
- goat-plan **did not** gain Phase 5 (Execute). Implementation remains the ordinary ACT step in the execution loop; goat-plan ends at milestone approval. Users wanting carry-through either invoke the implementation directly after planning or use `/goat-debug` D3/D4 for bug-fix flows.
- `.goat-flow/config.yaml` **did not** gain a `persona` field. Persona-based mode locking was scoped out; CLAUDE.md `Autonomy Tiers` plus `Ask First` boundaries cover the same ground without a machine-readable lockout.
- Historical note: the old gitignored override surface was removed in M13.
