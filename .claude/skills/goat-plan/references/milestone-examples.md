---
goat-flow-reference-version: "1.14.0"
---
# Milestone Template - Detailed Field Reference

This reference keeps handoff detail out of the always-scanned skill body.
Use it when a Standard+ plan must survive a new agent, a later session, or source drift.
Small low-risk plans keep the compact field set in `SKILL.md`.

## Contents

- Milestone field descriptions
- Effort estimates
- Deferred and backlog routing
- Assumption tracking
- Path-only intake example
- Mode 4 file-write example
- Risk-tagged milestone example
- Phase 3 human verification gate example
- Kill-criteria-triggered stop example

## Handoff-grade milestone template

Use this shape for Standard+ work or any milestone handed to a different implementer. Capture the baseline before writing tasks; a failing baseline becomes an explicit prerequisite instead of hidden plan context.

```markdown
# M01: <outcome>

**Status:** not-started
**Planned at:** `<sha>`, YYYY-MM-DD
**Depends on:** <milestone, decision, or none>
**Effort estimate:** <agent-time from countable units; product/proof/other split>
**Actual:** _
**Plan/admin overhead:** <n min other>

## Objective

<Binary outcome this milestone proves or delivers.>

## Read first

- `<file>` (search: `<semantic anchor>`) - why the implementer must read it.

## Drift check before implementation

`git diff --stat <sha> -- <in-scope paths>`
`git status --short -- <in-scope paths>`

If either command shows movement, re-read the live anchors and amend the milestone before implementation. The status command is required because uncommitted drift matters.

## Current-state evidence

- `<file>` (search: `<semantic anchor>`) - current behavior the task changes.

## Verification baseline

| Command | Expected result |
|---|---|
| `<read-only command>` | `<literal success condition, or known failure recorded as a prerequisite>` |

## Scope

### In scope
- `<path>` - why this file belongs to the user-visible outcome.

### Out of scope
- `<tempting path>` - why touching it would expand the approved outcome.

## Assumptions to validate

- [ ] `<belief that must be proven>` - validation evidence required.

## Tasks
- [ ] [RISKY] `<uncertainty-first action with target and proof>` (est: `<n min category>`)
- [ ] [CORE] `<implementation action with target and proof>` (est: `<n min category>`)

## Exit criteria

- [ ] `<binary observable condition>`

## Kill criteria

- Stop if `<measured condition that invalidates the milestone>`.

## Testing Gate

### Static / Contract Check

- [ ] `<static command>` exits 0 (est: `<n min proof>`)

### Automated

- [ ] `<focused test command>` exits 0 (est: `<n min proof>`)

### Manual

- [ ] `<one agent action>`; expected: `<one observable result>` (est: `<n min proof>`)

### Acceptance

- [ ] Developer self-check completed (est: `<n min proof>`)

## Mid-implementation proof

- [ ] Run `<bounded command or smoke check>` after `<named edit boundary>` and stop on failure (est: `<n min proof>`)

## STOP conditions
- Stop when drift invalidates an anchor, work crosses the named scope, an assumption fails, or the same verification approach fails twice.

## Command table

| Command | Expected result |
|---|---|
| `<focused check>` | `<observable pass condition>` |

## Deferred

- `<item with destination pointer, or explicitly none>`

## Maintenance notes
- Re-check `<anchor>` when `<known dependency>` changes.
- Preserve `<user-facing behavior or compatibility boundary>`.
```

The template records evidence and verification ownership; it never delegates implementation, commit, or push work.

## Milestone Field Descriptions

For each milestone, produce:

