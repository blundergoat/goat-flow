---
name: goat-plan
description: "Use when starting a non-trivial implementation that needs structured task breakdown with progress tracking."
goat-flow-skill-version: "1.15.0"
---
# /goat-plan

## Shared Conventions

Read `.goat-flow/skill-docs/skill-preamble.md`; on full-depth also read `.goat-flow/skill-docs/skill-conventions.md`.

## When to Use

Use for milestones, replans, rescope, or resume-from-plan. Files live in `.goat-flow/plans/<active>/`.

## Boundary Commands

- **NEVER:** Implement or do another skill's work.
- **ALWAYS:** Keep the selected mode through transition.
- **DEFER TO:** Direct tests/questions or the matching goat-* skill.

| Excuse | Reality |
|--------|---------|
| "Show milestones first, files later" | File-Write creates milestone artifacts immediately. Read-Only Analysis is for inline plans. |
| "Vague tasks are fine - implementer will figure it out" | Cold-start tasks need one action, a target, and a done condition; supporting detail belongs beneath them. |
| "Proof is obvious - skip it" | Agent skipped the AI proof gate after the first milestone. The gate caught what it missed. |
| "Bare task path means start implementing" | Path-only context is data, not delegation. Bare task paths must not update .active, milestone status, checkboxes, or code. |

## Step 0 - Intake

1. **Classify the input shape before any plan-state read.** Path-only guard runs first: a task/milestone path alone or ambiguous context phrase selects **Path-Only Intake / Read-Only Orientation**. Do NOT update `.active`, milestone status fields, task checkboxes, or code. Switching a mismatched `.active` needs approval. Code or plan changes need an explicit action verb.

2. **Run learning-loop retrieval before mode-specific reads.** Follow the preamble's INDEX-first retrieval and emit `Relevant prior learnings:`. Use brief/plan terms; add decisions for architecture, policy, or setup. For path-only intake, search only for plan-orientation and task-state failure classes. Do not retrieve implementation-domain learnings from the task path; open entries only when a hit affects safe orientation.

3. **Inspect existing plan state only after retrieval.** Check for existing milestones:
- `.goat-flow/plans/.active` is advisory. If valid, scan only its subdir.
- If missing/invalid, list non-archive dirs and recent `M*.md`, ask which is current, and offer to update `.active`; this is not setup failure.
- If milestones exist and the user hasn't given an explicit action verb: "Milestone files exist for [feature]. Resume from here, update milestones, or start fresh?"
- For stale plans, compare code and file modification dates; plan files are gitignored.
- Note legacy `milestones/` or `tasks/`. Scan sibling versions only when `.active` is invalid.

### Reconcile Existing Plan State

Plans are local workflow state, not a setup invariant. Mode R is read-only: report each canonical Status token with a plain-language explanation, propose exact corrections, and stop.

**If starting fresh:** identify what is being built, the riskiest part, and kill criteria.

4. **Pick exactly one mode.** Apply these signals in order - stop at the first that matches:

0. **Path-Only Intake / Read-Only Orientation** - path-only or ambiguous task path. Summarize status, ask next action, stop.
R. **Reconcile Existing Plan State** - explicit reconcile/audit/refresh. Compare live state with recorded evidence, propose corrections, and stop without writes.
1. **Named-File Update** - user asks to update, improve, tighten, rewrite, or fix a specific existing plan file. A path alone is not write approval. Proceed to Phase 2 § Mode 1 only for plan-file edits, not code implementation.
2. **Read-Only Analysis** - analysis signals: "what would the milestones look like", "break this down for me", "plan this out", "sketch the milestones", "reporting-only", "no-implementation". No files written; inline output; Phase 3 skipped; transition to file mode available later.
3. **Small File-Write** - Hotfix / Small Feature scope (1-2 milestones, low blast radius), no analysis signals. Same write path as Mode 4; the only difference is ceremony - concise milestone files, not full ones. Write directly to `.goat-flow/plans/<active>/`.
4. **File-Write (default at Standard+)** - implementation signals ("create milestones", "set up the plan", "start planning") OR Standard / System / Infrastructure scope with a clear objective and no analysis signals. Write full milestone files directly to `.goat-flow/plans/<active>/`.

If ambiguous, ask; never guess.

**Minimum input:** What to build. Infer or ask everything else.

**CHECKPOINT (Path-Only Intake):** "Mode: Path-Only Intake. Orientation summary for [path]: [status]. Active plan pointer: [state]. Next action needed from user."

