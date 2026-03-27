# Skills

Nine focused capabilities loaded on demand. Each skill has a distinct artifact, a hard quality gate, and a repeatable output. Skills don't load unless invoked — they stay out of the instruction budget.

All skills use the `goat-` prefix to avoid conflicts with built-in agent commands.

| Skill | Purpose | Hard Gate | When to Use |
|-------|---------|-----------|-------------|
| /goat-security | Threat-model-driven security assessment | MUST rank findings by exploitability; framework-aware verification | Before releases, after dependency changes, during audits |
| /goat-debug | Diagnosis-first debugging | No fixes until human reviews diagnosis | Bug or test failure with unclear root cause |
| /goat-audit | Multi-pass quality audit | MUST NOT propose fixes; negative verification + fabrication self-check | Systematic review before releases or major changes |
| /goat-investigate | Deep codebase investigation | No planning until human reviews; includes onboarding mode | Exploring unfamiliar code, onboarding to a new project |
| /goat-review | Structured code review | MUST read all files before commenting; includes instruction review mode | Before merging or after external PR feedback |
| /goat-plan | 4-phase planning workflow | Human approval between each phase | Before non-trivial implementation |
| /goat-test | 3-phase test plan generation | Coding agent MUST NOT verify its own work (doer-verifier) | After a milestone or 30-60 min of coding |
| /goat-context | Session context reconstruction | MUST read handoff/git state before acting | After a break, context compaction, or session restart |
| /goat-refactor | Cross-file refactoring | MUST read both sides before changing; grep-after-every-rename | Renames, interface changes, restructuring across files |

> **Migration note (v0.7.0):** /goat-reflect merged into /goat-review (Instruction Review Mode). /goat-onboard merged into /goat-investigate (Onboard Mode). /goat-resume renamed to /goat-context with expanded capabilities. /goat-refactor is new.

---

## When to Use Each Skill

### /goat-security

**When:** Before releases, after dependency changes, during security audits, or when reviewing code that handles secrets, auth, or permissions.

**What it does:** Threat-model-driven security assessment. Scans against a checklist filtered by threat model (skips web categories for CLIs). Checks framework built-in mitigations before flagging findings. Ranks by exploitability with attack scenarios. Runs dependency audit.

**Hard gate:** MUST rank findings by exploitability. MUST NOT flag framework-mitigated issues. MUST run dependency audit.

**Invoke when:** You need a security review before shipping, after adding new dependencies, or when working in auth/secrets/permissions code.

### /goat-debug

**When:** A bug or test failure needs diagnosis, especially when the root cause is unclear or spans multiple components.

**What it does:** Forces diagnosis-first debugging. Hypotheses across 2+ categories → trace code paths with file:line evidence → present diagnosis with confidence level → wait for human review → only then propose a fix.

**Hard gate:** No fixes until human reviews diagnosis. "If you want to 'just try something' before tracing the code path, STOP."

**Invoke when:** A test fails and you don't know why, or a bug report comes in and the cause isn't obvious. Do NOT invoke when you already know the fix — just fix it.

### /goat-audit

**When:** Systematic codebase quality review, before major releases, or investigating a class of issues.

**What it does:** Multi-phase audit. Scan (log findings) → Verify & Self-Check (negative verification + fabrication check) → Rank & Rollup (severity ordering, pattern grouping) → Present.

**Hard gate:** MUST NOT propose fixes. MUST attempt to disprove each finding. Audit reports findings only.

**Invoke when:** You want a thorough quality check of a module, or before a major release. More thorough than a review — it's a systematic scan, not a diff-based check.

### /goat-investigate

**When:** Exploring an unfamiliar area, understanding how a system works before changing it, mapping dependencies before a refactor, or onboarding to a new project.

**What it does:** Deep codebase investigation with progressive depth reading and evidence tagging. Scope → Read in layers (entry points → critical path → supporting files) → Report with OBSERVED/INFERRED evidence tags. Includes **Onboard Mode** for new projects (stack detection + instruction drafting).

**Hard gate:** No planning or implementation until human reviews the research output.

