# Milestone 5: Custom Subagents

**Archetype:** Make It Shine — pair GOAT Flow skills with pre-configured agent runners for recurring tasks.

## Background

GOAT Flow skills (`.claude/skills/goat-*/`) define **what** the agent does — process, constraints, human gates, output format. But they don't control **how** the agent runs — which model, which tools are available, whether it runs in isolation.

Claude Code's `.claude/agents/` feature lets you define reusable agent configurations: model choice, tool permissions, isolation mode. These are complementary to skills — a skill defines the workflow, a subagent defines the runner.

## The Idea

Pair skills with subagents for common task profiles:

| Subagent | Model | Tools | Isolation | Paired Skill |
|----------|-------|-------|-----------|-------------|
| `security-reviewer` | Opus | Read-only | worktree | goat-audit + goat-review |
| `quick-search` | Haiku | Read-only | none | goat-investigate |
| `planner` | Opus | Read-only | none | goat-plan |
| `implementer` | Sonnet | All | none | (direct coding) |
| `test-writer` | Sonnet | All | worktree | goat-test |

### Why subagents matter

- **Security reviewer** with read-only tools can't accidentally modify code during review
- **Quick search** with Haiku is fast and cheap for codebase exploration
- **Planner** with Opus gets the best reasoning for architecture decisions
- **Implementer** with Sonnet balances speed and capability for coding
- **Test writer** in a worktree can experiment without affecting the main branch

## Structure

```
.claude/agents/
├── security-reviewer.md      # Opus, read-only, runs goat-audit
├── quick-search.md           # Haiku, read-only, runs goat-investigate
├── planner.md                # Opus, read-only, runs goat-plan
├── implementer.md            # Sonnet, all tools
└── test-writer.md            # Sonnet, all tools, worktree isolation
```

### Subagent file format

```markdown
---
model: opus
tools:
  - Read
  - Glob
  - Grep
  - WebSearch
isolation: worktree
---

# Security Reviewer

You are a security-focused code reviewer. Run the goat-audit skill with a security focus.

Load ai/instructions/security.md if it exists.

## Process
1. Run /goat-audit with scope: security
2. Focus on: input validation, auth boundaries, secret handling, injection risks
3. Report findings — do NOT fix anything

## Constraints
- MUST NOT use Edit, Write, or Bash tools
- MUST NOT modify any files
- Read-only audit
```

## Relationship to Skills

Skills and subagents are orthogonal:

```
Skills (what to do)          Subagents (how to run)
├── goat-audit               ├── security-reviewer (Opus, read-only)
├── goat-debug               ├── quick-search (Haiku, read-only)
├── goat-investigate         ├── planner (Opus, read-only)
├── goat-review              ├── implementer (Sonnet, all tools)
├── goat-plan                └── test-writer (Sonnet, worktree)
├── goat-test
└── goat-preflight
```

A skill can run with any subagent. A subagent can invoke any skill. The pairing is a recommendation, not a requirement.

## Tasks

### Phase A: Research (1 session)
1. [ ] Confirm `.claude/agents/` file format — model, tools, isolation fields
2. [ ] Test: does a subagent inherit CLAUDE.md context? Or does it start fresh?
3. [ ] Test: can a subagent invoke a skill via `/goat-audit`?
4. [ ] Test: does `isolation: worktree` work for read-heavy tasks like review?
5. [ ] Decide: which subagents are universally useful vs project-specific?

### Phase B: Templates (1 session)
6. [ ] Create `workflow/agents/security-reviewer.md` — template
7. [ ] Create `workflow/agents/quick-search.md` — template
8. [ ] Create `workflow/agents/planner.md` — template
9. [ ] Create `workflow/agents/implementer.md` — template
10. [ ] Create `workflow/agents/test-writer.md` — template

### Phase C: Setup Integration (1 session)
11. [ ] Update setup guides — create `.claude/agents/` during Phase 2
12. [ ] Update workflow/README.md — add agents/ directory
13. [ ] Decide: should the scanner check for subagent definitions?

### Phase D: Scanner Checks (optional)
14. [ ] New check: `.claude/agents/` directory exists (Full tier)
15. [ ] New check: at least 2 subagent definitions (Full tier)
16. [ ] Fragment for creating subagents

## Exit Criteria

- [ ] 5 subagent templates in `workflow/agents/`
- [ ] Setup guides create `.claude/agents/` with baseline subagents
- [ ] Subagents can invoke skills and respect tool restrictions
- [ ] Documentation explains skill vs subagent distinction

## Key Decisions

| Decision | Why |
|----------|-----|
| Subagents complement skills, don't replace them | Skills define process. Subagents define runtime. Orthogonal concerns. |
| Read-only subagents for review/audit | Prevents accidental modifications during review tasks. |
| Worktree isolation for test-writer | Can experiment without polluting the main branch. |
| Haiku for search, Opus for planning | Match model capability to task complexity. Cost optimization. |
| Templates in workflow/, instances in .claude/ | Same pattern as skills — template in workflow/, generated in .claude/. |

## What M5 Does NOT Build

- Codex/Gemini/Copilot equivalents (agent runners are Claude Code-specific)
- Automatic subagent selection based on task type
- Subagent chaining (one subagent spawning another)
- Custom model fine-tuning or configuration beyond what `.claude/agents/` supports

## Dependencies

- Requires Claude Code's `.claude/agents/` feature to be stable
- Benefits from M2.6 cold path (`ai/instructions/`) for domain-specific context loading
- Benefits from M3 dashboard for visualizing subagent configurations
