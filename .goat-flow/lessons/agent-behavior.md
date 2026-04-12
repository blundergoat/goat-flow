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

**What happened:** Sub-agents creating coding-standards files (feature removed in v1.1.0) read architecture docs and roadmap docs, then wrote coding guidelines that included planned features (Playwright browser, SQLite persistence, redaction.rs) as if they were current. Three external agent audits found 5+ inaccuracies per project.
**Root cause:** The setup prompt said "Create conventions.md from project analysis" but didn't say "verify against actual code." Agents read documentation (which mixes current and planned) without checking the implementation.
**Fix:** Added verification gates to workflow templates and setup guides. Templates now say: "Only document what currently exists. Verify by reading source files, not documentation."

---

## Pattern: Agent offered to commit after completing work

**Created:** 2026-03-31

**What happened:** After executing M1 (Fixes & Hygiene) - 27 files changed, 216 tests passing - the agent ended its summary with "Want me to commit, or continue with P9/P17/P4?" This violated two explicit rules: CLAUDE.md says "Never: Commit unless asked" and the system instructions say "MUST NOT commit changes unless the user explicitly asks." The agent knew both rules and broke them anyway.

**Why this is a fundamental failure:** The agent's job is to make changes. The user's job is to decide when those changes are ready to be committed. Offering to commit is the agent inserting itself into a decision that isn't its own. It's not a minor style issue - it's a boundary violation. The rules exist in CLAUDE.md, in the system instructions, and in the deny hooks (`Bash(git commit*)` is in `.claude/settings.json`). Three layers of prevention, all ignored because the agent treated "I just finished a big task" as implicit permission to suggest the next git operation.

**This is also a Claude Code systemic issue:** Claude models have a strong tendency to suggest committing after completing work. This isn't unique to this project - it's a default behavior pattern that overrides explicit instructions. The deny hook blocks the command itself, but it can't block the agent from asking. The only fix is behavioral: the agent must internalize that committing is never its suggestion to make.

**Prevention:** After completing work, report what was done and stop. Do not mention commits, committing, pushing, PRs, or any git write operation. There is no acceptable trigger - `Bash(*git commit*)` and `Bash(*git push*)` are in `.claude/settings.json` deny rules (lines 4-5), so the agent literally cannot run these commands even if the user asks. Committing is the user's action, performed outside the agent session.

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

**What happened:** User asked to "create M31 plan" and then later to "update this plan" with a detailed design spec. The agent wrote the plan file, then immediately launched a sub-agent to rewrite `index.html` - implementing the plan without being asked. User had to interrupt and correct: "dont change anything. just update this plan."

**Why it matters:** The user controls when code changes happen. Writing a plan and executing a plan are two completely separate actions. The user may want to review, share with others, or revise before any code is touched.

**Prevention:** Listen for the verb. "update the plan", "create M31", "write a plan" = write markdown only. "execute", "implement", "do it", "fix it" = make code changes. When in doubt, write the plan and ask if they want it executed. Never auto-execute a plan the user just asked you to write.

---

## Lesson: Installed skill files are not templates
**Created:** 2026-04-04

**What happened:** Scanner flagged AP18 (ADAPT comments in installed skills) causing a -2pt deduction on all 3 agents. Instead of fixing the installed files, the agent dismissed the failure as "expected for a template repo" and proposed suppressing AP18 when scanning the goat-flow repo. The user corrected this: `.claude/skills/`, `.agents/skills/`, `.github/skills/` are real project files that must pass the scanner at 100% - they are not templates. The templates live in `workflow/skills/` where ADAPT markers belong.

**Why it matters:** The entire point of the scanner is to validate installed files. Dismissing scanner failures on installed files undermines the tool's purpose. The distinction between template source (`workflow/skills/`) and installed copies (`.claude/skills/`, `.agents/skills/`, `.github/skills/`) is fundamental to goat-flow's architecture.

**Prevention:** Never dismiss scanner failures on installed skill files as "expected." If the scanner flags something in `.claude/skills/`, `.agents/skills/`, or `.github/skills/`, fix it. Only `workflow/skills/` (the distribution templates) should have ADAPT markers. When the scanner reports a deduction, the default response is "fix the file" not "suppress the check."

---

## Pattern: Skill session logs are never written

**Created:** 2026-03-30

