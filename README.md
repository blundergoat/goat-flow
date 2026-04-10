# GOAT Flow

A structured workflow system for AI coding agents.

AI coding agents are powerful but unreliable. They skip verification steps, create duplicate files instead of editing in place, ignore project conventions, and repeat the same mistakes across sessions. GOAT Flow fixes this by giving agents a concrete operating system: an execution loop that enforces READ before writing, VERIFY before committing, and LOG before forgetting. It works with Claude Code, Gemini CLI, Codex, and Copilot.

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
CLASSIFY → Routes as "hotfix" — minimal ceremony
SCOPE   → Declares: editing auth.ts only, running existing tests
ACT     → Applies the fix in place
VERIFY  → Runs linter + tests, catches a type error, fixes it
LOG     → Records the footgun for future sessions
```

The agent follows the loop because it's built into the instruction file, enforced by hooks, and scored by the scanner.

## Getting Started

Requires Node.js 20+.

### 1. Install

```bash
npm install -g @blundergoat/goat-flow

# or use without installing
npx @blundergoat/goat-flow@latest scan .
```

### 2. Open the dashboard

```bash
goat-flow dashboard .
```

A local web UI opens with scanning, setup, and an integrated terminal.

![Dashboard](docs/assets/dashboard-preview.png)

### 3. Scan your project

```bash
goat-flow scan .
```

The scanner checks 79 rules across two tiers (Foundation, Standard) plus 12 anti-pattern deductions, and gives you a score. A fresh project scores 0% -- that's expected.

### 4. Generate setup for your agent

```bash
goat-flow setup . --agent claude
```

This prints a setup prompt. Paste it into Claude Code and let the agent configure your project: instruction file, skills, hooks, learning loop, and coding standards.

### 5. Rescan and see the difference

```bash
goat-flow scan .
```

Your score jumps. The scanner tells you exactly what was added and what's still missing.

### 6. Try a skill

```
/goat review src/auth.ts
```

Skills are structured workflows the agent follows. `/goat` auto-routes to the right one -- debug, review, plan, security audit, or test generation.

## What You Get

**Execution Loop** -- Every task follows READ, CLASSIFY, SCOPE, ACT, VERIFY, LOG. This prevents the agent from guessing at code it hasn't read, editing files outside its declared scope, or shipping without running checks.

**Skills** -- Six structured workflows (`/goat-debug`, `/goat-review`, `/goat-plan`, `/goat-security`, `/goat-test`, `/goat`) with phases and human gates. The `/goat` dispatcher classifies your request and routes to the right skill automatically.

**Enforcement Hooks** -- Pre-tool hooks intercept dangerous commands (`rm -rf`, force push, secret file access) and reject them with an explanation. Post-turn hooks run linting and type checking after every change. The deny-dangerous hook is advisory by default and blocking when registered as a pre-tool hook.

**Learning Loop** -- Agents record footguns, lessons, decisions, and session logs in `.goat-flow/`. Next session, they read these before acting. Mistakes stop repeating.

**Autonomy Tiers** -- Three-tier permission model (Always / Ask First / Never) built into the instruction file so agents know what they can do independently and what requires your approval.

**Coding Standards** -- 36 language and framework-specific templates covering backend, frontend, security, and DevOps.

## Commands

```bash
goat-flow dashboard .                  # Visual dashboard with integrated terminal
goat-flow scan .                       # Score your project (79 checks + 12 anti-patterns)
goat-flow setup . --agent claude       # Generate setup prompt for Claude Code

goat-flow scan . --format json         # JSON output for CI
goat-flow scan . --format markdown     # Markdown report
goat-flow setup . --agent gemini       # Gemini CLI setup
goat-flow setup . --agent codex        # Codex setup
```

See [docs/cli.md](docs/cli.md) for the full command reference.

## Multi-Agent Support

| | Claude Code | Gemini CLI | Codex | Copilot |
|---|---|---|---|---|
| Instruction file | CLAUDE.md | GEMINI.md | AGENTS.md | .github/copilot-instructions.md |
| Skills | .claude/skills/ | .github/skills/ | .agents/skills/ | .github/skills/ |
| Hooks | .claude/hooks/ | .gemini/hooks/ | .codex/hooks/ | - |

All agents share the same execution loop, autonomy tiers, skills, and learning loop. The `setup` command generates agent-specific configuration.

## Troubleshooting

**Terminal not showing in dashboard?**
node-pty didn't compile. Run `pnpm approve-builds` (select node-pty) or `npm rebuild node-pty`.

**Scan shows 0% on a fresh project?**
Expected. Run `goat-flow setup . --agent claude` and paste the output into your agent.

## Documentation

| Document | What it covers |
|---|---|
| [CLI Reference](docs/cli.md) | All commands, flags, and output formats |
| [Skills Reference](docs/skills/README.md) | All 6 skills: modes, phases, gates, outputs |

## Author

Built by [Matthew Hansen](https://www.blundergoat.com/about).

## License

[MIT](LICENSE)
