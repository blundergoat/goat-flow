---
name: goat
description: "Single entry point that classifies intent and dispatches to the correct goat-* skill."
goat-flow-skill-version: "1.0.0"
---
# /goat

Route to the right skill in one step. Type `/goat` followed by what you need.

## How It Works

1. Read the user's input
2. Match intent to a skill using the table below
3. Announce: **"Running /goat-{skill}."** — wait 1 beat for the user to override
4. Load and execute the target skill's full process (Step 0, phases, gates)

The 8 skills remain directly invocable. `/goat` is a convenience layer, not a replacement.

## Intent Mapping

| If the input mentions... | Route to | Because |
|--------------------------|----------|---------|
| bug, error, broken, failing, crash, exception, unexpected, symptom, trace | **/goat-debug** | Diagnosis-first — find root cause before fixing |
| review, PR, diff, merge, check changes, code review | **/goat-review** | Structured review with severity ranking |
| audit, quality sweep, instruction staleness, CLAUDE.md review | **/goat-review** (audit/instruction mode) | Modes within goat-review |
| security, vulnerability, CVE, auth bypass, injection, secrets, OWASP | **/goat-security** | Threat-model-driven assessment |
| plan, design, feature, architect, implement, build (new thing) | **/goat-plan** | 4-phase planning with human gates |
| test, testing, verification, coverage, test plan | **/goat-test** | 3-phase test plan generation |
| rename, move, extract, restructure, refactor, cross-file | **/goat-refactor** | Blast radius analysis + grep-after-rename |
| simplify, readability, clean up, naming, messy, confusing | **/goat-simplify** | Readability without behaviour change |
| understand, explore, how does, what does, new to this, onboard | **/goat-investigate** | Deep read before acting |

## Disambiguation

When intent is ambiguous (matches 2+ skills), present the top 2 options:

> "This could be:
> (a) **/goat-debug** — if there's a specific bug or failure to diagnose
> (b) **/goat-review** — if you want a quality assessment of this area
>
> Which fits better, or tell me more?"

Do NOT guess when ambiguous. One clarification question is faster than loading the wrong skill.

### Common Ambiguities

| Input | Ambiguity | Resolution |
|-------|-----------|------------|
| "check the auth code" | debug vs review vs security | Ask: "Is there a bug, a quality concern, or a security concern?" |
| "improve the caching" | plan vs refactor vs simplify | Ask: "Is this a new design, a restructure, or a readability cleanup?" |
| "look at the database" | investigate vs debug vs review | Ask: "Understanding it, debugging an issue, or reviewing quality?" |
| "help with the migration" | plan vs refactor vs debug | Ask: "Planning it, executing it, or fixing a failing one?" |
| "this code is bad" | review vs simplify vs debug | Ask: "Is it broken, hard to read, or low quality?" |

## Bare Invocation

If the user types just `/goat` with no arguments:

> "What do you need? Some examples:
> - `/goat fix the login bug` → debug
> - `/goat review the PR` → code review
> - `/goat plan the new feature` → planning
> - `/goat check for security issues` → security assessment
>
> Or describe what you're working on and I'll route you."

## Override

If the user names a skill explicitly, respect it:
- `/goat --debug check the auth` → force goat-debug regardless of other signals
- `/goat I want goat-security on the payment flow` → detect the skill name, use it

## Transparency

ALWAYS announce the selected skill before executing:

> **Running /goat-debug.** (Say "stop" or name a different skill to override.)

Then proceed directly to the target skill's Step 0. Do NOT add a second round of context gathering — the target skill handles that.

## Constraints

- MUST announce which skill was selected before executing
- MUST NOT add questions beyond the target skill's own Step 0
- MUST NOT load two skills simultaneously — dispatch to one
- MUST present disambiguation options when 2+ skills match equally
- MUST respect explicit skill name overrides in user input
- The 8 existing skills MUST remain directly invocable — this is additive

## Chains With

This skill doesn't chain — it's the entry point. The dispatched skill handles its own chaining.
