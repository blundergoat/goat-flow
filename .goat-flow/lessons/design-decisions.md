---
category: design-decisions
last_reviewed: 2026-05-22
---

## Lesson: Doer-verifier is theater in single-agent context

**Created:** 2026-04-03

When the same agent writes code and then "independently verifies" it, the verification is fake. The agent has full context of its own reasoning and will rationalize its own decisions.

Real verification requires a context boundary: a different agent, a fresh invocation, or a human. The natural doer-verifier split in goat-flow is between skill invocations (implement in /goat-debug, verify in /goat-review), not within one skill.

**Trigger:** Any proposal to add self-verification phases within a single skill invocation. The value is in the skill handoff, not in asking the same agent to re-read its own diff.

**Decision:** ADR-005. Don't add goat-doer/goat-verifier. Use existing skills (/goat-review, /goat-qa) as the verification layer.

---

## Lesson: Agent critiques are input, not a spec - validate before implementing

**Created:** 2026-04-03

5 Codex critiques across 5 projects generated 589 pending tasks. That's a rewrite, not an improvement. The critiques are optimized for "what annoyed me in one session" not "what improves outcomes over time."

Risks of blindly implementing critique feedback:
- Removing safety nets (BLOCKING GATEs) that feel like ceremony but prevent mistakes for less experienced users
- Over-correcting on signal from one context (Codex doing setup, single-session perspective)
- No outcome data - nobody measured whether projects WITH the gates produce better code than projects WITHOUT
- 589 tasks shipped at once guarantees breaking things we don't understand yet

**Pattern:** Ship UI/dashboard changes (low risk) separately from framework/skill changes (high risk). Validate each framework change on one real project before applying to templates. Keep a "before" snapshot and diff after each milestone.

**Trigger:** Any batch of changes driven by external critique. Test one change at a time against real outcomes, not against the critic's score.

---

## Lesson: Milestone planning needs cold-start detail and natural scope boundaries

**Created:** 2026-04-13

**What happened:** A 7-agent critique of goat-flow v1.1.0 produced ~35 verified findings. The initial milestone (M25) combined all of them - doc fixes, code bugs, dashboard cleanup, Copilot removal, and scanner system removal - into one file. It took 3 rounds of expansion and eventually split into 3 milestones (M25 docs, M26 code, M27 scanner removal). The first drafts had task descriptions but no file:line references, no current content, no replacement text, and no verification commands. A fresh agent would have had to re-discover everything.

Five specific patterns emerged:

1. **Milestones that mix docs + code + structural changes are too large.** The natural fault line is: docs-only (safe, no dependencies) → code fixes (within existing architecture) → structural overhaul (rewrites). A 35-item milestone is System-scale. goat-plan's own complexity routing should catch this.

2. **"npm test passes" is not a verification step.** The most useful verification tasks are specific grep commands and bash test scripts that prove the intended change landed. Every task needs a verification command for the specific fix, not just a green build.

3. **No validator catches doc/code drift.** architecture.md had wrong counts for weeks. CONTRIBUTING.md pointed to the wrong subsystem. Dashboard docs listed wrong view names. The audit validates structural setup but not content truthfulness. Quality checks should validate numeric claims in architecture.md against code.

4. **Footgun/lesson entries should be written when the issue is introduced, not when a review catches it.** Five footguns and two lessons were missing at critique time. The VERIFY step's learning-loop gate needs a stronger trigger - if you changed something that could surprise a future reader, document it now.

5. **Milestone files need cold-start detail.** The bar is "can a fresh agent session execute this without re-discovering context?" That means: file:line references, current content quoted, replacement text specified, verification commands you can copy-paste, read-first file lists, execution order guidance.

**Prevention:**
- Split milestones at the docs/code/structural boundary during planning, not after the first draft is too big.
- Every task gets a verification command that proves the specific change, not just that the build passes.
- After any milestone that changes code, grep architecture.md and code-map.md for stale claims.
- Write footgun entries during the milestone that introduces the trap, not during the critique that discovers it.
- Test milestone files by asking "could I hand this to a different agent with no prior context?"

---

## Lesson: Summary dashboards should not expose internal harness shorthand first

**Created:** 2026-04-17

