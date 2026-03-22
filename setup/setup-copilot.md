# Copilot Setup — GOAT Flow

Paste this into any AI coding agent to set up GitHub Copilot support for a project with GOAT Flow.

## Prerequisites

This guide creates `.github/copilot-instructions.md` (Copilot's hot path) and `.github/instructions/` bridge files (Copilot's cold path). It also creates `ai/instructions/` if not already present.

---

## The Prompt

```
Read the project structure. You are setting up GitHub Copilot support for this project.

The stack is:
- Languages: [list]
- Build: [command]
- Test: [command]
- Lint: [command]

### Phase 1a: Cold Path (ai/instructions/)

If `ai/instructions/` does not exist:
1. Create `ai/README.md` — routing map (see workflow/coding-standards/README.md)
2. Create `ai/instructions/conventions.md` — project conventions (see workflow/coding-standards/conventions.md)
3. Create `ai/instructions/code-review.md` — review standards (see workflow/coding-standards/code-review.md)
4. Create `ai/instructions/git-commit.md` — commit format (see workflow/coding-standards/git-commit.md)

VERIFICATION: After creating ai/instructions/ files, the agent MUST:
1. Verify every file path exists: for each backtick-wrapped path, run `ls`
2. Verify commands work: run build/test/lint commands listed in conventions.md
3. Remove aspirational content: if a feature is planned but not implemented, remove it
   Source of truth is the code, not docs/architecture.md or roadmaps.

If `.github/instructions/` exists but `ai/instructions/` does not:
- Migrate: group language files into domain files (php.md + python.md → backend.md)
- Create `ai/README.md` router

### Phase 1b: Copilot Hot Path

Create `.github/copilot-instructions.md` with the same structure as CLAUDE.md:
- Project description (one line)
- Essential commands (build, test, lint)
- Execution loop: READ → CLASSIFY → SCOPE → ACT → VERIFY → LOG
- Autonomy tiers (Always, Ask First, Never)
- Definition of Done
- Router table (including `ai/README.md` entry)

Use `setup/shared/execution-loop.md` as the template. Keep under 120 lines.

### Phase 1c: Copilot Bridge Files

For each file in `ai/instructions/`, create a matching `.github/instructions/*.instructions.md`:

Example for frontend:
---
applyTo: "src/frontend/**"
---
<!-- Source: ai/instructions/frontend.md — keep in sync -->
[inline content from ai/instructions/frontend.md]

Copilot needs inline content — it doesn't follow markdown links.

### Phase 1d: Git Commit Instructions

Create `.github/git-commit-instructions.md` if not exists — universal commit instructions.

### Phase 1e: Copilot CLI Skills

If the project uses GitHub Copilot CLI (not just VS Code), create skills under `.github/skills/`:

For each skill in the workflow, create `.github/skills/goat-{name}/SKILL.md`:
- goat-security, goat-debug, goat-audit, goat-investigate, goat-review, goat-plan, goat-test, goat-reflect, goat-onboard, goat-resume

Each SKILL.md needs YAML frontmatter (name + description) and the full skill content.
Copy from `.claude/skills/` or `.agents/skills/` — the format is identical.

Copilot CLI discovers these via `/skills list` or `/goat-{name}` at runtime.

### Phase 2: Verify

- [ ] `ai/README.md` exists and routes correctly
- [ ] `ai/instructions/` has conventions.md, code-review.md, git-commit.md
- [ ] `.github/copilot-instructions.md` exists with execution loop
- [ ] `.github/instructions/` bridge files reference ai/instructions/ content
- [ ] `.github/git-commit-instructions.md` exists

### Human Gate

Open Copilot Chat in VS Code. Ask it about project conventions. Confirm it picks up the instructions from `.github/copilot-instructions.md` and the bridge files.
```
