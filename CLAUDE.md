# CLAUDE.md - v1.11.0 (2026-06-11)
Documentation framework for AI coding agent workflows. Markdown docs + Bash scripts + TypeScript CLI auditor.

goat-flow is a harness - guardrails, memory, and workflows for AI coding agents. Five concerns drive every design decision: **Context** (what you read), **Constraints** (what you may never do), **Verification** (how work is checked), **Recovery** (how state survives failure), **Feedback loop** (how mistakes become permanent fixes).

This repo is the goat-flow controlling workspace. When the dashboard or CLI operates on a selected target project, commands like `audit` and `quality` run against that target - not this repo. Keep the two contexts separate: framework code lives here, project-specific harness content lives in the target.

## Truth Order

User's explicit instruction (this session) > CLAUDE.md > `.goat-flow/architecture.md` > skills / templates (on-demand).

## Autonomy Tiers

**Always:** Read any file, lint scripts, edit within assigned scope. Session logs at `.goat-flow/logs/sessions/` are OPTIONAL continuity notes - write one when `/compact` fires without an active milestone file; otherwise skip. Learning-loop updates (lessons/footguns/decisions) are conditional: update only when VERIFY caught a failure or you corrected course.

**Ask First** - before touching a boundary, ask and wait for approval. Include: boundary touched, related code read (yes/no), footgun entry checked (or "none"), local instruction checked, rollback command.

Boundaries: instruction files (`CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`); workflow/manifest (`workflow/setup/`, `workflow/skills/`, `workflow/manifest.json`); architecture (`.goat-flow/architecture.md`); skill reference (`.goat-flow/skill-docs/`); skill playbooks (`.goat-flow/skill-docs/playbooks/`); server runtime (`src/cli/server/terminal.ts`, `src/cli/server/dashboard.ts`); agent configs (`.claude/**`, `.codex/**`, `.agents/**`); CI/hooks (`.github/workflows/**`, `.github/actions/**`, `.github/hooks/**`, `.github/skills/**`); any add/remove/rename; changes spanning 3+ docs.

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

## Commit Messages

Conventional `type(scope): subject` - imperative, ≤72 chars, concrete verbs not weak ones (*enhance, improve, update*); one change per subject. On a `feat/<digits>` branch the subject starts `#<digits> ` (e.g. `#123 feat(audit): add drift cache`), from the branch name only; otherwise no prefix. Full rules + bad→good rewrites: `docs/coding-standards/git-commit.md`.

## Key Resources

- **Learning loop** (grep before every change): `.goat-flow/learning-loop/footguns/`, `.goat-flow/learning-loop/lessons/`, `.goat-flow/learning-loop/patterns/`, `.goat-flow/learning-loop/decisions/`
- **Tool playbooks**: `.goat-flow/skill-docs/playbooks/README.md` is the full index (examples: `.goat-flow/skill-docs/playbooks/browser-use.md`, `.goat-flow/skill-docs/playbooks/page-capture.md`) - read BEFORE declaring a tool unavailable

## Essential Commands

```bash
shellcheck scripts/*.sh scripts/maintenance/*.sh scripts/installers/*.sh workflow/hooks/*.sh workflow/hooks/deny-dangerous/*.sh .goat-flow/hooks/*.sh .goat-flow/hooks/deny-dangerous/*.sh
bash -n scripts/*.sh scripts/maintenance/*.sh scripts/installers/*.sh workflow/hooks/*.sh workflow/hooks/deny-dangerous/*.sh .goat-flow/hooks/*.sh .goat-flow/hooks/deny-dangerous/*.sh
npm run typecheck
npm test
bash scripts/preflight-checks.sh
```

Situational: `bump-version.sh <ver>` (release), `test:full` (pre-release), `node --import tsx src/cli/cli.ts stats --check` (learning-loop), `bash .goat-flow/hooks/deny-dangerous.sh --self-test=full` (hook check).

## Execution Loop: READ → SCOPE → ACT → VERIFY

When a goat-* skill is active, its Step 0 replaces READ and selects the skill's mode/depth. SCOPE still applies before writes: a skill may write when its selected mode permits writes or the user explicitly approves them. `/goat-plan` File-Write may create gitignored milestone files without a separate approval gate; `/goat-debug` D3 still requires approval before fixes. Resume at ACT after Step 0 output or when a blocking gate releases.

### READ
MUST read relevant files before changes. Never fabricate codebase facts. For URL, local HTML, localhost, screenshot, rendered UI, or browser-visible behaviour, check browser evidence first: `command -v browser-use || command -v browser-use-python`; if available use `browser-use open/state/screenshot`, otherwise ask before installing or use manual fallback. Cross-doc: MUST read all files describing the same concept. Use INDEX-first retrieval across `.goat-flow/learning-loop/{footguns,lessons,patterns}/INDEX.md`; include `.goat-flow/learning-loop/decisions/INDEX.md` when the task involves architecture, policy, or setup work. Open source entries only on candidate hits; grep bucket files only after the INDEX pass or on a known retrieval miss; reword once on zero hits, then record a retrieval miss instead of broad-loading a bucket. Before declaring any tool or capability unavailable, read the matching playbook in `.goat-flow/skill-docs/playbooks/` (e.g. `browser-use.md`, `page-capture.md`) and run that doc's "Availability Check" section verbatim - project-local CLI tools at `~/.local/bin/` are valid; do not conflate "no harness/MCP tool" with "no tool".
BAD: "The CLI has 30 audit checks" (guessed without reading)
GOOD: Read check-goat-flow.ts → 16 setup checks, check-agent-setup.ts → 4 agent checks (20 total)

