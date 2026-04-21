# Audit & Quality

goat-flow has two evaluation commands. `audit` is deterministic - it runs checks and reports findings. `quality` is inferential - it generates a prompt for an agent to evaluate quality.

## Quick reference

```bash
goat-flow audit .                              # Build correctness (pass/fail)
goat-flow audit . --harness                    # Include AI harness completeness checks
goat-flow audit . --agent claude               # Scope to one agent
goat-flow quality . --agent gemini             # Generate quality-assessment prompt for one agent
goat-flow quality history --agent gemini       # Review saved trend history
goat-flow quality diff --agent gemini          # Compare the latest two saved runs
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

Binary pass/fail. This is the structural setup gate - it validates that required files/directories exist, config parses, skills are installed at the expected paths, and hooks are registered. It does not execute configured toolchain commands (lint, test, build). Step 06 uses `audit` as the minimum gate; preflight runs `audit` plus additional checks including ESLint, Prettier, and version consistency.

Checks are grouped by **scope**:

**setup scope** (GOAT Flow Setup) - 13 checks on goat-flow-owned surfaces:
- `lessons` - `.goat-flow/lessons/` directory and README exist
- `footguns` - `.goat-flow/footguns/` directory and README exist
- `architecture` - `.goat-flow/architecture.md` exists
- `code-map` - `.goat-flow/code-map.md` exists
- `glossary` - `.goat-flow/glossary.md` exists
- `patterns` - `.goat-flow/patterns.md` exists
- `decisions` - `.goat-flow/decisions/` directory exists
- `session-logs` - `.goat-flow/logs/sessions/` directory exists
- `tasks` - `.goat-flow/tasks/` directory, `.gitignore`, and README exist (local-session state by design)
- `scratchpad` - `.goat-flow/scratchpad/` directory, `.gitignore`, and README exist (local WIP by design)
- `other-files` - Other required manifest surfaces not already covered by named setup checks exist (for example skill-reference and quality-log paths)
- `config-parses` - `.goat-flow/config.yaml` parses and validates, including manifest-backed `agents:` ids
- `config-version` - Config version matches current release

**agent scope** (Agent Setup) - 4 registered checks. In aggregate mode, only `agent-instruction` can actively fail without `--agent <id>`:
- `agent-instruction` - selected agent instruction file exists; aggregate mode also detects orphaned agent artifacts whose instruction file is missing
- `agent-skills` - selected agent has canonical skills installed with correct versions and no deprecated skill directories
- `agent-settings` - selected agent settings/config file parses as valid JSON or TOML
- `agent-deny-dangerous` - selected agent has a deny mechanism, shell-hook syntax is valid, deny patterns exist, and the deny self-test passes when the script exists

**Agent detection:** `audit` detects configured agents from the manifest-backed instruction-file registry (`workflow/manifest.json` via `src/cli/agents/registry.ts`). Run `goat-flow manifest` to inspect the current support matrix; use `--agent <id>` to scope checks to one supported runtime.

### Harness mode (`--harness`)

Adds 16 checks across the five harness concerns on top of the default build checks. These check AI harness completeness -- whether the project has the structures that make agents effective. Harness checks are deterministic but classified by type (see `HarnessCheckType` in `src/cli/audit/types.ts`): **integrity** (drift from install state - affects concern status), **advisory** (best practice - affects status unless the check id is listed in `harness.acknowledge` in `config.yaml`), and **metric** (workflow maturity signal - never affects status).

Harness checks are grouped by **concern** -- the five things every major harness engineering source agrees matter for agent effectiveness. See [harness-engineering.md](harness-engineering.md) for what each concern means and the sources behind the model.

**harness scope** (AI Harness Completeness) - 16 checks across 5 concerns:
- **Context** (4) - instruction file within line limit, execution loop present, doc paths resolve, required instruction sections present (advisory)
- **Constraints** (4) - deny covers secrets, deny blocks dangerous commands, deny blocks pipe-to-shell, deny hook registered in agent settings
- **Verification** (4) - test runner configured, hooks in sync, commit guidance, post-turn hook integrity
- **Recovery** (2) - milestone tracking, session logs
- **Feedback Loop** (2) - feedback loop directories exist, decisions tracked

Sample harness output:

```
GOAT Flow Setup:          PASS
  Skills:                 7/7 installed
  Config:                 valid, version 1.2.1
  InstructionFile:        118 lines

