---
category: agent-routing
last_reviewed: 2026-05-02
---

## Lesson: Bare task paths are context, not implementation approval

**Created:** 2026-05-01

**What happened:** A user sent only a bare gitignored task directory path. Codex treated the path as permission to resume goat-plan work, changed the active-plan marker, marked task files in progress, and started code implementation. The user had not asked to implement, resume, edit, update, or start a milestone.

**Root cause:** The agent combined the generic "assume implementation" coding default with goat-plan's existing milestone discovery and skipped the blocking gate. The skill also treated named existing plan files as write approval too broadly, so a context path could be misread as a target.

**Prevention:** A bare or ambiguous task path is read-only context. The correct first response is an orientation summary plus a next-action question. `.active` changes, milestone status changes, task checkboxes, and code edits require explicit verbs such as "start", "implement", "resume", "update", or "write". Evidence anchors: `workflow/skills/goat-plan/SKILL.md` (search: `Path-only guard runs first`), `workflow/skills/goat/SKILL.md` (search: `Bare or ambiguous task paths are read-only context`), `test/contract/skill-hardening-contracts.test.ts` (search: `path-only task intake`).

---

## Lesson: Never override explicit skill invocation with your own judgment about artifact size

**Created:** 2026-04-27

**What happened:** User invoked `/goat-critique` to brainstorm a better name and description for a quality mode label. The agent judged the artifact (two short strings) as "too trivial" for the full 3-sub-agent protocol and skipped it entirely, citing the skill's own "NOT this skill" section: "Trivial artifact - use goat-review instead. If it is not worth 3 agents and 5 phases, do not use goat-critique." The agent brainstormed directly and gave a shallow answer ("Setup Health"). The user was furious.

**Root cause:** The agent confused pre-invocation routing guidance with post-invocation authority. The "NOT this skill" section exists to help the dispatcher (or the agent when no skill has been chosen yet) route to the right skill. Once the user explicitly types `/goat-critique`, that section is irrelevant - the user has already made the routing decision. The agent also ignored two existing memory entries (`feedback_always_run_skills`, `feedback_never_ask_delegation_consent`) that both said to always run the full protocol on explicit invocation.

**Why this matters:** The full protocol produced materially better results than the shortcut:
- Agent A found a naming collision with `check-agent-setup.ts` that the solo brainstorm missed entirely
- Agent A identified that the mode ID is persisted in JSON reports and must not change - the solo answer might have led to an ID rename
- Agent B compared all four mode names systematically and found the noun-phrase pattern, producing "Agent Installation" which was more pattern-consistent than the solo "Setup Health"
- Agent C (fresh eyes, no project context) identified that "Setup" implies a one-time event - a UX insight grounded in genuine unfamiliarity

The user's point: "if it wasn't for that we wouldn't have found the better name." The protocol's value is not proportional to artifact size.

**Prevention:** The user decides what deserves the full protocol, not the agent. If the user types `/goat-critique`, `/goat-plan`, or any `/goat-*` command, run every phase without exception. The skill's "NOT this skill" section is pre-invocation routing guidance for the dispatcher. It does not override explicit invocation. Do not evaluate whether an artifact is "worth" the full treatment.

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

## Lesson: Session-log contract is conditional, not per-skill-invocation

**Created:** 2026-03-30 | **Updated:** 2026-04-19

**What happened:** Earlier skill templates said "If `.goat-flow/logs/` exists → write session summary" in a closing protocol that fired after every skill run. A goat-review audit ran the full skill process but no session log was written. 0% compliance. The instruction fired at the END of a skill - after the agent had already delivered output and was mentally "done."

**Current contract** (per `skill-preamble.md` + `skill-conventions.md`, post-2026-04-18): session logs are OPTIONAL continuity notes. Write one only when (a) `/compact` fires without an active milestone file, or (b) a milestone sequence completes. Otherwise skip - the old blanket "every invocation" rule is retired.

**Prevention:** Do not put a "write a session log" bullet in every skill's closing protocol. Keep the conditional phrasing in `skill-preamble.md` / `skill-conventions.md` and let skills opt in via the Milestone Retrospective pattern. The Notification/compact hook that was meant to mechanize this was silently dead (see `.goat-flow/learning-loop/footguns/hooks.md` Resolved Entries 2026-04-19) - don't revive that approach.

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

## Lesson: Quality findings must respect local-state and reporting-only contracts

**Created:** 2026-04-22

**What happened:** During a quality follow-up, the agent treated the active-plan marker pointing at a missing subdir as a MAJOR setup defect. The user corrected that the active marker is local working state: its target can disappear when a project completes, can change multiple times a day as users switch projects, or can be irrelevant when the user is only using goat-flow for bug work. The same review treated `/goat-critique` writing gitignored critique logs as a read-only violation. The user corrected the contract: read-only/reporting work means no committed-file changes and no implementation, not "never write gitignored continuity logs or task checkboxes."

**Root cause:** The agent applied generic quality-report assumptions without first checking goat-flow's persistence tiers and local-state semantics. It judged stale local pointers and gitignored continuity writes as setup defects instead of asking whether the skill handles them gracefully and whether committed state changes.

