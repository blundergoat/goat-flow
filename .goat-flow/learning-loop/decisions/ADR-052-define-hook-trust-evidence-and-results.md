# ADR-052: Define hook trust, evidence, and results

**Status:** Accepted
**Date:** 2026-08-09

## Context

Hook configuration is weaker evidence than hook delivery. `src/cli/server/hooks-registry.ts` (search: `unsupportedAgents`) stores provider capability judgments as undated strings, including a Codex result tied to version 0.139.0. Current official documentation describes lifecycle events that those strings still call unavailable: [Codex hooks](https://developers.openai.com/codex/hooks) now list `PostToolUse` and `Stop`, [Antigravity hooks](https://www.antigravity.google/docs/hooks) list `PostToolUse` and `Stop`, and [GitHub Copilot hooks](https://docs.github.com/en/copilot/reference/hooks-reference) list `postToolUse` and `agentStop`. [Claude Code hooks](https://code.claude.com/docs/en/hooks) likewise distinguish event delivery from the decision and feedback returned through each event.

Those documents establish provider contracts, not live delivery in a specific provider version, mode, configuration source, or trust state. `src/cli/hooks-runtime-evidence.ts` (search: `managed-hook-classifier`) proves only bounded local execution of Goat Flow's managed deny classifier and explicitly cannot prove that an external agent fired a hook or delivered its result.

The execution trust boundary is also narrower than malicious-checkout containment. A reviewed hook registration launches executable files from the selected checkout. ADR-032 accepts project-local Gruff analyzer discovery from standard ecosystem locations. Hook registration trust therefore does not establish provenance for every helper, dependency, or analyzer reached afterward.

## Decision

Goat Flow's current hook threat model covers accidental and prompt-influenced agent actions inside a user-selected checkout. The selected checkout is trusted executable content. Hooks are guardrails and feedback paths, not a sandbox against a malicious branch, dependency, helper, or analyzer.

Provider capability uses a versioned evidence record. Each provider/event combination records the canonical event and tool plus current official documentation. A live capture additionally records provider version and mode, hook and adapter versions, configuration source, trust state, observed payload field names, response channels, timeout behavior, continuation behavior, result delivery, and model visibility. It does not retain raw payload values.

Documentation and live captures expire after 30 days. Evidence becomes stale earlier when its provider version or mode, configuration source or trust state, hook or adapter version, or relevant official contract changes. Current documentation may establish `provider-documented`; only a fresh trusted live capture with delivered results may establish `live-supported`.

Every setup, audit, and dashboard surface uses this state chain:

`desired` -> `provider-documented` -> `live-supported` -> `registered` -> `installed-current` -> `trusted` -> `observed-running` -> `result-delivered` -> `scenario-verified`

The first unmet gate determines the user-visible state. Disabled is neutral. Missing, stale, unsupported, unregistered, outdated, unobserved, or scenario-unverified states are warnings. Untrusted evidence/runtime and observed-but-undelivered results are danger states. Only a fully satisfied chain is success.

Hooks produce a provider-neutral result before the final adapter. Outcomes are `pass`, `block`, `advisory`, `incomplete`, or `unavailable`; reason codes explain the outcome; coverage counts attempted, completed, and skipped units; findings are capped at 20; execution metadata names the provider, mode, hook version, adapter name/version, and duration. `pass` requires complete declared coverage. A provider adapter must preserve a block and must not translate incomplete or unavailable work into pass.

## Failure Mode Comparison

| Option | What fails | Decision |
| --- | --- | --- |
| Treat documentation as delivery | A provider can document an event that does not fire or does not return model-visible feedback in the user's mode. | Rejected. |
| Keep permanent supported/unsupported strings | Provider upgrades make old captures look timeless and hide the need to re-check delivery. | Rejected. |
| Gate support on dated documentation, capture, trust, delivery, and scenario proof | Support labels remain conservative and can become stale without being silently promoted or erased. | Accepted. |
| Treat project hook trust as malicious-checkout containment | A changed helper, dependency, or local analyzer can execute with the user's permissions after the registration itself was reviewed. | Rejected for the current architecture. |
| Move executable policy outside the checkout now | Existing project-local policy and analyzer discovery would need a provenance and migration design beyond the approved release scope. | Deferred until hostile checkout content enters the threat model. |

## Consequences

- Existing registry strings are historical inputs, not durable proof of current provider support.
- Later provider captures must be disposable, exact-version, mode-specific, trusted, and bounded. Configuration presence or official documentation alone cannot unlock registration.
- Provider-specific adapters remain the final translation layer. The core result vocabulary cannot erase lifecycle differences or weaken blocking behavior.
- Users reviewing an untrusted branch must rely on provider sandboxing, permissions, and operating-system containment rather than Goat Flow's project-local hooks.

## Reversibility

The evidence and result schemas are versioned and can gain a successor without rewriting old records. The 30-day window can change through a later decision backed by measured provider churn and capture cost.

Bringing hostile checkout content into scope is a larger security-model change. It requires superseding ADR-032, moving executable hook logic into a reviewed versioned installation, keeping project policy declarative, defining analyzer provenance, and migrating existing consumers before stronger claims are made.
