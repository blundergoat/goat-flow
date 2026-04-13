# The Five Harness Concerns

The harness engineering field is roughly 5 months old. There is no adopted industry-standard framework yet. But across 7 major sources - from Mitchell Hashimoto's original coining to Anthropic's managed agents architecture - there is consensus on 5 concerns that every effective agent harness must address.

goat-flow's quality audit (`goat-flow audit . --harness`) evaluates each concern and scores it independently.

---

## 1. Context

**Question:** Is the agent's context accurate, lean, and useful?

The agent can only work with what it sees. Stale architecture docs, dead router table paths, generic instruction files, and bloated context surfaces all degrade performance. The quality audit checks whether context surfaces are current, specific to this project, and referencing real files.

**What goat-flow checks:**
- Instruction file line count vs configured target and hard limit (all configured agents)
- Execution loop present - instruction file contains READ, SCOPE, ACT, VERIFY steps
- Router table paths all resolve to real files
- Footgun entries cite file:line evidence where cited files still exist
- Architecture doc exists and has substantive content (10+ lines)
- Architecture file paths resolve - backtick-quoted paths in architecture.md point to real files

**Sources:**
- Every source agrees context quality matters
- OpenAI: "Give Codex a map, not a 1,000-page instruction manual"
- ETH Zurich study: LLM-generated agentfiles hurt performance; concise, human-written ones help
- Anthropic: progress file pattern for structured context handoff

---

## 2. Constraints

**Question:** Do deterministic rules catch failures before the LLM runs?

Constraints are the cheapest, most reliable layer of the harness. They cost zero tokens, produce zero false positives when well-designed, and prevent entire failure categories without any LLM involvement. Most teams skip this layer entirely.

**What goat-flow checks:**
- Deny patterns cover secret file reads (per agent)
- Deny patterns block rm -rf, force-push, chmod 777 (per agent)
- Ask First boundaries configured (count > 0)
- Linter registration - cross-references static analysis tools detected in package manifests against toolchain.lint config
- Deny blocks pipe-to-shell - `curl | bash` pattern blocked (per agent)

**Sources:**
- OpenAI Codex team: custom linters with error messages that include remediation instructions
- Birgitta Böckeler: computational feedforward controls - deterministic rules that steer the agent before it acts
- Han Heloir Yan (5-layer model): L1 Constraint as the skeleton - "the highest marginal return on a managed platform"

---

## 3. Verification

**Question:** Can the agent verify its own work, and is verification honest?

Verification loops are consistently reported as the single highest-impact harness pattern. An agent that can check its own output - run tests, validate schemas, lint code - before presenting results catches silent failures that otherwise compound through multi-step execution.

**What goat-flow checks:**
- Test command configured in config.yaml toolchain
- Hook registrations and hook files are in sync (no orphans, no stale registrations)
- Commit guidance exists in instruction file or project docs
- Hook has validation - post-turn hook runs actual validation (lint, typecheck, shellcheck), not just `exit 0`
- Hook honest failures - post-turn hook does not swallow failures with `|| true` (silent on success, loud on failure)
- Lint command configured in config.yaml toolchain

**Sources:**
- Mitchell Hashimoto: "anytime you find an agent makes a mistake, you take the time to engineer a solution such that the agent never makes that mistake again"
- OpenAI: structural tests and pre-commit hooks on every code generation output
- HumanLayer: back-pressure mechanisms - "your likelihood of success is strongly correlated with the agent's ability to verify its own work"
- Birgitta Böckeler: feedback sensors - computational and inferential checks that observe after the agent acts

---

## 4. Recovery

**Question:** Can the agent resume after crash, compaction, or interruption?

Agents that run for minutes or hours need durable state. If the harness crashes mid-task, can the agent resume from where it left off, or does it restart from scratch? Without recovery mechanisms, long-running tasks become fragile and expensive.

**What goat-flow checks:**
- Milestone/task files exist in .goat-flow/tasks/ (count > 0)
- Session logs exist in .goat-flow/logs/sessions/ (count > 0)
- Compaction hook registered - re-injects current task context after window compression (per agent)
- Milestone files have checkboxes - task files contain `- [ ]` / `- [x]` items for trackable progress

**Sources:**
- Anthropic: session durability and checkpoint-resume with external event log
- harness-engineering.ai (Dr. Sarah Chen): lifecycle management - startup, health monitoring, crash recovery
- LangChain: LoopDetectionMiddleware for detecting doom loops

---

## 5. Feedback Loop

**Question:** Is the harness getting smarter from failures over time?

A harness that never learns is a harness that keeps making the same mistakes. The feedback loop is the mechanism that turns individual failures into permanent improvements - a footgun entry that leads to a new constraint, a lesson that changes the instruction file.

**What goat-flow checks:**
- Footgun entry count (3+ entries for full score)
- Lesson entry count (3+ entries for full score)
- Decision records exist (1+ files for full score)
- Feedback recency - parses `**Created:**` dates from footgun/lesson entries, flags if none are within last 90 days

**Sources:**
- Mitchell Hashimoto: the core principle - "never make that mistake again"
- OpenAI: "garbage collection" agents that scan for stale patterns and drift
- Birgitta Böckeler: the steering loop - iterating on the harness whenever issues recur

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
