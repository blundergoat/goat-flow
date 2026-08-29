# ADR-037: Shipped Stop-hook set - post-turn safety only

**Status:** Accepted
**Date:** 2026-06-12
**Updated:** 2026-08-29 - names the durable owner of milestone-timing and post-source clarity reminders (decision point 6). No hook is added; the reminders were only ever instruction-file obligations, and ignored local milestone state was the sole place that said so.
**Updated:** 2026-08-15 - absorbed ADR-015 (remove `stop-lint.sh`) and the ADR-038/ADR-039 plan-checkbox-guard pair. All three decide which Stop hooks goat-flow ships; the guard pair was a shipped-then-reverted round whose durable content is the rejection.

## Decision

Ship one goat-flow post-turn hook: `post-turn-safety`.

1. `post-turn-safety` is the default no-setup Stop hook for supported agents. It scans changed text content for goat-flow-owned safety hazards: high-confidence secrets, private key blocks, `.env`-style credential assignments, and merge conflict markers.
2. `post-turn-safety` must not run project builds, tests, linters, typecheckers, or formatters. It must not print or feed audit evidence that says project validation passed.
3. goat-flow does not ship a generated project-validation Stop hook. Remove the unreleased `post-turn-validate` hook and the `toolchain.post-turn-fast` profile. Do not recreate `workflow/hooks/post-turn-validate.sh`, `.goat-flow/hooks/post-turn-validate.sh`, or a compatibility shim for that hook unless a later ADR explicitly supersedes this one.
4. Audit, dashboard, docs, and drift wording must distinguish the shipped safety guard from project verification. A project with only `post-turn-safety` installed has a universal safety guard, not project-validation evidence.
5. Copilot still has no project-local Stop hook support. Do not invent a fake post-turn safety event for it.
6. Milestone timing and post-source clarity reminders are **always-loaded ACT instruction obligations**, not hook-enforced ones. The instruction files own the reminder; `goat-plan` owns timing-receipt mechanics only after it is invoked, and `goat-clarity` owns the bounded selector pass only after it is invoked. Neither skill restates the reminder, and no Stop hook enforces either. A future hook proposal for them needs observed bypass evidence plus a superseding ADR, exactly like the two expansions already paid for and reverted.

### Removed Stop hooks - do not reintroduce blind

**`stop-lint.sh` (removed v1.1.0).** It ran shellcheck on changed `.sh` files and `tsc --noEmit` on changed `.ts` files after every agent turn. Three failures killed it:

- **Stack guessing is unreliable.** Hardcoding shellcheck plus tsc gives Python, Go, Rust, and PHP projects a hook that does nothing useful, or runs the wrong tool. Detecting the stack from a shell script needs the project calibration ADR-014 deferred.
- **Enforcement mode was documented three ways.** Headers and setup docs said "advisory by default"; the code defaulted to enforce (`GOAT_LINT_ENFORCE:-1`). Three critiques independently flagged the contradiction.
- **A framework-shipped lint hook is either too generic to be useful or too opinionated to be portable.**

Removal deleted the scripts and every Stop/AfterAgent registration, and dropped the "Hook enforcement mode" section from setup docs. The audit's post-turn hook detection stays (`src/cli/audit/harness/check-verification.ts`, `src/cli/facts/agent/hooks.ts`), because consumer projects may run their own post-turn hooks. The `GOAT_LINT_ENFORCE` advisory that removal originally preserved was itself retired later; the variable now appears in no shipped code.

**`plan-checkbox-guard.sh` (shipped and reverted, v1.12.0-v1.12.1).** It compared a per-session baseline of the active plan hash and Git changeset digest, exiting 2 only when repository changes moved while the active plan still had open checkboxes and the plan file did not change. It was workflow hygiene only - never validation, never safety evidence, never auto-ticking.

The v1.12.1 review found the operational cost exceeded the value: non-Claude Stop delivery stayed unverified, the hook needed local ignored state plus plan-file heuristics, and stale installed registrations could keep invoking a deleted script unless cleanup was deliberate. New installs and hook syncs must not copy, register, list, or configure it.

