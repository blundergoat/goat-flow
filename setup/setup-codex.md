# Setup - Codex

Set up GOAT Flow for a project using Codex (OpenAI).

**Before you start:** Read [shared/guidelines-audit.md](shared/guidelines-audit.md) and do the audit if applicable.

Prefer a single session. If the repo is too large for one clean pass, finish the foundation first and report the split explicitly.

---

## Context Prompt

Paste this first:

```text
I have the GOAT Flow system - a 6-step execution loop (READ → CLASSIFY →
SCOPE → ACT → VERIFY → LOG) with autonomy tiers, a definition of done,
and a learning loop. I want to set it up for Codex.

Read these files for the system design:
- setup/shared/execution-loop.md (authoritative template — read FIRST)
- docs/system-spec.md (background context — if they conflict, execution-loop.md wins)

Now adapt this system for Codex. NOT a copy - a Codex-native implementation
that respects how Codex actually works.

CODEX MECHANICS (respect these):
- AGENTS.md is the root instruction file (not CLAUDE.md)
- Skills live in .agents/skills/{name}/SKILL.md (NOT docs/codex-playbooks/)
  Each SKILL.md needs YAML frontmatter with name and description fields.
  Codex discovers these via /skills or $skill-name at runtime.
- Hooks: SessionStart, UserPromptSubmit, Stop, AfterToolUse, AfterAgent (no PreToolUse blocker — use execpolicy rules for command blocking)
- apply_patch for edits (not Edit/Write tool)
- Codex may run in cloud sandboxes or local constrained shells
- No /compact, no /clear, no /insights - context is per-task
- No .claude/ directory structure, no settings.json, no profiles
- Execpolicy rules (~/.codex/rules/) for command blocking (allow/prompt/forbidden)
- No permissions deny list in settings (use execpolicy rules instead)

REPO STATE:
- If this project already has a Claude Code implementation (.claude/,
  CLAUDE.md, agent-evals/), leave those files untouched. Create Codex
  equivalents alongside them.
- If workflow docs already exist (docs/lessons.md, docs/architecture.md),
  treat as pre-existing: read, merge with, or rewrite in place.
- If docs/footguns.md is shared, merge carefully. Do not remove entries
  that Claude Code may depend on without flagging the removal.

WHAT TO BUILD (in this order):

1. AGENTS.md - Root instruction file with the sections listed in
   setup/shared/execution-loop.md. Adapt for Codex: use LOG (not RECORD),
   reference .agents/skills/ files instead of slash commands.
   Target: under 135 lines (Codex files run ~35% larger than Claude Code
   because enforcement can't be offloaded to hooks).
   Do NOT skip sections (f)–(i) - they are small but required.
   The loop MUST be: READ → CLASSIFY → SCOPE → ACT → VERIFY → LOG.
   CLASSIFY MUST include read/turn budgets per complexity tier.

   MUST include these exact rules (agents skip them without reinforcement):
   - ACT: state declaration "State: [MODE] | Goal: [one line] | Exit: [condition]"
     AND mode-transition rule "Switching to [NEW STATE] because [reason]."
   - ACT Debug mode: "No fixes until human reviews diagnosis" (not just
     "until diagnosis exists")
   - LOG: mechanical trigger (VERIFY failure or course correction →
     lessons.md entry required before DoD)
   - LOG: human correction trigger (MUST log immediately)
   - LOG: footgun propagation rule (propagate to nearest routed
     domain/instruction doc for Codex, local CLAUDE.md for Claude)
   - LOG: dual-agent coordination (read shared files before appending)
   - Ask First: use the explicit 5-item micro-checklist from the spec
     (item 4 = relevant local instruction checked: .github/instructions/<file> / CLAUDE.md / none)

   DUAL-AGENT REPOS: Do not create Codex assets under .claude/, but
   AGENTS.md MUST reference existing Claude assets (CLAUDE.md, agent-evals/)
   in the router table and SHOULD align shared semantics (loop, budgets,
   LOG triggers, Ask First checklist shape) unless a Codex mechanic
   requires divergence.

2. Docs seed files - Create the files listed in setup/shared/docs-seed.md.

3. Codex skills - .agents/skills/ (Codex discovers these at runtime):
   Each skill is a directory with a SKILL.md file containing YAML
   frontmatter (name + description) followed by the skill instructions.

   Read the detailed skill templates in workflow/skills/goat-*.md for
   each skill's full specification. Adapt the content for this project.

   Example frontmatter:
   ---
   name: goat-security
   description: "Security-focused review of dependencies, secrets, and permissions"
   ---

   Create these 10 skills under .agents/skills/:
   - goat-security/SKILL.md (see workflow/skills/goat-security.md)
   - goat-investigate/SKILL.md (see workflow/skills/goat-investigate.md)
   - goat-debug/SKILL.md (see workflow/skills/goat-debug.md)
   - goat-audit/SKILL.md (see workflow/skills/goat-audit.md)
   - goat-review/SKILL.md (see workflow/skills/goat-review.md)
   - goat-plan/SKILL.md (see workflow/skills/goat-plan.md)
   - goat-test/SKILL.md (see workflow/skills/goat-test.md)
   - goat-reflect/SKILL.md (see workflow/skills/goat-reflect.md)
   - goat-onboard/SKILL.md (see workflow/skills/goat-onboard.md)
   - goat-resume/SKILL.md (see workflow/skills/goat-resume.md)

   Each SKILL.md MUST have: YAML frontmatter (name + description),
   When to Use, Process or Constraints, Output template.
   Adapt stack-specific commands for THIS project.

4. Codex hooks + execpolicy - .codex/:
   Codex CLI now supports hooks (SessionStart, Stop, AfterToolUse) and
   execpolicy rules for command blocking.

   Create .codex/config.toml with hook registration:
   - [hooks.stop] → scripts/stop-lint.sh (lint after every turn)
   - [hooks.after_tool_use] → .codex/hooks/after-tool-use.sh
   - [hooks.session_start] → .codex/hooks/session-start.sh

   Create .codex/rules/deny-dangerous.star (Starlark execpolicy):
   - Block: rm -rf (unscoped), git push main/master, force push,
     chmod 777, pipe-to-shell, .env modifications, --no-verify
   - Prompt: git commit, git push (non-main), sudo, scoped rm -rf
   - Allow: everything else

   Note: Codex has NO PreToolUse equivalent. Execpolicy blocks shell
   commands only. File writes and agent spawns cannot be pre-blocked.
   The deny-dangerous.sh policy script remains useful for CI and
   preflight verification.

5. Verification scripts - scripts/:
   - scripts/preflight-checks.sh - Build, lint, test for the stack.
     Wrap existing preflight if one exists, don't replace it.
   - scripts/context-validate.sh - Instruction file line count, router
     references resolve, skill files exist.
   - scripts/deny-dangerous.sh - Policy documentation + verification.
     Include --self-test flag. Acknowledge this is NOT runtime blocking
     like Claude Code's PreToolUse hook - it's a policy doc and
     verification script.

6. Agent evals - add Codex-specific evals to agent-evals/ (single
   shared directory for all agents). Read existing evals first — do NOT
   duplicate incidents already covered.
   At least 1-2 evals MUST test Codex-specific mechanics: deny-dangerous
   is policy not runtime blocking, no slash commands (use .agents/skills/),
   no /compact or /clear, preserve Claude files in dual-agent repos,
   or AGENTS.md/CLAUDE.md alignment drift.
   Each eval MUST declare Origin: real-incident | synthetic-seed.
   Each eval MUST declare Agents: all | codex | claude.

7. Cold path: project coding guidelines

   If `.github/instructions/` exists:
   - Read existing files and group by domain (e.g., `php.instructions.md` + `python.instructions.md` → `ai/instructions/backend.md`)
   - Create `ai/README.md` as routing map
   - Keep `.github/instructions/` as optional Copilot bridges

   If no instruction files exist:
   - Create `ai/README.md` (routing map — see `workflow/coding-standards/README.md` template)
   - Create `ai/instructions/conventions.md` (project conventions — see `workflow/coding-standards/conventions.md` template)
   - Create `ai/instructions/code-review.md` (review standards — see `workflow/coding-standards/code-review.md` template)
   - Create `ai/instructions/git-commit.md` (commit format — see `workflow/coding-standards/git-commit.md` template)
   - Create `.github/git-commit-instructions.md` if `.git/` exists

   VERIFICATION: After creating ai/instructions/ files, the agent MUST:
   1. Verify every file path exists: for each backtick-wrapped path, run `ls`
   2. Verify commands work: run build/test/lint commands listed in conventions.md
   3. Remove aspirational content: if a feature is planned but not implemented, remove it
      Source of truth is the code, not docs/architecture.md or roadmaps.

   Add to AGENTS.md Router Table:
   | Project guidelines | `ai/README.md` |

   Verification: `ls ai/instructions/` shows conventions.md, code-review.md, git-commit.md.

VERIFICATION:
- AGENTS.md is concise and under 135 lines
- All seed files exist
- All 10 skills exist under .agents/skills/ with YAML frontmatter
- .codex/config.toml exists with hook registrations
- .codex/rules/deny-dangerous.star exists with forbidden patterns
- Hook scripts are executable
- Verification scripts are executable
- Footguns are real with file:line evidence
- Router table references resolve
- ai/instructions/ exists with conventions.md, code-review.md, git-commit.md
```