- **Objective** - 1-2 sentences: what this milestone proves or delivers
- **Effort estimate** - expected agent execution time, derived from countable units (files to read/edit, commands to run), with the product / proof / everything-else split stated so drift from the rough ~70/20/10 guide is visible. Record machine-readable **Actual** at completion; the Phase 3 gate presents estimate vs. actual. See Effort Estimates below.
- **Tasks** - Checkboxes. Ordered by dependency, riskiest first. Each task is a concrete action, not a vague goal. Tag each task with a risk level: `[RISKY]` unknowns/integrations/unproven assumptions, `[CORE]` essential logic, `[SAFE]` straightforward work. Order: all [RISKY] first, then [CORE], then [SAFE]. Append each task's agent-time estimate with category, e.g. `(est: 8 min product)`.
- **Assumptions to validate** - What must be proven true during this milestone (not tasks - beliefs about the system)
- **Exit criteria** - Testable, binary pass/fail. Not "performance is acceptable" - instead "p95 latency under 500ms"
- **Testing gate** - What must be verified before starting the next milestone. Append `(est: n min proof)` to each agent-executed checkbox:
  - Static / Contract Check: language-appropriate static analysis (linters, type checkers) that must pass before behavioural tests run
  - Automated: which test commands must pass
  - Manual: which agent-run browser or smoke action must pass; human-only checks stay outside agent-time
  - Acceptance: agent self-checks may be estimated; human sign-off belongs to the blocking gate
- **Mid-implementation proof** - for milestones expected to touch 3+ files or run longer than 30-60 minutes, add one estimated checkbox naming a focused command, reproduction, or smoke check to run before switching modules or after a bounded edit batch
- **Kill criteria** - What would make us stop at this milestone rather than continue
- **Depends on** - Which milestone must complete first
- **Read first** - Files the implementing agent should read before starting this milestone

## Effort Estimates

Agent self-estimates fail in two recurring ways: durations calibrated to human workflows (quoting 30 hours for work an agent finishes in 3, or 30 minutes for a 3-minute fix - roughly 10x high), and proof work crowding out product work until the plan spends more effort verifying than building.

Estimate each milestone like this:

- **Count units, then convert.** Files to read, files to edit, commands/tests to run. A focused edit-verify cycle is minutes of agent-time, not hours. Never quote a duration you cannot decompose into units, and weight the units - a [RISKY] integration cycle costs more than a [SAFE] doc edit.
- **Separate agent-time from human-time.** Exclude human reviews, approvals, and waiting from agent-time; never pad an agent estimate with human wall-clock.
- **State the mix.** Split every estimate into product work / proof / everything else. Spikes and implementation are product work; testing gates, mid-implementation proof, and gate evidence are proof; orientation reads, plan upkeep, and status admin are everything else.
- **The target applies plan-level.** Roughly **70% product work, 20% proof, 10% everything else** is a diagnostic guide, never a quota or pass/fail gate. A risky migration may legitimately run proof-heavy; a straightforward feature may not.
- **Consolidate instead of padding.** High proof should trigger a search for repeated automated tests, manual checks, or evidence packaging - not forced ratio compliance. Keep risk-justified proof, reuse fresh evidence, and do not invent product work to improve the percentage.
- **Derive totals from the breakdown.** Estimated Tasks, Testing Gate checks, Mid-implementation proof, and `Plan/admin overhead: n min other` must exactly reproduce each category and the headline. Run `goat-flow plans check .goat-flow/plans/<active> --strict` before implementation.
- **Calibrate at the gate.** At each Phase 3 gate, replace `_` with `Actual: ~n min agent-time (n product / n proof / n other) - optional reason`, then apply the correction to the next milestone.
- **Every write mode carries the fields.** Small File-Write milestones retain Effort estimate, Actual, and Plan/admin overhead even when otherwise compact.

## Deferred and Backlog Routing

