# Prompt: Create /goat-onboard Skill

Paste this into your coding agent to create the `/goat-onboard` skill for your project.

---

## The Prompt

```
Create the /goat-onboard skill for this project.

## When to Use

When joining a new project or onboarding to an unfamiliar codebase.
Use to build understanding before making changes. Produces an
architecture overview and drafts ai/instructions/ content for human
review. No files are written until the human approves.

Write the skill file to: .claude/skills/goat-onboard/SKILL.md
(For Codex/Gemini: .agents/skills/goat-onboard/SKILL.md)

## Step 0 - Gather Context

Before onboarding, the skill MUST ask the user:
1. What project? (repo URL or directory)
2. What do you need to understand? (everything, specific area, or
   specific question)
3. Any existing docs to start from? (README, architecture docs,
   onboarding guides)
4. What's your role? (contributor, reviewer, maintainer)

Do NOT start reading until the user has answered. Onboarding without
a clear goal produces noise, not signal.

## Phase 1 - Stack Detection

Detect the project's technology stack:
1. Languages — scan file extensions, read build configs
2. Frameworks — read package.json, go.mod, Cargo.toml,
   requirements.txt, Gemfile, pom.xml, etc.
3. Build system — Makefile, npm scripts, Gradle, Bazel, etc.
4. Test framework — identify test runner, directory structure,
   test conventions
5. Directory structure — map top-level layout and key subdirectories
6. Entry points — identify main files, CLI entrypoints, server
   startup, request handlers

Present findings to the user.

HUMAN GATE: "Here's what I detected. Want me to (a) correct
something, (b) focus on a specific area, (c) proceed to critical
paths, or (d) skip to a specific component?"

Wait for confirmation before reading deeper.

## Phase 2 - Critical Path Tracing

Read entry points and follow the most important code paths:
1. Primary flows — API routes, main loop, request handling
2. Component boundaries — where modules interface with each other
3. Risk areas — auth, data persistence, external integrations
4. Configuration — env vars, feature flags, runtime config
5. Error handling — how failures propagate, logging patterns

Read budget: pause after 10 files. "I've read [N] files. Want me to
continue deeper or present what I have?"

HUMAN GATE: "Here's what I've traced so far. Want me to (a) trace
a specific path deeper, (b) check a boundary I missed, (c) proceed
to drafting, or (d) map a different area?"

Do NOT proceed to drafting until the human confirms the critical
paths are sufficiently mapped.

## Phase 3 - Draft Instructions

Draft ai/instructions/ content INLINE (DO NOT write files). Present
proposed content for:
- conventions.md — project conventions (naming, structure, error handling,
  logging patterns)
- Domain files — backend.md, frontend.md, infra.md, etc. as needed
- code-review.md — project-specific review standards

Each section must be grounded in code evidence found during
Phases 1-2. No aspirational content — only what the codebase
actually does.

MUST present inline — do NOT auto-populate ai/instructions/.

HUMAN GATE: "Here's what I'd put in your instruction files. Want
me to (a) approve and I'll write them, (b) revise specific sections,
(c) add more areas, or (d) reject — I'll write them myself?"

Wait for explicit approval before writing any files.

## Phase 4 - Verification

For any approved content, before writing:
1. Verify every file path referenced in instructions actually exists
2. Verify commands mentioned in instructions actually work
3. Remove aspirational content — if the codebase doesn't do it,
   don't document it as a convention
4. Source of truth is code, not docs — if docs and code disagree,
   follow the code and flag the discrepancy

Only after verification passes, write the approved files.

The skill MUST:
- Gather context before onboarding (Step 0)
- Pause at read budget (10 files) and check in with the human
- Present all content inline before writing any files
- Verify all claims against actual code before writing instructions
- Wait for explicit human approval before writing ai/instructions/
- Ground every convention in observed code, not assumptions

The skill MUST NOT:
- Auto-populate the cold path — auto-generated context reduces
  success ~3% and increases cost 20%+
- Fabricate file paths, function names, or behaviour
- Write any files before human approval
- Include aspirational content not grounded in code

VERIFICATION:
- Verify skill file exists at the correct path
- Verify Step 0 context gathering is present
- Verify stack detection step (Phase 1) with human gate
- Verify critical path tracing (Phase 2) with read budget
- Verify inline drafting (Phase 3) with human gate
- Verify Phase 3 does NOT auto-write files
- Verify verification step (Phase 4) is present
- Verify output format template is included
- Verify Learning Loop section is present
- Verify Chains With section is present

## Output

Architecture overview (one paragraph), component map (tree),
critical paths (numbered with file:line), risk areas (with
file:line), proposed ai/instructions/ content (inline, not written).

## Learning Loop

If this run uncovered a lesson or footgun, update the relevant
doc before closing:
- Behavioural mistake -> docs/lessons.md
- Architectural trap with file:line evidence -> docs/footguns.md

## Chains With

- goat-plan — onboarded area needs planning work
- goat-investigate — deeper investigation of specific component
```
