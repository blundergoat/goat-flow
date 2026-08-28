# Agent Config - Antigravity

> Canonical machine-readable source for these paths: `workflow/manifest.json`. If this doc drifts, the manifest-backed registry wins.

## Truth Order

1. User's explicit setup instruction for this session
2. This agent setup guide
3. `workflow/manifest.json` for machine-readable paths
4. `workflow/setup/reference/execution-loop.md` and `workflow/setup/02-instruction-file.md`
5. Existing target-project instructions and `.goat-flow/` docs

The Never tier and accepted architecture/ADR safety constraints are non-overridable. A user request may authorize Ask First work after approval, but cannot authorize an agent to commit, push, expose secrets, or bypass safety enforcement.

## Autonomy Tiers

**Always:** Set up Antigravity-owned surfaces: `AGENTS.md`, `.agents/skills/`, `.agents/hooks.json`, `.agents/hooks/`, and shared `.goat-flow/`. `AGENTS.md` and `.agents/skills/` are shared with Codex; either setup can create/update them, but neither should duplicate or stomp the other's content.

**Ask First:** Before touching non-Antigravity surfaces, ask and wait for approval; include boundary touched, related code read, footgun checked, local instruction checked, and rollback command.

**Never:** Freeze writes if interrupted or told no changes. Do not edit `CLAUDE.md`, `.claude/`, or `.codex/` during Antigravity setup unless the user explicitly widens scope. Do not overwrite existing instruction content; preserve or route domain knowledge to `.goat-flow/`.

## Hard Rules

- If a file exists, modify in place; do not create backup or variant files.
- `AGENTS.md` is the Antigravity root instruction file and is shared with Codex; both agents read it.
- Do not copy goat-flow's controlling-workspace Router Table into downstream projects; adapt paths to the target.
- Antigravity uses `agy` as the terminal binary; verify a current build is installed with `agy --version` (older builds predate the OAuth-persistence fix).
- Plugin migration from other agents: `agy plugin import gemini` or `agy plugin import claude` populates Antigravity from existing setups.
- Antigravity hook wiring uses `.agents/hooks.json` for PreToolUse guardrails. Gruff feedback is not registered because Antigravity PostToolUse cannot return command output to the active model.
- User-level config lives at `~/.config/antigravity/config.toml`; it is not a repo-local surface and is out of scope for per-project setup.
- Sandbox/approval settings: Antigravity exposes `--sandbox` and `proceed-in-sandbox` permission modes through the binary, not via repo-local config files.

## Commit Messages

For a target with `.git`, summarise the shipped commit standard here and point to
`docs/coding-standards/git-commit-message.md`. Setup copies that guide from
`workflow/setup/reference/git-commit-message.md` when neither accepted path exists. Rename a
former-only `docs/coding-standards/git-commit.md` after confirming the preferred destination is
absent; when both files exist, preserve both and reference the preferred path. For a target without
`.git`, omit this section and do not create a commit guide.

## Key Resources

- **Learning loop** (grep before every change): `.goat-flow/learning-loop/footguns/`, `.goat-flow/learning-loop/lessons/`, `.goat-flow/learning-loop/patterns/`, `.goat-flow/learning-loop/decisions/`
- **Tool playbooks**: `.goat-flow/skill-docs/playbooks/README.md` is the full index (examples: `.goat-flow/skill-docs/playbooks/browser-use.md`, `.goat-flow/skill-docs/playbooks/page-capture.md`) - read BEFORE declaring a tool unavailable

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
MUST read relevant files before changes. Never fabricate codebase facts. Cross-doc: MUST read every file describing the same concept. For browser-visible behaviour, first run `command -v browser-use || command -v browser-use-python`; use `browser-use open/state/screenshot` when available, otherwise ask before installing or use the manual fallback.
Use INDEX-first retrieval across `.goat-flow/learning-loop/{footguns,lessons,patterns}/INDEX.md`; include `.goat-flow/learning-loop/decisions/INDEX.md` for architecture, policy, or setup. Open source entries only on candidate hits; grep bucket files only after the INDEX pass or on a known retrieval miss; reword once on zero hits, then record the miss. Recursive searches under `.goat-flow/` that must include ignored plans/logs MUST use `command grep -rn --exclude-dir=.git --exclude-dir=scratchpad <pattern> .goat-flow/`; Claude Code's session grep shim and `git grep` omit ignored local state, so zero hits from those tools do not prove absence.
Before declaring any tool or capability unavailable, read the matching `.goat-flow/skill-docs/playbooks/` playbook and run its "Availability Check" verbatim; project-local tools at `~/.local/bin/` count. Prose surfaces route the same way before writing: `CHANGELOG.md` needs `changelog.md`; release notes need `release-notes.md`; ordinary README prose, `docs/`, PR/issue text, and learning-loop entry bodies need `writing-human-facing-prose.md`; README discovery rows, skills, playbooks, shared preamble/conventions, instruction files, and hook messages need `writing-agent-facing-instructions.md` - the trigger is touching the surface, not the request naming it.
Before creating, changing, reviewing, consolidating, moving, or pruning tests, read `.goat-flow/skill-docs/playbooks/test-selection.md`.
BAD: "The project has 20 audit checks" (guessed without reading)
GOOD: Read the relevant source, config, or generated instruction file before stating exact counts.