**Invoke when:** You're about to change code you don't fully understand, need to map how data flows through a system, or are new to the project. Do NOT invoke for areas you already know well.

### /goat-plan

**When:** Before any non-trivial implementation. Planning methodology for structuring thinking before giving the agent a task.

**What it does:** 4-phase workflow: Feature brief (8 sections, one at a time) → Mob elaboration (sharp questions for the user) → Triangular tension analysis (competing approaches from SKEPTIC/ANALYST/STRATEGIST perspectives) → Milestones with exit/kill criteria.

**Hard gate:** Human approval required between phases. MUST surface kill criteria early. MUST tag low-confidence decisions as Decision Debt.

**Invoke when:** You need to plan a Standard Feature or larger. For Hotfixes, skip — just fix it.

### /goat-review

**When:** Before merging significant changes, after external PR feedback, when a second opinion is needed, or when reviewing instruction files for staleness.

**What it does:** Structured review with RFC 2119 severity levels. Reads changed files in full context (actual source code, not just the diff). Categorises findings as MUST fix / SHOULD fix / MAY improve. Checks each finding against `docs/footguns.md`. Includes **Instruction Review Mode** for auditing CLAUDE.md/AGENTS.md files for drift.

**Hard gate:** MUST read all changed files before commenting. MUST NOT apply fixes directly — review only. MUST check footguns for each finding.

**Invoke when:** You've made changes and want them checked before merging, you received external review feedback, or you want to audit instruction files for staleness.

### /goat-test

**When:** After a coding milestone or every 30-60 minutes of agent work.

**What it does:** Generates test plans across three phases. Does NOT run the tests — it produces instructions for others to run.

- **Phase 1 (Automated):** Exact commands for the coding agent to run
- **Phase 2 (AI Verification):** Self-contained prompts for a SEPARATE fresh agent session
- **Phase 3 (Human Testing):** Checklist for the developer to manually verify

**Hard gate:** The coding agent MUST NOT verify its own work (doer-verifier principle). Phase 2 uses a different agent. Phase 3 uses the human.

**Invoke when:** You've finished a chunk of work and need to verify it before moving on.

### /goat-context

**When:** Resuming work after a break, context compaction, or session restart.

**What it does:** Reads handoff notes, task files, git log, branch divergence, and actual diffs to reconstruct session context. Detects handoff drift (when handoff notes contradict recent git history). Recommends next action and suggested skill.

**Hard gate:** MUST read handoff files before git state. MUST sample actual diffs, not just list filenames. MUST flag handoff drift when detected.

**Invoke when:** You're picking up where a previous session left off. Do NOT invoke for fresh tasks with no prior context.

### /goat-refactor

**When:** Cross-file renames, interface changes, module restructuring, or any change that touches both sides of a boundary.

**What it does:** Structured refactoring with blast radius analysis. Read both sides of every interface before changing either side. Change one layer at a time. Grep after every rename to verify zero remaining references. Check doc cross-references.

**Hard gate:** MUST read both sides before changing. MUST grep-after-every-rename. MUST check doc cross-references.

**Invoke when:** You need to rename, move, or restructure code across multiple files. Do NOT invoke for single-file changes — just make them.

---

## Choosing the Right Skill

| Situation | Skill | Why not the others |
|-----------|-------|--------------------|
| "Are there security issues?" | /goat-security | Threat-model-driven scan with framework verification |
| "This test is failing, why?" | /goat-debug | Need diagnosis before fixing |
| "How healthy is this module?" | /goat-audit | Systematic scan, not a single bug |
| "How does this subsystem work?" | /goat-investigate | Understanding before changing |
| "I'm new to this project" | /goat-investigate (onboard mode) | Stack detection + orientation |
| "How should we build this feature?" | /goat-plan | Planning before implementing |
| "Are these changes safe to merge?" | /goat-review | Reviewing changes, not finding new issues |
| "Are our instruction files stale?" | /goat-review (instruction mode) | Friction signals + staleness audit |
| "How do we verify this work?" | /goat-test | Generate test plan across 3 phases |
| "Where did we leave off?" | /goat-context | Reconstruct context from handoff/git state |
| "I need to rename across files" | /goat-refactor | Both-sides-first + grep-after-rename |

