---
goat-flow-reference-version: "1.17.0"
---
# Skill Conventions

Read on **full-depth** invocations only; `skill-preamble.md` always loads first.

---

## Learning Loop - Entry Formats

Use project-specific buckets such as `verification.md` or `runtime.md`.

Route entries to `.goat-flow/learning-loop/lessons/`, `patterns/`, or `footguns/`; never to a monolithic log or README.

Before adding, Extract / Consolidate / Skip: search the relevant INDEX and bucket; update one root cause across symptoms; create only distinct causes; skip non-decision-changing material.
```markdown
<!-- Lesson bucket -->
---
category: verification
last_reviewed: YYYY-MM-DD
---

## Lesson: [Title]

**Created:** YYYY-MM-DD
**Decision changed:** [what future work does differently]
**Trigger phase:** READ | SCOPE | ACT | VERIFY (optional)

**Prevention:** [rule to prevent recurrence]

**What happened:** [description]

**Evidence:** `file` + semantic anchor (function name, unique string, or `(search: "pattern")`) - [what was found] (required for code-specific lessons; omit for behavioral lessons)
```

```markdown
<!-- Footgun bucket -->
---
category: hooks
last_reviewed: YYYY-MM-DD
---

## Footgun: [Title]

**Status:** active | **Created:** YYYY-MM-DD | **Evidence:** <choose one: ACTUAL_MEASURED, OBSERVED, or EXTERNAL_REFERENCE>
**Decision changed:** [what future work does differently]
**Trigger phase:** READ | SCOPE | ACT | VERIFY (optional)
**hallucination-risk:** high

**Prevention:** [rule to prevent recurrence]

**Symptoms:** [what breaks]

**Why it happens:** [root cause]

**Evidence:** `file` + semantic anchor (function name, unique string, or `(search: "pattern")`) - [what was found]
```

Keep metadata as one paragraph below the heading, then a blank line and `**Prevention:**` as the first body paragraph; bucket READMEs and `learn new` use this order.

Evidence labels: `ACTUAL_MEASURED` = reproduced/measured locally; `OBSERVED` = direct code/config evidence; `EXTERNAL_REFERENCE` = cited real incident with local applicability. Never use hypotheticals.

```markdown
# Successful Patterns

## Pattern: [Name]
**Context:** [when this approach works]
**Approach:** [what to do]
```

Use optional `hallucination-risk` when names can mislead, including generated code, environment config, or external contracts.

## Adaptive Step 0

Reuse 2-3 overlapping session logs instead of re-deriving context.

**The gate rule:** Infer supplied answers. With clear intent, target, and boundary, confirm once and proceed. Ask only at a genuine fork. A detailed brief or "skip Step 0" proceeds.

**Planning/interview boundary:** Default interview budget: one decision-bearing question at a time, no more than three per message or three rounds. Extend only when the user requests a deeper interview. When the budget is exhausted, present remaining choices with a recommended default and stop. Planning permission is not implementation permission. Do not implement unless the original directive authorized implementation or the user now selects it.

A clear implementation directive proceeds after required READ and SCOPE; do not manufacture interview questions. "Update the plan" means write the plan, not execute it: a plan-only request stops at the handoff while explicit implementation authorizes execution.

**Dispatcher invocation:** `/goat` announces the route; Step 0 asks remaining questions without repeating it. One dispatch, one intake gate.

## Contradiction Check

Flag mismatches between stated complexity and actual scope:
- "hotfix" but 5+ files affected → likely Standard or System
- "small feature" but crosses 3+ boundaries → likely System
- "quick test" but 20+ functions in target → warn scope is larger than implied

Surface the mismatch, suggest re-classification, and never proceed silently.

## Stuck Protocol

If 3 consecutive file reads produce no new signal relevant to the current question:
1. Present what you have so far
2. State what you were looking for and didn't find
3. Ask the human to redirect, narrow scope, or close

**Sub-agent mode:** When invoked as a sub-agent (forked context), most BLOCKING GATEs become CHECKPOINTs (logged, not paused). Step 0 proceeds with auto-detected scope. **Exception:** the goat-debug D2→D3 "human decides before fixing" safety gate and the goat-clarity Scope v2 approval gate MUST remain blocking even in sub-agent mode - they prevent unreviewed fixes or authority expansion.

## Task Tracking

For plan or milestone work, tick each task `- [x]` immediately, never at batch end or closeout. Checkboxes recover state after interruption or compaction; tick any missed completion before continuing.

On `/compact` without an active milestone, write current state to `.goat-flow/logs/sessions/`. Milestones are primary continuity; session logs are fallback.

Handoff receipts: read `.goat-flow/logs/sessions/README.md`; redact before writing.

## Durable Artifact Redaction

For session, handoff, critique, review, quality, security, or export text, use the version-compatible CLI required by `skill-preamble.md`: `goat-flow redact --output .goat-flow/logs/<fresh-path>`. Send the in-memory draft via stdin and EOF; only redacted bytes may reach disk. Redact before disk, not after. Never stage raw text; existing destinations are refused.

