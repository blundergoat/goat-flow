---
goat-flow-reference-version: "1.17.0"
---
# Milestone Formats

Small preserves execution, proof and recovery; Standard adds cold-start context; high-risk adds protections for named failures.

## Compact Small rendering

Use one file: at most 500 words and 40 nonblank lines; omit untriggered sections.

```markdown
# <Outcome>

**Status:** not-started
**Effort estimate:** ~<total> min agent-time (<product> product / <proof> proof / <other> other)
**Forecast basis:** <units/rates/source; use Effort Estimates grammar>
**Forecast range:** <derived low/likely/high; use Effort Estimates grammar>
**Plan/admin overhead:** <n> min other
**Scope:** <included result>; not included: <one tempting exclusion>

## Tasks
- [ ] [CORE] <action and done condition> (est: <n min product>)

## Proof
- [ ] <claim> → <evidence and the unique command when needed> [RUNTIME] [automated] (est: <n min proof>)

- [ ] [HUMAN] Accept the changes and evidence. [manual] (est: 0 min proof)

## Exit
- <binary completion condition>
- Stop/rescope if <failed premise or boundary>.
```

Add only material assumptions, dependencies, drift context, manual proof, or rollback.

## Handoff-grade milestone template

Use Standard for multi-milestone or cold-start work: at most 900 words and ten H2 headings unless a named risk requires more.

```markdown
# M01: <outcome>

**Status:** not-started
**Planned at:** `<sha>`, YYYY-MM-DD
**Depends on:** <local milestone IDs or none>
**Lane:** <optional lowercase lane token>
**Effort estimate:** ~<total> min agent-time (<product> product / <proof> proof / <other> other)
**Forecast basis:** <units/rates/source; use Effort Estimates grammar>
**Forecast range:** <derived low/likely/high; use Effort Estimates grammar>
**Actual:** _
**Plan/admin overhead:** <n> min other

## Objective
<Binary outcome this milestone proves or delivers.>

## What problem are we solving
<One sentence, 70-120 characters: what stays broken.>

## Who benefits and how
<One sentence, 70-120 characters: what you can now do.>

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
- [ ] C1: <claim> → <evidence from Commands § focused proof> [RUNTIME] [automated] (est: <n min proof>)
- [ ] C2: <observable behaviour> → <action and expected result> [RUNTIME] [manual] (est: <n min proof>)

- [ ] [HUMAN] Accept the changes and evidence. [manual] (est: 0 min proof)

## Exit
- C1-C2 have fresh evidence and human acceptance is recorded.

## Stop / rescope
- Stop if <a premise fails, scope changes, or evidence conflicts>.
```

Commands owns each invocation: a literal command appears once per milestone; other sections reference its purpose. The Objective is one plain sentence; ids/paths belong in Context/Scope. Done conditions state claims; cases belong in tests/Commands.

Write from the incident in Context, not by shortening the Objective - that sentence is for the implementer. One sentence each. `goat-flow plans check --strict` enforces current-heading length and internal identifiers. Name commands with their tool; visible user surfaces are not internal. The problem sentence names who hits it. The benefit sentence names what they can now do, never what ships. Neither restates the other. A spike that ships nothing says so.

- BAD: "Runtime proof executing target-controlled launchers needs a trusted-target choice."
- GOOD: "Reviewing a stranger's repository cannot run its code on your machine without your approval."
- BAD: "Ships as a registered hook, default-on for verified agents, gated elsewhere."
- GOOD: "Your agent starts each session knowing the project's rules, so you do not have to repeat them."

## Status reason

Supported statuses: `not-started`, `in-progress`, `testing-gate`, `human-verification-pending`, `blocked`, `abandoned`, `superseded`, `deferred`, `complete`.

Add one current `**Status reason:**` after Status for these exceptional states:

| State | Required reason |
|---|---|
| blocked | Condition and evidence/action needed to resume. |
| abandoned | Preserve the human decision and why work stops. |
| superseded | Name a resolvable non-self successor milestone. |
| deferred | Name the later release or record owning the scope. |

