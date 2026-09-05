---
name: goat-plan
description: "Use when starting a non-trivial implementation that needs structured task breakdown with progress tracking."
goat-flow-skill-version: "1.17.0"
---
# /goat-plan

## Shared Conventions

Read `.goat-flow/skill-docs/skill-preamble.md`; Modes R/1/3/4 also read `.goat-flow/skill-docs/skill-conventions.md`.

Mode selection discharges the shared Quick/Full depth choice; ceremony follows the preamble's complexity table.

## When to Use

Use for milestones, replans, rescope, or resume-from-plan in `.goat-flow/plans/<active>/`.

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
- Explicit plan paths select that directory; milestone paths select their parent. Otherwise scan the valid advisory `.active` subdir.
- If missing/invalid, list non-archive dirs and recent `M*.md`, ask which is current, and offer to update `.active`; this is not setup failure.
- For stale plans, compare code and modification dates; plans are gitignored.

### Reconcile Existing Plan State

Plans are local workflow state, not a setup invariant. Mode R is read-only: report each canonical Status token with a plain-language explanation, propose exact corrections, and stop.

**Starting fresh:** name the build, main risk, and kill criteria.

4. **Pick exactly one mode.** First match:

0. **Path-Only Intake / Read-Only Orientation** - path-only or ambiguous task path. Summarize status, ask next action, stop.
R. **Reconcile Existing Plan State** - reconcile/audit/refresh: compare live state with evidence, propose corrections, stop without writes.
2. **Read-Only Analysis** - "what would the milestones look like", "break this down", "plan this out", "reporting-only", "no-implementation": inline output, no writes; skip Phase 3. File mode needs later authorization.
1. **Named-File Update** - edit a specific plan file only when no explicit reporting-only or no-implementation signal is present. A path alone is not write approval; use Phase 2 § Mode 1, never implement code.
3. **Small File-Write** - Hotfix / Small Feature (1-2 milestones), no analysis signals. Use Mode 4's write path with compact ceremony.
4. **File-Write (default at Standard+)** - "create milestones", "set up the plan", "start planning", or Standard / System / Infrastructure with a clear objective and no analysis signals. Write full milestones in `.goat-flow/plans/<active>/`.

**CHECKPOINT (Path-Only Intake):** "Mode: Path-Only Intake. [path]: [status]. Plan pointer: [state]. Next action needed."

**CHECKPOINT (Reconcile):** "Mode R. State: [status]. Corrections: [changes]. No writes."

**CHECKPOINT (Named-File Update):** "Mode 1. Edit [file] in place for [delta]. Boundary: [scope]."

**CHECKPOINT (planning modes):** "Mode: [selected mode]. Milestones: [feature]. Risk: [risk]. Kill criteria: [criteria]."

## Phase 1 - Milestone Breakdown

Budget determines must-deliver scope, ranked stretch work, and cut order. Risk determines proof; split for uncertainty reduction, independent value, or a decision gate.

### Milestone Archetypes

Archetypes are optional lenses: **Prove It Works**, **Make It Real**, **Make It Solid**, **Make It Shine**. Merge shared outcomes/proof; omit lenses without risk reduction or value.

**Spike-first rule:** If uncertain about a library, API, performance characteristic, or integration point - that uncertainty goes in Milestone 1 as a spike, not Milestone 3 as a risk.

Never drop a spike, intake, or kill criteria for milestone count, deadline, or less-ceremony pressure.

### For each milestone, produce:

Choose a Small, Standard, or high-risk rendering from `references/milestone-examples.md`. Include outcome, Status, agent-time estimate, scope, executable Tasks, binary Exit, claim-based Proof, and Stop/rescope. Standard+ adds `## What problem are we solving` and `## Who benefits and how` between Objective and Context, one plain line each. Actual, dependencies, context, assumptions, Mid-implementation proof, boundaries, rollback, deferred work, and maintenance are conditional.

### Risk-weighted task ordering

Order **[RISKY]** unknowns/integrations/spikes, **[CORE]** logic, then **[SAFE]** docs/polish. Uncertainty requires a [RISKY] task.

### Proof format

Each item states the claim and evidence with a proof-class tag. Omit inapplicable classes; manual proof is conditional, static analysis is not behavioural proof, and high-risk work keeps distinct compatibility, rollback, and security evidence. Put each literal command in one command source.

