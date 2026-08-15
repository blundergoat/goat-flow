---
category: skill-invocation
last_reviewed: 2026-08-15
---

**Scope:** What an explicit skill invocation obliges - not downgrading it by judgment, treating it as delegation consent, honouring plan-only scope, and not assuming goat skills are the only skills present. Reading the request itself is [agent-routing.md](agent-routing.md).

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

## Lesson: Session-log contract is conditional, not per-skill-invocation

**Created:** 2026-03-30 | **Updated:** 2026-04-19

**What happened:** Earlier skill templates said "If `.goat-flow/logs/` exists → write session summary" in a closing protocol that fired after every skill run. A goat-review audit ran the full skill process but no session log was written. 0% compliance. The instruction fired at the END of a skill - after the agent had already delivered output and was mentally "done."

**Current contract** (per `skill-preamble.md` + `skill-conventions.md`, post-2026-04-18): session logs are OPTIONAL continuity notes. Write one only when (a) `/compact` fires without an active milestone file, or (b) the human explicitly requests a session summary. Otherwise skip - the old blanket "every invocation" rule is retired.

**Recurrence 2026-07-17:** `.goat-flow/glossary.md` (search: `| Handoff |`) still called the entire handoff concept deprecated, while `Working Memory` made every `/compact` write a session log. The glossary now distinguishes the retired mandatory workflow from the current optional redacted receipt; `test/contract/skill-hardening-shared-2.test.ts` (search: `keeps glossary continuity terms aligned with the conditional session-log contract`) pins the condition.

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

