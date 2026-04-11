---
name: goat
description: "Single entry point that classifies intent and dispatches to the correct goat-* skill."
goat-flow-skill-version: "1.1.0"
---
# /goat

## Shared Conventions

Read `.goat-flow/skill-preamble.md` for shared conventions.
On full-depth, also read `.goat-flow/skill-conventions.md`.
If unavailable, use these essentials:
- Severity: SECURITY > CORRECTNESS > INTEGRATION > PERFORMANCE > STYLE
- Evidence: every finding MUST include file or file:line, tag OBSERVED vs INFERRED
- Learning loop: check .goat-flow/lessons/ and .goat-flow/footguns/ after completion
- Gates: BLOCKING GATE = stop and wait. CHECKPOINT = continue unless interrupted.

Conversational intake for all goat-flow skills. Use when the user describes an outcome and wants the right workflow chosen for them.

## How It Works

1. **UNDERSTAND** — work out what the user actually wants
2. **GATHER** — pull in project context automatically
3. **ROUTE** — hand off to the right skill with an enriched brief, or proceed directly

The other 6 skills remain directly invocable. `/goat` is a smarter front door, not a gate.

## UNDERSTAND

**Route by intent, not a keyword table:**
- Feature brief, requirements sharpening, mob elaboration → **dispatcher Planning Route** (handled directly below)
- Breaking work into milestones, tracking progress, structured task files → **/goat-plan**
- Clear bug, failure, or investigation request → **/goat-debug**
- Clear quality review, audit, or simplify request → **/goat-review**
- Clear request for critique, comparison, second opinion, or multi-perspective review → **/goat-sbao**
- Clear security or compliance request → **/goat-security**
- Clear testing or coverage request → **/goat-test**
- Simple implementation requests → no skill; proceed directly with the execution loop
- Simple factual questions → answer directly without routing

**Clarification rules:**
- **Zero questions** when intent AND target are clear from the request
- **One question** when intent OR target is ambiguous — ask about the missing dimension
- **Two questions maximum** when BOTH intent and target are ambiguous — ask the most important first
- **Never three.** If still ambiguous after two, pick the most likely skill, state your assumption, and let the user correct: "This sounds like a review of [area]. Starting `/goat-review` — redirect me if that's wrong."

## GATHER

When the user names a file, directory, task, or subsystem, gather context before routing:

**Full context (all available):**
- Ask First boundaries from `.goat-flow/config.yaml` and the instruction file
- Matching `.goat-flow/footguns/` entries
- `git log --oneline -5 -- <path>` for recent activity
- Toolchain details from `.goat-flow/config.yaml`
- Architecture notes from `.goat-flow/architecture.md` when relevant

**Degraded context:** Not all sources will exist. Handle gracefully:

| Source | Missing? | Action |
|--------|---------|--------|
| `.goat-flow/config.yaml` | Yes | Skip toolchain and ask_first. Note: "No config.yaml — toolchain unknown." |
| `.goat-flow/footguns/` | Empty or missing | Note: "No footguns recorded." Proceed normally. |
| `.goat-flow/architecture.md` | Missing | Note: "No architecture doc." |
| `git log` | No git or no history | Note: "No git history available." |
| Instruction file | Missing | STOP. goat-flow is not set up. Suggest running setup. |

**Minimum viable brief:** The dispatcher can route with just the user's request and the instruction file.

Build the brief from whatever is available:
> "User wants to [intent] on [target]. Ask First: [boundary or none]. Footgun: [entry or none]. Recent git: [summary or no history]. Toolchain: [summary or unknown]."

## ROUTE

**Skill routes:**
- **Planning Route** — feature briefs and mob elaboration (dispatcher handles directly)
- **/goat-plan** for milestone task file creation, progress tracking, and milestone management
- **/goat-debug** for diagnosis, investigation, and onboarding
- **/goat-review** for code review, audits, instruction-file review, and simplify work
- **/goat-sbao** for multi-perspective critique of any artifact
- **/goat-security** for threat models, compliance work, dependency audits, and auth/authz assessment
- **/goat-test** for testing gap analysis, coverage audit, and regression guards

**Direct execution route:**
When no skill fits because the request is straightforward implementation:
1. Present gathered context that's relevant: Ask First boundaries, footgun matches, recent git
2. State the scope: "Implementing [X]. Changing [files]. No skill needed."
3. Proceed with READ → SCOPE → ACT → VERIFY

The gathered context becomes the SCOPE declaration for the execution loop.

