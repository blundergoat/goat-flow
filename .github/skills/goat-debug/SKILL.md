---
name: goat-debug
description: "Diagnosis-first debugging with hypothesis tracking and recurrence checks. Includes investigate mode for deep codebase exploration and onboarding."
goat-flow-skill-version: "1.0.0"
---
# /goat-debug

## Shared Conventions

### Severity & Evidence
- **Severity order:** SECURITY > CORRECTNESS > INTEGRATION > PERFORMANCE > STYLE. Order findings by severity, not by file or discovery order.
- **Evidence:** Every finding needs `file:line`. Tag as OBSERVED (directly verified in code) or INFERRED (deduced - state what direct evidence is missing). Before presenting findings, re-read each cited `file:line` to confirm accuracy. MUST NOT fabricate file paths, function names, or behaviour.

### Human Gates
- **BLOCKING GATE** - agent MUST stop and wait for human decision. Used for: scope approval, phase transitions, final output review. Do NOT auto-advance.
- **CHECKPOINT** - agent presents status and continues unless interrupted. Used for: progress reports, intermediate findings. Format: "Phase N complete. [summary]. Continuing to Phase N+1."

### Adaptive Step 0
1. Read the user's invocation for context already provided
2. For each Step 0 question: if answer is clear from context → **confirm** ("I see [answer]. Correct?"). Otherwise → **ask**
3. If ALL questions answered by invocation → condensed confirmation, proceed
4. If user says "skip Step 0" → confirm understanding, proceed

**Gate rule:** Step 0 MUST end with the agent presenting its understanding and waiting for the user before Phase 1. Auto-detect pre-fills context - it does not replace confirmation. Bare invocation = zero context = ask all structural questions and wait.

### Stuck Protocol
If 3 consecutive reads produce no new signal: (1) present what you have so far, (2) state what you were looking for and didn't find, (3) ask to redirect, narrow scope, or close.

### Ceremony Level
| Complexity | Ceremony |
|------------|----------|
| Hotfix / Small Feature | Skip: closing ceremony, flush rule, footgun annotations, goat-plan Phases 2-3 |
| Standard | Full phases, gates at major decisions |
| System / Infrastructure | Full phases + cross-boundary verification + rollback planning |

**Sub-agent mode:** GATEs become CHECKPOINTs automatically. Step 0 proceeds with auto-detected scope.

### Footgun Fast-Path
If Step 0 footgun check matches a known trap: (1) surface match immediately, (2) offer mitigation path from the entry, (3) still require READ + VERIFY on actual files - footguns are incident records, not executable specs, (4) do NOT skip to implementation on a match alone.

### Flush Protocol
If 10+ tool calls pass without a gate/checkpoint (skip for Hotfix/Small Feature): (1) write 3-sentence status to `.goat-flow/tasks/handoff.md` (what, where, next), (2) if working from a plan/milestone file: tick all completed checkboxes NOW before continuing, (3) ask: continue, compact, or redirect? Counter resets at every BLOCKING GATE, CHECKPOINT, or human message. Handoff file is transient - do not commit.

### Learning Loop
After completing the skill, check if this run uncovered anything worth logging:
- Behavioural mistake → add `## Lesson:` or `## Pattern:` entry to relevant category bucket in `ai-docs/lessons/` or `.goat-flow/lessons/`
- Architectural trap with `file:line` evidence → add `## Footgun:` entry to relevant category bucket in `ai-docs/footguns/` or `.goat-flow/footguns/`
- Route team-wide entries to `ai-docs/`; session-only entries to `.goat-flow/`
- Match entry format to existing entries in the target bucket file. Do not append to a monolithic log or directory README.

### Recovery
When a skill fails mid-execution (context limit, sub-agent dies, tool error):
- Partial completion → identify last completed step (last `[x]` checkbox), resume from next
- Missing artifacts → return to the step that generates them, re-execute
- User wants restart → archive current output to handoff, re-run from Step 0
- User wants to skip → document skip reason in output, proceed to closing
- Sub-agent/autonomous mode → write `.goat-flow/tasks/handoff.md` with enough context to resume

### Working Memory
For tasks exceeding 5 turns: maintain state in `.goat-flow/tasks/todo.md`. If interrupted or compacted, write `.goat-flow/tasks/handoff.md`.

### Autonomy Awareness
Before proposing actions that change files, check the instruction file's Ask First boundaries. If the proposed change crosses a boundary, flag it: "This change touches [boundary]. Proceeding requires approval per Ask First rules."

### Closing Protocol
1. If incomplete → write `.goat-flow/tasks/handoff.md` (Date, Status, Current State, Key Decisions, Errors & Corrections, Learnings, Known Risks, Next Step, Context Files)
2. Check Learning Loop for anything worth logging
3. Write session log to `.goat-flow/logs/sessions/YYYY-MM-DD-slug.md` (what happened, files changed, decisions, learnings)
4. Suggest most relevant next skill (see Chains With)

