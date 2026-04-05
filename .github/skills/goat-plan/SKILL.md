---
name: goat-plan
description: "4-phase planning workflow with complexity routing, kill criteria, and triangular tension analysis. Includes refactor planning mode for cross-file restructuring."
goat-flow-skill-version: "1.0.0"
---
# /goat-plan

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

Use before non-trivial implementation or cross-file restructuring.

**Mode routing:**
- Designing something new → **Plan mode** (Phases 1-4)
- Restructuring existing code → **Refactor planning mode** (Phases R1-R3)

**Complexity routing (plan mode):**
- **Hotfix** → Phase 1 brief only (3-5 lines), skip Phases 2-4
- **Small Feature** → Phase 1 compressed brief (Problem/Solution/Scope/Success all at once), skip Phases 2-3, 1-2 milestones max
- **Standard** → Phase 1 brief + Phase 4 milestones. SHOULD skip Phase 2-3 (only use if approach is genuinely uncertain).
- **System** → Full 4-phase process with human gates
- **Infrastructure** → Full process + rollback planning

**NOT this skill:**
- Diagnosing a bug → /goat-debug
- Reviewing an existing change → /goat-review
- Generating test instructions → /goat-test

## Step 0 - Where Are We?

**Continuation detection:** Before starting fresh, check for existing planning artifacts:
- `.goat-flow/tasks/todo.md`, `.goat-flow/tasks/handoff.md`
- `.goat-flow/tasks/1.0.0/*.md` (version-specific milestone files, e.g., `M24-install-and-readme.md`)
- `.goat-flow/tasks/_archived/roadmaps/` (prior version roadmaps and milestones)

Also check for staleness: `git log --since="2 weeks ago" -- [artifact]`. If the artifact hasn't been touched while code diverged, flag it.

If found: "I found [artifact] from [date]. Want to: (a) resume from here, (b) start fresh, (c) jump to a specific phase?"

**Concurrent work check:** Before planning, check if other branches touch the same area:
`git log --all --oneline --since='3 days ago' -- <target-files-or-dirs>`
If matches found: "Branch [name] modified [files] [N] days ago. Coordinate?"

**Structural questions (always ask or confirm):**
1. What are we doing? (new feature, refactor, infrastructure change)
2. If new: What complexity? (Hotfix / Small Feature / Standard / System / Infrastructure) → Plan mode
3. If restructure: What's the scope? (rename, extract, move, interface change) → Refactor mode

**Illustrative questions:**
5. What's the riskiest part? (e.g., rubric check changes, cross-reference renames, skill template updates, setup prompt changes, scanner refactors)
6. Any constraints? (e.g., must pass preflight, no broken cross-refs, shellcheck clean, no new `_v2`/`_backup` file variants)

**Escape hatch:** If the user says "I'll figure it out from the code" or provides minimal info, infer scope from `git diff`, named files, or the project structure and confirm before proceeding.

**Kill criteria (surface early):** "What would make us abandon this entirely?"
Even a vague answer ("if it takes more than a week" or "if it breaks the existing API")
helps frame the planning.

**Footgun check:** If `ai-docs/footguns/` or `.goat-flow/footguns/` exists, read entries mentioning the target area from both locations. If a match is found, present it: "This area has a known issue: [footgun]. Relevant?"

**Contradiction check:** If the user's stated complexity doesn't match the actual scope, flag it:
- "hotfix" but 5+ files affected → likely Standard or System
- "small feature" but crosses 3+ boundaries → likely System
- "quick test" but 20+ functions in target → warn scope is larger than implied
Surface the mismatch, suggest re-classification. Don't silently proceed.

**Before proceeding:** present what you know (feature, complexity, constraints, kill criteria) and what you still need. Wait for the user to confirm before entering Phase 1.

## Phase 1 - Feature Brief

Walk through each section ONE AT A TIME. Present one, wait for confirmation,
then present the next. Do NOT dump all 8 sections at once.

1. **Problem** - what's wrong or missing (1-2 sentences)
2. **Proposed solution** - high-level approach
3. **Risks / assumptions** - what could go wrong. Include kill criteria from Step 0.
4. **Rollback / feature flag plan** - how to undo if it fails in production
5. **Scope** - in/out with explicit exclusions
6. **Dependencies** - what blocks this, what this blocks
7. **Success criteria** - measurable outcomes
8. **Questions** - unknowns that need answers before proceeding

Ask the question whose answer could invalidate the approach FIRST.

**Glossary check:** Verify all domain terms in the brief are defined in `ai-docs/glossary.md`.
If new terms appear, add them: `| term | definition | canonical file | aliases |`

