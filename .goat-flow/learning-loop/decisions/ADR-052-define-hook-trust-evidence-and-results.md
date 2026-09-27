# ADR-052: Hook trust, evidence, results, and version staleness

**Status:** Accepted
**Date:** 2026-08-09
**Updated:** 2026-09-05 - condensed; the undated-registry-strings context now reflects the shipped dated `expiresAt` records. The 2026-08-15 amendment absorbed now-removed ADR-034 (hook version stamp) and ADR-041 (interpreter heredoc boundary).

## Context

Hook configuration is weaker evidence than hook delivery. `src/cli/server/hooks-registry.ts` (search: `unsupportedAgents`) once stored provider capability as undated strings while official documentation listed events those strings still called unavailable: [Codex hooks](https://developers.openai.com/codex/hooks), [Antigravity hooks](https://www.antigravity.google/docs/hooks), and [GitHub Copilot hooks](https://docs.github.com/en/copilot/reference/hooks-reference) each list a post-tool and a stop event, and [Claude Code hooks](https://code.claude.com/docs/en/hooks) distinguishes event delivery from the decision returned through it. Documentation establishes a contract, not live delivery in a specific version, mode, configuration source, or trust state. `src/cli/hooks-runtime-evidence.ts` (search: `verifyManagedDenyHook`) proves only bounded local execution of the managed deny classifier; it cannot prove that an external agent fired a hook or delivered its result.

The execution trust boundary is narrower than malicious-checkout containment. A reviewed registration launches executables from the selected checkout, and ADR-032 accepts project-local analyzer discovery, so registration trust does not establish provenance for every helper reached afterwards.

## Decision

Hooks are guardrails against accidental and prompt-influenced agent actions inside a trusted checkout, and every support claim about them is a dated, gated evidence record.

**Threat model.** The selected checkout is trusted executable content. Hooks are not a sandbox against a malicious branch, dependency, helper, or analyzer.

**Evidence record.** Each provider/event combination records the canonical event and tool plus current official documentation. A live capture additionally records provider version and mode, hook and adapter versions, configuration source, trust state, observed payload field names, response channels, timeout and continuation behaviour, result delivery, and model visibility, and retains no raw payload values. Documentation and captures expire after 30 days, and earlier when the provider version or mode, configuration source or trust state, hook or adapter version, or official contract changes. Documentation may establish `provider-documented`; only a fresh trusted capture with delivered results establishes `live-supported`.

**State chain.** Every setup, audit, and dashboard surface uses `desired -> provider-documented -> live-supported -> registered -> installed-current -> trusted -> observed-running -> result-delivered -> scenario-verified`. The first unmet gate is the user-visible state. Disabled is neutral; missing, stale, unsupported, unregistered, outdated, unobserved, and scenario-unverified are warnings; untrusted evidence or runtime and observed-but-undelivered results are danger; only a fully satisfied chain is success.

**Results.** Hooks produce a provider-neutral result before the final adapter: an outcome of `pass`, `block`, `advisory`, `incomplete`, or `unavailable`; reason codes; coverage counts of attempted, completed, and skipped units; findings capped at 20; and execution metadata naming provider, mode, hook version, adapter, and duration. `pass` requires complete declared coverage. An adapter must preserve a block and must never translate incomplete or unavailable work into pass.

**Version staleness, the `installed-current` gate.** Each shipped dispatcher carries `# goat-flow-hook-version: X.Y.Z` (`workflow/hooks/{deny-dangerous,gruff-code-quality}.sh` and their `.goat-flow/hooks/` mirrors), and `bump-version.sh` stamps them with the release. The hard-fail setup check `hook-version` (`src/cli/audit/check-goat-flow.ts`) fails an installed dispatcher whose stamp is missing or behind `AUDIT_VERSION` and tells the user to re-run hooks sync; an absent dispatcher is skipped because `gruff-code-quality` is optional. An unstamped or behind dispatcher cannot reach `trusted` whatever its registration looks like.

**Declared boundary: interpreter heredoc bodies.** Allowlisted interpreter and client heredoc bodies stay outside the deny-dangerous shell policy. The hook guards shell command syntax; it does not sandbox Python, sed, awk, SQL-client, or other interpreter semantics. Shell-fed heredocs, unknown consumers, dispatchers, process substitutions into shells, and commands after heredoc delimiters stay inspectable, and inline flags such as `python -c` may receive targeted checks. This is accepted residual risk, not evidence that interpreter heredocs are safe; the instruction files' prohibition on destructive actions remains the primary rule.

## Failure Mode Comparison

| Option | What fails | Verdict |
| --- | --- | --- |
| Treat documentation as delivery | A documented event may not fire or return model-visible feedback in the user's mode | Rejected |
| Permanent supported/unsupported strings | Provider upgrades make old captures look timeless | Rejected |
| Treat project hook trust as malicious-checkout containment | A changed helper, dependency, or analyzer executes with the user's permissions after the registration was reviewed | Rejected for the current architecture |
| Move executable policy outside the checkout now | Needs a provenance and migration design beyond the approved scope | Deferred until hostile checkout content enters the threat model |
| Ship hooks without a version stamp | A stale dispatcher looks identical to a current one, so a stale guard reads as working | Rejected |
| Extend shell policy into interpreter heredoc bodies | Claims a sandbox the hook cannot deliver, turning a declared limit into false assurance | Rejected |
| Dated, gated evidence with a stamped `installed-current` gate and a declared heredoc boundary | Support labels stay conservative and can go stale without being silently promoted | Accepted |

## Consequences

- Registry strings are historical inputs; the registry now carries dated `expiresAt` captures that go stale on schedule.
- Configuration presence or official documentation alone never unlocks registration. Provider adapters stay the final translation layer and cannot weaken blocking behaviour.
- Users reviewing an untrusted branch rely on provider sandboxing, permissions, and OS containment, not on project-local hooks.

## Reversibility

The evidence and result schemas are versioned and can gain a successor without rewriting old records; the 30-day window can change through a later decision backed by measured provider churn. Bringing hostile checkout content into scope requires superseding ADR-032, moving executable hook logic into a reviewed versioned installation, keeping project policy declarative, defining analyzer provenance, and migrating consumers before stronger claims are made.
