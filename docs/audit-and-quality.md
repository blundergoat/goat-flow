# Audit & Quality

goat-flow has two evaluation commands. `audit` is deterministic - it runs checks and reports findings. `quality` is inferential - it generates a prompt for an agent to evaluate quality.

## Quick reference

```bash
npx @blundergoat/goat-flow@latest audit .                              # Build correctness (pass/fail)
npx @blundergoat/goat-flow@latest audit . --harness                    # Include AI harness completeness checks
npx @blundergoat/goat-flow@latest audit . --agent claude               # Scope to one agent
npx @blundergoat/goat-flow@latest audit . --format sarif               # Export audit findings as SARIF 2.1.0
npx @blundergoat/goat-flow@latest quality . --agent antigravity             # Generate quality-assessment prompt for one agent
npx @blundergoat/goat-flow@latest quality history --agent antigravity       # Review saved trend history
npx @blundergoat/goat-flow@latest quality diff --agent antigravity          # Compare the latest two saved runs
```

| Command | Output | Deterministic? | Gates CI? | Requires --agent? |
|---------|--------|---------------|-----------|-------------------|
| `audit` | Pass/fail per scope | Yes | Yes - exit 1 on failure | No (checks all supported agents) |
| `audit --harness` | Pass/fail per harness concern | Yes | Yes - exit 1 on failure | No |
| `quality` | Prompt for an agent | No - generates a prompt | Never | Yes |

---

## `goat-flow audit`

Validates that the project's agent harness is structurally correct and complete. All checks are pass/fail. Audit output also includes an advisory per-agent enforcement matrix so users can distinguish structural setup pass/fail from what local facts actually prove about command blocking, secret-path coverage, hook registration, and unknown broader file read/write enforcement.

For the full deterministic inventory, including every check id and what it validates, see [Deterministic audit checks](audit-checks.md).

### Build mode (default)

Binary pass/fail. This is the structural setup gate - it validates that required files/directories exist, config parses, skills are installed at the expected paths, and hooks are registered. It does not execute configured toolchain commands (lint, test, build). Step 06 uses `audit` as the minimum gate; preflight runs `audit` plus additional checks including ESLint, Prettier, version consistency, instruction file line counts (warn at `line_target`, fail at `line_limit`), Router Table path parity across agents, encyclopedia-content guards, and downstream-content guards.

Build checks use two scopes:

| Scope | Registered checks | What it validates |
|---|---:|---|
| GOAT Flow Setup | 16 | Shared directories, generated project docs, config, local-state anchors, and hook versions |
| Agent Setup | 4 | Instruction file, canonical skills, settings, and the selected agent's deny mechanism |

Aggregate audit always runs the 16 setup checks and reports all four agent check IDs. Without `--agent <id>`, only `agent-instruction` actively fails; the other three need a selected runtime for meaningful evidence. The [deterministic check inventory](audit-checks.md) owns every stable ID and its exact semantics.

### Enforcement matrix

`audit` JSON and text output includes an advisory `enforcement` matrix per audited agent. It uses the status values `hard`, `limited`, `soft`, `missing`, and `unknown` with evidence sources such as `local-hook`, `local-settings`, `runtime-self-test`, `manifest`, or `not-observed`.

This matrix is a readout, not a gate. It does not change audit pass/fail status. It also does not infer broad filesystem restrictions from narrower evidence: secret-path read coverage, deny-hook installation, or a passing setup check do not by themselves prove general file read/write enforcement.

### SARIF export (`--format sarif`)

`audit --format sarif` renders the existing audit report as SARIF 2.1.0 for CI systems and SARIF-aware code-scanning integrations. The export does not change audit pass/fail semantics: CLI exit code still follows `report.status`, and SARIF results are derived from deterministic goat-flow findings rather than source-code vulnerability analysis.

The renderer registers every rule from the active audit surface in `tool.driver.rules`, then emits results for failing setup, agent, and harness checks. `impact: "scope-fail"` maps to SARIF `error`; `impact: "score-only"` maps to `warning`; informational content findings map to `note`. Acknowledged advisory failures remain visible as SARIF results with `suppressions[]` so downstream consumers can distinguish acknowledged findings from absent findings.

When `--check-drift` or `--check-content` is enabled, drift and content findings are included as SARIF rules/results with file locations where the finding already carries a repo-relative path. Checks without target-file evidence are still emitted as valid SARIF results, but no fake location is invented; GitHub code scanning only creates file annotations for results that include `locations[]`.

### Harness mode (`--harness`)

Adds 18 checks across the five harness concerns on top of the default build checks. Harness checks are deterministic but classified as **integrity** (installation drift), **advisory** (acknowledgeable practice), or **metric** (score-only maturity signal). JSON includes the status, impact, assurance, and framework-versus-target provenance needed to distinguish hard failures from limited or score-only evidence.

Harness checks are grouped by **concern** -- the five things that matter for agent effectiveness. See [harness-engineering.md](harness-engineering.md) for what each concern means and the sources behind the model.

| Concern | Checks | Structural question |
|---|---:|---|
| Context | 5 | Do instructions, required sections, and referenced paths exist within the configured limits? |
| Constraints | 5 | Do installed deny layers cover the registered dangerous and secret-path patterns? |
| Verification | 4 | Are hook registration, commit guidance, evidence rules, and applicable post-turn signals wired? |
| Recovery | 2 | Do milestone and session-log storage surfaces exist? |
| Feedback Loop | 2 | Do learning-loop and decision surfaces exist? |

Sample harness output:

```
GOAT Flow Setup:          PASS
  Skills:                 7/7 installed
  Config:                 valid, version 1.15.1
  InstructionFile:        118 lines

Agent Setup:              PASS
  Toolchain:              not configured (optional)
  Hooks:                  claude:deny installed, codex:deny installed, antigravity:deny installed, copilot:deny installed

AI Harness Completeness:  PASS
  Context:                PASS (5/5)
  Constraints:            FAIL (4/5) - pipe-to-shell not blocked for codex
  Verification:           PASS (4/4)
  Recovery:               PASS (2/2)
  Feedback Loop:          PASS (2/2)

Result: FAIL (Constraints)
```

### Skill-template drift (`--check-drift` and multi-agent auto-run)

The `--check-drift` flag compares workflow skill templates against their installed copies and reports `content | missing | orphan | deprecated` findings. Any finding makes the drift scope fail, which fails the overall audit.

For single-agent projects the check is opt-in via the flag. For multi-agent projects (more than one agent instruction file - CLAUDE.md, AGENTS.md, or `.github/copilot-instructions.md` - present on disk) it runs automatically without the flag. Rationale: when a single-agent migration completes, the satellite agents' skill dirs (`.agents/skills/`, `.github/skills/`, etc.) are left with pre-v1.2 skill names flagged as `deprecated`. The auto-run surfaces this so `audit` doesn't exit "pass" while the satellite agents are stale. When deprecated findings are present the renderer also emits a one-line hint to run `goat-flow install . --agent <agent>` for each stale agent.

---

## `goat-flow quality`

Generates a structured quality-assessment prompt for a coding agent to evaluate goat-flow quality and usefulness on the current project. Unlike `audit`, it produces a prompt rather than deterministic findings.

```bash
npx @blundergoat/goat-flow@latest quality . --agent antigravity
```

The generated prompt asks the agent to:

1. **Assess each of the 7 skills** - `/goat` (dispatcher), `/goat-debug`, `/goat-plan`, `/goat-review`, `/goat-critique`, `/goat-security`, `/goat-qa`. Preferred method is file analysis (read each SKILL.md and evaluate structure, constraints, and coherence against the codebase); live invocation on real code when context budget allows.
2. **Evaluate setup quality** - was the instruction file adapted or generic?
3. **Find contradictions** across instruction file, skill files, and `.goat-flow/` docs
4. **Identify false paths** - references to files that don't exist, stale concepts, dead modes
5. **Rate the system** - setup accuracy/relevance/completeness/friction + system usefulness/signal-to-noise/adaptability/learnability

**Time and cost expectation:** A full assessment evaluates all 7 skills (file analysis by default; live invocation when context allows - `goat-critique` alone spawns 3 sub-agents if invoked). Expect 15-60 minutes depending on depth, with moderate token usage. If context is limited, the generated prompt requires at minimum testing `/goat` (routing), `/goat-review` (most common use), and `/goat-critique` (highest-cost skill).

The prompt includes the current `audit` summary so the agent knows what's
already passing or failing. If audit is failing, the prompt explicitly asks the
agent to assess the incomplete setup. In the dashboard, passive Quality page
loads may reuse cached audit enrichment for speed; explicit Regenerate and the
CLI `quality` command request fresh audit context before composing the prompt.

### Quality report lifecycle

The CLI prompt keeps the completed JSON report in memory and passes it to the exact-version `quality save` command. That bounded saver redacts accepted strings, validates the report, chooses a collision-safe filename, and writes only the final JSON under the selected project's gitignored `.goat-flow/logs/quality/` directory.

Dashboard-launched enforced Claude sessions use a separate staging contract because their reporting profile cannot run the shell saver. The session writes one staged draft; the dashboard claims, validates, redacts, persists, and removes it. Both paths feed the same `history` and `diff` commands.

```bash
npx @blundergoat/goat-flow@latest quality . --agent antigravity             # Default: Agent Installation mode
npx @blundergoat/goat-flow@latest quality . --agent claude --mode process   # GOAT Flow Process mode
npx @blundergoat/goat-flow@latest quality . --agent claude --mode harness   # Harness Engineering mode
npx @blundergoat/goat-flow@latest quality . --agent claude --mode skills    # Skills mode
npx @blundergoat/goat-flow@latest quality history --agent antigravity            # List saved reports + same-agent score deltas
npx @blundergoat/goat-flow@latest quality history --mode process            # Filter history to one quality mode
npx @blundergoat/goat-flow@latest quality diff --agent antigravity               # Derive resolved / new / persisted / stuck vs prior run
npx @blundergoat/goat-flow@latest quality diff --mode skills                # Compare within one mode only
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

- `quality` composes a structured prompt with a bounded persistence contract. Positional finding IDs are computed at load time by `history` / `diff`.
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
npx @blundergoat/goat-flow@latest audit .              →  "Is it installed correctly?"        →  Fix structural issues
npx @blundergoat/goat-flow@latest audit . --harness    →  "Is the harness complete?"          →  Fix failing concerns
npx @blundergoat/goat-flow@latest quality . --agent X  →  "What does an agent actually think?" →  Get fresh perspective
```

Typical workflow after setup:
1. Run `audit` - fix any build failures
2. Run `audit --harness` - fix any failing harness completeness checks
3. Run `quality` - send the prompt to an agent; the prompt's bounded saver or dashboard staging contract persists the accepted JSON report
4. Run `quality history` / `quality diff` - compare trend lines and finding lifecycles across same-agent runs
5. Feed durable findings back into the harness (footguns, lessons, decisions) - the feedback loop

---

## Further reading

- [Harness engineering](harness-engineering.md) - what each concern means and the sources behind the model
