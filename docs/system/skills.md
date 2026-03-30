# Skills

Five focused capabilities (plus dispatcher) loaded on demand. Each skill has a distinct artifact, a hard quality gate, and a repeatable output. Skills don't load unless invoked - they stay out of the instruction budget.

All skills use the `goat-` prefix to avoid conflicts with built-in agent commands.

| Skill | Purpose | Hard Gate | When to Use |
|-------|---------|-----------|-------------|
| /goat-security | Threat-model-driven security assessment | MUST rank findings by exploitability; framework-aware verification | Before releases, after dependency changes, during audits |
| /goat-debug | Diagnosis-first debugging + investigate/onboard mode | No fixes until human reviews diagnosis; investigate: no planning until human reviews | Bug or test failure, exploring unfamiliar code, onboarding |
| /goat-review | Structured code review + quality audit + simplify mode | MUST read all files before commenting; simplify: MUST NOT change behavior | Before merging, quality audits, instruction staleness, readability improvement |
| /goat-plan | 4-phase planning workflow + refactor planning mode | Human approval between each phase; refactor: grep-after-every-rename | Before non-trivial implementation, cross-file renames/restructuring |
| /goat-test | 3-phase test plan generation | Coding agent MUST NOT verify its own work (doer-verifier) | After a milestone or 30-60 min of coding |

> **Consolidation (v0.8.0, finalized v0.9.3):** /goat-reflect merged into /goat-review (Instruction Review Mode). /goat-onboard merged into /goat-debug (Onboard Mode). /goat-audit merged into /goat-review (Audit Mode). /goat-context removed. /goat-investigate merged into /goat-debug (Investigate Mode). /goat-simplify merged into /goat-review (Simplify Mode). /goat-refactor merged into /goat-plan (Refactor Planning Mode). /goat dispatcher added in v0.9.0.

---

## When to Use Each Skill

### /goat-security

**When:** Before releases, after dependency changes, during security audits, or when reviewing code that handles secrets, auth, or permissions.

**What it does:** Threat-model-driven security assessment. Scans against a checklist filtered by threat model (skips web categories for CLIs). Checks framework built-in mitigations before flagging findings. Ranks by exploitability with attack scenarios. Runs dependency audit.

**Hard gate:** MUST rank findings by exploitability. MUST NOT flag framework-mitigated issues. MUST run dependency audit.

**Invoke when:** You need a security review before shipping, after adding new dependencies, or when working in auth/secrets/permissions code.

### /goat-debug

**When:** A bug or test failure needs diagnosis, especially when the root cause is unclear or spans multiple components.

**What it does:** Forces diagnosis-first debugging. Hypotheses across 2+ categories → trace code paths with file:line evidence → present diagnosis with confidence level → wait for human review → only then propose a fix. Also includes:
- **Investigate mode:** Deep codebase investigation with progressive depth reading and evidence tagging. No planning until human reviews.
- **Onboard mode:** Systematic codebase mapping for new contributors (stack detection + instruction drafting).

**Hard gate:** No fixes until human reviews diagnosis. Investigate mode: no planning until human reviews research. "If you want to 'just try something' before tracing the code path, STOP."

**Invoke when:** A test fails and you don't know why, a bug report comes in, you need to explore unfamiliar code, or you're onboarding to a new project. Do NOT invoke when you already know the fix - just fix it.

### /goat-review

**When:** Before merging changes, for systematic quality audits, or when reviewing instruction files for staleness.

**What it does:** Four modes:
- **Standard review:** Diff-based review with RFC 2119 severity levels. Reads changed files in full context. Categorises findings as MUST fix / SHOULD fix / MAY improve. Footgun matching on every finding.
- **Audit mode:** Systematic codebase quality review. Scan with weighted categories → Negative verification (attempt to disprove each finding) → Fabrication self-check → Pattern rollup. MUST NOT propose fixes in audit mode.
- **Instruction review mode:** Audits CLAUDE.md/AGENTS.md files for staleness, drift, and missing rules.
- **Simplify mode:** Code readability improvement. Naming analysis, self-documentation, comment audit, complexity reduction. MUST NOT change behavior. Prefer renaming over commenting.

**Hard gate:** MUST read all files before commenting. MUST check footguns for each finding. In audit mode: MUST attempt to disprove each finding and MUST NOT propose fixes. In simplify mode: MUST NOT change behavior.

**Invoke when:** You've made changes and want them checked, you want a thorough quality check of a module, you want to audit instruction files, or you want to improve code readability.

### /goat-plan

**When:** Before any non-trivial implementation. Planning methodology for structuring thinking before giving the agent a task.

**What it does:** 4-phase workflow: Feature brief (8 sections, one at a time) → Mob elaboration (sharp questions for the user) → Triangular tension analysis (competing approaches from SKEPTIC/ANALYST/STRATEGIST perspectives) → Milestones with exit/kill criteria. Also includes:
- **Refactor planning mode:** Cross-file refactoring with blast radius analysis. Both-sides-first reading, grep-after-every-rename, doc cross-reference checks.

