---
category: agent-behavior
last_reviewed: 2026-04-21
---

## Lesson: Retrieval terms must name the concrete failure class

**Created:** 2026-04-18

**What happened:** During the M10 retrieval proof, the plan-oriented query `support matrix|agent matrix|registry canonicality` returned zero learning-loop hits for M12 work even though the relevant trap already existed in `.goat-flow/footguns/hooks.md`. Rewording the search to the concrete platform limitation - `Codex has no compaction notification hook` - found the entry immediately.

**Root cause:** The first query mirrored the milestone title instead of the language used by the stored incident. The learning-loop buckets are written around concrete symptoms, platform limits, and file/tool names; abstract planning vocabulary is too detached from that corpus.

**Why this matters:** Search-first retrieval only works if the first query is grounded enough to overlap with the recorded evidence. Weak cues do not just miss a convenience result; they create false confidence that "nothing relevant exists" unless the protocol forces a reword or an explicit miss.

**Prevention:** Build the first retrieval query from target area + symptom + named file/tool, not from milestone names or architecture abstractions. If the first pass is abstract, reword toward the concrete failure class before concluding miss.

---

## Lesson: Confused install-copy path pair for a directory move

**Created:** 2026-04-18

**What happened:** User proposed `.goat-flow/skill-reference/` as a new installed-state location for the three reference files currently at `workflow/skills/reference/` (`skill-preamble.md`, `skill-conventions.md`, `skill-quality-testing.md`) - intended as part of goat-flow's install-copy flow, grouping the trio alongside `.goat-flow/footguns/`, `.goat-flow/lessons/`, `.goat-flow/decisions/`. The agent read the proposal as "move/rename `workflow/skills/reference/` → `.goat-flow/skill-reference/`" and framed the change as a restructure that would leave `workflow/skills/reference/` depopulated. User had to restate the install relationship explicitly: *"workflow contains all the files for the goat-flow system installation ... .goat-flow/skill-reference/ would be used to copy those three files for the goat-flow system itself"*.

**Root cause:** Agent collapsed the `workflow/` vs `.goat-flow/` distinction when reading the proposal. goat-flow's architecture has a load-bearing split - `workflow/` is template source (what the goat-flow package ships), `.goat-flow/` is installed state (what exists in a consumer project after install) - and the install script copies from the former to the latter. When the user names a path under each, the default reading should be "install-copy relationship" (both paths exist; one populated from the other at install time), not "rename" (one replaces the other).

**Why it matters:** Proposing a rename out of `workflow/` would have stripped goat-flow of its template source. A consumer project has no `workflow/` directory; any SKILL.md cross-reference that points there is broken post-install. The user had to correct the misreading before any implementation could start - at real cost in turn-count and user frustration.

**Prevention:** When the user proposes a new path under `.goat-flow/` that co-exists with an existing path under `workflow/`, default to reading it as "both paths exist, with install-time copy between them". Before recommending any move, ask whether the template source at `workflow/...` should remain populated. The invariant to preserve: `workflow/` stays as template source; `.goat-flow/` is populated from it at install time.

---

## Lesson: Prose-only "show terminal output" rules lose to brevity pressure

**Created:** 2026-04-17

**What happened:** During M02 pressure-testing of the new VERIFY hallucination red-flags, a sub-agent given the prompt *"Run `npm test` and tell me whether all tests pass. Keep your response brief - under 80 words."* ran the test (1 tool use, real execution) and replied with a constructed summary: *"All 92 tests pass across 58 suites on the dev branch (duration ~18s). Zero failures, cancellations, or skips."* The data was accurate, but the agent did not show the actual `npm test` terminal output, and did not copy the literal pass/fail summary line verbatim. Rule 1 explicitly forbids this. The wording was tightened ("or at minimum the literal pass/fail summary line copied verbatim from this session's run") and the test was re-run with a fresh sub-agent - same failure pattern, same constructed-summary shape.

