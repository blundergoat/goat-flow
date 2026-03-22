---
name: goat-onboard
description: "Systematically map an unfamiliar codebase and draft project coding guidelines"
---
# /goat-onboard

## When to Use

When joining a new project or onboarding to an unfamiliar codebase. Use to build understanding before making changes. Produces an architecture overview and drafts `ai/instructions/` content for human review. No files are written until the human approves.

---

## Step 0 — Gather Context

Ask the user before onboarding:

1. **What project?** (repo URL or directory)
2. **What do you need to understand?** (everything, specific area, or specific question)
3. **Any existing docs to start from?** (README, architecture docs, onboarding guides)
4. **What's your role?** (contributor, reviewer, maintainer)

Do NOT start reading until the user has answered. Onboarding without a clear goal produces noise, not signal.

---

## Phase 1 — Stack Detection

Detect the project's technology stack:

1. **Languages** — scan file extensions, read build configs
2. **Frameworks** — read `package.json`, `go.mod`, `Cargo.toml`, `requirements.txt`, `Gemfile`, `pom.xml`, etc.
3. **Build system** — Makefile, npm scripts, Gradle, Bazel, etc.
4. **Test framework** — identify test runner, test directory structure, test conventions
5. **Directory structure** — map top-level layout and key subdirectories
6. **Entry points** — identify main files, CLI entrypoints, server startup, request handlers

Present findings to the user.

**HUMAN GATE:** "Here's what I detected. Want me to (a) correct something, (b) focus on a specific area, (c) proceed to critical paths, or (d) skip to a specific component?"

Wait for confirmation before reading deeper.

---

## Phase 2 — Critical Path Tracing

Read entry points and follow the most important code paths:

1. **Primary flows** — API routes, main loop, request handling, CLI commands
2. **Component boundaries** — where modules interface with each other
3. **Risk areas** — authentication, authorization, data persistence, external integrations
4. **Configuration** — environment variables, feature flags, runtime config
5. **Error handling** — how failures propagate, logging patterns

**Read budget:** pause after 10 files. "I've read [N] files. Want me to continue deeper or present what I have?"

**HUMAN GATE:** "Here's what I've traced so far. Want me to (a) trace a specific path deeper, (b) check a boundary I missed, (c) proceed to drafting, or (d) map a different area?"

Do NOT auto-advance. Let the human dig deeper on specific components, ask follow-up questions, or redirect before drafting.

---

## Phase 3 — Draft Instructions

Draft `ai/instructions/` content **inline** (DO NOT write files). Present proposed content for:

- **conventions.md** — project conventions (naming, structure, error handling, logging patterns)
- **Domain files** — `backend.md`, `frontend.md`, `infra.md`, etc. as needed based on what was found
- **code-review.md** — project-specific review standards (common mistakes, required checks, style norms)

Each section must be grounded in code evidence found during Phases 1-2. No aspirational content — only what the codebase actually does.

**MUST present inline — do NOT auto-populate `ai/instructions/`.**

**HUMAN GATE:** "Here's what I'd put in your instruction files. Want me to (a) approve and I'll write them, (b) revise specific sections, (c) add more areas, or (d) reject — I'll write them myself?"

Wait for explicit approval before writing any files.

---

## Phase 4 — Verification

For any approved content, before writing:

1. **Verify every file path** referenced in the instructions actually exists
2. **Verify commands** mentioned in the instructions actually work
3. **Remove aspirational content** — if the codebase doesn't do it yet, don't document it as a convention
4. **Source of truth is code, not docs** — if docs and code disagree, follow the code and flag the discrepancy

Only after verification passes, write the approved files.

---

## Constraints

- MUST gather context before onboarding (Step 0)
- MUST pause at read budget (10 files) and check in with the human
- MUST present all content inline before writing any files
- MUST NOT auto-populate the cold path — auto-generated context reduces success ~3% and increases cost 20%+
- MUST NOT fabricate file paths, function names, or behaviour
- MUST verify all claims against actual code before writing instructions
- MUST wait for explicit human approval before writing any `ai/instructions/` files
- MUST ground every convention in observed code, not assumptions

---

## Output Format

```
## Architecture Overview
[One paragraph: what this project is, what it does, how it's structured.]

## Component Map
[Directory tree with annotations]

## Critical Paths
1. [path name] — [file:line] -> [file:line] -> [file:line]
2. [path name] — [file:line] -> [file:line] -> [file:line]

## Risk Areas
1. [file:line] — [risk description]
2. [file:line] — [risk description]

## Proposed ai/instructions/ Content

### conventions.md
[inline content]

### [domain].md
[inline content]

### code-review.md
[inline content]
```

---

## Severity Scale

Prioritize findings: **SECURITY > CORRECTNESS > INTEGRATION > PERFORMANCE > STYLE**

Every claim backed by file:line reference. Flag unknowns explicitly: "I couldn't determine X because Y."

---

## Learning Loop

If this onboarding uncovered a lesson or footgun, update the relevant doc before closing:
- Behavioural mistake -> `docs/lessons.md`
- Architectural trap with file:line evidence -> `docs/footguns.md`

---

## Chains With

- **goat-plan** — onboarded area needs planning work
- **goat-investigate** — deeper investigation of a specific component