### Quality rules

**Tasks:** Use one action, target, and done condition. Put rationale, paths, and proof beneath the task only when needed. Pin paths when downstream work depends on them.

**Effort estimate (agent-time):** Count positive agent-owned Task/Proof/Mid-proof plus one admin entry; exclude `[HUMAN]`/zero-minute items. `Forecast basis:` records `<n> agent work units` plus rates. Use `0.5-2.5-10 min/unit` until three eligible bases, then `plans check` evidence. Never use duration intuition; ~70/20/10 stays advisory. If scope changes, reforecast before implementation; `reforecast required` blocks. Start a `plans time` receipt first. Optional `Forecast range:` stays legacy-compatible; bases derive headline/range.

**Cold-start bar:** Identify files, conventions, scope, commands, and recovery.

**Handoff-grade artifacts:** Use Standard+ drift context; Small File-Write stays compact.

### Assumption tracking

Tick validated assumptions. Record invalidation and stop dependent work; amend only when mode/approval permits. At human gates, propose and wait.

For Standard+, answer "If this plan fails, the most likely cause is ..." in an existing task, assumption, or kill criterion.

**CHECKPOINT:** Read-Only Analysis stops inline. Write modes enter Phase 2; no Phase 1 approval pause.

## Phase 2 - Deliver Milestones

Use only the Step 0 mode's delivery block; never cross modes mid-flow.

### Mode 0: Path-Only Intake / Read-Only Orientation

- Read filenames plus Status, Lane, and Depends on; run the source-compatible `plans check <plan-path> --strict`. Checker errors stop body reads.
- Report cap provenance. Use `--max-active` only when the operator supplied it for this session; otherwise omit it for canonical config or default one. Never infer a cap from the active count or borrow an earlier override; if an absent override is needed, stop and ask.
- Active means `in-progress`, `testing-gate`, or `human-verification-pending`. An absent or empty Lane means `default`. Check the final join below before source work or timing.
- One session owns one milestone. An explicit path or user instruction selects it; select the sole active milestone automatically. With several active milestones and no selection, report each bounded next item, then ask which milestone this session owns.
- Read only the bounded next item: implementation task, executor proof, or human item according to status. Report other lanes as state, never implementation authority. With no active work, report eligible choices.
- Do NOT mutate `.goat-flow/plans/.active`, milestone status, checkboxes, or code.
- Present the plan pointer, active set, cap provenance, session milestone, and next item. Ask for the next action and stop.

### Mode R: Reconcile Existing Plan State (read-only)

Compare HEAD and uncommitted state with status, tasks, assumptions, and evidence. Propose exact amendments; do NOT edit plans, `.active`, status/checkboxes, or code.

### Mode 1: Named-File Update (edit in place)

Edit the named file in place; a path alone does not qualify. Preserve unaffected title/status. Present the delta; stop on scope spill.

### Mode 2: Read-Only Analysis (no files)

Present Phase 1 inline and stop; no files or `.goat-flow/plans/` changes. Skip Phase 3.

**Transition out:** On "write these to files" / "let's go ahead", switch to Mode 4 using approved Phase 1 output. If prior-turn/session, re-read instructions, `.active`, named sources. Do NOT re-run breakdown.

### Mode 3: Small File-Write (Hotfix / Small Feature)

Direct Hotfix invocation uses Mode 3. Write compact artifacts immediately; present paths and summary.

### Mode 4: File-Write (Standard+ or explicit file request)

Write Standard or triggered high-risk artifacts immediately. Do NOT invoke/ask about `/goat-critique`; run it only on request.

### File Artifact Rules (Modes 3 and 4)

Fresh plan: create a slugged directory, update `.active`, and write one zero-padded `M*.md` per milestone. Existing plan: identify its prior terminal milestone. Append: new `Depends on` prior. Insert before prior: prior `Depends on` new. Re-derive `ISSUE.md` bands and totals.

**Rendering:** Mode 3 uses compact Small; Mode 4 uses Standard plus triggered high-risk fields. Omit empty sections; retain Phase 1 core, claim-based Proof, and one command source.

**ISSUE.md:** Standard+ writes `ISSUE.md` using `references/issue-format.md` as read-only guidance; Small only for a requested GitHub brief, multiple milestones, or shared requirements/budget.