**BLOCKING GATE:** Present complete brief. "Approve, or adjust?"

## Phase 2 - Mob Elaboration

Generate 3-5 sharp questions about the brief - questions that could change
the design if answered differently.

**Do NOT answer your own questions.** Present them and STOP. Wait for the
user to answer. If the user says "answer them yourself," that's permission
to proceed - but the default is to wait.

After answers arrive, summarise each answer in one sentence and ask:
"Want me to drill deeper into any of these, or are we locked in?"
Repeat until the user says "locked in" or 3 rounds complete (whichever first).

**CHECKPOINT:** "Locked in. Proceeding to approach analysis."

## Phase 3 - Signal-Based Adaptive Orchestration (SBAO)

**SBAO agents: 2 with core trio + 1 fresh-context. Never split SKEPTIC/ANALYST/STRATEGIST into separate agents.**

**For Hotfix / Small Feature:** "SBAO launches 3 sub-agents - that's heavy for a small change. Skip to Phase 4, or run SBAO anyway?" Let the user decide.

Critique and improve the plan from Phase 1-2 using multiple perspectives.
The **core trio** (SKEPTIC / ANALYST / STRATEGIST) provides adversarial tension.

### Step 1 - Generate competing critiques

Launch 3 sub-agents in parallel. Each reads the codebase and the Phase 1-2 brief,
then produces plan improvement ideas.

**Sub-agent A (core trio - risk focus):**
> Review this plan as a SKEPTIC, ANALYST, and STRATEGIST. What could go wrong? What does the evidence say about cost/benefit? What's the fastest path to shipping? Propose specific improvements.

**Sub-agent B (core trio - alternatives focus):**
> Review this plan as a SKEPTIC, ANALYST, and STRATEGIST. Generate 2-3 alternative approaches. For each, evaluate risk, effort, speed to feedback, and reversibility. Propose specific improvements.

**Sub-agent C (fresh context - control group):**
> Without reading any prior discussion, review the codebase and these requirements: [brief]. What's your technical plan? What would you do differently from this existing plan? (This agent has NO context from Phases 1-2 - it's a litmus test for context drift.)

The main agent does NOT use the core trio - it already has existing context and
would just reinforce its own assumptions.

### Step 2 - Rank and compare

Once all sub-agents report back, the main agent:

1. **Rank** every improvement idea in a comparison table, rated out of 100 with reasons
2. **Summarise agreement** - where do all perspectives converge? (high-confidence decisions)
3. **Summarise disagreement** - where do they differ? (these need human judgment)
4. **Flag the control group delta** - did Sub-agent C (fresh context) find something the others missed? If yes, that's a context drift signal.

| Idea | Source | Score | Agree/Disagree | Why |
|------|--------|-------|----------------|-----|
| ... | Sub-A | 85 | All agree | ... |
| ... | Sub-C | 72 | C only | Context drift signal - fresh eyes found this |

Tag any decisions made with incomplete data as **Decision Debt** - to be revisited in later milestones.

### Step 3 - Clarify and synthesize

**STOP and ask the human clarifying questions** before creating the improved plan.
Focus questions on the disagreements and trade-offs from Step 2.

After answers, synthesize a prime plan that:
- **Keeps** the ideas the human approved
- **Drops** the ideas the human rejected
- **Decides** the open trade-offs with reasoned recommendations

**BLOCKING GATE:** "Here's the improved plan. Approve, adjust, or re-run SBAO with different sub-agent prompts?"

## Phase 4 - Milestones

Structure implementation as milestones using these archetypes (write to `.goat-flow/tasks/<version>/M<NN>-<slug>.md`):
1. **Prove It Works** - smallest slice that validates the approach
2. **Make It Real** - core functionality, happy path complete
3. **Make It Solid** - error handling, edge cases, tests
4. **Make It Shine** - performance, polish, documentation

