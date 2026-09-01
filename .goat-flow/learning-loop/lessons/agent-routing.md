---
category: agent-routing
last_reviewed: 2026-08-06
---

**Scope:** Turning a request into the right action - distinguishing context from approval, writing a plan versus executing it, holding a position under contradiction, and not inflating a clear request. What an explicit skill invocation obliges is [skill-invocation.md](skill-invocation.md); tool and environment habits are [agent-tooling.md](agent-tooling.md).

## Lesson: Bare task paths are context, not implementation approval

**Created:** 2026-05-01

**Prevention:** Treat a bare or ambiguous task path as read-only context. Respond first with an orientation summary plus a next-action question. `.active` changes, milestone status changes, task checkboxes, and code edits require explicit verbs such as "start", "implement", "resume", "update", or "write". Evidence anchors: `workflow/skills/goat-plan/SKILL.md` (search: `Path-only guard runs first`), `workflow/skills/goat/SKILL.md` (search: `Bare or ambiguous task paths are read-only context`), `test/contract/skill-hardening-plan-1.test.ts` (search: `path-only task intake`).

**What happened:** A user sent only a bare gitignored task directory path. Codex treated the path as permission to resume goat-plan work, changed the active-plan marker, marked task files in progress, and started code implementation. The user had not asked to implement, resume, edit, update, or start a milestone.

**Root cause:** The agent combined the generic "assume implementation" coding default with goat-plan's existing milestone discovery and skipped the blocking gate. The skill also treated named existing plan files as write approval too broadly, so a context path could be misread as a target.

---

## Lesson: Version bumps require explicit confirmation

**Created:** 2026-03-29

**Prevention:** Treat version changes as a separate decision from rubric or content changes. Do not bump package, rubric, or template versions unless the user explicitly requests the new version or the release plan says to do it.

**What happened:** While cleaning up zero-point rubric checks, the agent also bumped `package.json`, `RUBRIC_VERSION`, and skill frontmatter above the current `0.8.0` line. The user had not asked for a release/version bump and corrected it immediately.

---

## Lesson: "Update the plan" means write the plan, not execute it
**Created:** 2026-04-04

**Prevention:** Listen for the verb. "update the plan", "create M31", "write a plan" = write markdown only. "execute", "implement", "do it", "fix it" = make code changes. If the verb is absent or ambiguous, write the plan and ask whether to execute it. Never auto-execute a plan the user just asked you to write.

**What happened:** User asked to "create M31 plan" and then later to "update this plan" with a detailed design spec. The agent wrote the plan file, then immediately launched a sub-agent to rewrite `index.html` - implementing the plan without being asked. User had to interrupt and correct: "dont change anything. just update this plan."

**Why it matters:** The user controls when code changes happen. Writing a plan and executing a plan are two completely separate actions. The user may want to review, share with others, or revise before any code is touched.

---

## Lesson: Don't overcomplicate clear requests - a spec is not ambiguous

**Created:** 2026-04-14

**Incident count:** 2

**Latest occurrence:** 2026-08-06

**Prevention:**
1. When the user gives a clear spec, implement it literally. Don't add scope. Don't reinterpret.
2. A detailed mockup IS the plan. Don't enter plan mode when the user already told you what to build.
3. If you're unsure what the user wants, ask one question. Don't guess across multiple turns.
4. Never edit files in plan mode (except the plan file).
5. Apply numeric limits to the named unit. "Each bullet at most 150 characters" means the complete bullet, on one line unless wrapping is explicitly requested.

**What happened:** User asked to list all audit checks in config.yaml. Simple task. Instead of writing it once correctly, the agent: (1) added preflight checks the user never asked for, (2) used wrong section names that didn't match the dashboard, (3) put it in config.yaml as comments, (4) tried to move it into an existing doc instead of the requested new file, (5) entered plan mode for a follow-up dashboard task where the user had already given the exact spec, (6) wrote a memory file while still in plan mode. A task that should have been one turn took 5-10 turns and multiple corrections.

On 2026-08-06, the user asked for each changelog bullet to be at most 150 characters. The agent wrapped unchanged text across multiple lines, satisfying a physical-line check while missing the requested reading limit.

**Root cause:** The agent treated a clear directive as ambiguous. The user said "add all the checks" - the agent added checks the user didn't ask for (preflight). The user pasted an exact 3-section dashboard mockup - the agent entered plan mode instead of implementing. Each time the user corrected, the agent made a different wrong assumption instead of asking or doing exactly what was said. In the changelog incident, it treated a semantic-unit limit (each bullet) as a physical-line limit.

---

## Lesson: Agreeing with contradictory statements instead of holding a position

**Created:** 2026-04-14

**Prevention:** When the user corrects you, understand what they're actually saying before reversing. If you already had the right answer, don't abandon it just because the user pushed back on a different claim. Ask for clarification instead of reflexively agreeing.

**What happened:** User said preflight-checks.sh shouldn't validate goat-flow audit checks. Agent agreed and suggested moving them to the CLI audit. User said they don't belong in the CLI either. Agent immediately reversed and agreed they belong in preflight after all - contradicting what it said 1 message earlier. The agent had no position; it just agreed with whatever the user last said.

