---
category: agent-behavior
last_reviewed: 2026-08-18
---

**Scope:** Reading the request and retrieving memory - parsing what was asked, honouring an explicit next step, retrieval terms that name the real failure class, and treating end-of-task rules as deliverables. Using tools and the environment is [agent-tooling.md](agent-tooling.md); what an explicit skill invocation obliges is [skill-invocation.md](skill-invocation.md).

## Lesson: Agent proposed disabling gruff-ts rules to silence high-volume advisory findings

**Created:** 2026-05-25

**What happened:** User ran `npx gruff-ts summary` in `/home/devgoat/projects/goat-flow` and asked the agent to "deeply analyse these findings and tell me what you agree that should be fixed." The summary reported 1643 findings (0 error, 276 warning, 1367 advisory) and Score 12.9 (F). The agent produced three tiers - Tier 1 "Fix these", Tier 2 "Investigate", Tier 3 "Tune the config, don't fix" - and recommended `enabled: false` in `.gruff-ts.yaml` for nine rules (`docs.missing-function-doc`, `naming.boolean-prefix`, `naming.short-variable`, `test-quality.setup-bloat`, `naming.identifier-quality`, `test-quality.loop-in-test`, `test-quality.magic-number-assertion`, `docs.missing-interface-doc`, and the test-file majority of `modernisation.non-null-assertion`), framing it as resolving a conflict between gruff-ts rules and CLAUDE.md's "default to no comments" stance. The user replied in caps: *"DONT SET ANYTHING TO ENABLED FALSE!!"*

**Root cause:** The agent treated high-volume advisory findings as configuration noise to mute rather than signal to act on or threshold-tune. The framing "the rule fights your stated philosophy" used a real project norm (CLAUDE.md "default to no comments") to justify silencing a tool, but a tool-vs-norm conflict is resolved by satisfying the rule selectively, tuning via threshold/allowlist/path-filter, or accepting the noise while triaging - never by disabling. It also misread the score: F (12.9) with 0 errors is no emergency, and disabling rules raises the score without changing the codebase - exactly the gaming the analyser is designed to prevent.

**Why it matters:** Disabling a rule erases its signal permanently: a future agent running `gruff-ts summary` sees fewer findings and concludes the codebase is clean in that dimension when the rule was silenced. Worse, the user committed to the gruff-ts rule set as the project's quality vocabulary - disablement weakens that contract. The cost is one-directional: a wrongly-disabled rule stays disabled until noticed, while a wrongly-noisy rule prompts a conversation about thresholds.

**Prevention:**

1. **Never propose `enabled: false` for any gruff-ts rule in `.gruff-ts.yaml`**, regardless of finding volume, severity, or apparent conflict with project norms. Hard rule.
2. **Group findings as Fix / Investigate / Tune - never as Disable.** "Tune" means options the rule exposes: `threshold`, allowlists (`acceptedAbbreviations`, `booleanPrefixes`, `placeholderNames`, etc.), or `paths.ignore` for off-target subtrees. The rule stays on.
3. **When a rule conflicts with a project norm, satisfy the rule anyway.** If `docs.missing-function-doc` flags 268 functions and CLAUDE.md says "default to no comments", add the docs (or raise the norm in an ADR) - don't silence the rule.
4. **Treat the rule set as fixed; the codebase changes.** The analyser's controlled vocabulary is the contract. Help the codebase satisfy it, don't renegotiate by attrition.
5. **Read score in order: errors > warnings > advisory.** A 0-error report with thousands of advisories is a triage queue, not a quality emergency. F-on-a-letter-grade misleads when severity-0 is empty.

Related: `feedback_gruff_never_disable` (auto-memory, 2026-05-25).

---

## Lesson: Agent parsed "use X to find Y" as "audit X for Y" when X was a CLI tool

**Created:** 2026-05-20

**What happened:** User in cwd `/home/devgoat/projects/goat-flow` asked to use `/home/devgoat/projects/gruff-workspace/gruff-ts` to find low-quality tests. The agent treated that path as the target repo, audited `gruff-workspace/gruff-ts/src/cli.test.ts`, and drafted fixes for gruff-ts itself. The user meant to invoke gruff-ts as a CLI against goat-flow tests. The agent missed the second chance to recover when the user clarified the milestone should live in goat-flow.

