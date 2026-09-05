# ADR-020: Supported agent roster and identity authority

**Status:** Accepted
**Date:** 2026-04-18
**Updated:** 2026-09-05 - condensed. Earlier amendments absorbed now-removed ADR-030 (Antigravity replaces Gemini) and ADR-022 (canonical identity) on 2026-08-15, and added the machine-checked shared-section contract for Copilot on 2026-08-30.

## Context

goat-flow supports agent runtimes through one manifest-backed registry: `workflow/manifest.json` is the writable source of truth and `src/cli/agents/registry.ts` the runtime facade, so CLI, dashboard, setup, and audit read one roster instead of parallel allowlists. Two problems came from the same root. The fourth slot changed from Gemini to Antigravity, and hardcoded `["claude", "codex", "antigravity", "copilot"]` literals scattered across non-type code meant a roster change had to be chased rather than made.

Copilot CLI exposes the same surface categories as the other agents. It detects `.github/copilot-instructions.md`, `AGENTS.md`, and `CLAUDE.md`, combines applicable repository instructions, and publishes no precedence rule between them ([GitHub documentation](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions)). Its interactive slash commands are user-entered; instructions may recommend one but cannot treat it as an agent-callable tool.

## Decision

Canonical agents are `claude`, `codex`, `antigravity`, and `copilot`, defined once in code and materialised once from the manifest.

**Roster.** Gemini surfaces are removed from setup, audit, dashboard, hook, and skill-install contracts. Antigravity owns the fourth slot and uses `.agents/` where the manifest says so. Docs and revisit-trigger lists use this set.

**Identity authority.**
1. `KNOWN_AGENT_IDS` (an `as const` tuple) and the derived `AgentId` union live in `src/cli/types.ts`; all TypeScript imports the union from there.
2. `src/cli/agents/registry.ts` re-exports the tuple beside `getKnownAgentIds()`, which derives from `loadManifest().agents` at runtime as the cross-check between code and manifest.
3. A manifest agent key outside the union is dropped by the `isAgentId` filter and surfaced through the manifest validation error path, so a half-registered agent fails at load.
4. Hardcoded agent-ID literals in non-type positions migrate to the tuple or the helper; `Record<AgentId, X>` uses stay.

**Copilot parity.** `copilot` is a first-class `AgentId` with a real manifest profile: instruction file `.github/copilot-instructions.md`, skills `.github/skills/`, hooks `.github/hooks/` with the single config `.github/hooks/hooks.json` registering the central dispatcher under `.goat-flow/hooks/` (ADR-033). Setup ships `workflow/setup/agents/copilot.md`. The instruction file is standalone and physically complete: the manifest classifies common sections that must stay byte-identical across `AGENTS.md`, `CLAUDE.md`, and `.github/copilot-instructions.md`, and only reasoned provider-delta sections may differ. Optional `.github/instructions/**/*.instructions.md` stays Copilot path-scoped guidance. Repository custom agents (`.github/agents/`), generated bridge files between the three instruction files, and per-model guidance are out of scope.

## Failure Mode Comparison

| Option | What fails | Verdict |
| --- | --- | --- |
| Roster literals in each consumer | A roster change becomes a repo-wide hunt; missed sites half-support the new agent | Rejected |
| Manifest as the only authority | `Record<AgentId, X>` lookups lose compile-time narrowing | Rejected |
| Generated bridge file for Copilot | Standalone files stop being reviewable in isolation; parity is enforcement, not runtime generation | Rejected |
| Compile-time tuple plus manifest cross-check, standalone Copilot file with byte-parity on common sections | One more skill root, one more hook surface, and two provider-owned sections to review | Accepted |

## Consequences

- Copilot participates in the same audit, setup, and dashboard matrix as the other three agents.
- A roster change is a manifest plus union edit; a manifest agent missing from the union fails loudly at load.
- Preflight and drift checks fail when a standalone instruction file drifts on a common section, without erasing valid provider differences.

## Revisit Triggers

Copilot changes its instruction, skills, or hooks contract or publishes a precedence rule; `.github/skills/` parity cannot be kept against the canonical templates; a specialization gap forces `.github/agents/`; a fifth runtime is proposed or a current one retired.
