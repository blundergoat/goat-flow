---
name: goat-plan
description: "Use when starting a non-trivial implementation that needs structured task breakdown with progress tracking."
goat-flow-skill-version: "1.2.3"
---
# /goat-plan

## Shared Conventions

Read `.goat-flow/skill-reference/skill-preamble.md` for shared conventions.
On full-depth, also read `.goat-flow/skill-reference/skill-conventions.md`.

## When to Use

Use when work needs breaking into milestones with tracked progress. goat-plan creates and manages milestone files in the active plan subdir of `.goat-flow/tasks/` (named by `.goat-flow/tasks/.active` - see Step 0) - local working state for the current session. These files are gitignored and not committed; they exist to coordinate between the human and coding agent during a work session, not as permanent project artifacts.

**Invoke when:**
- A feature, project, or significant change needs structured milestones before implementation
- The dispatcher's Planning Route has produced a brief and now needs milestone breakdown
- A `/goat-critique` run recommends restructuring the approach - milestones need rewriting
- Mid-implementation: scope changed, something unexpected happened, milestones need updating
- Resuming work after a break - milestone files show where you stopped and what's next

**NOT this skill:**
- Writing a feature brief → dispatcher Planning Route
- Sharpening requirements → dispatcher Planning Route
- Critiquing a plan → /goat-critique
- Finding testing gaps → /goat-qa
- Diagnosing a bug → /goat-debug
- Reviewing code → /goat-review

## Step 0 - Intake

**Check for existing milestones first:**
- Treat `.goat-flow/tasks/.active` as an advisory local pointer (one-line file naming a subdir, e.g. `1.2.2`), not a setup invariant.
- If `.active` exists and names an existing subdir, scan only that subdir for milestone files.
- If `.active` is missing or names a missing subdir, treat it as normal local churn (completed plan, project switch, or no task workflow). List top-level entries in `.goat-flow/tasks/` excluding `_archived`, prefer dirs with recent `M*.md` files, ask which plan is current, and offer to write/update `.active` for next time. Do NOT report a stale/missing `.active` target as a setup failure by itself.
- If the user explicitly names an existing milestone file, or clearly asks to "update", "improve", "tighten", "rewrite", or "fix" the current plan, treat that as approval to edit that file in place. Do NOT ask inline-vs-file or "resume/update/start fresh" when there is exactly one obvious target file. Ask only if multiple milestone files plausibly match or if the user explicitly signals strict no-write/no-file intent.
- If found: "Milestone files exist for [feature]. Resume from here, update milestones, or start fresh?" Use this only when the target file is not already obvious from the user's request.
- If the selected plan exists but appears stale: check whether code has moved on but milestones haven't been updated, flag it. Note: task files are gitignored, so `git log` won't track them - check file modification dates instead.
- Also check for legacy milestone files outside `.goat-flow/tasks/` (for example `milestones/`, `tasks/`). Sibling-version subdirs inside `.goat-flow/tasks/` (e.g. `1.4.0/`) hold deferred or completed work and are NOT scanned by default unless `.active` is missing or points nowhere. If found, note them so the user knows about existing planning artifacts.

**If starting fresh:**
1. What are we building? (Accept: a brief from the dispatcher, a requirements doc, a conversation summary, or just a description)
2. What's the riskiest part? (This determines which milestone comes first)
3. What would make us abandon this entirely? (Kill criteria)
4. Use the preamble's grep-first learning-loop retrieval on `.goat-flow/footguns/` for the target area

**Pick exactly one mode.** Apply these signals in order - stop at the first that matches:

1. **Named-File Update** - user names an existing milestone file OR asks to "update", "improve", "tighten", "rewrite", or "fix" a specific plan. Treat as explicit write approval; proceed to Phase 2 § Mode 1. Re-prompt only if multiple files plausibly match, or the user also says "review only" / "read-only" / "don't write yet" (treat those as strict no-write for milestone files).
2. **Read-Only Analysis** - analysis signals: "what would the milestones look like", "break this down for me", "plan this out", "how would you approach", "sketch the milestones", "walk me through the plan". No files written; inline output; Phase 3 skipped; transition to file mode available later.
3. **Inline-Then-Write** - Hotfix / Small Feature scope (1-2 milestones, low blast radius) with no analysis signals. Offer: *"Would you like milestones in inline form first, or written to `.goat-flow/tasks/<active>/` now?"* Inline first; write on approval.
4. **File-Write (default at Standard+)** - implementation signals ("create milestones", "set up the plan", "write the milestone files", "start planning") OR Standard / System / Infrastructure scope with no analysis signals. Write directly to `.goat-flow/tasks/<active>/`.

If analysis signals AND implementation signals BOTH appear, ask. If the request is too ambiguous to classify, ask. Never silently pick.

**Minimum viable input:** A clear description of what to build. Everything else can be inferred or asked during milestone creation.

**CHECKPOINT:** "Mode: [Named-File Update | Read-Only Analysis | Inline-Then-Write | File-Write]. Creating milestones for [feature]. Riskiest part: [risk]. Kill criteria: [criteria]. Proceeding to milestone breakdown."

## Phase 1 - Milestone Breakdown

Structure the work into milestones using these archetypes. Adapt the count to the project - small features might need 2, large ones might need 5+.

### Milestone Archetypes

1. **Prove It Works** - Validate the riskiest assumption. Throwaway spike if needed. No polish, no edge cases, no auth. If this fails, we stop before investing further.
2. **Make It Real** - End-to-end pipeline working. Someone other than the builder can test it. The full flow works with real data. Rough edges are fine.
3. **Make It Solid** - Handle edge cases, errors, security, and UX. Incorporate feedback from previous milestones. Shippable after this.
4. **Make It Shine** - Polish, performance, docs, open source prep. Explicitly optional - mark as such.

