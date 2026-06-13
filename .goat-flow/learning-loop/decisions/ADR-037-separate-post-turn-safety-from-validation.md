# ADR-037: Ship post-turn safety only

**Status:** Accepted
**Date:** 2026-06-12
**Updated:** 2026-06-12

## Decision

Ship one goat-flow post-turn hook: `post-turn-safety`.

1. `post-turn-safety` is the default no-setup Stop hook for supported agents. It scans changed text content for goat-flow-owned safety hazards: high-confidence secrets, private key blocks, `.env`-style credential assignments, and merge conflict markers.
2. `post-turn-safety` must not run project builds, tests, linters, typecheckers, or formatters. It must not print or feed audit evidence that says project validation passed.
3. goat-flow does not ship a generated project-validation Stop hook. Remove the unreleased `post-turn-validate` hook and the `toolchain.post-turn-fast` profile. Do not recreate `workflow/hooks/post-turn-validate.sh`, `.goat-flow/hooks/post-turn-validate.sh`, or a compatibility shim for that hook unless a later ADR explicitly supersedes this one.
4. Audit, dashboard, docs, and drift wording must distinguish the shipped safety guard from project verification. A project with only `post-turn-safety` installed has a universal safety guard, not project-validation evidence.
5. Copilot still has no project-local Stop hook support. Do not invent a fake post-turn safety event for it.

## Context

ADR-015 removed the old `stop-lint.sh` because it guessed each target project's stack and hardcoded goat-flow-specific checks. The 1.12.0 planning track briefly considered a generated validation hook rendered from configured `toolchain` commands, but that still creates a project-specific post-turn surface users must configure and understand.

A universal default must be smaller: it can check changed content for safety hazards that goat-flow owns, but it cannot prove that the project builds or tests.

Evidence anchors:

- ADR-015 (search: `Stack guessing is unreliable`)
- `.goat-flow/learning-loop/patterns/architecture.md` (search: `Split guardrails by operational decision`)
- `.goat-flow/learning-loop/footguns/docs-and-crossrefs.md` (search: `Hook additions and renames cross runtime, dashboard, and audit surfaces`)
- `src/cli/facts/agent/hooks.ts` (search: `POST_TURN_VALIDATION_COMMAND_PATTERN`)

## Failure Mode Comparison

| Option | What fails | Decision |
| --- | --- | --- |
| Make `post-turn-validate` the default hook | Fresh projects with no `toolchain` setup get a hook that either fails noisily or claims validation without project-specific checks. | Rejected. |
| Replace validation with a generic build/test command list | This repeats ADR-015's stack-guessing failure across languages and package managers. | Rejected. |
| Rename validation to safety but keep validation semantics | Audit and docs would still imply that a project was checked honestly when only universal guardrails ran. | Rejected. |
| Keep a compatibility shim for the removed validation hook | Stale agent sessions would quiet down, but future agents could treat the shim path as a supported hook and reintroduce the deleted contract. | Rejected. Restart/reload the agent session instead. |
| Ship `post-turn-safety` as the only goat-flow post-turn hook | The default claim is smaller, but it is truthful and useful without setup. Projects that want validation must run explicit verification gates. | Accepted. |
| Make safety depend on an external secret scanner | Adds installation friction and version drift to the default hook. | Rejected for v1. Built-in high-confidence patterns are enough for the first profile. |

## Consequences

- Fresh setup can install a Stop hook without asking users for project toolchain commands.
- Verification scoring cannot treat safety-only installs as project-validation evidence.
- Secret scanning must prefer high-confidence changed-content findings and bounded false positives over whole-repo scanning.
- Future work must not collapse safety and project verification back into one ambiguous "post-turn" concept.
- Future plan or hook work must treat `post-turn-validate` references in M02/M02a as historical evidence, not as work to restore.

## Reversibility

This is a two-way door before release. If the safety hook is too noisy or misses the no-setup bar, disable `post-turn-safety` by default.

After release, rollback requires a migration note and hook sync that disables/removes `post-turn-safety` registrations.
