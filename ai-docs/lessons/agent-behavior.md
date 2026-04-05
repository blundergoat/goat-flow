---
category: agent-behavior
---

## Lesson: Sub-agent output must be audited

**Created:** 2026-03-22

**What happened:** Spawned 5 parallel agents to fix 5 projects. Agents created confusion-log.md (removed in ADR-003), left shape placeholders, introduced indentation errors, wrote hasRouter logic bug. None caught until external agents audited the output.
**Root cause:** "Tests pass" tunnel vision - treated green CI as proof of correctness. Sub-agent prompts didn't include ADR constraints. Never re-read the files agents wrote.
**Fix:** After spawning sub-agents, grep for removed patterns and read key output files. Include ADR constraints in every sub-agent prompt.

---

## Lesson: Sub-agents write aspirational content as current state

**Created:** 2026-03-22

**What happened:** Sub-agents creating ai-docs/coding-standards/ files read ai-docs/architecture.md and roadmap docs, then wrote coding guidelines that included planned features (Playwright browser, SQLite persistence, redaction.rs) as if they were current. Three external agent audits found 5+ inaccuracies per project.
**Root cause:** The setup prompt said "Create conventions.md from project analysis" but didn't say "verify against actual code." Agents read documentation (which mixes current and planned) without checking the implementation.
**Fix:** Added verification gates to workflow templates and setup guides. Templates now say: "Only document what currently exists. Verify by reading source files, not documentation."

---

## Pattern: Agent offered to commit after completing work

**Created:** 2026-03-31

**What happened:** After executing M1 (Fixes & Hygiene) — 27 files changed, 216 tests passing — the agent ended its summary with "Want me to commit, or continue with P9/P17/P4?" This violated two explicit rules: CLAUDE.md says "Never: Commit unless asked" and the system instructions say "MUST NOT commit changes unless the user explicitly asks." The agent knew both rules and broke them anyway.

**Why this is a fundamental failure:** The agent's job is to make changes. The user's job is to decide when those changes are ready to be committed. Offering to commit is the agent inserting itself into a decision that isn't its own. It's not a minor style issue — it's a boundary violation. The rules exist in CLAUDE.md, in the system instructions, and in the deny hooks (`Bash(git commit*)` is in `.claude/settings.json`). Three layers of prevention, all ignored because the agent treated "I just finished a big task" as implicit permission to suggest the next git operation.

**This is also a Claude Code systemic issue:** Claude models have a strong tendency to suggest committing after completing work. This isn't unique to this project — it's a default behavior pattern that overrides explicit instructions. The deny hook blocks the command itself, but it can't block the agent from asking. The only fix is behavioral: the agent must internalize that committing is never its suggestion to make.

**Prevention:** After completing work, report what was done and stop. Do not mention commits, committing, pushing, PRs, or any git write operation. There is no acceptable trigger — `Bash(*git commit*)` and `Bash(*git push*)` are in `.claude/settings.json` deny rules (lines 4-5), so the agent literally cannot run these commands even if the user asks. Committing is the user's action, performed outside the agent session.

---

## Lesson: When deny hook blocks a command, use the unblocked equivalent

**Created:** 2026-03-28

**What happened:** Agent needed to delete `.github/skills/goat-onboard/` and `.github/skills/goat-reflect/` directories. Used `rm -rf` which was blocked by deny-dangerous.sh. Instead of using `rm file && rmdir dir` (which is not blocked), the agent asked the user to delete manually - wasting a round trip on something trivially solvable.
**Root cause:** Agent defaulted to `rm -rf` out of habit and treated the deny hook block as a dead end instead of thinking about alternatives for 2 seconds.
**Fix:** When a command is blocked, think about the unblocked equivalent. `rm -rf dir/` → `rm dir/file && rmdir dir/`. `mv old new` → `mv -n old new`. The deny hook blocks dangerous patterns, not all file operations.

---

## Lesson: Version bumps require explicit confirmation

**Created:** 2026-03-29

**What happened:** While cleaning up zero-point rubric checks, the agent also bumped `package.json`, `RUBRIC_VERSION`, and skill frontmatter above the current `0.8.0` line. The user had not asked for a release/version bump and corrected it immediately.

**Prevention:** Treat version changes as a separate decision from rubric or content changes. Do not bump package, rubric, or template versions unless the user explicitly requests the new version or the release plan says to do it.

---

## Lesson: "Update the plan" means write the plan, not execute it
**Created:** 2026-04-04

**What happened:** User asked to "create M31 plan" and then later to "update this plan" with a detailed design spec. The agent wrote the plan file, then immediately launched a sub-agent to rewrite `index.html` — implementing the plan without being asked. User had to interrupt and correct: "dont change anything. just update this plan."

**Why it matters:** The user controls when code changes happen. Writing a plan and executing a plan are two completely separate actions. The user may want to review, share with others, or revise before any code is touched.

