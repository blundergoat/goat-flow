# GOAT Flow Glossary

Domain-specific terms for new contributors. Standard programming terms are excluded.

| Term | Definition | Canonical File | Aliases |
|------|-----------|----------------|---------|
| Anti-Pattern Deduction | A scored penalty (up to -15 total) applied when a project violates structural rules such as oversized instruction files or empty learning loops. | `src/cli/rubric/anti-patterns.ts` | AP1-AP23 |
| Ask First | The middle autonomy tier requiring the agent to pause and confirm with the human before touching high-risk boundaries. | `workflow/setup/execution-loop.md` | Micro-checklist |
| Autonomy Tiers | Three-level permission system (Always / Ask First / Never) controlling what the agent can do without human approval. | `workflow/setup/execution-loop.md` | -- |
| Blast Radius | The declared maximum scope of files and systems a task is allowed to touch before the agent must stop and re-scope. | `workflow/setup/execution-loop.md` | -- |
| Category Bucket | A markdown file grouping multiple related entries (lessons or footguns) by theme instead of one file per incident. | `.goat-flow/skill-conventions.md` | Bucket file |
| Ceremony | The amount of planning process required for a task, ranging from Minimal (hotfix) to Full (system change/infrastructure). | `CLAUDE.md` | -- |
| Cold Path | Documentation loaded on demand (coding standards, playbooks) rather than every session. | `workflow/setup/01-system-overview.md` | -- |
| Definition of Done | Six explicit gates that must all pass before a task is considered complete. | `workflow/setup/execution-loop.md` | DoD |
| Doer-Verifier | The principle that the agent which wrote the code must not be the one that verifies it. | `workflow/skills/goat-test.md` | -- |
| Enforcement Gradient | Three-layer enforcement stack: permissions deny (hardest) > hooks > CLAUDE.md rules (softest). | `workflow/hooks/README.md` | -- |
| Evidence Standard | The requirement that every finding must include `file:line` references and be tagged OBSERVED or INFERRED. | `workflow/skills/reference/skill-conventions.md` | -- |
| Execution Loop | The six-step agent workflow: READ, CLASSIFY, SCOPE, ACT, VERIFY, LOG. | `workflow/setup/execution-loop.md` | Default loop |
| Footgun | A documented architectural trap with `file:line` evidence stored in category bucket files under `.goat-flow/footguns/`. | `workflow/setup/05-customise-to-project.md` | Architectural landmine |
| Guide Mode | A scanner rendering mode that turns the CLI scanner into an interactive setup assistant. | `src/cli/render/guide.ts` | -- |
| Handoff | Deprecated in v1.1.0. Replaced by milestone files with ticked checkboxes as the continuity mechanism. See Task Tracking in `.goat-flow/skill-conventions.md`. | `.goat-flow/skill-conventions.md` | -- |
| Hot Path | Instruction content loaded every session (CLAUDE.md, local instruction files) with a strict line budget. | `workflow/setup/01-system-overview.md` | -- |
| Instruction Budget | The practical limit (~100-150 instructions) an agent can follow reliably; exceeding it degrades all instructions uniformly. | `.goat-flow/decisions/ADR-029-instruction-budget-constraint.md` | Line budget |
| Three Layers | The current setup model: instruction file (hot path), skills (on demand), and the `.goat-flow/` learning loop with optional local instruction files. | `workflow/setup/01-system-overview.md` | Layer model |
| Learning Loop | The feedback cycle where agent mistakes become permanent project knowledge via lesson and footgun entries. | `workflow/setup/05-customise-to-project.md` | -- |
| Lesson | A documented behavioural mistake stored in category bucket files under `.goat-flow/lessons/`. | `workflow/setup/05-customise-to-project.md` | -- |
| Mob Elaboration | A Layer 4 playbook phase where a feature brief is stress-tested from multiple perspectives before implementation. | `workflow/playbooks/planning/mob-elaboration.md` | Playbook 02 |
| Revert-and-Rescope | A three-step recovery tactic (Esc + restate, git revert + rescope, /clear + handoff) used when two corrections fail on the same approach. | `workflow/setup/execution-loop.md` | -- |
| Router Table | An index at the end of CLAUDE.md pointing to all project resources; tools listed here get 160x more agent usage. | `workflow/setup/execution-loop.md` | -- |
| SBAO | Signal-Based Adaptive Orchestration - multi-agent plan critique with semantic signals and human checkpoints. Main agent + sub-agents (2 using the core trio, 1 fresh-context control group) generate competing improvements, rank them, then the human decides what to keep/drop/decide before synthesizing a prime plan. Used in goat-plan Phase 3. | `workflow/skills/goat-plan.md` | SBAO ranking, Signal-Based Adaptive Orchestration |
| Core Trio | The three adversarial perspectives used by SBAO sub-agents: **SKEPTIC** (what could go wrong?), **ANALYST** (what does evidence say about cost/benefit?), **STRATEGIST** (what's the fastest path to shipping?). | `workflow/skills/goat-plan.md` | SKEPTIC/ANALYST/STRATEGIST, triangular tension |
| Severity Scale | The fixed priority order for findings: SECURITY > CORRECTNESS > INTEGRATION > PERFORMANCE > STYLE. | `workflow/skills/reference/skill-conventions.md` | -- |
| Skill | A slash-command-invoked capability (5 specialized: goat-security, goat-debug, goat-review, goat-plan, goat-test + 1 dispatcher: goat = 6 total) loaded on demand at Layer 3. | `docs/skills/README.md` | goat-* skills |
| Skill Justification Test | The gate requiring each skill to have at least one of: distinct artefact, hard workflow gate, special failure mode, or repeatable structured output. | `.goat-flow/decisions/ADR-030-skill-consolidation.md` | -- |
| State Declaration | The required format (`State: [MODE] \| Goal: [one line] \| Exit: [condition]`) an agent must announce before acting. | `workflow/setup/execution-loop.md` | -- |
| Stop-the-Line | A Level 2 VERIFY escalation requiring the agent to fully stop, preserve error output, and wait for human review. | `workflow/setup/execution-loop.md` | Level 2 escalation |
| Triangular Tension | A mob elaboration technique that stress-tests a plan from three competing perspectives to surface hidden risks. | `CLAUDE.md` | -- |
| Working Memory | Progress tracking via milestone file checkboxes (`.goat-flow/tasks/<version>/`). On `/compact`, session log written to `.goat-flow/logs/sessions/`. | `.goat-flow/skill-conventions.md` | Working Notes |