**Prevention:** Before reporting findings about `.goat-flow/plans/`, `.goat-flow/logs/`, scratchpad files, or other gitignored state, classify the artifact as committed knowledge vs local session state. For local state, review behavior and fallback handling, not existence alone. In goat-flow quality reviews, "read-only", "reporting-only", "no-write", and "no implementation" mean no committed-file changes and no implementation; gitignored logs, scratchpad notes, critique snapshots, quality reports, and task-local state do not count as writes.

---

## Lesson: "Add a footgun" means a documentation entry, not runtime code

**Created:** 2026-04-25

**What happened:** In a consumer project, the user asked to "add a footgun" documenting a Mercure CORS trap. The agent interpreted this as a request for runtime diagnostic code and added TypeScript console logging to `assets/entrypoints/chat-assistant.ts`. The user had to correct the agent, the code change was reverted, and the correct Mercure footgun entry was created in that project's goat-flow docs.

**Root cause:** The agent did not know that "footgun" in a goat-flow project means a documentation artifact under `.goat-flow/learning-loop/footguns/`. It defaulted to the general-English meaning ("something that will hurt you") and implemented a runtime warning. The routing was not documented prominently enough - the learning-loop section described what footguns ARE, but not what to do when the user says "add one."

**Why it matters:** The user had to intervene twice (once to stop the code change, once to redirect to the correct directory). The mistake class is dangerous because it produces a plausible-looking deliverable (runtime logging IS useful) that is completely wrong in context (the user wanted a knowledge-base entry, not code).

- Evidence: `.goat-flow/learning-loop/footguns/README.md` (search: `Traps in the code itself`) defines footguns as documentation artifacts
- Evidence: `.goat-flow/learning-loop/lessons/README.md` (search: `Mistakes the agent made`) defines lessons as documentation artifacts
- Evidence: Artifact Routing section now added to all four instruction files (CLAUDE.md, AGENTS.md, GEMINI.md, `.github/copilot-instructions.md`)

**Prevention:** The Artifact Routing section in instruction files and skill-preamble.md now explicitly maps user requests to target directories. When the user says "add a footgun," open `.goat-flow/learning-loop/footguns/README.md` and create/update a bucket entry. Do not write runtime code unless the user separately asks for a code change.

---

## Lesson: Explicit skill invocation IS delegation consent - never ask again

**Created:** 2026-04-26

**What happened:** User invoked `/goat-critique` which requires spawning three sub-agents (Phase 1). The agent asked "Can I proceed with spawning the three critique agents?" despite the skill file explicitly stating "Explicit invocation is explicit consent to the full critique protocol." This wasted a turn and frustrated the user, who had already given consent by typing the command.

**Root cause:** The skill's Step 0 had a "Delegation consent gate" that said "when the active runner requires explicit user consent for delegated sub-agents and that consent is not present in the current user request or caller context, stop and ask before Phase 1." The agent interpreted this as always needing to ask, even though the preceding paragraph said explicit invocation is consent. The two clauses contradicted each other and the agent chose the more cautious (wrong) interpretation.

**Prevention:** When a user explicitly invokes a skill that spawns sub-agents as its core protocol, that invocation IS the consent. Do not re-ask. The skill file has been updated to make this unambiguous. For any skill with delegated agents: if the user typed the command, proceed. The only time to ask is when the skill was auto-routed by the dispatcher and the user didn't explicitly request it.

---

## Lesson: Plan-only critique requests must not mutate artifacts

**Created:** 2026-04-26

**What happened:** User invoked `$goat-critique make this less than 500 words: workflow/skills/goat/SKILL.md`. The agent ran the critique flow, then edited `workflow/skills/goat/SKILL.md` instead of stopping at a plan. When the user interrupted with "DONT MAKE THE CHANGES, I ONLY WANT THE GOAT-CRITIQUE TO GIVE ME A PLAN", the agent immediately began reverting through another patch while the user was still clarifying, creating a second round of unwanted file activity.

**Root cause:** The agent collapsed "critique this change" and "implement this change" because the artifact named a concrete edit target and the agent defaulted to execution. It also treated interruption as permission to perform cleanup instead of first freezing writes and reporting exact current state.

**Why this matters:** Review and critique skills are allowed to inspect, delegate, compare, and recommend. They must not auto-apply recommendations unless the user explicitly asks for implementation. Continuing to patch after an interruption compounds the original error because the user is trying to regain control of the workspace.

**Prevention:** For `$goat-critique`, `/goat-critique`, review, audit, or "give me a plan" requests, default to artifact-only output: findings, plan, recommendations, and explicit implementation options. Do not edit files unless the user separately says to apply the changes. If the user interrupts or says stop/no changes, freeze all writes immediately, run only read-only status/diff checks if needed, and ask before any cleanup or revert.

---

## Lesson: Respect punctuation preferences immediately

**Created:** 2026-04-26

**What happened:** The agent restored em dashes in several text files while cleaning up verification side effects, even though the user's preference is to use plain hyphens instead. The user had to interrupt and explicitly say they hate em dashes and want them changed to `-`.

**Root cause:** The agent treated punctuation restoration as preserving prior file style instead of recognizing a strong user preference. The local editing default already favors ASCII unless there is a clear reason otherwise, but the agent allowed existing prose punctuation to override the user's preference.

**Prevention:** When the user states a formatting or punctuation preference, apply it immediately and consistently within the requested scope. Prefer ASCII hyphens over em dashes in generated or edited prose unless the user explicitly asks for typographic punctuation.
