# Cross-Agent Comparison: Claude Code vs Codex vs Gemini CLI vs Copilot

This document compares the AI workflow system's behaviour when implemented on Claude Code versus OpenAI Codex, based on parallel deployments across a medical scribe (PHP + Python + NeMo GPU + Mercure) and a multi-domain shell script collection with a PHP dashboard.

---

## Same Project, Different Agent

Two projects now have both implementations. Different stacks, different complexity, same comparison. The findings converge.

### What Maps Cleanly

The core system transfers without modification: the six-step loop (READ → CLASSIFY → SCOPE → ACT → VERIFY → LOG), autonomy tiers, Definition of Done, footguns file, lessons file, router table, essential commands, and the eval concept. These aren't Claude Code features -- they're workflow patterns that work on any agent that reads a root instruction file.

Both agents produced similar footgun counts from the same codebases. On the medical scribe: 8 from Claude Code, 7 from Codex, with overlapping findings (Mercure silent publish failure, three independent session state buckets, NeMo GPU singleton, DynamoDB provisioned-but-unused gap). On the shell script collection: 8 from Claude Code, 6 from Codex's rewrite, with 5 overlapping concepts (helper sourcing, WSL PATH sanitisation, strict-mode exceptions, logging paradigm, dashboard parsing). The convergence suggests the footgun-seeding approach works regardless of which agent does the reading.

On the shell script collection, both agents found the same 5 qualifying incidents from git history using the same grep pattern (`fix|revert|bug|broke|regression`). Each mapped to a different workflow step (READ, CLASSIFY, SCOPE, ACT, VERIFY, LOG). The eval seeding approach is agent-agnostic -- the git history is the source of truth, not the agent.

### What Had No Equivalent

