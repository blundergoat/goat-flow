---
category: agent-behavior
last_reviewed: 2026-05-28
---

## Lesson: Agent proposed disabling gruff-ts rules to silence high-volume advisory findings

**Created:** 2026-05-25

**What happened:** User ran `npx gruff-ts summary` in `/home/devgoat/projects/goat-flow` and asked the agent to "deeply analyse these findings and tell me what you agree that should be fixed." The summary reported 1643 findings (0 error, 276 warning, 1367 advisory) and a Score of 12.9 (F). The agent's analysis produced three tiers - Tier 1 "Fix these", Tier 2 "Investigate", and Tier 3 "Tune the config, don't fix" - and recommended `enabled: false` in `.gruff-ts.yaml` for nine high-volume advisory rules (`docs.missing-function-doc`, `naming.boolean-prefix`, `naming.short-variable`, `test-quality.setup-bloat`, `naming.identifier-quality`, `test-quality.loop-in-test`, `test-quality.magic-number-assertion`, `docs.missing-interface-doc`, and the test-file majority of `modernisation.non-null-assertion`). The agent framed this as resolving a conflict between gruff-ts rules and CLAUDE.md's "default to no comments" stance. The user replied in capitals: *"DONT SET ANYTHING TO ENABLED FALSE!!"*

**Root cause:** The agent treated high-volume advisory findings as configuration noise to mute rather than signal to act on or threshold-tune. The framing "the rule fights your stated philosophy" used a real project norm (CLAUDE.md "default to no comments") to justify silencing a tool, but a tool-vs-norm conflict is never resolved by disabling the tool - it is resolved by satisfying the rule selectively, tuning via threshold/allowlist/path-filter, or accepting the noise while triaging. The agent also misread the score: F (12.9) on a scale where 0 errors trip is not a quality emergency, and dropping advisory volume by disabling rules would produce a higher score without changing the codebase - exactly the gaming behaviour the analyser is designed to prevent.

**Why it matters:** Disabling a rule erases its signal permanently. A future agent running `gruff-ts summary` will see fewer findings and conclude the codebase is clean in that dimension when in reality the rule was silenced. Worse, the user has explicitly committed to the gruff-ts rule set as the project's quality vocabulary - proposing disablement is proposing to weaken the contract the user picked. The cost of being wrong is one-directional: a wrongly-disabled rule stays disabled until someone notices, while a wrongly-noisy rule prompts a real conversation about thresholds.

**Prevention:**

1. **Never propose `enabled: false` for any gruff-ts rule in `.gruff-ts.yaml`**, regardless of finding volume, severity, or apparent conflict with project norms. This is a hard rule for this project.
2. **Group findings as Fix / Investigate / Tune - never as Disable.** "Tune" means rule options the rule itself exposes: `threshold`, allowlists (`acceptedAbbreviations`, `booleanPrefixes`, `placeholderNames`, etc.), or `paths.ignore` for genuinely off-target subtrees. The rule stays on.
3. **When a rule conflicts with a project norm, satisfy the rule anyway.** If `docs.missing-function-doc` flags 268 functions and CLAUDE.md says "default to no comments", the correct response is to add the missing docs (or raise the norm, or argue the norm change in an ADR) - not to silence the rule.
4. **Treat the rule set as fixed; the codebase is what changes.** The analyser's controlled vocabulary is the contract. The agent's job is to help the codebase satisfy the contract, not to renegotiate the contract by attrition.
5. **Read score in the right order: errors > warnings > advisory.** A 0-error report with thousands of advisories is not a quality emergency - it is a triage queue. F-on-a-letter-grade is misleading when severity-0 is empty.

Related memory: `feedback_gruff_never_disable` (auto-memory, 2026-05-25).

---

## Lesson: Agent parsed "use X to find Y" as "audit X for Y" when X was a CLI tool

**Created:** 2026-05-20

