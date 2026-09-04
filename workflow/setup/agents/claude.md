# Agent Config - Claude Code

> Canonical machine-readable source for these paths: `workflow/manifest.json`. If this doc drifts, the manifest-backed registry wins.

## Truth Order
1. User's explicit setup instruction for this session
2. This agent setup guide
3. `workflow/manifest.json` for machine-readable paths
4. `workflow/setup/reference/execution-loop.md` and `workflow/setup/02-instruction-file.md`
5. Existing target-project instructions and `.goat-flow/` docs

The Never tier and accepted architecture/ADR safety constraints are non-overridable. A user request may authorize Ask First work after approval, but cannot authorize an agent to commit, push, expose secrets, or bypass safety enforcement.

## Autonomy Tiers
**Always:** Read any permitted, non-secret file needed for setup. Set up Claude-owned surfaces: `CLAUDE.md`, `.claude/`, and shared `.goat-flow/`. Merge with existing `.goat-flow/` content instead of replacing it.
**Ask First:** before modifying a boundary outside Claude ownership, ask and wait for approval; include boundary touched, related code read, footgun checked, local instruction checked, and rollback command.
**Never:** Freeze writes if interrupted or told no changes. Do not edit `AGENTS.md`, `.agents/`, `.codex/`, `.github/copilot-instructions.md`, `.github/skills/`, or `.github/hooks/` during Claude setup unless the user explicitly widens scope. Do not overwrite existing instruction content; preserve or route domain knowledge to `.goat-flow/`.

## Hard Rules
- If a file exists, modify in place; do not create backup or variant files.
- Do not copy goat-flow's controlling-workspace Router Table into downstream projects; adapt paths to the target.
- Keep `CLAUDE.md` under the 125-line target and 150-line hard limit.
- For path-scoped Claude Code guidance, use `.claude/rules/*.md` with `paths:` frontmatter; keep repository-wide rules in `CLAUDE.md`.
- Apply the Attribution settings section below before completing Claude setup, including the Step 01 state-check early exit.
- Ambiguous existing instruction content: preserve first, ask before deleting.

## Commit Messages
When the user asks for a draft commit message, use Conventional `type(scope): subject` - imperative, ≤72 chars, concrete verbs not weak ones (*enhance, improve, update*); one change per subject. On a `<type>/<digits>` branch - feat, fix, chore, refactor, docs, test, perf, build, ci, or security - the subject starts `#<digits> `, from the branch name only; otherwise no prefix. Full rules: `docs/coding-standards/git-commit-message.md`.

## Key Resources
- **Learning loop** (INDEX-first search before every change): `.goat-flow/learning-loop/footguns/`, `.goat-flow/learning-loop/lessons/`, `.goat-flow/learning-loop/patterns/`, `.goat-flow/learning-loop/decisions/`
- **Tool playbooks**: `.goat-flow/skill-docs/playbooks/README.md` is the full index (examples: `.goat-flow/skill-docs/playbooks/browser-use.md`, `.goat-flow/skill-docs/playbooks/page-capture.md`) - read BEFORE declaring a tool unavailable

## Essential Commands
```bash
# Replace with commands detected from the target project:
<lint command>
<typecheck command>
<test command>
```

Only include commands that exist and were verified in the target project. Put installed agent settings and hook self-tests on a terse Situational line, not in the default command block.

## Execution Loop: READ → SCOPE → ACT → VERIFY
When a goat-* skill is active, its Step 0 replaces READ and selects the skill's mode/depth. SCOPE still applies before writes: a skill may write when its selected mode permits writes or the user explicitly approves them. `goat-plan` File-Write may create gitignored milestone files without a separate approval gate; `goat-debug` D3 still requires approval before fixes. Resume at ACT after Step 0 output or when a blocking gate releases.