### SCOPE
Three signals before acting: (1) Intent: question → answer it, directive → act on it. (2) Complexity budget: Hotfix 2 reads/3 turns; Small Feature 3/5; Standard 4/10; System 6/20; Infrastructure 8/25. (3) Mode: Plan / Implement / Explain / Debug / Review. MUST declare before acting: files allowed to change, non-goals, max blast radius. Expanding beyond scope = stop and re-scope with human.

Over budget = checkpoint and re-classify before continuing. Complexity-class budgets are heuristics, not a hard stop when competent review needs broader coverage.

### ACT
MUST declare: `State: [MODE] | Goal: [one line] | Exit: [condition]`

| Mode | Behaviour |
|------|-----------|
| Plan | Produce planning artefacts. `/goat-plan` File-Write may create gitignored milestone files when selected; committed files still require explicit approval. Exit on LGTM |
| Implement | Edit in 2-3 turns. 4th read without writing = checkpoint or re-scope |
| Explain | Walkthrough only. No changes unless asked |
| Debug | Diagnosis with file + semantic anchor first. Fixes after human reviews |
| Review | Investigate first. Never blindly apply suggestions |

### VERIFY
MUST run `shellcheck` on .sh changes. MUST check cross-references after renames. If working from a plan/milestone file, MUST tick `- [x]` on each task as it's completed - not at the end.

**Hallucination red-flags:**
1. **Checks passed.** Do not claim tests pass or any check passed (shellcheck, typecheck, preflight, audit) without showing the literal pass/fail line copied verbatim from this session's run. Paraphrase, cached output, or prior-session results do not count.
2. **Completion.** Do not claim completion without listing the specific files changed in this turn. If no files were changed, say so explicitly.
3. **Fix verification.** Do not claim a fix works without running the reproduction steps that originally demonstrated the bug. "Looks correct" is not verification.
4. **Hedged claims.** Do not use "should work", "probably fine", "looks good" as verification. These are guesses, not evidence.

The red-flags above name WHAT not to claim. The Excuse/Reality table in `.goat-flow/skill-docs/skill-preamble.md` (search: `Rationalisations to reject`) names the specific rationalisations that defeat the red-flags ("I'm confident", "Just this once", "Linter passed", etc.). Apply both before any completion or fix claim.

- **Stop-the-line:** When tests break, builds fail, or behaviour regresses - stop expanding scope. Preserve evidence, return to diagnosis, re-plan before continuing.
- Level 1 (isolated): note, continue. Level 2 (cross-doc, broken refs, evidence): MUST full stop, wait for human. Two corrections on same approach = MUST rewind.
- Recovery: missing context → read first. Out-of-scope → name boundary, redirect. Conflicting sources → flag, ask.

If VERIFY caught a failure or you corrected course, update the learning loop before DoD: behavioural mistakes go in `.goat-flow/learning-loop/lessons/<category>.md`, cross-doc architectural traps go in `.goat-flow/learning-loop/footguns/<category>.md` with `**Status:** active | **Created:** YYYY-MM-DD | **Evidence:** ACTUAL_MEASURED`, significant technical decisions go in `.goat-flow/learning-loop/decisions/`, and optional continuity notes go in `.goat-flow/logs/sessions/`.

## Definition of Done

MUST confirm ALL: (1) lint/typecheck passes on changed files (shellcheck on .sh, npm run typecheck on .ts) (2) no broken cross-references (3) no unapproved boundary changes (4) logs updated if tripped (5) working notes current (6) grep old pattern after renames. If working from a milestone file, tick `- [x]` on each completed task immediately - not at the end. `/compact` after 15+ turns → split → `/clear` between unrelated tasks.

## Artifact Routing

When asked to add, create, or update a goat-flow artifact, route it to the artifact directory, not runtime code: footguns -> `.goat-flow/learning-loop/footguns/<category>.md`; lessons -> `.goat-flow/learning-loop/lessons/<category>.md`; decisions -> `.goat-flow/learning-loop/decisions/ADR-NNN.md`; patterns -> `.goat-flow/learning-loop/patterns/<category>.md`. Before editing, read the target directory's `README.md`; do not treat artifact requests as runtime-code requests unless the user explicitly asks for code too.

## Router Table
| Resource | Path |
|----------|------|
| Learning loop | `.goat-flow/learning-loop/footguns/`, `.goat-flow/learning-loop/lessons/`, `.goat-flow/learning-loop/patterns/`, `.goat-flow/learning-loop/decisions/` |
| Skill reference (meta) | `.goat-flow/skill-docs/` (skill-preamble.md + skill-conventions.md, composed into every skill) |
| Skill playbooks (tools) | `.goat-flow/skill-docs/playbooks/` (README.md index; read BEFORE declaring a tool unavailable) |
| Orientation | `.goat-flow/code-map.md`, `.goat-flow/glossary.md` |
| Architecture | `.goat-flow/architecture.md` |
| Skills | `.claude/skills/` |
| Workflow source | `workflow/` (setup, skills, hooks, evaluation, agent config templates) |
| CLI + dashboard | `src/cli/`, `src/dashboard/` |
| Scripts | `scripts/` |
| Config | `.goat-flow/config.yaml` |
| Documentation | `docs/` |
| Session logs, workspace | `.goat-flow/logs/sessions/`, `.goat-flow/plans/` |
| Peer instructions | `AGENTS.md`, `.github/copilot-instructions.md` |
