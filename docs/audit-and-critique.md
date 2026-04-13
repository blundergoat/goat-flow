# Audit & Critique

goat-flow has two evaluation commands. `audit` is deterministic - it runs checks and reports findings. `critique` is inferential - it generates a prompt for an agent to evaluate quality.

## Quick reference

```bash
goat-flow audit .                              # Build correctness (pass/fail)
goat-flow audit . --quality                    # Build + advisory quality scoring
goat-flow audit . --agent claude               # Scope to one agent
goat-flow critique . --agent claude            # Generate critique prompt for Claude
```

| Command | Output | Deterministic? | Gates CI? | Requires --agent? |
|---------|--------|---------------|-----------|-------------------|
| `audit` | Pass/fail per scope | Yes | Yes - exit 1 on failure | No (checks all configured agents) |
| `audit --quality` | Grade per concern + recommendations | Yes | Never | No |
| `critique` | Prompt for an agent | No - generates a prompt | Never | Yes |

---

## `goat-flow audit`

Validates that the project's agent harness is structurally correct and optionally scores its quality.

### Build mode (default)

Binary pass/fail. This is the structural setup gate - it validates that files, config, skills, and hooks are correctly installed. It does not execute configured toolchain commands (lint, test, build). Step 06 uses `audit` as the minimum gate; preflight runs `audit` plus additional checks including ESLint, Prettier, and version consistency.

Build checks are grouped by **scope**:

**setup scope** (GOAT Flow Setup) - goat-flow-owned surfaces:
- Required files and directories from the project manifest exist
- Config parses and version is current
- All 7 canonical skills installed with matching version tags
- Instruction file exists for configured agents
- No stale skill directories (goat-audit, goat-investigate, etc.)
- No `workflow/` paths leaked into installed skill files
- Agent filter resolves to a present instruction file (`configured-agent-present` - closes vacuous-pass on `--agent` filter)
- Agent artifacts (hooks/settings) are consistent with instruction file presence (`agent-artifacts-consistent` - closes aggregate vacuous-pass)
- Preamble and conventions files present (enforced via `required-files` check)

**harness scope** (AI Harness Score) - project integration surfaces:
- Toolchain commands configured (test, lint, build)
- Agent settings/config files parse
- Hook files exist for configured agents
- Hook scripts pass syntax check (`bash -n`)
- Deny patterns registered in agent settings

**What 100% harness score means:** hooks are correctly installed and syntactically valid. It does not mean hooks are actively enforcing - hooks ship in advisory mode by default (always exit 0, never block the agent). Use `goat-flow audit . --quality` to see the verification concern score, which checks whether enforcement mode is enabled.

**Agent detection:** `audit` detects which agents are configured from the presence of instruction files (CLAUDE.md, AGENTS.md, GEMINI.md). Use `--agent claude|codex|gemini` to scope checks to a single agent.

### Quality mode (`--quality`)

Advisory scoring on top of build checks. Never blocks CI. Never affects the exit code.

Quality findings are grouped by **concern** - the five things every major harness engineering source agrees matter for agent effectiveness. See [harness-concerns.md](harness-concerns.md) for what each concern means and what goat-flow checks.

Sample quality output:

```
GOAT Flow Setup:     PASS
  Skills:            7/7 installed
  Config:            valid, version 1.1.0
  InstructionFile:   118 lines

AI Harness Score:    PASS (100%)
  Toolchain:         test + lint + build configured
  Hooks:             claude:deny installed, codex:deny installed, gemini:deny installed

Result: PASS

Quality by harness concern:

  Context (75%)
    architecture.md exists but was last updated 3 months ago
    2 dead router table paths detected
    -> Update stale file:line references in .goat-flow/footguns/

  Constraints (30%)
    PHPStan detected but not registered in toolchain.lint
    -> Register PHPStan as a constraint in config.yaml

  Verification (60%)
    Test command configured: npm test
    No testing gates found in .goat-flow/tasks/ milestone files
    -> Add testing gates to active milestone files

  Recovery (80%)
    Milestone files active, session logs current

  Feedback Loop (40%)
    2 footguns added in 4 months
    No lessons since Feb
    -> Add retrospective entries to .goat-flow/lessons/ after incidents

Overall Quality: C (57%)
```

---

## `goat-flow critique`

Generates a structured critique prompt for a coding agent to evaluate goat-flow quality and usefulness on the current project. This is fundamentally different from `audit` - it produces a prompt, not findings.

```bash
goat-flow critique . --agent claude
```

The generated prompt asks the agent to:

1. **Try each of the 7 skills on real code** - `/goat` (dispatcher), `/goat-debug`, `/goat-plan`, `/goat-review`, `/goat-sbao`, `/goat-security`, `/goat-test`. Not hypothetical requests - real modules, real code, real concerns.
2. **Evaluate setup quality** - was the instruction file adapted or generic?
3. **Find contradictions** across instruction file, skill files, and `.goat-flow/` docs
4. **Identify false paths** - references to files that don't exist, stale concepts, dead modes
5. **Rate the system** - setup accuracy/relevance/completeness/friction + system usefulness/signal-to-noise/adaptability/learnability

**Time and cost expectation:** A full critique runs 7 skill invocations (goat-sbao alone may spawn 2-3 sub-agents). Expect 30-60 minutes and moderate token usage. For a lighter pass, the prompt can be edited to skip goat-sbao and goat-plan.

The prompt includes the current `audit` summary so the agent knows what's already passing or failing. If audit is failing, the prompt explicitly asks the agent to assess the incomplete setup.

### When to use critique

- After setup is complete and audit passes - "is this actually good?"
- After significant changes - "did we break anything the auditor can't see?"
- Periodically - "has the harness drifted?"
- When onboarding - "does this make sense to a fresh agent?"

### When NOT to use critique

- As a setup gate (use `audit`)
- As a CI check (use `audit`)
- As a replacement for `audit --quality` (critique is subjective; quality scoring is deterministic)

---

## How they work together

```
goat-flow audit .              →  "Is it installed correctly?"        →  Fix structural issues
goat-flow audit . --quality    →  "Is the harness effective?"         →  Improve weak concerns
goat-flow critique . --agent X →  "What does an agent actually think?" →  Get fresh perspective
```

Typical workflow after setup:
1. Run `audit` - fix any build failures
2. Run `audit --quality` - review the 5-concern scorecard, address top recommendations
3. Run `critique` - paste into an agent session, get a subjective review
4. Feed findings back into the harness (footguns, lessons, constraints) - the feedback loop

---

## Further reading

- [The five harness concerns](harness-concerns.md) - what each concern means, what goat-flow checks for it, and the sources behind the model