**What happened:** The Home AI Harness redesign surfaced concern rows as internal counter strings like `I 1/1 · A 2/2 · m 2` and paired them with hard `PASS` / `FAIL` labels. The data was technically correct, but the first-glance card experience became harder to read. A user looking for "which agent is healthiest?" or "what needs attention next?" had to first decode goat-flow internals: `I` = integrity, `A` = advisory, `m` = metric. User feedback preferred the earlier summary-first presentation with a grade, percentage, recommendation count, and simple per-concern bars.

**Root cause:** The UI was designed from the audit data model outward instead of from the user's decision flow inward. Internal taxonomy was treated as inherently useful because it was available and precise. That is the wrong default for a summary surface. Precision is not clarity when the user must learn the implementation vocabulary before they can understand the screen.

**Decision:** On summary surfaces such as the Home dashboard, lead with human-readable outcomes:

- overall grade / percentage
- recommendation count or "All checks passing"
- simple concern bars
- plain-language status like `Healthy` or `Needs work`

Keep internal audit taxonomy and counts in deeper diagnostic views, expanded sections, or raw audit outputs where users are already in investigation mode.

**Trigger:** Any dashboard or status view that starts showing implementation shorthand, internal counters, or type-system vocabulary before it answers the basic user question.

**Prevention:** If a label needs a glossary (`I`, `A`, `m`, "ack"), it probably does not belong in the first-glance card. Design summary UI from "what decision does the user need to make next?" and only then decide how much internal structure to expose.

---

## Lesson: Don't carve I/O side-effect exceptions into prompts that forbid I/O

**Created:** 2026-04-18

M13's first draft extended `goat-flow quality` by asking the agent to write a structured report to `.goat-flow/quality/history/<date>-<agent>.json` under a single-path READ-ONLY exception. The surrounding quality prompt contract already forbids tracked-file writes and treats attempts to edit tracked files or write outside allowed gitignored local-state paths as findings (`src/cli/prompt/compose-quality.ts` (search: `No tracked-file writes`) and `src/cli/prompt/compose-quality.ts` (search: `If any skill attempts to edit tracked files`)) - so the draft required the agent to perform the exact operation the surrounding prompt was designed to detect and report. `/goat-critique` full-mode critique caught this as the load-bearing architectural error across all three sub-agents.

