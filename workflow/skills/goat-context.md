---
name: goat-context
description: "Session resumption with multi-source context reconstruction, diff sampling, branch divergence analysis, and next-action recommendation."
goat-flow-skill-version: "0.7.0"
---
# /goat-context

> Follows [shared-preamble.md](shared-preamble.md) for severity scale, evidence standard, gates, and learning loop.
> Uses the [Resume Report](output-skeletons.md#resume-report) output skeleton.

## When to Use

Use at the start of a session after a break, after context compaction, or
when returning to work you started earlier.

**NOT this skill:**
- Planning new work → /goat-plan
- Investigating unfamiliar code → /goat-investigate
- Debugging a specific issue → /goat-debug

## No Step 0

This skill IS the context gathering. Do not ask questions — read evidence
and present findings.

## Phase 1 — Reconstruct State

Check these sources in order (skip sources that don't exist):

1. **Handoff notes:** `tasks/handoff.md` — most structured context if it exists
2. **Task list:** `tasks/todo.md` — in-progress items
3. **Planning artifacts:**
   <!-- ADAPT: Add your project's planning file locations -->
   - `tasks/improvement-plan.md`
   - `tasks/roadmaps/*.md`
   - `tasks/roadmaps/milestones/*.md`
4. **Git log:** `git log --oneline -10` — recent activity
5. **Branch divergence:**
   - `git log --oneline main..HEAD` — commits ahead of main
   - `git rev-list --count HEAD..main` — commits behind main
   - Report: "Branch is [N] commits ahead, [M] behind main"
6. **Changed files:** `git diff --stat` — what's modified
7. **Diff sampling:** For the 3 most recently modified files with <50 changed lines,
   read the actual diff: `git diff -- <file> | head -30`
8. **Stashed work:** `git stash list` — any stashed changes

**Handoff drift detection:** If `tasks/handoff.md` describes work that
contradicts recent git history (e.g., handoff says "working on auth" but
last 5 commits are CSS), flag the discrepancy.

If none of these sources exist: "No prior session context found. What are
you working on?"

## Phase 2 — Load Project Context

Quick-read for orientation:
- Instruction file (CLAUDE.md/AGENTS.md) — already in context at session start
- `docs/footguns.md` — known traps in areas touched by recent changes
- Active milestone file if one exists

**CHECKPOINT:** "Context loaded. Proceeding to assessment."

## Phase 3 — Assess Status

Based on reconstructed state, determine:
- **What was being worked on** (from handoff/git/task files)
- **Current status** (complete / partial / blocked / stale)
- **What changed since last session** (from diff sampling, not just filenames)
- **Branch health** (ahead/behind main, merge conflicts likely?)

## Phase 4 — Recommend

Present the Resume Report using the output skeleton.

**BLOCKING GATE:** Present recommendation. Offer:
(a) proceed with recommended action
(b) I need more context on [area] → investigate
(c) that's stale — let me explain what I'm doing now
(d) something else

## Constraints

<!-- FIXED: Do not adapt these -->
- MUST NOT ask Step 0 questions — this skill reads evidence
- MUST check handoff notes before git state
- MUST report branch divergence from main
- MUST sample actual diffs, not just list filenames
- MUST flag handoff drift when detected
- MUST NOT fabricate session context

## Output Format

Use the Resume Report skeleton from `output-skeletons.md`.

## Chains With

- /goat-plan — resume into planning (most common: picking up a milestone)
- /goat-debug — resume into debugging (most common: returning to a bug)
- /goat-investigate — resume into research (most common: continuing exploration)

**Handoff shape:** `{last_session_task, modified_files, branch_state, status, recommendation}`