**Root cause:** The request shape was "use X to scan Y", but the agent never classified X as TOOL or TARGET. Missed signals: gruff-ts has a `package.json` `bin` entry and analyzer README language; the cwd was a different project; the follow-up question asked only where to put the milestone instead of whether gruff-ts was tool or target.

**Why it matters:** The whole plan targeted the wrong repository. Self-critique improved the document form but could not repair the premise, which cost multiple rounds and destroyed trust.

**Prevention:**

1. Classify every named path/project as TOOL or TARGET before work. TOOL signals: `bin`, executable wrapper, README words like CLI/analyzer/linter/tool/checker, or path outside cwd. TARGET signals: current repo/subpath, modify/review/refactor verbs, no executable surface. Ask when both fit.
2. Parse "use X to find/check/analyze/scan Y" as "invoke X against Y" when X is tool-shaped. "Audit X" / "review X" / "find issues in X" target X.
3. Treat cwd as load-bearing: a path outside cwd is tool/reference by default unless the user explicitly switches target.
4. Ask semantic questions first: "Is X the tool or the target?" before file-location questions.
5. Re-read the original request when the user clarifies mid-task; compatible clarification is not ratification.
6. Before polishing or self-critiquing a plan, sanity-check that its target repo still matches the user's wording.

---

## Lesson: Agent ignored explicit "next step" command in pasted output

**Created:** 2026-05-01

**What happened:** User pasted goat-flow setup output with a clearly labeled "Next step (recommended): Run `goat-flow audit . --harness`" section. The agent read it, confirmed the dashboard was fixed, and reported success - without running the command. The user had to ask "did you run this?" before the agent executed it. The command was the first end-to-end verification that the harness concern removal worked.

**Root cause:** The agent treated the pasted output as informational context, not an implicit instruction. It confirmed the text looked correct ("5 concerns, no Boundary") but never ran the verification step the output prescribed - a verification gap: claiming success from reading text rather than running the command that proves it.

**Why it matters:** "Next step (recommended)" in CLI output exists because the preceding command cannot fully verify the system on its own; skipping it declared victory on a structural change (removing a harness concern) without end-to-end proof. The user caught it.

**Prevention:** When pasted output contains a "next step", "recommended", or "run this" command, treat it as an implicit instruction and run it immediately - especially after structural changes where it is the verification gate. Reading output is not running it.

---

## Lesson: Commit subjects paraphrased the diff with weak verbs

**Created:** 2026-04-29

**What happened:** Audit of the last 10 commit messages on `dev` (HEAD `0366419`..`82db04b`, 2026-04-25..2026-04-29) showed 7 of 10 subjects led with *enhance, improve, streamline,* or *clarify* and carried no body. Examples included vague guardrail and docs refactor subjects such as "enhance command checks" and back-to-back "enhance clarity" messages on different content. Read in isolation - without the diff - they told a future bisector or release-notes drafter nothing about what changed.

**Root cause:** The agent generated commit subjects by paraphrasing the diff in abstract verbs ("the change makes X better") instead of naming the concrete edit ("replace shell-specific build steps with Node fs calls"). The prior commit-guidance doc listed format rules and a "what not to commit" list but did not name the failure mode or show a bad-vs-good rewrite, so the rules were easy to satisfy on paper while still emitting low-information subjects. One outlier (`4e0ec5d fix(dashboard): speed up home audit load on Windows`) carried a concrete subject + bulleted body and stood out as the gold standard.

**Why it matters:** Commit messages are what a future maintainer reads in `git log`, `git bisect`, or a CHANGELOG pass. Subjects built from *enhance/improve/streamline/clarify* force readers to open the diff, and back-to-back synonym churn is the tell that the agent reworded instead of described.

**Prevention:** `docs/coding-standards/git-commit-message.md` - the preferred commit guide, summarised in the auto-read instruction files under `## Commit Messages` - bans the weak-verb list, prescribes concrete verbs, requires a body for multi-axis or non-obvious subjects, and shows bad→good rewrites from the actual recent log. The gold-standard `4e0ec5d` body is the inline body template (search: "speed up home audit load on Windows" in `docs/coding-standards/git-commit-message.md`).

## Lesson: Retrieval terms must name the concrete failure class

**Created:** 2026-04-18

