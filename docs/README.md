# GOAT Flow - Documentation

**Start here:** [getting-started.md](./getting-started.md)

---

## Core

| Document | What it covers |
|----------|---------------|
| [system-spec.md](./system-spec.md) | Full technical specification (canonical source of truth) |
| [getting-started.md](./getting-started.md) | Reading order, setup checklist, adoption tiers, maintenance, gotchas |

## System Design

| Document | What it covers |
|----------|---------------|
| [system/five-layers.md](./system/five-layers.md) | The 5-layer architecture (Runtime, Local Context, Skills, Playbooks, Evaluation) |
| [system/six-steps.md](./system/six-steps.md) | The 6-step execution loop (READ → CLASSIFY → SCOPE → ACT → VERIFY → LOG) |

## Learning Loop

| Document | What it covers |
|----------|---------------|
| [footguns.md](./footguns.md) | Cross-domain architectural traps with file:line evidence |
| [lessons.md](./lessons.md) | Agent behavioural mistakes and prevention rules |
| [architecture.md](./architecture.md) | Project architecture overview |

## Reference

| Document | What it covers |
|----------|---------------|
| [reference/design-rationale.md](./reference/design-rationale.md) | Why behind every design decision |
| [reference/examples.md](./reference/examples.md) | Real project implementation data (7 projects) |
| [reference/cross-agent-comparison.md](./reference/cross-agent-comparison.md) | Claude Code vs Codex analysis |
| [reference/competitive-landscape.md](./reference/competitive-landscape.md) | GOAT Flow vs 12 competitor systems |

## Related Directories

| Directory | What it contains |
|-----------|-----------------|
| [../setup/](../setup/) | Agent-specific setup guides (Claude Code, Codex, Gemini CLI) |
| [../workflow/](../workflow/) | Skill templates, playbooks, evaluation templates, runtime scaffolding |
| [../agent-evals/](../agent-evals/) | Regression tests from real incidents |
| [../roadmaps/](../roadmaps/) | CLI auditor spec and scoring rubric |
