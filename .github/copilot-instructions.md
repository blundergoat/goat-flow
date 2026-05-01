# Copilot Instructions - v1.3.2 (2026-04-25)
Documentation framework for AI coding agent workflows. Markdown docs + Bash scripts + TypeScript CLI auditor.

This repo is the goat-flow controlling workspace. When the dashboard or CLI operates on a selected target project, commands like `audit` and `quality` run against that target - not this repo. Keep the two contexts separate: framework code lives here, project-specific harness content lives in the target.
## Essential Commands

```bash
shellcheck scripts/*.sh scripts/maintenance/*.sh                                            # Lint shell scripts
bash -n scripts/*.sh scripts/maintenance/*.sh                                                # Syntax-check scripts
bash .github/hooks/deny-dangerous.sh --self-test   # Verify deny-hook runtime behaviour
bash scripts/preflight-checks.sh         # Full preflight gate
bash scripts/bump-version.sh <patch|minor|major|X.Y.Z>  # Bump package/docs/templates/mirrors
npm run typecheck                                 # Type-check .ts (required by DoD)
npm test                                          # Run fast test suite (excludes integration/drift/dashboard)
npm run test:full                                 # Run fast + slow suites before release-sensitive changes
node --import tsx src/cli/cli.ts stats . --check  # Learning-loop health: last_reviewed + stale refs
```
## Truth Order

User instruction > `.github/copilot-instructions.md` > `.goat-flow/architecture.md` > on-demand skills/templates.

## Execution Loop: READ → SCOPE → ACT → VERIFY

When a goat-* skill is active, its Step 0 replaces READ and selects the skill's mode/depth. SCOPE still applies before any file write - skills with write phases (e.g. `/goat-plan` Phase 2, `/goat-debug` D3) gate on explicit approval. Resume at ACT when the skill's first blocking gate releases.

**READ** - MUST read relevant files before changes. Never fabricate codebase facts. For URL, local HTML, localhost, screenshot, rendered UI, or browser-visible behaviour, check browser evidence first: `command -v browser-use && browser-use doctor`; if available use `browser-use open/state/screenshot`, otherwise ask before installing or use manual fallback. Cross-doc: MUST read all files describing the same concept. Use grep-first retrieval across `.goat-flow/footguns/`, `.goat-flow/lessons/`, and `.goat-flow/patterns.md`; include `.goat-flow/decisions/` when the task involves architecture, policy, or setup work. Open matching entries only, reword once on zero hits, then record a retrieval miss instead of broad-loading a bucket.
```
BAD:  "The CLI has 20 audit checks" (guessed without reading)
GOOD: Read src/cli/audit/check-goat-flow.ts → 13 setup checks, check-agent-setup.ts → 4 agent checks (17 total)
```

**SCOPE** - Three signals before acting: (1) Intent: question → answer it, directive → act on it. (2) Complexity budget: Hotfix 2 reads/3 turns; Standard 4/10; System 6/20; Infrastructure 8/25. (3) Mode: Plan / Implement / Explain / Debug / Review. MUST declare before acting: files allowed to change, non-goals, max blast radius. Over budget = checkpoint and re-classify; competent review may need broader coverage.

**ACT** - MUST declare: `State: [MODE] | Goal: [one line] | Exit: [condition]`

Modes: Plan = artifact only unless writes approved; Implement = edit in 2-3 turns, 4th read without writing means checkpoint; Explain = no changes unless asked; Debug = diagnosis with file:line before fixes; Review = investigate first, never blindly apply suggestions.

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

**Learning loop** (update before DoD if VERIFY caught a failure or you corrected course):
- Lesson → `.goat-flow/lessons/<category>.md`; footgun → `.goat-flow/footguns/<category>.md`; decision → `.goat-flow/decisions/`; optional `/compact` continuity note → `.goat-flow/logs/sessions/YYYY-MM-DD-slug.md`.

## Artifact Routing

When asked to add/update a goat-flow artifact, route to docs, not runtime code: footgun → `.goat-flow/footguns/<category>.md`; lesson → `.goat-flow/lessons/<category>.md`; decision → `.goat-flow/decisions/ADR-NNN.md`; pattern → `.goat-flow/patterns.md`. Read the target directory `README.md` first.

## Autonomy Tiers

**Always:** Read any file, lint scripts, edit within assigned scope. Session logs at `.goat-flow/logs/sessions/` are OPTIONAL continuity notes - write one when `/compact` fires without an active milestone file, otherwise skip. Learning-loop updates (lessons/footguns/decisions) follow the conditional rules above: update only when VERIFY caught a failure or you corrected course.

