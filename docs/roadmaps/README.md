# GOAT Flow Roadmap: CLI Auditor + Prompt Generator

`npx @blundergoat/goat-flow scan` — a TypeScript CLI that scans a project, scores its GOAT Flow implementation against a 75+ check rubric, and generates tailored fix/setup prompts.

## Prime Plan Summary

1. TypeScript CLI in `cli/`, Node 22+, zero runtime deps
2. Rubric as typed data — 6 generic evaluators, not 75+ functions
3. Fact model — scan filesystem once, score against extracted facts
4. One engine, many renderers (JSON/text/markdown, `grade` is a renderer)
5. Agent profile registry — 3 hardcoded profiles, all checks parameterised
6. 75+ checks across 3 tiers + 9 anti-patterns (AP10/AP11 deferred to v2)
7. N/A inflation guard — <10% applicable checks → "Insufficient Data"
8. Multi-agent harmony check — instruction files must acknowledge each other
9. Stable recommendation keys — M2's fragment system joins on check IDs
10. TestProject builders + self-scan against goat-flow for validation

Full plan: [`TODO_cli-auditor_prime.md`](../../TODO_cli-auditor_prime.md)

## Milestones

| # | Milestone | What it delivers | Spec |
|---|-----------|-----------------|------|
| M1 | **Scanner + Scoring Engine** | Rubric as typed data, 6 evaluators, fact model, 75+ checks, JSON output. Self-scan validates. | [M1-scanner.md](milestones/M1-scanner.md) |
| M2 | **Prompt Generator** | Fragment-based templates. Fix/setup/audit prompts tailored to failed checks, stack, shape, agent. | [M2-prompt-generator.md](milestones/M2.0-prompt-generator.md) |
| M3 | **HTML Dashboard** | Interactive dashboard. Tier drill-down, multi-agent comparison, guided prompt wizard. | [M3-html-dashboard.md](milestones/M3-html-dashboard.md) |
| M4 | **CLI Polish + npm Publish** | Text/markdown renderers, `--verbose`, CI gate mode, npm publish as `@blundergoat/goat-flow`. | [M4-cli-publish.md](milestones/M4-cli-publish.md) |

## Key Constraints

- TypeScript ESM, Node 22+, zero runtime deps
- Read-only filesystem access
- Deterministic scoring (same project = same score)
- Rubric is typed code, not parsed from markdown
- Agent-agnostic abstractions (never hardcode CLAUDE.md)
- One engine, many renderers — `grade`/`fix`/`setup` are output formats, not separate commands

## Architecture

```
CLI args → Detect (shape, stack, agents)
  → Extract Facts (scan filesystem once)
    → Evaluate (run rubric against facts per agent)
      → Score (N/A reduction, deductions, grading)
        → Render (JSON / text / markdown)
```

## Origin

This plan was produced via SBAO ranking of 6 competing plans (3 sub-agents + Claude Opus + Codex + Gemini CLI). The plans identified 9 spec bugs, produced the rubric-as-data architecture, and converged on the fact model + generic evaluator approach.
