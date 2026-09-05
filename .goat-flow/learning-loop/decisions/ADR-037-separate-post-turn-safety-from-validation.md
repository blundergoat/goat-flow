# ADR-037: Shipped Stop-hook set - post-turn safety only

**Status:** Accepted
**Date:** 2026-06-12
**Updated:** 2026-09-05 - condensed; Copilot wording aligned with ADR-052 (delivery unverified rather than unsupported) and reversibility updated for the shipped hook. Earlier amendments named the owner of timing and clarity reminders (2026-08-29) and absorbed now-removed ADR-015 (`stop-lint.sh`) and the ADR-038/ADR-039 plan-checkbox-guard pair (2026-08-15).

## Context

The old `stop-lint.sh` guessed each target project's stack and hardcoded goat-flow checks. The 1.12.0 planning track briefly considered a validation hook rendered from configured `toolchain` commands, which still creates a project-specific surface users must configure and understand. A universal default has to be smaller: it can check changed content for hazards goat-flow owns, but it cannot prove the project builds or tests.

The plan-checkbox guard then tested the opposite bet, a Stop hook enforcing workflow hygiene rather than project state. It shipped in v1.12.0, expanded the Stop surface across dashboard, installer, config schema, manifest, audit fixtures, and docs, and was withdrawn in v1.12.1.

Evidence: `.goat-flow/learning-loop/patterns/architecture.md` (search: `Split guardrails by operational decision`); `.goat-flow/learning-loop/footguns/lockstep-surfaces.md` (search: `Hook additions and renames cross runtime, dashboard, and audit surfaces`); `src/cli/facts/agent/hooks.ts` (search: `POST_TURN_VALIDATION_COMMAND_PATTERN`).

## Decision

Ship one goat-flow post-turn hook: `post-turn-safety`.

1. `post-turn-safety` is the default no-setup Stop hook for supported agents. It scans changed text for goat-flow-owned hazards: high-confidence secrets, private key blocks, `.env`-style credential assignments, and merge conflict markers.
2. It must not run builds, tests, linters, typecheckers, or formatters, and must not print or feed audit evidence that says project validation passed.
3. goat-flow does not ship a generated project-validation Stop hook. `post-turn-validate` and the `toolchain.post-turn-fast` profile were removed unreleased; do not recreate the script or a compatibility shim without a superseding ADR.
4. Audit, dashboard, docs, and drift wording distinguish the safety guard from project verification. A project with only `post-turn-safety` has a universal safety guard, not validation evidence.
5. Copilot documents an `agentStop` event, but its delivery is unverified under ADR-052, so no Copilot Stop registration ships and none is invented.
6. Milestone timing and post-source clarity reminders are always-loaded ACT instruction obligations, not hook-enforced. The instruction files own the reminder; `goat-plan` owns timing-receipt mechanics and `goat-clarity` the bounded selector pass only once invoked. Neither restates the reminder, and no Stop hook enforces either. A future hook proposal needs observed bypass evidence plus a superseding ADR.

### Removed Stop hooks

**`stop-lint.sh` (removed v1.1.0).** It ran shellcheck on changed `.sh` files and `tsc --noEmit` on changed `.ts` files after every turn. Stack guessing gave Python, Go, Rust, and PHP projects a useless or wrong hook; enforcement mode was documented as advisory while the code defaulted to enforce; and a framework-shipped lint hook is either too generic to help or too opinionated to port. Removal deleted the scripts, every Stop registration, and the setup-doc section. Audit detection of post-turn hooks stays (`src/cli/audit/harness/check-verification.ts`, `src/cli/facts/agent/hooks.ts`) because consumers may run their own; the `GOAT_LINT_ENFORCE` variable appears in no shipped code.

**`plan-checkbox-guard.sh` (shipped and reverted, v1.12.0 to v1.12.1).** It exited 2 when repository changes moved while the active plan still had open checkboxes and the plan file had not changed. Non-Claude Stop delivery stayed unverified, it needed ignored local state plus plan-file heuristics, and stale registrations could keep invoking a deleted script. A narrow cleanup path prunes stale registrations, scripts, `hooks.plan-checkbox-guard`, the `plan-guard` config block, and the old ignore entry. That path is a tombstone: it must not expose the hook in the registry, dashboard, manifest, or default config, and hook fact extraction keeps ignoring guard-only Stop registrations so they never count as safety or validation evidence.

## Failure Mode Comparison

| Option | What fails | Verdict |
| --- | --- | --- |
| Make `post-turn-validate` the default | Fresh projects without `toolchain` get a hook that fails noisily or claims validation it did not do | Rejected |
| Generic build/test command list | Repeats the stack-guessing failure that removed `stop-lint.sh` | Rejected |
| Rename validation to safety, keep validation semantics | Audit and docs imply an honest project check when only universal guardrails ran | Rejected |
| Compatibility shim for a removed hook | Future agents treat the shim as supported and reintroduce the deleted contract; restart the session instead | Rejected |
| Workflow-hygiene Stop hook beside safety | Tried as `plan-checkbox-guard.sh`; unverified delivery, local state, heuristics, and stale registrations cost more than the reminder | Rejected after one release |
| External secret scanner as the safety engine | Installation friction and version drift in the default hook | Rejected for v1 |
| `post-turn-safety` as the only shipped Stop hook | A smaller claim, but truthful and useful without setup | Accepted |

## Consequences

- Fresh setup installs a Stop hook without asking for toolchain commands; verification scoring never treats a safety-only install as validation evidence.
- Secret scanning prefers high-confidence changed-content findings over whole-repo scanning.
- Historical milestone references to `post-turn-validate` and `plan-checkbox-guard` are evidence, not work to restore. Two Stop-hook expansions have been paid for and reverted; a third needs proof against stack guessing and unverified cross-agent delivery.
- Timing and clarity reminders are guidance an agent can skip; nothing may describe them as hook-enforced.

## Reversibility

`post-turn-safety` has shipped. Rollback requires a migration note and a hook sync that disables or removes its registrations; disabling it by default is the smaller lever if it proves noisy.
