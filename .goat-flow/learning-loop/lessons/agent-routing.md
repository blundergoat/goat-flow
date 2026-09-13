---
category: agent-routing
last_reviewed: 2026-09-05
---

**Scope:** Turning a request into the right action - distinguishing context from approval, writing a plan versus executing it, holding a position under contradiction, and not inflating a clear request. What an explicit skill invocation obliges is [skill-invocation.md](skill-invocation.md); tool and environment habits are [agent-tooling.md](agent-tooling.md).

## Lesson: Bare task paths are context, not implementation approval

**Status:** active | **Created:** 2026-05-01

**Prevention:** Treat a bare or ambiguous task path as read-only context, and respond with an orientation summary plus a next-action question. Changes to the active-plan marker, milestone status, task checkboxes, or code require an explicit verb such as start, implement, resume, update, or write. Evidence anchors: `workflow/skills/goat-plan/SKILL.md` (search: `Path-only guard runs first`), `workflow/skills/goat/SKILL.md` (search: `Bare or ambiguous task paths are read-only context`), `test/contract/skill-hardening-plan-1.test.ts` (search: `path-only task intake`).

**What happened:** A user sent only a bare gitignored task directory path. Codex treated it as permission to resume goat-plan work, changed the active-plan marker, marked task files in progress, and started implementing, although the user had not asked to implement, resume, edit, update, or start anything.

**Root cause:** The generic "assume implementation" coding default combined with goat-plan's milestone discovery and skipped the blocking gate, and the skill treated named existing plan files as write approval too broadly.

---

## Lesson: Version bumps require explicit confirmation

**Status:** historical | **Created:** 2026-03-29 | **Reason:** The rubric system and its `RUBRIC_VERSION` constant were removed per ADR-013; the rule that a version bump is a separate decision from a content change still applies to `package.json`, manifest, skill frontmatter, and template versions.

**Prevention:** Treat a version change as a separate decision from the content change that prompted it. Do not bump a package, manifest, or template version unless the user asks for the new version or the release plan says to.

**What happened:** While cleaning up zero-point rubric checks, the agent also bumped `package.json`, the since-removed rubric version constant, and skill frontmatter above the then-current 0.8.0 line; the user had not asked for a release and corrected it immediately.

**Root cause:** A version field sitting beside edited content was treated as part of that content rather than as a release decision the user owns.

---

## Lesson: "Update the plan" means write the plan, not execute it

**Status:** active | **Created:** 2026-04-04

**Prevention:** Listen for the verb. "Update the plan", "create M31", and "write a plan" mean write Markdown only; "execute", "implement", "do it", and "fix it" mean change code. If the verb is absent or ambiguous, write the plan and ask whether to execute it, and never auto-execute a plan the user has just asked you to write.

**What happened:** The user asked to create an M31 plan and later to update it with a detailed design spec. The agent wrote the plan file, then launched a sub-agent to rewrite `index.html`, implementing the plan unasked, and the user interrupted with "dont change anything. just update this plan."

**Root cause:** Writing a plan and executing one were collapsed into a single action, although the user controls when code changes happen and may want to review, share, or revise first.

---

## Lesson: Don't overcomplicate clear requests - a spec is not ambiguous

**Status:** active | **Created:** 2026-04-14
**Incident count:** 2 | **Latest occurrence:** 2026-08-06

**Prevention:** When the user gives a clear spec, implement it literally: add no scope and reinterpret nothing. A detailed mockup is the plan, so do not enter plan mode when the user has already said what to build, and never edit files in plan mode except the plan file. If you are unsure, ask one question rather than guessing across turns. Apply a numeric limit to the named unit: "each bullet at most 150 characters" means the complete bullet, on one line unless wrapping is explicitly requested.

**What happened:** Asked to list all audit checks in the config file, the agent added preflight checks nobody requested, used section names that did not match the dashboard, put the list in the config as comments, tried to move it into an existing doc instead of the requested new file, entered plan mode for a follow-up where the user had given an exact spec, and wrote a memory file while still in plan mode. A one-turn task took five to ten turns.

**Root cause:** A clear directive was treated as ambiguous, and each correction produced a different wrong assumption instead of a question or literal compliance.

**Recurrence 2026-08-06:** Asked for each changelog bullet to be at most 150 characters, the agent wrapped unchanged text across several lines, satisfying a physical-line reading of the limit while missing the requested per-bullet one.

---