### SCOPE
Three signals before acting: (1) Intent: question → answer it, directive → act on it. (2) Complexity budget: Hotfix 2 reads/3 turns; Small Feature 3/5; Standard 4/10; System 6/20; Infrastructure 8/25. (3) Mode: Plan / Implement / Explain / Debug / Review. MUST declare before acting: files allowed to change, non-goals, max blast radius. Expanding beyond scope = stop and re-scope with human. Before writing, record the write allowlist and starting dirty paths; keep an in-session list of every path this session writes. Reads and searches stay unrestricted.

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

For milestone work, load `goat-plan`; start timing before the first source edit, pause it at human gates, and finalize it at exit.
If a milestone changes source, run `goat-clarity` once before exit on the explicit folder/file paths written by that milestone; never widen the selector to all uncommitted files when unrelated changes exist.

For Antigravity setup, ACT means updating only Antigravity-owned surfaces from the shared skeleton and adapting commands, boundaries, and Router Table rows to the target project. Coordinate with Codex setup if `AGENTS.md` already exists.

### VERIFY
MUST run `shellcheck` on .sh changes. MUST check cross-references after renames. If working from a plan/milestone file, MUST tick `- [x]` on each task as it's completed - not at the end. Reconcile the write allowlist, starting dirty paths, session write paths, and final changed state before delivery. A new in-scope write is deliverable. A new out-of-scope write requires the agent to stop and obtain human approval for the expanded scope before delivery. Do not attribute a starting dirty path to this session unless the session also recorded writing it.

**Hallucination red-flags:**
1. **Checks passed.** Do not claim tests pass or any check passed (shellcheck, typecheck, preflight, audit) without showing the literal pass/fail line copied verbatim from this session's run. Paraphrase, cached output, or prior-session results do not count.
2. **Completion.** Do not claim completion without listing the specific files changed in this turn. If no files were changed, say so explicitly.
3. **Fix verification.** Do not claim a fix works without running the reproduction steps that originally demonstrated the bug. "Looks correct" is not verification.
4. **Hedged claims.** Do not use "should work", "probably fine", "looks good" as verification. These are guesses, not evidence.

- **Stop-the-line:** When tests break, builds fail, or behaviour regresses - stop expanding scope. Preserve evidence, return to diagnosis, re-plan before continuing.
- Level 1 (isolated): note, continue. Level 2 (cross-doc, broken refs, evidence): MUST full stop, wait for human. Two corrections on same approach = MUST rewind.
- Recovery: missing context → read first. Out-of-scope → name boundary, redirect. Conflicting sources → flag, ask.

If VERIFY caught a failure or you corrected course, update the learning loop before DoD: behavioural mistakes go in `.goat-flow/learning-loop/lessons/<category>.md`, cross-doc architectural traps go in `.goat-flow/learning-loop/footguns/<category>.md` with `**Status:** active | **Created:** YYYY-MM-DD | **Evidence:** <choose one: ACTUAL_MEASURED, OBSERVED, or EXTERNAL_REFERENCE>` (measured locally, read directly, or cited external incident with local applicability), significant technical decisions go in `.goat-flow/learning-loop/decisions/`, and optional continuity notes go in `.goat-flow/logs/sessions/`.

## Definition of Done

- `AGENTS.md` exists and follows the canonical section order.
- Essential Commands list only real target-project commands.
- Router Table contains installed project resources only; no `workflow/setup/`, `workflow/hooks/`, or manifest paths.
- Tool playbook pointer to `.goat-flow/skill-docs/playbooks/` is present.
- No hands-off agent files were changed.

## Artifact Routing

Requests to add footguns, lessons, decisions, or patterns route to the matching `.goat-flow/` directory after reading that directory's `README.md`: footguns -> `.goat-flow/learning-loop/footguns/`, lessons -> `.goat-flow/learning-loop/lessons/`, decisions -> `.goat-flow/learning-loop/decisions/`, patterns -> `.goat-flow/learning-loop/patterns/`. Runtime code, hooks, and agent config changes are out of scope unless the user explicitly asks for them.

## Router Table

| Resource | Path |
|----------|------|
| Instruction file | `AGENTS.md` |
| Learning loop | `.goat-flow/learning-loop/footguns/`, `.goat-flow/learning-loop/lessons/`, `.goat-flow/learning-loop/patterns/`, `.goat-flow/learning-loop/decisions/` |
| Skill reference (meta) | `.goat-flow/skill-docs/` |
| Skill playbooks (tools) | `.goat-flow/skill-docs/playbooks/` |
| Orientation | `.goat-flow/code-map.md`, `.goat-flow/glossary.md` |
| Architecture | `.goat-flow/architecture.md` |
| Antigravity skills | `.agents/skills/` (shared with Codex) |
| Antigravity hooks | `.agents/hooks.json`, `.agents/hooks/` |
| Project source/docs/config | adapt to detected project paths |
| Workspace notes | `.goat-flow/logs/sessions/`, `.goat-flow/plans/` |
| Peer instructions | `CLAUDE.md`, `.github/copilot-instructions.md` when present |