Each milestone must have:
- Clear deliverable (what ships)
- Exit criteria (how to know it's done)
- Kill criteria (what would make us stop here)
- Depends on (which milestone must complete first)

After completing each milestone, re-read the NEXT milestone and rewrite it
based on what you learned. Plans evolve - the Phase 4 milestones written
before implementation are hypotheses, not commitments.

**BLOCKING GATE:** Present milestones. "Approve and start implementing?"

---

## Refactor Planning Mode (Phases R1-R3)

Activated when restructuring existing code: renames, extractions, moves, interface changes.

### Phase R1 - Blast Radius Analysis

Before changing anything:

1. **Declare scope:**
   - Files to change: [list]
   - Files that might break: [list]
   - Files out of scope: [list]

2. **Read both sides of every interface being changed:**
   If renaming: read every caller AND the definition.
   If moving: read every importer AND the module.
   If changing an API: read server AND all clients.

3. **Auto-detect scope:** `grep -rn 'OldName' --include='*.{ts,py,go,php,rs}' | wc -l`

4. **Check autonomy tiers:** Flag Ask First boundary crossings.

5. **Check footguns:** Read `ai-docs/footguns/` and `.goat-flow/footguns/` for affected area.

**BLOCKING GATE:** "This refactor touches [N] files across [M] boundaries. Blast radius: [assessment]. Proceed?"

### Phase R2 - Execution Sequence

Plan the execution order. Do NOT change everything at once.

**For renames:**
1. Change definition → grep verify → update consumers one-by-one → grep verify
2. Update documentation: `grep -rn 'OldName' --include='*.md'`

**For extractions:**
1. Create new module → move code → update imports → verify old location clean → update consumers

**For interface changes:**
1. Add new interface alongside old → migrate consumers → remove old → grep verify

**Checkpoints:** Run lint/test after EACH step.

### Phase R3 - Verification Plan

Comprehensive verification after all changes:

1. **Absence check:** Grep for every old name/path. Include: `*.md`, `*.json`, `*.yml`. Target: ZERO remaining.
2. **Import/reference check:** Build or typecheck.
3. **Doc cross-reference check:** Grep CLAUDE.md, AGENTS.md, docs/*.md for old paths.
4. **Test verification:** Run full test suite.
5. **Multi-agent vocabulary check:** No agent-specific vocabulary introduced in shared docs.

**BLOCKING GATE:** Present verification plan:
- Old references remaining: [target: 0]
- Build/typecheck: [expected: pass]
- Tests: [expected: pass]
- Doc references: [expected: updated]

"Approve plan and start executing?"

---

## Common Failure Modes

1. **Brief dump** - agent presents all 8 sections at once. Walk through one at a time.
2. **Self-answering elaboration** - agent answers its own Phase 2 questions. Wait for the user.
3. **Stale continuation** - agent resumes from a plan that no longer matches the code. Check staleness.

## Constraints

<!-- FIXED: Do not adapt these -->
- MUST walk through brief sections one at a time, not dump all at once (plan mode)
- MUST NOT answer your own elaboration questions (plan mode)
- MUST surface kill criteria in Phase 1, not defer to Phase 4
- MUST tag low-confidence decisions as Decision Debt
- MUST re-read next milestone after completing each one
- MUST read both sides of every interface before changing either (refactor mode)
- MUST grep for old names after EVERY rename, not just at end (refactor mode)
- MUST change one layer at a time, verify between layers (refactor mode)
- MUST check documentation references, not just source code (refactor mode)
- MUST flag Ask First boundary crossings (refactor mode)
- MUST NOT fabricate file paths or function names
- MUST audit sub-agent output if using multi-agent SBAO (see lessons entries on auditing delegated output)

## Output Format

### Feature Brief (Phase 1)

```markdown
# Feature Brief: [name]

## Problem
<!-- 1-2 sentences: what's wrong or missing -->

## Proposed Solution
<!-- high-level approach -->

## Risks & Kill Criteria
<!-- what could go wrong. Format: "If [measurable condition], then [action]" -->

## Rollback Plan
<!-- how to undo if it fails -->

## Scope
- **In:** [list]
- **Out:** [list]

## Dependencies
- **Blocks:** [list]
- **Blocked by:** [list]

## Success Criteria
<!-- 2-3 measurable outcomes -->

## Open Questions
<!-- unknowns that need answers before proceeding -->
```

### Comparison Table (Phase 3)

```markdown
| Criterion | Approach A | Approach B |
|-----------|-----------|-----------|
| Risk | ... | ... |
| Effort | ... | ... |
| Speed to feedback | ... | ... |
| Reversibility | ... | ... |

**Recommendation:** [approach] because [reasoning].
**Decision Debt:** [decision] - Confidence: LOW/MEDIUM - Revisit when: [trigger]
```

### Milestone Card (Phase 4)

```markdown
## M[N]: [name]
**Deliverable:** [what ships]
**Exit criteria:** [testable, binary]
**Kill criteria:** [what would make us stop here]
**Depends on:** [prerequisite]
### Tasks
- [ ] [task]
```

## Chains With

- /goat-debug - need to understand code before planning → investigate mode
- /goat-test - milestones/refactor needs verification plan
- /goat-review - plan or refactor result needs review before merge

**Handoff shape:** `{mode, feature_brief?, approach_chosen?, milestones?, blast_radius?, execution_sequence?, verification_plan?}`