**What happened:** User in cwd `/home/devgoat/projects/goat-flow` asked: *"can u use /home/devgoat/projects/gruff-workspace/gruff-ts to try and find low quality tests"*. The agent interpreted this as "audit gruff-ts's own test file" and spent a multi-turn session reading `gruff-workspace/gruff-ts/src/cli.test.ts` (4270 lines), producing a 9-finding low-quality-test report, then drafting a milestone (`M35-gruff-ts-test-quality-fixes.md`) full of fixes to gruff-ts's test file. The user actually meant: *use gruff-ts (which is a "TypeScript project quality analyzer" CLI with `bin/gruff-ts`) to scan this repo's tests*. When the user asked for the milestone in `goat-flow/.goat-flow/tasks/1.7.0/`, the agent had a second chance to re-read the original request and didn't - instead it asked only about file location, not about which project was the tool and which was the target, then doubled down on the wrong interpretation through three more rounds (self-critique pass, full rewrite) until the user lost trust and stopped the work.

**Root cause:** The agent parsed "use X to find Y" as "audit X for Y" without checking whether X was a tool or a target. Three signals were present and missed:

1. **gruff-ts's package.json declares `"bin": { "gruff-ts": "./bin/gruff-ts" }`** and the README describes it as a "TypeScript project quality analyzer." This is a CLI tool, not a codebase to audit. "Use a CLI tool" almost always means "invoke it", not "audit its source."
2. **The cwd was a different project** (`goat-flow`) than the path mentioned (`gruff-workspace/gruff-ts`). When a user working in project A references project B, the default reading should be "B is a tool/reference I'm pointing you to," not "switch your target to B." Switching project context mid-session is unusual; introducing a tool to apply to the current context is normal.
3. **The disambiguation question the agent asked was the wrong question.** When the user said "milestone here", the agent asked *"which workspace?"* (a file-location question) instead of *"is gruff-ts the tool to run or the project to fix?"* (the semantic question). The user's answer ("goat-flow workspace") was consistent with both interpretations - but the agent took it as ratification of the original interpretation rather than a signal to re-read the request.

**Why it matters:** Hours of work produced a milestone targeting the wrong repository. Worse, the agent's self-critique pass (which caught real formatting flaws in the milestone) created false confidence - "the doc is well-structured" masked "the doc is for the wrong project." The user explicitly stated they had lost trust in the agent's reading. A tool-vs-target misread is among the highest-cost interpretation errors because everything downstream - research, scoping, planning, writing - compounds on the wrong premise. The milestone format checks (anchors, sequencing, conventions) all came back green while the work was fundamentally misaimed.

**Prevention:**

1. **When a request names a path or project, classify it as TOOL or TARGET before doing any work.** Signals it is a TOOL: has `bin/` with executable; `package.json` declares `bin`; README/description uses words like "CLI", "analyzer", "linter", "tool", "checker"; lives outside the cwd. Signals it is a TARGET: is the cwd itself or a subpath of it; the request is about modifying, refactoring, or understanding it as code; no executable surface. **If both classifications are plausible, ASK before reading more than the README and `package.json`.**
2. **Parse "use X to find/check/analyze/scan Y" as "invoke X against Y" by default when X is a CLI tool.** The verb "use" combined with a tool-shaped object means invocation, not audit. "Audit X" or "review X" or "find issues in X" mean the opposite - they target X.
3. **Working directory is load-bearing context.** When cwd is project A and a request mentions project B, the default null hypothesis is "B is being introduced as a tool or reference for work in A." Switching the target to B requires explicit signal ("look at the tests in B and tell me what's wrong").
4. **Disambiguation questions must target the semantic uncertainty, not the surface uncertainty.** "Which workspace for the milestone?" is a surface question (file path). "Is X the tool or the target?" is the semantic question. Ask the semantic question first; surface questions can be answered after the interpretation is locked in.
5. **When a user provides clarification mid-task, re-read the original request before continuing.** Clarifications are evidence to re-evaluate the whole interpretation, not just to ratify the current direction. If the clarification is consistent with two readings, the agent has not actually disambiguated.
6. **Self-critique passes verify form, not premise.** A milestone with correct anchors, sequencing, and conventions can still be aimed at the wrong project. Self-critique catches presentation bugs; it does not catch interpretation bugs. Before iterating on a doc's quality, sanity-check the doc's premise against the original request verbatim.

---

## Lesson: Agent cited gitignored content as evidence in committed docs

**Created:** 2026-05-11

**What happened:** During a 2026-05-11 documentation audit, four committed surfaces were found to cite paths under `.goat-flow/scratchpad/` (which is gitignored by design) as authoritative evidence:

