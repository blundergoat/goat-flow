# GOAT Flow

A full-stack AI engineering system for planning, executing, verifying, and learning with coding agents.

**Start here:** [docs/getting-started.md](docs/getting-started.md)

---

## Core

| Document | What it covers |
|----------|---------------|
| [docs/system-spec.md](docs/system-spec.md) | Full technical specification (canonical source of truth) |
| [docs/getting-started.md](docs/getting-started.md) | Reading order, setup checklist, adoption tiers, maintenance, gotchas |

## System Design

| Document | What it covers |
|----------|---------------|
| [docs/system/five-layers.md](docs/system/five-layers.md) | The 5-layer architecture (Runtime, Local Context, Skills, Playbooks, Evaluation) |
| [docs/system/six-steps.md](docs/system/six-steps.md) | The 6-step execution loop (READ → CLASSIFY → SCOPE → ACT → VERIFY → LOG) |

## Setup Guides

| Agent | Guide |
|-------|-------|
| Claude Code | [setup/setup-claude.md](setup/setup-claude.md) |
| Codex | [setup/setup-codex.md](setup/setup-codex.md) |
| Gemini CLI | [setup/setup-gemini.md](setup/setup-gemini.md) |

## Learning Loop

| Document | What it covers |
|----------|---------------|
| [docs/footguns.md](docs/footguns.md) | Cross-domain architectural traps with file:line evidence |
| [docs/lessons.md](docs/lessons.md) | Agent behavioural mistakes and prevention rules |
| [docs/architecture.md](docs/architecture.md) | Project architecture overview |

## Reference

| Document | What it covers |
|----------|---------------|
| [docs/reference/design-rationale.md](docs/reference/design-rationale.md) | Why behind every design decision |
| [docs/reference/examples.md](docs/reference/examples.md) | Real project implementation data (7 projects) |
| [docs/reference/cross-agent-comparison.md](docs/reference/cross-agent-comparison.md) | Claude Code vs Codex analysis |
| [docs/reference/competitive-landscape.md](docs/reference/competitive-landscape.md) | GOAT Flow vs 12 competitor systems |

## Directories

| Directory | What it contains |
|-----------|-----------------|
| [setup/](setup/) | Agent-specific setup guides + shared templates |
| [workflow/](workflow/) | Skill templates, playbooks, evaluation templates, runtime scaffolding |
| [agent-evals/](agent-evals/) | Regression tests from real incidents |
| [docs/roadmaps/](docs/roadmaps/) | v0.3 prompt generator + v0.4 cross-project learning |
