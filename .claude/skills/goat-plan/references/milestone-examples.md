---
goat-flow-reference-version: "1.13.1"
---
# Milestone Template - Detailed Field Reference

Extracted from the goat-plan SKILL.md to keep the skill file within word budget. The SKILL.md retains a concise summary; this file has the full field descriptions and worked examples.

## Contents

- Milestone field descriptions
- Assumption tracking
- Path-only intake example
- Mode 4 file-write example
- Risk-tagged milestone example
- Phase 3 human verification gate example
- Kill-criteria-triggered stop example

## Milestone Field Descriptions

For each milestone, produce:

- **Objective** - 1-2 sentences: what this milestone proves or delivers
- **Tasks** - Checkboxes. Ordered by dependency, riskiest first. Each task is a concrete action, not a vague goal. Tag each task with a risk level: `[RISKY]` unknowns/integrations/unproven assumptions, `[CORE]` essential logic, `[SAFE]` straightforward work. Order: all [RISKY] first, then [CORE], then [SAFE].
- **Assumptions to validate** - What must be proven true during this milestone (not tasks - beliefs about the system)
- **Exit criteria** - Testable, binary pass/fail. Not "performance is acceptable" - instead "p95 latency under 500ms"
- **Testing gate** - What must be verified before starting the next milestone:
  - Static / Contract Check: language-appropriate static analysis (linters, type checkers) that must pass before behavioural tests run
  - Automated: which test commands must pass
  - Manual: what a human must check (checkbox list, one action + one expected result per item)
  - Acceptance: who signs off (developer self-check, QA review, or stakeholder demo)
- **Mid-implementation proof** - for milestones expected to touch 3+ files or run longer than 30-60 minutes, name one focused command, reproduction, or smoke check to run before switching modules or after a bounded edit batch
- **Kill criteria** - What would make us stop at this milestone rather than continue
- **Depends on** - Which milestone must complete first
- **Read first** - Files the implementing agent should read before starting this milestone

## Assumption Tracking

Assumptions are not tasks - they're beliefs about the system that affect the plan:

```markdown
## Assumptions
- [x] Background job queue handles 500-item batches (benchmarked in the spike)
- [ ] File upload endpoint accepts multipart form data (untested)
- [x] Database migration runs without downtime (spike confirmed in the first milestone)
- [ ] Rate limiting handles concurrent requests correctly (assumed, not tested)
```

When an assumption is validated, tick it and note the evidence. When an assumption is invalidated, update the milestone plan immediately - don't continue building on a false premise.

## Worked Example - Path-Only Intake

User message: `.goat-flow/plans/oauth-refresh/`

Evidence read: `.goat-flow/plans/.active` says `checkout-hardening`; `.goat-flow/plans/oauth-refresh/M01-prove-refresh-token-rotation.md` has `Status: complete`; `.goat-flow/plans/oauth-refresh/M02-wire-login-refresh-flow.md` has `Status: in-progress`.

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

## Objective
Prove the OAuth provider issues rotated refresh tokens and that the app can persist the new token without breaking existing sessions.

## Tasks
- [ ] [RISKY] Verify the OAuth provider returns a replacement refresh token after refresh
- [ ] [RISKY] Confirm the session store can atomically replace refresh-token metadata
- [ ] [CORE] Add the minimal refresh-token persistence path

## Testing Gate
### Static / Contract Check
- [ ] `npm run typecheck` exits 0

### Manual
- [ ] Refresh an expiring session in a local browser; expected: the user remains signed in and the stored refresh token changes
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
M01 complete - Human Verification Gate (BLOCKING)

Files changed this session:
- `src/auth/refresh.ts` - added `rotateRefreshToken()` persistence path
- `src/auth/session-store.ts` - atomic refresh-token replacement
- `test/auth/refresh.test.ts` - rotation + stale-token-rejection coverage

Exit criteria (evidence from this session):
- [x] Provider issues a rotated refresh token - `npm test -- refresh.test.ts`: `rotates token on refresh` passing (12 passed, 0 failed)
- [x] `npm run typecheck` exits 0 - ran this session, exit 0
- [x] Stored token changes after a browser refresh - manual: session persisted, stored value differed pre/post

Assumptions:
- [x] Provider returns a replacement refresh token (validated - observed in the provider response during the spike)
- [ ] Session store handles concurrent refresh atomically - INVALIDATED: two parallel refreshes raced and one restored a stale token. M02 scope updated to add a per-session lock before wiring the login flow.

M01 complete. Approve to proceed with M02, or adjust?
```

The agent stops here and waits. It does not set M02 to `in-progress`, tick M02 tasks, or touch code until the human approves. The invalidated assumption has already amended M02's scope per the Milestone Retrospective protocol in `skill-conventions.md` - the plan is never changed silently.

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
