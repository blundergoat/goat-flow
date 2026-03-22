# GOAT Flow

A structured workflow system for AI coding agents. Gives Claude Code, Gemini CLI, Codex, and Copilot a 6-step execution loop, autonomy tiers, enforcement hooks, and a learning loop - instead of a wall of rules.

Implemented across 7 real projects. Open source under MIT.

## The Problem

AI coding agents are powerful but unreliable without structure. They fabricate file paths, skip verification, expand scope without asking, declare tasks done when they're not, and repeat the same mistakes across sessions. Rules in instruction files help (~70% compliance), but rules alone aren't enough.

## What GOAT Flow Does

**A 6-step execution loop:** READ → CLASSIFY → SCOPE → ACT → VERIFY → LOG. Every agent action follows this loop. SCOPE prevents scope creep. VERIFY catches errors before they ship. LOG captures lessons for next time.

**Three autonomy tiers:** Always (safe, reversible), Ask First (boundaries with a checklist), Never (destructive actions blocked mechanically).

**Enforcement hooks:** Pre-tool hooks block dangerous commands before execution (100% compliance vs ~70% for rules). Post-turn hooks lint after every change. Format hooks clean up edits.

**A learning loop:** `docs/footguns.md` (architectural traps with file:line evidence), `docs/lessons.md` (behavioural mistakes). Real incidents, not hypothetical ones.

**7 skills:** /goat-security, /goat-debug, /goat-audit, /goat-investigate, /goat-review, /goat-plan, /goat-test. Each has a distinct artifact, a hard quality gate, and a repeatable output.

## Quick Start

1. Clone this repo into your project (or copy `docs/system-spec.md` + `setup/`)
2. Pick your agent: [Claude Code](setup/setup-claude.md) | [Gemini CLI](setup/setup-gemini.md) | [Codex](setup/setup-codex.md) | [Copilot](setup/setup-copilot.md)
3. Paste the setup prompts into your agent - it builds the system for your project

**Minimal setup** (5 min): Phase 0 gives you an instruction file + deny-dangerous hook.
**Full setup** (45 min): Phase 1a-2 gives you the complete system.

See [docs/getting-started.md](docs/getting-started.md) for the full guide.

## Architecture

```
Layer 1 - Runtime         Instruction file (~120 lines), hooks, settings
Layer 2 - Local Context   Per-directory instruction files for high-risk areas
Layer 3 - Skills          7 on-demand capabilities loaded via slash commands
Layer 4 - Playbooks       Planning methodology templates
Layer 5 - Evaluation      Agent evals, CI validation, learning loop
```

Details: [docs/system/five-layers.md](docs/system/five-layers.md)

## Multi-Agent Support

| | Claude Code | Gemini CLI | Codex | Copilot |
|---|---|---|---|---|
| Instruction file | CLAUDE.md | GEMINI.md | AGENTS.md | .github/copilot-instructions.md |
| Skills | .claude/skills/ | .agents/skills/ | .agents/skills/ | .github/instructions/ |
| Hooks | .claude/hooks/ | .gemini/hooks/ | scripts/ (policy) | — |
| Setup guide | [setup-claude.md](setup/setup-claude.md) | [setup-gemini.md](setup/setup-gemini.md) | [setup-codex.md](setup/setup-codex.md) | [setup-copilot.md](setup/setup-copilot.md) |

All agents share the same execution loop, autonomy tiers, definition of done, and learning loop files.

## Documentation

| Document | What it covers |
|----------|---------------|
| [Getting Started](docs/getting-started.md) | Reading order, setup checklist, adoption tiers, gotchas |
| [System Spec](docs/system-spec.md) | Full technical specification (canonical source of truth) |
| [5-Layer Architecture](docs/system/five-layers.md) | Runtime, Local Context, Skills, Playbooks, Evaluation |
| [6-Step Execution Loop](docs/system/six-steps.md) | READ → CLASSIFY → SCOPE → ACT → VERIFY → LOG |
| [Design Rationale](docs/reference/design-rationale.md) | Why behind every design decision |
| [Cross-Agent Comparison](docs/reference/cross-agent-comparison.md) | Claude Code vs Codex vs Gemini CLI |
| [Skills Reference](docs/system/skills.md) | All 7 skills: when to use, hard gates, output formats |

## Project Structure

```
setup/                  Setup guides + shared templates
  setup-claude.md       Claude Code setup (Phases 0-2)
  setup-gemini.md       Gemini CLI setup (Phases 0-2)
  setup-codex.md        Codex setup
  shared/               Cross-agent templates (execution loop, docs seed)
docs/                   System design + reference documentation
workflow/               Skill templates, playbooks, evaluation templates
agent-evals/            Regression tests (real incidents + synthetic seeds)
scripts/                Validation and enforcement scripts (Codex)
.claude/                Claude Code runtime (hooks, settings, skills)
.gemini/                Gemini CLI runtime (hooks, settings)
.agents/                Shared skills (Codex + Gemini CLI)
```

## License

[MIT](LICENSE)
