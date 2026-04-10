---
name: goat
description: "Single entry point that classifies intent and dispatches to the correct goat-* skill."
goat-flow-skill-version: "1.1.0"
---
# /goat

Conversational intake for all goat-flow skills. Use when the user describes an outcome and wants the right workflow chosen for them.

## How It Works

1. **UNDERSTAND** - work out what the user actually wants. If the request is clear, keep moving. If it is vague, ask one clarifying question at most.
2. **GATHER** - pull in project context automatically: Ask First boundaries, footguns, recent git, toolchain, and local instructions when relevant.
3. **ROUTE** - hand off to the right skill with an enriched brief, or proceed directly with the execution loop if no skill is needed.

The other 5 skills remain directly invocable. `/goat` is a smarter front door, not a replacement.

## UNDERSTAND

**Route by intent, not a keyword table:**
- Clear planning or design request → **/goat-plan**
- Clear bug, failure, or investigation request → **/goat-debug**
- Clear quality review, audit, or simplify request → **/goat-review**
- Clear security or compliance request → **/goat-security**
- Clear testing or coverage request → **/goat-test**
- Simple implementation requests like "rename X to Y", "add a log line", "move this constant", or "change the error text" → no skill; proceed directly with the execution loop
- Simple factual questions → answer directly without routing

**Depth-aware routing:**
- If the user asks for a plan, offer the target skill's quick/full depth choice up front.
- Example: "Planning X — do you want a quick plan, or the full plan with Mob questions and SBAO critique?"

**Clarification rule:**
- If the request is vague, ask one clarifying question, not a formal menu.
- Example: "What are you trying to do here: understand it, find a bug, review quality, check security, plan work, test it, or something else?"

## GATHER

When the user names a file, directory, task, or subsystem, gather context before routing:
- Ask First boundaries from local instructions and `.goat-flow/config.yaml` when available
- matching `.goat-flow/footguns/` entries
- `git log --oneline -5 -- <path>` for recent activity
- toolchain details from `.goat-flow/config.yaml` when available
- local instructions or architecture notes relevant to the target area

Build a short brief like:
> "User wants to debug X. Ask First boundary: yes. Footgun: [entry or none]. Recent git: [summary]. Toolchain: [summary]."

## ROUTE

**Skill routes:**
- **/goat-debug** for diagnosis, investigation, and onboarding
- **/goat-review** for code review, audits, instruction-file review, and simplify work
- **/goat-plan** for feature planning, refactor planning, Mob Elaboration, and SBAO
- **/goat-security** for threat models, compliance work, dependency audits, and auth/authz assessment
- **/goat-test** for test planning, coverage gaps, and verification workflows

**Direct execution route:**
- If no skill fits because the request is straightforward implementation, announce that no skill is needed and continue with READ → CLASSIFY → SCOPE → ACT → VERIFY → LOG.
- Keep the request in Implement mode. Do not force it through planning just because the verb is "change" or "build."

**Handoff rule:**
- Pass the enriched brief AND the depth choice (if made) to the target skill.
- If the user already chose "quick" or "full" via the dispatcher, include `Depth: quick` or `Depth: full` in the handoff. The target skill skips its own depth question.
- If depth was not discussed, omit it — the target skill will ask.

## Common Ambiguities

| Input | Ambiguity | Clarifying question |
|-------|-----------|---------------------|
| "check the auth code" | debug vs review vs security | "Do you want to find a bug, review quality, or assess security?" |
| "improve the caching" | plan vs review | "Is this a new design, a restructure, or a readability cleanup?" |
| "look at the database" | debug vs review | "Are you trying to understand it, debug an issue, or review quality?" |
| "help with the migration" | plan vs debug | "Are we planning the migration, executing a restructure, or fixing one that's failing?" |
| "this code is bad" | review vs simplify vs debug | "Is it broken, hard to read, or low quality?" |
| "analyse a plan" | review vs plan | "Do you want problems found in the plan, or do you want the plan improved and sharpened?" |
| "refactor the tests" | plan vs test | "Are you restructuring test code, or do you want a test plan?" |
| "review the security code" | review vs security | "Do you want a quality review, or a security assessment?" |
| "audit the code" | review vs security | "Is this a code quality audit, or a security and dependency audit?" |

**Target-aware hints:** If the input includes a path, use it to bias the clarification:
- `roadmap`, `plan`, `.goat-flow/tasks/`, `milestone` → plan vs review
- `test`, `spec`, `e2e` → likely test
- `security`, `auth`, `vuln` → likely security or debug

## Bare Invocation

If the user types just `/goat` with no arguments:

> "What do you need? Some examples:
> - `/goat fix the login bug` → debug
> - `/goat review the PR` → review
> - `/goat plan the new feature` → plan
> - `/goat check for security issues` → security
> - `/goat make sure this is tested` → test
> - `/goat rename this helper` → direct execution
>
> Or describe what you're working on and I'll route it."

## Simple Questions

If the input is a simple factual question, answer directly without routing to a skill.

## Override

If the user names a skill explicitly, respect it:
- `/goat --debug check the auth` → force goat-debug
- `/goat use goat-security on the payment flow` → force goat-security
- `/goat use goat-plan for this migration` → force goat-plan

If the user explicitly wants a skill, do not second-guess them unless the request is unsafe or impossible.

## Output Format

The dispatcher announces the route and hands off. No standalone deliverable.

## Constraints

- MUST understand intent conversationally, not via a keyword lookup table
- MUST ask at most one clarifying question for vague requests
- MUST route simple implementation requests directly to the execution loop
- MUST gather Ask First, footgun, recent git, and toolchain context when relevant
- MUST pass one enriched brief to one target skill
- MUST respect explicit skill overrides
- MUST leave the other 5 skills directly invocable

## Post-Dispatch Chaining

After the routed work closes, suggest the next likely move:

| Completed | Suggest next |
|-----------|-------------|
| goat-debug | "Want a `/goat-test` verification plan, or a `/goat-review` on the fix?" |
| goat-review | "Need `/goat-debug` for a specific finding, or `/goat-test` for coverage gaps?" |
| goat-plan | "Ready to implement, or do you want `/goat-test` to plan verification first?" |
| goat-security | "Want `/goat-review` on the fixes, or `/goat-test` for mitigation checks?" |
| goat-test | "Want `/goat-review` on the test quality, or are you done here?" |

Only suggest a next step if the user has not already moved on.
