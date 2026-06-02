---
goat-flow-reference-version: "1.9.1"
---
# Skill Conventions

Read this file on **full-depth** invocations only. The essential preamble
in `skill-preamble.md` is always loaded first.

---

## Learning Loop - Entry Formats

Bucket conventions (examples - actual bucket names are project-specific):
- Lessons: category files like `verification.md`, `workflow.md`, `coordination.md`
- Footguns: category files like `runtime.md`, `integration.md`, `data-stores.md`

Do not append to a monolithic log or directory README. Route entries to `.goat-flow/lessons/`, `.goat-flow/patterns/`, or `.goat-flow/footguns/`.

Use the standard entry formats:
```markdown
<!-- Lesson bucket -->
---
category: verification
last_reviewed: YYYY-MM-DD
---

## Lesson: [Title]
**Created:** YYYY-MM-DD
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
**Status:** active | **Created:** YYYY-MM-DD | **Evidence:** ACTUAL_MEASURED
**hallucination-risk:** high
**Symptoms:** [what breaks]
**Why it happens:** [root cause]
**Evidence:** `file` + semantic anchor (function name, unique string, or `(search: "pattern")`) - [what was found]
**Prevention:** [rule to prevent recurrence]
```

```markdown
# Successful Patterns

## Pattern: [Name]
**Context:** [when this approach works]
**Approach:** [what to do]
```

The `hallucination-risk` field is optional. Use it when an area is easy to misread from names alone, such as generated code, environment-specific config, or external API contracts.

## Adaptive Step 0

Before Step 0:

- Read the 2-3 most recent files in `.goat-flow/logs/sessions/` when the task overlaps recent work
- If a recent session log already covers the same area, prefer building on that context instead of re-deriving it

Then continue with the normal Step 0 flow:

Skills that gather context before acting follow this pattern:

1. Read the user's invocation for context already provided
2. For each Step 0 question: if the answer is already clear from context → **confirm**: "I see [answer]. Correct?" Otherwise → **ask**
3. If ALL questions are answered by the invocation → present a condensed confirmation and proceed
4. If the user says "skip Step 0" or provides a detailed brief → confirm understanding and proceed

**The gate rule:** If intent, target, and boundary are clear from the user's request, proceed without asking. Ask only at a genuine fork where the user's preference is not obvious. Bare invocation with no arguments = zero context = ask all structural questions and wait.

**Dispatcher invocation:** When a skill is invoked via `/goat`, Step 0 is the single entry gate. The dispatcher already announced the skill - Step 0 goes straight to its questions without re-announcing. There is no double-gate: one announcement from the dispatcher, one gate (Step 0) in the skill.

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
- Tick each task `- [x]` immediately when completed - not at the end of a batch, not later from memory, not in the closing protocol
- The checkbox is the single source of truth for progress
- If interrupted, compacted, or crashed, the checkboxes are how the next session knows where to resume
- If you completed a task 3 steps ago and forgot to tick it - go tick it NOW before continuing

On `/compact` with no active milestone file: write a session log to `.goat-flow/logs/sessions/` summarizing current state. Milestone files are the primary continuity mechanism; session logs are the fallback.

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

Write a session log entry for each completed milestone sequence.

### Plan Completion Protocol

When all milestones reach `complete` or `human-verification-pending`, the plan enters Phase 4. See goat-plan SKILL.md. The agent must:

1. Run the AI Verification Gate - confirm every task ticked, every exit criterion evidenced, every testing gate passed with proof from this session.
2. Present the Human Verification Gate - **BLOCKING GATE**. List all files changed, all milestones and their status, and evidence for each exit criterion. Wait for explicit human approval.
3. After human approval, plan files remain in `.goat-flow/tasks/` until the human archives or removes them.

Plan and milestone files are verification artifacts. Agents MUST NOT delete, archive, or include self-destruct instructions in them.

Use `.goat-flow/logs/sessions/` for session summaries. Compact at ~60% context.

Sub-agents: one objective, structured return, 5-call budget.

When blocked: ask one question with a recommended default.

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

When creating a new goat-* skill or materially hardening an existing one, consult
`.goat-flow/skill-playbooks/skill-quality-testing.md` (short index) and then load
the topical file(s) in `.goat-flow/skill-playbooks/skill-quality-testing/` named by
the index - `tdd-iteration.md` for TDD methodology (load first), `adversarial-framing.md`
for review-class skills, `deployment.md` for the deployment checklist. Together they
document the skill-authoring methodology: pressure-testing prompts against known failure
modes, recording Excuse/Reality rationalization tables from real incidents, and verifying
the skill's `goat-flow-skill-version` and reference docs' `goat-flow-reference-version`
match `AUDIT_VERSION` before publishing. Do not
add or materially revise a skill without running the pressure-test protocol they describe.
