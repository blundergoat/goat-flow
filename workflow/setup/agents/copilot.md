# Agent Config - Copilot CLI

> Canonical machine-readable source for these paths: `workflow/manifest.json`. If this doc drifts, the manifest-backed registry wins.

## Truth Order

1. User's explicit setup instruction for this session
2. This agent setup guide
3. `workflow/manifest.json` for machine-readable paths
4. `workflow/setup/reference/execution-loop.md` and `workflow/setup/02-instruction-file.md`
5. Existing target-project instructions and `.goat-flow/` docs

## Autonomy Tiers

**Always:** Set up Copilot-owned surfaces: `.github/copilot-instructions.md`, `.github/git-commit-instructions.md`, `.github/skills/`, `.github/hooks/`, `.copilotignore`, and shared `.goat-flow/`.

**Ask First:** Before touching non-Copilot surfaces, state boundary touched, related code read, footgun checked, local instruction checked, and rollback command.

**Never:** Freeze writes if interrupted or told no changes. Do not edit `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.claude/`, `.codex/`, `.gemini/`, or `.agents/` during Copilot setup unless the user explicitly widens scope.

## Hard Rules

- If a file exists, modify in place; do not create backup or variant files.
- `.github/copilot-instructions.md` is standalone and must not defer to `AGENTS.md`.
- Do not copy goat-flow's controlling-workspace Router Table into downstream projects; adapt paths to the target.
- Keep `.github/copilot-instructions.md` within the 150-line hard limit and 125-line target.
- Commit guidance belongs at `.github/git-commit-instructions.md` when `.github/` exists.
- Keep a single Copilot hook config file at `.github/hooks/hooks.json`; do not split one file per event.
- Do not create `.github/agents/` unless a future concrete gap justifies it.

## Key Resources

- **Learning loop** (grep before every change): `.goat-flow/footguns/`, `.goat-flow/lessons/`, `.goat-flow/patterns/`, `.goat-flow/decisions/`
- **Tool playbooks**: `.goat-flow/skill-playbooks/browser-use.md`, `.goat-flow/skill-playbooks/page-capture.md` — read BEFORE declaring a tool unavailable

## Essential Commands

```bash
# Replace with commands detected from the target project:
<lint command>
<typecheck command>
<test command>
```

Only include commands that exist and were verified in the target project. Agent settings/hooks checks are setup verification, not default Essential Commands.

## Execution Loop: READ → SCOPE → ACT → VERIFY

When a goat-* skill is active, its Step 0 replaces READ and selects the skill's mode/depth. SCOPE still applies before writes: a skill may write when its selected mode permits writes or the user explicitly approves them. `/goat-plan` File-Write may create gitignored milestone files without a separate approval gate; `/goat-debug` D3 still requires approval before fixes. Resume at ACT after Step 0 output or when a blocking gate releases.

### READ
MUST read relevant files before changes. Never fabricate codebase facts. For URL, local HTML, localhost, screenshot, rendered UI, or browser-visible behaviour, check browser evidence first: `command -v browser-use || command -v browser-use-python`; if available use `browser-use open/state/screenshot`, otherwise ask before installing or use manual fallback. Cross-doc: MUST read all files describing the same concept. Use grep-first retrieval across `.goat-flow/footguns/`, `.goat-flow/lessons/`, and `.goat-flow/patterns/`; include `.goat-flow/decisions/` when the task involves architecture, policy, or setup work. Before declaring any tool or capability unavailable, read the matching playbook in `.goat-flow/skill-playbooks/` (e.g. `browser-use.md`, `page-capture.md`) and run that doc's "Availability Check" section verbatim - project-local CLI tools at `~/.local/bin/` are valid; do not conflate "no harness/MCP tool" with "no tool". Open matching entries only, reword once on zero hits, then record a retrieval miss instead of broad-loading a bucket.
BAD: "The project has 20 audit checks" (guessed without reading)
GOOD: Read the relevant source, config, or generated instruction file before stating exact counts.

### SCOPE
Three signals before acting: (1) Intent: question → answer it, directive → act on it. (2) Complexity + budgets (below). (3) Mode: Plan / Implement / Explain / Debug / Review. MUST declare before acting: files allowed to change, non-goals, max blast radius. Expanding beyond scope = stop and re-scope with human.

