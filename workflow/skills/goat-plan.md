---
name: goat-plan
description: "4-phase planning workflow with complexity routing, kill criteria, and triangular tension analysis for competing approaches."
goat-flow-skill-version: "0.7.0"
---
# /goat-plan

> Follows [shared-preamble.md](shared-preamble.md) for severity scale, evidence standard, gates, and learning loop.

## When to Use

Use before any non-trivial implementation. Hotfixes can use the compressed
path. Single-line changes don't need planning.

- **Hotfix** → Phase 1 brief only (3-5 lines), skip Phases 2-4
- **Standard** → Phase 1 brief + Phase 4 milestones. MAY skip Phase 2-3.
- **System** → Full 4-phase process with human gates
- **Infrastructure** → Full process + rollback planning

**NOT this skill:**
- Understanding code before planning → /goat-investigate
- Reviewing an existing plan or PR → /goat-review
- Debugging a specific issue → /goat-debug

## Step 0 — Where Are We?

**Continuation detection:** Before starting fresh, check for existing planning artifacts:
<!-- ADAPT: Add your project's planning file patterns -->
- `requirements-*.md`, `TODO_*_prime.md`
- `tasks/improvement-plan.md`, `tasks/roadmaps/*.md`, `tasks/roadmaps/milestones/*.md`
- Any `*-plan*.md`, `*-requirements*.md`, `*-milestone*.md`

Also check for staleness: `git log --since="2 weeks ago" -- [artifact]`. If the artifact hasn't been touched while code diverged, flag it.

If found: "I found [artifact] from [date]. Want to: (a) resume from here, (b) start fresh, (c) jump to a specific phase?"

**Structural questions (always ask or confirm):**
1. What are we building? (feature, fix, refactor, infrastructure change)
2. What complexity? (Hotfix / Standard / System / Infrastructure)

**Illustrative questions (adapt):**
3. <!-- ADAPT: "What's the riskiest part? (e.g., database migration, API contract, auth changes)" -->
4. <!-- ADAPT: "Any constraints? (timeline, backwards compatibility, performance budget)" -->

**Kill criteria (surface early):** "What would make us abandon this entirely?"
Even a vague answer ("if it takes more than a week" or "if it breaks the existing API")
helps frame the planning.

## Phase 1 — Feature Brief

Walk through each section ONE AT A TIME. Present one, wait for confirmation,
then present the next. Do NOT dump all 8 sections at once.

<!-- ADAPT: Adjust sections for your project's planning conventions -->
1. **Problem** — what's wrong or missing (1-2 sentences)
2. **Proposed solution** — high-level approach
3. **Risks / assumptions** — what could go wrong. Include kill criteria from Step 0.
4. **Rollback / feature flag plan** — how to undo if it fails in production
5. **Scope** — in/out with explicit exclusions
6. **Dependencies** — what blocks this, what this blocks
7. **Success criteria** — measurable outcomes
8. **Questions** — unknowns that need answers before proceeding

Ask the question whose answer could invalidate the approach FIRST.

**BLOCKING GATE:** Present complete brief. "Approve, or adjust?"

## Phase 2 — Mob Elaboration

Generate 3-5 sharp questions about the brief — questions that could change
the design if answered differently.

**Do NOT answer your own questions.** Present them and STOP. Wait for the
user to answer. If the user says "answer them yourself," that's permission
to proceed — but the default is to wait.

**CHECKPOINT:** "Questions answered. Proceeding to approach analysis."

## Phase 3 — Triangular Tension Analysis

Generate 2-3 competing approaches for the implementation. For each approach,
evaluate from three perspectives:

- **SKEPTIC:** What could go wrong? What's the worst case? What are we assuming that might be false?
- **ANALYST:** What does the data/evidence say? What's the cost/benefit? What are the measurable trade-offs?
- **STRATEGIST:** What's the path to shipping? What's the fastest way to learn if this works?

Use extended thinking for competing-plan generation before committing to output.

Present a comparison table:

| Criterion | Approach A | Approach B | Approach C |
|-----------|-----------|-----------|-----------|
| Risk | ... | ... | ... |
| Effort | ... | ... | ... |
| Speed to feedback | ... | ... | ... |
| Reversibility | ... | ... | ... |

Recommend one approach with reasoning. Tag any decisions made with incomplete
data as **Decision Debt** — to be revisited in later milestones.

> For multi-agent teams: see `workflow/playbooks/planning/sbao-ranking.md` for
> the full SBAO process with external sessions and sub-agents. The triangular
> tension analysis above is the single-agent default.

**BLOCKING GATE:** "Recommended approach: [A]. Proceed to milestones?"

## Phase 4 — Milestones

Structure implementation as milestones using these archetypes:
<!-- ADAPT: Rename or reorder for your process -->
1. **Prove It Works** — smallest slice that validates the approach
2. **Make It Real** — core functionality, happy path complete
3. **Make It Solid** — error handling, edge cases, tests
4. **Make It Shine** — performance, polish, documentation

Each milestone must have:
- Clear deliverable (what ships)
- Exit criteria (how to know it's done)
- Kill criteria (what would make us stop here)
- Depends on (which milestone must complete first)

After completing each milestone, re-read the NEXT milestone and rewrite it
based on what you learned. Plans evolve — the Phase 4 milestones written
before implementation are hypotheses, not commitments.

**BLOCKING GATE:** Present milestones. "Approve and start implementing?"

## Common Failure Modes

1. **Brief dump** — agent presents all 8 sections at once. Walk through one at a time.
2. **Self-answering elaboration** — agent answers its own Phase 2 questions. Wait for the user.
3. **Stale continuation** — agent resumes from a plan that no longer matches the code. Check staleness.

## Constraints

<!-- FIXED: Do not adapt these -->
- MUST walk through brief sections one at a time, not dump all at once
- MUST NOT answer your own elaboration questions
- MUST surface kill criteria in Phase 1, not defer to Phase 4
- MUST tag low-confidence decisions as Decision Debt
- MUST re-read next milestone after completing each one
- MUST NOT fabricate file paths or function names
- MUST audit sub-agent output if using multi-agent SBAO (lessons.md #5)

## Output Format

Phase 1: Feature brief (8 sections, walked through individually)
Phase 3: Comparison table + recommendation
Phase 4: Milestone cards with deliverable, exit criteria, kill criteria, dependencies

## Chains With

- /goat-investigate — need research before planning
- /goat-test — milestones need verification plans
- /goat-review — plan needs review before implementation starts

**Handoff shape:** `{feature_brief, approach_chosen, milestones, kill_criteria}`