**Ask First** - before proceeding, state: boundary touched, related code read (yes/no), footgun entry checked (or "none"), local instruction checked, rollback command.

Boundaries: `workflow/setup/`, `workflow/skills/`, `workflow/manifest.json` (canonical agent inventory), `.goat-flow/architecture.md`, `.goat-flow/skill-reference/`, `src/cli/server/terminal.ts` (PTY runtime), `src/cli/server/dashboard.ts` (local HTTP/WS server), `.github/workflows/**`, `.github/actions/**`, `.github/hooks/**`, `.github/skills/**`, `.github/copilot-instructions.md`, `.claude/**`, `.codex/**`, `.gemini/**`, `.agents/**`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, any add/remove/rename (breaks cross-refs), changes spanning 3+ docs.

**Never:** Delete docs without replacement. Modify .env/secrets. Push. Commit unless asked. Invent hypothetical examples. Overwrite existing files without checking destination (`ls` before `mv`/`cp`/Write; use `mv -n`). Delete/move/overwrite 5+ files in one operation without listing targets and getting confirmation. If interrupted or told no changes, freeze writes; run only read-only status/diff checks until the user explicitly asks for cleanup, revert, or apply.

## Definition of Done

MUST confirm ALL: (1) lint/typecheck passes on changed files (shellcheck on .sh, npm run typecheck on .ts) (2) no broken cross-references (3) no unapproved boundary changes (4) logs updated if tripped (5) working notes current (6) grep old pattern after renames. If working from a milestone file, tick `- [x]` on each completed task immediately - not at the end. `/compact` after 15+ turns → split → `/clear` between unrelated tasks.

## Hard Rules
- If file exists, modify in-place. NEVER create `_modified`, `_new`, `_backup`, `_v2` variants.
- Severity: SECURITY > CORRECTNESS > INTEGRATION > PERFORMANCE > STYLE.
- MUST maintain cross-file consistency: same concept, same description everywhere.
- MUST preserve file-level evidence in footguns and examples. Use grep-friendly semantic anchors (function name, unique string, `(search: "pattern")`), not line numbers - they go stale on every edit (per ADR-024).
- MUST use real incidents, never hypothetical. `.goat-flow/architecture.md` is canonical source of truth.
- Sub-agents: ONE objective, structured return (paths, evidence, confidence, next step), 5-call budget. Blocked → one question with recommended default.

## Router Table
| Resource | Path |
|----------|------|
| Architecture | `.goat-flow/architecture.md` |
| CLI auditor/prompt code | `src/cli/` |
| Scripts | `scripts/` |
| Workflow source | `workflow/` (setup, skills, hooks, evaluation) |
| Skills | `.github/skills/` (goat, goat-critique, goat-debug, goat-plan, goat-qa, goat-review, goat-security) |
| Shared skill reference | `.goat-flow/skill-reference/` (skill-preamble.md, skill-conventions.md, browser-use.md, skill-quality-testing.md index + skill-quality-testing/tdd-iteration.md, skill-quality-testing/adversarial-framing.md, and skill-quality-testing/deployment.md per ADR-023) |
| Footguns, lessons, patterns | `.goat-flow/footguns/` (most-queried), `.goat-flow/lessons/`, `.goat-flow/patterns.md` |
| Decisions | `.goat-flow/decisions/` |
| Config | `.goat-flow/config.yaml` |
| Dashboard source | `src/dashboard/` |
| Documentation | `docs/` |
| Session logs, workspace | `.goat-flow/logs/sessions/`, `.goat-flow/tasks/` |
| Peer instructions | `CLAUDE.md`, `AGENTS.md`, `GEMINI.md` |
| Hooks | `.github/hooks/hooks.json`, `.github/hooks/deny-dangerous.sh` |

## Copilot-Specific

- Use current Copilot CLI commands (`/agent`, `/review`, `/research`, `/tasks`) when appropriate; use `/fleet` only for explicit or genuinely independent parallel work.
- Treat `.github/actions/**`, `.github/hooks/hooks.json`, `.github/hooks/deny-dangerous.sh`, `.github/skills/**`, `.github/copilot-instructions.md`, and `.copilotignore` as security-sensitive runtime surfaces; verify after touching them.
- `.github/agents/` is intentionally out of scope; CI/CD, hooks, prompts, or skills work should prefer `goat-security` or `goat-review`.