| Complexity | Typical read budget | Typical turn budget |
|------------|-------------|-------------|
| Hotfix | 2 reads | 3 turns |
| Standard Feature | 4 reads | 10 turns |
| System Change | 6 reads | 20 turns |
| Infrastructure | 8 reads | 25 turns |

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

For Copilot setup, ACT means updating only Copilot-owned surfaces from the shared skeleton and adapting commands, boundaries, and Router Table rows to the target project.

### VERIFY
MUST run `shellcheck` on .sh changes. MUST check cross-references after renames. If working from a plan/milestone file, MUST tick `- [x]` on each task as it's completed - not at the end.

**Hallucination red-flags:**
1. **Checks passed.** Do not claim tests pass or any check passed (shellcheck, typecheck, preflight, audit) without showing the literal pass/fail line copied verbatim from this session's run. Paraphrase, cached output, or prior-session results do not count.
2. **Completion.** Do not claim completion without listing the specific files changed in this turn. If no files were changed, say so explicitly.
3. **Fix verification.** Do not claim a fix works without running the reproduction steps that originally demonstrated the bug. "Looks correct" is not verification.
4. **Hedged claims.** Do not use "should work", "probably fine", "looks good" as verification. These are guesses, not evidence.

- **Stop-the-line:** When tests break, builds fail, or behaviour regresses - stop expanding scope. Preserve evidence, return to diagnosis, re-plan before continuing.
- Level 1 (isolated): note, continue. Level 2 (cross-doc, broken refs, evidence): MUST full stop, wait for human. Two corrections on same approach = MUST rewind.
- Recovery: missing context → read first. Out-of-scope → name boundary, redirect. Conflicting sources → flag, ask.

If VERIFY caught a failure or you corrected course, update the learning loop before DoD: behavioural mistakes go in `.goat-flow/lessons/<category>.md`, cross-doc architectural traps go in `.goat-flow/footguns/<category>.md` with `**Status:** active | **Created:** YYYY-MM-DD | **Evidence:** ACTUAL_MEASURED`, significant technical decisions go in `.goat-flow/decisions/`, and optional continuity notes go in `.goat-flow/logs/sessions/`.

## Definition of Done

- `.github/copilot-instructions.md` exists, follows the canonical section order where compatible with Copilot compression, and stays under the hard line limit.
- Essential Commands list only real target-project commands.
- Router Table contains installed project resources only; no `workflow/setup/`, `workflow/hooks/`, or manifest paths.
- Tool playbook pointer to `.goat-flow/skill-playbooks/` is present.
- No hands-off agent files were changed.

## Artifact Routing

Requests to add footguns, lessons, decisions, or patterns route to the matching `.goat-flow/` directory after reading that directory's `README.md`: footguns -> `.goat-flow/footguns/`, lessons -> `.goat-flow/lessons/`, decisions -> `.goat-flow/decisions/`, patterns -> `.goat-flow/patterns/`. Runtime code, hooks, and agent config changes are out of scope unless the user explicitly asks for them.

## Router Table

| Resource | Path |
|----------|------|
| Instruction file | `.github/copilot-instructions.md` |
| Learning loop | `.goat-flow/footguns/`, `.goat-flow/lessons/`, `.goat-flow/patterns/`, `.goat-flow/decisions/` |
| Skill reference (meta) | `.goat-flow/skill-reference/` |
| Skill playbooks (tools) | `.goat-flow/skill-playbooks/` |
| Orientation | `.goat-flow/code-map.md`, `.goat-flow/glossary.md` |
| Architecture | `.goat-flow/architecture.md` |
| Copilot skills/config | `.github/skills/`, `.github/git-commit-instructions.md`, `.github/hooks/`, `.copilotignore` when installed |
| Project source/docs/config | adapt to detected project paths |
| Workspace notes | `.goat-flow/logs/sessions/`, `.goat-flow/tasks/` |
| Peer instructions | `CLAUDE.md`, `AGENTS.md`, `GEMINI.md` when present |