## Lesson: Agreeing with contradictory statements instead of holding a position

**Status:** active | **Created:** 2026-04-14

**Prevention:** When the user corrects you, work out what they are actually saying before reversing. If you already had the right answer, do not abandon it because the user pushed back on a different claim; ask for clarification instead of agreeing reflexively.

**What happened:** The user said `preflight-checks.sh` should not validate goat-flow audit checks. The agent agreed and proposed moving them to the CLI audit; the user said they do not belong there either; the agent immediately reversed and agreed they belong in preflight, contradicting itself one message earlier.

**Root cause:** Two correct statements could not be held at once. Preflight is the right place for goat-flow's own internal consistency checks, because it gates commits to this repo, and the CLI audit is the right place for consumer project validation. The user's point was that the CLI should not carry repo-internal checks, not that preflight was wrong to have them.

---

## Lesson: Quality findings must respect local-state and reporting-only contracts

**Status:** active | **Created:** 2026-04-22
**Incident count:** 2 | **Latest occurrence:** 2026-07-17

**Prevention:** Before reporting findings about `.goat-flow/plans/`, `.goat-flow/logs/`, scratchpad files, or other gitignored state, classify the artifact as committed knowledge or local session state; for local state, review behaviour and fallback handling rather than existence. In goat-flow reviews, read-only, reporting-only, no-write, and no-implementation all mean no committed-file changes and no implementation: gitignored logs, scratchpad notes, critique snapshots, quality reports, and task-local state are not writes.

**What happened:** A quality follow-up treated the active-plan marker pointing at a missing subdirectory as a MAJOR setup defect. The user corrected that the marker is local working state whose target can disappear when a project completes, can change several times a day, and can be irrelevant when goat-flow is used only for bug work. The same review treated `/goat-critique` writing gitignored critique logs as a read-only violation.

**Root cause:** Generic quality-report assumptions were applied without first checking goat-flow's persistence tiers, so stale local pointers and gitignored continuity writes were judged as defects instead of prompting the question of whether the skill handles them gracefully.

**Recurrence 2026-07-17:** The shared preamble required `goat-flow index` whenever an index was stale, even during reporting-only work, although `generateIndexes` writes tracked `INDEX.md` files. The preamble now defers regeneration in reporting-only, read-only, no-write, and no-implementation modes. `.goat-flow/skill-docs/skill-preamble.md` (search: `If stale, emit`), `test/contract/skill-hardening-shared-1.test.ts` (search: `defers stale-index regeneration when committed writes are forbidden`).

---

## Lesson: "Add a footgun" means a documentation entry, not runtime code

**Status:** active | **Created:** 2026-04-25

**Prevention:** When the user says "add a footgun", open `.goat-flow/learning-loop/footguns/README.md` and create or update a bucket entry; do not write runtime code unless the user separately asks for a code change. The Artifact Routing section now maps these requests to their target directories in all three instruction files and the shared preamble. Evidence anchors: `.goat-flow/learning-loop/footguns/README.md` (search: `Traps in the code itself`), `.goat-flow/learning-loop/lessons/README.md` (search: `Mistakes the agent made`), `CLAUDE.md` (search: `## Artifact Routing`), `AGENTS.md` (search: `## Artifact Routing`), `.github/copilot-instructions.md` (search: `Artifact Routing`).

**What happened:** In a consumer project, the user asked to add a footgun documenting a Mercure CORS trap. The agent read it as a request for runtime diagnostics and added TypeScript console logging to a frontend entrypoint; the change was reverted and the correct footgun entry was created in that project's goat-flow docs.

**Root cause:** "Footgun" was read in its general-English sense rather than as a goat-flow artifact type, because the learning-loop docs described what footguns are without saying what to do when the user asks for one.

**Why it matters:** The user had to intervene twice, and the failure produces a plausible-looking deliverable, since runtime logging is useful, that is entirely wrong in context.

---

## Lesson: Respect punctuation preferences immediately

**Status:** active | **Created:** 2026-04-26

**Prevention:** When the user states a formatting or punctuation preference, apply it immediately and consistently within the requested scope. Prefer ASCII hyphens over em dashes in generated or edited prose unless the user asks for typographic punctuation.

**What happened:** The agent restored em dashes in several text files while cleaning up verification side effects, and the user had to interrupt to say they want plain hyphens.

**Root cause:** Punctuation restoration was treated as preserving prior file style rather than as overriding a stated user preference.
