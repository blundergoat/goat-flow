---
goat-flow-reference-version: "1.17.0"
---
# Milestone Formats

Preserve execution, proof, and recovery: Small uses one compact file; Standard adds cold-start context; high-risk adds protections for named failures.

## Compact Small rendering

Use one file, at most 500 words and 40 nonblank lines; omit untriggered sections.

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
- [ ] <claim> → <evidence and the unique command when needed> [automated] (est: <n min proof>)

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
- [ ] C1: <claim> → <evidence from Commands § focused proof> [automated] (est: <n min proof>)
- [ ] C2: <observable behaviour> → <action and expected result> [manual] (est: <n min proof>)

## Exit
- C1-C2 are green with fresh evidence.

## Stop / rescope
- Stop if <a premise fails, scope changes, or evidence conflicts>.
```

Keep commands in Commands: a literal command appears once per milestone; Proof, tasks, and exit reference its purpose. Add Mid-implementation proof before switching modules or after a bounded edit batch. The Objective is one plain sentence; ids and paths belong in Context and Scope. Done conditions state claims; cases belong in tests or Commands.

Write from the incident in Context, not by shortening the Objective - that sentence is for the implementer. One sentence each. `goat-flow plans check --strict` enforces current-heading length and internal identifiers. Name commands with their tool; visible user surfaces are not internal. The problem sentence names who hits it. The benefit sentence names what they can now do, never what ships. Neither restates the other. A spike that ships nothing says so.

- BAD: "Runtime proof executing target-controlled launchers needs a trusted-target choice."
- GOOD: "Looking at a stranger's repo can't run their code on your machine."
- BAD: "Ships as a registered hook, default-on for verified agents, gated elsewhere."
- GOOD: "Your agent starts a session already knowing the project's rules."

## Status reason

Add `**Status reason:**` directly after Status only while `blocked` or `abandoned`. For blocked work, name the condition and evidence/action needed to resume. For abandoned work, preserve the human decision and why work stops. Remove the field when leaving either state.

## High-risk additions

Add only sections that prevent a named failure:

- **Boundary Notes:** authorization, irreversibility, recovery ownership, rollback.
- **Current-state evidence:** observations determining design.
- **Assumptions:** unresolved premises, dependent work, and required evidence.
- **Verification baseline:** pre-change results by command purpose.
- **Layered Proof:** distinct compatibility, rollback, security, migration, and behavioural claims.
- **Maintenance notes:** non-obvious maintenance traps.

### Verification baseline

Record pre-change results by command purpose; never repeat commands.

### Maintenance notes

Include only real, non-obvious maintenance traps.

High-risk detail has no safety-reducing cap; above 1,200 words, name the safety reason. Never delegate commit, push, or implementation authority.

## Field guide

| Field | Rule |
|---|---|
| Outcome | Name what becomes true; add Objective only to clarify the title. |
| What problem are we solving | What stays broken. |
| Who benefits and how | What you can now do. |
| Tasks | Order `[RISKY]`, `[CORE]`, `[SAFE]`; one action and one done condition per checkbox. |
| Proof | State the claim in plain words → evidence with relevant tags; human sign-off belongs to the blocking gate. |
| Exit | State binary transition truth; reference proof claims. |
| Stop | Name the failed premise or boundary; preserve evidence and block dependent work. |
| Context | Give fresh agents non-obvious files and semantic anchors. |
| Dependencies | Use `none` or comma-separated local milestone IDs; keep cross-plan prerequisites in narrative context. |
| Lane | Optional `^[a-z0-9][a-z0-9-]{0,39}$` token; omitted/empty means `default`; scheduling metadata, never writer ownership. |

## Lane lifecycle

Read `../SKILL.md`: Phase 2 Mode 0 owns cap provenance and session selection; Phase 3 owns activation, gates, writer ownership, and the final dependency join. Omitted or empty Lane means `default`; all three active statuses consume their lane and the global cap. Strict scheduling success alone never proves the final join.

### Downgrade recovery

Before using an older checker, stop every extra open receipt. Keep one milestone active; block the others with a `Status reason:` preserving prior state, downgrade pause, and cap-compatible resume condition. Rerun strict validation before downgrade. Restore each prior state only after lane-cap support returns; preserve every task and receipt history.

## Effort Estimates

- Count positive agent-owned Task/Proof/Mid-proof items plus one positive admin entry; `[HUMAN]`/zero-minute items are excluded from agent work units.
- Use cold `0.5-2.5-10 min/unit` below three matching measured bases; otherwise use `plans check` low-median-high rates.
- Multiply units by rates: floor low (minimum one), round likely/headline, and ceil high. Reforecast all estimates before implementation after scope change or `reforecast required`.
- Separate agent-time from human waiting; exact minutes are calibration inputs, not promises.
- Split product, proof, and other work so imbalance remains visible.
- Treat roughly 70/20/10 as a diagnostic guide, never a quota or pass/fail gate.
- Remove duplicate proof instead of padding product work; retain risk-justified deviations.
- Tasks, Proof, Mid-implementation proof, and `Plan/admin overhead: n min other` must exactly reproduce each category and the headline.
- Before the human gate, record structured **Actual:** and recalibrate the next milestone.
- Run `goat-flow plans check .goat-flow/plans/<active> --strict` before implementation and after transitions.

### Timing receipts

Start a receipt before the first action. The CLI stamps UTC and epoch seconds in the milestone, preserving timing through log purges and handoffs.

```bash
goat-flow plans time start <milestone-file> --category <product|proof|other>
goat-flow plans time stop <milestone-file>             # pause; resume with another start
goat-flow plans time status <milestone-file>           # read the open span and totals
goat-flow plans time stop <milestone-file> --finalize  # close the timeline at the gate
```

- Each milestone owns its receipt; separate valid lanes can hold simultaneous spans. Stop then start when the work category changes. Tests count as proof. A mixed-category span cannot measure the split.
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

### Forecast bases and ranges

```markdown
**Forecast basis:** <units> agent work units; <low>-<likely>-<high> min/unit low-likely-high; source: <cold-start prior or local receipt history>
**Forecast range:** <low>-<high> agent-time minutes on one recorded-unpaused milestone timeline; likely <n>; <confidence and why>
```

Legacy point estimates need no migration. A supplied basis must match agent work units, derive its range/headline, and exclude `[HUMAN]`/zero-minute items.

### Calibration

`plans check` keeps estimate-to-Actual ratios and also divides raw receipt seconds by matching agent work units. Only `complete` milestones with `measured` Actuals qualify; `human-verification-pending` calibrates nothing before ratification. Below three matching bases it keeps the cold-start prior. At three or more it reports local low-median-high min/unit rates and names unfinished stale forecasts as `reforecast required`. The CLI stays advisory and never rewrites files; goat-plan blocks implementation until that advisory is resolved.

An early goat-debug milestone estimated two hours and self-reported 256 active seconds. That Actual is `retrospective`, not `measured`, and cannot calibrate. Even a valid single ratio cannot size later milestones.

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
