# Case Study: Multi-Agent Coordination

## Scenario

A project already running Claude Code with GOAT Flow needs to add Codex and Gemini CLI support. All three agents must share the same documentation, learning loop, and skill definitions without overwriting each other's work.

## The Challenge

When Gemini CLI was asked to set up GOAT Flow, it modified 6 shared documentation files -- replacing Claude Code references with Gemini-specific equivalents instead of adding multi-agent support alongside them.

**What actually happened** (from `docs/lessons.md`):

- `docs/system-spec.md:429` -- "Every Claude turn" became "Every Gemini turn" (should be agent-neutral)
- `docs/system/five-layers.md:100` -- Claude Code row deleted from skills table, replaced with Gemini CLI only
- `docs/system/five-layers.md:49-50` -- `.claude/` paths replaced with `.gemini/` paths
- `docs/system/six-steps.md:182` -- Claude Code hook example replaced, not added alongside
- `workflow/runtime/enforcement.md` -- ended up in a hybrid state with half `.claude/` and half `.gemini/` paths

**Root cause:** The agent treated the task as find-and-replace (`.claude/` to `.gemini/`, `PreToolUse` to `BeforeTool`). It did not distinguish between agent-specific files and shared files.

## The Solution

### 1. Separate agent-specific from shared files

Agent-specific files (editable by that agent):
- `CLAUDE.md`, `.claude/hooks/`, `.claude/skills/`, `.claude/settings.json`
- `GEMINI.md`, `.gemini/hooks/`, `.gemini/settings.json`
- `AGENTS.md`, `scripts/deny-dangerous.sh` (Codex policy)
- `setup/setup-claude.md`, `setup/setup-gemini.md`, `setup/setup-codex.md`

Shared files (must remain agent-neutral or list all agents):
- `docs/` -- system spec, architecture, learning loop
- `workflow/` -- skill templates, playbooks
- `.agents/skills/` -- shared skill definitions (Codex + Gemini CLI)

### 2. Scope constraints in setup guides

Each agent's setup guide now includes an explicit scope constraint:

> "Only create/modify files under `.gemini/` and `GEMINI.md`. Do NOT modify `docs/`, `workflow/`, or any file outside the `.gemini/` directory."

This prevents the broad-rewrite problem. Shared documentation is treated as an Ask First boundary that requires human approval.

### 3. Shared skills directory

Skills live in 3 locations to serve different agents:

| Location | Consumed by | Count |
|----------|-------------|-------|
| `.claude/skills/goat-*/` | Claude Code | 10 |
| `.agents/skills/goat-*/` | Codex + Gemini CLI | 10 |
| `workflow/skills/` | Canonical templates | 10 |

The `workflow/skills/` templates are the source of truth. Agent-specific copies are derived from them. When a skill changes, the template updates first, then propagates.

### 4. Scanner validates alignment

The scanner checks all three agents' instruction files for structural completeness: execution loop present, autonomy tiers defined, DoD gates listed, router table populated. CI runs the scanner on every push to catch drift before it ships.

## Key Lessons

**"Broad setup rewrites shared docs"** is now a tracked footgun in `docs/footguns.md` with file:line evidence. The prevention rule: when adding agent support, ADD to tables and examples -- never DELETE or REPLACE existing agent references.

**Vocabulary differences are silent failures.** Claude Code uses `PreToolUse`/`Stop`; Gemini CLI uses `BeforeTool`/`AfterAgent`. Path substitution (`.claude/` to `.gemini/`) misses these. Each agent's setup guide now maintains a hook event reference block so the correct vocabulary is visible during setup.

**Run Claude Code first, then Codex.** For learning loop files shared by multiple agents (`docs/footguns.md`, `docs/lessons.md`), define one agent as the primary writer. The simplest pattern: Claude Code creates entries, Codex merges with existing content. This avoids merge conflicts on append-only files.
