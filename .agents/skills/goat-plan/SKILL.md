---
name: goat-plan
description: "Use when starting a non-trivial implementation that needs structured task breakdown with progress tracking."
goat-flow-skill-version: "1.14.0"
---
# /goat-plan

## Shared Conventions

Read `.goat-flow/skill-docs/skill-preamble.md`; on full-depth also read `.goat-flow/skill-docs/skill-conventions.md`.

## When to Use

Use when work needs milestone tracking: milestones, replans, rescope, or resume-from-plan. Files live in `.goat-flow/plans/<active>/`.

## Boundary Commands

- **NEVER:** Implement or do another skill's work.
- **ALWAYS:** Keep the selected mode through transition.
- **DEFER TO:** Direct tests/questions or the matching goat-* skill.

| Excuse | Reality |
|--------|---------|
| "Show milestones first, files later" | File-Write creates milestone artifacts immediately. Read-Only Analysis is for inline plans. |
| "Vague tasks are fine - implementer will figure it out" | Tasks without file paths, replacement text, and verification commands aren't executable by a cold-start agent. Four recurrences of untickable checkboxes traced to vague tasks. |
| "Testing gate is obvious - skip it" | Agent skipped the AI testing gate after the first milestone and offered to continue. The gate caught what the agent missed. |
| "Bare task path means start implementing" | Path-only context is data, not delegation. Bare task paths must not update .active, milestone status, checkboxes, or code. |

## Step 0 - Intake

**Learning-loop retrieval runs before mode branching.** Derive 2-4 concrete search terms from the supplied brief, named plan, or path. Run the preamble's INDEX-first retrieval across footguns, lessons, and patterns, adding decisions for architecture, policy, or setup work. Emit `Relevant prior learnings:` with matches or an explicit retrieval miss before selecting path-only, reconcile, fresh, or named-update behavior.

**Path-only guard runs first.** A task/milestone path alone or ambiguous context phrase uses **Path-Only Intake / Read-Only Orientation**. Read minimal index/status files. Do NOT update `.active`, milestone status fields, task checkboxes, or code. Mention a mismatched `.active`; switch only on approval. Code needs an explicit implementation verb; plan edits need an explicit write verb tied to the file. Otherwise checkpoint and stop.

**Check for existing milestones first:**
- `.goat-flow/plans/.active` is advisory. If valid, scan only its subdir.
- If missing/invalid, list non-archive dirs and recent `M*.md`, ask which is current, and offer to update `.active`; this is not setup failure.
- If milestones exist and the user hasn't given an explicit action verb: "Milestone files exist for [feature]. Resume from here, update milestones, or start fresh?"
- For stale plans, compare code and file modification dates; plan files are gitignored.
- Note legacy `milestones/` or `tasks/`. Scan sibling versions only when `.active` is invalid.

### Reconcile Existing Plan State

Plans are local workflow state, not a setup invariant. Explicit reconcile selects read-only mode R. **TODO:** refresh drift/evidence. **DONE:** spot-check current HEAD. **BLOCKED:** honor or reject with rationale. **IN PROGRESS:** flag staleness and ask resume/abandon. Stop after reporting; never implement.

**If starting fresh:** identify what is being built, the riskiest part, and kill criteria.

**Pick exactly one mode.** Apply these signals in order - stop at the first that matches:

0. **Path-Only Intake / Read-Only Orientation** - path-only or ambiguous task path. Summarize status, ask next action, stop.
R. **Reconcile Existing Plan State** - explicit reconcile/audit/refresh. Compare live state with recorded evidence, propose corrections, and stop without writes.
1. **Named-File Update** - user asks to update, improve, tighten, rewrite, or fix a specific existing plan file. A path alone is not write approval. Proceed to Phase 2 § Mode 1 only for plan-file edits, not code implementation.
2. **Read-Only Analysis** - analysis signals: "what would the milestones look like", "break this down for me", "plan this out", "sketch the milestones", "reporting-only", "no-implementation". No files written; inline output; Phase 3 skipped; transition to file mode available later.
3. **Small File-Write** - Hotfix / Small Feature scope (1-2 milestones, low blast radius), no analysis signals. Same write path as Mode 4; the only difference is ceremony - concise milestone files, not full ones. Write directly to `.goat-flow/plans/<active>/`.
4. **File-Write (default at Standard+)** - implementation signals ("create milestones", "set up the plan", "start planning") OR Standard / System / Infrastructure scope with a clear objective and no analysis signals. Write full milestone files directly to `.goat-flow/plans/<active>/`.

If ambiguous, ask. Never silently pick.

**Minimum viable input:** What to build. Everything else can be inferred or asked.