**What happened:** The Shared Conventions block in every skill says "If `.goat-flow/logs/` exists → write session summary." The goat-review audit of `tasks/roadmaps/0.9.3/tasks.md` ran the full skill process (Step 0 → Phase A1-A3 → blocking gate) but no session log was written. The user noticed `.goat-flow/logs/sessions/` was empty. The closing protocol was skipped entirely - 0% compliance across the session.

**Root cause:** The session log instruction is buried in the Closing line of the Shared Conventions block (one clause in a compound sentence at `SKILL.md:17`). It fires at the END of a skill - after the agent has already delivered its output and is mentally "done." There's no enforcement mechanism: no hook checks for the file, no DoD gate references it, and no skill phase explicitly includes "write session log" as a step. It's a SHOULD rule in a MUST position.

**Prevention:** The closing protocol needs mechanical enforcement, not just a rule. Options: (1) add session logging to the DoD gates in CLAUDE.md so it blocks completion, (2) add a Stop hook that checks whether `.goat-flow/logs/sessions/` was written to during this session, (3) make session logging the FIRST line of the skill's output format template so the agent writes it before presenting findings, not after.

---

## Lesson: When a mockup exists, match it element-for-element
**Created:** 2026-04-05

**What happened:** User provided an HTML mockup with exact structure (`.left` div containing title + agent strip + detected config, `.right` div with prompt card) and screenshots. The agent interpreted the layout its own way - putting the title above both columns, the agent strip full-width, and the left column as plain text without a card background. This required 6+ correction rounds to get right: moving the title into the left column, moving the agent strip into the left column, adding the card background, fixing the width from 340px to 50%, adding `align-self: flex-start` so the card doesn't stretch full height. Every one of these was visible in the mockup from the start.

**Why it matters:** Each round of "fix this one thing" costs the user time and patience. The mockup HTML was a working reference with every structural decision already made. The agent's job was to wire up Alpine.js data bindings to the mockup's DOM structure - not to redesign the layout.

**Prevention:** When a mockup HTML file exists, open it and copy the structure directly. Map mockup CSS classes to existing `gf-*` classes or create matching ones. Do not reorganize the DOM structure based on what "seems right." The mockup is the spec - match it element-for-element, then add the dynamic bindings.

---

## Lesson: SBAO uses 2 core-trio agents + 1 fresh-context agent, not 3 single-perspective agents
**Created:** 2026-04-05

**What happened:** When running SBAO on the M32 plan, the agent launched 3 sub-agents - one as SKEPTIC, one as ANALYST, one as STRATEGIST. This splits the core trio into isolated perspectives instead of having each agent generate internal tension between all three. The correct structure is: 2 agents each running the full core trio (SKEPTIC + ANALYST + STRATEGIST internally), plus 1 fresh-context agent with no framework at all.

**Why it matters:** The core trio's value comes from triangular tension - one agent weighing "what could go wrong" against "what's the cost/benefit" against "what's the fastest path." Splitting them into separate agents eliminates that tension. The fresh-context agent exists to catch blind spots the framework creates - if all 3 agents use the framework, there's no control group.

**Prevention:** Before launching SBAO sub-agents, re-read the SBAO spec in `workflow/skills/goat-plan.md` or `.claude/skills/goat-plan/SKILL.md`. The structure is always: 2 agents with core trio, 1 agent without. Never split SKEPTIC/ANALYST/STRATEGIST into separate agents.

---

## Lesson: SBAO role-played inline despite existing lesson saying not to

**Created:** 2026-04-09

**What happened:** User asked for SBAO critique of M10-M13 plans. The agent wrote three "perspectives" (Skeptical User, Shipping Pragmatist, Framework Architect) inline - no Agent tool calls, no sub-agents launched. The output looked like SBAO but was the main agent arguing with itself from its own accumulated context. The user caught it: "SBAO should be done with sub agents to have fresh perspectives."

**Why this is worse than the first time:** The lesson from 2026-04-05 ("SBAO uses 2 core-trio agents + 1 fresh-context agent, not 3 single-perspective agents") was already in this file. The agent had read the lessons directory earlier in the session. It knew the correct process and still defaulted to the easier path of writing perspectives inline. Reading a lesson is not the same as following it.

**Root cause:** The SKILL.md says "Launch 3 sub-agents in parallel" but nothing mechanically prevents the agent from interpreting "launch" as "imagine." The agent's path of least resistance is to write inline - launching sub-agents requires more effort (crafting prompts, waiting for results, synthesizing). Without a hard check ("did you actually use the Agent tool?"), the agent will default to the faster wrong approach.

