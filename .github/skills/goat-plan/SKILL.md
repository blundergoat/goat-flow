---
name: goat-plan
description: "Milestone task file generator and manager. Creates structured milestone files in .goat-flow/tasks/ that track progress, enforce testing gates, and provide shared state between human and coding agent."
goat-flow-skill-version: "1.1.0"
---
# /goat-plan

## Shared Conventions

Read `.goat-flow/skill-preamble.md` for shared conventions.
On full-depth, also read `.goat-flow/skill-conventions.md`.
If unavailable, use these essentials:
- Severity: SECURITY > CORRECTNESS > INTEGRATION > PERFORMANCE > STYLE
- Evidence: every finding MUST include file or file:line, tag OBSERVED vs INFERRED
- Learning loop: check .goat-flow/lessons/ and .goat-flow/footguns/ after completion
- Gates: BLOCKING GATE = stop and wait. CHECKPOINT = continue unless interrupted.

## When to Use

Use when work needs breaking into milestones with tracked progress. goat-plan creates and manages milestone files in `.goat-flow/tasks/` — the shared state between human and coding agent.

**Invoke when:**
- A feature, project, or significant change needs structured milestones before implementation
- The dispatcher's Planning Route has produced a brief and now needs milestone breakdown
- A goat-sbao critique recommends restructuring the approach — milestones need rewriting
- Mid-implementation: scope changed, something unexpected happened, milestones need updating
- Resuming work after a break — milestone files show where you stopped and what's next

**NOT this skill:**
- Writing a feature brief → dispatcher Planning Route
- Sharpening requirements → dispatcher Planning Route (mob elaboration)
- Critiquing a plan → /goat-sbao
- Finding testing gaps → /goat-test
- Diagnosing a bug → /goat-debug
- Reviewing code → /goat-review

## Step 0 — Intake

**Check for existing milestones first:**
- Read `.goat-flow/tasks/` for any existing milestone files
- If found: "Milestone files exist for [feature]. Resume from here, update milestones, or start fresh?"
- If found but stale: check `git log --since="2 weeks ago" -- .goat-flow/tasks/` — if code has moved on but milestones haven't been updated, flag it

**If starting fresh:**
1. What are we building? (Accept: a brief from the dispatcher, a requirements doc, a conversation summary, or just a description)
2. What's the riskiest part? (This determines which milestone comes first)
3. What would make us abandon this entirely? (Kill criteria)
4. Read `.goat-flow/footguns/` for the target area

**Minimum viable input:** A clear description of what to build. Everything else can be inferred or asked during milestone creation.

**CHECKPOINT:** "Creating milestones for [feature]. Riskiest part: [risk]. Kill criteria: [criteria]. Proceeding to milestone breakdown."

## Phase 1 — Milestone Breakdown

Structure the work into milestones using these archetypes. Adapt the count to the project — small features might need 2, large ones might need 5+.

### Milestone Archetypes

1. **Prove It Works** — Validate the riskiest assumption. Throwaway spike if needed. No polish, no edge cases, no auth. If this fails, we stop before investing further.
2. **Make It Real** — End-to-end pipeline working. Someone other than the builder can test it. The full flow works with real data. Rough edges are fine.
3. **Make It Solid** — Handle edge cases, errors, security, and UX. Incorporate feedback from previous milestones. Shippable after this.
4. **Make It Shine** — Polish, performance, docs, open source prep. Explicitly optional — mark as such.

**Spike-first rule:** If uncertain about a library, API, performance characteristic, or integration point — that uncertainty goes in Milestone 1 as a spike, not Milestone 3 as a risk.

### For each milestone, produce:

- **Objective** — 1-2 sentences: what this milestone proves or delivers
- **Tasks** — Checkboxes. Ordered by dependency. Each task is a concrete action, not a vague goal.
- **Assumptions to validate** — What must be proven true during this milestone (not tasks — beliefs about the system)
- **Exit criteria** — Testable, binary pass/fail. Not "performance is acceptable" — instead "p95 latency under 500ms"
- **Testing gate** — What must be verified before starting the next milestone:
  - Automated: which test commands must pass
  - Manual: what a human must check
  - Acceptance: who signs off (developer self-check, QA review, or stakeholder demo)
- **Kill criteria** — What would make us stop at this milestone rather than continue
- **Depends on** — Which milestone must complete first

### Task quality rules

Good tasks:
- `[ ] Add /api/export endpoint returning CSV for a single report`
- `[ ] Spike: benchmark NeMo VRAM usage with both models loaded — target: under 14GB`
- `[ ] Wire S3 presigned URL generation with 15-minute expiry`

Bad tasks:
- `[ ] Set up the backend` — too vague, what specifically?
- `[ ] Make it work` — not a task, it's a wish
- `[ ] Research options` — open-ended with no exit criteria

Each task should be completable in a single coding session. If it's bigger, split it.

### Assumption tracking

Assumptions are not tasks — they're beliefs about the system that affect the plan:

```markdown
## Assumptions
- [x] NeMo VRAM stays under 14GB with both models loaded (benchmarked in M1)
- [ ] S3 presigned URLs work with our CORS setup (untested)
- [x] sqlc generates correct types for JSONB columns (spike confirmed in M1)
- [ ] WebSocket reconnection handles mid-stream disconnects (assumed, not tested)
```

When an assumption is validated, tick it and note the evidence. When an assumption is invalidated, update the milestone plan immediately — don't continue building on a false premise.

