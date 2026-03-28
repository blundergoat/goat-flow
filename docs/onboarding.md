# Getting Started with GOAT Flow Skills

Your project has GOAT Flow configured. Here's how to use the skills effectively.

## Quickstart

Type **`/goat`** followed by what you need:

```
/goat fix the auth bug          → routes to /goat-debug
/goat review the PR             → routes to /goat-review
/goat plan the new feature      → routes to /goat-plan
/goat check for vulnerabilities → routes to /goat-security
/goat                           → shows options and asks what you need
```

`/goat` classifies your intent and routes to the right skill. You can also invoke skills directly (e.g., `/goat-debug`) if you know which one you want.

## First Session

1. **Read `CLAUDE.md`** (or `AGENTS.md` / `GEMINI.md`) — this is your instruction file. It has the execution loop, autonomy tiers, and router table.
2. **Check `docs/footguns.md`** — these are real traps in this codebase with file:line evidence. Read before making changes.
3. **Check `docs/lessons.md`** — behavioral mistakes that have happened before. Don't repeat them.
4. **Check `tasks/handoff.md`** — if a previous session left incomplete work, pick up where it left off.

## When to Use Each Skill

| I need to... | Use | Key constraint |
|-------------|-----|----------------|
| Fix a bug | `/goat-debug` | Diagnosis first. No fixes until human reviews. |
| Understand unfamiliar code | `/goat-investigate` | Read before acting. No planning until human reviews findings. |
| Plan a feature | `/goat-plan` | 4-phase process with human gates between each phase. |
| Write tests | `/goat-test` | Doer-verifier: the coding agent MUST NOT verify its own work. |
| Review a PR or diff | `/goat-review` | Read all changed files before commenting. Check footguns. |
| Rename across files | `/goat-refactor` | Read both sides first. Grep after every rename. |
| Improve readability | `/goat-simplify` | MUST NOT change behaviour. Prefer renaming over commenting. |
| Security assessment | `/goat-security` | Framework-aware verification. Rank by exploitability. |

### Modes (skills within skills)

- `/goat-review` also has **Audit Mode** (codebase-wide quality sweep) and **Instruction Review Mode** (check CLAUDE.md for staleness)
- `/goat-investigate` also has **Onboard Mode** (systematic codebase mapping for new contributors)

## Essential Workflow

```
READ → CLASSIFY → SCOPE → ACT → VERIFY → LOG
```

Before every change: **READ** the relevant files. **CLASSIFY** the task (question vs directive, complexity). **SCOPE** what you'll change. **ACT** within scope. **VERIFY** (tests, grep for old patterns after renames). **LOG** if you made a mistake or found a trap.

## Tips

- **Check footguns before touching risky code.** Every project has documented traps.
- **Skills are conversational.** Present findings, then let the human drill in. Don't dump everything at once.
- **When blocked, check the router table.** It tells you where to find documentation for any area.
- **When a hook blocks your command,** think about the safe alternative. `rm -rf` blocked? Use `rm file && rmdir dir`.
- **After renames, grep the entire repo** — including `.md` files, not just source code.

## Adding to the Learning Loop

When you make a mistake or discover a trap:
- **Behavioral mistake** (you did something wrong) → add to `docs/lessons.md`
- **Architectural trap** (the code has a hidden coupling) → add to `docs/footguns.md` with `file:line` evidence
- **Technical decision** (significant choice with trade-offs) → add to `docs/decisions/ADR-NNN-*.md`
