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

Binary pass/fail. This is the setup gate - Step 06, preflight, and CI all use `audit`.

Build checks are grouped by **scope** (who owns the fix):

**setup scope** - goat-flow-owned surfaces:
- Required files and directories from the project manifest exist
- Config parses and version is current
- All 7 canonical skills installed with matching version tags
- Instruction file exists for configured agents
- No stale skill directories (goat-audit, goat-investigate, etc.)
- No `workflow/` paths leaked into installed skill files
- Preamble and conventions files installed

**project scope** - project-owned surfaces:
- Toolchain commands configured (test, lint, build)
- Agent settings/config files parse

**integration scope** - wiring between goat-flow and project:
- Hook files exist for configured agents
- Hook scripts pass syntax check (`bash -n`)
- Deny patterns registered in agent settings

**Agent detection:** `audit` determines which agents are configured from `.goat-flow/config.yaml`'s `agents` list. If no config exists, it detects agents from the presence of instruction files (CLAUDE.md, AGENTS.md, GEMINI.md) and skill directories (`.claude/skills/`, `.agents/skills/`, `.github/skills/`).

### Quality mode (`--quality`)

Advisory scoring on top of build checks. Never blocks CI. Never affects the exit code.

Quality findings are grouped by **concern** - the five things every major harness engineering source agrees matter for agent effectiveness.

Sample quality output:

```
Build: PASS

Quality by harness concern:

| Concern | Score | Key Finding |
|---------|-------|-------------|
| Context | 75% | architecture.md 3 months stale, 2 dead router table paths |
| Constraints | 30% | PHPStan installed but not registered as a constraint |
| Verification | 60% | Tests exist but no testing gates in milestone files |
| Recovery | 80% | Milestone files active, session logs current |
| Feedback Loop | 40% | 2 footguns in 4 months, no lessons since Feb |

Overall Quality: C (57%)

Top recommendation: Register PHPStan as a constraint in config.yaml
```

---

## The five harness concerns

The harness engineering field is roughly 5 months old. There is no adopted industry-standard framework yet. But across 7 major sources - from Mitchell Hashimoto's original coining to Anthropic's managed agents architecture - there is consensus on 5 concerns that every effective agent harness must address.

goat-flow's quality audit evaluates each concern and scores it independently.

### 1. Context

**Question:** Is the agent's context accurate, lean, and useful?

The agent can only work with what it sees. Stale architecture docs, dead router table paths, generic instruction files, and bloated context surfaces all degrade performance. The quality audit checks whether context surfaces are current, specific to this project, and referencing real files.

**What goat-flow checks:**
- Instruction file line count vs target (120) and hard limit (150)
- Instruction file uses real project paths, not generic template fill
- BAD/GOOD examples reference real project patterns
- Architecture doc matches actual codebase structure
- Router table paths all resolve to real files
- Footgun entries cite file:line evidence that still resolves
- Lesson entries reference real incidents, not hypotheticals

**Sources:**
- Every source agrees context quality matters
- OpenAI: "Give Codex a map, not a 1,000-page instruction manual"
- ETH Zurich study: LLM-generated agentfiles hurt performance; concise, human-written ones help
- Anthropic: progress file pattern for structured context handoff

### 2. Constraints

**Question:** Do deterministic rules catch failures before the LLM runs?

Constraints are the cheapest, most reliable layer of the harness. They cost zero tokens, produce zero false positives when well-designed, and prevent entire failure categories without any LLM involvement. Most teams skip this layer entirely.

**What goat-flow checks:**
- Ask First boundaries reference specific project risk areas (not generic boilerplate)
- Deny patterns cover secrets and dangerous commands
- Config has registered project-specific constraints (if the constraint framework is adopted)
- **Detect unregistered linters from package manifests** - e.g. eslint in package.json, PHPStan in composer.json, or tsc in tsconfig.json but not registered as constraints. This is often the single most actionable finding: deterministic verification the project already has but isn't using.
- No duplicate canonical surfaces creating split-brain guidance

