---
goat-flow-reference-version: "1.10.1"
---
# Milestone Template - Detailed Field Reference

Extracted from the goat-plan SKILL.md to keep the skill file within word budget. The SKILL.md retains a concise summary; this file has the full field descriptions and worked examples.

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

## Critique Follow-up

`/goat-plan` does not run `/goat-critique` automatically. If the user explicitly asks to critique a plan, run `/goat-critique` against the written milestone files as separate report-only work. Do not save critique alternatives inside milestone files unless the user asks to apply a specific change.
