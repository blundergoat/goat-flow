# Copilot Instructions - v1.4.2 (2026-05-04)
Documentation framework for AI coding agent workflows. Markdown docs + Bash scripts + TypeScript CLI auditor.

goat-flow is a harness — guardrails, memory, and workflows for AI coding agents. Five concerns drive every design decision: **Context** (what you read), **Constraints** (what you may never do), **Verification** (how work is checked), **Recovery** (how state survives failure), **Feedback loop** (how mistakes become permanent fixes).

This repo is the goat-flow controlling workspace. When the dashboard or CLI operates on a selected target project, commands like `audit` and `quality` run against that target - not this repo. Keep the two contexts separate: framework code lives here, project-specific harness content lives in the target.

## Truth Order

User instruction > `.github/copilot-instructions.md` > `.goat-flow/architecture.md` > on-demand skills/templates.

## Autonomy Tiers

**Always:** Read any file, lint scripts, edit within assigned scope. Session logs at `.goat-flow/logs/sessions/` are OPTIONAL continuity notes - write one when `/compact` fires without an active milestone file, otherwise skip. Learning-loop updates (lessons/footguns/decisions) follow the conditional rules above: update only when VERIFY caught a failure or you corrected course.

**Ask First** - before proceeding, state: boundary touched, related code read (yes/no), footgun entry checked (or "none"), local instruction checked, rollback command.

Boundaries: instruction files (`.github/copilot-instructions.md`, `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`); workflow/manifest (`workflow/setup/`, `workflow/skills/`, `workflow/manifest.json`); architecture/playbooks (`.goat-flow/architecture.md`, `.goat-flow/skill-reference/`); server runtime (`src/cli/server/terminal.ts`, `src/cli/server/dashboard.ts`); agent configs (`.claude/**`, `.codex/**`, `.gemini/**`, `.agents/**`); CI/hooks (`.github/workflows/**`, `.github/actions/**`, `.github/hooks/**`, `.github/skills/**`); any add/remove/rename; changes spanning 3+ docs.

**Never:** If interrupted or told no changes, freeze writes; run only read-only status/diff checks until the user explicitly asks for cleanup, revert, or apply. Delete docs without replacement. Modify .env/secrets. Push. Commit unless asked. Invent hypothetical examples. Overwrite existing files without checking destination (`ls` before `mv`/`cp`/Write; use `mv -n`). Delete/move/overwrite 5+ files in one operation without listing targets and getting confirmation.

## Hard Rules
- If file exists, modify in-place. NEVER create `_modified`, `_new`, `_backup`, `_v2` variants.
- Severity: SECURITY > CORRECTNESS > INTEGRATION > PERFORMANCE > STYLE.
- MUST maintain cross-file consistency: same concept, same description everywhere.
- MUST preserve file-level evidence in footguns and examples. Use grep-friendly semantic anchors (function name, unique string, `(search: "pattern")`), not line numbers - they go stale on every edit (per ADR-024).
- MUST use real incidents, never hypothetical. `.goat-flow/architecture.md` is canonical source of truth.
- Sub-agents: ONE objective, structured return (paths, evidence, confidence, next step), 5-call budget. Blocked → one question with recommended default.
- No features, abstractions, or error handling beyond what was asked. Gold-plating is scope creep.
- Ambiguous requirements: present interpretations, don't pick silently.
- Use current Copilot CLI commands (`/agent`, `/review`, `/research`, `/tasks`) when appropriate; use `/fleet` only for explicit or genuinely independent parallel work.
- Treat `.github/actions/**`, `.github/hooks/hooks.json`, `.github/hooks/deny-dangerous.sh`, `.github/skills/**`, `.github/copilot-instructions.md`, and `.copilotignore` as security-sensitive runtime surfaces; verify after touching them.
- `.github/agents/` is intentionally out of scope; CI/CD, hooks, prompts, or skills work should prefer `goat-security` or `goat-review`.

## Key Resources

- **Learning loop** (grep before every change): `.goat-flow/footguns/`, `.goat-flow/lessons/`, `.goat-flow/patterns/`, `.goat-flow/decisions/`
- **Tool playbooks**: `.goat-flow/skill-reference/browser-use.md`, `.goat-flow/skill-reference/page-capture.md` — read BEFORE declaring a tool unavailable

## Essential Commands

```bash
shellcheck scripts/*.sh scripts/maintenance/*.sh
bash -n scripts/*.sh scripts/maintenance/*.sh
npm run typecheck
npm test
```

Situational: `preflight-checks.sh` (full gate), `bump-version.sh <ver>` (release), `test:full` (pre-release), `stats . --check` (learning-loop), `.github/hooks/deny-dangerous.sh --self-test` (hook check).

## Execution Loop: READ → SCOPE → ACT → VERIFY

When a goat-* skill is active, its Step 0 replaces READ and selects the skill's mode/depth. SCOPE still applies before any file write - skills with write phases (e.g. `/goat-plan` Phase 2, `/goat-debug` D3) gate on explicit approval. Resume at ACT when the skill's first blocking gate releases.