---

## After Codex Runs - Human Checklist

- [ ] AGENTS.md has 6-step loop (with SCOPE), autonomy tiers, DoD, router table
- [ ] AGENTS.md ACT has state declaration AND mode-transition rule
- [ ] AGENTS.md LOG has mechanical trigger, human correction trigger, footgun propagation
- [ ] AGENTS.md Ask First has explicit 5-item micro-checklist (not compressed prose)
- [ ] AGENTS.md uses LOG (not RECORD)
- [ ] docs/footguns.md entries have file:line evidence (not fabricated)
- [ ] docs/guidelines-ownership-split.md exists (if guidelines were trimmed)
- [ ] All 10 skills exist in .agents/skills/goat-*/ with SKILL.md + frontmatter
- [ ] scripts/deny-dangerous.sh --self-test passes
- [ ] scripts/context-validate.sh runs cleanly
- [ ] Router table references all resolve to real files
- [ ] Ask First boundaries are project-specific (not generic template)
- [ ] agent-evals/ has at least 1-2 Codex-mechanics evals (Agents: codex)
- [ ] If dual-agent: no Claude Code files were modified or removed
- [ ] If dual-agent: no duplicate evals in agent-evals/
- [ ] If dual-agent: compare AGENTS.md vs CLAUDE.md for same loop, budgets, LOG triggers, Ask First shape, DoD gates
- [ ] Test deny-dangerous by asking Codex to run `git push --force origin main`

---

## What This Intentionally Does Not Include

| Claude Code Feature | Why Codex Skips It |
|--------------------|--------------------|
| PreToolUse hooks | Codex has Stop, AfterToolUse, AfterAgent, SessionStart, UserPromptSubmit hooks — but no PreToolUse blocker. Execpolicy handles shell commands; non-shell tools (file writes, agent spawns) have no pre-execution gate. |
| Permission profiles | Codex has no native profile support. Document roles in AGENTS.md if needed. |
| Local CLAUDE.md files | Codex doesn't auto-load per-directory. Use .github/instructions/ with applyTo instead. |
| Slash commands | Codex uses .agents/skills/ with SKILL.md files. Invoked via /skills or $skill-name. |
| Strict line target | AGENTS.md runs ~35% larger. No hard ceiling - aim for concise but don't sacrifice clarity. |
| Permissions deny list | Codex uses execpolicy rules (.codex/rules/ or ~/.codex/rules/) with Starlark-based allow/prompt/forbidden decisions. Runtime blocking for shell commands. See item 4 above for .codex/rules/deny-dangerous.star setup. |

---

## Phase 2

**Implement immediately after Phase 1.** Do not defer.

See [shared/phase-2.md](shared/phase-2.md) for the full prompt.