The hash-only `redactEvidenceText` API is not a readable scrubber. Redaction reduces credential leakage but neither provides DLP nor replaces secret review.

## Presenting Findings

For user-facing tasks, findings, or recommendations, use:

- **Summary:** what's affected (one line)
- **Problem:** what's wrong (one line)
- **Solution:** what to do (one line)

## Milestone Retrospective (goat-plan)

**Status vocabulary:** `not-started | in-progress | testing-gate | blocked | abandoned | superseded | deferred | human-verification-pending | complete`

Lifecycle:

1. Authorized work enters `in-progress` with complete dependencies, a free lane, and cap capacity; finished implementation enters `testing-gate`. Active statuses (`in-progress`, `testing-gate`, `human-verification-pending`) consume lane and cap; omitted/empty Lane means `default`.
2. Successful AI proof records structured `Actual:` and sets `human-verification-pending`; only human-owned items remain open. Each milestone owns its receipt and blocking human gate; unrelated active lanes keep their state and receipts.
3. Human approval completes only that non-final milestone. Re-read eligible work; resolve lane/cap contention with a human choice, never by number.
4. Human-requested changes return the milestone to `in-progress`; this applies only to the reviewed milestone. Invalidation/kill sets `blocked` and `Status reason:` names the condition and evidence/action to resume.
5. `abandoned` requires a human decision and `Status reason:` records why work stops. Leaving either state removes the reason; reopening invalidates proof.
6. `superseded` and `deferred` are terminal and need a `Status reason:`.

Goat-plan Mode 0 owns cap provenance/selection; Phase 3 owns writer ownership and downgrade recovery.

Derive the unique final join using goat-plan Phase 3: multiple sinks or uncovered work requires a plan amendment before source work or timing. Phase 4 needs that join `human-verification-pending`, all other participants complete, and no sibling active work.

At the gate, record learnings, resolve assumptions, and propose amendments before applying them.

### Plan Completion Protocol

See goat-plan Phase 4: audit, present the **BLOCKING** human gate, wait. Approval completes the final milestone; archival/removal remains human-owned.

Plans and milestones are verification artifacts. Agents MUST NOT delete, archive, or add self-destruct instructions.

Compact at ~60% context or 15+ turns.

When blocked: ask one question with a recommended default.

## Orchestration Admission

Before an optional repeated, parallel, delegated, review, QA, or critique pass, record:

Budget Ledger:
- Phase:
- Initial budget:
- Spent evidence:
- Proposed extra pass:
- New evidence expected:
- Failure class:
- Independence boundary:
- Objective per subagent:
- Why tasks are independent:
- Merge boundary:
- Budget/call cap:
- Return schema:
- Conflict owner:
- Stop condition:
- Decision: admitted | deferred | denied

A repeated pass must name a new failure class, independence boundary, or explicit user request. Admit it for blast-radius risk, targeted failed-verification evidence, useful independent context, or security/correctness value above cost.

Same-context reassurance with no new evidence is denied. Parallel tasks sharing files require a named merge boundary and conflict owner. Subagents keep one objective and structured return. Scouts get 5 tool calls; implementation gets 5 plus the task's estimated minutes, up to 20 tool calls, with larger tasks split first.

Required skill phases and verification are pre-admitted; cost cannot degrade or block them. Explicit `goat-critique` stays full delegated mode and preserves consent. This is rough admission control, not token accounting or a hard failure based only on estimated cost.

## Recovery

When a skill fails mid-execution (context limit, sub-agent death, tool error):

| Situation | Action |
|-----------|--------|
| Partial completion | Identify last completed step (last `[x]` checkbox in milestone file), resume from next |
| Missing artifacts | Return to the step that generates them, re-execute |
| Corrected twice on same approach | STOP and rewind the current hypothesis; ask for a different debugging angle |
| User wants restart | Re-run from Step 0 |
| User wants to skip | Document skip reason in output, proceed to closing |

## Interrupt Freeze Protocol

If the user interrupts, says "stop", "don't change anything", "no changes", or otherwise rejects file edits, freeze writes immediately. Only run read-only status or diff checks needed to report current state. Do not revert, clean up, archive, delete, or patch files unless the user explicitly asks for that action after the freeze.

## Autonomy Awareness

Before proposing actions that change files, check the instruction file's Ask First
boundaries. If the proposed change crosses an Ask First boundary, flag it:
"This change touches [boundary]. Proceeding requires approval per Ask First rules."

## Authoring a Skill

For new or materially behaviour-changing goat-* skills, load `.goat-flow/skill-docs/skill-quality-testing/README.md`: `tdd-iteration.md` first, `adversarial-framing.md` for review classes, and `deployment.md` before release. Behaviour-neutral typo, link, or citation fixes need focused contract proof. Verify skill/reference stamps match `goat-flow --version` before publishing.

Before writing a skill, playbook, shared preamble or conventions file, instruction file, hook message, or README discovery row, load `.goat-flow/skill-docs/playbooks/writing-agent-facing-instructions.md`.
