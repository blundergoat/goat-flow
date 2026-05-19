---
category: agent-behavior-trust
last_reviewed: 2026-05-19
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

**Evidence:** The constructed-summary quote in "What happened" above is the primary artifact. The rule that was tightened in response lives at `CLAUDE.md` (search: `showing the literal pass/fail line copied verbatim`) and is mirrored to the other three agent files (`AGENTS.md`, `GEMINI.md`, `.github/copilot-instructions.md`) under the same Hallucination red-flags heading - that wording IS the in-repo trace of the pressure-test outcome.

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
## Lesson: goat-critique uses 2 core-trio agents + 1 fresh-context agent, not 3 single-perspective agents
**Created:** 2026-04-05

**What happened:** When running goat-critique (formerly SBAO) on the M32 plan, the agent launched 3 sub-agents - one as SKEPTIC, one as ANALYST, one as STRATEGIST. This splits the core trio into isolated perspectives instead of having each agent generate internal tension between all three. The correct structure is: 2 agents each running the full core trio (SKEPTIC + ANALYST + STRATEGIST internally), plus 1 fresh-context agent with no framework at all.

**Why it matters:** The core trio's value comes from triangular tension - one agent weighing "what could go wrong" against "what's the cost/benefit" against "what's the fastest path." Splitting them into separate agents eliminates that tension. The fresh-context agent exists to catch blind spots the framework creates - if all 3 agents use the framework, there's no control group.

**Prevention:** Before launching goat-critique sub-agents, re-read `workflow/skills/goat-critique/SKILL.md` (search: `MUST Spawn all three sub-agents`) or `.claude/skills/goat-critique/SKILL.md` (search: `SKEPTIC/ANALYST/STRATEGIST combined lens`). The structure is always: 2 agents with core trio, 1 agent without. Never split SKEPTIC/ANALYST/STRATEGIST into separate agents.

---
## Lesson: goat-critique was role-played inline despite existing lesson saying not to

**Created:** 2026-04-09

**What happened:** User asked for goat-critique of M10-M13 plans. The agent wrote three "perspectives" (Skeptical User, Shipping Pragmatist, Framework Architect) inline - no Agent tool calls, no sub-agents launched. The output looked like critique but was the main agent arguing with itself from its own accumulated context. The user caught it: "SBAO should be done with sub agents to have fresh perspectives."

**Why this is worse than the first time:** The lesson from 2026-04-05 ("goat-critique uses 2 core-trio agents + 1 fresh-context agent, not 3 single-perspective agents") was already in this file. The agent had read the lessons directory earlier in the session. It knew the correct process and still defaulted to the easier path of writing perspectives inline. Reading a lesson is not the same as following it.

**Root cause:** The current skill says "Spawn all three sub-agents in parallel" in Phase 1, but nothing mechanically prevents the agent from interpreting "spawn" as "imagine." The agent's path of least resistance is to write inline - launching sub-agents requires more effort (crafting prompts, waiting for results, synthesizing). Without a hard check ("did you actually use the host's delegation mechanism?"), the agent will default to the faster wrong approach.

**Prevention:** The current enforcement lives in the Constraints block: `workflow/skills/goat-critique/SKILL.md` (search: `MUST Spawn all three sub-agents`). Phase 1 handles spawning (`workflow/skills/goat-critique/SKILL.md` (search: `Spawn all three sub-agents in parallel`)); Phase 3 is cross-examination (`workflow/skills/goat-critique/SKILL.md` (search: `## Phase 3 - Cross-Examine`)). Never role-play perspectives inline.

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
## Lesson: Verify agent capabilities against official docs, not assumptions

**Created:** 2026-04-15

**What happened:** The Codex agent profile in `src/cli/detect/agents.ts` had `preTool: ""` (empty string), implying Codex had no PreToolUse support. This was assumed without checking the Codex docs. When asked to verify, a web search of `developers.openai.com/codex/hooks` confirmed Codex DOES support PreToolUse (WIP, Bash-only). The empty string caused two downstream problems: (1) deny-dangerous.sh was copied to `.codex/hooks/` but never registered in hooks.json for PreToolUse, making it dead code; (2) an entire parallel deny mechanism (Starlark execpolicy) was built and maintained unnecessarily.

**Root cause:** The original Codex profile was written based on an early understanding of Codex capabilities. Nobody re-checked when the hooks engine shipped. The assumption propagated through templates, install scripts, fact extraction, and setup guides unchallenged.

**Prevention:** When a profile field says an agent "can't" do something, verify against the current docs before building workarounds. Capabilities evolve - a limitation at setup time may not still hold.

**Updated 2026-05-09:** The same trap recurred around Codex hooks and permissions, then needed a same-day correction from runtime evidence. Codex CLI 0.129.0 reports `[features].codex_hooks` as deprecated and lists `hooks` as the stable feature; it also rejects `read` access on recursive filename globs such as `**/.env.example` with `filesystem glob path '**/.env.example' only supports 'none' access`. Current goat-flow templates therefore use `[features].hooks = true` and rely on the Bash hook, not an absent exact TOML rule, for read-only `.env.example` inspection. Evidence anchors: `workflow/hooks/agent-config/codex.toml` (search: `hooks = true`), `workflow/install-goat-flow.sh` (search: `features.codex_hooks`), `src/cli/audit/check-agent-setup.ts` (search: `Deprecated Codex feature flag`).

