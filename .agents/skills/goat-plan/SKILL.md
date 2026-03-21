---
name: goat-plan
description: "Plan a feature with phased human gates"
---
# GOAT Plan

Guide the user through the full planning workflow: Feature Brief → Mob Elaboration → SBAO Ranking → Milestone Planning. Each phase produces an artifact. Each phase ends with a human gate.

Read the playbook templates in `workflow/playbooks/planning/` — they are the authoritative source for each phase's format.

---

## Step 0 — Where Are We?

First, check for in-progress planning artifacts: look for `requirements-*.md` or `TODO_*_prime.md` in the repo root or `tasks/`. Also check conversation context for recent /goat-plan usage.

If you find evidence of an in-progress plan, ask: **"Are we still planning [feature name from the artifact]? Or is this something new?"**

If no evidence, ask: **"Where are we in the planning process? Pick a number or describe:"**

| # | Phase | When to use |
|---|---|---|
| **0** | Start fresh | New feature, no existing docs |
| **1** | Feature Brief | Need to write the requirements doc |
| **2** | Mob Elaboration | Have a brief, need to stress-test it |
| **3** | SBAO Ranking | Need competing plans or want to sharpen an existing plan |
| **4** | Milestone Planning | Have an approved plan, need to break it into milestones |

The user can say a number (e.g. "3"), a phase name (e.g. "SBAO"), or describe their situation (e.g. "I have a plan, sharpen it" → Phase 3).

Do NOT assume the user is starting from scratch. Ask first.

---

## Step 0b — Gather Context (only if starting fresh)

Ask the user these questions. Do NOT proceed until answered:

1. **What are we planning?** (feature name, one-line description)
2. **Why?** (business driver, user pain, or technical need)
3. **Complexity?** Hotfix / Standard / System / Infrastructure
4. **Any existing requirements?** (paste, point to a doc, or "starting from scratch")

**Route based on complexity:**
- **Hotfix** → write a brief (Phase 1 compressed), then stop. Skip elaboration, SBAO, milestones.
- **Standard** → Phase 1 (brief) → Phase 4 (milestones). Skip elaboration and SBAO.
- **System / Infrastructure** → full process: Phase 1 → 2 → 3 → 4.

Tell the user which phases apply to their complexity level before starting.

---

## Phase 1 — Feature Brief

**You are driving this.** Read `workflow/playbooks/planning/feature-brief.md` for the full template.

Walk the user through each section interactively. Ask one section at a time — do not dump the entire template at once.

**Section order:**

1. **Lean hypothesis:** "We believe that [building X] for [these users] will [achieve this outcome]. We will know we're right when we see [this signal]." Ask the user to fill in the brackets. Help them sharpen it.

2. **Problem & outcome:** Ask: "How does it work today? What's the manual workaround? What does a win look like?"

3. **Users & use cases:** Ask for 3-5 user stories. Format: "As a [user], I want to [action], so that [benefit]."

4. **Scope & constraints:** Ask: "What's in scope? What's explicitly OUT of scope? Any hard constraints — deadlines, budget, compliance, performance?"

5. **Non-functional requirements:** Walk through: performance targets, security/auth changes, data sensitivity, accessibility, observability. Skip what doesn't apply.

6. **Risks, assumptions & edge cases:** Ask: "What could go wrong? What are you assuming is true but haven't validated? Give me 3-5 edge cases."

7. **System & impact:** Ask: "Which systems/services does this touch? Any dependencies on external APIs or infrastructure? Who are the stakeholders?"

8. **Success criteria:** Ask: "How do we measure success? Give me 2-3 specific, testable metrics."

**Output:** Write `requirements-<feature-name>.md` with all sections filled in.

**HUMAN GATE:** Present the brief. Ask: "Does this capture everything? Anything to add, change, or cut?" Do NOT proceed until the user approves.

---

## Phase 2 — Mob Elaboration

**You are the interrogator.** Read `workflow/playbooks/planning/mob-elaboration.md` for the full prompt.

Now that the brief exists, your job is to stress-test it. Generate exactly 3-5 sharp questions across these categories:

1. **Business logic & constraints** — "What are the hard rules? Data limitations? Specific performance thresholds?"
2. **Edge cases & failure modes** — "What happens when [X] fails? What if the input is [Y]? What's the system limit?"
3. **Architecture & state** — "How does this integrate with [existing system]? What state changes? What services are touched?"

Present all questions at once. **Then stop and wait.** Do not answer your own questions.

After the user answers, either:
- Ask follow-up questions if answers reveal new unknowns
- Or confirm: "Requirements are locked in. Here's the updated brief."

Update `requirements-<feature-name>.md` with the elaboration results.

**HUMAN GATE:** "Are requirements locked in, or do you want another round of questions?" Do NOT proceed until confirmed.

---

## Phase 3 — SBAO Ranking

**Only for System/Infrastructure complexity.** Read `workflow/playbooks/planning/sbao-ranking.md` for the full process.

SBAO is a **multi-agent adversarial process** — different agents/models produce competing plans and critique each other. The value comes from triangulation, context sanitisation, and adversarial cross-examination. One agent roleplaying multiple perspectives is NOT SBAO.

### Step 3a — Generate Competing Plans

Ask the user: **"How do you want to generate competing plans?"**

