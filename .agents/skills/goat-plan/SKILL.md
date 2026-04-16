---
name: goat-plan
description: "Milestone task file generator and manager. Creates structured milestone files in .goat-flow/tasks/ that track progress, enforce testing gates, and provide local working state for the current session."
goat-flow-skill-version: "1.1.0"
---
# /goat-plan

## Shared Conventions

Read `.goat-flow/skill-preamble.md` for shared conventions.
On full-depth, also read `.goat-flow/skill-conventions.md`.

## When to Use

Use when work needs breaking into milestones with tracked progress. goat-plan creates and manages milestone files in `.goat-flow/tasks/` - local working state for the current session. These files are gitignored and not committed; they exist to coordinate between the human and coding agent during a work session, not as permanent project artifacts.

**Invoke when:**
- A feature, project, or significant change needs structured milestones before implementation
- The dispatcher's Planning Route has produced a brief and now needs milestone breakdown
- A goat-sbao critique recommends restructuring the approach - milestones need rewriting
- Mid-implementation: scope changed, something unexpected happened, milestones need updating
- Resuming work after a break - milestone files show where you stopped and what's next

**NOT this skill:**
- Writing a feature brief → dispatcher Planning Route
- Sharpening requirements → dispatcher Planning Route
- Critiquing a plan → /goat-sbao
- Finding testing gaps → /goat-test
- Diagnosing a bug → /goat-debug
- Reviewing code → /goat-review

## Step 0 - Intake

**Check for existing milestones first:**
- Read `.goat-flow/tasks/` for any existing milestone files
- If found: "Milestone files exist for [feature]. Resume from here, update milestones, or start fresh?"
- If found but stale: check whether code has moved on but milestones haven't been updated, flag it. Note: task files are gitignored, so `git log` won't track them - check file modification dates instead
- Also check for legacy milestone files outside `.goat-flow/tasks/` (for example `milestones/`, `tasks/`). If found, note them so the user knows about existing planning artifacts.

**If starting fresh:**
1. What are we building? (Accept: a brief from the dispatcher, a requirements doc, a conversation summary, or just a description)
2. What's the riskiest part? (This determines which milestone comes first)
3. What would make us abandon this entirely? (Kill criteria)
4. Read `.goat-flow/footguns/` for the target area

**Detect read-only intent:**
If the user's phrasing suggests analysis rather than implementation, offer read-only mode:
- Analysis signals: "what would the milestones look like", "break this down for me", "plan this out", "how would you approach", "sketch the milestones", "walk me through the plan"
- Implementation signals: "create milestones", "set up the plan", "write the milestone files", "start planning"
- If analysis signals detected: "This sounds like a planning analysis. I can present milestones inline without writing files (read-only mode), or write them to `.goat-flow/tasks/`. Which do you prefer?"
- If ambiguous, default to asking.

**Minimum viable input:** A clear description of what to build. Everything else can be inferred or asked during milestone creation.

**CHECKPOINT:** "Creating milestones for [feature]. Riskiest part: [risk]. Kill criteria: [criteria]. Proceeding to milestone breakdown."

## Phase 1 - Milestone Breakdown

Structure the work into milestones using these archetypes. Adapt the count to the project - small features might need 2, large ones might need 5+.

### Milestone Archetypes

1. **Prove It Works** - Validate the riskiest assumption. Throwaway spike if needed. No polish, no edge cases, no auth. If this fails, we stop before investing further.
2. **Make It Real** - End-to-end pipeline working. Someone other than the builder can test it. The full flow works with real data. Rough edges are fine.
3. **Make It Solid** - Handle edge cases, errors, security, and UX. Incorporate feedback from previous milestones. Shippable after this.
4. **Make It Shine** - Polish, performance, docs, open source prep. Explicitly optional - mark as such.

**Spike-first rule:** If uncertain about a library, API, performance characteristic, or integration point - that uncertainty goes in Milestone 1 as a spike, not Milestone 3 as a risk.

### For each milestone, produce:

- **Objective** - 1-2 sentences: what this milestone proves or delivers
- **Tasks** - Checkboxes. Ordered by dependency. Each task is a concrete action, not a vague goal.
- **Assumptions to validate** - What must be proven true during this milestone (not tasks - beliefs about the system)
- **Exit criteria** - Testable, binary pass/fail. Not "performance is acceptable" - instead "p95 latency under 500ms"
- **Testing gate** - What must be verified before starting the next milestone:
  - Automated: which test commands must pass
  - Manual: what a human must check
  - Acceptance: who signs off (developer self-check, QA review, or stakeholder demo)
- **Kill criteria** - What would make us stop at this milestone rather than continue
- **Depends on** - Which milestone must complete first

### Task quality rules

Good tasks:
- `[ ] Add /api/export endpoint returning CSV for a single report`
- `[ ] Spike: benchmark memory usage under load - target: under 2GB RSS`
- `[ ] Add background task processor with 5-minute timeout and status tracking`

Bad tasks:
- `[ ] Set up the backend` - too vague, what specifically?
- `[ ] Make it work` - not a task, it's a wish
- `[ ] Research options` - open-ended with no exit criteria

Each task should be completable in a single coding session. If it's bigger, split it.

### Assumption tracking

Assumptions are not tasks - they're beliefs about the system that affect the plan:

```markdown
## Assumptions
- [x] Background job queue handles 500-item batches (benchmarked in M1)
- [ ] File upload endpoint accepts multipart form data (untested)
- [x] Database migration runs without downtime (spike confirmed in M1)
- [ ] Rate limiting handles concurrent requests correctly (assumed, not tested)
```