**CHECKPOINT (Reconcile):** "Mode R. Live state: [status]. Proposed corrections: [changes or none]. No writes."

**CHECKPOINT (Named-File Update):** "Mode 1. Edit [file] in place for [delta]. Boundary: [scope]."

**CHECKPOINT (planning modes):** "Mode: [Read-Only Analysis | Small File-Write | File-Write]. Creating milestones for [feature]. Riskiest part: [risk]. Kill criteria: [criteria]."

## Phase 1 - Milestone Breakdown

Budget determines must-deliver scope, ranked stretch work, and cut order. Risk determines proof. Split only for uncertainty reduction, independent value, or a real decision gate.

### Milestone Archetypes

Archetypes are optional lenses: **Prove It Works**, **Make It Real**, **Make It Solid**, and **Make It Shine**. Merge lenses sharing one outcome and proof boundary; omit lenses that add neither risk reduction nor value.

**Spike-first rule:** If uncertain about a library, API, performance characteristic, or integration point - that uncertainty goes in Milestone 1 as a spike, not Milestone 3 as a risk.

Never drop a spike, intake, or kill criteria for milestone count, deadline, or less-ceremony pressure.

### For each milestone, produce:

Choose a Small, Standard, or high-risk rendering from `references/milestone-examples.md`. Always include outcome, Status, agent-time estimate, scope, executable Tasks, binary Exit, claim-based Proof, and Stop/rescope. Add Actual, dependencies, context, assumptions, Mid-implementation proof, boundaries, rollback, deferred work, or maintenance only when triggered.

### Risk-weighted task ordering

Tag and order tasks **[RISKY]** (unknowns/integrations/spikes), **[CORE]** (essential logic), then **[SAFE]** (straightforward docs/polish). If uncertainty exists without a [RISKY] task, revise the milestone.

### Proof format

Each item states the claim and evidence with a proof-class tag. Omit inapplicable classes; manual proof is conditional, static analysis is not behavioural proof, and high-risk work keeps distinct compatibility, rollback, and security evidence. Put each literal command in one command source.

### Quality rules

**Tasks:** Use one action, target, and done condition. Put rationale, paths, and proof beneath the task only when needed. Pin paths when downstream work depends on them.

**Effort estimate (agent-time):** Count positive agent-owned Task/Proof/Mid-proof plus one admin entry; exclude `[HUMAN]`/zero-minute items. `Forecast basis:` records `<n> agent work units` plus rates. Use `0.5-2.5-10 min/unit` until three eligible bases, then `plans check` evidence. Never use duration intuition; ~70/20/10 stays advisory. If scope changes, reforecast before implementation; `reforecast required` blocks. Start a `plans time` receipt first. Optional `Forecast range:` stays legacy-compatible; a basis derives headline/range.

**Cold-start bar:** A fresh agent can identify relevant files, conventions, scope, commands, and recovery steps without prior conversation.

**Handoff-grade artifacts (Standard+):** follow the drift-aware Standard template in `references/milestone-examples.md`. Small File-Write stays compact.

### Assumption tracking

Assumptions are beliefs, not tasks. Tick validated evidence. On invalidation, record it and stop dependent work; amend only when mode/approval permits. At a human gate, propose and wait.

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

Compare HEAD and uncommitted state with status, tasks, assumptions, and evidence. Report contradictions and exact amendments. Do NOT edit plans, `.active`, status/checkboxes, or code; stop for new intake.

### Mode 1: Named-File Update (edit in place)

Edit the explicitly named plan file in place; path-only references do not qualify. Preserve title/status unless the requested change affects them. Present the delta and stop if scope spills.

### Mode 2: Read-Only Analysis (no files)

Run Phase 1, present milestones inline, and stop. Do NOT write files or modify `.goat-flow/plans/`; skip Phase 3.

**Transition out:** On "write these to files" / "let's go ahead", switch to Mode 4 using approved Phase 1 output. If prior-turn/session, re-read instructions, `.active`, named sources. Do NOT re-run breakdown.

**CHECKPOINT:** "Milestones for [feature] (no files written). Say 'write to files' to persist, or adjust first."

### Mode 3: Small File-Write (Hotfix / Small Feature)

The preamble normally skips goat-plan for Hotfix work; direct invocation uses Mode 3 for low-risk, one-or-two-milestone work. Write compact artifacts immediately, then present paths and summary.

### Mode 4: File-Write (Standard+ or explicit file request)