**CHECKPOINT (Path-Only Intake):** "Mode: Path-Only Intake. Orientation summary for [path]: [status]. Active plan pointer: [state]. Next action needed from user."

**CHECKPOINT (Reconcile):** "Mode R. Live state: [status]. Proposed corrections: [changes or none]. No writes."

**CHECKPOINT (Named-File Update):** "Mode 1. Edit [file] in place for [delta]. Boundary: [scope]."

**CHECKPOINT (planning modes):** "Mode: [Read-Only Analysis | Small File-Write | File-Write]. Creating milestones for [feature]. Riskiest part: [risk]. Kill criteria: [criteria]."

## Phase 1 - Milestone Breakdown

Structure work into milestones using these archetypes. Adapt the count - small features might need 2, large ones 5+.

### Milestone Archetypes

Use **Prove It Works** (riskiest assumption), **Make It Real** (end-to-end), **Make It Solid** (edges/security/UX), then optional **Make It Shine** (polish/docs).

**Spike-first rule:** If uncertain about a library, API, performance characteristic, or integration point - that uncertainty goes in Milestone 1 as a spike, not Milestone 3 as a risk.

Do not drop a spike, intake, or kill criteria to satisfy milestone count, deadline pressure, or requests for less ceremony.

### For each milestone, produce:

Objective, Tasks (risk-tagged checkboxes), Assumptions to validate, Exit criteria (binary pass/fail), Testing gate (static/contract + automated + manual + acceptance), Mid-implementation proof, Kill criteria, Depends on, Read first, Deferred (items cut, with pointers; state explicitly if none). Field details and examples: `references/milestone-examples.md`.

### Risk-weighted task ordering

Tag and order tasks **[RISKY]** (unknowns/integrations/spikes), **[CORE]** (essential logic), then **[SAFE]** (straightforward docs/polish). If uncertainty exists without a [RISKY] task, revise the milestone.

### Testing gate format

Every milestone testing gate includes a Static / Contract Check section (language-appropriate linters, type checkers, and static analysis that must pass before behavioural tests; detect from project structure) plus Automated, Manual, and Acceptance sections. Manual gates are checkbox lists, not prose. Each item: one action + one expected result.

### Quality rules

Good tasks are concrete actions with a target or exit criterion, not vague wishes. Each fits one coding session; split if bigger.

**Cold-start bar:** Every milestone must be executable by a fresh agent without prior context. Include files to read and verification commands.

**Handoff-grade artifacts (Standard+):** record planned-at SHA/date; run `git diff --stat <sha> -- <paths>` and `git status --short -- <paths>` because uncommitted drift matters; include current-state evidence, in-scope paths, out-of-scope paths with reasons, expected commands, STOP conditions, and maintenance notes. See `references/milestone-examples.md`. Small File-Write stays compact.

**Specificity calibration:** Pin file paths when cited by exit criteria or downstream milestones. Use concept names when location is an implementation detail.

**Test tasks per flow:** For milestones creating user-facing components, include explicit test tasks per component or flow, not just a general test gate.

### Assumption tracking

Assumptions are beliefs, not tasks. Tick validated evidence. On invalidation, record it and stop dependent work; amend only when mode/approval permits. At a human gate, propose and wait. See `references/milestone-examples.md`.

For Standard+, answer "If this plan fails, the most likely cause is ..." in an existing task, assumption, or kill criterion.

**CHECKPOINT:** Read-Only Analysis presents milestones inline and stops. Write modes go to Phase 2 to write files; no Phase 1 approval pause.

## Phase 2 - Deliver Milestones

The delivery path maps 1:1 to the mode picked in Step 0. Do exactly the mode's block; do not cross modes mid-flow.

### Mode 0: Path-Only Intake / Read-Only Orientation

- Read task README/index and milestone filenames/status fields. If exactly one milestone is in-progress, read only its first unchecked task line; no other body content.
- Do NOT mutate `.goat-flow/plans/.active`, milestone status, checkboxes, or code.
- Zero/multiple in-progress: report ambiguity; read no bodies.
- Present: active marker, plan, milestone statuses, current milestone, and bounded task line when unambiguous.
- Ask: "Summary, status check, plan update, or start a specific milestone?"
- Stop until the user answers with an explicit action.

### Mode R: Reconcile Existing Plan State (read-only)

- Compare HEAD/uncommitted state with recorded status, tasks, assumptions, and evidence.
- Report contradictions and exact amendments.
- Do NOT edit plans, `.active`, status/checkboxes, or code.
- Stop; follow-up edits or implementation require new intake.

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