| Claude Code feature | Codex replacement | Trade-off |
|---|---|---|
| PreToolUse hooks (deny-dangerous) | Execpolicy rules (.codex/rules/*.star) + .codex/hooks/ (Stop, AfterToolUse, SessionStart) | Claude Code blocks commands via PreToolUse hook. Codex blocks shell commands via execpolicy (.codex/rules/ with Starlark allow/prompt/forbidden). Hooks registered in .codex/config.toml. No pre-execution blocker for non-shell tools. |
| Stop hooks (lint after every turn) | Stop hook (experimental, v0.114.0+) | Both now have post-turn hooks. Codex's is newer and less battle-tested. |
| PostToolUse hooks (auto-format) | AfterToolUse hook (experimental) | Codex now has AfterToolUse events. Formatting can be triggered after edits. |
| Local CLAUDE.md (directory auto-load) | Centralised footguns.md + router references | Claude Code loads warnings automatically when entering a directory. Codex requires the agent to check the router table. |
| Slash commands (/goat-security, /goat-debug, etc.) | `.agents/skills/` with SKILL.md files, invoked via /skills or $skill-name | Same content, different loading mechanism. 10 skills per agent. |
| Permission profiles (.claude/profiles/) | Behavioural guidance in AGENTS.md only | No tool-level scoping. |
| Permissions deny (settings.json) | Execpolicy rules (.codex/rules/ Starlark) + AGENTS.md Never rules + deny-dangerous script + CI | Codex execpolicy (.codex/rules/*.star) provides runtime shell command blocking (allow/prompt/forbidden). Comparable to Claude Code's settings.json deny list for shell commands. No equivalent for Read-deny patterns. |
| /compact, /insights | No equivalent | Codex context is per-task, not per-session. No session management needed -- but no session learning either. |

The hooks gap has narrowed significantly. Claude Code has three layers: behavioural guidance, PreToolUse hooks that block before execution, and Stop hooks that check after every turn. Codex now has: execpolicy rules for runtime shell command blocking, Stop/AfterToolUse/AfterAgent hooks for post-execution checks, SessionStart for session setup, and UserPromptSubmit for input gating. The remaining gap is that Codex has no general pre-execution blocker for non-shell tools (file writes, agent spawns) — execpolicy only covers shell commands.

### What's Better Without Hooks

Codex's hook model is different, not absent. Several things work well in the Codex version:

**Execpolicy is deterministic.** Codex's Starlark-based rules system has clear allow/prompt/forbidden decisions with no LLM interpretation involved. The hook saga documented six versions of a prompt-based stop hook in Claude Code that produced false positives. Codex's execpolicy sidesteps this — pattern matching, not semantic analysis.

**Inspectable policy.** `deny-dangerous.sh` is a plain shell script committed to the repo with a `--self-test` flag. Anyone can read it, diff it, run its self-tests. Claude Code's deny hook is similar, but the stop and format hooks involve JSON configuration in `.claude/settings.json` that's less transparent.

**Reused and wrapped existing infrastructure.** On the shell script collection, Codex created `scripts/preflight-checks.sh` as a wrapper around the project's existing root `preflight-checks.sh` rather than creating parallel machinery. It also closed a coverage gap the original missed -- root-level and dashboard scripts weren't being scanned. On the medical scribe, the deny policy became step 3 of the existing preflight script. Claude Code's hooks exist alongside preflight, creating two enforcement paths.

**Deterministic validation.** `scripts/context-validate.sh` checks that AGENTS.md references exist, skills have required sections, footguns have evidence with valid file:line references, and task files exist. It's a local script you can run anytime -- no CI pipeline required. Claude Code's CI workflow does similar checks, but Codex's version is immediate.

**Committed overlap report.** Both Codex implementations created a persistent `guidelines-ownership-split.md` documenting what was removed from the original instruction file and why. Claude Code's split happens in a chat session and the reasoning evaporates when the session ends. This is now a recommended standard output.

### Where Claude Code Still Leads

The remaining gap shows up in specific areas:

**Pre-execution blocking for non-shell tools.** Codex's execpolicy blocks shell commands (rm -rf, git push --force). But file writes, agent spawns, and other tool calls have no pre-execution gate. Claude Code's PreToolUse hook covers ALL tool types — Bash, Write, Edit, Read.

**Mature stop-the-line.** Claude Code's Stop hook has been battle-tested across multiple versions. Codex's Stop hook is experimental (v0.114.0+) and less proven in production.

**Read-deny patterns.** Claude Code's settings.json blocks reading .ssh, .aws, .env, .pem files mechanically. Codex's execpolicy only covers shell command execution, not file reads by other tools.

**Directory-level warnings.** Claude Code auto-loads a local CLAUDE.md when entering high-risk directories. Codex has no confirmed equivalent.

**Permission profiles.** Claude Code's profiles restrict which files a session can edit. Codex has no tool-level scoping.

### The Line Count Trade-off

AGENTS.md runs larger than CLAUDE.md for the same project. On the shell script collection: 135 lines (AGENTS.md) vs 100 lines (CLAUDE.md) -- a 35% increase. Without hooks and slash commands to offload enforcement and skills, AGENTS.md carries more inline. The system specification (see `reference/system-spec.md`) says "do not fetishise a line count" for Codex, and the data supports this -- Codex's per-task context model means the always-loaded budget pressure is different from Claude Code's per-session model.

### Dual-Agent Coordination

When both agents share `docs/footguns.md` and `docs/lessons.md`, changes by one affect the other. The shell script collection surfaced this: Codex retitled 5 entries and removed 3 that Claude Code's implementation had. The removed entries (template default placeholders, missing show_help, arithmetic under set -e) were arguably single-domain rather than cross-domain -- defensible drops -- but the Claude Code side wasn't consulted.

Options: define one agent as the footguns owner, split into agent-specific files, or adopt a merge-and-flag protocol. The simplest rule: run Claude Code first (it creates the shared docs), then Codex (it merges with existing). Review Codex's changes to shared files before committing.

### The Honest Summary

The system's core — execution loop, autonomy tiers, definition of done, learning loop — is agent-agnostic. The enforcement layer has converged significantly: both agents now have runtime command blocking (Claude Code via PreToolUse hooks, Codex via execpolicy) and post-turn hooks (Claude Code via Stop, Codex via Stop/AfterToolUse). Claude Code leads on breadth (PreToolUse covers all tool types, not just shell) and maturity (hooks are battle-tested). Codex leads on execpolicy's deterministic rule engine (no false positives by design).

The workflow system is portable. The enforcement model is not.

**Recommended enforcement for agents without hooks:** Run the agent inside a sandboxed environment with explicit command allow-listing.

Reference pattern:
```
Allowed commands:
- [project test command] (e.g., npm test, composer test)
- [project build command] (e.g., npm run build)
- [project lint command]
- git add, git status, git diff, git log
- safe file operations (read, write within project directory)

Blocked (OS-level):
- rm -rf outside project directory
- git push (require explicit human action)
- network access beyond package registries
- file access outside project root
```

Implementation options: Docker container with restricted user, rbash (restricted bash), or project-level command wrapper script. The framework cannot enforce this directly -- it must be configured in the agent's deployment environment.

## Copilot CLI Update (M2.9)

As of M2.9, GitHub Copilot CLI supports two features previously listed as "no equivalent":

**Skills (`.github/skills/`):** Copilot CLI now discovers skills via `/skills list` or `/goat-{name}` at runtime. The SKILL.md format (YAML frontmatter + content) is identical to `.claude/skills/` and `.agents/skills/`. All 10 skills are supported.

**Hooks (preToolUse, postToolUse lifecycle):** Copilot CLI now has lifecycle hooks for pre-tool and post-tool events. This narrows the enforcement gap -- Copilot can now block dangerous commands before execution and run formatting/linting after tool use, similar to Claude Code and Gemini CLI.

These changes move Copilot from "behavioural guidance only" to a model closer to Claude Code and Gemini CLI for enforcement and skill loading.

---

## Multi-Model Verification

The doer-verifier testing model recommends using a DIFFERENT model for verification than the coding agent:

| Coding Agent | Recommended Verifier |
|-------------|---------------------|
| Claude Code | Codex, Gemini CLI, or Copilot |
| Codex | Claude Code or Gemini CLI |
| Cursor | Claude Code or Codex |

Cross-model verification catches model-specific blind spots. Claude reviewing Claude's work misses the same classes of errors that Claude makes. A different model brings different failure modes - and different strengths.

This is consistent with the framework's doer-verifier principle: the entity that did the work should not verify it.
