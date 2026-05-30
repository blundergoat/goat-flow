# ADR-020: Add Copilot CLI as a first-class supported agent

**Status:** Accepted
**Date:** 2026-04-18
**Updated:** 2026-05-27 - Runtime slot updated per ADR-030; the four-agent parity matrix now reads Claude, Codex, Antigravity, and Copilot.

## Context

goat-flow supports agent runtimes through one manifest-backed registry: `workflow/manifest.json` is the writable source of truth, `src/cli/agents/registry.ts` is the runtime facade, and the CLI, dashboard, setup flow, and audit read from that registry instead of maintaining parallel allowlists.

Copilot CLI now exposes the same broad categories of surface the other supported agents use:

- **Instructions.** `.github/copilot-instructions.md` for repo-wide Copilot guidance, plus optional `.github/instructions/**/*.instructions.md` for path-specific rules.
- **Skills.** `.github/skills/<name>/SKILL.md` using the same goat skill shape as the existing installed copies.
- **Hooks.** `.github/hooks/hooks.json` plus on-disk scripts such as `.github/hooks/patterns-writes.sh`.
- **Copilot commands.** Current Copilot CLI command help exposes `/agent`, `/review`, `/research`, and `/tasks`, plus `/fleet` for parallelizable work.

The live repo already carries peer hot-path instruction files (`CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`), shared guardrail script templates under `workflow/hooks/`, and canonical skill templates under `workflow/skills/`. Shipping Copilot support therefore means wiring Copilot into the same standalone per-agent model rather than inventing a special-case bridge.

## Decision

Treat `copilot` as a first-class `AgentId` and ship full runtime parity in the same wave:

1. `workflow/manifest.json` includes a real Copilot profile with:
   - instruction file `.github/copilot-instructions.md`
   - skills root `.github/skills/`
   - hooks dir `.github/hooks/`
   - hook config `.github/hooks/hooks.json`
2. Runtime surfaces (`src/cli/types.ts`, registry, setup prompt routing, dashboard, quality history/schema, state classification) accept `copilot`.
3. Setup ships a real Copilot guide at `workflow/setup/agents/copilot.md`.
4. Repo live surfaces include `.github/copilot-instructions.md`, `.github/hooks/`, and `.github/skills/`.
5. Copilot uses a standalone hot-path instruction file. `.github/copilot-instructions.md` carries its own Truth Order, Execution Loop, Definition of Done, Router Table, and Autonomy Tiers, while optional `.github/instructions/**/*.instructions.md` remains path-scoped only.
6. Hooks use one canonical Copilot config file: `.github/hooks/hooks.json` carrying the split guardrail hooks.
7. Wave 6 relies on the current Copilot CLI command surface plus `/fleet`. Repository custom agents in `.github/agents/` stay out of scope unless a concrete specialization gap is proven later.

## Out of scope for this ADR

- **Repository custom agents (`.github/agents/`).** Revisit only if the current command surface plus `/fleet` cannot cover a demonstrated need.
- **Bridge files** between `AGENTS.md` and `.github/copilot-instructions.md`. Standalone per-agent instruction files are preferred over a second editable source of truth.
- **Per-model guidance.** Model selection remains an agent/runtime concern, not a framework concern.

## Consequences

- **Positive:** Copilot now participates in the same audit/setup/dashboard matrix as Claude, Codex, and Antigravity.
- **Positive:** `.github/skills/` and `.github/hooks/` become maintained install targets rather than undocumented side surfaces.
- **Positive:** The registry stays honest: support claims match the runtime, not just the docs.
- **Negative:** The repo now has another installed skill root and hook surface to keep in parity, so preflight and drift checks must enforce it.

## Implementation track

Wave 6 is the implementation track that lands the runtime, setup, skills, docs, and validation work required by this ADR.

## Related decisions

- **ADR-009** - skill-consolidation doctrine. Copilot uses the same canonical skills; divergence still requires explicit justification.
- **ADR-013** - audit as the sole evaluation engine. Copilot support lands through the same manifest-backed audit path, not a parallel scoring lane.
- **ADR-017** - active-plan marker. Wave 6 stays a scoped plan bucket even though the runtime support is now shipped.

## Revisit Triggers

Revisit if any of the following hold:

- Copilot CLI materially changes `.github/copilot-instructions.md`, `.github/skills/`, or `.github/hooks/hooks.json`.
- Cross-file instruction composition (`AGENTS.md` + `.github/copilot-instructions.md` + `.github/instructions/**`) becomes non-deterministic enough that structural separation no longer prevents conflicts.
- `.github/skills/` parity cannot be maintained against the canonical skill templates without silent divergence.
- A concrete specialization gap appears that the current command surface plus `/fleet` cannot cover, forcing reconsideration of `.github/agents/`.