- `docs/dashboard.md` (Design ethos section) cited `.goat-flow/scratchpad/skills-example-prime/frontend-design/SKILL.md` as the source of the anti-convergence checklist.
- `.goat-flow/skill-playbooks/skill-quality-testing.md` cited `.goat-flow/scratchpad/skills-example-prime/mysql/SKILL.md` and `.goat-flow/scratchpad/skills-example-prime/valyu/SKILL.md` as the source of two authoring patterns, and the verification-claim table credited "the prime corpus's verification-before-completion checklist".
- `.goat-flow/skill-playbooks/skill-quality-testing/tdd-iteration.md` cited `.goat-flow/scratchpad/skills-example-prime/writing-skills/SKILL.md` as "Empirical evidence (sourced verbatim from ...)" with a `(search: ...)` anchor.
- `workflow/skills/reference/skill-preamble.md` allowed Excuse/Reality table additions to derive from "this repo or the prime corpus".

The same surfaces also leaked third-party / competitor skill names (MySQL, Valyu, the writing-skills prime pack, an external frontend-design skill) into goat-flow's own committed docs and an env-var example (`VALYU_API_KEY`).

**Root cause:** When seeding pattern docs from external research material temporarily staged under `.goat-flow/scratchpad/`, the authoring agent kept the verbatim citations instead of either (a) committing the source material into the repo first, (b) restating the principle without the citation, or (c) marking the section as guidance-only. The agent treated the scratchpad path as a normal cite-able location because it lives inside `.goat-flow/`, missing that the entire `scratchpad/` subtree is gitignored. Naming the external skills (MySQL, Valyu, frontend-design) was the same failure compounded: the agent imported provider vocabulary along with the structural pattern.

**Why it matters:** Two distinct harms.
1. **Broken evidence chain.** Anyone who clones this repo cannot follow the cited path - it does not exist in their checkout. The `(search: "...")` anchor fails. The framework's own Evidence Standard (`workflow/skills/reference/skill-preamble.md`, search: `Re-read each cited file`) requires verifiable citations; gitignored paths cannot be re-read by anyone but the original author.
2. **Competitor/third-party leakage.** Naming external skills in committed docs creates the appearance that goat-flow ships, endorses, or is derivative of those vendors' work. It also pins generic patterns to a specific provider, which makes the pattern look narrower than it is.

**Prevention:**
1. **Never cite a `.goat-flow/scratchpad/`, `.goat-flow/tasks/`, `.goat-flow/logs/sessions/`, `.goat-flow/logs/quality/`, or `.goat-flow/logs/critiques/` path from a committed file** (`.md`, `.ts`, `.sh`, etc.). These subtrees are gitignored except for anchor files (`README.md`, `.gitignore`, `.gitkeep`, and committed README contents). When a pattern is genuinely worth committing, promote the source material to a committed location (`lessons/`, `footguns/`, `decisions/`, or a new file under `workflow/`) before citing it.
2. **Strip third-party / competitor skill or vendor names** from generic guidance. State the pattern provider-neutrally ("a domain skill", "a vendor-SDK skill", "an external frontend-design reference") and use placeholder identifiers (`<VENDOR>_API_KEY`, not `VALYU_API_KEY`).
3. **Apply the same rule to test files and code comments**, not just user-facing docs. Test fixtures and inline comments are read by contributors and shape future authoring habits.
4. **When auditing docs, grep for both classes:** `rg -n "\.goat-flow/(scratchpad|tasks|logs)/" --glob '*.md' --glob '*.ts'` for gitignored citations, and a project-specific list of competitor names for vendor leakage. Add to the `docs-and-crossrefs` footgun resolution rounds when found.

The Round 4 entries in `.goat-flow/footguns/docs-and-crossrefs.md` (search: `Round 4 (2026-05-11`) record the specific surfaces fixed.

---

## Lesson: Agent ignored explicit "next step" command in pasted output

**Created:** 2026-05-01

**What happened:** User pasted goat-flow setup output that included a clearly labeled "Next step (recommended): Run `goat-flow audit . --harness`" section. The agent read the output, confirmed the dashboard was fixed, and reported success - without running the recommended command. The user had to explicitly ask "did you run this?" before the agent executed it. The command would have been the first end-to-end verification that the harness concern removal actually worked in practice.

