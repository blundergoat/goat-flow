# ADR-038: Plan Checkbox Guard

**Status:** Accepted
**Date:** 2026-06-13
**Updated:** 2026-06-13 (Stop-payload spike outcome: default registration narrowed to Claude)

## Context

The verification lesson `Agent doesn't tick milestone checkboxes` records a repeated workflow failure: agents complete implementation work but leave the active milestone plan unchanged. That weakens recovery because the next agent cannot tell which tasks moved.

ADR-037 removed the project-specific `post-turn-validate` Stop hook and kept universal Stop behavior focused on safety. The setup-and-migration lesson `Optional workflow state must not become audit or quality gates` also constrains this work: milestone files are useful workflow state, but stale roadmap plans must not become noisy default gates.

## Decision

goat-flow ships `plan-checkbox-guard.sh` as a separate Stop hook for supported Stop agents. It compares a per-session baseline of the active plan hash and Git changeset digest, then exits 2 only when repository changes moved while the active plan still has open checkboxes and the plan file did not change.

The guard is workflow hygiene only. It must not run project-specific validation commands, satisfy Verification scoring, satisfy post-turn safety evidence, auto-tick checkboxes, infer task completion, or write tracked files. Its only state file is `.goat-flow/logs/plan-guard-state.json`, and setup/sync must keep that path ignored before the hook writes to it.

Active plan resolution must be conservative: explicit `plan-guard.plan-file`, then `status: active`, then the `.goat-flow/plans/.active` directory, then at most one recent frontmatter-less plan inside configured search paths. Ambiguous or stale roadmap-style candidates fail open with a diagnostic instead of blocking the agent.

## Failure Mode Comparison

| Option | What fails | Why rejected or accepted |
| --- | --- | --- |
| Fold checkbox reminders into post-turn safety | Safety evidence becomes muddled with workflow state | Rejected; ADR-037 separates universal safety from project validation, and plan hygiene is neither. |
| Auto-tick completed tasks | The hook would guess semantic completion from file movement | Rejected; only the agent or user can decide which checkbox moved. |
| Default to newest open checkbox file anywhere under plans | Stale roadmap or future-version plans can block unrelated work | Rejected; optional plan state must not become a noisy quality gate. |
| Separate plan-checkbox guard with ignored local state | The hook can remind without claiming validation or safety | Accepted; it addresses the observed recovery failure while preserving audit honesty. |

## Stop-Payload Spike Outcome (2026-06-13)

The real-agent spike (M02b Evidence, fixture capture of live Stop payloads) verified only Claude: `session_id`, `transcript_path`, `cwd`, and `stop_hook_active` were all delivered and stable across two Stops of one resumed session. Codex Stop hooks registered in `.codex/hooks.json` never fired under codex exec 0.139.0 despite the documented `Stop` event (hook-review trust gate), and Antigravity routed the Stop event but its hook-trust gate blocked headless execution, with no `stop_hook_active` loop guard observed in the agy binary.

Default registration is therefore Claude-only: the registry's `unsupportedAgents` lists codex and antigravity with the unverified-payload reasons, sync prunes their stale guard entries, and the standalone installer skips them. Re-enabling an agent requires a verified payload capture (all four fields plus a working loop guard) and a registry change superseding this note — not just flipping the config toggle.

## Reversibility

This is a two-way door. The hook can be disabled with `hooks.plan-checkbox-guard.enabled: false`, narrowed with `plan-guard.plan-file`, or removed from default install if Stop payloads prove unstable in a supported agent — the 2026-06-13 spike exercised exactly this lever for codex/antigravity. Reversal must preserve ADR-037: do not restore `post-turn-validate.sh` or replace this guard with project-specific validation.