Write Standard or triggered high-risk artifacts immediately. Do NOT invoke/ask about `/goat-critique`; run it only on request.

### File Artifact Rules (Modes 3 and 4)

For fresh plans, create a slugged directory, update `.goat-flow/plans/.active` in that batch, and write one zero-padded `M*.md` per milestone.

**Rendering:** Mode 3 uses compact Small; Mode 4 uses Standard plus triggered high-risk fields. Omit empty and `N/A` sections. Use the Phase 1 core, claim-based Proof, and one command source.

**ISSUE.md:** Standard+ writes `ISSUE.md` using `references/issue-format.md` as read-only guidance; Small only for a requested GitHub brief, multiple milestones, or shared requirements/budget.

**Backlog:** When deferred items exist, write `backlog.md` with Next, Later, and Maybe tiers.

**CHECKPOINT:** "Wrote [files created] to `.goat-flow/plans/<active>/`. Ready to start implementation."

**Validate:** Resolve inline references, then run `goat-flow plans check .goat-flow/plans/<active> --strict`; fix errors before the checkpoint.

**Post-plan return:** After Phase 2 finishes, `return-to-implement` hands ordinary ACT the existing build authorization; new Ask First boundaries still gate. Plan-only stops; Phase 3 gates milestones.

## Phase 3 - Between Milestones

After implementation tasks finish, set `testing-gate` and apply the Proof Gate from `skill-preamble.md`. Audit fresh evidence against every task and exit; rerun only stale/failed checks or when risk requires it.

Successful AI proof records structured `Actual:` and sets `human-verification-pending`; only human-owned items stay open and no later milestone becomes active. Finalize the receipt before `Actual:`; with none, declare `retrospective`, `unavailable`, or `incomplete` instead of inventing minutes. Calibration eligibility starts at `complete`.

**BLOCKING GATE (Human Verification):** Present changed files, exit evidence, estimate versus Actual, and assumption outcomes. "M[N] evidence is ready. Approve completion and M[N+1], or adjust?"

After approval for a non-final milestone, capture learnings, complete it, re-read/update the next milestone, and start it only when `Depends on` permits. Human-requested changes return the milestone to `in-progress`; never amend silently. Rerun strict validation after each transition.

The final pending milestone enters the combined Phase 4 review; do not mark it complete in Phase 3.

## Phase 4 - Plan Complete

When predecessors are complete and the final milestone is `human-verification-pending`, run one plan-wide AI audit and blocking human review.

### AI Verification Gate

Verify every implementation task and, when `ISSUE.md` exists, every ISSUE How item is closed. Verify exits and Proof claims have fresh evidence, assumptions are resolved, statuses are coherent, and required learning-loop updates exist. Keep What as stable requirements. Surface gaps and aggregate all UNVERIFIED items; do not rerun fresh evidence for presentation.

### Human Verification Gate

**BLOCKING GATE:** Present files changed, milestone states, exit evidence, invalidated assumptions, and UNVERIFIED items. "Final evidence is ready. Review before I close this plan." Human approval is mandatory.

### After Human Approval

- Set the final milestone `complete` and confirm the plan snapshot.
- Leave plan files in place; archival remains the human's decision.
- Do not create a completion log unless the human requests one.

## Constraints

- MUST select one Step 0 mode and keep Modes 0, R, and 2 read-only.
- MUST treat bare paths as context, never permission to update `.active`, plans, checkboxes, or code.
- MUST use claim-based Proof, risk-first tasks, and mid-proof before switching modules or after a bounded edit batch.
- MUST stop dependent work on invalidated assumptions, kill criteria, scope changes, or conflicting evidence.
- MUST preserve failing evidence and obtain approval before amendments or lifecycle transitions.
- MUST keep every milestone and final completion behind AI proof plus human sign-off.
- MUST NOT invoke or prompt for `/goat-critique`; run it only on explicit request.
- MUST NOT include self-deletion, self-archival, commit, or push instructions.
- Universal constraints from `skill-preamble.md` apply.

## Output Format

Emit only: Mode 0 orientation; R reconciliation; 1 in-place delta; 2 inline milestones; 3/4 files plus concise milestone names, objectives, task/exit/test counts, riskiest milestone, and stop condition. Modes 0/R/2 never write.

**Terse-first:** Lead with the answer. One sentence per bullet. Strip qualifiers. Skip closing offers. Applies to informational output/summaries, not gate prompts or evidence-tagged findings.
