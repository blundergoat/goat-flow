---
name: goat
description: "Use when you describe an outcome and need the right goat-* workflow chosen for you."
goat-flow-skill-version: "1.3.0"
---
# /goat

## Shared Conventions

Read `.goat-flow/skill-reference/skill-preamble.md` for shared conventions.
On full-depth, also read `.goat-flow/skill-reference/skill-conventions.md`.
Universal constraints from `skill-preamble.md` apply.

Use when the user describes an outcome and wants the right workflow chosen.

**If you see a symptom and want to start reading code instead of routing, STOP.** That is the failure mode this skill exists to prevent. The dispatcher classifies and routes; the routed skill investigates.

| Excuse | Reality |
|--------|---------|
| "I can see the issue in the code - routing is overhead" | You are the dispatcher, not the investigator. Reading code is the routed skill's job. Route first. |
| "The user said 'just fix it' - permission to skip routing" | "Just fix it" is pragmatic pressure, not a routing override. Route to /goat-debug; it decides how to fix. |
| "Time pressure means I should start investigating immediately" | Routing takes seconds. Investigating without routing risks solving the wrong problem or missing an intent. |
| "Multiple symptoms mean I should start reading files" | Multiple symptoms mean multiple intents. Classify each, route each - do not collapse into single-intent investigation. |
| "I already know which skill - GATHER is redundant" | GATHER surfaces footgun matches and ask-first boundaries that change the route. Skipping it is how you miss the relevant trap. |

## How It Works

1. **UNDERSTAND** - classify intent and target from the user's request.
2. **GATHER** - collect minimal context: ask-first boundaries, footgun matches, recent git activity, config/architecture if relevant. Format: `User wants [intent] on [target] with boundaries [none / ask-first]. Recent git [summary / none].`
3. **ROUTE** - dispatch to the target skill using the preamble routing table. Include a one-line rationale: "Routing to `/goat-debug` - you described a symptom ([symptom]), and the target is [area]."

## Planning Route

For planning requests, treat `.goat-flow/tasks/.active` as an advisory local pointer. If it exists and names an existing subdir, scan that subdir for milestone files. If `.active` is missing or names a missing subdir, treat it as normal local churn (completed plan, project switch, or no task workflow), list top-level entries in `.goat-flow/tasks/` excluding `_archived`, prefer dirs with recent `M*.md` files, and ask the user which is current. Do not report a stale/missing `.active` target as a setup failure by itself.

| Complexity | Approach |
|------------|----------|
| Hotfix | Route to direct execution, no planning needed |
| Small Feature | Compressed brief → `/goat-plan` for 1-2 milestones |
| Standard | Feature brief → `/goat-plan` (suggest `/goat-critique` if approach uncertain) |
| System / Infrastructure | Feature brief → `/goat-plan` → `/goat-critique` (recommended) |

## Handoff

Pass the collected brief and any preselected depth to the target skill.
If the user signals a re-route mid-workflow, preserve context and dispatch again.

**Proof Gate:** Route rationales and dispatch claims in this skill's output must satisfy the Proof Gate in `skill-preamble.md` - cite the concrete signals (file, symptom, artifact) that justified the route.

## Constraints

- MUST understand intent conversationally, not via keyword lookup.
- MUST ask 0-2 clarification questions max; route with stated assumption if still ambiguous.
- MUST include a one-line route rationale with every dispatch.
- MUST respect explicit skill overrides.
- MUST NOT read source code, trace code paths, form hypotheses, or produce diagnostic findings - those are the routed skill's job.
- MUST handle multi-intent requests by classifying and routing each intent separately.