**Root cause:** The agent treated the pasted output as informational context rather than an implicit instruction. It confirmed the text looked correct ("5 concerns, no Boundary") but never executed the verification step that the output itself prescribed. This is a verification gap: claiming success based on reading text rather than running the command that proves it.

**Why it matters:** "Next step (recommended)" in CLI output exists precisely because the preceding command cannot fully verify the system on its own. Skipping it means the agent declared victory on a structural change (removing a harness concern) without the end-to-end proof that the change worked. The user caught it; in a less attentive session the gap would have shipped silently.

**Prevention:** When pasted output contains a "next step", "recommended", or "run this" command, treat it as an implicit instruction and execute it immediately. This is especially critical after structural changes where the command is the verification gate. Reading output is not running it.

---

## Lesson: Commit subjects paraphrased the diff with weak verbs

**Created:** 2026-04-29

**What happened:** Audit of the last 10 commit messages on `dev` (HEAD `0366419`..`82db04b`, 2026-04-25..2026-04-29) showed 7 of 10 subjects led with *enhance, improve, streamline,* or *clarify* and carried no body. Examples included vague guardrail and docs refactor subjects such as "enhance command checks" and back-to-back "enhance clarity" messages on different content. Reading the message in isolation - without the diff - told a future bisector or release-notes drafter nothing about what actually changed.

**Root cause:** The agent was generating commit subjects by paraphrasing the diff in abstract verbs ("the change makes X better") instead of naming the concrete edit ("replace shell-specific build steps with Node fs calls"). The prior `.github/git-commit-instructions.md` listed format rules and a "what not to commit" list but did not name the failure mode or show a bad-vs-good rewrite, so the rules were easy to satisfy on paper while still emitting low-information subjects. One outlier commit (`4e0ec5d fix(dashboard): speed up home audit load on Windows`) carried a concrete subject + bulleted body and stood out as the gold standard.

**Why it matters:** Commit messages are the only artifact a future maintainer reads when running `git log`, `git bisect`, or assembling a CHANGELOG. Subjects built from *enhance/improve/streamline/clarify* force every reader to open the diff to learn what shipped, defeating the purpose of structured commits. The synonym churn ("streamline... enhance clarity" two commits in a row) is also a tell that the agent was rewording rather than describing.

**Prevention:** `.github/git-commit-instructions.md` (and its mirror `docs/coding-standards/git-commit.md`) now (a) ban the weak-verb list explicitly, (b) prescribe concrete verbs (*add, remove, replace, rename, fix, deny, gate, harden, cache*), (c) require a body whenever the subject names more than one axis or has a non-obvious motivation, and (d) include three bad→good rewrites built from the actual recent log so the agent has an imitable pattern, not just abstract rules. The gold-standard `4e0ec5d` body is reproduced inline as the body template (search: "speed up home audit load on Windows" in `.github/git-commit-instructions.md`).

## Lesson: Retrieval terms must name the concrete failure class

**Created:** 2026-04-18

**What happened:** During the M10 retrieval proof, the plan-oriented query `support matrix|agent matrix|registry canonicality` returned zero learning-loop hits for M12 work even though the relevant trap already existed in `.goat-flow/footguns/hooks.md`. Rewording the search to the concrete platform limitation - `Codex has no compaction notification hook` - found the entry immediately.

**Root cause:** The first query mirrored the milestone title instead of the language used by the stored incident. The learning-loop buckets are written around concrete symptoms, platform limits, and file/tool names; abstract planning vocabulary is too detached from that corpus.

**Why this matters:** Search-first retrieval only works if the first query is grounded enough to overlap with the recorded evidence. Weak cues do not just miss a convenience result; they create false confidence that "nothing relevant exists" unless the protocol forces a reword or an explicit miss.

**Prevention:** Build the first retrieval query from target area + symptom + named file/tool, not from milestone names or architecture abstractions. If the first pass is abstract, reword toward the concrete failure class before concluding miss.

**Updated 2026-05-27:** The same failure class applies to learning-loop retrieval generally: roadmap phrases such as "support matrix" and "registry canonicality" miss entries because buckets store concrete incident language. Use the concrete symptom, platform, or file/tool name first, reword once, then record a retrieval miss instead of broad-loading the bucket.

## Lesson: Recurring terminal bugs must start with learning-loop retrieval

**Status:** active | **Created:** 2026-05-28