Cut work follows one flow, not three independent lists. A milestone's **Deferred** field records the cut item with a destination pointer; plan-level `backlog.md` collects those items under priority tiers (Next / Later / Maybe); ISSUE.md's **Out of scope** names only the exclusions a reviewer would ask about. Add the `backlog.md` entry in the same edit that records the Deferred pointer - a deferred item present in one surface and missing from the others is drift. Other skills may add named sections to `backlog.md` (for example goat-review's cross-run rejection rationales); the priority tiers apply to deferred work items.

> **Illustrative scenario - input/output shape only; never evidence.** The assumption block and worked examples below specify shapes for whatever project this skill is installed in. Paths, measurements, endpoints, and outcomes are placeholders, not real incidents - never cite them as evidence.

## Assumption Tracking

Assumptions are not tasks - they're beliefs about the system that affect the plan:

```markdown
## Assumptions
- [x] Background job queue handles 500-item batches (benchmarked in the spike)
- [ ] File upload endpoint accepts multipart form data (untested)
- [x] Database migration runs without downtime (spike confirmed in the first milestone)
- [ ] Rate limiting handles concurrent requests correctly (assumed, not tested)
```

When an assumption is validated, tick it and note the evidence. When an assumption is invalidated, record it immediately and stop dependent work. Apply the plan amendment only when the selected mode or required human approval permits; at a blocking gate, show the proposed amendment and wait.

## Worked Example - Path-Only Intake

User message: `.goat-flow/plans/oauth-refresh/`

Evidence read: `.goat-flow/plans/.active` says `checkout-hardening`; milestone status fields show `.goat-flow/plans/oauth-refresh/M01-prove-refresh-token-rotation.md` is complete and `.goat-flow/plans/oauth-refresh/M02-wire-login-refresh-flow.md` is the single in-progress milestone; the bounded follow-up read returns only its first unchecked task line, `[CORE] Implement refresh callback`.

Expected output:

```markdown
Mode: Path-Only Intake. Orientation summary for `.goat-flow/plans/oauth-refresh/`: active pointer is `checkout-hardening`, so I did not switch plans. `oauth-refresh` has M01 complete and M02 in-progress. Current unchecked task: `[CORE] Implement refresh callback`. Next action needed from user: summary, status check, plan update, or start a specific milestone?
```

Expected outcome: no writes to `.goat-flow/plans/.active`, milestone status fields, task checkboxes, or code.

## Worked Example - Mode 4 File-Write

User message: `Create milestones for adding OAuth refresh-token rotation to the dashboard login flow.`

Expected writes:
- `.goat-flow/plans/.active` is a one-line pointer: `oauth-refresh`
- `.goat-flow/plans/oauth-refresh/ISSUE.md`
- `.goat-flow/plans/oauth-refresh/M01-prove-refresh-token-rotation.md`
- `.goat-flow/plans/oauth-refresh/M02-wire-login-refresh-flow.md`

Expected `M01-prove-refresh-token-rotation.md` shape:

```markdown
# Milestone 01: Prove refresh-token rotation
Status: not-started
Effort estimate: ~25 min agent-time (18 product / 5 proof / 2 other)
Actual: _
Plan/admin overhead: 2 min other

## Objective
Prove the OAuth provider issues rotated refresh tokens and that the app can persist the new token without breaking existing sessions.

## Tasks
- [ ] [RISKY] Verify the OAuth provider returns a replacement refresh token after refresh (est: 8 min product)
- [ ] [RISKY] Confirm the session store can atomically replace refresh-token metadata (est: 6 min product)
- [ ] [CORE] Add the minimal refresh-token persistence path (est: 4 min product)

## Testing Gate
### Static / Contract Check
- [ ] `npm run typecheck` exits 0 (est: 2 min proof)

### Manual
- [ ] Refresh an expiring session in a local browser; expected: the user remains signed in and the stored refresh token changes (est: 2 min proof)

## Mid-implementation proof
- [ ] Run the focused refresh smoke check after the persistence edit (est: 1 min proof)
```

Expected checkpoint: `Milestone files + ISSUE.md written to .goat-flow/plans/oauth-refresh/. Ready to start implementation.`

## Worked Example - Risk-Tagged Milestone

```markdown
## Milestone 2: User authentication

- [ ] [RISKY] Verify OAuth provider supports refresh-token rotation (spike, throwaway)
- [ ] [RISKY] Confirm session storage works under our load profile
- [ ] [CORE] Implement login endpoint
- [ ] [CORE] Implement logout endpoint
- [ ] [CORE] Implement session expiry
- [ ] [SAFE] Add login button to header
- [ ] [SAFE] Update README with auth flow

### Testing Gate

#### Static / Contract Check (must pass before behavioural tests run)
- [ ] `npm run typecheck` exits 0
- [ ] `npx eslint --max-warnings 0 src/auth/` exits 0

#### Automated
- [ ] `npm test -- --testPathPattern=auth` exits 0

#### Manual
- [ ] Login flow tested in staging with real OAuth provider
- [ ] Session persists across page reload
- [ ] Expired session redirects to login

#### Acceptance
- Developer self-check
```

## Worked Example - Phase 3 Human Verification Gate

Continuing the OAuth refresh-token example: M01 (`Prove refresh-token rotation`) finishes, the agent runs the AI Verification Gate, then presents the BLOCKING Human Verification Gate from SKILL.md Phase 3. Concrete presentation:

```markdown
M01 implementation evidence ready - Human Verification Gate (BLOCKING)

Files changed this session:
- `src/auth/refresh.ts` - added `rotateRefreshToken()` persistence path
- `src/auth/session-store.ts` - atomic refresh-token replacement
- `test/auth/refresh.test.ts` - rotation + stale-token-rejection coverage

Effort: estimated ~25 min agent-time (18 product / 5 proof / 2 other); actual ~35 min agent-time (22 product / 10 proof / 3 other) - the rotation spike needed one extra proof cycle.

Exit criteria (evidence from this session):
- [x] Provider issues a rotated refresh token - `npm test -- refresh.test.ts`: `rotates token on refresh` passing (12 passed, 0 failed)
- [x] `npm run typecheck` exits 0 - ran this session, exit 0
- [x] Stored token changes after a browser refresh - manual: session persisted, stored value differed pre/post

Assumptions:
- [x] Provider returns a replacement refresh token (validated - observed in the provider response during the spike)
- [ ] Session store handles concurrent refresh atomically - INVALIDATED: two parallel refreshes raced and one restored a stale token. Proposed M02 amendment: add a per-session lock before wiring the login flow. No plan file changed yet.

M01 remains `in-progress` pending approval. Approve the proposed M02 amendment and completion transition, or adjust?
```

The agent stops here and waits. It does not amend M02, set M02 to `in-progress`, tick M02 tasks, or touch code until the human approves. The Testing Gate produced the evidence once; the AI gate audits it and the human gate receives it. Rerun only stale/failed evidence or when risk requires it. After the human approves, the agent re-reads and applies the M02 amendment before changing statuses, records the assumption evidence and structured Actual, sets M01 to `complete` and M02 to `in-progress`, then reruns `goat-flow plans check .goat-flow/plans/oauth-refresh --strict`. It may touch M02 code only after those plan updates.

## Worked Example - Kill-Criteria-Triggered Stop

The same M01 can end the opposite way. Risk-weighted ordering puts the rotation spike first, so a blocker surfaces before any [CORE] work begins: where the gate above had the provider rotating tokens, here the spike finds it does not, and the kill criteria fire instead. M01's kill criteria: `Stop if the OAuth provider does not rotate refresh tokens at all - the rotation feature is moot without provider support.` During the spike the provider returned the same token on every refresh. Concrete output:

```markdown
KILL CRITERIA TRIGGERED - M01 (BLOCKING GATE)

Trigger: `npm test -- refresh.test.ts` - assertion `tokenBefore !== tokenAfter` failed; the provider returned an identical refresh token on repeat refresh. Proof-class: RUNTIME, this session.

Impact: M01's riskiest assumption is false. Rotation cannot be built on this provider, so M02 (wire login refresh flow) and the rotation requirement in ISSUE.md are blocked, not merely delayed.

Options: (a) switch to a provider/grant that rotates tokens, (b) drop rotation and re-scope the plan to access-token-only refresh, (c) abandon the plan.

Stopping. No further milestones started. Which direction?
```

A triggered kill criterion is a BLOCKING GATE (see SKILL.md Constraints, "check kill criteria between milestones"): the agent stops the line, preserves the failing evidence, and does not start M02 or silently downgrade scope.

## Critique Follow-up

`/goat-plan` does not run `/goat-critique` automatically. If the user explicitly asks to critique a plan, run `/goat-critique` against the written milestone files as separate report-only work. Do not save critique alternatives inside milestone files unless the user asks to apply a specific change.
