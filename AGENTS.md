# AGENTS.md - v1.2.0 (2026-04-20)
Documentation framework for AI coding agent workflows. Markdown docs + Bash validation scripts + TypeScript CLI/dashboard.
## Essential Commands
```bash
bash scripts/preflight-checks.sh
bash .codex/hooks/deny-dangerous.sh --self-test  # Codex: verify deny patterns registered (registered hook, not distributable copy)
node --import tsx src/cli/cli.ts stats . --check  # Learning-loop health: last_reviewed + stale refs
npm run typecheck                           # Type-check .ts (required by DoD)
bash -n scripts/*.sh scripts/maintenance/*.sh
shellcheck scripts/*.sh scripts/maintenance/*.sh
npm test                                    # Run test suite
```
## Truth Order

1. User's explicit instruction (this session)
2. Instruction file (AGENTS.md)
3. Architecture (.goat-flow/architecture.md)
4. Skills / templates (on-demand context)

## Execution Loop: READ → SCOPE → ACT → VERIFY

**READ** - MUST read relevant files before changes. Never fabricate codebase facts. Cross-doc: MUST read all files describing the same concept. Use grep-first retrieval across `.goat-flow/footguns/`, `.goat-flow/lessons/`, and `.goat-flow/patterns.md`; open matching entries only, reword once on zero hits, then record a retrieval miss instead of broad-loading a bucket.
```
BAD:  "The CLI has 20 audit checks" (guessed without reading)
GOOD: Read src/cli/audit/check-goat-flow.ts → 13 setup checks, check-agent-setup.ts → 4 agent checks (17 total)
```

**SCOPE** - Three signals before acting: (1) Intent: question → answer it, directive → act on it. (2) Complexity + budgets (below). (3) Mode: Plan / Implement / Explain / Debug / Review. MUST declare before acting: files allowed to change, non-goals, max blast radius. Expanding beyond scope = stop and re-scope with human.

| Complexity | Typical read budget | Typical turn budget |
|------------|-------------|-------------|
| Hotfix | 2 reads | 3 turns |
| Standard Feature | 4 reads | 10 turns |
| System Change | 6 reads | 20 turns |
| Infrastructure | 8 reads | 25 turns |

Over budget = checkpoint and re-classify before continuing. Budgets are planning heuristics, not a hard stop when competent review requires broader coverage.

**ACT** - MUST declare: `State: [MODE] | Goal: [one line] | Exit: [condition]`

| Mode | Behaviour |
|------|-----------|
| Plan | Produce artefact only. File writes (e.g. milestone files) only on explicit approval. Exit on LGTM |
| Implement | Edit in 2-3 turns. 4th read without writing = checkpoint or re-scope |
| Explain | Walkthrough only. No changes unless asked |
| Debug | Diagnosis with file:line first. Fixes after human reviews |
| Review | Investigate first. Never blindly apply suggestions |

**VERIFY** - MUST run `shellcheck` on .sh changes. MUST check cross-references after renames. If working from a plan/milestone file, MUST tick `- [x]` on each task as it's completed - not at the end.

**Hallucination red-flags:**
1. **Tests pass.** Do not claim tests pass without showing the actual terminal output, or at minimum the literal pass/fail summary line copied verbatim from this session's run. A paraphrase, or a cached or prior-session pass, does not count.
2. **Completion.** Do not claim completion without listing the specific files changed in this turn. If no files were changed, say so explicitly.
3. **Fix verification.** Do not claim a fix works without running the reproduction steps that originally demonstrated the bug. "Looks correct" is not verification.
4. **Hedged claims.** Do not use "should work", "probably fine", "looks good" as verification. These are guesses, not evidence.
5. **Check passed.** Do not claim a check passed (shellcheck, typecheck, preflight, audit) without showing the command and its output in the same turn - verbatim output, or at minimum the literal pass/fail line copied from it.

- Level 1 (isolated): note, continue. Level 2 (cross-doc, broken refs, evidence): MUST full stop, wait for human
- Two corrections on same approach = MUST rewind
- Recovery: missing context → read first. Out-of-scope → name boundary, redirect. Conflicting sources → flag, ask.

If VERIFY caught a failure or you corrected course, update the learning loop before DoD:

| File | When to update |
|------|---------------|
| `.goat-flow/lessons/<category>.md` | Behavioural mistake. Append `## Lesson: <name>` + `**Created:** YYYY-MM-DD`. |
| `.goat-flow/footguns/<category>.md` | Cross-doc architectural trap. Append `## Footgun: <name>` + `**Status:** active \| **Created:** YYYY-MM-DD \| **Evidence:** ACTUAL_MEASURED` with grep-friendly file evidence. |
| `.goat-flow/decisions/` | Significant technical decision with context/rationale. |
| `.goat-flow/logs/sessions/` | Workspace-local session notes. Gitignored by design; only the directory anchor is committed. |

## Autonomy Tiers

**Always:** Read any file, run validation scripts, edit within declared scope, add Codex artifacts. Session logs at `.goat-flow/logs/sessions/` are OPTIONAL continuity notes - write one when `/compact` fires without an active milestone file, otherwise skip. Learning-loop updates (lessons/footguns/decisions) follow the conditional rule above: update only when VERIFY caught a failure or you corrected course.

**Ask First** - before proceeding, state: boundary touched, related code read (yes/no), footgun entry checked (or "none"), local instruction checked (`.github/instructions/` / `AGENTS.md` / none), rollback command.

Boundaries:
- `.goat-flow/architecture.md` or primary instruction file changes (this file - `AGENTS.md`)
- `workflow/setup/` or `workflow/skills/` template changes affecting generated output
- `workflow/manifest.json` (canonical agent inventory)
- `src/cli/server/terminal.ts` (PTY runtime) and `src/cli/server/dashboard.ts` (local HTTP/WS server)
- `.github/workflows/**` (CI changes alter validation and release behavior)
- `.github/hooks/**`, `.github/skills/**`, `.github/copilot-instructions.md` (Copilot runtime surfaces per ADR-020)
- `.claude/**`, `.codex/**`, `.gemini/**`, `.agents/**` (agent runtime files)
- Other instruction files (`CLAUDE.md`, `GEMINI.md`)
- Adding, removing, or renaming files
- Changes spanning 3+ docs/scripts

**Never:** Delete docs without replacement, invent incidents or evidence, edit secrets, commit or push unless asked, run destructive git commands, claim verification passed without running it. Overwrite existing files without checking destination (`ls` before `mv`/`cp`/Write; use `mv -n`).

## Definition of Done
MUST confirm ALL: (1) lint/typecheck passes on changed files (shellcheck on .sh, npm run typecheck on .ts) (2) no broken cross-references introduced (3) no unapproved boundary changes (4) logs updated if tripped (5) working notes current (6) grep old pattern after renames

## Working Memory
If working from a plan/milestone file, tick `- [x]` on each completed task immediately - not at the end. If context drifts or two approaches fail, restate scope and start fresh.

## Router Table
| Resource | Path |
|----------|------|
| Architecture | `.goat-flow/architecture.md` |
| CLI auditor/prompt code | `src/cli/` |
| Scripts | `scripts/` |
| Workflow source | `workflow/` (setup, skills, hooks, evaluation) |
| Skills | `.agents/skills/` (goat, goat-critique, goat-debug, goat-plan, goat-qa, goat-review, goat-security) |
| Footguns (most-queried) | `.goat-flow/footguns/` |
| Lessons | `.goat-flow/lessons/` |
| Patterns | `.goat-flow/patterns.md` |
| Decisions | `.goat-flow/decisions/` |
| Config | `.goat-flow/config.yaml` |
| Dashboard source | `src/dashboard/` |
| Documentation | `docs/` |
| Session logs, workspace | `.goat-flow/logs/sessions/`, `.goat-flow/tasks/` |
| Peer instructions | `CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md` |

## Hard Rules
- If file exists, modify in-place. NEVER create `_modified`, `_new`, `_backup`, `_v2` variants.
- Severity: SECURITY > CORRECTNESS > INTEGRATION > PERFORMANCE > STYLE
- MUST maintain cross-file consistency: same concept, same description everywhere
- MUST preserve file evidence in footguns and examples. Prefer grep-friendly semantic anchors; use `file:line` only when the line is the proof.
- MUST use real incidents, never hypothetical. `.goat-flow/architecture.md` is canonical source of truth
- Sub-agents: ONE objective, structured return (paths, evidence, confidence, next step), 5-call budget. Blocked → one question with recommended default.