**Handoff rule:**
- Pass the enriched brief to the target skill
- If depth was discussed, include it — the target skill skips its own depth question

**Routing announcement:** Include a one-line rationale with every route:
> "Routing to `/goat-debug` — you described a symptom ([symptom]), and the target is [area]."

## Planning Route

Planning follows the same UNDERSTAND → GATHER → ROUTE flow:

**UNDERSTAND:** Classify the planning need:
- "plan a feature" / "new project" → Feature brief
- "sharpen requirements" / "what are we missing" → Mob elaboration
- "break this into milestones" / "what's the sequence" → Route to `/goat-plan`
- "rename" / "extract" / "restructure" → Refactor template
- "is this plan any good" / "critique" → Route to `/goat-sbao`

**GATHER:** Same as skill routing, plus check `.goat-flow/tasks/` for existing plans. If a plan already exists: "Plan exists for [topic]. Continue from here, start fresh, or `/goat-sbao` to critique it?"

### Feature Brief

Walk through each section ONE AT A TIME. Present one, wait for confirmation, then present the next:

1. **Problem** — what's wrong or missing (1-2 sentences)
2. **Proposed solution** — high-level approach
3. **Risks / kill criteria** — what could go wrong, what would make us abandon this
4. **Rollback plan** — how to undo if it fails
5. **Scope** — in/out with explicit exclusions
6. **Dependencies** — blocks / blocked by
7. **Success criteria** — measurable outcomes
8. **Open questions** — unknowns that need answers

**Minimum viable brief:** Problem + Scope + Kill Criteria. The user can skip after any section.

Ask the question whose answer could invalidate the approach FIRST.

**CHECKPOINT:** "Brief complete. Want to run mob elaboration to sharpen requirements, or go straight to `/goat-plan` for milestone breakdown?"

### Mob Elaboration

Triggered after a feature brief when requirements need sharpening, or when the user explicitly asks.

**Do not use for:** Hotfix or Small Feature complexity. Skip and go to milestones.

For each round, ask exactly 3 to 5 clarifying questions. Prioritise:
1. Business rules and hard constraints
2. Edge cases and failure modes
3. Integration points with the existing system
4. User-visible outcomes and acceptance criteria
5. Non-goals and blast-radius limits

**Question quality bar:**
- Ask about what could change behaviour, not what is easy to infer
- Prefer questions grounded in the current codebase when context is available
- If there are multiple plausible interpretations, present the fork clearly

After asking, STOP and wait for answers. Do NOT answer your own questions.

**Exit signals — suggest locking when:**
- Two consecutive rounds produce no new scope changes
- The user's answers are getting shorter or more confirmatory
- All HIGH-priority ambiguities from round 1 have answers

**Hard cap:** Do NOT exceed 4 rounds without asking: "We've done [N] rounds. Ready to lock?"

**When locked:** Synthesise into a requirements summary:
- **Locked Requirements** — what must happen
- **Non-Goals** — explicitly out of scope
- **Constraints** — technical, product, operational
- **Failure Modes / Edge Cases** — cases the plan must handle
- **Integration Notes** — which existing systems this fits into
- **Open Decisions** — true decisions still requiring a human call

Write to `.goat-flow/tasks/requirements-<feature-name>.md`, or return inline.

**CHECKPOINT:** "Requirements locked. Want `/goat-plan` to break this into milestone task files?"

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
| "check the auth code" | debug vs review vs security | "Do you want to find a bug, review quality, or assess security?" |
| "plan the feature" | brief vs milestones | "Do you want to work through requirements (I'll handle that), or break it into milestone task files (/goat-plan)?" |
| "update the plan" | brief vs milestones | "Are you updating requirements/scope (I'll handle that), or updating milestone tasks and progress (/goat-plan)?" |
| "improve the caching" | plan vs review | "Is this a new design (planning), a restructure (refactor template), or a readability cleanup (/goat-review)?" |
| "help with the migration" | plan vs debug | "Are we planning the migration, or fixing one that's failing (/goat-debug)?" |
| "analyse a plan" | review vs sbao | "Do you want problems found in the plan (/goat-review), or multi-perspective critique (/goat-sbao)?" |
| "get a second opinion" | goat-sbao vs goat-review | "Do you want structured multi-agent critique, or a single-pass code review?" |

## Bare Invocation

If the user types just `/goat` with no arguments:

