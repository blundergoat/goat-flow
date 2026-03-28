# GOAT Flow

A structured workflow system for AI coding agents. Gives Claude Code, Gemini CLI, and Codex a 6-step execution loop, autonomy tiers, enforcement hooks, and a learning loop — instead of a wall of rules they half-follow.

## The Problem

AI coding agents are powerful but unreliable without structure. They fabricate file paths, skip verification, expand scope without asking, declare tasks done when they're not, and repeat the same mistakes across sessions.

Rules in instruction files help — but research shows agents follow ~70% of prose instructions. The other 30% is where things break.

## What GOAT Flow Does

**6-step execution loop:** READ → CLASSIFY → SCOPE → ACT → VERIFY → LOG. Every task follows this loop. SCOPE prevents scope creep. VERIFY catches errors before they ship. LOG captures lessons for next time.

**Three autonomy tiers:** Always (safe, reversible), Ask First (boundaries with a 5-item checklist), Never (destructive actions blocked mechanically).

**Enforcement hooks:** Pre-tool hooks block dangerous commands before execution (100% block rate vs ~70% for rules alone). Post-turn hooks lint after every change. Format hooks clean up edits. Ask First hooks warn on boundary file edits.

**Learning loop:** `docs/footguns.md` captures architectural traps with file:line evidence. `docs/lessons.md` captures behavioural mistakes. Real incidents only — no hypotheticals. Agent evals replay past failures as regression tests.

**8 skills:** `/goat-security`, `/goat-debug`, `/goat-investigate`, `/goat-review`, `/goat-plan`, `/goat-test`, `/goat-refactor`, `/goat-simplify`. Each has a distinct artifact, human gates, and a repeatable structured output.

**CLI scanner:** Scores your project's GOAT Flow implementation across 97 checks + 14 anti-patterns. Generates setup prompts that adapt to your project's state.

```
$ goat-flow scan .

--- Claude Code ---

Grade: A (96%)

  Foundation:   43/43  ████████████████████  100%
  Standard:     53/54  ████████████████████  98%
  Full:         16/17  ███████████████████░  94%
  Deductions:  -2
```

## Quick Start

### 1. Clone this repo

```bash
git clone https://github.com/devgoat-code/goat-flow.git
cd goat-flow
npm install && npm run build
```

### 2. Scan your project

```bash
scripts/run-cli.sh scan /path/to/your-project
```

This detects your stack, scores any existing GOAT Flow setup, and shows what's missing.

### 3. Generate a setup prompt

```bash
scripts/run-cli.sh setup /path/to/your-project --agent claude
```

This generates a prompt with references to the template files in this repo. Paste it into your agent — it reads the templates and builds the system for your project.

Available agents: `claude`, `codex`, `gemini`

### 4. Verify

```bash
scripts/run-cli.sh scan /path/to/your-project --agent claude
```

Target: Grade A. The scanner checks 94 items across foundation (instruction file, execution loop, autonomy, DoD, enforcement), standard (skills, hooks, learning loop, router, architecture, local instructions), and full (evals, CI, hygiene) tiers.

## Architecture

```
Layer 1 — Runtime         Instruction file (~120 lines), hooks, settings
Layer 2 — Local Context   Per-directory instruction files for high-risk areas
Layer 3 — Skills          8 on-demand capabilities loaded via slash commands
Layer 4 — Playbooks       Planning methodology templates
Layer 5 — Evaluation      Agent evals, CI validation, learning loop
```

Only Layer 1 loads every session. Everything else loads on demand via the router table.

Details: [docs/system/five-layers.md](docs/system/five-layers.md)

## Multi-Agent Support

| | Claude Code | Gemini CLI | Codex |
|---|---|---|---|
| Instruction file | CLAUDE.md | GEMINI.md | AGENTS.md |
| Skills | .claude/skills/ | .agents/skills/ | .agents/skills/ |
| Hooks | .claude/hooks/ | .gemini/hooks/ | scripts/ (policy) |
| Settings | .claude/settings.json | .gemini/settings.json | .codex/config.toml |
| Scanner | Yes | Yes | Yes |

All agents share the same execution loop, autonomy tiers, definition of done, and learning loop files. Agent-specific differences are in file locations and hook mechanisms.

## Project Structure

```
src/cli/                CLI scanner, prompt generator, scoring engine
setup/                  Setup guides + shared templates
  shared/               Cross-agent templates (execution loop, docs seed)
  setup-claude.md       Claude Code setup phases
  setup-gemini.md       Gemini CLI setup phases
  setup-codex.md        Codex setup phases
workflow/               Templates for skills, coding standards, evaluation
  skills/               8 skill templates (goat-*.md)
  coding-standards/     49 templates (backend, frontend, security)
  evaluation/           Eval format, footguns, lessons, handoff templates
  runtime/              Enforcement, architecture, code-map templates
docs/                   System design + reference documentation
scripts/                CLI runner, validation, enforcement scripts
agent-evals/            Regression tests from real incidents
```

## Documentation

| Document | What it covers |
|----------|---------------|
| [Getting Started](docs/getting-started.md) | Reading order, setup checklist, adoption tiers |
| [System Spec](docs/system-spec.md) | Full technical specification (canonical source of truth) |
| [5-Layer Architecture](docs/system/five-layers.md) | Runtime, Local Context, Skills, Playbooks, Evaluation |
| [6-Step Execution Loop](docs/system/six-steps.md) | READ → CLASSIFY → SCOPE → ACT → VERIFY → LOG |
| [Skills Reference](docs/system/skills.md) | All 8 skills: when to use, gates, output formats |
| [Design Rationale](docs/reference/design-rationale.md) | Why behind every design decision |

## Author

Built by [Matthew Hansen](https://www.blundergoat.com/about).

## License

[MIT](LICENSE)