### READ
MUST read relevant files before changes. Never fabricate codebase facts. Cross-doc: MUST read every file describing the same concept. For browser-visible behaviour, first run `command -v browser-use || command -v browser-use-python`; if found, run `browser-use --help` and follow the detected-interface branch in `.goat-flow/skill-docs/playbooks/browser-use.md`; otherwise ask before installing or use the manual fallback.
Use INDEX-first retrieval across `.goat-flow/learning-loop/{footguns,lessons,patterns}/INDEX.md`; include `.goat-flow/learning-loop/decisions/INDEX.md` for architecture, policy, or setup. Cap INDEX hits at 13 rows (row 13 = refine terms; read at most 12); never load one wholesale. Open source entries only on candidate hits; grep bucket files only after the INDEX pass or on a known retrieval miss; reword once on zero hits, then record the miss. Recursive searches under `.goat-flow/` that must include ignored plans/logs MUST use `command grep -rn --exclude-dir=.git --exclude-dir=scratchpad <pattern> .goat-flow/`; gitignore-aware search tools (including ripgrep defaults, `git grep`, and harness search shims) omit ignored local state, so zero hits from those tools do not prove absence.
Before declaring any tool or capability unavailable, read the matching `.goat-flow/skill-docs/playbooks/` playbook and run its "Availability Check" verbatim; project-local tools at `~/.local/bin/` count.
Prose surfaces route the same way before writing: `CHANGELOG.md` needs `changelog.md`; release notes need `release-notes.md`; ordinary README prose, `docs/`, PR/issue text, and learning-loop entry bodies need `writing-human-facing-prose.md`; README discovery rows, skills, playbooks, shared preamble/conventions, instruction files, and hook messages need `writing-agent-facing-instructions.md` - the trigger is touching the surface, not the request naming it.
Before creating, changing, reviewing, consolidating, moving, or pruning tests, read `.goat-flow/skill-docs/playbooks/test-selection.md`.
BAD: "The project has 20 audit checks" (guessed without reading)
GOOD: Read the relevant source, config, or generated instruction file before stating exact counts.

### SCOPE
Three signals before acting: (1) Intent: question → answer it, directive → act on it. (2) Complexity class: Hotfix / Small Feature / Standard / System / Infrastructure, with a declared checkpoint proportionate to the class. (3) Mode: Plan / Implement / Explain / Debug / Review. MUST declare before acting: files allowed to change, non-goals, max blast radius. Expanding beyond scope = stop and re-scope with human. Reaching the declared checkpoint = report evidence and re-classify before continuing; competent review may need broader coverage. Before writing, record the write allowlist and starting dirty paths; keep an in-session list of every path this session writes. Reads and searches stay unrestricted.

### ACT
MUST declare: `State: [MODE] | Goal: [one line] | Exit: [condition]`

| Mode | Behaviour |
|------|-----------|
| Plan | Produce planning artefacts. `goat-plan` File-Write may create gitignored milestone files when selected; committed files still require explicit approval. Exit on LGTM |
| Implement | Edit in bounded batches. Reaching the declared checkpoint without writing = checkpoint or re-scope |
| Explain | Walkthrough only. No changes unless asked |
| Debug | Diagnosis with file + semantic anchor first. Fixes after human reviews |
| Review | Investigate first. Never blindly apply suggestions |

For milestone work, load `goat-plan`; start timing before the first source edit, stop its timer at human gates, resume after release, and finalize it at exit.
If a milestone changes source, run `goat-clarity` once before exit on the explicit folder/file paths written by that milestone; never widen the selector to all uncommitted files when unrelated changes exist.

For Claude setup, ACT means updating only Claude-owned surfaces from the shared skeleton and adapting commands, boundaries, and Router Table rows to the target project.

### Attribution settings

Complete any required installer step before editing settings. If `.claude/settings.json` is missing, let the installer seed the full `workflow/hooks/agent-config/claude.json` template with its permissions and hooks; do not create an attribution-only settings file.

