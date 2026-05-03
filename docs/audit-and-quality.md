# Audit & Quality

goat-flow has two evaluation commands. `audit` is deterministic - it runs checks and reports findings. `quality` is inferential - it generates a prompt for an agent to evaluate quality.

## Quick reference

```bash
npx goat-flow audit .                              # Build correctness (pass/fail)
npx goat-flow audit . --harness                    # Include AI harness completeness checks
npx goat-flow audit . --agent claude               # Scope to one agent
npx goat-flow quality . --agent gemini             # Generate quality-assessment prompt for one agent
npx goat-flow quality history --agent gemini       # Review saved trend history
npx goat-flow quality diff --agent gemini          # Compare the latest two saved runs
```

| Command | Output | Deterministic? | Gates CI? | Requires --agent? |
|---------|--------|---------------|-----------|-------------------|
| `audit` | Pass/fail per scope | Yes | Yes - exit 1 on failure | No (checks all configured agents) |
| `audit --harness` | Pass/fail per harness concern | Yes | Yes - exit 1 on failure | No |
| `quality` | Prompt for an agent | No - generates a prompt | Never | Yes |

---

## `goat-flow audit`

Validates that the project's agent harness is structurally correct and complete. All checks are pass/fail.

For the full deterministic inventory, including every check id and what it validates, see [Deterministic audit checks](audit-checks.md).

### Build mode (default)

Binary pass/fail. This is the structural setup gate - it validates that required files/directories exist, config parses, skills are installed at the expected paths, and hooks are registered. It does not execute configured toolchain commands (lint, test, build). Step 06 uses `audit` as the minimum gate; preflight runs `audit` plus additional checks including ESLint, Prettier, version consistency, instruction file line counts (warn at `line_target`, fail at `line_limit`), Router Table path parity across agents, encyclopedia-content guards, and downstream-content guards.

Checks are grouped by **scope**:

**setup scope** (GOAT Flow Setup) - 14 checks on goat-flow-owned surfaces:
- `lessons` - `.goat-flow/lessons/` directory and README exist
- `footguns` - `.goat-flow/footguns/` directory and README exist
- `architecture` - `.goat-flow/architecture.md` exists
- `code-map` - `.goat-flow/code-map.md` exists
- `glossary` - `.goat-flow/glossary.md` exists
- `patterns` - `.goat-flow/patterns/README.md` exists
- `decisions` - `.goat-flow/decisions/` directory exists
- `session-logs` - `.goat-flow/logs/sessions/` directory exists
- `tasks` - `.goat-flow/tasks/` directory, `.gitignore`, and README exist (local-session state by design)
- `scratchpad` - `.goat-flow/scratchpad/` directory, `.gitignore`, and README exist (local WIP by design)
- `instruction-file-skill-reference-pointer` - when `.goat-flow/skill-reference/` exists, every present instruction file has both the READ-step availability-check rule and Router Table pointer, and the full reference pack including `.goat-flow/skill-reference/README.md` exists; when the directory is absent, this check is skipped
- `other-files` - Other required manifest surfaces not already covered by named setup checks exist (for example quality-log paths)
- `config-parses` - `.goat-flow/config.yaml` parses and validates, including manifest-backed `agents:` ids
- `config-version` - Config version matches current release

**agent scope** (Agent Setup) - 4 registered checks. In aggregate mode, only `agent-instruction` can actively fail without `--agent <id>`:
- `agent-instruction` - selected agent instruction file exists; aggregate mode also detects orphaned agent artifacts whose instruction file is missing
- `agent-skills` - selected agent has canonical skills installed with correct versions and no deprecated skill directories
- `agent-settings` - selected agent settings/config file parses as valid JSON or TOML
- `agent-deny-dangerous` - selected agent has a deny mechanism, shell-hook syntax is valid, deny patterns exist, and the deny self-test passes when the script exists

**Agent detection:** `audit` detects configured agents from the manifest-backed instruction-file registry (`workflow/manifest.json` via `src/cli/agents/registry.ts`). Run `npx goat-flow manifest` to inspect the current support matrix; use `--agent <id>` to scope checks to one supported runtime.