**Hard gate:** Human approval required between phases. MUST surface kill criteria early. MUST tag low-confidence decisions as Decision Debt. Refactor mode: MUST read both sides before changing, MUST grep-after-every-rename.

**Invoke when:** You need to plan a Standard Feature or larger, or need to rename/restructure across multiple files. For Hotfixes, skip - just fix it.

### /goat-test

**When:** After a coding milestone or every 30-60 minutes of agent work.

**What it does:** Generates test plans across three phases. Does NOT run the tests - it produces instructions for others to run.

- **Phase 1 (Automated):** Exact commands for the coding agent to run
- **Phase 2 (AI Verification):** Self-contained prompts for a SEPARATE fresh agent session
- **Phase 3 (Human Testing):** Checklist for the developer to manually verify

**Hard gate:** The coding agent MUST NOT verify its own work (doer-verifier principle). Phase 2 uses a different agent. Phase 3 uses the human.

**Invoke when:** You've finished a chunk of work and need to verify it before moving on.

---

## Choosing the Right Skill

| Situation | Skill | Why not the others |
|-----------|-------|--------------------|
| "Are there security issues?" | /goat-security | Threat-model-driven scan with framework verification |
| "This test is failing, why?" | /goat-debug | Need diagnosis before fixing |
| "How healthy is this module?" | /goat-review (audit mode) | Systematic scan, not a single bug |
| "How does this subsystem work?" | /goat-debug (investigate mode) | Understanding before changing |
| "I'm new to this project" | /goat-debug (onboard mode) | Stack detection + orientation |
| "How should we build this feature?" | /goat-plan | Planning before implementing |
| "Are these changes safe to merge?" | /goat-review | Reviewing changes, not finding new issues |
| "Are our instruction files stale?" | /goat-review (instruction mode) | Friction signals + staleness audit |
| "How do we verify this work?" | /goat-test | Generate test plan across 3 phases |
| "I need to rename across files" | /goat-plan (refactor mode) | Both-sides-first + grep-after-rename |
| "This code is hard to follow" | /goat-review (simplify mode) | Readability without behavior change |

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
**Problem:** Agents guess fixes before understanding the bug. "Just try something" works ~30% of the time and creates confusing diffs the other 70%. Also: planning without understanding the codebase leads to wrong assumptions.
**Design:** Hard gate - hypotheses across 2+ categories, diagnosis with file:line evidence and confidence level, fixes only after human reviews. Investigate mode: progressive depth reading with OBSERVED/INFERRED evidence tagging. Onboard mode: stack detection + instruction drafting for new projects.

### /goat-review
**Problem:** Rubber-stamp reviews and fabricated audit findings. Agent says "looks good" or invents plausible-sounding issues. Also: code readability degrades without structured improvement.
**Design:** Four modes in one skill. Standard review: RFC 2119 severity, footgun matching, full-file context. Audit mode: negative verification + fabrication self-check. Instruction review mode: friction signals + staleness audit. Simplify mode: readability-focused analysis with semantics-preserving constraint, prefer renaming over commenting.

### /goat-plan
**Problem:** Jumping into implementation without structured planning. Features get built without clear scope, success criteria, or phased milestones. Also: cross-file changes break when one side is updated without reading the other.
**Design:** 4-phase workflow with human gates. Feature brief → Mob elaboration → Triangular tension (SKEPTIC/ANALYST/STRATEGIST) → Milestones with exit/kill criteria. Adapts depth to complexity tier. Refactor planning mode: both-sides-first reading, grep-after-every-rename, doc cross-reference check.

### /goat-test
**Problem:** The coding agent verifies its own work and declares victory. Self-assessment is unreliable - the agent has blind spots for the same failure modes it introduced.
**Design:** Generates test plans across three phases. The coding agent produces the plan but does NOT execute verification - separate agents and the human do (doer-verifier principle).

## Skill Justification Test

A skill earns its place if it meets ALL of:

1. **Distinct artifact** - produces something the execution loop doesn't
2. **Hard quality gate** - has pass/fail criteria, not subjective
3. **Special failure mode** - addresses a failure the loop alone misses
4. **Repeatable output** - same input produces consistent results

Skills that failed this test and were downgraded to inline instructions: `/annotation-cycle`, `/sbao-synthesis`, `/review-triage`, `/revert-rescope`.

Skills that were consolidated (v0.8.0–v0.9.3): `/goat-reflect` → `/goat-review` (Instruction Review Mode). `/goat-onboard` → `/goat-debug` (Onboard Mode). `/goat-audit` → `/goat-review` (Audit Mode). `/goat-context` removed. `/goat-investigate` → `/goat-debug` (Investigate Mode). `/goat-simplify` → `/goat-review` (Simplify Mode). `/goat-refactor` → `/goat-plan` (Refactor Planning Mode).
