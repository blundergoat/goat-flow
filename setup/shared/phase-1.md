# Phase 1 — Foundation (shared across all agents)

This phase works for ALL projects — new, existing, partially set up, or outdated.
It always audits the current state before making changes.

The agent-specific setup file (setup-claude.md, setup-codex.md, setup-gemini.md)
tells you WHICH instruction file and settings to create. This file tells you
HOW to build the content.

---

## Phase 1a — Instruction File + Docs

```
Read setup/shared/execution-loop.md FIRST — this is the authoritative
template for instruction file sections. If the project has docs/system-spec.md,
read it for background context. If they conflict, execution-loop.md wins.

STEP 0 - Detect stack and current state:
1. Detect the project's languages, build/test/lint/format commands by
   reading package.json, Cargo.toml, go.mod, composer.json, pyproject.toml,
   Gemfile, *.csproj, or equivalent. List what you find.
2. Check if the instruction file already exists. If it does, read it completely.
3. Check for other agent instruction files (CLAUDE.md, AGENTS.md, GEMINI.md).
   If multiple exist, this is a multi-agent project — coordinate content.
4. Check for existing scripts/ (preflight, validation, deny-dangerous).
5. Check for existing agent settings and hooks — note what exists.
6. Check for existing docs/ (footguns.md, lessons.md, architecture.md)
   and agent-evals/ — note what already exists so later steps merge,
   not replace.

STEP 1 - Instruction file (create or rewrite):
If the instruction file does NOT exist:
- Create it with the sections listed in setup/shared/execution-loop.md.

If the instruction file DOES exist:
- Read it completely.
- Separate domain knowledge from agent instructions:
  Domain content = describes HOW THE PROJECT WORKS (move to docs/domain-reference.md)
  Agent instructions = commands the agent with imperative verbs (keep)
  Test: "The API uses chi router on port 8080" → domain knowledge → MOVE
  Test: "Never create middleware.ts" → agent instruction → KEEP
- If domain content was moved, create docs/guidelines-ownership-split.md
  documenting what was moved and why.
- Rewrite with the sections from setup/shared/execution-loop.md,
  preserving any existing agent-behavioural rules that are still valid.

For ALL projects:
- Target: under 120 lines. Hard limit: 150.
- Adapt all examples and Ask First boundaries for THIS project.
- Do NOT skip sections (f)–(i) — they are small but required.
- The loop MUST be: READ → CLASSIFY → SCOPE → ACT → VERIFY → LOG.
- CLASSIFY MUST include read/turn budgets per complexity tier.
- If other agent instruction files exist, include multi-agent coordination
  in LOG. Router table MUST cross-reference them.
- If scripts/ has existing preflight or validation scripts, use them
  instead of writing new ones.

STEP 2 - Docs seed files:
Create the files listed in setup/shared/docs-seed.md.
If docs/footguns.md or docs/lessons.md already exist, MERGE — do not replace.
Read existing content first, add new entries from the codebase, keep all
existing entries. Only create files that don't already exist.

STEP 3 - Local instruction files (Layer 2):
Read docs/footguns.md and the codebase structure. For directories with
2+ footgun entries, Ask First boundaries, or differing conventions:
create a local instruction file (under 20 lines each).
Skip directories already covered by .github/instructions/ files.
If no directories qualify, create none and note why.

VERIFICATION (all MUST pass before proceeding to Phase 1b):
- GATE: Count instruction file lines. MUST be under 120.
- GATE: Verify all docs seed files exist.
- GATE: Report line count and number of local instruction files.
Do NOT proceed to Phase 1b until all gates pass.
```

---

## Phase 1b — Skills