**Backlog:** Deferred items need `backlog.md` with Next, Later, and Maybe tiers.

**CHECKPOINT:** "Wrote [files created] to `.goat-flow/plans/<active>/`. Ready to start implementation."

**Validate:** Resolve inline references, then run `goat-flow plans check .goat-flow/plans/<active> --strict`; fix errors before the checkpoint.

**Post-plan return:** After Phase 2 finishes, `return-to-implement` hands ordinary ACT the existing build authorization; new Ask First boundaries still gate. Plan-only stops; Phase 3 gates milestones.

## Phase 3 - Between Milestones

**Lane eligibility:** Activate not-started work only when every dependency is complete, its lane is free, and the active count is below the cap. For lane or capacity contention, show eligible IDs, lanes, and dependencies; ask, never select by number. Lanes grant no writer ownership; use disjoint scopes, applicable write claims, and an agreed merge boundary. Read `references/milestone-examples.md` → Lane lifecycle for downgrade recovery.

**Final join:** Exclude `abandoned`, `superseded`, and `deferred`; `blocked` still participates. Require one participating dependency sink whose transitive dependency closure covers every other participating milestone. Authors join every participating lane tip. A clean checker result cannot prove this join. Multiple sinks or uncovered work requires a plan amendment before source work or timing; never guess.

Completed implementation enters `testing-gate`. Apply the preamble's Proof Gate; audit tasks and exit, rerun only stale/failed checks or when risk requires it.

Successful AI proof records structured `Actual:` and sets `human-verification-pending`; only human-owned items stay open. Each milestone retains its own receipt and blocking human gate; unrelated active lanes keep their state and receipts. Finalize the receipt before `Actual:`; otherwise declare retrospective, unavailable, or incomplete instead of inventing minutes. Calibration eligibility starts at `complete`.

**BLOCKING GATE (Human Verification):** Present files, exit evidence, estimate versus Actual, and assumptions. "Approve this milestone and eligible follow-up work, or adjust?"

After approval for a non-final milestone, capture learnings, complete it, re-read/update the selected eligible milestone; start it only when `Depends on` permits and lane capacity allows. Human-requested changes return the milestone to `in-progress`; this applies only to the reviewed milestone; never amend silently. Current-reason rule: `Status reason:`—`blocked`: condition+resume evidence/action; `abandoned`: human-decision+stop-rationale; remove-on-exit. Rerun strict validation after each transition.

The final pending milestone enters the combined Phase 4 review; do not mark it complete in Phase 3.

## Phase 4 - Plan Complete

Begin only when the unique final join is `human-verification-pending`, every other participating milestone and every join dependency is complete, and no sibling active work remains. Cap-one plans keep one final review.

### AI Verification Gate

Verify every implementation task and, when `ISSUE.md` exists, every ISSUE How item is closed. Verify exits and Proof claims have fresh evidence, assumptions are resolved, statuses are coherent, and required learning-loop updates exist. Keep What as stable requirements. Surface gaps and aggregate all UNVERIFIED items; do not rerun fresh evidence for presentation.

### Human Verification Gate

**BLOCKING GATE:** Present files changed, milestone states, exit evidence, invalidated assumptions, and UNVERIFIED items. "Final evidence is ready. Review before I close this plan." Human approval is mandatory.

### After Human Approval

- Set the final milestone `complete` and confirm the plan snapshot.
- Leave plan files in place; archival remains the human's decision.
- Do not create a completion log unless the human requests one.

## Constraints

- MUST use claim-based Proof, risk-first tasks, and mid-proof before switching modules or after a bounded edit batch.
- MUST stop dependent work on invalidated assumptions, kill criteria, scope changes, or conflicting evidence.
- MUST preserve failing evidence and obtain approval before amendments or lifecycle transitions.
- MUST keep every milestone and final completion behind AI proof plus human sign-off.
- MUST NOT invoke or prompt for `/goat-critique`; run it only on explicit request.
- MUST NOT include self-deletion, self-archival, commit, or push instructions.

## Output Format

Emit the selected mode's result: 0 orientation; R reconciliation; 1 delta; 2 inline milestones; 3/4 paths, milestone names/objectives, task/exit/test counts, risks, and stop condition. Modes 0/R/2 never write.

**Terse-first:** Lead directly; one sentence per bullet; strip qualifiers and closing offers. Gates retain required prompts and evidence.