Remove stale reasons on ordinary states; reopening invalidates proof.

## High-risk additions

Add only sections that prevent a named failure:

- **Boundary Notes:** authorization, irreversibility, recovery ownership, rollback.
- **Current-state evidence:** observations determining design.
- **Assumptions:** unresolved premises, dependent work, and required evidence.
- **Verification baseline:** pre-change results by command purpose.
- **Proof:** keep distinct compatibility, rollback, security, migration and behavioural claims under `## Proof`.
- **Maintenance notes:** non-obvious maintenance traps.

Before switching modules or after a bounded edit batch, add:

```markdown
## Mid-implementation proof
- [ ] P1: <claim> → <evidence from Commands § focused proof> [RUNTIME] [automated] (est: <n min proof>)
```

Proof classes (RUNTIME, STATIC, etc.) follow the preamble; automated/manual labels describe execution. Only leading `[HUMAN]` marks human ownership.

### Verification baseline

Record pre-change results by command purpose; never repeat commands.

### Maintenance notes

Include only real, non-obvious maintenance traps.

High-risk detail has no safety-reducing cap; above 1,200 words, name the safety reason. Never delegate commit, push, or implementation authority.

## Field guide

| Field | Rule |
|---|---|
| Outcome | Name the outcome; add Objective only for clarification. |
| What problem are we solving | What stays broken. |
| Who benefits and how | What you can now do. |
| Tasks | Order `[RISKY]`, `[CORE]`, `[SAFE]`; one action and done condition per checkbox. |
| Proof | Plain claim → tagged evidence; human sign-off stays gated. |
| Exit | Binary transition condition referencing proof claims. |
| Stop | Name failed premise/boundary; preserve evidence; block dependent work. |
| Context | Non-obvious files and semantic anchors. |
| Depends on | `none` or comma-separated local IDs; cross-plan prerequisites stay in Context. |
| Lane | Optional `^[a-z0-9][a-z0-9-]{0,39}$` token; omitted/empty means `default`; scheduling metadata, never writer ownership. |

## Lane lifecycle

Read `../SKILL.md`: Phase 2 Mode 0 owns cap provenance and session selection; Phase 3 owns activation, gates, writer ownership, and the final dependency join. Omitted or empty Lane means `default`; all three active statuses consume their lane and the global cap. Strict scheduling success alone never proves the final join.

### Downgrade recovery

Before using an older checker, stop every extra open receipt. Keep one milestone active; block the others with a `Status reason:` preserving prior state, downgrade pause, and cap-compatible resume condition. Rerun strict validation before downgrade. Restore each prior state only after lane-cap support returns; preserve every task and receipt history.

## Effort Estimates

- Count positive Task/Proof/Mid-proof/admin entries; `[HUMAN]`/zero-minute items are excluded from agent work units.
- Below three matching measured bases use cold `0.5-2.5-10 min/unit`; otherwise use `plans check` low-median-high rates.
- Units × rates: floor low (minimum one), round likely/headline, ceil high. Reforecast all estimates before implementation after scope change or `reforecast required`.
- Agent-time excludes human waits; exact minutes inform calibration, never promises.
- Tasks/Proof/Mid-implementation proof plus `Plan/admin overhead: n min other` must reproduce product/proof/other categories and headline.
- Roughly 70/20/10 is diagnostic, never a quota/gate. Remove duplicate proof; never pad product; retain risk-justified deviations.
- Recalibrate after completion.
- Run `goat-flow plans check .goat-flow/plans/<active> --strict` before implementation and after transitions.

### Forecast bases and ranges

```markdown
**Forecast basis:** <units> agent work units; <low>-<likely>-<high> min/unit low-likely-high; source: <cold-start prior or local pLow/pHigh receipt history>
**Forecast range:** <low>-<high> agent-time minutes on one recorded-unpaused milestone timeline; likely <n>; <confidence and why>
```

A basis requires its derived range/headline in both modes, excluding `[HUMAN]`/zero-minute units. Legacy points and range-only estimates remain valid.

## Timing receipts