A narrow legacy cleanup path prunes stale `plan-checkbox-guard.sh` registrations, stale central and per-agent scripts, `hooks.plan-checkbox-guard`, the `plan-guard` config block, and the old `logs/plan-guard-state.json` ignore entry. That path is a tombstone only: it must not expose the hook in the registry, dashboard state, manifest required files, generated config, or default config. Hook fact extraction must keep ignoring stale guard-only Stop registrations so they never count as post-turn safety or validation evidence.

Milestone accounting stays explicit verification discipline. Any proposal to mechanise it again must start from this rejection rather than from the original problem statement.

## Context

The old `stop-lint.sh` guessed each target project's stack and hardcoded goat-flow-specific checks. The 1.12.0 planning track briefly considered a generated validation hook rendered from configured `toolchain` commands, but that still creates a project-specific post-turn surface users must configure and understand.

A universal default must be smaller: it can check changed content for safety hazards that goat-flow owns, but it cannot prove that the project builds or tests.

The plan-checkbox guard then tested the opposite bet - a Stop hook that enforces workflow hygiene rather than project state. It shipped, expanded the default Stop surface across dashboard, installer, config schema, manifest, audit fixtures, and docs, and was withdrawn one release later. Keeping the shipped decision and its reversal in separate files invited a future reader to find only the first.

Evidence anchors:

- `.goat-flow/learning-loop/patterns/architecture.md` (search: `Split guardrails by operational decision`)
- `.goat-flow/learning-loop/footguns/lockstep-surfaces.md` (search: `Hook additions and renames cross runtime, dashboard, and audit surfaces`)
- `src/cli/facts/agent/hooks.ts` (search: `POST_TURN_VALIDATION_COMMAND_PATTERN`)

## Failure Mode Comparison

| Option | What fails | Decision |
| --- | --- | --- |
| Make `post-turn-validate` the default hook | Fresh projects with no `toolchain` setup get a hook that either fails noisily or claims validation without project-specific checks. | Rejected. |
| Replace validation with a generic build/test command list | This repeats the stack-guessing failure that removed `stop-lint.sh`, across languages and package managers. | Rejected. |
| Rename validation to safety but keep validation semantics | Audit and docs would still imply that a project was checked honestly when only universal guardrails ran. | Rejected. |
| Keep a compatibility shim for a removed hook | Stale agent sessions would quiet down, but future agents could treat the shim path as a supported hook and reintroduce the deleted contract. | Rejected. Restart/reload the agent session instead. |
| Ship a workflow-hygiene Stop hook alongside safety | Tried as `plan-checkbox-guard.sh`. Unverified non-Claude delivery, local state files, plan-file heuristics, and stale-registration risk cost more than the reminder was worth. | Rejected after one shipped release. |
| Ship `post-turn-safety` as the only goat-flow post-turn hook | The default claim is smaller, but it is truthful and useful without setup. Projects that want validation must run explicit verification gates. | Accepted. |
| Make safety depend on an external secret scanner | Adds installation friction and version drift to the default hook. | Rejected for v1. Built-in high-confidence patterns are enough for the first profile. |

## Consequences

- Fresh setup can install a Stop hook without asking users for project toolchain commands.
- Verification scoring cannot treat safety-only installs as project-validation evidence.
- Secret scanning must prefer high-confidence changed-content findings and bounded false positives over whole-repo scanning.
- Future work must not collapse safety and project verification back into one ambiguous "post-turn" concept.
- Future plan or hook work must treat `post-turn-validate` and `plan-checkbox-guard` references in historical milestones as evidence, not as work to restore.
- Timing and clarity reminders have a named owner in a committed decision record. Before this, the only statement of that ownership lived in ignored local milestone state, so it could not survive a clean checkout and could not be cited.
- Nothing about timing or clarity may be described as hook-enforced or runtime-enforced. They are instruction-file obligations an agent can skip; the honest claim is guidance, not enforcement.
- Two Stop-hook expansions have now been paid for and reverted. A third proposal needs evidence that it avoids both failure modes: stack guessing and unverified cross-agent delivery.

## Reversibility

This is a two-way door before release. If the safety hook is too noisy or misses the no-setup bar, disable `post-turn-safety` by default.

After release, rollback requires a migration note and hook sync that disables/removes `post-turn-safety` registrations.
