---
goat-flow-reference-version: "1.14.0"
---
# Milestone Formats

Use the smallest rendering that preserves execution, proof, and recovery. A Small plan is one compact file; Standard adds cold-start context; high-risk adds only protections tied to named failure modes.

## Compact Small rendering

Use one file, at most 500 words and 40 nonblank lines. Omit every untriggered section.

```markdown
# <Outcome>

**Status:** not-started
**Effort estimate:** ~<total> min agent-time (<product> product / <proof> proof / <other> other)
**Scope:** <included result>; not included: <one tempting exclusion>

## Tasks
- [ ] [CORE] <action and done condition> (est: <n min product>)

## Proof
- [ ] <claim> → <evidence and the unique command when needed> [automated] (est: <n min proof>)

## Exit
- <binary completion condition>
- Stop/rescope if <failed premise or boundary>.
```

Add assumptions, dependencies, drift context, manual proof, or rollback only when material.

## Handoff-grade milestone template

Use this Standard shape for multi-milestone or cold-start work. Target at most 900 words and ten H2 headings unless a named risk requires more.

```markdown
# M01: <outcome>

**Status:** not-started
**Planned at:** `<sha>`, YYYY-MM-DD
**Depends on:** <local milestone IDs or none>
**Effort estimate:** ~<total> min agent-time (<product> product / <proof> proof / <other> other)
**Actual:** _

## Objective
<Binary outcome this milestone proves or delivers.>

## Context
- Read first: `<file>` (search: `<semantic anchor>`) — <non-obvious convention or reference>.
- Drift: `git diff --stat <sha> -- <paths>` and `git status --short -- <paths>`.

## Scope
- In: <local result and paths>.
- Out: <tempting, ambiguous, or costly adjacent work>.

## Tasks
- [ ] [RISKY] <uncertainty-first action and done condition> (est: <n min product>)
- [ ] [CORE] <implementation action and done condition> (est: <n min product>)

## Commands
| Purpose | Command | Expected result |
|---|---|---|
| <focused proof> | `<literal command>` | <observable pass condition> |

## Proof
- [ ] C1: <claim> → <evidence from Commands § focused proof> [automated] (est: <n min proof>)
- [ ] C2: <observable behaviour> → <action and expected result> [manual] (est: <n min proof>)

## Exit
- C1-C2 are green with fresh evidence.

## Stop / rescope
- Stop if <a premise fails, scope changes, or evidence conflicts>.
```

Put each literal command in one Commands source. Proof, tasks, and exit criteria reference its purpose rather than repeating it. Add Mid-implementation proof only before switching modules or after a bounded edit batch.

## High-risk additions

Add only sections that prevent a named failure:

- **Boundary Notes:** authorization, irreversible actions, recovery ownership, and rollback.
- **Current-state evidence:** observed facts that determine the design.
- **Assumptions:** unresolved premises, dependent work, and required evidence.
- **Verification baseline:** pre-change results referenced by command purpose.
- **Layered Proof:** distinct compatibility, rollback, security, migration, and behavioural claims.
- **Maintenance notes:** non-obvious post-delivery traps only.

### Verification baseline

Record the observed pre-change result beside a command purpose; never repeat the literal command.

### Maintenance notes

Include only a real trap a future maintainer cannot infer.

High-risk detail has no safety-reducing hard cap; output above 1,200 words names the safety reason. The artifact never delegates commit, push, or implementation authority.

## Field guide

| Field | Rule |
|---|---|
| Outcome | Name what becomes true; add Objective only when the title needs clarification. |
| Tasks | Order `[RISKY]`, `[CORE]`, `[SAFE]`; one action and one done condition per checkbox. |
| Proof | State claim → evidence with relevant tags; human sign-off belongs to the blocking gate. |
| Exit | State binary transition truth and reference proof claims without copying commands. |
| Stop | Name the failed premise or boundary; preserve evidence and block dependent work. |
| Context | Point to non-obvious files and semantic anchors needed by a fresh agent. |
| Dependencies | Use `none` or comma-separated local milestone IDs; keep cross-plan prerequisites in narrative context. |

## Effort Estimates

- Count files read or edited, commands, and integration cycles before converting to agent-time.
- Separate agent-time from human waiting; exact minutes are calibration inputs, not promises.
- Split product, proof, and other work so imbalance remains visible.
- Treat roughly 70/20/10 as a diagnostic guide, never a quota or pass/fail gate.
- Remove duplicate proof instead of padding product work; retain risk-justified deviations.
- Tasks, Proof, Mid-implementation proof, and `Plan/admin overhead: n min other` must exactly reproduce each category and the headline.
- Before the human gate, record structured **Actual:** and recalibrate the next milestone.
- Run `goat-flow plans check .goat-flow/plans/<active> --strict` before implementation and after transitions.

### Timing receipts

Start a receipt before the first action. The CLI stamps UTC and epoch seconds into the milestone file itself, so the evidence survives log purges and travels with the plan.

