# Skills

Ten focused capabilities loaded on demand. Each skill has a distinct artifact, a hard quality gate, and a repeatable output. Skills don't load unless invoked — they stay out of the instruction budget.

All skills use the `goat-` prefix to avoid conflicts with built-in agent commands.

| Skill | Purpose | Hard Gate | When to Use |
|-------|---------|-----------|-------------|
| /goat-security | Security-focused review | MUST rank findings by severity scale | Before releases, after dependency changes, during audits |
| /goat-debug | Diagnosis-first debugging | No fixes until human reviews diagnosis | Bug or test failure with unclear root cause |
| /goat-audit | Multi-pass quality review | MUST NOT propose fixes; 4-pass with fabrication check | Systematic review before releases or major changes |
| /goat-investigate | Deep codebase investigation | No planning until human reviews | Exploring unfamiliar code before changing it |
| /goat-review | Structured code review | MUST read all files before commenting | Before merging or after external PR feedback |
| /goat-plan | 4-phase planning workflow | Human approval between each phase | Before non-trivial implementation |
| /goat-test | 3-track testing instructions | Coding agent MUST NOT verify its own work | After a milestone or 30-60 min of coding |
| /goat-reflect | Post-session reflection | MUST produce structured lessons entry | After a coding session or before /clear |
| /goat-onboard | Codebase onboarding | MUST read architecture + footguns before producing orientation | New contributor or agent entering the project |
| /goat-resume | Session resumption | MUST read handoff files before acting | After a break, /clear, or session restart |

---

## When to Use Each Skill

### /goat-security

**When:** Before releases, after dependency changes, during security audits, or when reviewing code that handles secrets, auth, or permissions.

**What it does:** Security-focused review. Checks dependencies for known vulnerabilities, scans for leaked secrets, reviews permission boundaries, and audits auth flows. Ranks all findings using the severity scale: SECURITY > CORRECTNESS > INTEGRATION > PERFORMANCE > STYLE.

**Hard gate:** MUST rank findings by severity scale. MUST NOT skip dependency audit.

**Invoke when:** You need a security review before shipping, after adding new dependencies, or when working in auth/secrets/permissions code.

### /goat-debug

**When:** A bug or test failure needs diagnosis, especially when the root cause is unclear or spans multiple components.

**What it does:** Forces diagnosis-first debugging. Read actual code paths → write findings with file:line evidence → wait for human review → only then propose a fix.

**Hard gate:** No fixes until human reviews diagnosis. "If you want to 'just try something' before tracing the code path, STOP."

**Invoke when:** A test fails and you don't know why, or a bug report comes in and the cause isn't obvious. Do NOT invoke when you already know the fix — just fix it.

### /goat-audit

**When:** Systematic codebase quality review, before major releases, or investigating a class of issues.

**What it does:** Four-pass audit. Discovery (scan, log everything) → Verification (re-read each finding, remove false positives) → Prioritisation (rank by severity) → Self-Check (fabrication gate: "did I fabricate this?").

**Hard gate:** MUST NOT propose fixes. Audit reports findings only — remediation comes after human reviews.

**Invoke when:** You want a thorough quality check of a module, or before a major release. More thorough than a review — it's a systematic scan, not a diff-based check.

### /goat-investigate

**When:** Exploring an unfamiliar area, understanding how a system works before changing it, or mapping dependencies before a refactor.

**What it does:** Deep codebase investigation producing a structured investigation document. Scope → Read → Document (with file:line evidence) → Stop and wait for human review.

**Hard gate:** No planning or implementation until human reviews the research output.

**Invoke when:** You're about to change code you don't fully understand, or you need to map how data flows through a system before proposing an approach. Do NOT invoke for areas you already know well.

### /goat-plan

**When:** Before any non-trivial implementation. Planning methodology for structuring thinking before giving the agent a task.

**What it does:** Wraps the planning sequence (feature brief → mob elaboration → SBAO ranking → milestones) into a workflow with human checkpoints at each stage.

**Hard gate:** Human approval required between stages.

**Invoke when:** You need to plan a Standard Feature or larger. For Hotfixes, skip — just fix it.

### /goat-review

**When:** Before merging significant changes, after external PR feedback, or when a second opinion is needed.

**What it does:** Structured review with RFC 2119 severity levels. Reads changed files in full context (actual source code, not just the diff). Categorises findings as MUST fix / SHOULD fix / MAY improve.

**Hard gate:** MUST read all changed files before commenting. MUST NOT apply fixes directly — review only.

**Invoke when:** You've made changes and want them checked before merging, or you received external review feedback and want independent investigation. Do NOT invoke for trivial changes (typos, formatting).

### /goat-test

**When:** After a coding milestone or every 30-60 minutes of agent work.

**What it does:** Generates testing instructions for three parallel verification tracks. Does NOT run the tests — it produces instructions for others to run.

- **Track 1 (Automated):** Exact commands for the agent to run (preflight, unit tests, E2E)
- **Track 2 (AI Verification):** Pre-filled prompts to paste into a SEPARATE fresh agent session for functional testing and code review
- **Track 3 (Human Testing):** Numbered checklist for the developer to manually verify (UX, visual, domain-specific)

**Hard gate:** The coding agent MUST NOT verify its own work. Track 2 uses a different agent. Track 3 uses the human.