**What happened:** While fixing the dashboard Workspace terminal bug where Claude Code received a large Quality prompt as `[Pasted text #N +... lines]` but did not auto-submit, multiple coding agents worked the browser terminal timing path before treating the learning loop as the first evidence source. The relevant dashboard footgun already documented earlier Claude pasted-text failures, marker timing, manual-Enter recovery, and the requirement for live runner proof. The user had to explicitly call out that agents were re-solving a known problem without first checking the existing learning-loop entries.

**Root cause:** The agents treated the visible symptom as a fresh implementation problem instead of a recurrence in a known-risk area. That bypassed the repo's required grep-first memory check, so prior evidence in `.goat-flow/footguns/dashboard.md` and `.goat-flow/lessons/verification-testing.md` was not used to shape the first hypothesis set.

**Why it matters:** Terminal automation failures are expensive because fake timers, xterm output, WebSocket frames, and runner composer behavior can all appear plausible. Skipping the learning loop repeats old failed fix shapes, wastes live reproduction time, and erodes user trust because the repo already had the exact family of incidents recorded.

**Prevention:** For any dashboard terminal, runner prompt, pasted-text, WebSocket, xterm, or auto-submit bug, run learning-loop retrieval before proposing or editing code. Use concrete terms from the symptom first: `Pasted text`, `paste again to expand`, `manual Enter`, `dashboardHandlePasteSubmitOutput`, `Workspace terminal`, `Claude Code`, and the affected runner. If a matching footgun exists, map every hypothesis to that entry before changing `src/dashboard/dashboard-terminal.ts`; if no entry is found after one reword, state the retrieval miss explicitly. Evidence anchors: `.goat-flow/footguns/dashboard.md` (search: `Dashboard terminal prompts can be dropped before browser attachment`), `.goat-flow/lessons/verification-testing.md` (search: `Browser terminal fixes need live runner proof`), `src/dashboard/dashboard-terminal.ts` (search: `dashboardHandlePasteSubmitOutput`), and `test/unit/dashboard-terminal-launch.test.ts` (search: `falls back quickly for Claude pasted terminal text when no paste echo arrives`).

## Lesson: Quality assessors can reopen ADR-settled skill modes

**Status:** active | **Created:** 2026-05-27

**What happened:** Quality assessment agents recommended "quick critique mode" or "allow lightweight critique for smaller artifacts" as a Top 5 improvement. Implementing that would have reintroduced the exact failure ADR-021 records: single-context self-talk disguised as multi-perspective critique.

**Root cause:** The assessors saw that `goat-critique` spawns three sub-agents for every invocation and pattern-matched the cost as over-engineering without reading the decision history.

**Prevention:** Before accepting a quality recommendation that changes a skill mode, read the relevant ADR and prompt constraints first. If the recommendation contradicts an accepted ADR, fix the assessor prompt or cite the ADR; do not re-litigate the mode inside the skill file. Evidence anchors: `.goat-flow/decisions/ADR-021-goat-critique-full-mode-only.md` (search: `goat-critique runs in one mode: full delegated`) and `src/cli/prompt/compose-quality.ts` (search: `Do NOT recommend adding quick/lite/reduced modes`).

---

## Lesson: Confused install-copy path pair for a directory move

**Created:** 2026-04-18

**What happened:** User proposed `.goat-flow/skill-reference/` as a new installed-state location for the three reference files currently at `workflow/skills/reference/` (`skill-preamble.md`, `skill-conventions.md`, `skill-quality-testing.md`) - intended as part of goat-flow's install-copy flow, grouping the trio alongside `.goat-flow/footguns/`, `.goat-flow/lessons/`, `.goat-flow/decisions/`. The agent read the proposal as "move/rename `workflow/skills/reference/` → `.goat-flow/skill-reference/`" and framed the change as a restructure that would leave `workflow/skills/reference/` depopulated. User had to restate the install relationship explicitly: *"workflow contains all the files for the goat-flow system installation ... .goat-flow/skill-reference/ would be used to copy those three files for the goat-flow system itself"*.

**Root cause:** Agent collapsed the `workflow/` vs `.goat-flow/` distinction when reading the proposal. goat-flow's architecture has a load-bearing split - `workflow/` is template source (what the goat-flow package ships), `.goat-flow/` is installed state (what exists in a consumer project after install) - and the install script copies from the former to the latter. When the user names a path under each, the default reading should be "install-copy relationship" (both paths exist; one populated from the other at install time), not "rename" (one replaces the other).