```
Use the stack detected in Phase 1a Step 0 (languages and frameworks).

PRE-EXISTING SKILLS:
If non-goat-prefixed skills exist (e.g., audit/, review/, preflight/),
IGNORE them — they are the project's custom skills. Do not modify, delete,
or merge them. Focus ONLY on creating/updating the 8 goat-* skills.

SKILL VERSION AUDIT:
If goat-* skills already exist, check the goat-flow-skill-version tag in
each skill's YAML frontmatter. If the version is missing or does not match
the current goat-flow version:
1. Read the current template from workflow/skills/goat-{name}.md
2. Compare EVERY section against the installed skill — look for new
   sections, renamed phases, structural changes, or improved guidance
3. The template may contain valuable upgrades (better prompts, new gates,
   improved output formats) — do not assume the old version is fine
4. Update the skill content to match the current template structure
5. Update the goat-flow-skill-version tag to the current version
This is NOT a cosmetic update — skill templates improve with each release.

Read the detailed skill templates in workflow/skills/goat-*.md for each
skill's full specification before creating or updating.

Create or update these 8 skills in the agent's skills directory:

1. goat-investigate/SKILL.md - Deep codebase investigation + onboarding mode.
   Progressive depth reading, evidence tagging, "What I Didn't Read" section.
2. goat-review/SKILL.md - Structured code review + quality audit mode +
   instruction review mode. RFC 2119 severity, negative verification, footgun matching.
3. goat-security/SKILL.md - Threat-model-driven security assessment.
   Framework-aware verification, exploitability ranking, dependency auditing.
4. goat-debug/SKILL.md - Diagnosis-first debugging. Hypothesis tracking,
   recurrence checks. "If you want to 'just try something', STOP."
5. goat-plan/SKILL.md - 4-phase planning with complexity routing.
   Triangular tension analysis, kill criteria, milestone archetypes.
6. goat-test/SKILL.md - 3-phase test plan generation. Doer-verifier principle:
   coding agent MUST NOT verify its own work.
7. goat-refactor/SKILL.md - Cross-file refactoring with blast radius analysis,
   both-sides-first reading, and absence verification.
8. goat-simplify/SKILL.md - Code readability improvement. Naming analysis,
   self-documentation, comment audit, complexity reduction. MUST NOT change behavior.

**Migration:** goat-reflect merged into goat-review (instruction review mode).
goat-onboard merged into goat-investigate (onboard mode). goat-audit merged
into goat-review (audit mode). goat-context removed. If old skills exist,
delete them after verifying no project-specific content needs migrating.

Each skill MUST include in its YAML frontmatter:
  goat-flow-skill-version: matching the current goat-flow version

Each skill MUST include these sections:
- When to Use (specific triggers, not generic)
- Step 0 / Gather Context (questions to ask before starting)
- Process with phased steps and human gates between phases
- Constraints (MUST/MUST NOT rules)
- Output Format (expected deliverable structure)
- Chaining (what skill to suggest next)

Adapt all examples for THIS project's tech stack. Do NOT leave placeholder
text like "[Step 1]" or "[describe X]".

VERIFICATION (all MUST pass before proceeding to Phase 1c):
- GATE: Verify all 8 goat-* skill files exist with required sections.
- GATE: Verify instruction file router table references the skill directories.
- GATE: Run scripts/preflight-checks.sh if it exists, otherwise run the
  project's lint + test commands from Essential Commands.
Do NOT proceed to Phase 1c until all gates pass.
```

---

## Phase 1c — Coding Guidelines

```
Check for existing coding guidelines in the project:
- .github/instructions/*.md
- ai/instructions/*.md
- Any project-specific code-review, git-commit, or conventions docs

RULES:
- Do NOT delete or alter existing coding convention documents.
  The project knows its own inhouse rules better than templates.
- Do NOT override existing git-commit or code-review instructions.
- DO create ai/README.md as a routing map pointing to all guideline files.
- DO create ai/instructions/ files where gaps exist.

If .github/instructions/ exists:
- Read existing files — these are the project's canonical conventions.
- Create ai/README.md as routing map linking to both ai/instructions/
  and .github/instructions/ files.
- Create ai/instructions/backend.md and ai/instructions/frontend.md
  ONLY if the existing instructions don't cover those domains.
  Base new files on workflow/coding-standards/ templates but adapt
  for this project. Link to existing conventions where they overlap.

If no instruction files exist:
- Create ai/README.md (routing map)
- Create ai/instructions/conventions.md (from workflow/coding-standards/conventions.md)
- Create ai/instructions/code-review.md (from workflow/coding-standards/code-review.md)
- Create ai/instructions/git-commit.md (from workflow/coding-standards/git-commit.md)
- Create ai/instructions/backend.md and/or ai/instructions/frontend.md
  based on detected stack (from workflow/coding-standards/backend/ and frontend/ templates)

VERIFICATION after creating ai/instructions/ files:
1. Verify every file path referenced actually exists (ls)
2. Verify commands work: run build/test/lint commands listed in conventions.md
3. Remove aspirational content — only document current state, not roadmaps

Add to instruction file Router Table:
| Project guidelines | `ai/README.md` |
```
