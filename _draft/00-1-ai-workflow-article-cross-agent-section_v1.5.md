## Same Project, Different Agent

Two projects now have both implementations: a four-layer medical scribe (PHP + Python + NeMo GPU + Mercure) and a multi-domain shell script collection with a PHP dashboard. Different stacks, different complexity, same comparison. The findings converge.

### What Maps Cleanly

The core system transfers without modification: the five-step loop, autonomy tiers, Definition of Done, footguns file, lessons file, router table, essential commands, and the eval concept. These aren't Claude Code features — they're workflow patterns that work on any agent that reads a root instruction file.

Both agents produced similar footgun counts from the same codebases. On the medical scribe: 8 from Claude Code, 7 from Codex, with overlapping findings (Mercure silent publish failure, three independent session state buckets, NeMo GPU singleton, DynamoDB provisioned-but-unused gap). On the shell script collection: 8 from Claude Code, 6 from Codex's rewrite, with 5 overlapping concepts (helper sourcing, WSL PATH sanitisation, strict-mode exceptions, logging paradigm, dashboard parsing). The convergence suggests the footgun-seeding approach works regardless of which agent does the reading.

On the shell script collection, both agents found the same 5 qualifying incidents from git history using the same grep pattern (`fix|revert|bug|broke|regression`). Each mapped to a different workflow step (READ, CLASSIFY, ACT, VERIFY, RECORD). The eval seeding approach is agent-agnostic — the git history is the source of truth, not the agent.

### What Had No Equivalent

| Claude Code feature | Codex replacement | Trade-off |
|---|---|---|
| PreToolUse hooks (deny-dangerous) | `scripts/deny-dangerous.sh` as policy documentation | Claude Code blocks `rm -rf` before it executes. Codex documents the policy for review, CI, and preflight but cannot prevent the command from running. |
| Stop hooks (lint after every turn) | Preflight script, run manually or in CI | Claude Code catches formatting issues continuously. Codex catches them at checkpoints. |
| PostToolUse hooks (auto-format) | Nothing — manual or preflight | No auto-formatting on edit. Skip if no formatter configured. |
| Local CLAUDE.md (directory auto-load) | Centralised footguns.md + router references | Claude Code loads warnings automatically when entering a directory. Codex requires the agent to check the router table. |
| Slash commands (/preflight, /debug) | Playbook files in `docs/codex-playbooks/` | Same content, different loading mechanism. 5 playbooks mapped to 5 skills on the shell script collection. |
| Permission profiles (.claude/profiles/) | Behavioural guidance in AGENTS.md only | No tool-level scoping. |
| Permissions deny (settings.json) | AGENTS.md Never rules + deny-dangerous script + CI | No pre-execution blocking. Three layers of documentation vs one layer of enforcement. |
| /compact, /insights | No equivalent | Codex context is per-task, not per-session. No session management needed — but no session learning either. |

The hooks gap is the fundamental difference. Claude Code has three layers of enforcement: behavioural guidance in CLAUDE.md, deterministic hooks that block commands before execution, and stop hooks that run checks after every turn. Codex has behavioural guidance in AGENTS.md plus validation scripts that run at checkpoints — more than "one layer" but still no runtime interception.

### What's Better Without Hooks

No hooks isn't purely a loss. Five things work better in the Codex version:

**No false positives.** The hook saga documented six versions of a prompt-based stop hook, all of which produced false positives that eroded trust. Codex sidesteps this entirely — there's no mechanism to produce false positives because there's no semantic enforcement mechanism.

**Inspectable policy.** `deny-dangerous.sh` is a plain shell script committed to the repo with a `--self-test` flag. Anyone can read it, diff it, run its self-tests. Claude Code's deny hook is similar, but the stop and format hooks involve JSON configuration in `.claude/settings.json` that's less transparent.