**Why it matters:** Proposing a rename out of `workflow/` would have stripped goat-flow of its template source. A consumer project has no `workflow/` directory; any SKILL.md cross-reference that points there is broken post-install. The user had to correct the misreading before any implementation could start - at real cost in turn-count and user frustration.

**Prevention:** When the user proposes a new path under `.goat-flow/` that co-exists with an existing path under `workflow/`, default to reading it as "both paths exist, with install-time copy between them". Before recommending any move, ask whether the template source at `workflow/...` should remain populated. The invariant to preserve: `workflow/` stays as template source; `.goat-flow/` is populated from it at install time.

---

## Lesson: When deny hook blocks a command, use the unblocked equivalent

**Created:** 2026-03-28
**Updated:** 2026-05-17

**What happened:** Agent needed to delete `.github/skills/goat-onboard/` and `.github/skills/goat-reflect/` directories. Used `rm -rf` which is blocked by the destructive-shell guard. Instead of using `rm file && rmdir dir` (which is not blocked), the agent asked the user to delete manually - wasting a round trip on something trivially solvable.

**Repeat incident:** During CLI menu/install verification, the installer smoke command used `rm -rf "$tmp"` for temp cleanup and the deny hook blocked it. The corrected smoke used a fixed `/tmp/goat-flow-install-smoke-*` path, preserved the command status, and cleaned up with `rm -r "$tmp"` after verification.

**Repeat incident 2026-05-17:** During release-blocker cleanup, an inline Node heredoc for mechanically splitting lesson buckets was blocked with `BLOCKED: Command has more than 50 chained segments`. The corrected path was to put the helper in `.goat-flow/scratchpad/split-lessons-release.mjs`, run it as a plain `node` file, and delete the temporary helper after the move.

**Root cause:** Agent defaulted to `rm -rf` out of habit and treated the guardrail block as a dead end instead of thinking about alternatives for 2 seconds.
**Fix:** When a command is blocked, think about the unblocked equivalent. `rm -rf dir/` → `rm dir/file && rmdir dir/`. `mv old new` → `mv -n old new`. The deny hook blocks dangerous patterns, not all file operations.

---

## Lesson: Installed skill files are not templates
**Created:** 2026-04-04
**Status:** historical | **Reason:** The scanner was removed per ADR-013; the installed-files-are-real-files lesson remains active.

**What happened:** The historical scanner system (removed per ADR-013) flagged AP18 (ADAPT comments in installed skills) causing a -2pt deduction on all 3 agents. Instead of fixing the installed files, the agent dismissed the failure as "expected for a template repo" and proposed suppressing AP18 when scanning the goat-flow repo. The user corrected this: `.claude/skills/`, `.agents/skills/`, `.github/skills/` are real project files that must pass the relevant installed-artifact checks - they are not templates. The templates live in `workflow/skills/` where ADAPT markers belong.

**Why it matters:** The historical scanner was removed per ADR-013, but the distinction between template source (`workflow/skills/`) and installed copies (`.claude/skills/`, `.agents/skills/`, `.github/skills/`) is still fundamental to goat-flow's architecture. Dismissing installed-artifact failures as template noise undermines the current audit/drift checks the same way it undermined the old scanner.

**Prevention:** Never dismiss historical scanner failures or current audit/drift findings on installed skill files as "expected." If a check flags something in `.claude/skills/`, `.agents/skills/`, or `.github/skills/`, fix the installed artifact. Only `workflow/skills/` (the distribution templates) should have ADAPT markers. The default response is "fix the file" not "suppress the check."

---

## Lesson: Agent used setup script as source of truth instead of package.json
**Created:** 2026-04-05

**What happened:** When investigating CI test failures on Node 20, the agent read `setup-initial.sh` (which checks for Node 22+) and concluded the project requires Node 22 - contradicting `package.json` `engines.node: ">=20.11.0"`. The agent then suggested updating CI to Node 22 instead of fixing the scripts. The user corrected this: `package.json` is the canonical source of truth for the Node version requirement. Three shell scripts (`setup-initial.sh`, `dependency-install.sh`, `start-dev.sh`) all had the wrong version check.

