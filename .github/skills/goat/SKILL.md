---
name: goat
description: "Single entry point that classifies intent and dispatches to the correct goat-* skill."
goat-flow-skill-version: "1.1.0"
---
# /goat

## Shared Conventions

Read `.goat-flow/skill-preamble.md` for shared conventions.
On full-depth, also read `.goat-flow/skill-conventions.md`.
Universal constraints from `skill-preamble.md` apply.

Conversational intake for all goat-flow skills. Use when the user describes an outcome and wants the right workflow chosen for them.

## How It Works

1. **UNDERSTAND** intent and target.
2. **GATHER** project context (ask-first boundaries, footguns, recent activity, toolchain).
3. **ROUTE** to the correct skill with one-line rationale.

The other 6 skills remain directly invocable. `/goat` is a smarter front door, not a gate.

## UNDERSTAND

**Route by intent, not a keyword table:**
- Feature brief / requirements sharpening / mob elaboration → dispatcher planning route.
- Milestones and task tracking → `/goat-plan`
- Bugs, failures, investigation → `/goat-debug`
- Review/audit/simplify → `/goat-review`
- Second opinion/critique → `/goat-sbao`
- Security/compliance → `/goat-security`
- Testing coverage gaps → `/goat-test`
- Simple implementation requests → no skill; proceed directly with the execution loop
- Factual questions → answer directly when possible.

**Clarification rules:**
- Ask 0/1/2 questions: zero if intent+target are clear, one for single ambiguity, two max when both are unclear.
- If still ambiguous after two, pick the most likely route and proceed with an explicit assumption.

## GATHER

Gather minimal context needed to route, then degrade gracefully:
- Ask First boundaries from config and instruction file.
- Relevant `.goat-flow/footguns/` matches.
- `git log --oneline -5 -- <path>` when available.
- `.goat-flow/config.yaml` toolchain and `.goat-flow/architecture.md` if relevant.

Use this compact brief format:
`User wants [intent] on [target] with boundaries [none / ask-first]. Recent git [summary / none].`

## ROUTE

**Skill routes:** planning route, `/goat-plan`, `/goat-debug`, `/goat-review`, `/goat-sbao`, `/goat-security`, `/goat-test`.

**Direct execution route:**
For straight implementation requests, present gathered context and proceed with
`READ → SCOPE → ACT → VERIFY` directly.

**Handoff rule:** pass the collected brief to the target skill and keep any preselected depth.

**Routing announcement:** Include a one-line rationale with every route:
> "Routing to `/goat-debug` — you described a symptom ([symptom]), and the target is [area]."

## Planning Route

Planning follows the same UNDERSTAND → GATHER → ROUTE flow.
Check `.goat-flow/tasks/` for existing plans before creating new ones.

### Feature Brief
Use `workflow/templates/feature-brief.md`.

### Mob Elaboration
Use `workflow/templates/mob-elaboration.md` only if requirements sharpening is needed.

### Complexity Gating

| Complexity | Approach |
|------------|----------|
| Hotfix | No planning needed. Route to direct execution. |
| Small Feature | Compressed brief (Problem + Scope + Kill Criteria all at once) → `/goat-plan` for 1-2 milestones. Skip mob. |
| Standard | Feature brief → mob (optional) → `/goat-plan` for milestones |
| System / Infrastructure | Feature brief → mob (recommended) → `/goat-plan` → suggest `/goat-sbao` critique |

## Common Ambiguities

| Input | Ambiguity | Clarifying question |
|-------|-----------|---------------------|
| "plan the feature" | brief vs milestones | "Work this as feature requirements, or do you want `/goat-plan` milestones now?" |
| "check the auth code" | debug vs review vs security | "Do you want a bug diagnosis, quality audit, or security review?" |
| "analyse a plan" | review vs sbao | "Do you want problems in the plan (`/goat-review`) or multi-perspective critique (`/goat-sbao`)?" |
| "get a second opinion" | goat-sbao vs goat-review | "Structured multi-agent critique or single-pass review?" |

## Bare Invocation

If user types `/goat` only, route to the right skill or handle planning directly.

If the user types `/goat help [skill]`, summarise that skill's "When to Use."

## Override

If user names a skill explicitly, honor that exact route.

## Re-Route

If the user signals they're in the wrong skill mid-workflow ("wrong skill", "switch to debug", "this is actually a review"):

Preserve gathered context, build a one-sentence handoff brief, and route again.

## Constraints

- Universal constraints from skill-preamble.md apply.
- MUST understand intent conversationally, not via keyword lookup.
- MUST ask 0/1/2 clarification questions, never more.
- MUST route and state assumption when ambiguous.
- MUST include a one-line route rationale.
- MUST respect explicit skill overrides.
- MUST check existing plans before creating new planning artifacts.