**Updated 2026-05-19:** Codex CLI 0.131.0 tightened the permission-profile shape further: filename and match-anywhere globs such as `*.key`, `**/*.key`, `.env.*`, and `**/.ssh/**` now fail config loading even with `none` access. Runtime evidence: `codex "diagnostic no-op"` in this repo returned `Error loading configuration: filesystem glob path **/*.key only supports none access; use an exact path or trailing /** for none subtree access`. Current templates use trailing root subtrees in the base profile, add exact root paths only when those files exist, and rely on `.codex/hooks/deny-dangerous.sh` for direct literal filename-extension shell access. Evidence anchors: `workflow/hooks/agent-config/codex.toml` (search: `Exact entries must point at files`), `.codex/config.toml` (search: `absent exact`), `src/cli/facts/agent/settings.ts` (search: `existingExactPathsAreDenied`).

**Updated again 2026-05-19:** The same fix still left Codex TUI startup warnings because goat-flow emitted `:project_roots`. Codex 0.131.0's local binary recognizes `:workspace_roots`, not `:project_roots`; it warned that `:project_roots` plus every nested deny entry was unrecognized. Current templates now keep `":workspace_roots" = { ... }` under `[permissions.goat-flow.filesystem]`, and audit rejects legacy project-root entries as current secret coverage because Codex 0.131.0 ignores them. Evidence anchors: `workflow/hooks/agent-config/codex.toml` (search: `":workspace_roots" = {`), `.codex/config.toml` (search: `":workspace_roots" = {`), `src/cli/facts/agent/settings.ts` (search: `collectCodexWorkspaceRootEntries`), `.goat-flow/footguns/hooks.md` (search: `Codex workspace-root permission profiles must use the local 0.131 token`).

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
## Lesson: Sub-agent delegation is universal across goat-flow's four supported agents

**Created:** 2026-04-20

**What happened:** Multiple same-day quality reports (`.goat-flow/logs/quality/2026-04-20-1139-claude-91ao4.json`, `.goat-flow/logs/quality/2026-04-20-1200-claude-i7rlb.json`) flagged that `.claude/skills/goat/SKILL.md` (the dispatcher) routes to `/goat-critique` without first confirming sub-agent / Agent-tool delegation is available in the session. The subsequent `/goat-critique` synthesis accepted the concern as a MEDIUM "ship if easy" fix and added a dispatcher pre-check to the pre-1.2.0 task list. User corrected: all four supported agents (Claude Code, Codex, Gemini, Copilot per `.goat-flow/config.yaml` and `workflow/manifest.json`) ship sub-agent / delegated-agent capability. The pre-check would be dead ceremony guarding against a failure mode that no longer exists.

**Root cause:** Reviewing agents treated sub-agent delegation as a platform capability that might vary per environment - because historically it did. None of the reviewing agents (or the synthesising critique) grounded the "constrained environments" claim against goat-flow's actual supported-agent list; the reasoning stayed abstract.

**Why it matters:** Adding a "confirm delegation available" gate to the dispatcher burns tokens on every dispatch to defend against nothing real. Treating it as a valid finding inflates the ship-block list and creates churn around a non-issue. The failure mode is structurally similar to flagging "needs offline mode" on a framework that has no offline surface.

**Prevention:** Before accepting a finding that flags a missing capability pre-check, verify against the four supported agents (Claude Code, Codex, Gemini, Copilot) whether the capability is universal. If all four ship it, retract the finding. Applies to sub-agents / delegated agents, hook support, MCP, slash commands, and any other capability that was historically partial but is now platform-wide.

---
## Lesson: Fresh-eyes critique reruns need section-only evidence after a leak-scan discard

**Created:** 2026-04-24

**What happened:** During a full `goat-critique` run, the first fresh-eyes sub-agent stayed within the artifact but returned evidence links that echoed the artifact's `.goat-flow/...` path. Phase 2's leak scan treats any `.goat-flow/` match in Agent C output as `CONTEXT LEAK`, so the output had to be discarded and the control-group pass re-run with stricter instructions.

**Root cause:** The isolation rule and the leak scanner key off output text, not just what the sub-agent actually read. A clean fresh-eyes analysis can still fail the scan if its citation format includes repository-local paths.

**Why it matters:** If the orchestrator accepts that output anyway, the control group is no longer trustworthy. If it discards the output without tightening the rerun prompt, the same leak pattern can repeat and waste the critique budget.

**Prevention:** After any fresh-eyes leak-scan discard, re-spawn with an explicit output constraint: cite evidence only as `artifact line X` or section names, never as repo paths or local filenames. Treat citation formatting as part of the isolation contract, not a cosmetic detail.

---
