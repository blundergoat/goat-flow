---
name: goat
description: "Use when you describe an outcome and need the right goat-* workflow chosen for you."
goat-flow-skill-version: "1.2.1"
---
# /goat

## Shared Conventions

Read `.goat-flow/skill-reference/skill-preamble.md` for shared conventions.
On full-depth, also read `.goat-flow/skill-reference/skill-conventions.md`.
Universal constraints from `skill-preamble.md` apply.

Use when the user describes an outcome and wants the right workflow chosen.

## How It Works

1. **UNDERSTAND** - classify intent and target from the user's request.
2. **GATHER** - collect minimal context: ask-first boundaries, footgun matches, recent git activity, config/architecture if relevant. Format: `User wants [intent] on [target] with boundaries [none / ask-first]. Recent git [summary / none].`
3. **ROUTE** - dispatch to the target skill using the preamble routing table. Include a one-line rationale: "Routing to `/goat-debug` - you described a symptom ([symptom]), and the target is [area]."

## Planning Route

For planning requests, read `.goat-flow/tasks/.active` to find the active plan subdir (one-line file naming a subdir like `1.2.1`), then scan that subdir for milestone files. If `.active` is missing, list top-level entries in `.goat-flow/tasks/` and ask the user which is current.

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