When an assumption is validated, tick it and note the evidence. When an assumption is invalidated, update the milestone plan immediately - don't continue building on a false premise.

**BLOCKING GATE:** Present all milestones. "Approve milestones and start implementing, or adjust?"

## Phase 2 - Write Milestone Files

### Small-work Inline Mode

For Hotfix / Small Feature scope (typically 1-2 milestones, low blast radius), you may deliver milestones inline.

Use this prompt:

> "Would you like milestones in inline form first, or written to `.goat-flow/tasks/` now?"

If the user says proceed inline, present milestone tasks in the chat and continue from there.
If the user prefers files or scope is Standard/System, write each milestone to `.goat-flow/tasks/` as separate files and continue in standard format.

### Read-Only / Analysis Mode

For planning analysis, critiques, brainstorming, or discussions where no files should be written. Available at any complexity level, including Standard and above.

**When to use:** The user wants to see what the milestones would look like, explore approaches, or get a structured breakdown without committing to files. Detected in Step 0 via analysis-intent signals, or explicitly requested.

**Behaviour:**
- Run Phase 1 (Milestone Breakdown) in full - same archetypes, same task quality rules, same assumption tracking
- Present all milestones inline in the response using the same structure as file-based milestones (objective, tasks, assumptions, exit criteria, testing gates, kill criteria, dependencies)
- Skip the "Write Milestone Files" step entirely - no files created, no `.goat-flow/tasks/` changes
- Skip Phase 3 (Between Milestones) - there are no files to update between milestones
- Still include the summary format from Output Format at the end

**Transition to file mode:** If the user later says "write these to files", "let's go ahead", or "create the milestones", write the already-approved milestones to `.goat-flow/tasks/` without re-running the breakdown. Treat the inline milestones as the approved output of Phase 1.

**CHECKPOINT:** "Here are the milestones for [feature] (read-only - no files written). Say 'write to files' to persist them, or adjust first."

After approval, write each milestone to `.goat-flow/tasks/` as a separate file:

**Filename format:** `M<NN>-<slug>.md`
- `M01-prove-api-integration.md`
- `M02-end-to-end-pipeline.md`
- `M03-error-handling-and-security.md`

**File format:**

```markdown
# M01: Prove API Integration Works

**Status:** not-started | in-progress | testing-gate | complete | blocked | abandoned
**Objective:** Validate that the external API returns the expected data format and meets latency targets.
**Depends on:** none
**Kill criteria:** If API response time exceeds 2s p95, abandon this integration approach.

## Assumptions
- [ ] External API supports pagination (untested)
- [ ] Response schema matches our internal model (assumed from docs)

## Tasks
- [ ] Spike: call the API with real credentials and log response shape
- [ ] Add integration client with retry logic and timeout
- [ ] Add response validation against expected schema
- [ ] Add error handling (API down → graceful fallback with cached data)

## Exit Criteria
- [ ] API call succeeds with real credentials in local dev
- [ ] Response matches expected schema
- [ ] Spike results documented

## Testing Gate
**Automated:** Run integration tests filtered to the changed module
**Manual:** Trigger the API call, verify response, check error handling path
**Acceptance:** Developer self-check - demo to self before proceeding to M02
```

**CHECKPOINT:** "Milestone files written to `.goat-flow/tasks/`. Ready to start implementation."

## Phase 3 - Between Milestones

After each milestone, run the testing gate first; any failure is BLOCKING.
Capture what was learned, then re-read the next milestone and update invalidated assumptions, tasks, or exit criteria.
Set status: prior milestone `complete`, next milestone `in-progress`.
**CHECKPOINT:** "Milestone gate passed. Do you want to proceed with M[N+1]?"

If updates are needed mid-flight, follow the detailed milestone retrospective protocol in `skill-conventions.md`; never change milestones silently.

## Constraints

- Default to inline/read-only milestones unless the user explicitly requests file creation. Offer to write milestone files to `.goat-flow/tasks/` when scope is Standard or above, but do not write without confirmation.
- MUST check for existing milestone files before creating new ones
- MUST include a testing gate on every milestone - no milestone ships without verification
- MUST re-read and potentially update the next milestone after completing each one
- MUST check kill criteria between milestones - a triggered criterion is a BLOCKING GATE
- MUST tick assumption checkboxes with evidence when validated or invalidated
- MUST present milestone updates to human for approval - never silently change
- MUST order tasks within a milestone so the riskiest work comes first
- MUST ensure each task is completable in a single coding session - split if not
- MUST NOT create vague tasks ("set up backend", "make it work", "research options")
- MUST NOT skip the testing gate between milestones
- Universal constraints from skill-preamble.md apply.
- MUST NOT continue building on an invalidated assumption - update the plan first
- Status tracking: update milestone file status field as work progresses

## Output Format

The output IS the milestone files. No separate report needed. In read-only/analysis mode, the output is the inline milestone breakdown in the response.

Summary format for presentation:

```markdown
## Milestones for [feature]

### M01: [name] - [archetype]
**Objective:** [1-2 sentences]
**Tasks:** [N] | **Exit criteria:** [N] | **Testing gate:** [auto + manual + acceptance]
**Kill criteria:** [condition]

### M02: [name] - [archetype]
...

**Total milestones:** [N] | **Estimated sessions:** [rough guess]
**Riskiest milestone:** M[N] because [reason]
**Kill criteria summary:** [what would stop the entire effort]
```