**Spike-first rule:** If uncertain about a library, API, performance characteristic, or integration point - that uncertainty goes in Milestone 1 as a spike, not Milestone 3 as a risk.

| Excuse | Reality |
|--------|---------|
| "N milestones is what they asked for, stick to the count" | Milestone count is fine; dropping the spike to hit the count isn't. Add the M1 spike even if it means N+1. |
| "Tight deadline means skip the full intake" | The tight deadline is *why* M1 must be a spike - fail fast on unknowns, not last. |
| "Kill criteria are ceremony for something this straightforward" | Anything touching money, auth, or data is not "straightforward". Name the kill criteria anyway. |
| "User said no ceremony, just paste it" | Authority pressure. Skill integrity overrides politeness when the user is asking the skill to do something that defeats its purpose. |

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

## Phase 2 - Deliver Milestones

The delivery path maps 1:1 to the mode picked in Step 0. Do exactly the mode's block; do not cross modes mid-flow.

### Mode 1: Named-File Update (edit in place)

The user named or clearly implied an existing milestone file. The request is explicit write approval - do not re-prompt.

- Edit the named or obvious milestone file in place. Do NOT create a parallel inline plan.
- Preserve title/status metadata unless the requested change requires updating them.
- Present the updated milestone content or a concise delta after editing.
- Ask only if multiple milestone files are plausible targets, or if the change would spill beyond the named planning surface into additional files.

### Mode 2: Strict No-Write Analysis (no files)

Analysis signals triggered this mode in Step 0. Available at any complexity, including Standard+.

- Run Phase 1 (Milestone Breakdown) in full - same archetypes, same task quality rules, same assumption tracking.
- Present all milestones inline using the same structure as file-based milestones (objective, tasks, assumptions, exit criteria, testing gates, kill criteria, dependencies).
- Do NOT write any file. Do NOT modify `.goat-flow/tasks/`.
- Skip Phase 3 (Between Milestones) - there are no files to update.
- Still include the summary format from Output Format at the end.

**Transition out:** If the user later says "write these to files" / "let's go ahead" / "create the milestones", switch to Mode 4 using the already-approved Phase 1 output. Do NOT re-run the breakdown.

**CHECKPOINT:** "Here are the milestones for [feature] (strict no-write - no files written). Say 'write to files' to persist them, or adjust first."

### Mode 3: Inline-Then-Write (Hotfix / Small Feature)

Low blast radius, 1-2 milestones, no analysis signals. Deliver inline first, write on approval.

- Present Phase 1 milestones inline.
- If the user accepts inline-only, continue inline; offer a later write-to-files transition if useful.
- If the user asks to persist, switch to Mode 4 using the already-approved Phase 1 output.

### Mode 4: File-Write (Standard+ or explicit file request)

After Phase 1 approval, write each milestone to `.goat-flow/tasks/<active>/` as a separate file.

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

**CHECKPOINT:** "Milestone files written to `.goat-flow/tasks/<active>/`. Ready to start implementation."

## Phase 3 - Between Milestones

After each milestone, run the testing gate first; any failure is BLOCKING. Apply the Proof Gate from `skill-preamble.md` - no milestone closes without fresh evidence of gate pass (command output, reproduction, or sign-off), not the agent's recollection.
Capture what was learned, then re-read the next milestone and update invalidated assumptions, tasks, or exit criteria.
Set status: prior milestone `complete`, next milestone `in-progress`.
**CHECKPOINT:** "Milestone gate passed. Do you want to proceed with M[N+1]?"

If updates are needed mid-flight, follow the detailed milestone retrospective protocol in `skill-conventions.md`; never change milestones silently.

## Constraints

- MUST pick exactly one Step 0 mode (Named-File Update / Read-Only Analysis / Inline-Then-Write / File-Write) and stay in that mode through Phase 2. Cross-mode drift is the failure this skill's mode-picker exists to prevent.
- MUST check for existing milestone files before creating new ones
- MUST default to Mode 1 (Named-File Update) when the user names an existing milestone file and the target is unambiguous - no re-prompting
- MUST include a testing gate on every milestone - no milestone ships without verification
- MUST re-read and potentially update the next milestone after completing each one
- MUST check kill criteria between milestones - a triggered criterion is a BLOCKING GATE
- MUST tick assumption checkboxes with evidence when validated or invalidated
- MUST present milestone updates to human for approval - never silently change
- MUST order tasks within a milestone so the riskiest work comes first
- MUST ensure each task is completable in a single coding session - split if not
- MUST NOT create vague tasks ("set up backend", "make it work", "research options")
- MUST NOT ask whether to write files when the user has already named the file to update, unless there is genuine ambiguity about scope or additional files
- MUST NOT skip the testing gate between milestones
- Universal constraints from skill-preamble.md apply.
- MUST NOT continue building on an invalidated assumption - update the plan first
- Status tracking: update milestone file status field as work progresses

## Output Format

The output depends on the mode picked in Step 0:
- **Mode 1 (Named-File Update):** the edited milestone file plus a concise delta shown to the user.
- **Mode 2 (Read-Only Analysis):** the inline milestone breakdown in the response. No files.
- **Mode 3 (Inline-Then-Write):** inline milestones; optionally the written files on approval.
- **Mode 4 (File-Write):** the milestone files in `.goat-flow/tasks/<active>/`.

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