### Harness mode (`--harness`)

Adds 16 checks across the five harness concerns on top of the default build checks. These check AI harness completeness -- whether the project has the structures that make agents effective. Harness checks are deterministic but classified by type (see `HarnessCheckType` in `src/cli/audit/types.ts`): **integrity** (drift from install state - affects concern status), **advisory** (best practice - affects status unless the check id is listed in `harness.acknowledge` in `config.yaml`), and **metric** (workflow maturity signal - never affects status).

Harness checks are grouped by **concern** -- the five things that matter for agent effectiveness. See [harness-engineering.md](harness-engineering.md) for what each concern means and the sources behind the model.

**harness scope** (AI Harness Completeness) - 16 checks across 5 concerns:
- **Context** (5) - instruction file within line limit, execution loop present, doc paths resolve, required instruction sections present, workspace boundary guidance present
- **Constraints** (4) - deny blocks direct literal secret paths, deny blocks dangerous commands, deny blocks pipe-to-shell, deny hook registered in agent settings
- **Verification** (3) - hooks in sync, commit guidance, post-turn hook integrity
- **Recovery** (2) - milestone tracking, session logs
- **Feedback Loop** (2) - feedback loop directories exist, decisions tracked

Sample harness output:

```
GOAT Flow Setup:          PASS
  Skills:                 7/7 installed
  Config:                 valid, version 1.4.2
  InstructionFile:        118 lines

Agent Setup:              PASS
  Toolchain:              not configured (optional)
  Hooks:                  claude:deny installed, codex:deny installed, gemini:deny installed, copilot:deny installed

AI Harness Completeness:  PASS
  Context:                PASS (5/5)
  Constraints:            FAIL (3/4) - pipe-to-shell not blocked for codex
  Verification:           PASS (3/3)
  Recovery:               PASS (2/2)
  Feedback Loop:          PASS (2/2)

Result: FAIL (Constraints)
```

### Skill-template drift (`--check-drift` and multi-agent auto-run)

The `--check-drift` flag compares workflow skill templates against their installed copies and reports `content | missing | orphan | deprecated` findings. Any finding makes the drift scope fail, which fails the overall audit.

For single-agent projects the check is opt-in via the flag. For multi-agent projects (more than one agent instruction file - CLAUDE.md, AGENTS.md, GEMINI.md, or `.github/copilot-instructions.md` - present on disk) it runs automatically without the flag. Rationale: when a single-agent migration completes, the satellite agents' skill dirs (`.agents/skills/`, `.github/skills/`, etc.) are left with pre-v1.2 skill names flagged as `deprecated`. The auto-run surfaces this so `audit` doesn't exit "pass" while the satellite agents are stale. When deprecated findings are present the renderer also emits a one-line hint to run `goat-flow install . --agent <agent>` for each stale agent.

---

## `goat-flow quality`

Generates a structured quality-assessment prompt for a coding agent to evaluate goat-flow quality and usefulness on the current project. This is fundamentally different from `audit` - it produces a prompt, not findings.

```bash
npx goat-flow quality . --agent gemini
```

The generated prompt asks the agent to:

1. **Assess each of the 7 skills** - `/goat` (dispatcher), `/goat-debug`, `/goat-plan`, `/goat-review`, `/goat-critique`, `/goat-security`, `/goat-qa`. Preferred method is file analysis (read each SKILL.md and evaluate structure, constraints, and coherence against the codebase); live invocation on real code when context budget allows.
2. **Evaluate setup quality** - was the instruction file adapted or generic?
3. **Find contradictions** across instruction file, skill files, and `.goat-flow/` docs
4. **Identify false paths** - references to files that don't exist, stale concepts, dead modes
5. **Rate the system** - setup accuracy/relevance/completeness/friction + system usefulness/signal-to-noise/adaptability/learnability