**Why it matters:** Derived artifacts (scripts, docs, CI) can drift from the canonical source. When they conflict, the agent must identify which source is authoritative rather than picking whichever it read first. For Node version requirements, `package.json` `engines` is always canonical - it's what npm enforces, what CI reads, and what downstream consumers see.

**Prevention:** When version requirements conflict across files, check `package.json` first. It's the published contract. Scripts and docs are derived from it, not the other way around.

---

---

## Lesson: Structural audit pass does not mean the project is correct

**Created:** 2026-03-31

**What happened:** goat-flow historically scored 100% on its own scanner system (removed per ADR-013) while `preflight-checks.sh` failed with 8 errors. The scanner checked structural presence (files exist, have right headings). Preflight checked functional correctness (commands work, paths resolve, versions match).

**Prevention:** Don't treat a structural audit/check pass as a quality gate for the whole project. Use structural checks for what they cover and preflight/targeted verification for functional correctness. When they disagree, investigate.

---

## Lesson: Single-source-of-truth claims need a cold-path review pass

**Created:** 2026-04-18

**What happened:** M12 moved agent support metadata into `workflow/manifest.json`, but a follow-up code review still found residual parallel authority surfaces: Codex was given a fictional `post_turn: "Stop"` event in the manifest, the dashboard frontend narrowed injected agent ids back to `claude | codex | gemini`, and `.goat-flow/config.yaml` unknown `agents:` ids only produced warnings so audit status stayed green.

**Prevention:** When claiming "single writable authority", run a cold-path pass that searches for hardcoded enums, literal allowlists, and docs/templates restating the same contract. The migration is not complete until manifest, installer, config validation, audit failures, and frontend payload readers all agree on the same authority.

---

## Lesson: Sanitizing shell variable capture breaks `set -u` when variable is scoped inside a conditional

**Created:** 2026-04-21

**What happened:** `preflight-checks.sh` had a flaky test: `node --input-type=module` commands occasionally emitted stray diagnostic output containing `[` characters, which `grep` interpreted as regex, producing `grep: Unmatched [` errors. The fix added `| grep -oE '^[0-9]+$' | tail -1` to strip non-numeric output and switched to `grep -Fq` for fixed-string matching. But the sanitization pipeline returned empty when the node command failed in the temp fixture (no working `dist/`), causing `build_count=""`. The outer `if [[ -n "$build_count" ]]` correctly skipped the architecture checks - but `setup_count` was only assigned inside that `if` block. A downstream `if [[ -n "$setup_count" ]]` outside the block hit `set -u` (`unbound variable`) and crashed the script.

**Root cause:** Variable scoping assumption. `setup_count` was set on a line that only executes when `build_count` is non-empty, but was referenced unconditionally later. The original code never triggered this because without sanitization the node command always produced *some* stdout (even if it included garbage), so `build_count` was never empty - it was just wrong. The sanitization made the empty case reachable for the first time.

**Prevention:** When adding a filter that can turn non-empty output into empty output, trace every downstream reference to the captured variable. In `set -u` scripts, any variable set inside a conditional must either be initialized before the conditional or only referenced inside the same branch.

---

## Lesson: Line-number evidence in footguns/lessons creates silent maintenance debt

**Created:** 2026-04-24

**What happened:** Three independent Gemini quality reports in one session flagged stale `file:line` references across footgun entries. `hooks.md` cited old guardrail lines for the read-only whitelist that had moved, and `skills.md` cited `skill-preamble.md` lines for the Step 0 budget that had also moved. Nine active line references across 3 footgun files had drifted. The framework's README and CLAUDE.md already said "line numbers are advisory" but evaluation templates said "RECOMMENDED," so agents kept using them.

**Root cause:** Line numbers shift on every edit to the target file. Unlike stale file paths (which `stats --check` catches), stale line numbers point at valid-but-wrong code and pass all mechanical checks. The guidance was contradictory: README discouraged them while the evaluation template encouraged them.

**Prevention:** Use grep-friendly semantic anchors (`(search: "pattern")`, function names, section headings) instead of line numbers. Per ADR-024, line numbers are now discouraged in evaluation templates and instruction files. `stats --check` validates `(search: ...)` anchors against actual file content, giving mechanical enforcement that line numbers never had.

