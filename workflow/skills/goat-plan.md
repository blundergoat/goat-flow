# Prompt: Create /goat-plan Skill

Paste this into your coding agent to create the `/goat-plan` skill — an agent-driven planning workflow that guides the user through the full planning playbook sequence with human gates between each phase.

---

## When to Use

Before any non-trivial implementation. Instead of manually pasting 4 separate planning prompts in sequence, invoke `/goat-plan` and the agent drives the process interactively.

---

## The Prompt

```
Create the /goat-plan skill for this project.

Purpose: guide the developer through the full GOAT Flow planning
sequence — feature brief, mob elaboration, SBAO ranking, and milestone
planning — as a single agent-driven workflow with human gates.

Write the skill file to: .claude/skills/goat-plan/SKILL.md
(For Codex/Gemini: .agents/skills/goat-plan/SKILL.md)

Read the planning playbooks in workflow/playbooks/planning/ for the
authoritative templates for each phase:
- workflow/playbooks/planning/feature-brief.md
- workflow/playbooks/planning/mob-elaboration.md
- workflow/playbooks/planning/sbao-ranking.md
- workflow/playbooks/planning/milestone-planning.md

## Step 0 - Where Are We?

The skill MUST first check for in-progress planning artifacts:
look for requirements-*.md or TODO_*_prime.md in the repo root or
tasks/. Also check conversation context for recent /goat-plan usage.

If evidence of an in-progress plan exists, ask: "Are we still
planning [feature name]? Or is this something new?"

If no evidence, ask: "Where are we in the planning process?
Pick a number or describe:"

  0 - Start fresh (new feature, no existing docs)
  1 - Feature Brief (need to write the requirements doc)
  2 - Mob Elaboration (have a brief, need to stress-test it)
  3 - SBAO Ranking (need competing plans or sharpen existing plan)
  4 - Milestone Planning (have approved plan, need milestones)

The user can say a number, a phase name, or describe their situation.
Do NOT assume the user is starting from scratch.

## Step 0b - Gather Context (only if starting fresh)

If Phase 0, ask the user:
1. What are we planning? (feature name, one-line description)
2. Why? (business driver, user pain, or technical need)
3. Complexity? Hotfix / Standard / System / Infrastructure
4. Any existing requirements? (paste, point to a doc, or "starting from scratch")

Do NOT proceed until the user has answered all 4 questions.

Route based on complexity:
- Hotfix → Phase 1 (compressed brief only), then stop
- Standard → Phase 1 (brief) → Phase 4 (milestones). Skip 2 and 3.
- System/Infrastructure → full process: Phase 1 → 2 → 3 → 4

Tell the user which phases apply before starting.

## Phase 1 - Feature Brief

Read workflow/playbooks/planning/feature-brief.md for the full template.

The skill MUST walk the user through each section interactively,
asking one section at a time. Do NOT dump the entire template.

Section order:
1. Lean hypothesis ("We believe [X] for [users] will [outcome]")
2. Problem & outcome (current state, desired state, why now)
3. Users & use cases (3-5 user stories)
4. Scope & constraints (in/out, hard constraints)
5. Non-functional requirements (performance, security, accessibility)
6. Risks, assumptions & edge cases (3-5 edge cases)
7. System & impact (systems touched, dependencies, stakeholders)
8. Success criteria (2-3 measurable metrics)

Output: requirements-<feature-name>.md

HUMAN GATE: Present the brief. Ask "Does this capture everything?"
Do NOT proceed until the user approves.

## Phase 2 - Mob Elaboration

Read workflow/playbooks/planning/mob-elaboration.md for the full prompt.

Stress-test the brief. Generate exactly 3-5 sharp questions across:
1. Business logic & constraints — hard rules, data limits, thresholds
2. Edge cases & failure modes — what happens when X fails
3. Architecture & state — integration, state changes, services touched

Present all questions. Then STOP and WAIT. Do not answer your own
questions. Iterate until the user confirms requirements are locked in.

Update requirements-<feature-name>.md with elaboration results.

HUMAN GATE: "Are requirements locked in?" Do NOT proceed until confirmed.

## Phase 3 - SBAO Ranking (System/Infrastructure only)

Read workflow/playbooks/planning/sbao-ranking.md for the full process.

SBAO is a MULTI-AGENT adversarial process. Different agents/models
produce competing plans and critique each other. One agent roleplaying
multiple perspectives is NOT SBAO.

Step 3a - Generate Competing Plans:
Ask the user how they want to generate plans:
  A. External sessions — user opens 2-3 agents (different models)
  B. Sub-agents — spawn 3 sub-agents in parallel with fresh context
  C. Mixed — spawn sub-agents AND user runs an external session

Give the user (or sub-agents) this prompt:

  Deeply review the codebase and the following requirements
  (attach requirements-<feature-name>.md), and give me a technical
  plan in this file TODO_<feature-name>_<model>.md

For sub-agents: spawn each with fresh context. Collect results.
For external sessions: STOP and WAIT for the user to return.
For mixed: spawn sub-agents AND give user the prompt.

Step 3b - Rank the Plans:
Once all plans are in, read them all. Present:
- Comparison table ranking each out of 100
- Where they agree (consensus) and disagree (dissent)
- Spec bugs or issues found across plans

Step 3c - Recommend Improvements:
Based on the ranking, present a brief list of recommended changes.
For each recommendation include:
- What: the concrete change
- Why: one sentence explaining why this matters
- Source: which plan(s) identified it

Group by category. Prioritise: what matters most first.

Ask: "Do you agree with these improvements? Anything to add or cut?"
Wait for user reaction.

Step 3d - Prime Plan:
Ask the user: Keep / Drop / Decide. Synthesise a prime plan
incorporating the agreed improvements.

Output: TODO_<feature-name>_prime.md

After writing the prime plan, present a concise 10 bullet point summary
of the key decisions. No detail — just the headlines so the user can
quickly confirm the direction.

HUMAN GATE: Present the summary + link to the full plan.
"Is this the right approach?" Do NOT proceed until approved.

## Phase 4 - Milestone Planning

Read workflow/playbooks/planning/milestone-planning.md for the full prompt.

The First Rule: spikes before implementation. Anything uncertain →
throwaway script to explore first.

Use milestone archetypes:
1. Prove It Works — validate riskiest assumptions, minimum viable proof
2. Make It Real — end-to-end pipeline, someone else can test it
3. Make It Solid — edge cases, errors, security, UX, shippable
4. Make It Shine — polish, stretch goals, explicitly optional

For each milestone provide:
- Objective (1-2 sentences)
- Assumptions to validate (checkboxes — NOT task checkboxes)
  Good: "[ ] S3 presigned URLs work with our CORS setup (untested)"
  Bad: "[ ] Set up database" (that's a task, not an assumption)
- Tasks (checkboxes - [ ], max 10, each completable in one session)
- Exit criteria (testable, binary — not "looks good" but
  "latency under 500ms at p95")
- Human testing gate (what the user must verify before sign-off)
- Gotchas & fallbacks (table: risk → fallback)
- Key decisions (choices made and why)

Milestone Completion Rules:
- All tasks MUST be checkbox items (- [ ]) in the milestone file
- Tick off each task (- [x]) as completed — do not batch
- All exit criteria MUST pass before milestone is complete
- Every milestone ends with a human testing gate
- Milestone is NOT complete until user confirms testing gate passes
- Do NOT start next milestone until current is fully complete
- After completing, re-read next milestone and rewrite based on learnings

Planning Rules:
- Start with unknowns — riskiest work first
- Each milestone independently demoable
- Do NOT over-detail future milestones
- Do NOT build for imagined requirements
- Do NOT treat the plan as fixed

HUMAN GATE: Present milestones. "Ready to start M1?" Do NOT proceed
until approved.

The skill MUST:
- Gather context before starting (Step 0)
- Read the playbook templates for each phase
- Walk the user through each phase interactively — not dump templates
- Complete each phase before moving to the next
- Wait for human approval at every gate — never auto-advance
- Reference docs/footguns.md and docs/architecture.md during planning
- Keep plans specific to THIS project's stack, not generic

The skill MUST NOT:
- Skip any phase without human permission
- Auto-approve its own output at any gate
- Generate code during planning (Plan mode only)
- Proceed past a human gate without explicit approval
- Answer its own elaboration questions (Phase 2)

The skill MAY:
- Skip Phases 2 + 3 for Standard features
- Compress to brief only for Hotfixes

VERIFICATION:
- Verify skill file exists at the correct path
- Verify all 4 phases are documented with human gates
- Verify the skill references workflow/playbooks/planning/
- Verify Step 0 context gathering is present
- Verify "walk through interactively" constraint is present
```