| Option | How it works | Best when |
|---|---|---|
| **A. External sessions** | User opens 2-3 separate agent sessions (different models — Claude + Codex + Gemini) and pastes the prompt into each | Maximum diversity, different model blind spots |
| **B. Sub-agents** | You spawn 3 sub-agents in parallel, each with fresh context and the same prompt | Fastest, no manual copy-paste, stays in one session |
| **C. Mixed** | You spawn 1-2 sub-agents AND the user runs 1 external session (ideally a different model) | Balance of speed and cross-model diversity |

Give the user the prompt to use (for external sessions) or spawn directly (for sub-agents):

```
Deeply review the codebase and the following requirements
(attach requirements-<feature-name>.md), and give me a technical
plan in this file TODO_<feature-name>_<model>.md
```

**For sub-agents:** spawn each with a fresh context, the prompt above, and the requirements doc. Each sub-agent writes its plan independently. Collect the results.

**For external sessions:** give the user the prompt to paste. Then stop and wait — the user needs to run this in other sessions and come back with the plan files.

**For mixed:** spawn sub-agents AND give the user the prompt for their external session. Collect all plans when ready.

### Step 3b — Rank the Plans

Once all plans are in, read them all. Present:

1. Comparison table ranking each plan out of 100 with reasons
2. Where they agree (consensus) and where they disagree (dissent)
3. Spec bugs or issues found across plans

### Step 3c — Recommend Improvements

Based on the ranking, present a brief list of recommended changes. For each recommendation:
- **What:** the concrete change
- **Why:** one sentence explaining why this matters (what breaks or gets better)
- **Source:** which plan(s) identified it

Group by category (spec fixes, architecture, testing, new features). Prioritise: what matters most first.

Ask: **"Do you agree with these improvements? Anything to add or cut?"** Wait for user reaction.

### Step 3d — Prime Plan

Ask the user:
- **Keep:** which ideas/approaches to keep from across the plans
- **Drop:** which to discard
- **Decide:** which trade-offs to weigh in on

Synthesise a prime plan incorporating Keep items, avoiding Drop items, and making a reasoned recommendation for each Decide item.

**Output:** Write `TODO_<feature-name>_prime.md`

After writing the prime plan, present a **concise 10 bullet point summary** of the key decisions. No detail — just the headlines so the user can quickly confirm the direction.

**HUMAN GATE:** Present the summary + link to the full plan. Ask: "Is this the right approach? Anything to change before we break it into milestones?" Do NOT proceed until approved.

---

## Phase 4 — Milestone Planning

**You are structuring the work.** Read `workflow/playbooks/planning/milestone-planning.md` for the full prompt.

### The First Rule

**Spikes before implementation.** Before writing real code for anything uncertain, write a throwaway script to explore it. Call an API. Profile memory. Benchmark the approach. A 30-minute spike can save days of rework.

### Milestone Archetypes

Break the project into milestones using these archetypes. Adapt the number to the project — small projects might collapse into 2, large projects might split one archetype across multiple milestones.

1. **Prove It Works** — Validate the riskiest assumptions. Build the minimum needed to prove feasibility. No polish, no edge cases, no auth.
2. **Make It Real** — Connect the pieces so someone else can test it. Full flow with real data. Rough edges fine.
3. **Make It Solid** — Handle edge cases, errors, security, UX. Incorporate feedback. Shippable after this.
4. **Make It Shine** — Nice-to-haves, performance, docs, open source prep. Explicitly optional.

### For each milestone, provide:

- **Objective** (1-2 sentences)
- **Assumptions to validate** (checkboxes — what must be proven true, NOT task checkboxes)
  - Good: `[ ] S3 presigned URLs work with our CORS setup (untested)`
  - Bad: `[ ] Set up database` (that's a task, not an assumption)
- **Tasks** (checkboxes `- [ ]`, max 10 per milestone, each completable in one session)
- **Exit criteria** (testable, binary pass/fail — not "looks good" but "latency under 500ms at p95")
- **Human testing gate** (what the user must verify before the milestone is complete)
- **Gotchas & fallbacks** (table: specific risk → concrete fallback)
- **Key decisions** (architectural choices made and why)

### Milestone Completion Rules

- All tasks MUST be checkbox items (`- [ ]`) in the milestone file
- As each task is completed, tick it off (`- [x]`) in the milestone file immediately — do not batch
- All exit criteria MUST pass before the milestone is complete
- Every milestone ends with a **human testing gate** — the user verifies the work before sign-off
- A milestone is NOT complete until the user confirms the testing gate passes
- Do NOT start the next milestone until the current one is fully complete and user-approved
- After completing a milestone, re-read the next milestone and rewrite it based on what you learned

### Planning Rules

- Start with unknowns — riskiest work first
- Each milestone must be independently demoable
- Do NOT over-detail future milestones — one-paragraph objective + rough task list for anything beyond the next milestone
- Do NOT build for imagined requirements — hard-code it now, refactor when proven needed
- Do NOT treat the plan as fixed

**HUMAN GATE:** Present all milestones. Ask: "Ready to start M1, or does the plan need changes?" Do NOT proceed to implementation until approved.

---

## Constraints

- MUST gather context before starting (Step 0)
- MUST read the playbook templates in `workflow/playbooks/planning/` for each phase
- MUST walk the user through each phase interactively — do not dump templates
- MUST complete each phase before moving to the next
- MUST wait for human approval at every gate — never auto-advance
- MUST NOT generate code during planning (Plan mode only)
- MUST reference `docs/footguns.md` and `docs/architecture.md` during planning
- MAY skip Phase 2 + 3 for Standard features
- MAY compress to brief only for Hotfixes