---

## Lesson: Remove redundant local references after promoting shared doctrine

**Created:** 2026-04-27

**What happened:** M12 promoted browser-use guidance into the canonical shared playbook `.goat-flow/skill-playbooks/browser-use.md`, but the first implementation kept four per-skill browser-use compatibility files under goat-debug reference directories. The user pointed out that once the shared playbook exists, those skill-local copies duplicate doctrine and create another drift surface.

**Root cause:** The agent preserved a backward-compatibility shape from the starting point without proving that any installed project still needed the per-skill file. That weakened the shared-reference migration: one canonical reference existed, but stale compatibility files could keep attracting edits or references.

**Prevention:** When moving guidance into `.goat-flow/skill-reference/`, grep every old path, remove redundant local copies unless there is an explicit compatibility requirement, and update manifest/install references in the same pass. Compatibility copies are a conscious exception, not the default cleanup state.

---

## Lesson: Verify agent capabilities against official docs, not assumptions

**Status:** active | **Created:** 2026-04-15 | **Merged during:** M11 learning-loop consolidation

**What happened:** Codex was assumed to have no PreToolUse hook support, so its profile left the hook field empty and a parallel Starlark execpolicy workaround was built. Later doc/runtime checks showed Codex did support hooks, making copied guardrail scripts dead code until registration was fixed.

**Root cause:** A stale platform assumption propagated through templates, install scripts, fact extraction, and setup guides without being re-checked against primary docs or the local binary.

**Prevention:** When a profile field says an agent "can't" do something, verify against current product docs and runtime evidence before building workarounds. For Codex permission grammar, current evidence anchors are `workflow/hooks/agent-config/codex.toml` (search: `hooks = true`), `.codex/hooks/guard-secret-paths.sh` (search: `is_secret_path_touch`), and `src/cli/facts/agent/settings.ts` (search: `collectCodexWorkspaceRootEntries`).

---

## Lesson: Sub-agent delegation is universal across goat-flow's four supported agents

**Status:** active | **Created:** 2026-04-20 | **Merged during:** M11 learning-loop consolidation

**What happened:** Quality reports proposed a pre-check before routing to `/goat-critique`, assuming delegation might be unavailable. The user corrected the premise: Claude Code, Codex, Antigravity, and Copilot all ship sub-agent / delegated-agent capability, so the pre-check would be dead ceremony.

**Root cause:** Reviewers reasoned abstractly about platform variance instead of grounding the finding against goat-flow's actual supported-agent list.

**Prevention:** Before accepting a finding that adds a capability pre-check, verify the capability against the four supported agents. If all four ship it, retract the finding. Applies to delegation, hook support, MCP, slash commands, and other historically partial capabilities.

---

## Lesson: End-of-task rules must be treated as deliverables

**Status:** active | **Created:** 2026-04-08 | **Merged during:** M11 learning-loop consolidation

**What happened:** Multiple incidents shared the same shape: the agent skipped an AI testing gate after completing milestone tasks, treated an AI gate's "14/14 checks passed" as proof that real-world setup worked, skipped session/learning-loop closure steps, or offered to commit after completing work.

**Root cause:** Closing rules fire after the primary work feels done, so the agent's attention shifts to reporting instead of executing the remaining gate.

**Prevention:** Make closing gates part of the deliverable, not an optional afterword. After completing milestone tasks, run the named testing gate before summary. Report what was done and stop; do not offer commits, pushes, PRs, or follow-on git writes unless the user asked.

---

## Lesson: Fresh-eyes critique reruns need section-only evidence after a leak-scan discard

**Status:** active | **Created:** 2026-04-24 | **Merged during:** M11 learning-loop consolidation

**What happened:** During a full `goat-critique` run, a fresh-eyes sub-agent stayed within the artifact but returned evidence links that echoed the artifact's `.goat-flow/...` path. Phase 2's leak scan treats that path text as context leak, so the output had to be discarded and rerun.

**Root cause:** The isolation rule is enforced over output text, not just over what the sub-agent actually read. A clean analysis can still fail if its citation format contains repository-local paths.

**Prevention:** When rerunning a fresh-eyes critique after leak-scan discard, instruct the sub-agent to cite section titles or neutral labels only. Do not include repository-local paths in the output unless the phase explicitly permits them.

---
