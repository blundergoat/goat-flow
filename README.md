# GOAT Flow

A structured workflow system for AI coding agents, built on harness engineering principles.

AI coding agents are powerful but unreliable. They skip verification steps, create duplicate files instead of editing in place, ignore project conventions, and repeat the same mistakes across sessions. GOAT Flow fixes this by giving agents a concrete operating system: an execution loop that enforces READ before writing, VERIFY before committing, and a learning loop that captures mistakes so they never repeat. It works with Claude Code, Gemini CLI, and Codex.

## What You Get

**Execution Loop** -- READ → SCOPE → ACT → VERIFY. Read before you write. Verify after you write. This prevents the agent from guessing at code it hasn't read or shipping without running checks.

**Skills** -- Seven structured workflows (`/goat-debug`, `/goat-review`, `/goat-plan`, `/goat-critique`, `/goat-security`, `/goat-qa`, `/goat`) with phases and human gates. The `/goat` dispatcher classifies your request and routes to the right skill automatically.

**Enforcement Hooks** -- Pre-tool hooks intercept dangerous commands (`rm -rf`, force push, secret file access) and reject them with an explanation. goat-flow ships `deny-dangerous.sh` - project-specific linting and constraints are registered in `config.yaml`.

**Learning Loop** -- Agents record footguns, lessons, decisions, and session logs in `.goat-flow/`. Next session, they read these before acting. Mistakes stop repeating.

**Autonomy Tiers** -- Three-tier permission model (Always / Ask First / Never) built into the instruction file so agents know what they can do independently and what requires your approval.

**Reference Templates** -- Planning, security, and compliance templates used by skills and setup to provide concrete, framework-specific guidance.

## See it in 30 seconds

A fresh repo fails the audit. That's the baseline:

```
$ npx @blundergoat/goat-flow@latest audit .
GOAT Flow Audit: .

GOAT Flow Setup:         FAIL
  Skills:                7/7 installed
  Config:                invalid or missing
  InstructionFile:       0 lines (max across agents)
  x Lessons: Missing: .goat-flow/lessons/
  x Footguns: Missing: .goat-flow/footguns/
  x Architecture: Missing: .goat-flow/architecture.md
  ... 9 more failures

Result: FAIL
```

Run setup, paste the prompt into your agent, re-audit:

```
$ goat-flow audit .
GOAT Flow Audit: /your/project

GOAT Flow Setup:         PASS
  Skills:                7/7 installed
  Config:                valid, version 1.2.0
  InstructionFile:       118 lines (max across agents)

Agent Setup:             PASS
  Hooks:                 claude:deny installed

Result: PASS
```

## A real session

Captured trace from `.goat-flow/logs/sessions/2026-04-16-v1.1.0-review-and-cold-path-fixes.md`:

```
READ    → 89-file diff, 4 independent agent critiques cross-referenced
SCOPE   → "review" mode, no edits; fix scope declared after triage
ACT     → Fixed 3 broken cross-references:
          - 03-install-skills.md (stale flat file names)
          - code-map.md (wrong harness count 15→16, stale skill tree)
          - upgrade-from-0.9.x.md (goat-debug.md → goat-debug/SKILL.md)
          Marked 6 stale footgun entries resolved.
VERIFY  → Preflight: 33 checks, 0 errors, 9 warnings. Tests: 92/92 passing.
```

Every edit is auditable against the loop, after the fact, from the log alone.

## Getting Started

Requires Node.js 20+.

### 1. Install

```bash
# Recommended: local dev dependency (pin the version per project)
npm install --save-dev @blundergoat/goat-flow

# Or install globally to use goat-flow from any directory
npm install -g @blundergoat/goat-flow

# Or use without installing
npx @blundergoat/goat-flow@latest audit .
```

After a local install, run the CLI with `npx goat-flow ...` from the project root. With a global install, drop the `npx` prefix from the examples below.

### 2. Open the dashboard

```bash
npx goat-flow dashboard .
```

A local web UI opens with auditing, setup, and an integrated terminal.

![Dashboard](docs/assets/dashboard-preview.png)

*Dashboard home: audit status per agent, setup entry points, and a terminal wired to the project root.*

### 3. Audit your project

```bash
npx goat-flow audit .
```