**Time and cost expectation:** A full assessment evaluates all 7 skills (file analysis by default; live invocation when context allows - `goat-critique` alone spawns 3 sub-agents if invoked). Expect 15-60 minutes depending on depth, with moderate token usage. If context is limited, the generated prompt requires at minimum testing `/goat` (routing), `/goat-review` (most common use), and `/goat-critique` (highest-cost skill).

The prompt includes the current `audit` summary so the agent knows what's already passing or failing. If audit is failing, the prompt explicitly asks the agent to assess the incomplete setup.

### Quality report lifecycle

`npx goat-flow quality` composes the prompt and instructs the agent to write its final JSON report directly to `.goat-flow/logs/quality/<YYYY-MM-DD>-<HHMM>-<agent>-<rand5>.json` - a gitignored path. No separate capture step is needed; the agent owns the write, and `history` / `diff` operate on whatever the agent saved.

```bash
npx goat-flow quality . --agent gemini             # Default: Agent Installation mode
npx goat-flow quality . --agent claude --mode process   # GOAT Flow Process mode
npx goat-flow quality . --agent claude --mode harness   # Harness Engineering mode
npx goat-flow quality . --agent claude --mode skills    # Skills mode
npx goat-flow quality history --agent gemini            # List saved reports + same-agent score deltas
npx goat-flow quality history --mode process            # Filter history to one quality mode
npx goat-flow quality diff --agent gemini               # Derive resolved / new / persisted / stuck vs prior run
npx goat-flow quality diff --mode skills                # Compare within one mode only
```

### Quality modes

The `--mode` flag selects a focused quality assessment. Each mode generates a different prompt targeting a specific evaluation surface.

| Mode | `--mode` value | What it assesses |
|------|---------------|-----------------|
| **Agent Installation** | `agent-setup` (default) | Accuracy, relevance, completeness, and friction of the active agent installation |
| **GOAT Flow Process** | `process` | Whether the execution loop, learning loop, and skill workflows function as documented |
| **Harness Engineering** | `harness` | Harness concern coverage (context, constraints, verification, recovery, feedback loop) |
| **Skills** | `skills` | Skill quality: Step 0 gates, human checkpoints, output formats, cross-skill coherence |

`history` and `diff` compare within the same mode by default. Cross-mode comparison is not supported since the scoring rubrics differ.

- `quality` composes a structured prompt that ends with an instruction to save the JSON report under `.goat-flow/logs/quality/`. Positional finding ids are computed at load time by `history` / `diff`.
- `quality history` lists saved reports and same-agent setup/system score deltas.
- `quality diff` derives `resolved`, `new`, `persisted`, and `stuck` from saved same-agent report ids.

This keeps audit and quality separated in both terminology and storage: audit remains deterministic CLI output, while quality reports are agent-emitted assessments saved to a gitignored log directory for local trend analysis.

### When to use quality

- After setup is complete and audit passes - "is this actually good?"
- After significant changes - "did we break anything the auditor can't see?"
- Periodically - "has the harness drifted?"
- When onboarding - "does this make sense to a fresh agent?"

### When NOT to use quality

- As a setup gate (use `audit`)
- As a CI check (use `audit`)
- As a replacement for `audit --harness` (quality is subjective; harness completeness checks are deterministic)

---

## How they work together

```
npx goat-flow audit .              →  "Is it installed correctly?"        →  Fix structural issues
npx goat-flow audit . --harness    →  "Is the harness complete?"          →  Fix failing concerns
npx goat-flow quality . --agent X  →  "What does an agent actually think?" →  Get fresh perspective
```

Typical workflow after setup:
1. Run `audit` - fix any build failures
2. Run `audit --harness` - fix any failing harness completeness checks
3. Run `quality` - paste the prompt into an agent session, get a subjective review; the agent writes its JSON report to `.goat-flow/logs/quality/` itself
4. Run `quality history` / `quality diff` - compare trend lines and finding lifecycles across same-agent runs
5. Feed durable findings back into the harness (footguns, lessons, decisions) - the feedback loop

---

## Further reading

- [Harness engineering](harness-engineering.md) - what each concern means and the sources behind the model
