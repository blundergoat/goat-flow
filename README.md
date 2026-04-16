# GOAT Flow

A structured workflow system for AI coding agents, built on harness engineering principles.

AI coding agents are powerful but unreliable. They skip verification steps, create duplicate files instead of editing in place, ignore project conventions, and repeat the same mistakes across sessions. GOAT Flow fixes this by giving agents a concrete operating system: an execution loop that enforces READ before writing, VERIFY before committing, and a learning loop that captures mistakes so they never repeat. It works with Claude Code, Gemini CLI, and Codex.

## Before and After

**Without GOAT Flow** -- you ask the agent to fix a bug in `src/auth.ts`:

```
Agent reads one file, guesses the fix, edits three files it shouldn't,
skips linting, creates auth_fixed.ts instead of editing in place,
and pushes broken code. Next session, it makes the same mistake.
```

**With GOAT Flow** -- same request:

```
READ    → Agent reads auth.ts, related tests, and known footguns
SCOPE   → Routes as "hotfix" - editing auth.ts only, running existing tests
ACT     → Applies the fix in place
VERIFY  → Runs linter + tests, catches a type error, fixes it, logs a footgun
```

The agent follows the loop because it's built into the instruction file, enforced by hooks, and validated by the auditor.

## Getting Started

Requires Node.js 20+.

### 1. Install

```bash
npm install -g @blundergoat/goat-flow

# or use without installing
npx @blundergoat/goat-flow@latest audit .
```

### 2. Open the dashboard

```bash
goat-flow dashboard .
```

A local web UI opens with auditing, setup, and an integrated terminal.

![Dashboard](docs/assets/dashboard-preview.png)

### 3. Audit your project

```bash
npx goat-flow audit .
```

The auditor validates goat-flow setup correctness across two scopes -- GOAT Flow Setup (pass/fail) and AI Harness Score (per-agent percentage) -- and reports pass/fail. A fresh project fails -- that's expected.

### 4. Generate setup for your agent

```bash
goat-flow setup . --agent claude
```

This prints a setup prompt. Paste it into Claude Code and let the agent configure your project: instruction file, skills, hooks, and learning loop.

### 5. Re-audit and see the difference

```bash
npx goat-flow audit .
```

Your project passes the structural setup checks. Add `--harness` to see advisory scoring across the 5 harness concerns. Note: audit validates setup correctness (files, config, skills, hooks), not code quality - run your project's lint and test commands separately.

### 6. Try a skill

```
/goat review src/auth.ts
```

Skills are structured workflows the agent follows. `/goat` auto-routes to the right one -- debug, review, plan, security audit, or test gap analysis.

## What You Get

**Execution Loop** -- READ → SCOPE → ACT → VERIFY. Read before you write. Verify after you write. This prevents the agent from guessing at code it hasn't read or shipping without running checks.

**Skills** -- Seven structured workflows (`/goat-debug`, `/goat-review`, `/goat-plan`, `/goat-sbao`, `/goat-security`, `/goat-test`, `/goat`) with phases and human gates. The `/goat` dispatcher classifies your request and routes to the right skill automatically.

**Enforcement Hooks** -- Pre-tool hooks intercept dangerous commands (`rm -rf`, force push, secret file access) and reject them with an explanation. goat-flow ships `deny-dangerous.sh` - project-specific linting and constraints are registered in `config.yaml`.

**Learning Loop** -- Agents record footguns, lessons, decisions, and session logs in `.goat-flow/`. Next session, they read these before acting. Mistakes stop repeating.

**Autonomy Tiers** -- Three-tier permission model (Always / Ask First / Never) built into the instruction file so agents know what they can do independently and what requires your approval.

**Reference Templates** -- Planning, security, and compliance templates used by skills and setup to provide concrete, framework-specific guidance.

## The Five Harness Concerns

GOAT Flow's quality audit (`npx goat-flow audit . --harness`) evaluates your project's agent harness against 5 concerns - the things every major harness engineering source agrees matter for agent effectiveness.

| Concern | Question | What GOAT Flow checks |
|---------|----------|----------------------|
| **Context** | Is the agent's context accurate, lean, and useful? | Instruction file line count vs target, router table path resolution, footgun file:line evidence freshness, architecture doc existence (10+ lines) |
| **Constraints** | Do deterministic rules catch failures before the LLM runs? | Deny patterns cover secrets and dangerous commands, Ask First boundary count |
| **Verification** | Can the agent verify its work, and does failure feed back? | Test command configured, hook registrations in sync with hook files, commit guidance present |
| **Recovery** | Can the agent resume after crash or interruption? | Milestone file count in .goat-flow/tasks/, session log count in .goat-flow/logs/sessions/ |
| **Feedback Loop** | Is the harness getting smarter from failures over time? | Footgun entry count (3+ threshold), lesson entry count (3+ threshold), decisions directory activity |

These aren't a proprietary model - they're a synthesis of consensus across the harness engineering field. See [docs/audit-and-critique.md](docs/audit-and-critique.md) for the full framework and sources.

## Commands

```bash
npx goat-flow audit .                      # Validate setup correctness (pass/fail)
npx goat-flow audit . --harness            # Build + advisory quality scoring
goat-flow critique . --agent claude        # Generate agent critique prompt
goat-flow setup . --agent claude           # Generate setup prompt for Claude Code
goat-flow status .                         # Show project state (bare/partial/v0.9/v1.0/v1.1)
goat-flow dashboard .                      # Visual dashboard with integrated terminal

npx goat-flow audit . --format json        # JSON output for CI
goat-flow setup . --agent gemini           # Gemini CLI setup
goat-flow setup . --agent codex            # Codex setup
```

See [docs/cli.md](docs/cli.md) for the full command reference.

## Multi-Agent Support

Three first-class agents are supported by the CLI (`audit`, `critique`, `setup`, `dashboard`):

| | Claude Code | Gemini CLI | Codex |
|---|---|---|---|
| Instruction file | CLAUDE.md | GEMINI.md | AGENTS.md |
| Skills | .claude/skills/ | .agents/skills/ | .agents/skills/ |
| Hooks | .claude/hooks/ | .gemini/hooks/ | .codex/hooks/ |

All agents share the same execution loop, autonomy tiers, skills, and learning loop. The `setup` command generates agent-specific configuration.

## Troubleshooting

**Terminal not showing in dashboard?**
node-pty didn't compile. Run `npm rebuild node-pty`. If using pnpm: `pnpm approve-builds` (select node-pty).

**Audit fails on a fresh project?**
Expected. Run `goat-flow setup . --agent claude` and paste the output into your agent.

## Documentation

| Document | What it covers |
|---|---|
| [CLI Reference](docs/cli.md) | All commands, flags, and output formats |
| [Skills Reference](docs/skills.md) | All 7 skills: modes, phases, gates, outputs |
| [Audit & Critique](docs/audit-and-critique.md) | The two evaluation commands, 5 harness concerns, and when to use each |
| [Dashboard](docs/dashboard.md) | Views, terminal, API endpoints |

## Author

Built by [Matthew Hansen](https://www.blundergoat.com/about).

## License

[MIT](LICENSE)