**Why this matters:** The user was making a specific point: preflight is a repo-level dev script (shellcheck, TypeScript, tests, formatting). The goat-flow-specific checks in preflight (doc/code drift, dashboard concern sync, architecture counts, skill version matching) are internal consistency checks for the goat-flow repo - they validate that the framework's own docs match its own code. That IS a preflight concern because preflight gates commits to this repo. The CLI audit validates consumer project installs - completely different scope. Both statements were correct but the agent couldn't hold both in its head.

**The correct answer was:** Preflight is the right place for goat-flow repo internal consistency checks. The CLI audit is the right place for consumer project validation. These are different scopes serving different users. The user's point was that the CLI shouldn't contain repo-internal checks - not that preflight was wrong to have them.

---

## Lesson: Quality findings must respect local-state and reporting-only contracts

**Created:** 2026-04-22

**Prevention:** Before reporting findings about `.goat-flow/plans/`, `.goat-flow/logs/`, scratchpad files, or other gitignored state, classify the artifact as committed knowledge vs local session state. For local state, review behavior and fallback handling, not existence alone. In goat-flow quality reviews, "read-only", "reporting-only", "no-write", and "no implementation" mean no committed-file changes and no implementation; gitignored logs, scratchpad notes, critique snapshots, quality reports, and task-local state do not count as writes.

**What happened:** During a quality follow-up, the agent treated the active-plan marker pointing at a missing subdir as a MAJOR setup defect. The user corrected that the active marker is local working state: its target can disappear when a project completes, can change multiple times a day as users switch projects, or can be irrelevant when the user is only using goat-flow for bug work. The same review treated `/goat-critique` writing gitignored critique logs as a read-only violation. The user corrected the contract: read-only/reporting work means no committed-file changes and no implementation, not "never write gitignored continuity logs or task checkboxes."

**Recurrence 2026-07-17:** `.goat-flow/skill-docs/skill-preamble.md` (search: `If stale, emit`) required `goat-flow index` whenever an index was stale, even during reporting-only work; `generateIndexes` writes tracked `INDEX.md` files. The preamble now defers regeneration in reporting-only/read-only/no-write/no-implementation modes, guarded by `test/contract/skill-hardening-shared-1.test.ts` (search: `defers stale-index regeneration when committed writes are forbidden`).

**Root cause:** The agent applied generic quality-report assumptions without first checking goat-flow's persistence tiers and local-state semantics. It judged stale local pointers and gitignored continuity writes as setup defects instead of asking whether the skill handles them gracefully and whether committed state changes.

---

## Lesson: "Add a footgun" means a documentation entry, not runtime code

**Created:** 2026-04-25

**Prevention:** When the user says "add a footgun," open `.goat-flow/learning-loop/footguns/README.md` and create/update a bucket entry. Do not write runtime code unless the user separately asks for a code change. The Artifact Routing section in instruction files and skill-preamble.md now explicitly maps user requests to target directories.

**What happened:** In a consumer project, the user asked to "add a footgun" documenting a Mercure CORS trap. The agent interpreted this as a request for runtime diagnostic code and added TypeScript console logging to `assets/entrypoints/chat-assistant.ts`. The user had to correct the agent, the code change was reverted, and the correct Mercure footgun entry was created in that project's goat-flow docs.

**Root cause:** The agent did not know that "footgun" in a goat-flow project means a documentation artifact under `.goat-flow/learning-loop/footguns/`. It defaulted to the general-English meaning ("something that will hurt you") and implemented a runtime warning. The routing was not documented prominently enough - the learning-loop section described what footguns ARE, but not what to do when the user says "add one."

**Why it matters:** The user had to intervene twice (once to stop the code change, once to redirect to the correct directory). The mistake class is dangerous because it produces a plausible-looking deliverable (runtime logging IS useful) that is completely wrong in context (the user wanted a knowledge-base entry, not code).

- Evidence: `.goat-flow/learning-loop/footguns/README.md` (search: `Traps in the code itself`) defines footguns as documentation artifacts
- Evidence: `.goat-flow/learning-loop/lessons/README.md` (search: `Mistakes the agent made`) defines lessons as documentation artifacts
- Evidence: Artifact Routing section now added to all four instruction files (CLAUDE.md, AGENTS.md, GEMINI.md, `.github/copilot-instructions.md`)

---

## Lesson: Respect punctuation preferences immediately

**Created:** 2026-04-26

**Prevention:** When the user states a formatting or punctuation preference, apply it immediately and consistently within the requested scope. Prefer ASCII hyphens over em dashes in generated or edited prose unless the user explicitly asks for typographic punctuation.

**What happened:** The agent restored em dashes in several text files while cleaning up verification side effects, even though the user's preference is to use plain hyphens instead. The user had to interrupt and explicitly say they hate em dashes and want them changed to `-`.

**Root cause:** The agent treated punctuation restoration as preserving prior file style instead of recognizing a strong user preference. The local editing default already favors ASCII unless there is a clear reason otherwise, but the agent allowed existing prose punctuation to override the user's preference.