Agent Setup:              PASS
  Toolchain:              not configured (optional)
  Hooks:                  claude:deny installed, codex:deny installed, gemini:deny installed, copilot:deny installed

AI Harness Completeness:  PASS
  Context:                PASS (4/4)
  Constraints:            FAIL (3/4) - pipe-to-shell not blocked for codex
  Verification:           PASS (4/4)
  Recovery:               PASS (2/2)
  Feedback Loop:          PASS (2/2)

Result: FAIL (Constraints)
```

### Skill-template drift (`--check-drift` and multi-agent auto-run)

The `--check-drift` flag compares workflow skill templates against their installed copies and reports `content | missing | orphan | deprecated` findings. Any finding makes the drift scope fail, which fails the overall audit.

For single-agent projects the check is opt-in via the flag. For multi-agent projects (more than one agent instruction file - CLAUDE.md, AGENTS.md, GEMINI.md, or `.github/copilot-instructions.md` - present on disk) it runs automatically without the flag. Rationale: when a single-agent migration completes, the satellite agents' skill dirs (`.agents/skills/`, `.github/skills/`, etc.) are left with pre-v1.2 skill names flagged as `deprecated`. The auto-run surfaces this so `audit` doesn't exit "pass" while the satellite agents are stale. When deprecated findings are present the renderer also emits a one-line hint: `Multi-agent drift: run \`install-goat-flow.sh . --agent <agents>\` to migrate the remaining agent(s).`

---

## `goat-flow quality`

Generates a structured quality-assessment prompt for a coding agent to evaluate goat-flow quality and usefulness on the current project. This is fundamentally different from `audit` - it produces a prompt, not findings.

```bash
goat-flow quality . --agent gemini
```

The generated prompt asks the agent to:

1. **Try each of the 7 skills on real code** - `/goat` (dispatcher), `/goat-debug`, `/goat-plan`, `/goat-review`, `/goat-critique`, `/goat-security`, `/goat-qa`. Not hypothetical requests - real modules, real code, real concerns.
2. **Evaluate setup quality** - was the instruction file adapted or generic?
3. **Find contradictions** across instruction file, skill files, and `.goat-flow/` docs
4. **Identify false paths** - references to files that don't exist, stale concepts, dead modes
5. **Rate the system** - setup accuracy/relevance/completeness/friction + system usefulness/signal-to-noise/adaptability/learnability

**Time and cost expectation:** A full assessment runs 7 skill invocations (`goat-critique` alone may spawn 2-3 sub-agents). Expect 30-60 minutes and moderate token usage. For a lighter pass, the prompt can be edited to skip `goat-critique` and `goat-plan`.

The prompt includes the current `audit` summary so the agent knows what's already passing or failing. If audit is failing, the prompt explicitly asks the agent to assess the incomplete setup.

### Quality report lifecycle

`goat-flow quality` composes the prompt and instructs the agent to write its final JSON report directly to `.goat-flow/logs/quality/<YYYY-MM-DD>-<HHMM>-<agent>-<rand5>.json` - a gitignored path. No separate capture step is needed; the agent owns the write, and `history` / `diff` operate on whatever the agent saved.

```bash
goat-flow quality . --agent gemini             # Compose prompt; agent writes its own JSON report
goat-flow quality history --agent gemini       # List saved reports + same-agent score deltas
goat-flow quality diff --agent gemini          # Derive resolved / new / persisted / stuck vs the prior run
```

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
goat-flow audit .              →  "Is it installed correctly?"        →  Fix structural issues
goat-flow audit . --harness    →  "Is the harness complete?"          →  Fix failing concerns
goat-flow quality . --agent X  →  "What does an agent actually think?" →  Get fresh perspective
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