Use absolute milestone paths under `.goat-flow/plans/`; retain repository cwd for source-loader resolution. CLI stamps UTC/epoch seconds.

1. **Begin:** resolve authorization, prerequisites, lane and cap; set exactly one rendered Status to `in-progress` or `testing-gate`, then start and inspect the category receipt before work. Pending consumes capacity but cannot Start.
2. **Change category:** stop, inspect, then start the next category at the work boundary. Tests count as proof; never invent a mixed span's split.
3. **Pause:** Stop before every human wait, interruption, unrelated task or inactive transition; inspect, then validate. Inactive: blocked, abandoned, deferred, superseded, human-verification-pending, complete.
4. **Rejected Start:** preserve unchanged bytes/error; correct authorized state, retry prospectively. Never backfill or bypass gates.
5. **Handoff:** finish Tasks/agent proof and verification; finalize timing and inspect truthful Actual before `human-verification-pending`. Only leading zero-minute `[HUMAN]` proof stays open; acceptance never reopens timing.
6. **Requested changes:** obtain approval, invalidate affected proof, restore execution state, start a fresh segment. Reuse only current evidence.
7. **Authorized reset:** stop timing; fence exact historical receipts and Actual under `## Reset history`; remove their live representations. Reopen scoped Tasks/Proof/Mid-implementation proof/Exit checkboxes; clear current Actual and stale Status reason; set `not-started`; validate. Fenced history supplies no live metadata. Never erase inconvenient measurements.

```bash
goat-flow plans time start <milestone-file> --category <product|proof|other>
goat-flow plans time stop <milestone-file>             # pause; resume with another start
goat-flow plans time status <milestone-file>           # inspect receipt totals
goat-flow plans time stop <milestone-file> --finalize  # finalize after verification
```

Each milestone owns its receipt; separate valid lanes can hold simultaneous spans. Manual pauses miss suspend and forgotten waits. `stop --discard-open` drops an unmeasurable open span, permanently marking the receipt incomplete; never invent its end. Delegated or parallel-agent effort is disclosed separately, never folded into this timeline.

### Actual states

| State | Use when |
|---|---|
| `measured: ~N min agent-time (...) - receipt <n> recorded-unpaused seconds` | Finalized receipt and allocation back every minute. |
| `retrospective: <numbers> - <reason>` | After-the-fact estimates, including untagged legacy numbers; prose never promotes them to measured. |
| `unavailable: <reason>` | No trustworthy total or category allocation exists. |
| `incomplete: <reason>` | Discarded spans leave elapsed time under-recorded. |

### Calibration

`plans check` reports estimate/Actual ratios and raw seconds per matching work unit. Only complete/measured milestones calibrate; pending never qualifies. Below three bases keep the cold-start prior; otherwise use local low-median-high rates. Unfinished `reforecast required` blocks implementation. The CLI advises, never rewrites.

A goat-debug milestone estimated two hours, self-reporting 256 active seconds: retrospective, ineligible for calibration. One ratio cannot size later milestones.

## Deferred and Backlog Routing

Record each cut item and destination once; route to `backlog.md` under Next, Later, or Maybe. ISSUE.md names expected exclusions only. Omit empty Deferred, backlog, and maintenance sections.

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

Evidence read: `.active` points elsewhere; a strict check passes at default cap one; metadata shows M01 complete and M02 as the sole in-progress milestone depending on M01, so M02 is the unique final join; the bounded follow-up read returns only its first unchecked task line.

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

The agent stops. After the human approves, it applies the M02 amendment before changing statuses, sets M01 complete, starts the selected M02 only when dependencies and lane capacity allow, preserves other lanes, and reruns strict validation.

## Kill-criteria stop

```markdown
KILL CRITERION TRIGGERED — M01 (BLOCKING)

Evidence: the provider returned the same token after refresh, invalidating the rotation premise.
Impact: dependent rotation work remains blocked; the requirement is not silently weakened.
Options: change provider, rescope with explicit approval, or abandon while preserving evidence.
```

`/goat-plan` never runs `/goat-critique` automatically. A requested critique remains separate report-only work until the user asks to apply it.
