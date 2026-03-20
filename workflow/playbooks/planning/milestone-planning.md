# Prompt: Milestone Planning

> **When to use:** After [SBAO](sbao-ranking.md) produces a prime plan. Use this to break that plan into phased milestones with clear exit criteria.
>
> **Input:** Attach your `requirements-<feature-name>.md` and/or `TODO_feature-name_prime.md` at the end of this prompt.

```
You are helping me plan a software project broken into milestones.
## The First Rule
**Spikes before implementation.** Before writing real code for anything uncertain, write a throwaway script to explore it. Call an API. Profile memory. Benchmark the approach. Document what you find. THEN write the real code.

This is the single highest-leverage habit in software planning. A 30-minute spike can save days of rework. If you're unsure about a library, an API surface, a performance characteristic, or an integration point - spike it first, build on it second.

## Milestone Archetypes

Break the project into milestones using these archetypes. Small projects might collapse these into 2-3 milestones. Large projects might split one archetype across multiple milestones. Adapt the number to the project - the archetypes matter, the count doesn't.

**1. Prove It Works (Proof of Concept)**
Validate the riskiest assumptions. Build the minimum needed to prove the core idea is technically feasible. No polish, no edge cases, no auth.

**2. Make It Real (End-to-End Pipeline)**
Connect the pieces so someone other than the builder can test it. The full flow works with real data. Rough edges are fine.

**3. Make It Solid (Production-Ready)**
Handle edge cases, errors, security, and UX. Incorporate feedback from the previous milestone. The project is shippable after this.

**4. Make It Shine (Polish & Stretch)**
Nice-to-haves, performance, docs, open source prep. Explicitly optional. Skip or compress this for time-constrained projects.

## Rules for each milestone

- **Start with unknowns.** Order tasks so the riskiest work comes first. If something might invalidate the plan, prove it before building on top of it.

- **Track assumptions, not just tasks.** Mark what's validated vs. what's assumed. These are not task checkboxes - they track whether your beliefs about the system are proven or still guesses.

Good:
- [x] NeMo VRAM stays under 14GB with both models loaded (benchmarked)
- [ ] S3 presigned URLs work with our CORS setup (untested)
- [x] sqlc generates correct types for JSONB columns (spike confirmed)
- [ ] WebSocket reconnection logic handles mid-stream disconnects (assumed)

Bad:
- [x] Set up database (this is a task, not an assumption)

- **Exit criteria must be testable.** Not "performance is acceptable" - instead "latency under 500ms at p95." Not "UI looks good" - instead "works on mobile viewport at 375px width."

- **Gotchas table per milestone.** List specific risks with concrete fallback plans. Not "something might go wrong with auth" - instead "OAuth token refresh fails silently after 1hr → add explicit refresh-on-401 with retry."

- **Each milestone must be independently demoable.** At the end of every milestone, you should be able to show someone what it does. If you can't demo it, it's not a milestone - it's a task inside a milestone.

## What NOT to do

- **Do not over-detail future milestones.** Write a one-paragraph objective and rough task list for anything beyond the next milestone. You don't have the information yet. Update the plan after each milestone based on what you learned.

- **Do not build for imagined requirements.** Don't build a plugin system in Milestone 1 because you might need one in Milestone 3. Hard-code it. If Milestone 2 feedback says you actually need plugins, refactor then. Three similar functions are better than a premature abstraction.

- **Do not treat the plan as fixed.** After each milestone, re-read the next milestone and rewrite it. What you learn at 25% and 50% will change the plan. That's the point.

## Format

For each milestone, provide:
- **Objective** (1-2 sentences)
- **Assumptions to validate** (checkboxes - what must be proven true this milestone)
- **Tasks** (numbered, with sub-tasks as checkboxes)
- **Exit criteria** (bulleted, testable, binary pass/fail)
- **Gotchas & fallbacks** (table: risk | concrete fallback)
- **Key decisions** (architectural choices made and why)

Now help me plan milestones for the project described in the attached requirements (attach `requirements-<feature-name>.md` and/or `TODO_feature-name_prime.md`).
```

---
