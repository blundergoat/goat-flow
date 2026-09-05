# ADR-025: Agents never commit or push

**Status:** Accepted
**Date:** 2026-04-26
**Updated:** 2026-09-05 - condensed; the "contract tests should fail" consequence is replaced by what enforces the wording today. The 2026-08-15 amendment absorbed now-removed ADR-040 (agents never commit).

## Context

The prior monolithic deny hook blocked only pushes to protected branches (main, master, production, deploy) and force pushes; feature-branch pushes were allowed on the assumption that agents push as part of a PR workflow. Settings deny patterns disagreed: one runtime's settings blocked all pushes while `.claude/settings.json` blocked only force pushes, and the workflow template (`workflow/hooks/agent-config/claude.json`) carried the blanket pattern the installed copy had drifted from.

Commit authority had the same shape of contradiction. The installed hook (`.goat-flow/hooks/deny-dangerous/patterns-writes.sh`, search: `git commit is not allowed`) and Claude settings (`.claude/settings.json`, search: `Bash(*git commit*)`) categorically blocked commits, but the instruction files said "Commit unless asked", implying a direct request could authorize what enforcement had no path to allow. The project owner resolved it on 2026-07-12: agents never commit and never push; the user does both after reviewing the working tree.

## Decision

Coding agents never run `git commit` or `git push`; both are blocked at the settings layer and the hook layer, and the user performs them manually.

- A direct user request to commit does not create an exception. The agent leaves the tree uncommitted and hands the step back.
- Agents may inspect status and diffs, prepare working-tree changes within their approved scope, and draft a conventional commit message. That does not make staging or other local Git operations permissible where a separate instruction or hook prohibits them.
- Commit-message guidance (ADR-051) defines message format only and grants no execution authority.
- Instruction prose and categorical enforcement must agree. When they disagree, nobody can tell which is stale.

## Failure Mode Comparison

| Option | What fails | Verdict |
| --- | --- | --- |
| Allow pushes to feature branches only | Needs token classification the hook kept getting wrong, and installed settings had already drifted from the template | Rejected |
| Allow commits after a direct request | Prose and enforcement disagree; the agent mutates repository history when the owner expects a review handoff | Rejected |
| Block mechanically but leave permission wording ambiguous | Users and agents cannot tell whether the hook or the instruction is stale | Rejected |
| Block both categorically; the user commits and pushes | One manual step, with history and remote state under direct human control and prose aligned with enforcement | Accepted |

## Consequences

- `patterns-writes.sh` blocks any push with one pattern match; the old `is_protected_push_token()` helper and force-push checks are gone. Self-tests cover feature-branch, bare, and `-u` pushes, all exit 2.
- Every settings deny list uses the blanket `Bash(*git push*)` pattern. The settings glob matches anywhere in the command text, so a read-only command that merely quotes the literal is also denied; that bluntness is accepted (ADR-065).
- `AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`, and the setup reference state the unconditional prohibition; Never lists say "Push", not "Push to main. Force push." Autonomy Tiers is a provider-delta section under ADR-020, so no parity check or contract test pins this wording; a return of conditional commit language is caught by review, not by a gate.
- The categorical hook behaviour must not gain an agent approval bypass.

## Reversibility

Only through a new ADR that defines a reliable per-command approval mechanism and updates instruction, enforcement, and regression-test surfaces together. Reverting instruction wording alone recreates the original prose-versus-enforcement contradiction.
