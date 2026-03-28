---
name: goat-investigate
description: "Deep codebase investigation with progressive depth reading, evidence tagging, and structured reporting. Includes onboarding mode for new projects."
goat-flow-skill-version: "0.7.0"
---
# /goat-investigate

## Shared Conventions

- **Severity:** SECURITY > CORRECTNESS > INTEGRATION > PERFORMANCE > STYLE
- **Evidence:** Every finding needs `file:line`. Tag as OBSERVED (verified) or INFERRED (state what's missing). MUST NOT fabricate.
- **Gates:** BLOCKING GATE = must stop for human. CHECKPOINT = report status, continue unless interrupted.
- **Adaptive Step 0:** If context already provided, confirm it — don't re-ask. Only hard-block with zero context.
- **Stuck:** 3 reads with no signal → present what you have, ask to redirect.
- **Learning Loop:** Behavioural mistake → `docs/lessons.md`. Architectural trap → `docs/footguns.md`.
- **Closing:** Commit or note working artifacts. Check learning loop. Suggest next skill.

## When to Use

Use when exploring an unfamiliar codebase area to understand how it works —
before refactoring, mapping dependencies, understanding a subsystem, or
onboarding to a new project.

**NOT this skill:**
- Bug diagnosis with a specific symptom → /goat-debug
- Security assessment with a threat model → /goat-security
- Reviewing a specific diff or PR → /goat-review
- Planning implementation of a known feature → /goat-plan

## Step 0 — Gather Context

<!-- ADAPT: Replace illustrative questions (3, 4) with project-specific options -->

**Structural questions (always ask or confirm):**
1. What are we investigating? (subsystem, feature area, dependency, domain)
2. Why? (understanding before changes, onboarding, mapping dependencies, "just curious")

**Illustrative questions (adapt for your project):**
3. <!-- ADAPT: "Which layer? (e.g., API handlers, database models, frontend state)" -->
4. How deep should this go? (surface scan / full trace / "just map it out")

**Read budget:** Default 8 files. Narrow scope: 5. Broad scope: 12.
Confirm or adjust with the user.

**If purpose = onboarding** → activate onboard mode (see below).

## Phase 1 — Scope & Plan

Declare scope before reading deeply:
- **In scope:** [files, directories, or patterns to examine]
- **Out of scope:** [what we're explicitly NOT investigating]
- **Read budget:** [N files before pausing for check-in]

Read `docs/footguns.md` for entries mentioning the target area. Present any
matches: "This area has a known footgun: [entry]. Keep this in mind."

**BLOCKING GATE:** Present scope to user. "I'll investigate [scope] reading
up to [N] files. Anything to adjust?"

## Phase 2 — Read (Progressive Depth)

Read in layers — don't try to understand everything at once:

1. **Entry points** — where execution starts for this area
   Search for files by pattern, then search file contents for cross-references.
2. **Critical path** — the main flow through the area
   Read key files. For deep subsystem dives, use parallel exploration if available.
3. **Supporting files** — helpers, utilities, configs that the critical path depends on

For each file read, log:
- What role it plays
- What it connects to
- Whether evidence is OBSERVED (verified in code) or INFERRED (deduced)

**CHECKPOINT:** At read budget limit, report: "[N] files read. Key findings so far:
[summary]. Continue reading, or present findings?"

**Noise awareness:** If a search returns irrelevant results, drop them.
Semantic noise is worse than no results.

## Phase 3 — Report

Produce the Investigation Report using the Output Format template below. Every section is required.

Key sections that prevent false confidence:
- **What I Didn't Read** — REQUIRED. List files/areas skipped with reasons (too many, lower priority, needs additional context). If you examined 8 of 30 files, say so.
- **Current vs Expected State** — for each finding, state what IS vs what SHOULD BE.
- **Evidence tags** — OBSERVED for things verified in code. INFERRED for deductions (state what direct evidence is missing).
  *Example:* "OBSERVED: `auth.ts:47` uses `<` instead of `<=` for token expiry —
  verified by reading the line. INFERRED: this likely causes premature token
  rejection *(missing: need to verify with a test)*."

**BLOCKING GATE:** Present full report. Offer:
(a) go deeper into a specific area
(b) check a boundary I didn't cross
(c) map a different area
(d) close the investigation

## Onboard Mode

Activated when Step 0 purpose = "onboarding" / "new to this project" / "need to set up instructions."

**Phase 0.5 — Stack Detection** (before Phase 1):
<!-- ADAPT: Adjust file patterns for your project's stack -->
1. Languages: scan file extensions, read build configs (package.json, composer.json, Cargo.toml, go.mod, pyproject.toml, Gemfile, *.csproj)
2. Frameworks: identify from dependencies and directory patterns
3. Build/test/lint: extract commands from config files
4. Directory structure: map top-level organization
5. Entry points: identify main files per component

Present findings: "This project uses [languages] with [frameworks]. Build: [cmd], Test: [cmd]. Correct?"

**Phase 4 — Instruction Drafting** (after Phase 3, if user requests):
- Present all content inline BEFORE writing any files
- Source of truth is code, not docs — verify every claim against actual files
- <!-- ADAPT: Target ai/instructions/ or .github/instructions/ based on project convention -->
- MUST NOT include aspirational content — only document what currently exists

**BLOCKING GATE:** Present drafted instructions. "Write these files, or adjust first?"

## Common Failure Modes

1. **Over-reading** — agent reads 30 files without pausing at the budget. The read budget checkpoint prevents this.
2. **Everything is OBSERVED** — agent tags all findings as OBSERVED when many are inferred. Require: "INFERRED findings must state what direct evidence is missing."
3. **Encyclopedic summary** — agent produces a comprehensive description that answers no specific question. The TL;DR + scope question keep output focused.

## Constraints

<!-- FIXED: Do not adapt these -->
- MUST declare scope before deep reading
- MUST tag evidence as OBSERVED or INFERRED
- MUST include "What I Didn't Read" in every report
- MUST NOT propose implementation or planning — investigation only
- MUST NOT fabricate file paths or function names
- MUST respect the read budget — pause at limit, don't silently exceed

## Output Format

```markdown
## TL;DR
<!-- 3 sentences: scope, key finding, recommendation -->

## Components
| Component | Location | Role |
|-----------|----------|------|

## Data Flow
<!-- Mermaid.js diagram or prose description -->

## Boundaries Touched
<!-- Which module/service/API boundaries does this area cross? -->

## Risks / Gotchas
<!-- Minimum 3, with file:line evidence -->
- `file:line` — [risk] — Evidence: OBSERVED | INFERRED

## Current vs Expected State
| Aspect | Current | Expected | Gap |
|--------|---------|----------|-----|

## Open Questions
<!-- What couldn't be determined from reading code alone? -->

## What I Didn't Read
<!-- Files/areas skipped. Reason: too many | lower priority | needs context -->

## Recommendation
<!-- What should happen next? Chain to which skill? -->
```

## Chains With

- /goat-plan — investigation reveals need for structured planning
- /goat-debug — investigation uncovers a specific bug → switch to diagnosis
- /goat-security — investigation reveals security concerns → deeper assessment
- /goat-refactor — investigation maps code that needs restructuring

**Handoff shape:** `{scope, components, boundaries, risks, open_questions}`
