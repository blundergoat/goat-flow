# ADR-020: Add Copilot CLI as a first-class supported agent

**Status:** Accepted
**Date:** 2026-04-18

## Context

goat-flow currently supports three agents as first-class: Claude Code, Codex, and Gemini CLI. Each has a full audit/setup/dashboard path, a per-agent workflow guide, installed skills, hooks, a settings surface, and a deny mechanism — all enumerated in `workflow/manifest.json` and driven off a single shared `AgentId` type in `src/cli/types.ts:7`.

GitHub Copilot CLI now exposes the same categories of customization surface the other three agents already use:

- **Instructions.** `.github/copilot-instructions.md` applies repo-wide, `.github/instructions/**/*.instructions.md` applies by `applyTo` glob, and root `AGENTS.md` is loaded alongside both. Precedence and merge behaviour are defined and deterministic for the same-file case, non-deterministic only when two files conflict (https://docs.github.com/en/enterprise-cloud%40latest/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions).
- **Skills.** `.github/skills/<name>/SKILL.md` with YAML frontmatter (`name`, `description`, optional `license`, `allowed-tools`) — the same shape as the goat skills already shipped under `.claude/skills/` and `.agents/skills/`. Invocation is `/<skill-name>` and `/skills list` (https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills).
- **Hooks.** `.github/hooks/hooks.json` (single file, `version: 1`, `hooks` object keyed by event: `sessionStart`, `sessionEnd`, `userPromptSubmitted`, `preToolUse`, `postToolUse`, `errorOccurred`). Commands have `bash` and `powershell` variants, `timeoutSec` (default 30), and a per-hook `env` map (https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/use-hooks).
- **Agents.** Four built-in subagents (`explore`, `task`, `general-purpose`, `code-review`) plus `/fleet` for parallel subtask decomposition cover the subagent needs goat-flow relies on elsewhere. Repository custom agents in `.github/agents/` are supported but are not required to reach parity (https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli-agents/invoke-custom-agents, https://docs.github.com/en/copilot/concepts/agents/copilot-cli/fleet).

The framework has a single-source-of-truth path that prevents prior multi-source drift: `workflow/manifest.json` declares each agent's instruction file, skills dir, hooks dir, and settings path; `src/cli/audit/check-agent-setup.ts` reads those paths via `ctx.structure.agents[agentId]` rather than hardcoding them; `src/cli/detect/agents.ts` and the `AgentId` union in `src/cli/types.ts` are the only places that enumerate agents. Adding Copilot requires filling in the same manifest row and widening the type — not spreading Copilot-specific logic across the audit, scanner, or dashboard.

## Decision

Add `copilot` as a fourth first-class `AgentId`, at parity with `claude`, `codex`, and `gemini` across:

1. **Type + runtime:** `AgentId` union in `src/cli/types.ts`, `VALID_AGENTS` in `src/cli/cli.ts` and `src/cli/server/dashboard.ts`, the iteration in `src/cli/detect/agents.ts`, and the agent-specific maps in `src/cli/prompt/compose-setup.ts` and `src/cli/prompt/compose-quality.ts`.
2. **Manifest:** a `copilot` block in `workflow/manifest.json` pointing at `.github/copilot-instructions.md`, `.github/skills/`, `.github/hooks/hooks.json`, and (null) settings. The manifest is the audit's source of truth, so adding this row picks up audit coverage automatically.
3. **Detection profile:** a Copilot entry in `src/cli/detect/agents.ts` with instruction file `.github/copilot-instructions.md` and hook events `preToolUse` / `postToolUse` (Copilot's native event names).
4. **Setup surface:** a Copilot-specific workflow guide at `workflow/setup/agents/copilot.md` and a ≤120-line `.github/copilot-instructions.md` that complements, rather than duplicates, root `AGENTS.md`.
5. **Skills install target:** `.github/skills/` added to the install set and to preflight parity checks (`diff -r .claude/skills .github/skills`), on the same basis as the other agents' install locations.
6. **Hooks:** ship a single `.github/hooks/hooks.json` carrying the same deny-dangerous guardrail the other agents ship (mapping it to Copilot's `preToolUse` event), rather than pretending Copilot lacks a runtime hook surface.
7. **Dashboard:** Copilot appears in the agent enumeration, setup wizard, quality-prompt flow, and audit filter paths without requiring new schema work.

## Out of scope for this ADR

- **Repository custom agents (`.github/agents/`).** The built-in `explore` / `task` / `general-purpose` / `code-review` agents plus `/fleet` cover current needs. `.github/agents/` is revisited only if a concrete specialization gap appears.
- **Bridge files** between agent instruction files. The same-concept-same-description rule in `CLAUDE.md` already forces parity without introducing a second editable source.
- **Per-model guidance.** Model selection (Opus vs Sonnet vs Codex) is agent-configuration, not framework scope.

## Consequences

- **Positive:** goat-flow's agent model becomes `claude | codex | gemini | copilot`, matching the four CLIs users actually run. The audit, setup, and dashboard surfaces all stop silently dropping Copilot users with an "invalid agent" error.
- **Positive:** `.github/skills/` becomes a maintained install location with drift and parity coverage, rather than an unvalidated surface.
- **Positive:** Hooks become an honest first-class Copilot feature (`.github/hooks/hooks.json`) rather than a "Copilot is hookless" caveat.
- **Negative:** Every place that enumerates agents or maps `AgentId` → path must grow a fourth entry. `workflow/manifest.json`, `src/cli/types.ts`, `src/cli/cli.ts`, `src/cli/server/dashboard.ts`, `src/cli/detect/agents.ts`, `src/cli/prompt/compose-setup.ts`, and `src/cli/prompt/compose-quality.ts` all need the Copilot row.
- **Negative:** Instruction composition is more delicate than the other three agents. Copilot CLI loads root `AGENTS.md` *and* `.github/copilot-instructions.md` *and* any matching `.github/instructions/**/*.instructions.md` together, and the docs explicitly warn that conflicting guidance across those surfaces resolves non-deterministically. The setup guide must teach complementary, non-duplicative content across those files.
- **Negative:** Adding a fourth skills install location widens the preflight parity surface. The `diff -r` / drift check now covers three installed copies instead of two.
- **Neutral:** `/fleet` premium-request cost is a real Copilot tradeoff but is a user-configuration concern, not a framework concern.

## Implementation track

Full implementation is scoped under `.goat-flow/tasks/1.2.0-wave-6/` across five milestones (governance, runtime + dashboard + detection, setup + audit + instructions, skills parity + built-in-agent validation, end-to-end release readiness). That plan is the authoritative task breakdown; this ADR is the governance decision it executes against.

## Related decisions

- **ADR-009** — skill-consolidation doctrine. Any Copilot-specific skill divergence has to pass the same justification gate (distinct artefact, hard workflow gate, special failure mode, or repeatable structured output).
- **ADR-013** — audit as the sole evaluation engine. Copilot must audit through the same `workflow/manifest.json`-driven path, not a second scoring lane.
- **ADR-017** — active-plan marker. The Wave 6 track lives at `.goat-flow/tasks/1.2.0-wave-6/`, outside the `.active` marker, until it becomes the active plan.

## Revisit Triggers

Revisit if any of the following hold:

- Copilot CLI deprecates or materially changes the `.github/copilot-instructions.md`, `.github/skills/`, or `.github/hooks/hooks.json` surfaces this ADR depends on.
- The four-surface instruction composition (`AGENTS.md` + `copilot-instructions.md` + `.github/instructions/**` + local) starts producing non-deterministic conflicts that the setup guide cannot resolve by structural rules.
- `.github/skills/` parity cannot be maintained against the canonical `.claude/skills/` copies without silent divergence.
- A concrete specialization gap in the built-in agent set appears that `/fleet` cannot close, forcing reconsideration of `.github/agents/`.