**Reused and wrapped existing infrastructure.** On the shell script collection, Codex created `scripts/preflight-checks.sh` as a wrapper around the project's existing root `preflight-checks.sh` rather than creating parallel machinery. It also closed a coverage gap the original missed — root-level and dashboard scripts weren't being scanned. On the medical scribe, the deny policy became step 3 of the existing preflight script. Claude Code's hooks exist alongside preflight, creating two enforcement paths.

**Deterministic validation.** `scripts/context-validate.sh` checks that AGENTS.md references exist, playbooks have required sections, footguns have evidence with valid file:line references, and task files exist. It's a local script you can run anytime — no CI pipeline required. Claude Code's CI workflow does similar checks, but Codex's version is immediate.

**Committed overlap report.** Both Codex implementations created a persistent `guidelines-ownership-split.md` documenting what was removed from the original instruction file and why. Claude Code's split happens in a chat session and the reasoning evaporates when the session ends. This is now a recommended standard output.

### What's Worse Without Hooks

The enforcement gap is real and shows up in six places:

**No runtime blocking.** If Codex decides to run `rm -rf /`, nothing stops it. AGENTS.md says "Never do this." The deny-dangerous script documents the policy. But neither intercepts the command. Claude Code's PreToolUse hook blocks it before execution — 100% of the time, mechanically, regardless of whether the agent read the rules.

**No automatic stop-the-line.** Claude Code's stop hook runs `bash -n` or `shellcheck` or `cargo fmt --check` after every turn. If there's a syntax error, the agent sees it immediately. Codex only catches these at preflight checkpoints — meaning errors can accumulate between checks.

**Ask First is behavioural only.** In Claude Code, the Ask First micro-checklist is reinforced by the stop-the-line hook — if a cross-boundary change breaks something, the hook catches it. In Codex, Ask First relies entirely on the agent choosing to follow the rule.

**No directory-level warnings.** Claude Code auto-loads a local CLAUDE.md when entering `strands_agents/` or `lib/ai-cli/`. Codex has no confirmed equivalent — the footguns are centralised, not positioned where the danger is.

**No permission lanes.** Claude Code's permission profiles restrict which files a session can edit. Codex has no tool-level scoping — every session has access to everything.

**No session compaction.** Claude Code's `/compact` and context management tools help with long sessions. Codex's per-task context model avoids this problem differently — each task starts fresh — but loses continuity between tasks.

### The Line Count Trade-off

AGENTS.md runs larger than CLAUDE.md for the same project. On the shell script collection: 135 lines (AGENTS.md) vs 100 lines (CLAUDE.md) — a 35% increase. Without hooks and slash commands to offload enforcement and skills, AGENTS.md carries more inline. The plan says "do not fetishise a line count" for Codex, and the data supports this — Codex's per-task context model means the always-loaded budget pressure is different from Claude Code's per-session model.

### Dual-Agent Coordination

When both agents share `docs/footguns.md` and `docs/lessons.md`, changes by one affect the other. The shell script collection surfaced this: Codex retitled 5 entries and removed 3 that Claude Code's implementation had. The removed entries (template default placeholders, missing show_help, arithmetic under set -e) were arguably single-domain rather than cross-domain — defensible drops — but the Claude Code side wasn't consulted.

Options: define one agent as the footguns owner, split into agent-specific files, or adopt a merge-and-flag protocol. The simplest rule: run Claude Code first (it creates the shared docs), then Codex (it merges with existing). Review Codex's changes to shared files before committing.

### The Honest Summary

The system's core — the execution loop, autonomy tiers, definition of done, learning loop — is agent-agnostic. It works on both. The enforcement layer is where they diverge. Claude Code enforces mechanically (hooks block commands, format files, check syntax). Codex enforces culturally (AGENTS.md rules, policy scripts, preflight checks, CI).

For solo developers who trust their agent and verify with preflight, the Codex model is sufficient. For teams, long-lived projects, or codebases where a single bad command has high blast radius, Claude Code's hooks provide a safety net that behavioural guidance alone can't match.

The workflow system is portable. The enforcement model is not.