**BLOCKING GATE:** Present all milestones. "Approve milestones and start implementing, or adjust?"

## Phase 2 — Write Milestone Files

After approval, write each milestone to `.goat-flow/tasks/` as a separate file:

**Filename format:** `M<NN>-<slug>.md`
- `M01-prove-bulk-export.md`
- `M02-end-to-end-pipeline.md`
- `M03-error-handling-and-security.md`

**File format:**

```markdown
# M01: Prove Bulk Export Works

**Status:** not-started | in-progress | testing-gate | complete | blocked | abandoned
**Objective:** Validate that we can queue and process a 500-report export job under 30s.
**Depends on:** none
**Kill criteria:** If export processing exceeds 60s for 500 reports, abandon this approach.

## Assumptions
- [ ] Background job queue can handle 500-item batches (untested)
- [ ] CSV generation library handles unicode correctly (assumed)

## Tasks
- [ ] Add ExportJob model with status enum (queued/processing/complete/failed)
- [ ] Spike: benchmark CSV generation for 500 reports — target: under 10s
- [ ] Wire background job processor with 5-minute timeout
- [ ] Add /api/exports endpoint (POST to queue, GET for status)
- [ ] Add basic error handling (job failure → status:failed with reason)

## Exit Criteria
- [ ] 500-report export completes in under 30s in local dev
- [ ] Failed jobs have a clear error message in the status response
- [ ] Spike benchmark results documented

## Testing Gate
**Automated:** `composer test -- --filter ExportJob`
**Manual:** Trigger a 500-report export via API, verify CSV output, check job status endpoint
**Acceptance:** Developer self-check — demo to self before proceeding to M02
```

**CHECKPOINT:** "Milestone files written to `.goat-flow/tasks/`. Ready to start implementation."

## Phase 3 — Between Milestones

This phase triggers automatically when a milestone's tasks and exit criteria are complete. It's the most important phase — this is where plans evolve.

### Testing Gate Enforcement

Before starting the next milestone:

1. **Run automated checks:** Execute the testing gate commands. All must pass.
2. **Complete manual checks:** Verify each manual testing item. Record results.
3. **Acceptance sign-off:** Whoever is designated must confirm.

If the testing gate fails: STOP. Fix before proceeding. Do not start the next milestone with a broken foundation.

### Milestone Retrospective

After the testing gate passes:

1. **What did we learn?** Anything surprising, harder than expected, or easier than expected?
2. **Assumption check:** Tick validated assumptions. Flag invalidated ones.
3. **Kill criteria check:** Has any kill criterion been triggered?
   - If yes: **BLOCKING GATE.** Present the triggered criterion and evidence. Human decides: continue anyway, pivot, or abandon.
4. **Re-read the next milestone.** Does what we learned invalidate any tasks, assumptions, or exit criteria?
5. **Update before proceeding.** If the next milestone needs changes, update the file BEFORE starting work. Present changes to human.

### Status Updates

Update the completed milestone's status to `complete`. Update the next milestone's status to `in-progress`.

### Session Log

Write a session log entry: what was built, what was learned, what assumptions changed, what's next.

**CHECKPOINT:** "M[N] complete. Testing gate passed. M[N+1] reviewed and [unchanged / updated]. Proceeding."

## Updating Milestones Mid-Flight

Milestones are hypotheses, not commitments. When new information arrives:

**Triggers for update:**
- Unexpected failure invalidates an assumption
- Scope change from stakeholder
- A task is much harder or easier than estimated
- A dependency is blocked
- goat-sbao critique recommends restructuring

**Update protocol:**
1. Read the current milestone file
2. Identify what changed and why
3. Update tasks, assumptions, exit criteria, or kill criteria as needed
4. If the change affects future milestones, update those files too
5. Present the diff to the human: "Milestone updated because [reason]. Changes: [summary]. Approve?"

**Never silently change milestones.** The human must see and approve updates. The milestone files are the contract between human and agent.

## Constraints

- MUST write milestone files to `.goat-flow/tasks/` — milestones without files don't exist
- MUST check for existing milestone files before creating new ones
- MUST include a testing gate on every milestone — no milestone ships without verification
- MUST re-read and potentially update the next milestone after completing each one
- MUST check kill criteria between milestones — a triggered criterion is a BLOCKING GATE
- MUST tick assumption checkboxes with evidence when validated or invalidated
- MUST present milestone updates to human for approval — never silently change
- MUST order tasks within a milestone so the riskiest work comes first
- MUST ensure each task is completable in a single coding session — split if not
- MUST NOT create vague tasks ("set up backend", "make it work", "research options")
- MUST NOT skip the testing gate between milestones
- Universal constraints from skill-preamble.md apply.
- MUST NOT continue building on an invalidated assumption — update the plan first
- Status tracking: update milestone file status field as work progresses

## Output Format

The output IS the milestone files. No separate report needed.

Summary format for presentation:

```markdown
## Milestones for [feature]

### M01: [name] — [archetype]
**Objective:** [1-2 sentences]
**Tasks:** [N] | **Exit criteria:** [N] | **Testing gate:** [auto + manual + acceptance]
**Kill criteria:** [condition]

### M02: [name] — [archetype]
...

**Total milestones:** [N] | **Estimated sessions:** [rough guess]
**Riskiest milestone:** M[N] because [reason]
**Kill criteria summary:** [what would stop the entire effort]
```