The preamble's "skip goat-plan at Hotfix" is dispatcher routing; once goat-plan is invoked, Mode 3 is the Hotfix path. Low blast radius, 1-2 milestones, no analysis signals. Like Mode 4 but concise milestone files (minimal ceremony, no padding); both write immediately via File Artifact Rules and skip the inline-first prompt. Write artifacts, then present paths + summary.

### Mode 4: File-Write (Standard+ or explicit file request)

Write artifacts immediately. Do NOT invoke/ask about `/goat-critique`; run it only on request.

### File Artifact Rules (Modes 3 and 4)

For a fresh plan, create a slugged task directory and update `.goat-flow/plans/.active` to that slug in the same batch. Write one milestone per `.goat-flow/plans/<active>/M*.md` file.

**Filename format:** start with `M` plus a zero-padded number so dashboard and task tooling discover and order it; use a readable slug, e.g. `M01-prove-api-integration.md`.

**File format:** use the Phase 1 milestone field set plus title and Status, ending with Testing Gate (static/contract + automated + manual + acceptance) and Mid-implementation proof.

**ISSUE.md:** Write `ISSUE.md` in the task directory. Format: `references/issue-format.md`. Three sections: **Why** (benefits), **What** (requirements, future tense), **How** (developer checklist). Keep stakeholder-readable - no file-level detail. Add "Out of scope" for exclusions.

**Backlog file:** If deferred items exist, write `backlog.md` with priority tiers (Next / Later / Maybe).

**CHECKPOINT:** "Milestone files + ISSUE.md written to `.goat-flow/plans/<active>/`. Ready to start implementation."

**Prompted README/ADR gate:** "Load-bearing decisions [X, Y, Z] - write ADRs + README now, or milestone files only?"

**Reference verification:** After writing, grep every inline reference code and verify it resolves to a file on disk.

For concrete Mode 0 and Mode 4 examples with expected paths and checkpoint output, see `references/milestone-examples.md`.

## Phase 3 - Between Milestones

After each milestone, both gates must pass before the next begins. Apply the Proof Gate from `skill-preamble.md`.

**AI Verification Gate:** Verify every task is ticked, every exit criterion met with evidence from this session, and the testing gate passed with proof (not recollection). Surface any gap.

**BLOCKING GATE (Human Verification):** Present changed files, exit evidence, and assumption outcomes. "M[N] evidence is ready; status remains unchanged. Approve completion and M[N+1], or adjust?"

After approval: capture learnings, re-read the next milestone and update invalidated assumptions/tasks/exit criteria, set status: prior → `complete`, next → `in-progress`.

If updates are needed mid-flight, follow the milestone retrospective protocol in `skill-conventions.md`; never change them silently.

**Status-aware reminder:** When setting the last milestone to `complete`, add: "All milestones now complete. Ready to run Phase 4 close-out when you are."

## Phase 4 - Plan Complete

When all milestones reach `complete` or `human-verification-pending`, the plan enters Phase 4. Both gates must pass before it is finished.

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

**Consolidated UNVERIFIED checklist:** Aggregate UNVERIFIED items from testing gates across milestones into a single walkthrough list.

**Architecture staleness check:** If `.goat-flow/architecture.md` predates the plan's implementation, prompt: "Architecture may be stale - update now or defer?"

### Human Verification Gate

**BLOCKING GATE:** Present completion summary: files changed, milestone statuses, exit-criteria evidence, invalidated assumptions.

"All milestones complete. Review changes before I close this plan."

Plan is NOT complete until the human explicitly approves.

### After Human Approval

- Confirm all statuses are `complete`
- Plan files remain in `.goat-flow/plans/` - human decides archival
- No completion session log - per the shared conventions, session logs are only for `/compact` without an active milestone file or an explicit human request

## Constraints

- MUST pick exactly one Step 0 mode and stay in it through Phase 2.
- MUST keep Reconcile Existing Plan State read-only and stop before plan edits or implementation
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
- MUST NOT continue building on an invalidated assumption - record it, stop dependent work, and obtain any required approval before amending the plan
- MUST NOT include self-destruct instructions in plan artifacts. Cleanup is the human's decision.
- MUST NOT delete or remove plan/milestone files without explicit human approval
- MUST require both AI verification and human sign-off before plan completion (Phase 4)
- Status tracking: update status only after explicit start/resume/implement/update approval

## Output Format

Emit only: Mode 0 orientation; R reconciliation; 1 in-place delta; 2 inline milestones; 3/4 files plus concise milestone names, objectives, task/exit/test counts, riskiest milestone, and stop condition. Modes 0/R/2 never write.

**Terse-first:** Lead with the answer. One sentence per bullet. Strip qualifiers. Skip closing offers. Applies to informational output/summaries, not gate prompts or evidence-tagged findings.