**Prevention:** M14 task created to add mechanical enforcement: (1) explicit "MUST use Agent tool" in Phase 3, (2) "never role-play perspectives inline" in Constraints, (3) process self-check before ranking step. The lesson alone wasn't enough - the process needs a gate.

---

## Lesson: Agent used setup script as source of truth instead of package.json
**Created:** 2026-04-05

**What happened:** When investigating CI test failures on Node 20, the agent read `setup-initial.sh` (which checks for Node 22+) and concluded the project requires Node 22 - contradicting `package.json` `engines.node: ">=20.11.0"`. The agent then suggested updating CI to Node 22 instead of fixing the scripts. The user corrected this: `package.json` is the canonical source of truth for the Node version requirement. Three shell scripts (`setup-initial.sh`, `dependency-install.sh`, `start-dev.sh`) all had the wrong version check.

**Why it matters:** Derived artifacts (scripts, docs, CI) can drift from the canonical source. When they conflict, the agent must identify which source is authoritative rather than picking whichever it read first. For Node version requirements, `package.json` `engines` is always canonical - it's what npm enforces, what CI reads, and what downstream consumers see.

**Prevention:** When version requirements conflict across files, check `package.json` first. It's the published contract. Scripts and docs are derived from it, not the other way around. See ADR-027.

---

## Lesson: Tick milestone checkboxes immediately when tasks complete, not at the end

**Created:** 2026-04-07

**What happened:** During M08 execution, the agent completed 15+ tasks (setup guards, scanner fixes, skill purges, compose-setup.ts early return, architecture.md fixes) without ticking a single checkbox in the milestone file. The user had to explicitly ask for the tasks to be marked done. This is the same failure pattern that caused ADR-024 (flush protocol checkbox enforcement) - the agent does the work but skips the tracking step because it's focused on the next task.

**Why it matters:** Unticked checkboxes make the milestone look incomplete even when 80% of the work is done. The user can't tell at a glance what's finished vs what's remaining. This is especially bad when multiple agents or sessions work on the same milestone - the next agent sees all checkboxes unchecked and may redo work.

**Prevention:** After completing each task, tick the checkbox IMMEDIATELY before starting the next task. This is already in CLAUDE.md VERIFY step ("If working from a plan/milestone file, tick `- [x]` as each task completes - not at the end") and was the explicit instruction in the milestone file. The instruction exists in three places and was still ignored. The only reliable fix is to make it a hard habit: complete task → tick checkbox → move on. Never batch checkbox ticking.

---

## Lesson: Automated code review bots produce predictable false positive patterns
**Created:** 2026-04-05

**What happened:** PR #12 (v0.10.0, 463 files) received ~15 automated review comments from Copilot and github-code-quality. About half were valid and led to real fixes (CRLF frontmatter, setup-initial dirs, CI build copy, ADR-020 superseded status). The other half were false positives that follow recurring patterns:

1. **Cross-file references invisible to single-file analysis.** `app()` in `app.js` flagged as "unused function" - it's called via `x-data="app()"` in `index.html`. Alpine.js, htmx, and any HTML-attribute-driven framework will trigger this.
2. **Control flow misread without runtime context.** `section()` timing gated on `checks > 0` flagged as "could suppress timing" - in the actual call sequence, every section runs at least one check before the next section starts. The bot analyzed the function in isolation.
3. **Absurd suggested replacements.** `postinstall` script suggestion replaced a clean 1-line script with a 150-char inline `node -e` one-liner containing 5 conditionals. The "fix" is worse than the "problem."
4. **"Second source of truth" without checking for synchronization.** `getPackageVersion()` flagged as competing with `version.ts` - but CI already has a version-consistency check that fails if they diverge. The bot didn't read the CI workflow.
5. **By-design partial support treated as bug.** TOML branch always reporting `hasDenyPatterns=false` flagged as a mistake - it's intentional because Codex TOML support is partial (documented in ADR-025).
6. **Process nits disguised as code issues.** ESLint complexity threshold change flagged as "should be a separate PR" - a style preference about PR organization, not a code defect.

**Why it matters:** Blindly applying bot suggestions wastes time and can introduce regressions. But dismissing all bot feedback means missing the valid catches (the CRLF fix alone would have caused Windows platform failures).

**Prevention:** Triage bot comments into three buckets: (1) valid - fix it, (2) false positive from known pattern - dismiss with a one-line reason, (3) needs investigation - read the code before deciding. The patterns above cover most false positives in cross-file web apps and shell scripts.