**Sources:**
- OpenAI Codex team: custom linters with error messages that include remediation instructions
- Birgitta Böckeler: computational feedforward controls - deterministic rules that steer the agent before it acts
- Han Heloir Yan (5-layer model): L1 Constraint as the skeleton - "the highest marginal return on a managed platform"

### 3. Verification

**Question:** Can the agent verify its own work, and is verification honest?

Verification loops are consistently reported as the single highest-impact harness pattern. An agent that can check its own output - run tests, validate schemas, lint code - before presenting results catches silent failures that otherwise compound through multi-step execution.

**What goat-flow checks:**
- Test command configured and runnable
- Testing gates defined in milestone files
- Commit and review guidance exists
- Hooks registered AND present (no orphans, no stale registrations)
- Verification hooks follow the "silent on success, loud on failure" pattern

**Sources:**
- Mitchell Hashimoto: "anytime you find an agent makes a mistake, you take the time to engineer a solution such that the agent never makes that mistake again"
- OpenAI: structural tests and pre-commit hooks on every code generation output
- HumanLayer: back-pressure mechanisms - "your likelihood of success is strongly correlated with the agent's ability to verify its own work"
- Birgitta Böckeler: feedback sensors - computational and inferential checks that observe after the agent acts

### 4. Recovery

**Question:** Can the agent resume after crash, compaction, or interruption?

Agents that run for minutes or hours need durable state. If the harness crashes mid-task, can the agent resume from where it left off, or does it restart from scratch? Without recovery mechanisms, long-running tasks become fragile and expensive.

**What goat-flow checks:**
- Milestone files exist and have recent checkbox activity (checked via git history)
- Session logs exist and are recent
- Handoff mechanism present for session continuity
- Loop detection guidance present in execution loop (edit-same-file threshold prevents doom loops)

**Sources:**
- Anthropic: session durability and checkpoint-resume with external event log
- harness-engineering.ai (Dr. Sarah Chen): lifecycle management - startup, health monitoring, crash recovery
- LangChain: LoopDetectionMiddleware for detecting doom loops

### 5. Feedback Loop

**Question:** Is the harness getting smarter from failures over time?

A harness that never learns is a harness that keeps making the same mistakes. The feedback loop is the mechanism that turns individual failures into permanent improvements - a footgun entry that leads to a new constraint, a lesson that changes the instruction file.

**What goat-flow checks:**
- Footgun entry count and recency relative to project age - a 6-month project with zero entries means the loop isn't running
- Lesson entry count and recency
- Footgun entries have corresponding Ask First boundaries or constraint registrations (checkable proxy for "loop closure")
- Patterns documented and current

**Sources:**
- Mitchell Hashimoto: the core principle - "never make that mistake again"
- OpenAI: "garbage collection" agents that scan for stale patterns and drift
- Birgitta Böckeler: the steering loop - iterating on the harness whenever issues recur

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
- After significant changes - "did we break anything the scanner can't see?"
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

The harness engineering field is emerging. These are the primary sources behind the 5-concern model:

- Mitchell Hashimoto, "My AI Adoption Journey" (Feb 2026) - coined "harness engineering," established the core principle
- OpenAI, "Harness engineering: leveraging Codex in an agent-first world" (Feb 2026) - most detailed case study of building a fully agent-generated product
- Birgitta Böckeler, "Harness Engineering" on martinfowler.com (Apr 2026) - feedforward/feedback taxonomy, harnessability concept
- Vivek Trivedy, "The Anatomy of an Agent Harness" on LangChain Blog (Mar 2026) - derived harness components from what models can't do natively
- Kyle, "Skill Issue: Harness Engineering for Coding Agents" on HumanLayer Blog (Mar 2026) - most practical configuration guide
- Dr. Sarah Chen, "The Complete Guide to Agent Harness" on harness-engineering.ai (Mar 2026) - six core components overview
- Anthropic Engineering, "Scaling Managed Agents" (Apr 2026) - brain/hands decoupling, session durability
- Han Heloir Yan, "Anthropic Just Shipped Three of the Five Harness Layers" (Apr 2026) - 5-layer stack synthesis
