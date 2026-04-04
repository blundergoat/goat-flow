# GOAT Flow Glossary

Domain-specific terms for new contributors. Standard programming terms are excluded.

| Term | Definition | Canonical File | Aliases |
|------|-----------|----------------|---------|
| Anti-Pattern Deduction | A scored penalty (up to -15 total) applied when a project violates structural rules such as oversized instruction files or empty learning loops. | `docs/system-spec.md` | AP1-AP23 |
| Ask First | The middle autonomy tier requiring the agent to pause and confirm with the human before touching high-risk boundaries. | `docs/system-spec.md` | Micro-checklist |
| Autonomy Tiers | Three-level permission system (Always / Ask First / Never) controlling what the agent can do without human approval. | `docs/system-spec.md` | -- |
| Blast Radius | The declared maximum scope of files and systems a task is allowed to touch before the agent must stop and re-scope. | `docs/system-spec.md` | -- |
| Category Bucket | A markdown file grouping multiple related entries (lessons or footguns) by theme instead of one file per incident. | `docs/system-spec.md` | Bucket file |
| Ceremony | The amount of planning process required for a task, ranging from Minimal (hotfix) to Full (system change/infrastructure). | `CLAUDE.md` | -- |
| Cold Path | Documentation loaded on demand (coding standards, playbooks) rather than every session. | `docs/system-spec.md` | -- |
| Definition of Done | Six explicit gates that must all pass before a task is considered complete. | `docs/system-spec.md` | DoD |
| Doer-Verifier | The principle that the agent which wrote the code must not be the one that verifies it. | `docs/system-spec.md` | -- |
| Enforcement Gradient | Three-layer enforcement stack: permissions deny (hardest) > hooks > CLAUDE.md rules (softest). | `docs/system-spec.md` | -- |
| Evidence Standard | The requirement that every finding must include `file:line` references and be tagged OBSERVED or INFERRED. | `workflow/skills/reference/shared-preamble.md` | -- |
| Execution Loop | The six-step agent workflow: READ, CLASSIFY, SCOPE, ACT, VERIFY, LOG. | `docs/system-spec.md` | Default loop |
| Footgun | A documented architectural trap with `file:line` evidence stored in category bucket files under `ai-docs/footguns/`. | `docs/system-spec.md` | Architectural landmine |
| Guide Mode | A scanner rendering mode that turns the CLI scanner into an interactive setup assistant. | `src/cli/render/guide.ts` | -- |
| Handoff | A structured file (`.goat-flow/tasks/handoff.md`) written when ending incomplete work so another session can resume. | `docs/system-spec.md` | -- |
| Hot Path | Instruction content loaded every session (CLAUDE.md, local instruction files) with a strict line budget. | `docs/system-spec.md` | -- |
| Instruction Budget | The practical limit (~100-150 instructions) an agent can follow reliably; exceeding it degrades all instructions uniformly. | `docs/system-spec.md` | Line budget |
| Layer 1-5 | The five-layer architecture: Runtime (always on), Local Context (auto-load), Skills (on demand), Playbooks (on demand), Evaluation (on demand). | `docs/five-layers.md` | 5-layer system |
| Learning Loop | The feedback cycle where agent mistakes become permanent project knowledge via lesson and footgun entries. | `docs/system-spec.md` | -- |
| Lesson | A documented behavioural mistake stored in category bucket files under `ai-docs/lessons/`. | `docs/system-spec.md` | -- |
| Mob Elaboration | A Layer 4 playbook phase where a feature brief is stress-tested from multiple perspectives before implementation. | `docs/system-spec.md` | Playbook 02 |
| Revert-and-Rescope | A three-step recovery tactic (Esc + restate, git revert + rescope, /clear + handoff) used when two corrections fail on the same approach. | `docs/system-spec.md` | -- |
| Router Table | An index at the end of CLAUDE.md pointing to all project resources; tools listed here get 160x more agent usage. | `docs/system-spec.md` | -- |
| SBAO | Signal-Based Adaptive Orchestration — multi-agent plan critique with semantic signals and human checkpoints. Main agent + sub-agents (2 using the core trio, 1 fresh-context control group) generate competing improvements, rank them, then the human decides what to keep/drop/decide before synthesizing a prime plan. Used in goat-plan Phase 3. | `workflow/skills/goat-plan.md` | SBAO ranking, Signal-Based Adaptive Orchestration |
| Core Trio | The three adversarial perspectives used by SBAO sub-agents: **SKEPTIC** (what could go wrong?), **ANALYST** (what does evidence say about cost/benefit?), **STRATEGIST** (what's the fastest path to shipping?). | `workflow/skills/goat-plan.md` | SKEPTIC/ANALYST/STRATEGIST, triangular tension |
| Severity Scale | The fixed priority order for findings: SECURITY > CORRECTNESS > INTEGRATION > PERFORMANCE > STYLE. | `workflow/skills/reference/shared-preamble.md` | -- |
| Skill | A slash-command-invoked capability (5 specialized: goat-security, goat-debug, goat-review, goat-plan, goat-test + 1 dispatcher: goat = 6 total) loaded on demand at Layer 3. | `docs/skills/README.md` | goat-* skills |
| Skill Justification Test | The gate requiring each skill to have at least one of: distinct artefact, hard workflow gate, special failure mode, or repeatable structured output. | `docs/system-spec.md` | -- |
| State Declaration | The required format (`State: [MODE] \| Goal: [one line] \| Exit: [condition]`) an agent must announce before acting. | `docs/system-spec.md` | -- |
| Stop-the-Line | A Level 2 VERIFY escalation requiring the agent to fully stop, preserve error output, and wait for human review. | `docs/system-spec.md` | Level 2 escalation |
| Triangular Tension | A mob elaboration technique that stress-tests a plan from three competing perspectives to surface hidden risks. | `CLAUDE.md` | -- |
| Working Memory | The escalation ladder for long tasks: scratchpad, then todo.md, then handoff file, then ask human. | `docs/system-spec.md` | Working Notes |
