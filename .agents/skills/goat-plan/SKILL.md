---
name: goat-plan
description: "Use when starting a non-trivial implementation that needs structured task breakdown with progress tracking."
goat-flow-skill-version: "1.11.0"
---
# /goat-plan

## Shared Conventions

Read `.goat-flow/skill-docs/skill-preamble.md` for shared conventions.
On full-depth, also read `.goat-flow/skill-docs/skill-conventions.md`.

## When to Use

Use when work needs milestone tracking. goat-plan manages gitignored coordination files in `.goat-flow/plans/<active>/`.

Use for milestones, replans, rescope, resume-from-plan. **NOT this skill:** tests → run them; debug → /goat-debug; review → /goat-review; security → /goat-security; gaps → /goat-qa; critique → /goat-critique; question → answer directly.

| Excuse | Reality |
|--------|---------|
| "Show milestones first, files later" | File-Write creates milestone artifacts immediately. Read-Only Analysis is for inline plans. |
| "Vague tasks are fine - implementer will figure it out" | Tasks without file paths, replacement text, and verification commands are not executable by a cold-start agent. Four recurrences of untickable checkboxes traced to vague tasks. |
| "Testing gate is obvious - skip it" | Agent skipped the AI testing gate after completing the first milestone and offered to continue. The gate caught what the agent missed. |
| "Bare task path means start implementing" | Path-only context is data, not delegation. Bare task paths must not update .active, milestone status, checkboxes, or code. |

## Step 0 - Intake

**Path-only guard runs first.** If the user message is only a task/milestone path, or an ambiguous context phrase such as "look at this task directory" or "here's the task dir", choose **Path-Only Intake / Read-Only Orientation**. Read only minimal index/status files. Do NOT update `.active`, milestone status fields, task checkboxes, or code. If `.active` points elsewhere, mention it and offer to switch only on approval. Implementation requires "start", "implement", "resume", "mark in progress and begin", or "fix code". Plan-file writes require "update", "rewrite", "write", "create", or "fix" tied to the plan file. Before any write after an ambiguous path, checkpoint and stop.

**Check for existing milestones first:**
- Treat `.goat-flow/plans/.active` as an advisory local pointer (one-line file naming a subdir), not a setup invariant.
- If `.active` exists and names an existing subdir, scan only that subdir for milestone files.
- If `.active` is missing or names a missing subdir, treat as normal local churn. List top-level entries in `.goat-flow/plans/` excluding archives, prefer dirs with recent `M*.md` files, ask which plan is current, and offer to write/update `.active`. Do NOT report a stale/missing `.active` as a setup failure.
- If milestones exist and the user hasn't given an explicit action verb: "Milestone files exist for [feature]. Resume from here, update milestones, or start fresh?"
- If the selected plan exists but appears stale: check whether code has moved on but milestones haven't been updated, flag it. Note: task files are gitignored, so `git log` won't track them - check file modification dates instead.
- Also check for legacy milestone files outside `.goat-flow/plans/` (e.g. `milestones/`, `tasks/`). Sibling-version subdirs hold deferred or completed work and are NOT scanned unless `.active` is missing or points nowhere. If found, note them.

**If starting fresh:** identify what is being built, the riskiest part, kill criteria, and run the preamble's learning-loop retrieval for the target area.

**Pick exactly one mode.** Apply these signals in order - stop at the first that matches:

0. **Path-Only Intake / Read-Only Orientation** - path-only or ambiguous task path. Summarize status, ask next action, stop.
1. **Named-File Update** - user asks to update, improve, tighten, rewrite, or fix a specific existing plan file. A path alone is not write approval. Proceed to Phase 2 § Mode 1 only for plan-file edits, not code implementation.
2. **Read-Only Analysis** - analysis signals: "what would the milestones look like", "break this down for me", "plan this out", "how would you approach", "sketch the milestones", "walk me through the plan", "reporting-only", "no-implementation". No files written; inline output; Phase 3 skipped; transition to file mode available later.
3. **Small File-Write** - Hotfix / Small Feature scope (1-2 milestones, low blast radius), no analysis signals. Write concise milestone files directly to `.goat-flow/plans/<active>/`.
4. **File-Write (default at Standard+)** - implementation signals ("create milestones", "set up the plan", "write the milestone files", "start planning") OR Standard / System / Infrastructure scope with a clear build objective and no analysis signals. Write directly to `.goat-flow/plans/<active>/`.