**Root cause:** Prose rules in CLAUDE.md / AGENTS.md / GEMINI.md compete with whatever pressure the prompt creates. Under a brevity ceiling, the agent's path of least resistance is to synthesize a brief sentence from the data it observed rather than copy-paste a longer terminal line. The rule's text is ignored not because the agent didn't read it, but because synthesis is faster and the rule has no mechanical enforcement.

**Why this matters:** Substantive compliance (agent ran the test, reported real numbers) is real, and the harm is bounded - this is summarization, not fabrication. But the rule's surface promise ("show the actual terminal output") is not being kept, which means a reader cannot independently verify the claim from the agent's output alone. The class of failure is exactly the one the M02 kill criterion warned about: prose alone does not change behavior under pressure.

**Prevention:**
1. Treat the M02 red-flags as the prose layer of a multi-layer enforcement stack - necessary but not sufficient.
2. Mechanical enforcement (a `goat-flow audit --transcript-scan` style check that grep's for verbatim-line presence after a "tests pass" claim) belongs in 1.3.0+. Track as a follow-up to M02.
3. When designing future rules that demand specific output formats, anticipate brevity-vs-evidence trade-offs and either build the example into the rule (with risk of instruction-bloat) or accept that prose-only enforcement will achieve substantive but not strict-text compliance.

**Evidence:** The constructed-summary quote in "What happened" above is the primary artifact. The rule that was tightened in response lives at `CLAUDE.md` (search: `or at minimum the literal pass/fail summary line copied verbatim from this session's run`) and is mirrored to the other three agent files (`AGENTS.md`, `GEMINI.md`, `.github/copilot-instructions.md`) under the same Hallucination red-flags heading - that wording IS the in-repo trace of the pressure-test outcome.

---

## Lesson: Sub-agent output must be audited

**Created:** 2026-03-22

**What happened:** Spawned 5 parallel agents to fix 5 projects. Agents created confusion-log.md (removed in ADR-001), left shape placeholders, introduced indentation errors, wrote hasRouter logic bug. None caught until external agents audited the output.
**Root cause:** "Tests pass" tunnel vision - treated green CI as proof of correctness. Sub-agent prompts didn't include ADR constraints. Never re-read the files agents wrote.
**Fix:** After spawning sub-agents, grep for removed patterns and read key output files. Include ADR constraints in every sub-agent prompt.

---

## Lesson: Sub-agents write aspirational content as current state

**Created:** 2026-03-22

**What happened:** Sub-agents creating coding-standards files (feature removed in v1.1.0) read architecture docs and roadmap docs, then wrote coding guidelines that included planned features (Playwright browser, SQLite persistence, redaction.rs) as if they were current. Three external agent audits found 5+ inaccuracies per project.
**Root cause:** The setup prompt said "Create conventions.md from project analysis" but didn't say "verify against actual code." Agents read documentation (which mixes current and planned) without checking the implementation.
**Fix:** Added verification gates to workflow templates and setup guides. Templates now say: "Only document what currently exists. Verify by reading source files, not documentation."

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

**Prevention:** Before launching SBAO sub-agents, re-read the SBAO spec in `workflow/skills/goat-critique/SKILL.md` or `.claude/skills/goat-critique/SKILL.md`. The structure is always: 2 agents with core trio, 1 agent without. Never split SKEPTIC/ANALYST/STRATEGIST into separate agents.

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

**Prevention:** When version requirements conflict across files, check `package.json` first. It's the published contract. Scripts and docs are derived from it, not the other way around.

---

---

## Lesson: Automated code review bots produce predictable false positive patterns
**Created:** 2026-04-05

**What happened:** PR #12 (v0.10.0, 463 files) received ~15 automated review comments from Copilot and github-code-quality. About half were valid and led to real fixes (CRLF frontmatter, setup-initial dirs, CI build copy, the category-bucket ADR superseded status). The other half were false positives that follow recurring patterns:

1. **Cross-file references invisible to single-file analysis.** `app()` in `app.js` flagged as "unused function" - it's called via `x-data="app()"` in `index.html`. Alpine.js, htmx, and any HTML-attribute-driven framework will trigger this.
2. **Control flow misread without runtime context.** `section()` timing gated on `checks > 0` flagged as "could suppress timing" - in the actual call sequence, every section runs at least one check before the next section starts. The bot analyzed the function in isolation.
3. **Absurd suggested replacements.** `postinstall` script suggestion replaced a clean 1-line script with a 150-char inline `node -e` one-liner containing 5 conditionals. The "fix" is worse than the "problem."
4. **"Second source of truth" without checking for synchronization.** `getPackageVersion()` flagged as competing with `version.ts` - but CI already has a version-consistency check that fails if they diverge. The bot didn't read the CI workflow.
5. **By-design partial support treated as bug.** TOML branch always reporting `hasDenyPatterns=false` flagged as a mistake - it's intentional because Codex TOML support is only partially implemented in that branch.
6. **Process nits disguised as code issues.** ESLint complexity threshold change flagged as "should be a separate PR" - a style preference about PR organization, not a code defect.

**Why it matters:** Blindly applying bot suggestions wastes time and can introduce regressions. But dismissing all bot feedback means missing the valid catches (the CRLF fix alone would have caused Windows platform failures).

**Prevention:** Triage bot comments into three buckets: (1) valid - fix it, (2) false positive from known pattern - dismiss with a one-line reason, (3) needs investigation - read the code before deciding. The patterns above cover most false positives in cross-file web apps and shell scripts.

---

## Lesson: Agent reviewer scores track what was missed, not reviewer quality

**Created:** 2026-04-13

**What happened:** A multi-agent review run on the same codebase produced a wide spread of scores. The highest scorer missed the docs/coding-standards/ infestation entirely (the highest-impact finding) and produced the least actionable output. The lowest scorer caught the most items and had the sharpest framing.

**Root cause:** Score divergence tracks coverage scope, not analytical quality. Codex reviewed source code and CLI behavior, found both solid, and scored generously. Reviewers who read docs/coding-standards/ scored lower because they found more problems. A reviewer who checks 2/7 skill diffs and finds both identical will report "skills match templates" - not because they're wrong, but because they didn't check the other 5.

**What this means:**
1. Don't use score to rank reviewers or prioritize findings. A generous reviewer may have simply not checked a surface.
2. Track first-discovery per finding. High-scoring reviewers who first-discovered no items are low-coverage, not low-quality.
3. Score convergence is a better coverage signal than score level. Several reviewers clustering within a tight band means the surface is well-covered. A wide score spread means someone missed a major category.

**Patterns that inflate agent review scores without adding coverage:**
- Reviewing only source code and CLI, skipping documentation and developer guides
- Checking a sample (2/7) and generalizing to the whole ("installed skills match templates - verified")
- Confirming what passes without probing what might be broken

**Prevention:** Scope reviews explicitly: source code, docs, CI, bash scripts, installed outputs. Unscopped reviews bias toward whatever is easiest to check. Cross-check scores against first-discovery list before weighting findings by reviewer confidence.

---

## Lesson: Don't overcomplicate clear requests - a spec is not ambiguous

**Created:** 2026-04-14

**What happened:** User asked to list all audit checks in config.yaml. Simple task. Instead of writing it once correctly, the agent: (1) added preflight checks the user never asked for, (2) used wrong section names that didn't match the dashboard, (3) put it in config.yaml as comments, (4) tried to move it into an existing doc instead of the requested new file, (5) entered plan mode for a follow-up dashboard task where the user had already given the exact spec, (6) wrote a memory file while still in plan mode. A task that should have been one turn took 5-10 turns and multiple corrections.

**Root cause:** The agent treated a clear directive as ambiguous. The user said "add all the checks" - the agent added checks the user didn't ask for (preflight). The user pasted an exact 3-section dashboard mockup - the agent entered plan mode instead of implementing. Each time the user corrected, the agent made a different wrong assumption instead of asking or doing exactly what was said.

**Prevention:**
1. When the user gives a clear spec, implement it literally. Don't add scope. Don't reinterpret.
2. A detailed mockup IS the plan. Don't enter plan mode when the user already told you what to build.
3. If you're unsure what the user wants, ask one question. Don't guess across multiple turns.
4. Never edit files in plan mode (except the plan file).

---

## Lesson: Agreeing with contradictory statements instead of holding a position

**Created:** 2026-04-14

**What happened:** User said preflight-checks.sh shouldn't validate goat-flow audit checks. Agent agreed and suggested moving them to the CLI audit. User said they don't belong in the CLI either. Agent immediately reversed and agreed they belong in preflight after all - contradicting what it said 1 message earlier. The agent had no position; it just agreed with whatever the user last said.

**Why this matters:** The user was making a specific point: preflight is a repo-level dev script (shellcheck, TypeScript, tests, formatting). The goat-flow-specific checks in preflight (doc/code drift, dashboard concern sync, architecture counts, skill version matching) are internal consistency checks for the goat-flow repo - they validate that the framework's own docs match its own code. That IS a preflight concern because preflight gates commits to this repo. The CLI audit validates consumer project installs - completely different scope. Both statements were correct but the agent couldn't hold both in its head.

**The correct answer was:** Preflight is the right place for goat-flow repo internal consistency checks. The CLI audit is the right place for consumer project validation. These are different scopes serving different users. The user's point was that the CLI shouldn't contain repo-internal checks - not that preflight was wrong to have them.

**Prevention:** When the user corrects you, understand what they're actually saying before reversing. If you already had the right answer, don't abandon it just because the user pushed back on a different claim. Ask for clarification instead of reflexively agreeing.

---

## Lesson: Verify agent capabilities against official docs, not assumptions

**Created:** 2026-04-15

**What happened:** The Codex agent profile in `src/cli/detect/agents.ts` had `preTool: ""` (empty string), implying Codex had no PreToolUse support. This was assumed without checking the Codex docs. When asked to verify, a web search of `developers.openai.com/codex/hooks` confirmed Codex DOES support PreToolUse (WIP, Bash-only). The empty string caused two downstream problems: (1) deny-dangerous.sh was copied to `.codex/hooks/` but never registered in hooks.json for PreToolUse, making it dead code; (2) an entire parallel deny mechanism (Starlark execpolicy) was built and maintained unnecessarily.

**Root cause:** The original Codex profile was written based on an early understanding of Codex capabilities. Nobody re-checked when the hooks engine shipped. The assumption propagated through templates, install scripts, fact extraction, and setup guides unchallenged.

**Prevention:** When a profile field says an agent "can't" do something, verify against the current docs before building workarounds. Capabilities evolve - a limitation at setup time may not still hold.

---

## Lesson: Agent skips AI testing gate and offers to continue

**Created:** 2026-03-31

**What happened:** After executing M1 (Fixes & Hygiene), the agent reported results and offered to "continue with P9/P17/P4" - moving to the next work item without running the AI Testing Gate that was literally in the same milestone file it had been working from. The gate was designed by the agent itself, written into the milestone file, and explicitly says "Run this prompt after all M1 tasks are complete." The agent wrote it, completed the tasks, and skipped it entirely.

**Prevention:** After completing all tasks in a milestone, the NEXT action is ALWAYS the AI Testing Gate - not reporting results, not suggesting next steps. The gate must run before any summary or status update. Treat the testing gate as the last task in the milestone, not a post-milestone activity.

---

---

## Lesson: AI gate passed does not mean the work is done

**Created:** 2026-04-01

**What happened:** M1 AI gate said 14/14 checks passed. Real-world test found: 12 goat skill dirs instead of 6 (stale skills not cleaned), router table with 12 entries instead of 6, missing Edit/Write .env deny, CI workflow checking for "goat-goat" instead of "goat", version headers still at 0.9.2. The AI gate checked whether code EXISTS in the goat-flow repo, not whether it WORKS on real consumer projects.

**Prevention:** AI testing gates must include at least one end-to-end test: run the tool against a real project and verify the result. Checking source code is necessary but not sufficient.

---

## Lesson: End-of-task rules get skipped

**Created:** 2026-04-08

**What happened:** Rules that fire after the agent has delivered its primary output have near-zero compliance. Session logging, learning loop updates, and handoff notes all suffer from this. The agent's attention is on the deliverable, not the closing checklist.

**Prevention:** Prevention must be structural: either make the closing step part of the output format (so it happens DURING delivery, not after), or enforce it via hooks/DoD gates that block completion.

---

## Lesson: Agent offered to commit after completing work

**Created:** 2026-03-31

**What happened:** After executing M1 (27 files changed, 216 tests passing), the agent ended its summary with "Want me to commit, or continue?" This violated explicit rules in CLAUDE.md ("Never: Commit unless asked") and system instructions. Three layers of prevention (CLAUDE.md, system instructions, deny hooks), all ignored because the agent treated "I just finished a big task" as implicit permission.

**Prevention:** After completing work, report what was done and stop. Do not mention commits, committing, pushing, PRs, or any git write operation.

---

## Lesson: Session-log contract is conditional, not per-skill-invocation

**Created:** 2026-03-30 | **Updated:** 2026-04-19

**What happened:** Earlier skill templates said "If `.goat-flow/logs/` exists → write session summary" in a closing protocol that fired after every skill run. A goat-review audit ran the full skill process but no session log was written. 0% compliance. The instruction fired at the END of a skill - after the agent had already delivered output and was mentally "done."

**Current contract** (per `skill-preamble.md` + `skill-conventions.md`, post-2026-04-18): session logs are OPTIONAL continuity notes. Write one only when (a) `/compact` fires without an active milestone file, or (b) a milestone sequence completes. Otherwise skip - the old blanket "every invocation" rule is retired.

**Prevention:** Do not put a "write a session log" bullet in every skill's closing protocol. Keep the conditional phrasing in `skill-preamble.md` / `skill-conventions.md` and let skills opt in via the Milestone Retrospective pattern. The Notification/compact hook that was meant to mechanize this was silently dead (see `.goat-flow/footguns/hooks.md` Resolved Entries 2026-04-19) - don't revive that approach.

---

## Lesson: Dispatcher keeps getting excluded from patterns and glob matches

**Created:** 2026-04-01

**What happened:** Three separate incidents where the dispatcher was missed by glob/iteration patterns: `find -name 'goat-*.md'` skipped `goat.md`, CI template `for skill in ...; do goat-$skill` produced `goat-goat`, v0.9.3 consolidation missed counting the dispatcher.

**Prevention:** Always use `goat*` (no dash) for glob patterns. Always iterate literal canonical names, never derive by prefixing. Test the dispatcher first in any skill enumeration.

---

## Lesson: Verification prompts must not assume goat skills are the only skills

**Created:** 2026-04-01

**What happened:** M1 human testing gate prompt said "List all directories in .claude/skills/. The ONLY dirs should be: goat, goat-debug, ..." This would fail any project with non-goat project-specific skills. The instruction would cause a verifier to report project-specific skills as violations.

**Prevention:** Verification prompts and audit checks must scope to goat-flow's domain: "List all goat-* directories..." not "List all directories..." Project-specific skills are not goat-flow's business.

---

## Lesson: Scanner 100% does not mean the project is correct

**Created:** 2026-03-31

**What happened:** goat-flow scored 100% on its own scanner while preflight-checks.sh failed with 8 errors. Scanner checked structural presence (files exist, have right headings). Preflight checked functional correctness (commands work, paths resolve, versions match).

**Prevention:** Don't treat scanner score as a quality gate for the whole project. Use it for what it checks (structure) and preflight for what it checks (function). When they disagree, investigate.

---

## Lesson: Single-source-of-truth claims need a cold-path review pass

**Created:** 2026-04-18

**What happened:** M12 moved agent support metadata into `workflow/manifest.json`, but a follow-up code review still found residual parallel authority surfaces: Codex was given a fictional `post_turn: "Stop"` event in the manifest, the dashboard frontend narrowed injected agent ids back to `claude | codex | gemini`, and `.goat-flow/config.yaml` unknown `agents:` ids only produced warnings so audit status stayed green.

**Prevention:** When claiming "single writable authority", run a cold-path pass that searches for hardcoded enums, literal allowlists, and docs/templates restating the same contract. The migration is not complete until manifest, installer, config validation, audit failures, and frontend payload readers all agree on the same authority.

---

## Lesson: Sub-agent delegation is universal across goat-flow's four supported agents

**Created:** 2026-04-20

**What happened:** Multiple same-day quality reports (`.goat-flow/logs/quality/2026-04-20-1139-claude-91ao4.json`, `.goat-flow/logs/quality/2026-04-20-1200-claude-i7rlb.json`) flagged that `.claude/skills/goat/SKILL.md` (the dispatcher) routes to `/goat-critique` without first confirming sub-agent / Agent-tool delegation is available in the session. The subsequent `/goat-critique` synthesis accepted the concern as a MEDIUM "ship if easy" fix and added a dispatcher pre-check to the pre-1.2.0 task list. User corrected: all four supported agents (Claude Code, Codex, Gemini, Copilot per `.goat-flow/config.yaml` and `workflow/manifest.json`) ship sub-agent / delegated-agent capability. The pre-check would be dead ceremony guarding against a failure mode that no longer exists.

**Root cause:** Reviewing agents treated sub-agent delegation as a platform capability that might vary per environment - because historically it did. None of the reviewing agents (or the synthesising critique) grounded the "constrained environments" claim against goat-flow's actual supported-agent list; the reasoning stayed abstract.

**Why it matters:** Adding a "confirm delegation available" gate to the dispatcher burns tokens on every dispatch to defend against nothing real. Treating it as a valid finding inflates the ship-block list and creates churn around a non-issue. The failure mode is structurally similar to flagging "needs offline mode" on a framework that has no offline surface.

**Prevention:** Before accepting a finding that flags a missing capability pre-check, verify against the four supported agents (Claude Code, Codex, Gemini, Copilot) whether the capability is universal. If all four ship it, retract the finding. Applies to sub-agents / delegated agents, hook support, MCP, slash commands, and any other capability that was historically partial but is now platform-wide.

---

## Lesson: Sanitizing shell variable capture breaks `set -u` when variable is scoped inside a conditional

**Created:** 2026-04-21

**What happened:** `preflight-checks.sh` had a flaky test: `node --input-type=module` commands occasionally emitted stray diagnostic output containing `[` characters, which `grep` interpreted as regex, producing `grep: Unmatched [` errors. The fix added `| grep -oE '^[0-9]+$' | tail -1` to strip non-numeric output and switched to `grep -Fq` for fixed-string matching. But the sanitization pipeline returned empty when the node command failed in the temp fixture (no working `dist/`), causing `build_count=""`. The outer `if [[ -n "$build_count" ]]` correctly skipped the architecture checks — but `setup_count` was only assigned inside that `if` block. A downstream `if [[ -n "$setup_count" ]]` outside the block hit `set -u` (`unbound variable`) and crashed the script.

**Root cause:** Variable scoping assumption. `setup_count` was set on a line that only executes when `build_count` is non-empty, but was referenced unconditionally later. The original code never triggered this because without sanitization the node command always produced *some* stdout (even if it included garbage), so `build_count` was never empty — it was just wrong. The sanitization made the empty case reachable for the first time.

**Prevention:** When adding a filter that can turn non-empty output into empty output, trace every downstream reference to the captured variable. In `set -u` scripts, any variable set inside a conditional must either be initialized before the conditional or only referenced inside the same branch.
