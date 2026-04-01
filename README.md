# GOAT Flow

A structured workflow system for AI coding agents. Gives Claude Code, Gemini CLI, and Codex a 6-step execution loop, autonomy tiers, enforcement hooks, and a learning loop - instead of a wall of rules they half-follow.

## Install

```bash
npm install --save-dev @blundergoat/goat-flow

pnpm add -D @blundergoat/goat-flow                                                                                                                                                                                         

```

Or run without installing: `npx @blundergoat/goat-flow dashboard`

## Dashboard

```bash
npx goat-flow dashboard

```

Scan your project, browse results by category, compare agents side by side, and copy fix prompts. The dashboard is the fastest way to see where your project stands and what to do next.

![Dashboard](docs/assets/dashboard-preview.png)

## Setup

### 1. Scan your project

```bash
npx goat-flow dashboard
```

Open the dashboard and hit Scan. Or from the CLI: `npx goat-flow scan`. This detects your stack, scores any existing GOAT Flow setup, and shows what's missing.

### 2. Generate a setup prompt

```bash
npx goat-flow setup --agent claude
```

This generates a setup prompt adapted to your project's current state - what's already done, what's missing, and the exact templates to use. Paste it into your agent and it builds the system for your project.

Available agents: `claude`, `codex`, `gemini`

### 3. Verify

```bash
npx goat-flow scan --agent claude
```

Target: Grade A. Re-run setup and scan until you hit 100%. The scanner checks 95 items + 17 anti-patterns across foundation (instruction file, execution loop, hooks), standard (skills, learning loop, local instructions), and full (evals, CI) tiers.

### 4. Iterate

Open the dashboard after each round to see what improved and what's left. The Fixes tab shows exactly what to do next with copy-to-clipboard prompts.

## The Problem

AI coding agents are powerful but unreliable without structure. They fabricate file paths, skip verification, expand scope without asking, declare tasks done when they're not, and repeat the same mistakes across sessions.

Rules in instruction files help - but research shows agents follow ~70% of prose instructions. The other 30% is where things break.

## What GOAT Flow Does

**6-step execution loop:** READ → CLASSIFY → SCOPE → ACT → VERIFY → LOG. Every task follows this loop. SCOPE prevents scope creep. VERIFY catches errors before they ship. LOG captures lessons for next time.

**Three autonomy tiers:** Always (safe, reversible), Ask First (boundaries with a 5-item checklist), Never (destructive actions blocked mechanically).

**Enforcement hooks:** Pre-tool hooks block dangerous commands before execution (100% block rate vs ~70% for rules alone). Post-turn hooks lint after every change.

**Learning loop:** `docs/footguns/` captures architectural traps with file:line evidence. `ai/lessons/` captures behavioural mistakes. Real incidents only - no hypotheticals. Agent evals replay past failures as regression tests.

**6 skills (5 specialized + dispatcher):** `/goat` routes to the right skill automatically. `/goat-security`, `/goat-debug`, `/goat-review`, `/goat-plan`, `/goat-test`. Each has a distinct artifact, human gates, and a repeatable structured output. Former standalone skills (investigate, simplify, refactor) are now modes within debug, review, and plan respectively.

**Dashboard + CLI scanner:** Scores your project across 103 checks + 16 anti-patterns. Interactive dashboard for browsing results, comparing agents, and copying fix prompts. Setup prompts adapt to your project's state.

## Skills

Type `/goat` followed by what you need. The dispatcher routes to the right skill automatically.

```
/goat fix the login bug           → /goat-debug
/goat review the PR               → /goat-review
/goat plan the new feature        → /goat-plan
/goat check for security issues   → /goat-security
/goat how does the auth work      → /goat-debug (investigate mode)
/goat generate a test plan        → /goat-test
/goat rename across files         → /goat-plan (refactor mode)
/goat clean up this messy code    → /goat-review (simplify mode)
```

Every skill pauses at Step 0 to confirm context before starting, has human gates between phases, and produces a structured output. Skills stay out of the instruction budget until invoked.

All 5 skills are also directly invocable: `/goat-debug`, `/goat-security`, etc.

Details: [docs/system/skills.md](docs/system/skills.md)

## CLI

```bash
npx goat-flow scan                        # Score your project
npx goat-flow scan --agent claude         # Score one agent
npx goat-flow scan --min-score 75         # CI gate (exit 1 if below)
npx goat-flow scan --format json          # Machine-readable
npx goat-flow scan --format markdown      # PR comment friendly
npx goat-flow scan --format html          # Standalone HTML report
npx goat-flow scan --output report.json   # Write to file
npx goat-flow setup --agent claude        # Generate setup prompt
npx goat-flow dashboard                   # Interactive dashboard
```

## Architecture

```
Layer 1 - Runtime         Instruction file (~120 lines), hooks, settings
Layer 2 - Local Context   Per-directory instruction files for high-risk areas
Layer 3 - Skills          6 on-demand capabilities loaded via slash commands
Layer 4 - Playbooks       Planning methodology templates
Layer 5 - Evaluation      Agent evals, CI validation, learning loop
```

Only Layer 1 loads every session. Everything else loads on demand via the router table.

Details: [docs/system/five-layers.md](docs/system/five-layers.md)

## Multi-Agent Support

| | Claude Code | Gemini CLI | Codex |
|---|---|---|---|
| Instruction file | CLAUDE.md | GEMINI.md | AGENTS.md |
| Skills | .claude/skills/ | .github/skills/ | .agents/skills/ |
| Hooks | .claude/hooks/ | .gemini/hooks/ | .codex/hooks/ |
| Settings | .claude/settings.json | .gemini/settings.json | .codex/config.toml |
| Scanner | Yes | Yes | Yes |

All agents share the same execution loop, autonomy tiers, definition of done, and learning loop files. Agent-specific differences are in file locations and hook mechanisms.

## Project Structure

```
ai/evals/               Regression tests from real incidents
docs/                   System design + reference documentation
scripts/                Preflight, validation, enforcement scripts
setup/                  Setup guides + shared templates
  shared/               Cross-agent templates (execution loop, docs seed)
  setup-claude.md       Claude Code setup phases
  setup-codex.md        Codex setup phases
  setup-gemini.md       Gemini CLI setup phases
src/cli/                CLI scanner, prompt generator, scoring engine
src/dashboard/          Single-page HTML dashboard (Alpine.js + Tailwind via CDN)
workflow/               Templates for skills, coding standards, evaluation
  coding-standards/     48 templates (backend, frontend, security, devops)
  evaluation/           Eval format, footguns, lessons, handoff templates
  runtime/              Enforcement, architecture, code-map templates
  skills/               6 skill templates (5 specialized + /goat dispatcher)
```

## Documentation

| Document | What it covers |
|----------|---------------|
| [Getting Started](docs/getting-started.md) | Reading order, setup checklist, adoption tiers |
| [System Spec](docs/system-spec.md) | Full technical specification (canonical source of truth) |
| [5-Layer Architecture](docs/system/five-layers.md) | Runtime, Local Context, Skills, Playbooks, Evaluation |
| [6-Step Execution Loop](docs/system/six-steps.md) | READ → CLASSIFY → SCOPE → ACT → VERIFY → LOG |
| [Skills Reference](docs/system/skills.md) | All 6 skills: when to use, gates, output formats |
| [Design Rationale](docs/reference/design-rationale.md) | Why behind every design decision |

## Author

Built by [Matthew Hansen](https://www.blundergoat.com/about).

## License

[MIT](LICENSE)