```bash
goat-flow plans time start <milestone-file> --category <product|proof|other>
goat-flow plans time stop <milestone-file>             # pause; resume with another start
goat-flow plans time status <milestone-file>           # read the open span and totals
goat-flow plans time stop <milestone-file> --finalize  # close the timeline at the gate
```

- Switch category when the *kind* of work changes, not when the milestone changes. Running the test suite is proof time. One long span across a mixed session yields a `measured` split that measured nothing.
- Stop before every human wait, interruption, and unrelated task. Manual pauses cannot detect machine suspend or a forgotten wait, so a span left open overnight is worthless.
- `stop --discard-open` drops a span no honest end time exists for - a crash, a suspend, a forgotten pause - and permanently marks the receipt incomplete. No recovery path invents an end time.
- Delegated or parallel-agent effort is disclosed separately. Never fold it into elapsed time on one timeline.

### Actual states

`Actual:` carries its own provenance, so a missing clock never forces an invented number.

| State | Use when |
|---|---|
| `measured: ~N min agent-time (...) - receipt <n> recorded-unpaused seconds` | A finalized receipt backs every minute, and its allocation reconciles with the split. |
| `retrospective: <numbers> - <reason>` | The numbers are an after-the-fact estimate. Untagged legacy numerics classify here automatically; prose claiming measurement does not promote them. |
| `unavailable: <reason>` | No timing was recorded and no honest number exists. |
| `incomplete: <reason>` | A span was discarded, so the total under-reports real elapsed time. |

### Optional forecast ranges

```markdown
**Forecast range:** <low>-<high> agent-time minutes on one recorded-unpaused milestone timeline; likely <n>; <confidence and why>
```

Optional by contract: plans that forecast a single point stay valid and need no migration. When the band is present, `likely` must equal the `Effort estimate` headline and every value uses that same unit.

### Calibration

`plans check` reports estimate-to-Actual ratios from raw receipt seconds, plus a plan median and observed bounds. Only `complete` milestones carrying `measured` Actuals qualify, because `complete` is the human ratification signal - a milestone still at `human-verification-pending` calibrates nothing however good its receipt. Below three eligible samples the report says `uncalibrated` instead of offering a multiplier. The output is informational: it never rewrites a forecast or changes strict pass/fail.

One milestone landing far from its estimate is a data point, not a correction factor. An early goat-debug milestone estimated two hours and self-reported 256 active seconds. Under this contract that Actual is `retrospective` rather than `measured`, so it cannot calibrate anything - and even if it could, a single ratio would have mis-sized every later milestone.

## Deferred and Backlog Routing

Record a cut item once in the milestone with its destination, then place it in plan-level `backlog.md` under Next, Later, or Maybe. ISSUE.md names only exclusions reviewers would reasonably expect. Omit empty Deferred, backlog, and maintenance sections.

> **Illustrative scenario - input/output shape only; never evidence.** All paths, commands, measurements, and outcomes below are placeholders for the installed project.

## Assumption Tracking

Assumptions are beliefs, not tasks. Tick each with evidence; an invalidated assumption stops dependent work and preserves the failure for human review.

```markdown
## Assumptions
- [x] Provider rotates refresh tokens — observed during the spike.
- [ ] Session storage replaces tokens atomically — unverified; blocks concurrent refresh work.
```

## Path-only intake

User message: `.goat-flow/plans/oauth-refresh/`

Evidence read: `.active` points elsewhere; status fields show M01 complete and M02 as the sole in-progress milestone; the bounded follow-up read returns only its first unchecked task line.

```markdown
Mode: Path-Only Intake. `oauth-refresh` has M01 complete and M02 in-progress. I did not switch `.active`. Current task: `[CORE] Implement refresh callback`. Next action needed: summary, status check, plan update, or start this milestone?
```

Expected outcome: no writes to `.active`, milestone status, checkboxes, or code.

## Human verification gate

Successful AI proof records structured Actual and sets `human-verification-pending` before this output:

```markdown
M01 evidence ready — HUMAN VERIFICATION GATE (BLOCKING)

Files changed: `src/auth/refresh.ts`, `src/auth/session-store.ts`, `test/auth/refresh.test.ts`.
Effort: estimated 25 minutes; actual 35 minutes because the spike needed another proof cycle.
Evidence: token rotation and stale-token rejection pass; browser session remains signed in.
Assumption INVALIDATED: concurrent refreshes can restore stale data.
Proposed M02 amendment: add a per-session lock. No plan file changed yet.

Approve M01 completion and the proposed amendment, or adjust?
```

The agent stops. After the human approves, it applies the M02 amendment before changing statuses, sets M01 complete, starts M02 only when dependencies allow, and reruns strict validation.

## Kill-criteria stop

```markdown
KILL CRITERION TRIGGERED — M01 (BLOCKING)

Evidence: the provider returned the same token after refresh, invalidating the rotation premise.
Impact: dependent rotation work remains blocked; the requirement is not silently weakened.
Options: change provider, rescope with explicit approval, or abandon while preserving evidence.
```

`/goat-plan` never runs `/goat-critique` automatically. A requested critique remains separate report-only work until the user asks to apply it.