**Invoke when:** You've finished a chunk of work and need to verify it before moving on. Based on the doer-verifier principle from `workflow/playbooks/testing/`.

### /goat-reflect

**When:** After a coding session, before `/clear`, or when explicitly asked to reflect on what happened.

**What it does:** Reviews the session's actions, decisions, and outcomes. Produces structured entries for `docs/lessons.md` (behavioural mistakes) and `docs/footguns.md` (architectural traps discovered). Identifies patterns across recent sessions.

**Hard gate:** MUST produce a structured lessons entry with evidence. MUST NOT fabricate incidents.

**Invoke when:** You've finished a session and want to capture what went well, what went wrong, and what the next agent should know. Do NOT invoke mid-task.

### /goat-onboard

**When:** A new contributor or agent enters the project for the first time, or after significant architectural changes.

**What it does:** Reads `docs/architecture.md`, `docs/footguns.md`, the router table, and project structure to produce a structured orientation document. Maps key boundaries, critical paths, and common gotchas.

**Hard gate:** MUST read architecture and footguns files before producing the orientation. MUST NOT skip Ask First boundaries.

**Invoke when:** You're new to the project or need a refresher on the system's structure. Do NOT invoke if you're already familiar with the codebase.

### /goat-resume

**When:** Resuming work after a break, `/clear`, or session restart.

**What it does:** Reads `tasks/handoff.md`, `tasks/todo.md`, and session state files to reconstruct context. Produces a summary of where work left off, what decisions were made, and what the next steps are.

**Hard gate:** MUST read handoff files before acting. MUST NOT start new work without reviewing pending state.

**Invoke when:** You're picking up where a previous session left off. Do NOT invoke for fresh tasks with no prior context.

---

## Choosing the Right Skill

| Situation | Skill | Why not the others |
|-----------|-------|--------------------|
| "Are there security issues?" | /goat-security | Security review, dependency audit |
| "This test is failing, why?" | /goat-debug | Need diagnosis before fixing |
| "How healthy is this module?" | /goat-audit | Systematic scan, not a single bug |
| "How does this subsystem work?" | /goat-investigate | Understanding before changing |
| "How should we build this feature?" | /goat-plan | Planning before implementing |
| "Are these changes safe to merge?" | /goat-review | Reviewing changes, not finding new issues |
| "How do we verify this work?" | /goat-test | Generate testing instructions for 3 tracks |
| "What did we learn this session?" | /goat-reflect | Structured lessons from session actions |
| "I'm new to this project" | /goat-onboard | Orientation before contributing |
| "Where did we leave off?" | /goat-resume | Reconstruct context from handoff state |

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
**Design:** Security-focused review with severity scale ranking. MUST audit dependencies and scan for secrets.

### /goat-debug
**Problem:** Agents guess fixes before understanding the bug. "Just try something" works ~30% of the time and creates confusing diffs the other 70%.
**Design:** Hard gate — diagnosis with file:line evidence first, fixes only after human reviews.

### /goat-audit
**Problem:** Fabricated findings. LLMs are reliably bad at distinguishing real findings from plausible-sounding ones they invented.
**Design:** Four-pass structure with explicit fabrication gate at pass 4. MUST NOT propose fixes.

### /goat-investigate
**Problem:** Planning without understanding the codebase. Agent proposes approaches based on assumptions that turn out wrong midway through.
**Design:** Hard gate — produce investigation with file:line evidence. No planning until human reviews.

### /goat-review
**Problem:** Rubber-stamp reviews. Agent says "looks good" or lists trivial style issues while missing architectural concerns.
**Design:** Structured review with RFC 2119 severity. Read actual source code, not just docs. Find real bugs with file:line evidence.

### /goat-plan
**Problem:** Jumping into implementation without structured planning. Features get built without clear scope, success criteria, or phased milestones.
**Design:** 4-phase workflow with human gates. Adapts depth to complexity tier — skip SBAO for Standard, compress to single brief for Hotfix.

### /goat-test
**Problem:** The coding agent verifies its own work and declares victory. Self-assessment is unreliable — the agent has blind spots for the same failure modes it introduced.
**Design:** Generates instructions for three independent verification tracks. The coding agent produces the test plan but does NOT execute verification — separate agents and the human do.

### /goat-reflect
**Problem:** Lessons from coding sessions evaporate when the session ends. Mistakes repeat because no one captures what happened.
**Design:** Structured reflection producing entries for the learning loop files. Forces evidence-based entries, not vague summaries.

### /goat-onboard
**Problem:** New agents or contributors waste their first session reading the wrong files or missing critical boundaries.
**Design:** Reads architecture, footguns, and router table to produce an orientation document. Surfaces Ask First boundaries and high-risk areas early.

### /goat-resume
**Problem:** After /clear or a session break, the agent starts from scratch and loses context about decisions, progress, and pending work.
**Design:** Reads handoff and todo files to reconstruct state before acting. Prevents duplicate work and forgotten decisions.

## Skill Justification Test

A skill earns its place if it meets ALL of:

1. **Distinct artifact** — produces something the execution loop doesn't
2. **Hard quality gate** — has pass/fail criteria, not subjective
3. **Special failure mode** — addresses a failure the loop alone misses
4. **Repeatable output** — same input produces consistent results

Skills that failed this test and were downgraded to inline instructions: `/annotation-cycle`, `/sbao-synthesis`, `/review-triage`, `/revert-rescope`.