## When to Use

Use when diagnosing a bug, understanding unfamiliar code, or onboarding to a new project.

**Mode routing:**
- Has a specific bug/symptom → **Diagnose mode** (Phases D1-D4)
- Exploring unfamiliar code, no bug → **Investigate mode** (Phases I1-I3)
- New to this project, need to set up → **Onboard mode** (Phases I1-I3 + O1-O2)

**If you want to "just try something" before tracing the code path, STOP.**
That's the failure mode this skill exists to prevent.

**NOT this skill:**
- Reviewing changes for quality → /goat-review
- Generating test instructions → /goat-test
- Planning a new feature → /goat-plan

## Step 0 - Gather Context

**Structural questions (always ask or confirm):**
1. What's the goal? (diagnose a bug, explore an area, onboard to the project)
2. If bug: What's the symptom? (error message, unexpected behaviour, test failure)
3. If explore: What area? How deep? (surface scan / full trace)

**Illustrative questions:**
4. Which area? (e.g., scanner rubric checks, fact extractors, setup prompt generation, dashboard server, CLI entry point, skill templates, bash maintenance scripts, cross-reference validation)
5. What have you already tried? (so I don't repeat dead ends)
6. How urgent? Default: 10 turns. After that, present what you have even if incomplete.

**Mode selection:**
- Bug/symptom/error/crash → Diagnose mode
- Explore/understand/how does/new to → Investigate mode
- Onboard/new project/set up instructions → Onboard mode

**Escape hatch:** If the user says "I'll figure it out from the code" or provides minimal info, proceed with what you have - auto-detect from error output, `git diff`, or named files.

**Auto-detect:** Read the error message or test output if provided inline.
If the user said `/goat-debug the test in auth.test.ts fails with TypeError`,
confirm: "Symptom: TypeError in auth.test.ts. I'll start with that file. Correct?"

**Footgun check:** If `ai-docs/footguns/` or `.goat-flow/footguns/` exists, read entries mentioning the target area from both locations. Also check `ai-docs/lessons/` and `.goat-flow/lessons/` for recurrence. If a match is found, present it: "This area has a known issue: [footgun]. Relevant?"

**Contradiction check:** If the user's stated complexity doesn't match the actual scope, flag it:
- "hotfix" but 5+ files affected → likely Standard or System
- "small feature" but crosses 3+ boundaries → likely System
- "quick test" but 20+ functions in target → warn scope is larger than implied
Surface the mismatch, suggest re-classification. Don't silently proceed.

**Before proceeding:** present what you know, the selected mode, and what you still need. Wait for user to confirm.

---

## Diagnose Mode (Phases D1-D4)

### Phase D1 - Investigate (no fixes)

(Recurrence check already done in Step 0 - do not repeat here.)

**HYPOTHESIS TRACKING:** After initial read of the primary file,
write 2-3 hypotheses. Hypotheses MUST span at least 2 categories:
- Data (wrong input, missing field, encoding)
- Logic (off-by-one, wrong condition, fence-post error)
- Timing (race condition, async ordering, timeout)
- Environment (config, dependency version, platform difference)
- Configuration (wrong setting, missing env var, stale cache)

Include at least one boundary/counting hypothesis if the bug involves loops,
indices, arrays, or pagination.

After tracing, mark each: CONFIRMED / ELIMINATED / UNRESOLVED with evidence.

*Example:*
| 1 | Token expiry uses `<` instead of `<=` | Logic | CONFIRMED | `auth.ts:47` |
| 2 | Session store timing out under load | Timing | ELIMINATED | `config/redis.ts:12` shows 30s TTL, not related |

**CAN'T REPRODUCE?** If you can't reproduce after 5 file reads:
1. Log what you checked and what you expected to find
2. Suggest logging additions at suspected locations
3. Ask the user for more reproduction context

Generate multiple hypotheses internally before committing to a trace path.

### Phase D2 - Diagnosis

Present findings using the Output Format template below:
- Root cause with **confidence level**: HIGH (reproduced) / MEDIUM (traced to cause) / LOW (inferred from patterns)
- Hypothesis table with status
- Reproduction steps: "1, 2, 3 → expected: [X], actual: [Y]"

**Confidence floor:** Do not advance to Phase D3 if ALL findings are LOW confidence.
Return to Phase D1 for deeper investigation, or present partial findings and ask
the user whether to proceed or dig deeper.

**BLOCKING GATE:** Present diagnosis. Offer:
(a) investigate deeper
(b) propose a fix plan (→ Phase D3)
(c) this matches a known issue - close
(d) switch to investigate mode for deeper exploration
(e) just report findings - don't fix (stop here)

If the user's original intent was "just diagnose" or "investigate" (no implementation verbs), default to (e).

### Phase D3 - Fix Plan

Only if human approved. Propose a fix plan (not the fix itself):
- **What changes:** specific files and functions
- **Blast radius:** what else could break
- **Architecture check:** verify fix doesn't violate constraints in `ai-docs/architecture.md`
- **Verification:** how to confirm the fix worked (specific test or command)

**Verification commands:**
```bash
npm test && npx tsc --noEmit && bash scripts/preflight-checks.sh
```

"Should I implement this fix?"

If yes → implement. Then auto-transition to Phase D4 (skip redundant "confirm fix applied" when the agent did the work).

### Phase D4 - Post-Fix Verification

If a fix was applied (by agent or human):
1. Run the specific verification from Phase D3
2. Check for regressions in related areas
3. Grep for the old pattern if anything was renamed

**Two-corrections rule:** If you've been corrected twice on the same approach,
stop and rewind. Present what you've tried and ask the human for a different angle.

**CHECKPOINT:** "Fix verified: [pass/fail]. Regressions: [none/found]. Learning loop: [entry needed/none]."

---

## Investigate Mode (Phases I1-I3)

### Phase I1 - Scope & Plan

Declare before reading deeply:
- **In scope:** [files, directories, or patterns]
- **Out of scope:** [what we're NOT investigating]
- **Read estimate:** How many files do you expect to read? (If you exceed 3x this estimate, pause and re-scope.)

Read `ai-docs/footguns/` and `.goat-flow/footguns/` for entries mentioning the target area.

**BLOCKING GATE:** "I'll investigate [scope] reading up to [N] files. Adjust?"

### Phase I2 - Read (Progressive Depth)

Read in layers:
1. **Entry points** - where execution starts
2. **Critical path** - main flow through the area
3. **Supporting files** - helpers, utilities, configs

For each file, log: role, connections, evidence tag (OBSERVED / INFERRED).

**CHECKPOINT:** If reads exceed 3x your initial estimate: "[N] files read, estimated [M]. Re-scope or continue?"

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

**Glossary:** Read `ai-docs/glossary.md` for project terminology. If new terms are discovered during onboarding, add them.

**Instruction Drafting (if requested):** Present all content inline BEFORE writing files. Source of truth is code, not docs. MUST NOT include aspirational content.

**BLOCKING GATE:** "Write these files, or adjust first?"

---

## Common Failure Modes

1. **"Just try something"** - agent patches without understanding. Phase D1 prevents this.
2. **Single-track hypothesis** - 3 variations of the same theory. The 2-category rule prevents this.
3. **Premature fix** - agent proposes a fix with LOW confidence. The confidence floor prevents this.

## Constraints

Conversational: present findings by severity tier, pause between tiers. Let the human drill in.

<!-- FIXED: Do not adapt these -->
- MUST write hypotheses AFTER initial read of the primary file (diagnose mode)
- MUST include at least 2 hypothesis categories (diagnose mode)
- MUST NOT propose fixes until human reviews diagnosis (D2→D3 gate)
- MUST declare scope before deep reading (investigate mode)
- MUST tag evidence as OBSERVED or INFERRED (investigate mode)
- MUST include "What I Didn't Read" in every investigation report
- MUST pause if reads exceed 3x initial estimate - re-scope before continuing (investigate mode)
- MUST check recurrence against footguns + lessons (diagnose mode)
- MUST NOT fabricate file paths or function names
- MUST verify fix doesn't violate architecture constraints

## Output Format

```markdown
## TL;DR
<!-- 1 sentence: root cause + confidence level -->

## Hypotheses
| # | Hypothesis | Category | Status | Evidence |
|---|-----------|----------|--------|----------|
| 1 | [description] | data/logic/timing/env/config | CONFIRMED/ELIMINATED/UNRESOLVED | `file:line` |

## Root Cause
**Confidence:** HIGH (reproduced) | MEDIUM (traced) | LOW (inferred)
**Location:** `file:line`
**Description:** [what's wrong and why]

## Reproduction Steps
1. [step]
2. Expected: [X] - Actual: [Y]

## Fix Plan
<!-- Only if human approved Phase D3 -->
- What changes: [description]
- Blast radius: [what else could break]
- Verification: [how to confirm the fix worked]
```

## Chains With

- /goat-test - bug fixed, need verification plan
- /goat-review - fix or investigation ready, needs review
- /goat-plan - investigation reveals need for structured planning
- /goat-security - investigation reveals security concerns

**Handoff shape:** `{mode, bug_description?, root_cause?, confidence?, scope?, components?, risks?, open_questions?}`