**What happened:** During the M10 retrieval proof, the plan-oriented query `support matrix|agent matrix|registry canonicality` returned zero learning-loop hits for M12 work even though the relevant trap already existed in `.goat-flow/learning-loop/footguns/hooks.md`. Rewording to the concrete platform limitation - `Codex has no compaction notification hook` - found the entry immediately.

**Root cause:** The first query mirrored the milestone title instead of the language used by the stored incident. Learning-loop buckets are written around concrete symptoms, platform limits, and file/tool names; abstract planning vocabulary is too detached.

**Why this matters:** Search-first retrieval only works if the first query overlaps with recorded evidence. Weak cues do not just miss a result; they create false confidence that "nothing relevant exists" unless the protocol forces a reword or explicit miss.

**Prevention:** Build the first retrieval query from target area + symptom + named file/tool, not from milestone names or architecture abstractions. If the first pass is abstract, reword toward the concrete failure class before concluding a miss.

**Updated 2026-05-27:** The same failure class applies to learning-loop retrieval generally: roadmap phrases such as "support matrix" and "registry canonicality" miss entries because buckets store concrete incident language. Use the concrete symptom, platform, or file/tool name first, reword once, then record a miss instead of broad-loading the bucket.

## Lesson: Recurring terminal bugs must start with learning-loop retrieval

**Status:** active | **Created:** 2026-05-28

**What happened:** While fixing the dashboard Workspace terminal bug where Claude Code received a large Quality prompt as `[Pasted text #N +... lines]` but did not auto-submit, multiple agents worked the browser terminal timing path before treating the learning loop as the first evidence source. The relevant dashboard footgun already documented earlier Claude pasted-text failures, marker timing, manual-Enter recovery, and the live-runner-proof requirement. The user had to call out that agents were re-solving a known problem without checking the existing entries.

**Root cause:** The agents treated the visible symptom as a fresh implementation problem, not a recurrence in a known-risk area. That bypassed the required grep-first memory check, so prior evidence in `.goat-flow/learning-loop/footguns/dashboard.md` and `.goat-flow/learning-loop/lessons/verification-testing.md` did not shape the first hypothesis set.

**Why it matters:** Terminal automation failures are expensive because fake timers, xterm output, WebSocket frames, and runner composer behavior can all appear plausible. Skipping the learning loop repeats old failed fix shapes, wastes live reproduction time, and erodes trust since the repo already recorded the exact family of incidents.

**Prevention:** For any dashboard terminal, runner prompt, pasted-text, WebSocket, xterm, or auto-submit bug, run learning-loop retrieval before proposing or editing code. Use concrete symptom terms first: `Pasted text`, `paste again to expand`, `manual Enter`, `dashboardHandlePasteSubmitOutput`, `Workspace terminal`, `Claude Code`, and the affected runner. If a matching footgun exists, map every hypothesis to it before changing `src/dashboard/dashboard-terminal.ts`; if none after one reword, state the miss. Anchors: `.goat-flow/learning-loop/footguns/dashboard-terminal.md` (search: `Dashboard terminal prompts can be dropped before browser attachment`), `.goat-flow/learning-loop/lessons/browser-evidence.md` (search: `Browser terminal fixes need live runner proof`), `src/dashboard/dashboard-terminal-paste.ts` (search: `dashboardHandlePasteSubmitOutput`), and `test/unit/dashboard-terminal-launch/launch-flow-01.test.ts` (search: `falls back quickly for Claude pasted terminal text when no paste echo arrives`).

## Lesson: Step 0 retrieval was advisory; required emission makes the skip visible

**Status:** active | **Created:** 2026-06-10

**What happened:** Agents skipped the learning loop and re-tripped on documented traps. Old doctrine required retrieval but no visible Step 0 output, so a skip stayed silent until the user noticed.

**Evidence:** `.goat-flow/learning-loop/lessons/agent-behavior.md` (search: "Retrieval terms must name the concrete failure class"; "Recurring terminal bugs must start with learning-loop retrieval"); `.goat-flow/skill-docs/skill-preamble.md` (search: "Relevant prior learnings:").

**Prevention:** `skill-preamble.md` now requires every functional goat-* skill Step 0 to emit `Relevant prior learnings:`; misses include `Terms searched:`. `test/contract/skill-hardening-contracts.test.ts` pins both preamble copies, and `test/contract/skill-hardening-clarity.test.ts` (search: `runs visible learning-loop retrieval before freezing write authority`) closes the goat-clarity omission. Local TDD receipt filename: `2026-08-18-goat-clarity-tdd.md`.

