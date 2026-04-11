# Agent Config - GitHub Copilot

## Paths

| Resource | Path |
|----------|------|
| Instruction file | `.github/copilot-instructions.md` |
| Skills directory | `.github/skills/` |
| Hooks | None - Copilot has no hook mechanism |

## Owns

`.github/copilot-instructions.md`, `.github/skills/`, and shared `.goat-flow/`.

## Hands off

CLAUDE.md, AGENTS.md, GEMINI.md, `.claude/`, `.agents/`, `.gemini/`, `.codex/`.

## Agent-specific setup

### Bridge files

Bridge files are no longer part of base setup. If the project later adds canonical local instruction files under `.goat-flow/coding-standards/`, create matching `.github/instructions/*.instructions.md` files for Copilot:

```yaml
---
applyTo: "src/frontend/**"
---
```

Then inline the content. Copilot needs inline content - it doesn't follow markdown links.

### Copilot CLI skills

If the project uses Copilot CLI, create skills under `.github/skills/`:
- Copy from `workflow/skills/goat-*.md` templates
- Format is identical to `.claude/skills/` SKILL.md files

### Verification

- `.github/copilot-instructions.md` exists with execution loop, autonomy tiers, DoD, router table
- If `.goat-flow/coding-standards/` exists, `.github/instructions/` bridge files reference its canonical content
- Open Copilot Chat and verify it picks up the instructions

---

Begin setup: proceed to `01-system-overview.md`
