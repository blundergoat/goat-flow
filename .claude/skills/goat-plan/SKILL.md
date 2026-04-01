---
name: goat-plan
description: "4-phase planning workflow with complexity routing, kill criteria, and triangular tension analysis. Includes refactor planning mode for cross-file restructuring."
goat-flow-skill-version: "0.9.4"
---
# /goat-plan

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

Use before non-trivial implementation or cross-file restructuring.

**Mode routing:**
- Designing something new → **Plan mode** (Phases 1-4)
- Restructuring existing code → **Refactor planning mode** (Phases R1-R3)

**Complexity routing (plan mode):**
- **Hotfix** → Phase 1 brief only (3-5 lines), skip Phases 2-4
- **Standard** → Phase 1 brief + Phase 4 milestones. MAY skip Phase 2-3.
- **System** → Full 4-phase process with human gates
- **Infrastructure** → Full process + rollback planning

**NOT this skill:**
- Diagnosing a bug → /goat-debug
- Reviewing an existing change → /goat-review
- Generating test instructions → /goat-test

## Step 0 - Where Are We?

**Continuation detection:** Check for existing planning artifacts:
- `requirements-*.md`, `TODO_*_prime.md`
- `tasks/improvement-plan.md`, `tasks/roadmaps/*.md`

Check staleness: `git log --since="2 weeks ago" -- [artifact]`.

**Concurrent work check:** `git log --all --oneline --since='3 days ago' -- <target-files-or-dirs>`

**Footgun check:** If `docs/footguns/` or `.goat-flow/footguns/` exists, read entries mentioning the target area from both locations. If a match is found, present it: "This area has a known issue: [footgun]. Relevant?"

**Structural questions (always ask or confirm):**
1. What are we doing? (new feature, refactor, infrastructure change)
2. If new: What complexity? (Hotfix / Standard / System / Infrastructure) → Plan mode
3. If restructure: What's the scope? (rename, extract, move, interface change) → Refactor mode

**Kill criteria (surface early):** "What would make us abandon this entirely?"

**Before proceeding:** present mode, scope, constraints, kill criteria. Wait for confirmation.

---

## Plan Mode (Phases 1-4)

### Phase 1 - Feature Brief

Walk through each section ONE AT A TIME. Do NOT dump all at once.

1. **Problem** - what's wrong or missing
2. **Proposed solution** - high-level approach
3. **Risks / assumptions** - include kill criteria from Step 0
4. **Rollback / feature flag plan**
5. **Scope** - in/out with explicit exclusions
6. **Dependencies** - what blocks this, what this blocks
7. **Success criteria** - measurable outcomes
8. **Questions** - ask the question that could invalidate the approach FIRST

**BLOCKING GATE:** "Approve brief, or adjust?"

### Phase 2 - Mob Elaboration

Generate 3-5 sharp questions. **Do NOT answer your own questions.** Wait for the user. Repeat until "locked in" or 3 rounds.

### Phase 3 - Triangular Tension Analysis

2-3 competing approaches evaluated from:
- **SKEPTIC:** What could go wrong? What are we assuming?
- **ANALYST:** Cost/benefit? Measurable trade-offs?
- **STRATEGIST:** Path to shipping? Fastest way to learn?

Present comparison table. Tag incomplete-data decisions as **Decision Debt**.

**BLOCKING GATE:** "Recommended approach: [A]. Proceed to milestones?"

### Phase 4 - Milestones

1. **Prove It Works** - smallest validating slice
2. **Make It Real** - core functionality, happy path
3. **Make It Solid** - error handling, edge cases, tests
4. **Make It Shine** - performance, polish, documentation

Each milestone: deliverable, exit criteria, kill criteria, depends on.

After each milestone, re-read and rewrite the NEXT milestone based on learnings.

**BLOCKING GATE:** "Approve and start implementing?"

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

5. **Check footguns:** Read `docs/footguns/` and `.goat-flow/footguns/` for affected area.

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

## Constraints

Conversational: present findings by severity tier, pause between tiers. Let the human drill in.

- MUST walk through brief sections one at a time (plan mode)
- MUST NOT answer your own elaboration questions (plan mode)
- MUST surface kill criteria in Phase 1
- MUST tag low-confidence decisions as Decision Debt
- MUST re-read next milestone after completing each one
- MUST read both sides of every interface before changing either (refactor mode)
- MUST grep for old names after EVERY rename, not just at end (refactor mode)
- MUST change one layer at a time, verify between layers (refactor mode)
- MUST check documentation references, not just source code (refactor mode)
- MUST flag Ask First boundary crossings (refactor mode)
- MUST NOT fabricate file paths or function names

## Output Format

See mode-specific phases above for output structure. All modes produce findings with `file:line` evidence tagged OBSERVED/INFERRED.

## Chains With

- /goat-debug - need to understand code before planning → investigate mode
- /goat-test - milestones/refactor needs verification plan
- /goat-review - plan or refactor result needs review before merge

**Handoff shape:** `{mode, feature_brief?, approach_chosen?, milestones?, blast_radius?, execution_sequence?, verification_plan?}`
