---
name: goat-debug
description: "Diagnosis-first debugging with hypothesis tracking and recurrence checks. Includes investigate mode for deep codebase exploration and onboarding."
goat-flow-skill-version: "0.9.4"
---
# /goat-debug

## Shared Conventions

- **Severity:** SECURITY > CORRECTNESS > INTEGRATION > PERFORMANCE > STYLE
- **Evidence:** Every finding needs `file:line`. Tag as OBSERVED (verified) or INFERRED (state what's missing). MUST NOT fabricate.
- **Gates:** BLOCKING GATE = must stop for human. CHECKPOINT = report status, continue unless interrupted.
- **Adaptive Step 0:** If context already provided, confirm it - don't re-ask. Bare invocation with no arguments = zero context = ask structural questions and WAIT. Auto-detect pre-fills - it does not replace confirmation.
- **Stuck:** 3 reads with no signal → present what you have, ask to redirect.
- **Flush:** 10+ tool calls without a gate/checkpoint → write 3-sentence status to `.goat-flow/tasks/handoff.md`, ask to continue/compact/redirect.
- **Learning Loop:** Behavioural mistake → create a new markdown entry in `ai/lessons/` or `.goat-flow/lessons/`. Architectural trap → create a new markdown entry in `docs/footguns/` or `.goat-flow/footguns/`.
- **Closing:** FIRST: if `.goat-flow/logs/sessions/` exists, write session summary there (date, skill, complexity, turns, incidents). THEN: if incomplete → write `.goat-flow/tasks/handoff.md`. Check learning loop. Suggest next skill.

## When to Use

Use when diagnosing a bug, understanding unfamiliar code, or onboarding to a new project.

**Mode routing:**
- Has a specific bug/symptom → **Diagnose mode** (Phases D1-D4)
- Exploring unfamiliar code, no bug → **Investigate mode** (Phases I1-I3)
- New to this project, need to set up → **Onboard mode** (Phases I1-I3 + O1-O2)

**NOT this skill:**
- Reviewing changes for quality → /goat-review
- Generating test instructions → /goat-test
- Planning a new feature → /goat-plan

## Step 0 - Gather Context

**Structural questions (always ask or confirm):**
1. What's the goal? (diagnose a bug, explore an area, onboard to the project)
2. If bug: What's the symptom? (error message, unexpected behaviour, test failure)
3. If explore: What area? How deep? (surface scan / full trace)

**Mode selection:**
- Bug/symptom/error/crash → Diagnose mode
- Explore/understand/how does/new to → Investigate mode
- Onboard/new project/set up instructions → Onboard mode

**Auto-detect:** Read the error message or target if provided inline. Confirm before proceeding.

**Footgun check:** If `docs/footguns/` or `.goat-flow/footguns/` exists, read entries mentioning the target area from both locations. If a match is found, present it: "This area has a known issue: [footgun]. Relevant?"

**Before proceeding:** present what you know, the selected mode, and what you still need. Wait for user to confirm.

---

## Diagnose Mode (Phases D1-D4)

### Phase D1 - Investigate (no fixes)

**RECURRENCE CHECK:** Before investigating, search `docs/footguns/`, `.goat-flow/footguns/`, `ai/lessons/`, `.goat-flow/lessons/`, and `ai/evals/` for the symptom, file path, or module name.

If a match is found, present it first: "This area has a known issue: [footgun]. Is this the same problem?"

**HYPOTHESIS TRACKING:** After reading Step 0 context but BEFORE tracing code, write 2-3 hypotheses. Hypotheses MUST span at least 2 categories:
- Data (wrong input, missing field, encoding)
- Logic (off-by-one, wrong condition, fence-post error)
- Timing (race condition, async ordering, timeout)
- Environment (config, dependency version, platform difference)
- Configuration (wrong setting, missing env var, stale cache)

Include at least one boundary/counting hypothesis if the bug involves loops, indices, arrays, or pagination.

After tracing, mark each: CONFIRMED / ELIMINATED / UNRESOLVED with evidence.

**CAN'T REPRODUCE?** After 5 file reads without reproduction: log what you checked, suggest logging additions, ask for more context.

### Phase D2 - Diagnosis

Present findings:
- Root cause with **confidence level**: HIGH (reproduced) / MEDIUM (traced) / LOW (inferred)
- Hypothesis table with status
- Reproduction steps

**Confidence floor:** Do not advance to Phase D3 if ALL findings are LOW confidence.

**BLOCKING GATE:** Present diagnosis. Offer:
(a) investigate deeper
(b) propose a fix plan
(c) this matches a known issue - close
(d) switch to investigate mode for deeper exploration

### Phase D3 - Fix Plan

Only if human approved. Propose:
- **What changes:** specific files and functions
- **Blast radius:** what else could break
- **Verification:** how to confirm the fix worked

If approved → implement, then Phase D4.

### Phase D4 - Post-Fix Verification

1. Run the specific verification from Phase D3
2. Check for regressions in related areas
3. Grep for old pattern if anything was renamed

**Two-corrections rule:** Corrected twice on the same approach → stop and rewind.

---

## Investigate Mode (Phases I1-I3)

### Phase I1 - Scope & Plan

Declare before reading deeply:
- **In scope:** [files, directories, or patterns]
- **Out of scope:** [what we're NOT investigating]
- **Read budget:** Default 8 files. Narrow: 5. Broad: 12.

Read `docs/footguns/` and `.goat-flow/footguns/` for entries mentioning the target area.

**BLOCKING GATE:** "I'll investigate [scope] reading up to [N] files. Adjust?"

### Phase I2 - Read (Progressive Depth)

Read in layers:
1. **Entry points** - where execution starts
2. **Critical path** - main flow through the area
3. **Supporting files** - helpers, utilities, configs

For each file, log: role, connections, evidence tag (OBSERVED / INFERRED).

**CHECKPOINT:** At read budget: "[N] files read. Key findings: [summary]. Continue or present?"

### Phase I3 - Report

Produce investigation report. Required sections:
- **What I Didn't Read** - REQUIRED. List skipped files/areas with reasons.
- **Current vs Expected State** - what IS vs what SHOULD BE.
- **Evidence tags** - OBSERVED for verified, INFERRED for deductions (state what's missing).

**BLOCKING GATE:** Present report. Offer:
(a) go deeper into a specific area
(b) check a boundary I didn't cross
(c) switch to diagnose mode (found a bug)
(d) close

---

## Onboard Mode (I1-I3 + O1-O2)

Activated when Step 0 goal = "onboarding" / "new to this project."

Runs Investigate mode (I1-I3) plus:

### Phase O1 - Stack Detection (before I1)
1. Languages: scan file extensions, read build configs
2. Frameworks: identify from dependencies
3. Build/test/lint: extract commands from config files
4. Directory structure: map top-level organization

Present: "This project uses [languages] with [frameworks]. Build: [cmd], Test: [cmd]. Correct?"

### Phase O2 - Glossary & Instruction Drafting (after I3)

**Glossary:** If `docs/glossary.md` exists, read it. If not, build one from codebase.

**Instruction Drafting (if requested):** Present all content inline BEFORE writing files. Source of truth is code, not docs. MUST NOT include aspirational content.

**BLOCKING GATE:** "Write these files, or adjust first?"

---

## Constraints

Conversational: present findings by severity tier, pause between tiers. Let the human drill in.

- MUST write hypotheses BEFORE tracing code (diagnose mode)
- MUST include at least 2 hypothesis categories (diagnose mode)
- MUST NOT propose fixes until human reviews diagnosis (D2→D3 gate)
- MUST declare scope before deep reading (investigate mode)
- MUST tag evidence as OBSERVED or INFERRED (investigate mode)
- MUST include "What I Didn't Read" in every investigation report
- MUST respect read budget - pause at limit (investigate mode)
- MUST check recurrence against footguns + lessons (diagnose mode)
- MUST NOT fabricate file paths or function names

## Output Format

See mode-specific phases above for output structure. All modes produce findings with `file:line` evidence tagged OBSERVED/INFERRED.

## Chains With

- /goat-test - bug fixed, need verification plan
- /goat-review - fix or investigation ready, needs review
- /goat-plan - investigation reveals need for structured planning
- /goat-security - investigation reveals security concerns

**Handoff shape:** `{mode, bug_description?, root_cause?, confidence?, scope?, components?, risks?, open_questions?}`
