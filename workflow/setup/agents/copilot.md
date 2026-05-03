# Agent Config - Copilot CLI

> Canonical machine-readable source for these paths: `workflow/manifest.json` via `src/cli/agents/registry.ts`. If this doc drifts, the manifest-backed registry wins.

## Paths

| Resource | Path |
|----------|------|
| Instruction file | `.github/copilot-instructions.md` |
| Commit instructions | `.github/git-commit-instructions.md` |
| Skills directory | `.github/skills/` |
| Hooks config | `.github/hooks/hooks.json` |
| Hooks directory | `.github/hooks/` |
| Ignore file | `.copilotignore` |

## Owns

`.github/copilot-instructions.md`, `.github/git-commit-instructions.md`, `.github/skills/`, `.github/hooks/`, `.copilotignore`, and shared `.goat-flow/`.

## Hands off

`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.claude/`, `.codex/`, `.gemini/`, `.agents/`.

Copilot runs on a standalone hot-path instruction file, not an overlay. `.github/copilot-instructions.md` carries its own Truth Order, Execution Loop, Definition of Done, Router Table, and Autonomy Tiers - the same contract CLAUDE.md / AGENTS.md / GEMINI.md ship. See `.goat-flow/decisions/ADR-021-goat-critique-full-mode-only.md` for the hot-path contract rationale more broadly; Copilot follows the same single-contract-per-agent model.

## Agent-specific setup

### Instruction composition

- Keep `.github/copilot-instructions.md` at `<= 150` lines (hard limit) with `<= 125` as the target.
- It MUST contain Truth Order, Execution Loop (READ → SCOPE → ACT → VERIFY), Definition of Done, Router Table, and Autonomy Tiers - the same hot-path sections as CLAUDE.md / AGENTS.md / GEMINI.md.
- Add a **Copilot-Specific** section at the end for runtime specifics: current Copilot CLI commands (`/agent`, `/review`, `/research`, `/tasks`), `/fleet` usage, `.github/hooks/hooks.json` guardrails, and `.copilotignore` hygiene.
- Do NOT defer to AGENTS.md; Copilot is a peer, not an overlay consumer.
- When `.github/` exists, commit guidance MUST live at `.github/git-commit-instructions.md`. Treat that file as part of the Copilot install; `goat-flow audit --agent copilot` fails without it.

### Hooks

After completing step 03 (skills):
- Copy `workflow/hooks/deny-dangerous.sh` to `.github/hooks/deny-dangerous.sh`.
- Copy `workflow/hooks/agent-config/copilot-hooks.json` to `.github/hooks/hooks.json`.
- Keep a single Copilot hook config file. Do not split one file per event.
- The shipped Wave 6 model uses `preToolUse` only. Post-turn hooks and `.github/agents/` are out of scope unless a concrete gap appears later.

### Skills and Copilot commands

- Install the same 7 goat-flow skills into `.github/skills/`.
- Prefer Copilot CLI commands exposed by `copilot help commands` (`/agent`, `/review`, `/research`, `/tasks`) plus `/fleet` for parallelizable work.
- Do not create `.github/agents/` in Wave 6. Revisit only if the current command surface cannot cover a concrete specialization need.
- `/fleet` is for independent tasks, not sequential steps that block on each other.

### Ignore and MCP surfaces

- Keep `.copilotignore` aligned with the secret-bearing paths the repo already protects.
- If MCP guidance is project-specific, put it in `.github/copilot-instructions.md` under the Copilot-Specific section.

### Verification

- `.github/copilot-instructions.md` exists and stays under the 150-line hard limit (125 target)
- `.github/git-commit-instructions.md` exists
- `.github/copilot-instructions.md` contains Truth Order, Execution Loop, Definition of Done, Router Table, and Autonomy Tiers as level-2 headings
- Instruction file includes the `.goat-flow/skill-reference/` READ rule and Router Table pointer (per Step 02 verification gate)
- `.github/skills/` contains the 7 canonical goat-flow skills
- `.github/hooks/hooks.json` registers `.github/hooks/deny-dangerous.sh`
- `bash .github/hooks/deny-dangerous.sh --self-test` passes
- `goat-flow audit . --harness` context concern reports `copilot: all 6 required sections present`

---

Begin setup: proceed to `01-system-overview.md`
