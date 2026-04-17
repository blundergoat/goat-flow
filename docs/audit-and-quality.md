# Audit & Quality

goat-flow has two evaluation commands. `audit` is deterministic - it runs checks and reports findings. `quality` is inferential - it generates a prompt for an agent to evaluate quality.

## Quick reference

```bash
goat-flow audit .                              # Build correctness (pass/fail)
goat-flow audit . --harness                    # Include AI harness completeness checks
goat-flow audit . --agent claude               # Scope to one agent
goat-flow quality . --agent claude             # Generate quality-assessment prompt for Claude
```

| Command | Output | Deterministic? | Gates CI? | Requires --agent? |
|---------|--------|---------------|-----------|-------------------|
| `audit` | Pass/fail per scope | Yes | Yes - exit 1 on failure | No (checks all configured agents) |
| `audit --harness` | Pass/fail per harness concern | Yes | Yes - exit 1 on failure | No |
| `quality` | Prompt for an agent | No - generates a prompt | Never | Yes |

---

## `goat-flow audit`

Validates that the project's agent harness is structurally correct and complete. All checks are pass/fail.

### Build mode (default)

Binary pass/fail. This is the structural setup gate - it validates that files, config, skills, and hooks are correctly installed. It does not execute configured toolchain commands (lint, test, build). Step 06 uses `audit` as the minimum gate; preflight runs `audit` plus additional checks including ESLint, Prettier, and version consistency.

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
- `other-files` - Other required files from the project manifest exist (preamble, conventions, config)
- `config-parses` - `.goat-flow/config.yaml` parses and has required fields
- `config-version` - Config version matches current release

**agent scope** (Agent Setup) - 4 checks per configured agent:
- `agent-instruction` - Agent instruction file exists (CLAUDE.md, AGENTS.md, GEMINI.md)
- `agent-skills` - Agent skills installed with correct versions, no deprecated skill directories
- `agent-settings` - Agent settings/config file parses correctly
- `agent-deny-dangerous` - Deny hook file exists or deny patterns registered in agent settings

**Agent detection:** `audit` detects which agents are configured from the presence of instruction files (CLAUDE.md, AGENTS.md, GEMINI.md). Use `--agent claude|codex|gemini` to scope checks to a single agent.

### Harness mode (`--harness`)

Adds 16 pass/fail checks across the five harness concerns on top of the default build checks. These check AI harness completeness -- whether the project has the structures that make agents effective. Like all audit checks, they are deterministic and affect the exit code.

Harness checks are grouped by **concern** -- the five things every major harness engineering source agrees matter for agent effectiveness. See [harness-engineering.md](harness-engineering.md) for what each concern means and the sources behind the model.

**harness scope** (AI Harness Completeness) - 16 checks across 5 concerns:
- **Context** (3) - instruction file within line limit, execution loop present, doc paths resolve
- **Constraints** (4) - deny covers secrets, deny blocks dangerous commands, deny blocks pipe-to-shell, deny hook registered in agent settings
- **Verification** (4) - test runner configured, hooks in sync, commit guidance, post-turn hook integrity
- **Recovery** (3) - milestone tracking, session logs, compaction hook
- **Feedback Loop** (2) - feedback loop directories exist, decisions tracked

Sample harness output:

```
GOAT Flow Setup:          PASS
  Skills:                 7/7 installed
  Config:                 valid, version 1.1.0
  InstructionFile:        118 lines

Agent Setup:              PASS
  Toolchain:              test + lint + build configured
  Hooks:                  claude:deny installed, codex:deny installed, gemini:deny installed

AI Harness Completeness:  PASS
  Context:                PASS (3/3)
  Constraints:            FAIL (3/4) - pipe-to-shell not blocked for codex
  Verification:           PASS (4/4)
  Recovery:               PASS (3/3)
  Feedback Loop:          PASS (2/2)

Result: FAIL (Constraints)
```

---

## `goat-flow quality`

Generates a structured quality-assessment prompt for a coding agent to evaluate goat-flow quality and usefulness on the current project. This is fundamentally different from `audit` - it produces a prompt, not findings.

```bash
goat-flow quality . --agent claude
```

The generated prompt asks the agent to:

1. **Try each of the 7 skills on real code** - `/goat` (dispatcher), `/goat-debug`, `/goat-plan`, `/goat-review`, `/goat-critique`, `/goat-security`, `/goat-qa`. Not hypothetical requests - real modules, real code, real concerns.
2. **Evaluate setup quality** - was the instruction file adapted or generic?
3. **Find contradictions** across instruction file, skill files, and `.goat-flow/` docs
4. **Identify false paths** - references to files that don't exist, stale concepts, dead modes
5. **Rate the system** - setup accuracy/relevance/completeness/friction + system usefulness/signal-to-noise/adaptability/learnability

**Time and cost expectation:** A full assessment runs 7 skill invocations (`goat-critique` alone may spawn 2-3 sub-agents). Expect 30-60 minutes and moderate token usage. For a lighter pass, the prompt can be edited to skip `goat-critique` and `goat-plan`.

The prompt includes the current `audit` summary so the agent knows what's already passing or failing. If audit is failing, the prompt explicitly asks the agent to assess the incomplete setup.

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
3. Run `quality` - paste into an agent session, get a subjective review
4. Feed findings back into the harness (footguns, lessons, constraints) - the feedback loop

---

## Further reading

- [Harness engineering](harness-engineering.md) - what each concern means and the sources behind the model