Validates setup correctness across two scopes -- GOAT Flow Setup and Agent Setup -- and prints pass/fail per scope with actionable fix hints. A fresh project fails; that's the baseline you'll re-measure against in step 5. Audit checks setup files, config, skills, and hooks -- not code quality. Run your project's lint and test commands separately.

### 4. Generate setup for your agent

```bash
npx goat-flow setup . --agent claude
```

Prints a setup prompt. Paste it into Claude Code and let the agent configure your project: instruction file, skills, hooks, and learning loop.

### 5. Re-audit

```bash
npx goat-flow audit .
```

Now passes. Add `--harness` to see advisory scoring across the 5 harness concerns (Context, Constraints, Verification, Recovery, Feedback Loop).

### 6. Try a skill

```
/goat review src/auth.ts
```

Skills are structured workflows the agent follows. `/goat` auto-routes to the right one -- debug, review, plan, security audit, test gap analysis, or multi-perspective critique (`/goat-critique`).

## The Five Harness Concerns

GOAT Flow's quality audit (`npx goat-flow audit . --harness`) evaluates your project's agent harness against 5 concerns - the things every major harness engineering source agrees matter for agent effectiveness.

| Concern | Question | What GOAT Flow checks |
|---------|----------|----------------------|
| **Context** | Is the agent's context accurate, lean, and useful? | Instruction file line count vs target, router table path resolution, footgun file:line evidence freshness, architecture doc existence (10+ lines) |
| **Constraints** | Do deterministic rules catch failures before the LLM runs? | Deny patterns cover secrets and dangerous commands, Ask First boundary count |
| **Verification** | Can the agent verify its work, and does failure feed back? | Test command configured, hook registrations in sync with hook files, commit guidance present |
| **Recovery** | Can the agent resume after crash or interruption? | Milestone file count in .goat-flow/tasks/, session log count in .goat-flow/logs/sessions/ |
| **Feedback Loop** | Is the harness getting smarter from failures over time? | Footgun entry count (3+ threshold), lesson entry count (3+ threshold), decisions directory activity |

These aren't a proprietary model - they're a synthesis of consensus across the harness engineering field. See [docs/audit-and-quality.md](docs/audit-and-quality.md) for the full framework and sources.

## Commands

```bash
npx goat-flow audit .                      # Validate setup correctness (pass/fail)
npx goat-flow audit . --harness            # Add advisory harness-quality scoring
npx goat-flow audit . --format json        # JSON output for CI
npx goat-flow quality . --agent claude     # Generate agent quality-assessment prompt
npx goat-flow setup . --agent claude       # Generate setup prompt for Claude Code
npx goat-flow setup . --agent gemini       # Gemini CLI setup
npx goat-flow setup . --agent codex        # Codex setup
npx goat-flow status .                     # Show project state (bare/partial/v0.9/v1.0/v1.1)
npx goat-flow dashboard .                  # Visual dashboard with integrated terminal
```

See [docs/cli.md](docs/cli.md) for the full command reference.

## Multi-Agent Support

Three first-class agents are supported by the CLI (`audit`, `quality`, `setup`, `dashboard`):

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
Expected. Run `npx goat-flow setup . --agent claude` and paste the output into your agent.

**Audit still fails after setup?**
Re-run `npx goat-flow audit . --verbose` to see which check failed. The `howToFix` hint on each failure points at the missing file or config key. If hooks show as uninstalled, check `.claude/hooks/` (or `.gemini/hooks/`, `.codex/hooks/`) exists and contains `deny-dangerous.sh`.

**Agent isn't following the execution loop?**
Restart the agent session after setup so it re-reads the instruction file (CLAUDE.md, GEMINI.md, or AGENTS.md). Agents only pick up instruction-file changes on session start.

**Not sure which agent to pick?**
Pick the one you're already using. All three agents share the same skills, execution loop, and learning loop -- only the instruction filename and hook directory differ. See the [Multi-Agent Support](#multi-agent-support) table.

## Documentation

| Document | What it covers |
|---|---|
| [CLI Reference](docs/cli.md) | All commands, flags, and output formats |
| [Skills Reference](docs/skills.md) | All 7 skills: modes, phases, gates, outputs |
| [Audit & Quality](docs/audit-and-quality.md) | The two evaluation commands, 5 harness concerns, and when to use each |
| [Dashboard](docs/dashboard.md) | Views, terminal, API endpoints |

## Author

Built by [Matthew Hansen](https://www.blundergoat.com/about).

## License

[MIT](LICENSE)
