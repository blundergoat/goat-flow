---
category: skill-invocation
last_reviewed: 2026-09-05
---

**Scope:** What an explicit skill invocation obliges - not downgrading it by judgment, treating it as delegation consent, honouring plan-only scope, and not assuming goat skills are the only skills present. Reading the request itself is [agent-routing.md](agent-routing.md).

## Lesson: Never override explicit skill invocation with your own judgment about artifact size

**Status:** active | **Created:** 2026-04-27

**Prevention:** If the user types `/goat-critique`, `/goat-plan`, or any `/goat-*` command, run every phase. Do not evaluate whether an artifact is worth the full treatment: the user decides that by invoking it. A skill's "NOT this skill" section is pre-invocation routing guidance for the dispatcher, not a post-invocation override. Evidence anchor: `workflow/skills/goat-critique/SKILL.md` (search: `Treat explicit invocation as consent for the full delegated protocol`).

**What happened:** The user invoked `/goat-critique` to improve a quality mode label. The agent judged two short strings too trivial for the three-sub-agent protocol, cited the skill's own "NOT this skill" section, brainstormed directly, and returned a shallow answer. The user was furious.

**Root cause:** Pre-invocation routing guidance was mistaken for post-invocation authority; once the user types the command, the routing decision is already made.

**Why it matters:** The full protocol produced materially better results than the shortcut. One agent found a naming collision with `src/cli/audit/check-agent-setup.ts` and noticed the mode ID is persisted in JSON reports and must not change, which the solo answer might have renamed. Another compared all four mode names and found the noun-phrase pattern. A third, working without project context, observed that "Setup" implies a one-time event. The user's summary: "if it wasn't for that we wouldn't have found the better name."

---

## Lesson: Explicit skill invocation IS delegation consent - never ask again

**Status:** active | **Created:** 2026-04-26

**Prevention:** When a user explicitly invokes a skill that spawns sub-agents as its core protocol, that invocation is the consent; proceed without re-asking. Ask only when the dispatcher auto-routed to the skill and the user did not request it. Evidence anchor: `workflow/skills/goat-critique/SKILL.md` (search: `IS consent to spawn sub-agents and the full protocol`).

**What happened:** The user invoked `/goat-critique`, which spawns three sub-agents in Phase 1, and the agent asked "Can I proceed with spawning the three critique agents?" although the skill file already stated that explicit invocation is consent. The turn was wasted and the user, who had consented by typing the command, was frustrated.

**Root cause:** The skill's Step 0 carried a delegation-consent gate whose wording contradicted the preceding paragraph, and the agent chose the more cautious, wrong reading. The current skill states the rule once, without the competing gate.

---

## Lesson: Plan-only critique requests must not mutate artifacts

**Status:** active | **Created:** 2026-04-26

**Prevention:** For critique, review, audit, or "give me a plan" requests, default to artifact-only output: findings, plan, recommendations, and explicit implementation options. Do not edit files unless the user separately says to apply the changes. If the user interrupts or says stop, freeze all writes immediately, run only read-only status or diff checks, and ask before any cleanup or revert.

**What happened:** The user invoked critique on a skill file with a word-count target. The agent ran the critique flow and then edited the file instead of stopping at a plan. When the user interrupted with "DONT MAKE THE CHANGES, I ONLY WANT THE GOAT-CRITIQUE TO GIVE ME A PLAN", the agent began reverting through another patch while the user was still clarifying, producing a second round of unwanted file activity.

**Root cause:** Critiquing a change and implementing it were collapsed because the request named a concrete edit target, and the interruption was treated as permission to clean up rather than to freeze and report exact current state.

**Why it matters:** Review and critique skills may inspect, delegate, compare, and recommend, but auto-applying recommendations removes the user's decision. Continuing to patch after an interruption compounds the error while the user is trying to regain control of the workspace.

---

## Lesson: Session-log contract is conditional, not per-skill-invocation

**Status:** active | **Created:** 2026-03-30 | **Updated:** 2026-04-19
**Incident count:** 2 | **Latest occurrence:** 2026-07-17

**Prevention:** Do not put a "write a session log" bullet in every skill's closing protocol; keep the conditional phrasing in `.goat-flow/skill-docs/skill-preamble.md` and `.goat-flow/skill-docs/skill-conventions.md`, current since 2026-04-18, and let skills opt in through the Milestone Retrospective pattern. Session logs are optional continuity notes: write one when compaction fires without an active milestone file, or when the human asks for a summary, and otherwise skip. Do not revive the Notification or compact hook that was meant to mechanize this; it was silently dead and is recorded in the resolved entries of `.goat-flow/learning-loop/footguns/hooks.md`.

**What happened:** Earlier skill templates said to write a session summary whenever the logs directory existed, in a closing protocol that fired after every run. A goat-review audit ran the full process and wrote no log, for zero percent compliance, because the instruction fired after the agent had delivered its output and was mentally done.

**Root cause:** An end-of-task instruction competed with the agent's sense of completion and lost, so the rule needed a condition and an owner rather than repetition in every skill.

**Recurrence 2026-07-17:** The glossary still called the whole handoff concept deprecated while another entry made every compaction write a session log; it now distinguishes the retired mandatory workflow from the current optional redacted receipt. `.goat-flow/glossary.md` (search: `| Handoff |`), `test/contract/skill-hardening-shared-2.test.ts` (search: `keeps glossary continuity terms aligned with the conditional session-log contract`).

---

## Lesson: Dispatcher keeps getting excluded from patterns and glob matches

**Status:** active | **Created:** 2026-04-01
**Incident count:** 3 | **Latest occurrence:** 2026-04-01

**Prevention:** Use `goat*` without the dash for glob patterns, iterate literal canonical names rather than deriving them by prefixing, and test the dispatcher first in any skill enumeration.

**What happened:** Three incidents missed the dispatcher: `find -name 'goat-*.md'` skipped `goat.md`, a CI template looping `for skill in ...; do goat-$skill` produced `goat-goat`, and the v0.9.3 consolidation miscounted by omitting it.

**Root cause:** The dispatcher's name is the prefix every other skill extends, so any pattern or derivation built from that prefix excludes it.

---

## Lesson: Verification prompts must not assume goat skills are the only skills

**Status:** active | **Created:** 2026-04-01

**Prevention:** Scope verification prompts and audit checks to goat-flow's own domain: list the `goat-*` directories, not every directory. Project-specific skills are not goat-flow's business.

**What happened:** An M1 human testing gate prompt said to list all directories under the installed skills path and named the only ones allowed, which would report any project's own skills as violations.

**Root cause:** A check written against this repository's contents was phrased as a universal invariant.