### READ
MUST read relevant files before changes. Never fabricate codebase facts. For URL, local HTML, localhost, screenshot, rendered UI, or browser-visible behaviour, check browser evidence first: `command -v browser-use || command -v browser-use-python`; if available use `browser-use open/state/screenshot`, otherwise ask before installing or use manual fallback. Cross-doc: MUST read all files describing the same concept. Use grep-first retrieval across `.goat-flow/footguns/`, `.goat-flow/lessons/`, and `.goat-flow/patterns/`; include `.goat-flow/decisions/` when the task involves architecture, policy, or setup work. Before declaring any tool or capability unavailable, read the matching playbook in `.goat-flow/skill-reference/` (e.g. `browser-use.md`, `page-capture.md`) and run that doc's "Availability Check" section verbatim - project-local CLI tools at `~/.local/bin/` are valid; do not conflate "no harness/MCP tool" with "no tool". Open matching entries only, reword once on zero hits, then record a retrieval miss instead of broad-loading a bucket.
BAD: "The CLI has 20 audit checks" (guessed without reading)
GOOD: Read check-goat-flow.ts → 14 setup checks, check-agent-setup.ts → 4 agent checks (18 total)

### SCOPE
Three signals before acting: (1) Intent: question → answer it, directive → act on it. (2) Complexity budget: Hotfix 2 reads/3 turns; Standard 4/10; System 6/20; Infrastructure 8/25. (3) Mode: Plan / Implement / Explain / Debug / Review. MUST declare before acting: files allowed to change, non-goals, max blast radius. Over budget = checkpoint and re-classify; competent review may need broader coverage.

### ACT
MUST declare: `State: [MODE] | Goal: [one line] | Exit: [condition]`

Modes: Plan = artifact only unless writes approved; Implement = edit in 2-3 turns, 4th read without writing means checkpoint; Explain = no changes unless asked; Debug = diagnosis with file:line before fixes; Review = investigate first, never blindly apply suggestions.

### VERIFY
MUST run `shellcheck` on .sh changes. MUST check cross-references after renames. If working from a plan/milestone file, MUST tick `- [x]` on each task as it's completed - not at the end.

**Hallucination red-flags:**
1. **Checks passed.** Do not claim tests pass or any check passed (shellcheck, typecheck, preflight, audit) without showing the literal pass/fail line copied verbatim from this session's run. Paraphrase, cached output, or prior-session results do not count.
2. **Completion.** Do not claim completion without listing the specific files changed in this turn. If no files were changed, say so explicitly.
3. **Fix verification.** Do not claim a fix works without running the reproduction steps that originally demonstrated the bug. "Looks correct" is not verification.
4. **Hedged claims.** Do not use "should work", "probably fine", "looks good" as verification. These are guesses, not evidence.

- **Stop-the-line:** When tests break, builds fail, or behaviour regresses — stop expanding scope. Preserve evidence, return to diagnosis, re-plan before continuing.
- Level 1 (isolated): note, continue. Level 2 (cross-doc, broken refs, evidence): MUST full stop, wait for human. Two corrections on same approach = MUST rewind.
- Recovery: missing context → read first. Out-of-scope → name boundary, redirect. Conflicting sources → flag, ask.

**Learning loop** (update before DoD if VERIFY caught a failure or you corrected course):
- Lesson → `.goat-flow/lessons/<category>.md`; footgun → `.goat-flow/footguns/<category>.md`; decision → `.goat-flow/decisions/`; optional `/compact` continuity note → `.goat-flow/logs/sessions/YYYY-MM-DD-slug.md`.

## Definition of Done

MUST confirm ALL: (1) lint/typecheck passes on changed files (shellcheck on .sh, npm run typecheck on .ts) (2) no broken cross-references (3) no unapproved boundary changes (4) logs updated if tripped (5) working notes current (6) grep old pattern after renames. If working from a milestone file, tick `- [x]` on each completed task immediately - not at the end. `/compact` after 15+ turns → split → `/clear` between unrelated tasks.

## Artifact Routing

When asked to add/update a goat-flow artifact, route to docs, not runtime code: footgun → `.goat-flow/footguns/<category>.md`; lesson → `.goat-flow/lessons/<category>.md`; decision → `.goat-flow/decisions/ADR-NNN.md`; pattern → `.goat-flow/patterns/<category>.md`. Read the target directory `README.md` first.

## Router Table
| Resource | Path |
|----------|------|
| Learning loop | `.goat-flow/footguns/`, `.goat-flow/lessons/`, `.goat-flow/patterns/`, `.goat-flow/decisions/` |
| Skill reference + tool playbooks | `.goat-flow/skill-reference/` (README.md index; read BEFORE declaring a tool unavailable) |
| Orientation | `.goat-flow/code-map.md`, `.goat-flow/glossary.md` |
| Architecture | `.goat-flow/architecture.md` |
| Skills | `.github/skills/` |
| Workflow source | `workflow/` (setup, skills, hooks, evaluation, agent config templates) |
| CLI + dashboard | `src/cli/`, `src/dashboard/` |
| Scripts | `scripts/` |
| Hooks | `.github/hooks/hooks.json`, `.github/hooks/deny-dangerous.sh` |
| Config | `.goat-flow/config.yaml` |
| Documentation | `docs/` |
| Session logs, workspace | `.goat-flow/logs/sessions/`, `.goat-flow/tasks/` |
| Peer instructions | `CLAUDE.md`, `AGENTS.md`, `GEMINI.md` |