> **Skills available:**
> - `/goat-debug` — diagnose bugs, investigate unfamiliar code
> - `/goat-plan` — milestone task files, progress tracking
> - `/goat-review` — code review, quality audit, simplify
> - `/goat-sbao` — multi-perspective critique of any artifact
> - `/goat-security` — threat model, dependency audit, compliance
> - `/goat-test` — testing gap analysis, coverage audit, regression guards
>
> **Planning** (I handle directly):
> - Feature briefs, mob elaboration, refactor planning
>
> **Examples:**
> - `/goat fix the login bug` → debug
> - `/goat review the PR` → review
> - `/goat plan the new feature` → planning route
> - `/goat break this into milestones` → goat-plan
> - `/goat critique this plan` → sbao
> - `/goat check for security issues` → security
> - `/goat what's untested` → test
> - `/goat rename this helper` → direct execution
>
> Or describe what you're working on and I'll route it.

If the user types `/goat help [skill]`, read that skill's "When to Use" and summarise it.

## Override

If the user names a skill explicitly, respect it. Accept any form:
- `/goat debug the auth code` — skill name as first word
- `/goat --debug the auth code` — flag style
- `/goat use goat-debug on the auth code` — explicit reference
- `/goat goat-debug the auth code` — full skill name

All forms are equivalent. Do not second-guess explicit overrides.

## Re-Route

If the user signals they're in the wrong skill mid-workflow ("wrong skill", "switch to debug", "this is actually a review"):

1. **Preserve context:** Capture what the current skill has gathered — files read, findings, scope
2. **Build handoff brief:** Combine the original dispatcher brief with the current skill's context
3. **Route to correct skill:** Pass the enriched brief. The new skill confirms and proceeds — no re-gathering
4. If the user says "start over," discard context and re-run from UNDERSTAND.

## Routing Feedback

When the user corrects a route (re-route, "wrong skill", or immediately invokes a different skill):

Log to `.goat-flow/lessons/` under the `routing` category:
> **Lesson: Routing — [what happened]**
> User asked "[request]". Dispatched to [skill]. User corrected to [correct skill].
> Why it was wrong: [best guess]. Prevention: [pattern to recognise next time].

This is a MECHANICAL TRIGGER — a routing correction IS a learning loop event.

## Constraints

- MUST understand intent conversationally, not via keyword lookup
- MUST ask zero, one, or two clarifying questions maximum — never three
- MUST route and state assumption when two questions haven't resolved ambiguity
- MUST gather available context before routing — degrade gracefully when sources are missing
- MUST present gathered context when routing to direct execution
- MUST pass one enriched brief to one target skill on handoff
- MUST include a one-line routing rationale with every route announcement
- MUST respect explicit skill overrides regardless of syntax variation
- MUST log routing corrections to `.goat-flow/lessons/` as a mechanical trigger
- MUST check for existing plans before starting a new planning session
- MUST leave all 6 skills directly invocable
- Planning: MUST NOT offer mob elaboration for Hotfix or Small Feature complexity
- Planning: MUST check kill criteria between milestones

## Post-Dispatch Chaining

After the routed work closes, suggest the next move based on what happened:

| Completed | Outcome | Suggest |
|-----------|---------|---------|
| Planning Route | Brief/requirements ready | "Want `/goat-plan` to break this into milestones?" |
| goat-plan | Milestones created | "Ready to implement M01, or `/goat-sbao` to critique the plan?" |
| goat-debug | Simple fix, high confidence | "Fix looks clean. `/goat-test` regression mode for a guard?" |
| goat-debug | Complex root cause | "This touched [N] files. `/goat-review` on the fix, or `/goat-test` for coverage?" |
| goat-review | MUST findings found | "Critical findings need fixing. After fixes, re-run `/goat-review` or `/goat-test`?" |
| goat-review | Clean review | "All clear. Moving on?" |
| goat-sbao | Consensus recommendations | "Ready to implement, or `/goat-plan` to update milestones?" |
| goat-sbao | Disputed findings | "Some findings disputed. Resolve manually, or re-run with different framing?" |
| goat-security | CONFIRMED findings | "Critical security findings. Fix first, then `/goat-review` on the fixes." |
| goat-test | Gaps identified | "Coverage gaps found. `/goat-plan` to add testing tasks to the milestone?" |
| goat-test (audit) | Low coverage | "Significant gaps. Write tests for HIGH-risk gaps?" |

One suggestion, not a menu. Only suggest if the user hasn't moved on.

## Output Format

The dispatcher announces the route and hands off. No standalone deliverable.