If ambiguous, ask. Never silently pick.

**Minimum viable input:** What to build. Everything else can be inferred or asked.

**CHECKPOINT (Path-Only Intake):** "Mode: Path-Only Intake. Orientation summary for [path]: [status]. Active plan pointer: [state]. Next action needed from user."

**CHECKPOINT (all other modes):** "Mode: [Named-File Update | Read-Only Analysis | Small File-Write | File-Write]. Creating milestones for [feature]. Riskiest part: [risk]. Kill criteria: [criteria]. Proceeding to milestone breakdown."

## Phase 1 - Milestone Breakdown

Structure the work into milestones using these archetypes. Adapt the count to the project - small features might need 2, large ones might need 5+.

### Milestone Archetypes

1. **Prove It Works** - Validate the riskiest assumption.
2. **Make It Real** - End-to-end flow works with real data.
3. **Make It Solid** - Edge cases, errors, security, UX, and feedback are handled.
4. **Make It Shine** - Optional polish, performance, docs, or open-source prep.

**Spike-first rule:** If uncertain about a library, API, performance characteristic, or integration point - that uncertainty goes in Milestone 1 as a spike, not Milestone 3 as a risk.

Do not drop a spike, intake, or kill criteria to satisfy milestone count, deadline pressure, or requests for less ceremony.

### For each milestone, produce:

Objective, Tasks (risk-tagged checkboxes), Assumptions to validate, Exit criteria (binary pass/fail), Testing gate (static/contract + automated + manual + acceptance), Mid-implementation proof, Kill criteria, Depends on, Read first, Deferred (items intentionally cut with pointers; state explicitly if nothing deferred). Field details and examples: `references/milestone-examples.md`.

### Risk-weighted task ordering

Tag every task within a milestone:

- **[RISKY]** - Unknowns, integrations, unproven assumptions. Includes spikes.
- **[CORE]** - Essential logic without unknowns. The bulk of most milestones.
- **[SAFE]** - Straightforward, well-understood. Documentation, polish, cosmetic.

**Ordering rule:** All [RISKY] first, then [CORE], then [SAFE] within each milestone.

**Structural check:** If a milestone has no [RISKY] tasks but contains uncertainty, the plan is wrong and the milestone must be revised.

### Testing gate format

Every milestone testing gate includes a Static / Contract Check section (language-appropriate linters, type checkers, and static analysis that must pass before behavioural tests run - detect from project structure) plus Automated, Manual, and Acceptance sections. Manual testing gates are checkbox lists, not prose. Each item: one action + one expected result.

### Quality rules

Good tasks are concrete actions with a target or exit criterion, not vague wishes. Each task should fit one coding session; split if bigger.

**Cold-start bar:** Every milestone must be executable by a fresh agent without prior context. Include files to read and verification commands.

**Specificity calibration:** Pin file paths when cited by exit criteria or downstream milestones. Use concept names when location is an implementation detail.

**Test tasks per flow:** For milestones that create user-facing components, include explicit test tasks per component or flow, not just a general test gate.

### Assumption tracking

Assumptions are beliefs about the system, not tasks. Tick with evidence when validated. If invalidated, update the plan immediately. See `references/milestone-examples.md` for format and examples.

**CHECKPOINT:** Read-Only Analysis presents milestones inline and stops. Write modes go to Phase 2 to write files; no Phase 1 approval pause.

## Phase 2 - Deliver Milestones

The delivery path maps 1:1 to the mode picked in Step 0. Do exactly the mode's block; do not cross modes mid-flow.

### Mode 0: Path-Only Intake / Read-Only Orientation

