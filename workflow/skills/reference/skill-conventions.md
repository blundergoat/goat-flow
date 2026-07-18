---
goat-flow-reference-version: "1.14.0"
---
# Skill Conventions

Read this file on **full-depth** invocations only. The essential preamble
in `skill-preamble.md` is always loaded first.

---

## Learning Loop - Entry Formats

Use project-specific category buckets such as `verification.md` or `runtime.md`.

Route entries to `.goat-flow/learning-loop/lessons/`, `patterns/`, or `footguns/`; never append to a monolithic log or README.

Before adding, Extract / Consolidate / Skip: search the relevant INDEX and bucket; update the same root cause even when symptoms differ; create only for a distinct cause; skip non-decision-changing material.
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
**What happened:** [description]
**Evidence:** `file` + semantic anchor (function name, unique string, or `(search: "pattern")`) - [what was found] (required for code-specific lessons; omit for behavioral lessons)
**Prevention:** [rule to prevent recurrence]
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
**Symptoms:** [what breaks]
**Why it happens:** [root cause]
**Evidence:** `file` + semantic anchor (function name, unique string, or `(search: "pattern")`) - [what was found]
**Prevention:** [rule to prevent recurrence]
```

Evidence labels: `ACTUAL_MEASURED` = reproduced/measured locally; `OBSERVED` = direct code/config evidence; `EXTERNAL_REFERENCE` = cited real external incident with local applicability. Never use hypotheticals.

```markdown
# Successful Patterns

## Pattern: [Name]
**Context:** [when this approach works]
**Approach:** [what to do]
```

Use optional `hallucination-risk` when names alone can mislead, including generated code, environment config, or external contracts.

## Adaptive Step 0

Reuse 2-3 overlapping session logs instead of re-deriving settled context.

**The gate rule:** Infer answers already supplied. If intent, target, and boundary are clear, confirm once and proceed. Ask only at a genuine fork. A detailed brief or "skip Step 0" proceeds.

**Planning/interview boundary:** Default interview budget: one decision-bearing question at a time, no more than three per message or three rounds. Extend only when the user requests a deeper interview. When the budget is exhausted, present remaining choices with a recommended default and stop. Planning permission is not implementation permission. Do not implement unless the original directive authorized implementation or the user now selects it.

A clear implementation directive proceeds after required READ and SCOPE; do not manufacture interview questions. "Update the plan" means write the plan, not execute it: a plan-only request stops at the handoff while explicit implementation authorizes execution.

**Dispatcher invocation:** `/goat` announces the route; Step 0 asks any remaining questions without re-announcing. One dispatch, one intake gate.

## Contradiction Check

If the user's stated complexity doesn't match the actual scope, flag it:
- "hotfix" but 5+ files affected → likely Standard or System
- "small feature" but crosses 3+ boundaries → likely System
- "quick test" but 20+ functions in target → warn scope is larger than implied

Surface the mismatch, suggest re-classification. Don't silently proceed.

## Stuck Protocol

If 3 consecutive file reads produce no new signal relevant to the current question:
1. Present what you have so far
2. State what you were looking for and didn't find
3. Ask the human to redirect, narrow scope, or close

**Sub-agent mode:** When invoked as a sub-agent (forked context), most BLOCKING GATEs become CHECKPOINTs (logged, not paused). Step 0 proceeds with auto-detected scope. **Exception:** safety-critical gates (goat-debug D2→D3 "human decides before fixing", goat-security final report) MUST remain blocking even in sub-agent mode - these exist to prevent auto-fixing without human review.

## Task Tracking

When working from a plan or milestone file:
- Tick each task `- [x]` immediately, never at batch end or closeout.
- Checkboxes are the recovery source after interruption or compaction.
- If a completed task was missed, tick it before continuing.

On `/compact` with no active milestone file: write a session log to `.goat-flow/logs/sessions/` summarizing current state. Milestone files are the primary continuity mechanism; session logs are the fallback.

Handoff receipts: read `.goat-flow/logs/sessions/README.md`; redact before writing.

## Durable Artifact Redaction

For session, handoff, critique, review, quality, security, or export text, use the version-compatible CLI required by `skill-preamble.md` and send the in-memory draft via stdin to `goat-flow redact --output <destination>`; only redacted output reaches disk. Never stage raw text. Redact before disk, not after.

Example after the version check: `goat-flow redact --output .goat-flow/logs/sessions/handoff.md`, then paste stdin and send EOF.

The hash-only `redactEvidenceText` evidence API is not a readable scrubber. This reduces common credential leakage; it is not perfect DLP and does not replace secret review.

## Presenting Findings

When summarising tasks, findings, or recommendations for user review, use this format per item:

- **Summary:** what's affected (one line)
- **Problem:** what's wrong (one line)
- **Solution:** what to do (one line)

## Milestone Retrospective (goat-plan)

**Status vocabulary:** `not-started | in-progress | testing-gate | blocked | abandoned | human-verification-pending | complete`

When a milestone completes, run the per-milestone AI verification gate then the human verification gate (BLOCKING - see goat-plan Phase 3). After human approval:

1. Record what was learned.
2. Tick validated assumptions and flag invalidated ones.
3. Re-read the next milestone and update it if assumptions, scope, or exit criteria changed.
4. Update the completed milestone status to `complete`; next milestone to `in-progress`.

Do not write a session log for every completed milestone sequence. Session logs are optional continuity notes: write one when `/compact` fires without an active milestone file, or when the human explicitly asks for a session summary.

### Plan Completion Protocol

When all milestones reach `complete` or `human-verification-pending`, the plan enters Phase 4. See goat-plan SKILL.md. The agent must:

1. Run the AI Verification Gate - confirm every task ticked, every exit criterion evidenced, every testing gate passed with proof from this session.
2. Present the Human Verification Gate - **BLOCKING GATE**. List all files changed, all milestones and their status, and evidence for each exit criterion. Wait for explicit human approval.
3. After human approval, plan files remain in `.goat-flow/plans/` until the human archives or removes them.

Plan and milestone files are verification artifacts. Agents MUST NOT delete, archive, or include self-destruct instructions in them.

Use `.goat-flow/logs/sessions/` for session summaries. Compact at ~60% context or after 15+ turns.

Sub-agents: one objective, structured return, 5-call budget.

When blocked: ask one question with a recommended default.

## Orchestration Admission

Before any optional repeated, parallel, delegated, review, QA, or critique pass, record:

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

A repeated pass must name a new failure class, independence boundary, or explicit user request. Admit it when the change crosses a blast-radius threshold, failed verification needs targeted evidence, an independent context adds evidence, security or correctness risk outweighs cost, or the user requested it.

Same-context reassurance with no new evidence is denied. Do not parallelize tasks sharing files unless the merge boundary and conflict owner are named. Subagents keep one objective, structured return, 5-call budget.

Required skill phases and verification are pre-admitted; estimated cost cannot degrade or block them. Explicit `goat-critique` stays full delegated mode and preserves existing consent. This is rough admission control, not token accounting or a hard failure based only on estimated cost.

## Recovery

When a skill fails mid-execution (context limit, sub-agent dies, tool error):

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

For new or materially hardened goat-* skills, load `.goat-flow/skill-docs/skill-quality-testing/README.md`, then its topical files: `tdd-iteration.md` first, `adversarial-framing.md` for review-class skills, and `deployment.md` before release. Run the pressure tests and verify skill/reference versions match `AUDIT_VERSION` before publishing.
