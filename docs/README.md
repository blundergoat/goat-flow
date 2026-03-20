# GOAT Flow - Workflow System

A full-stack AI engineering system for planning, executing, verifying, and learning with coding agents.

**Start here:** [getting-started.md](./getting-started.md)

---

## System Overview

| Document | What it covers |
|----------|---------------|
| [FIVE_LAYER_SYSTEM.md](./FIVE_LAYER_SYSTEM.md) | The 5-layer architecture (Runtime, Local Context, Skills, Playbooks, Evaluation) |
| [FIVE_STEP_LOOP.md](./FIVE_STEP_LOOP.md) | The execution loop (READ → CLASSIFY → SCOPE → ACT → VERIFY → LOG) |
| [getting-started.md](./getting-started.md) | Reading order, setup checklist, adoption tiers, maintenance, gotchas |

---

## Folders (mapped to the 5-layer architecture)

| Folder | Layer | What it contains |
|--------|-------|-----------------|
| [runtime/](./runtime/) | Layer 1 | Setup prompts for CLAUDE.md/AGENTS.md, enforcement hooks, project scaffolding |
| [local-context/](./local-context/) | Layer 2 | Domain instruction file prompts (auto-loaded per directory) |
| [skills/](./skills/) | Layer 3 | Skill reference + creation prompts (/goat-preflight, /goat-debug, /goat-audit, /goat-research, /goat-review) |
| [playbooks/](./playbooks/) | Layer 4 | Planning methodology (feature brief → SBAO → milestones) + doer-verifier testing |
| [evaluation/](./evaluation/) | Layer 5 | Agent evals, CI validation, learning loop files (footguns, lessons, confusion-log, handoff) |

---

## Reference (not part of the layer system)

| Folder/File | What it contains |
|-------------|-----------------|
| [_reference/system-spec.md](./_reference/system-spec.md) | Full technical specification |
| [_reference/design-rationale.md](./_reference/design-rationale.md) | Why behind every design decision |
| [_reference/cross-agent-comparison.md](./_reference/cross-agent-comparison.md) | Claude Code vs Codex analysis |
| [_reference/examples.md](./_reference/examples.md) | Real project implementation data |
| [_reference/competitive-landscape.md](./_reference/competitive-landscape.md) | GOAT Flow vs 12 competitor systems |
| [system-summary-for-external-review.md](./system-summary-for-external-review.md) | Self-contained summary for external reviewers |