- Read task directory README/index and milestone filenames/status fields only.
- Do NOT mutate `.goat-flow/plans/.active`, milestone status, checkboxes, or code.
- Present: active marker, plan reference, milestone list/status, current in-progress item.
- Ask: "Summary, status check, plan update, or start a specific milestone?"
- Stop until the user answers with an explicit action.

### Mode 1: Named-File Update (edit in place)

User explicitly asked to edit an existing plan file. Path-only references do not qualify.

- Edit in place. Do NOT create a parallel inline plan.
- Preserve title/status metadata unless the change requires updating them.
- Present updated content or concise delta. Ask if scope spills beyond named file.

### Mode 2: Read-Only Analysis (no files)

Analysis signals triggered this mode.

- Run Phase 1. Present milestones. Do NOT write files or modify `.goat-flow/plans/`.
- Skip Phase 3. Include summary format.

**Transition out:** On "write these to files" / "let's go ahead", switch to Mode 4 using approved Phase 1 output. If prior-turn/session, re-read instructions, `.active`, named sources. Do NOT re-run breakdown.

**CHECKPOINT:** "Milestones for [feature] (no files written). Say 'write to files' to persist, or adjust first."

### Mode 3: Small File-Write (Hotfix / Small Feature)

Low blast radius, 1-2 milestones, no analysis signals. Write artifacts using File Artifact Rules, then present paths + summary. No inline-first prompt.

### Mode 4: File-Write (Standard+ or explicit file request)

Write artifacts immediately. Do NOT invoke/ask about `/goat-critique`; run it only on request.

### File Artifact Rules (Modes 3 and 4)

For a fresh plan, create a slugged task directory and update `.goat-flow/plans/.active` to that slug in the same batch. Write one milestone per `.goat-flow/plans/<active>/M*.md` file.

**Filename format:** start with `M` so dashboard and task tooling can discover it; use a readable slug, e.g. `Milestone-prove-api-integration.md`.

**File format:** use existing milestone structure: title, Status, Objective, Depends on, Kill criteria, Read first, Assumptions, Tasks (risk-tagged), Exit Criteria, Testing Gate (static/contract + automated + manual + acceptance), Mid-implementation proof.

**ISSUE.md:** Write `ISSUE.md` in the task directory alongside milestone files. Format: `references/issue-format.md`. Three sections: **Why** (benefits), **What** (requirements, future tense), **How** (developer checklist with checkboxes). Keep stakeholder-readable - no file-level detail. Add "Out of scope" for deliberate exclusions.

**Backlog file:** If deferred items exist, write `backlog.md` with priority tiers (Next / Later / Maybe).

**CHECKPOINT:** "Milestone files + ISSUE.md written to `.goat-flow/plans/<active>/`. Ready to start implementation."

**Prompted README/ADR gate:** "Load-bearing decisions [X, Y, Z] - write ADRs + README now, or milestone files only?"

**Reference verification:** After writing milestone files, grep every inline reference code and verify it resolves to a file on disk.

## Phase 3 - Between Milestones

After each milestone completes, both gates must pass before the next begins. Apply the Proof Gate from `skill-preamble.md`.

**AI Verification Gate:** Verify every task is ticked, every exit criterion met with evidence from this session, and the testing gate passed with proof (not recollection). Surface any gap.

**BLOCKING GATE (Human Verification):** Present files changed, exit criteria with evidence, and assumptions validated or invalidated. "M[N] complete. Approve to proceed with M[N+1], or adjust?"

After approval: capture learnings, re-read the next milestone and update invalidated assumptions/tasks/exit criteria, set status: prior → `complete`, next → `in-progress`.

If updates are needed mid-flight, follow the milestone retrospective protocol in `skill-conventions.md`; never change milestones silently.

**Status-aware reminder:** When setting the last milestone to `complete`, add: "All milestones now complete. Ready to run Phase 4 close-out when you are."

## Phase 4 - Plan Complete

When all milestones reach `complete` or `human-verification-pending`, the plan enters Phase 4. Both gates must pass before the plan is considered finished.

### AI Verification Gate

Before presenting completion, verify:

1. Every milestone status shows `complete` or `human-verification-pending`
2. Every task checkbox ticked `[x]` across all milestone files
3. Every exit criterion met with evidence cited in this session
4. Every testing gate passed with proof (not recollection)
5. Every assumption validated or explicitly invalidated with plan updates
6. Learning loop checked: footguns/lessons/patterns updated if warranted
7. ISSUE.md reviewed and revised - What section updated to past tense (requirements met), How checkboxes ticked

If any item fails, surface it - do not silently close with incomplete gates.

**Consolidated UNVERIFIED checklist:** Aggregate all UNVERIFIED items from testing gates across milestones into a single walkthrough list.

**Architecture staleness check:** If `.goat-flow/architecture.md` predates the plan's implementation, prompt: "Architecture may be stale - update now or defer?"

### Human Verification Gate

**BLOCKING GATE:** Present completion summary: files changed, milestone statuses, exit-criteria evidence, invalidated assumptions.

"All milestones complete. Review changes before I close this plan."

Plan is NOT complete until the human explicitly approves.

### After Human Approval

- Confirm all statuses are `complete`
- Plan files remain in `.goat-flow/plans/` - human decides archival
- Write a session log if the plan spanned multiple sessions

## Constraints

- MUST pick exactly one Step 0 mode and stay in it through Phase 2. Cross-mode drift is the failure the mode-picker prevents.
- MUST check for existing milestone files before creating new ones
- MUST treat bare task paths as read-only context, not implementation permission
- MUST NOT update `.active`, status, checkboxes, or code from path-only intake
- MUST default to Mode 1 only on explicit plan-file edit verb
- MUST include a testing gate on every milestone and mid-implementation proof for long milestones (run before switching modules or after a bounded edit batch)
- MUST re-read and update the next milestone after completing each one
- MUST check kill criteria between milestones - triggered = BLOCKING GATE
- MUST tick assumption checkboxes with evidence when validated or invalidated
- MUST present milestone updates to human for approval - never silently change
- MUST order tasks riskiest-first within each milestone
- MUST NOT invoke or prompt for `/goat-critique` from `/goat-plan`; run critique only on request
- MUST ensure each task fits one coding session - split if not
- MUST NOT create vague tasks ("set up backend", "make it work", "research options")
- MUST NOT skip per-milestone AI + human verification gates
- Universal constraints from skill-preamble.md apply.
- MUST NOT continue building on an invalidated assumption - update the plan first
- MUST NOT include self-destruct instructions in plan artifacts. Cleanup is the human's decision.
- MUST NOT delete or remove plan/milestone files without explicit human approval
- MUST require both AI verification and human sign-off before plan completion (Phase 4)
- Status tracking: update status only after explicit start/resume/implement/update approval

## Output Format

The output depends on the mode picked in Step 0:
- **Mode 0 (Path-Only Intake):** status/orientation summary plus next-action question. No files.
- **Mode 1 (Named-File Update):** the edited milestone file plus a concise delta shown to the user.
- **Mode 2 (Read-Only Analysis):** the inline milestone breakdown in the response. No files.
- **Mode 3 (Small File-Write):** milestone files in `.goat-flow/plans/<active>/` plus a concise summary.
- **Mode 4 (File-Write):** the milestone files in `.goat-flow/plans/<active>/`.

Summary format for presentation:

```markdown
## Milestones for [feature]

### Milestone 01: [name] - [archetype]
**Objective:** [1-2 sentences]
**Tasks:** [N] | **Exit criteria:** [N] | **Testing gate:** [auto + manual + acceptance]
**Kill criteria:** [condition]

### Milestone 02: [name] - [archetype]
...

**Total milestones:** [N] | **Estimated sessions:** [rough guess]
**Riskiest milestone:** M[N] because [reason]
**Kill criteria summary:** [what would stop the entire effort]
```

**Terse-first:** Lead with the answer. One sentence per bullet. Strip qualifiers. Skip closing offers. Applies to informational output and summaries, not gate prompts or evidence-tagged findings.