## Lesson: Quality assessors can reopen ADR-settled skill modes

**Status:** active | **Created:** 2026-05-27

**What happened:** Quality assessment agents recommended "quick critique mode" or "allow lightweight critique for smaller artifacts" as a Top 5 improvement. That would have reintroduced the exact failure ADR-021 records: single-context self-talk disguised as multi-perspective critique.

**Root cause:** The assessors saw `goat-critique` spawns three sub-agents per invocation and pattern-matched the cost as over-engineering without reading history.

**Prevention:** Before accepting a quality recommendation that changes a skill mode, read the relevant ADR and prompt constraints first. If it contradicts an accepted ADR, fix the assessor prompt or cite the ADR; don't re-litigate the mode inside the skill file. Anchors: `.goat-flow/learning-loop/decisions/ADR-021-goat-critique-full-mode-only.md` (search: `goat-critique runs in one mode: full delegated`) and `src/cli/prompt/compose-quality-static-sections.ts` (search: `Do NOT recommend adding quick/lite/reduced modes`).

---

## Lesson: End-of-task rules must be treated as deliverables

**Status:** active | **Created:** 2026-04-08 | **Merged during:** M11 learning-loop consolidation

**What happened:** Multiple incidents shared the same shape: the agent skipped an AI testing gate after completing milestone tasks, treated an AI gate's "14/14 checks passed" as proof real-world setup worked, skipped session/learning-loop closure steps, or offered to commit after completing work. On 2026-08-01, M03 was promoted before strict validation caught a human proof row with no estimate, then an estimate outside the declared split.

**Root cause:** Closing rules fire after the primary work feels done, so attention shifts to reporting instead of executing the gate.

**Recurrence update 2026-05-30:** After completing the deny-dangerous hook consolidation, the user asked "whats next". The agent responded with `git add` / `git commit` sequences and a PR follow-up path, even though the user had not asked to commit, stage, push, or open a PR. No commit was executed, but the answer still steered the user into a write workflow as the default next action. The current rule is stronger and unambiguous: `AGENTS.md` (search: `Coding agents never run`) reserves commits and pushes for the user.

**Recurrence update 2026-08-09:** M00 automated proof passed, but its final compatibility row combined `[automated, HUMAN-PENDING: ...]` metadata and remained unchecked. Strict plan validation correctly rejected the row as executor-owned because human ownership requires a leading `[human]` marker. The correction closed the automated row and added a separate open `[human]` native-runtime row before presenting the gate.

**Prevention:** Make closing gates part of the deliverable, not an optional afterword. Separate executor and human proof into distinct rows: close automated evidence before promotion and mark each remaining human-owned row with leading `[human]`. After completing milestone tasks, run the named testing gate and strict plan validation before lifecycle promotion. Report what was done and stop; do not make commits, pushes, PRs, staging commands, or follow-on Git write workflows the default next action. Coding agents never run `git commit` or `git push`, even when asked; hand those operations back to the user. If asked "what's next" after verified work, default to non-mutating options: review the diff, inspect a file, or wait for the requested handoff. Providing a suggested commit message is allowed only when asked for one.

---

## Lesson: Fresh-eyes critique reruns need section-only evidence after a leak-scan discard

**Status:** active | **Created:** 2026-04-24 | **Merged during:** M11 learning-loop consolidation

**What happened:** During a full `goat-critique` run, a fresh-eyes sub-agent stayed within the artifact but returned evidence links echoing the artifact's `.goat-flow/...` path. Phase 2's leak scan treats that path text as context leak, so the output was discarded and rerun.

**Root cause:** The isolation rule is enforced over output text, not just what the sub-agent read. A clean analysis can still fail if its citation format contains repository-local paths.

**Prevention:** When rerunning a fresh-eyes critique after leak-scan discard, instruct the sub-agent to cite section titles or neutral labels only. Do not include repository-local paths in the output unless the phase permits them.

**Recurrence update (2026-07-12):** M33's first structural leak matcher treated the generic noun `tests` as repository navigation and nearly discarded a clean Fresh Eyes result. The orchestrator reran a path/config/anchor-only scan and kept the agent output. Leak scans must match traceable navigation tokens, not ordinary review vocabulary.

---