## Where Skills Live

| Agent | Path |
|-------|------|
| Claude Code | `.claude/skills/goat-{name}/SKILL.md` |
| Codex | `.agents/skills/goat-{name}/SKILL.md` |
| Gemini CLI | `.agents/skills/goat-{name}/SKILL.md` |
| Copilot CLI | `.github/skills/goat-{name}/SKILL.md` |

Skills are created during Phase 1b of the GOAT Flow setup. The skill templates in `workflow/skills/` document the prompts used to create them.

---

## Why Each Skill Is Designed This Way

### /goat-security
**Problem:** Security gaps ship undetected. Dependencies have known CVEs, secrets leak into code, permission boundaries are misconfigured.
**Design:** Threat-model-driven scan with framework-aware verification. Attempt to DISPROVE each finding against the framework's built-in mitigations before reporting. Rank by exploitability with attack scenarios.

### /goat-debug
**Problem:** Agents guess fixes before understanding the bug. "Just try something" works ~30% of the time and creates confusing diffs the other 70%.
**Design:** Hard gate — hypotheses across 2+ categories, diagnosis with file:line evidence and confidence level, fixes only after human reviews.

### /goat-audit
**Problem:** Fabricated findings. LLMs are reliably bad at distinguishing real findings from plausible-sounding ones they invented.
**Design:** Scan → Verify & Self-Check (negative verification + fabrication check) → Rank & Rollup → Present. MUST NOT propose fixes.

### /goat-investigate
**Problem:** Planning without understanding the codebase. Agent proposes approaches based on assumptions that turn out wrong midway through.
**Design:** Progressive depth reading with OBSERVED/INFERRED evidence tagging. Includes Onboard Mode for new projects (stack detection + instruction drafting). Hard gate — no planning until human reviews.

### /goat-review
**Problem:** Rubber-stamp reviews. Agent says "looks good" or lists trivial style issues while missing architectural concerns.
**Design:** Structured review with RFC 2119 severity. Read actual source code, not just docs. Footgun matching on every finding. Includes Instruction Review Mode for auditing CLAUDE.md/AGENTS.md for staleness.

### /goat-plan
**Problem:** Jumping into implementation without structured planning. Features get built without clear scope, success criteria, or phased milestones.
**Design:** 4-phase workflow with human gates. Feature brief → Mob elaboration → Triangular tension (SKEPTIC/ANALYST/STRATEGIST) → Milestones with exit/kill criteria. Adapts depth to complexity tier.

### /goat-test
**Problem:** The coding agent verifies its own work and declares victory. Self-assessment is unreliable — the agent has blind spots for the same failure modes it introduced.
**Design:** Generates test plans across three phases. The coding agent produces the plan but does NOT execute verification — separate agents and the human do (doer-verifier principle).

### /goat-context
**Problem:** After context compaction or a session break, the agent starts from scratch and loses context about decisions, progress, and pending work.
**Design:** Multi-source context reconstruction (handoff notes, task files, git log, branch divergence, diff sampling). Detects handoff drift. Recommends next action and skill.

### /goat-refactor
**Problem:** Cross-file changes break when one side is updated without reading the other. Renames leave orphaned references in docs and tests.
**Design:** Both-sides-first reading. One layer at a time. Grep-after-every-rename to verify zero remaining references. Doc cross-reference check.

## Skill Justification Test

A skill earns its place if it meets ALL of:

1. **Distinct artifact** — produces something the execution loop doesn't
2. **Hard quality gate** — has pass/fail criteria, not subjective
3. **Special failure mode** — addresses a failure the loop alone misses
4. **Repeatable output** — same input produces consistent results

Skills that failed this test and were downgraded to inline instructions: `/annotation-cycle`, `/sbao-synthesis`, `/review-triage`, `/revert-rescope`.

Skills that were merged (v0.7.0): `/goat-reflect` → absorbed into `/goat-review` (Instruction Review Mode). `/goat-onboard` → absorbed into `/goat-investigate` (Onboard Mode). `/goat-resume` → renamed to `/goat-context` with expanded capabilities.
