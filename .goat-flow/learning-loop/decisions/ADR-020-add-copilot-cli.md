# ADR-020: Supported agent roster and identity authority

**Status:** Accepted
**Date:** 2026-04-18
**Updated:** 2026-08-30 - retained standalone provider files while adding a machine-checked shared contract for Copilot's multi-file composition. This also preserves the 2026-08-15 absorption of ADR-030 (Antigravity replaces Gemini) and ADR-022 (canonical agent identity).

## Context

goat-flow supports agent runtimes through one manifest-backed registry: `workflow/manifest.json` is the writable source of truth, `src/cli/agents/registry.ts` is the runtime facade, and the CLI, dashboard, setup flow, and audit read from that registry instead of maintaining parallel allowlists.

Copilot CLI exposes the same broad categories of surface the other supported agents use. Its current custom-instruction contract detects `.github/copilot-instructions.md`, `AGENTS.md`, and `CLAUDE.md`, combines applicable repository instructions, and does not publish a general precedence rule between them ([GitHub documentation](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions)).

- **Instructions.** `.github/copilot-instructions.md` for repo-wide Copilot guidance, plus optional `.github/instructions/**/*.instructions.md` for path-specific rules.
- **Skills.** `.github/skills/<name>/SKILL.md` using the same goat skill shape as the existing installed copies.
- **Hooks.** `.github/hooks/hooks.json` registering on-disk guardrail scripts. Registration now points at the central dispatcher under `.goat-flow/hooks/` (ADR-033), so `.github/hooks/` holds the config file rather than per-agent script copies.
- **Copilot commands.** Interactive slash commands are entered by the user. Agent instructions may recommend a relevant current command after checking help, but cannot treat that command as an agent-callable tool.

The live repo already carries peer hot-path instruction files (`CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`), shared guardrail script templates under `workflow/hooks/`, and canonical skill templates under `workflow/skills/`. Shipping Copilot support therefore means wiring Copilot into the same standalone per-agent model rather than inventing a special-case bridge.

Two follow-on problems came from the same root. The fourth runtime slot changed hands from Gemini to Antigravity, and hardcoded `["claude", "codex", "antigravity", "copilot"]` literals scattered across non-type-position code meant the roster existed in several places at once - so a roster change had to be chased rather than made.

## Decision

### Roster

Canonical agents are `claude`, `codex`, `antigravity`, and `copilot`.

Gemini runtime surfaces are removed from current setup, audit, dashboard, hook, and skill-install contracts. Antigravity owns the fourth-agent slot and uses `.agents/` surfaces where the manifest says so. Current docs and revisit-trigger enumerations must use the canonical set above.

### Identity authority

Hybrid authority with a single compile-time source of truth for identity and a single runtime source for the materialised tuple:

1. **`KNOWN_AGENT_IDS` and the derived `AgentId` union stay in `src/cli/types.ts`** as the compile-time authority. All TypeScript code that needs the union (including `Record<AgentId, X>` lookups) imports from here.
2. **`KNOWN_AGENT_IDS` is re-exported from `src/cli/agents/registry.ts`** for runtime consumers alongside the existing `getKnownAgentIds()` helper. The tuple is `as const` so its element types are literal-narrow.
3. **`getKnownAgentIds()` continues to derive from `loadManifest().agents`** at runtime - that remains the cross-check between the compile-time union and the on-disk manifest.
4. **Manifest validates against the union** at load time. If `workflow/manifest.json` gains an agent key that isn't in `AgentId`, `getKnownAgentIds()`'s `isAgentId` filter drops it and `loadManifest()` surfaces the mismatch via the existing `ManifestValidationError` path.
5. **All hardcoded agent-ID literals** in non-type-position code migrate to `KNOWN_AGENT_IDS` or `getKnownAgentIds()`. Type-position uses (`Record<AgentId, X>`) stay as-is - they're already authority-driven via the union.

### Copilot parity

Treat `copilot` as a first-class `AgentId` and ship full runtime parity in the same wave:

1. `workflow/manifest.json` includes a real Copilot profile with:
   - instruction file `.github/copilot-instructions.md`
   - skills root `.github/skills/`
   - hooks dir `.github/hooks/`
   - hook config `.github/hooks/hooks.json`
2. Runtime surfaces (`src/cli/types.ts`, registry, setup prompt routing, dashboard, quality history/schema, state classification) accept `copilot`.
3. Setup ships a real Copilot guide at `workflow/setup/agents/copilot.md`.
4. Repo live surfaces include `.github/copilot-instructions.md`, `.github/hooks/`, and `.github/skills/`.
5. Copilot uses a standalone, physically complete hot-path instruction file. `workflow/manifest.json` classifies common sections that must remain byte-identical across `AGENTS.md`, `CLAUDE.md`, and `.github/copilot-instructions.md`; only reasoned provider-delta sections may differ. Optional `.github/instructions/**/*.instructions.md` remains Copilot path-scoped guidance.
6. Hooks use one canonical Copilot config file: `.github/hooks/hooks.json` carrying the split guardrail hooks.
7. Wave 6 uses runtime-exposed agent/task capabilities for independent work. Repository custom agents in `.github/agents/` stay out of scope unless a concrete specialization gap is proven later; interactive slash commands remain user-entered capabilities.

## Out of scope for this ADR

- **Repository custom agents (`.github/agents/`).** Revisit only if current runtime capabilities cannot cover a demonstrated need.
- **Generated bridge files** between `AGENTS.md`, `CLAUDE.md`, and `.github/copilot-instructions.md`. Standalone provider files remain reviewable in isolation; deterministic parity is enforcement, not runtime generation.
- **Per-model guidance.** Model selection remains an agent/runtime concern, not a framework concern.

## Consequences

- **Positive:** Copilot participates in the same audit/setup/dashboard matrix as Claude, Codex, and Antigravity.
- **Positive:** `.github/skills/` and `.github/hooks/` are maintained install targets rather than undocumented side surfaces.
- **Positive:** The registry stays honest: support claims match the runtime, not just the docs.
- **Positive:** Changing the roster is a manifest plus union edit, not a repo-wide literal hunt. A new agent that reaches the manifest but not the union fails loudly at load rather than half-working.
- **Positive:** Shared hot-path policy now fails deterministic parity checks when one standalone provider file drifts.
- **Negative:** The repo has another installed skill root, hook surface, and two explicitly provider-owned instruction sections to review, so preflight and drift checks must enforce the common contract without erasing valid differences.

## Related decisions

- **ADR-009** - canonical skill set. Every agent uses the same canonical skills; divergence still requires explicit justification.
- **ADR-013** - audit as the sole evaluation engine. Agent support lands through the same manifest-backed audit path, not a parallel scoring lane.
- **ADR-017** - active-plan marker. Wave 6 stays a scoped plan bucket even though the runtime support is now shipped.

## Revisit Triggers

Revisit if any of the following hold:

- Copilot CLI materially changes `.github/copilot-instructions.md`, `.github/skills/`, or `.github/hooks/hooks.json`.
- Copilot changes which repository instruction files it composes, publishes a precedence contract, or makes the current shared/provider-delta partition insufficient.
- `.github/skills/` parity cannot be maintained against the canonical skill templates without silent divergence.
- A concrete specialization gap appears that current runtime capabilities cannot cover, forcing reconsideration of `.github/agents/`.
- A fifth runtime is proposed, or a current runtime is retired - both change the canonical set and every enumeration derived from it.