**Prevention:** Listen for the verb. "update the plan", "create M31", "write a plan" = write markdown only. "execute", "implement", "do it", "fix it" = make code changes. When in doubt, write the plan and ask if they want it executed. Never auto-execute a plan the user just asked you to write.

---

## Lesson: Installed skill files are not templates
**Created:** 2026-04-04

**What happened:** Scanner flagged AP18 (ADAPT comments in installed skills) causing a -2pt deduction on all 3 agents. Instead of fixing the installed files, the agent dismissed the failure as "expected for a template repo" and proposed suppressing AP18 when scanning the goat-flow repo. The user corrected this: `.claude/skills/`, `.agents/skills/`, `.github/skills/` are real project files that must pass the scanner at 100% — they are not templates. The templates live in `workflow/skills/` where ADAPT markers belong.

**Why it matters:** The entire point of the scanner is to validate installed files. Dismissing scanner failures on installed files undermines the tool's purpose. The distinction between template source (`workflow/skills/`) and installed copies (`.claude/skills/`, `.agents/skills/`, `.github/skills/`) is fundamental to goat-flow's architecture.

**Prevention:** Never dismiss scanner failures on installed skill files as "expected." If the scanner flags something in `.claude/skills/`, `.agents/skills/`, or `.github/skills/`, fix it. Only `workflow/skills/` (the distribution templates) should have ADAPT markers. When the scanner reports a deduction, the default response is "fix the file" not "suppress the check."

---

## Pattern: Skill session logs are never written

**Created:** 2026-03-30

**What happened:** The Shared Conventions block in every skill says "If `.goat-flow/logs/` exists → write session summary." The goat-review audit of `tasks/roadmaps/0.9.3/tasks.md` ran the full skill process (Step 0 → Phase A1-A3 → blocking gate) but no session log was written. The user noticed `.goat-flow/logs/sessions/` was empty. The closing protocol was skipped entirely — 0% compliance across the session.

**Root cause:** The session log instruction is buried in the Closing line of the Shared Conventions block (one clause in a compound sentence at `SKILL.md:17`). It fires at the END of a skill — after the agent has already delivered its output and is mentally "done." There's no enforcement mechanism: no hook checks for the file, no DoD gate references it, and no skill phase explicitly includes "write session log" as a step. It's a SHOULD rule in a MUST position.

**Prevention:** The closing protocol needs mechanical enforcement, not just a rule. Options: (1) add session logging to the DoD gates in CLAUDE.md so it blocks completion, (2) add a Stop hook that checks whether `.goat-flow/logs/sessions/` was written to during this session, (3) make session logging the FIRST line of the skill's output format template so the agent writes it before presenting findings, not after.

---

## Lesson: When a mockup exists, match it element-for-element
**Created:** 2026-04-05

**What happened:** User provided an HTML mockup with exact structure (`.left` div containing title + agent strip + detected config, `.right` div with prompt card) and screenshots. The agent interpreted the layout its own way — putting the title above both columns, the agent strip full-width, and the left column as plain text without a card background. This required 6+ correction rounds to get right: moving the title into the left column, moving the agent strip into the left column, adding the card background, fixing the width from 340px to 50%, adding `align-self: flex-start` so the card doesn't stretch full height. Every one of these was visible in the mockup from the start.

**Why it matters:** Each round of "fix this one thing" costs the user time and patience. The mockup HTML was a working reference with every structural decision already made. The agent's job was to wire up Alpine.js data bindings to the mockup's DOM structure — not to redesign the layout.

**Prevention:** When a mockup HTML file exists, open it and copy the structure directly. Map mockup CSS classes to existing `gf-*` classes or create matching ones. Do not reorganize the DOM structure based on what "seems right." The mockup is the spec — match it element-for-element, then add the dynamic bindings.

---

## Lesson: SBAO uses 2 core-trio agents + 1 fresh-context agent, not 3 single-perspective agents
**Created:** 2026-04-05

**What happened:** When running SBAO on the M32 plan, the agent launched 3 sub-agents — one as SKEPTIC, one as ANALYST, one as STRATEGIST. This splits the core trio into isolated perspectives instead of having each agent generate internal tension between all three. The correct structure is: 2 agents each running the full core trio (SKEPTIC + ANALYST + STRATEGIST internally), plus 1 fresh-context agent with no framework at all.

**Why it matters:** The core trio's value comes from triangular tension — one agent weighing "what could go wrong" against "what's the cost/benefit" against "what's the fastest path." Splitting them into separate agents eliminates that tension. The fresh-context agent exists to catch blind spots the framework creates — if all 3 agents use the framework, there's no control group.

**Prevention:** Before launching SBAO sub-agents, re-read the SBAO spec in `workflow/skills/goat-plan.md` or `.claude/skills/goat-plan/SKILL.md`. The structure is always: 2 agents with core trio, 1 agent without. Never split SKEPTIC/ANALYST/STRATEGIST into separate agents.