**Why it happened:** When a spec adds a new feature that needs persistence, "just carve a narrow exception" feels minimal. But the carved exception is prompt-text-only - there is no mechanical sandbox on what path the agent actually writes to (path traversal was Agent A's framing). More importantly, the agent is now instructed to (a) check existing files to compute a same-day suffix, (b) write to a specific path, (c) avoid writing anywhere else. Agents are unreliable at directory listing + race-free numbering + path discipline; pushing that onto the prompt is the kind of brittleness the project's feedback-loop footguns already document.

**Evidence:** `src/cli/prompt/compose-quality.ts` (search: `No tracked-file writes`) vs the draft's §3 "Instruct the agent to write …" bullet.

**Decision:** Rebuilt M13 so the agent emits the JSON block inside its response only; any later CLI tooling that needs to capture the output owns extraction, path validation, suffix numbering, and schema validation outside the prompt contract. READ-ONLY clause preserved verbatim. (Historical note: the earlier redesign kept capture out of the initial prompt rewrite; M13 later ships `goat-flow quality capture --from-file <path>` as a CLI-owned post-response step, not as a prompt exception.)

**Trigger:** Any spec that adds a feature to a prompt whose contract forbids an operation that feature needs. The feature goes on the other side of the boundary - almost always the CLI.

**Prevention:** Before a plan proposes "carve a narrow exception to a contract the prompt enforces", test the inverse: "can the CLI do this instead, after the agent responds?" If yes, move the side effect. If the answer requires restructuring the command flow, do that restructuring - it is cheaper than carrying a prompt contradiction into production, where every future extender has to interpret the exception identically on first-try.

**2026-04-19 amendment - partially superseded:** `goat-flow quality capture` was removed in v1.2.0; the write returned to the prompt by design. The original reasoning held because the hypothetical write could have landed anywhere in the repo. The current contract pins the write to `.goat-flow/logs/quality/*.json` - a gitignored path - so the "committed-state pollution" concern does not apply. `src/cli/prompt/compose-quality.ts` (search: `No tracked-file writes`) still forbids tracked-file writes and allows only this single gitignored path. The general principle still holds for tracked-file writes; the specific ruling against the quality-report write is superseded.

## Lesson: Framework-shipped per-language reference packs don't scale
**Created:** 2026-05-02

The `ddt-layer/` directory shipped per-language static analysis instructions (php.md, typescript.md) as goat-flow reference packs that the installer copied into every target project. This was wrong at the design level: every project has different languages, linters, and static analysis preferences, and goat-flow can't ship reference files for an unbounded set of toolchains.

**Root cause:** Treating project-specific tool configuration as framework-level doctrine. The DDT layer concept (static checks before behavioural tests) is sound, but the implementation confused "what to check" (framework concern) with "how to check it in PHP/TypeScript/etc." (project concern).

**Decision:** Removed `ddt-layer/` entirely (ADR-027). goat-plan now says "language-appropriate static analysis" and lets the agent detect the toolchain from project structure. Projects that need specific instructions put them in their own instruction file.

**Prevention:** Before adding a reference pack to goat-flow, ask: "does this content vary by target project?" If yes, it belongs in the target project's configuration, not in the framework.

## Lesson: Three rounds of the same fix shape means rearchitect, not patch
**Created:** 2026-05-22

M00 (Workspace terminal waiting status) shipped the same fix shape three times before the user said "maybe we should just delete that status, it looks like its not possible to have it":

- Round 1: parser strips CUP/HVP and box-drawing; trust phrases added; `●` added to numbered-choices bullet class. Closed-loop tested against 5 captured fixtures, all passing.
- Round 2: live failure → traced to Claude's `●` idle-spinner frame falling through every classifier → extended `dashboardOutputLooksTransientStatusRedraw` with a lone-glyph branch.
- Round 3: Codex still flickered → traced to `◦` (U+25E6 WHITE BULLET) - a different glyph not in the round-2 class. Extended the class again, plus added braille range and circular variants.

Each round was a "real" fix grounded in browser-extension Claude's live console instrumentation, with passing tests on captured bytes. Yet the user kept seeing the bug because the chunk-level classifier was a hard gate on a non-enumerable input space - every future runner version invents new glyphs.

**Root cause:** The state machine made per-chunk classification authoritative. Any chunk not in the recognized set cleared the badge, so the heuristic had to perfectly enumerate every transient redraw pattern of every runner. That set is unbounded by design.

**Why it matters:** The first two rounds passed every test and looked like progress. The whack-a-mole shape was only visible if you stepped back and asked "why does this keep needing the same fix?" The fourth round (rearchitecture - make the merged tail the source of truth, treat unknown chunks as no-ops as long as the prompt is still visible) fixed it in one place and is structurally immune to new glyphs.

**Prevention:** When the same fix shape appears 3+ times in a session, treat it as a design smell, not a missing case. Stop and ask: "is the structure of the fix admitting an unbounded input space?" If yes, the next iteration must change the architecture, not extend the enumeration. State this hypothesis to the user before the third patch attempt so they can choose between "one more patch" and "rearchitect" instead of being surprised by a fourth round.

**Trigger:** Same-shape patch (extend a regex class, add a phrase to an allowlist, special-case another runner) appearing in two consecutive rounds of fix-and-retest on the same milestone.

**Update 2026-05-22 - the rearchitecture itself can be wrong too:** M00 went through TWO rearchitectures. Round 4 ("tail-driven state") and round 5 ("raw-bytes slice with OSC titles preserved") each looked like the right structural fix and shipped passing tests, but each failed live within a different runner's output pattern (R4 missed Codex's ANSI-heavy bodies, R5 missed Claude's spinner-cycle accumulation pushing the prompt out of any bounded tail). Both rearchitectures shared the same hidden assumption: that output bytes can be classified for "user moved on". Round 6 dropped that assumption entirely - clear only from input-side signals (`term.onData`, `sendToTerminalSession`, lifecycle). The deeper meta-lesson: even when you correctly identify "this is a design problem, not a missing case", the *first* design you reach for can still encode the same flawed assumption that was driving the patching. Before declaring a rearchitecture, name the assumption the previous fixes shared and verify the new design doesn't share it. For M00: shared assumption was "we can read 'moved on' from output"; round 6 was the first design that didn't depend on it. Pattern reference: `.goat-flow/patterns/architecture.md` (search: `Asymmetric trust - set state from output`).
