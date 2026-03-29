# ADR-013: /goat Dispatcher — Build It

**Date:** 2026-03-28
**Status:** Accepted (revised — originally deferred, now approved after completing Part 1 evaluation)

## Context

The world-class roadmap proposed a `/goat` dispatcher as a single entry point that classifies user intent and routes to the correct skill. An evaluation framework was drafted in `archive/goat-flow-dispatcher-prompt.md` with 6 questions to answer before deciding.

The original ADR deferred the dispatcher without running the evaluation. That was premature. The evaluation has now been completed.

## Evaluation Results (Part 1)

1. **Intent classification:** ~70% of inputs map clearly to one skill via keywords. The remaining 30% concentrate at the debug/review/investigate boundary and need one clarification question — not a 5-question interrogation.

2. **Token cost:** Negligible. The dispatcher is ~80 lines. A wrong-skill load (200+ lines) followed by "NOT this skill" redirect costs more than the dispatcher + one disambiguation question.

3. **Failure modes:** Dispatcher announces its choice ("Running /goat-debug") before executing. User can override with one message. Cheaper recovery than the current path where the user loads a full skill, starts Step 0, then realizes it's wrong.

4. **UX trade-off:** Helps new users significantly (no skill name lookup needed). Zero cost for power users (direct `/goat-debug` invocation unchanged). Critical for 20-person team onboarding.

5. **Existing routing:** Complementary. CLAUDE.md skill table is for reading. Each skill's "NOT this skill" block handles post-load redirects. Dispatcher handles pre-load routing — a different layer.

6. **Multi-agent portability:** Fully portable. The dispatcher is a SKILL.md file doing keyword matching and presenting choices — works identically on Claude Code, Codex, Gemini CLI, and Copilot.

## Decision

Build the dispatcher. Install as `/goat` in all agent skill directories.

- Keyword-first intent mapping with explicit disambiguation for ambiguous cases
- Transparent announcement before execution ("Running /goat-debug")
- One-question disambiguation, not multi-step interrogation
- 8 existing skills remain directly invocable — dispatcher is additive
- Bare `/goat` invocation shows examples and asks what the user needs

## Consequences

- New skill template at `workflow/skills/goat.md` — not counted in the canonical 8 (it's a routing layer, not a workflow skill)
- Installed in `.claude/skills/goat/`, `.agents/skills/goat/`, `.github/skills/goat/`
- Scanner does NOT require the dispatcher — it's optional. No rubric check for its existence.
- The onboarding guide (`docs/onboarding.md`) should be updated to recommend `/goat` as the primary entry point for new users
- Each skill's "NOT this skill" blocks remain useful as fallback routing when users invoke skills directly