Disable [Claude attribution](https://code.claude.com/docs/en/settings-reference#attribution): merge `attribution.commit: ""`, `attribution.pr: ""`, and `attribution.sessionUrl: false` into `.claude/settings.json`, matching the template. Preserve unrelated settings and other attribution fields. Existing installs need this explicit merge because the installer preserves their settings files. Verify these three values before declaring setup complete, including an otherwise-current setup taking the Step 01 early exit.

### VERIFY
MUST run `shellcheck` on .sh changes. MUST check cross-references after renames. If working from a plan/milestone file, MUST tick `- [x]` on each task as it's completed - not at the end. Reconcile the write allowlist, starting dirty paths, session write paths, and final changed state before delivery. A new in-scope write is deliverable. A new out-of-scope write requires the agent to stop and obtain human approval for the expanded scope before delivery. Do not attribute a starting dirty path to this session unless the session also recorded writing it.

**Hallucination red-flags:**
1. **Checks passed.** Do not claim tests pass or any check passed (shellcheck, typecheck, preflight, audit) without showing the literal pass/fail line copied verbatim from this session's run. Paraphrase, cached output, or prior-session results do not count.
2. **Completion.** Do not claim completion without listing the specific files changed in this turn. If no files were changed, say so explicitly.
3. **Fix verification.** Do not claim a fix works without running the reproduction steps that originally demonstrated the bug. "Looks correct" is not verification.
4. **Hedged claims.** Do not use "should work", "probably fine", "looks good" as verification. These are guesses, not evidence.

- **Stop-the-line:** When tests break, builds fail, or behaviour regresses - stop expanding scope. Preserve evidence, return to diagnosis, re-plan before continuing.
- Continue after an isolated, in-scope verification failure only when evidence is preserved and the next diagnostic stays within scope. Stop and wait for human direction when failure crosses documentation or contracts, breaks references, invalidates evidence, or requires expanding the write allowlist. Two corrections on the same approach = MUST rewind.
- Recovery: missing context → read first. Out-of-scope → name boundary, redirect. Conflicting sources → flag, ask.

If VERIFY caught a failure or you corrected course, update the learning loop before DoD: behavioural mistakes go in `.goat-flow/learning-loop/lessons/<category>.md`, cross-doc architectural traps go in `.goat-flow/learning-loop/footguns/<category>.md` with `**Status:** active | **Created:** YYYY-MM-DD | **Evidence:** <choose one: ACTUAL_MEASURED, OBSERVED, or EXTERNAL_REFERENCE>` (measured locally, read directly, or cited external incident with local applicability), significant technical decisions go in `.goat-flow/learning-loop/decisions/`, and optional continuity notes go in `.goat-flow/logs/sessions/`.

## Definition of Done
- `CLAUDE.md` exists and follows the canonical section order.
- Essential Commands list only real target-project commands.
- Router Table contains installed project resources only; no `workflow/setup/`, `workflow/hooks/`, or manifest paths.
- Tool playbook pointer to `.goat-flow/skill-docs/playbooks/` is present.
- `.claude/settings.json` disables commit attribution, PR attribution, and session links with the template's `attribution` values.
- No hands-off agent files were changed.

## Artifact Routing
Requests to add footguns, lessons, decisions, or patterns route to the matching `.goat-flow/` directory after reading that directory's `README.md`: footguns -> `.goat-flow/learning-loop/footguns/`, lessons -> `.goat-flow/learning-loop/lessons/`, decisions -> `.goat-flow/learning-loop/decisions/`, patterns -> `.goat-flow/learning-loop/patterns/`. Runtime code, hooks, and agent config changes are out of scope unless the user explicitly asks for them.

## Router Table
| Resource | Path |
|----------|------|
| Instruction file | `CLAUDE.md` |
| Learning loop | `.goat-flow/learning-loop/footguns/`, `.goat-flow/learning-loop/lessons/`, `.goat-flow/learning-loop/patterns/`, `.goat-flow/learning-loop/decisions/` |
| Skill reference (meta) | `.goat-flow/skill-docs/` |
| Skill playbooks (tools) | `.goat-flow/skill-docs/playbooks/` |
| Orientation | `.goat-flow/code-map.md`, `.goat-flow/glossary.md` |
| Architecture | `.goat-flow/architecture.md` |
| Claude skills/config | `.claude/skills/`, `.claude/settings.json`, and shared `.goat-flow/hooks/` |
| Project source/docs/config | adapt to detected project paths |
| Workspace notes | `.goat-flow/logs/sessions/`, `.goat-flow/plans/` |
| Peer instructions | `AGENTS.md`, `.github/copilot-instructions.md` when present |
