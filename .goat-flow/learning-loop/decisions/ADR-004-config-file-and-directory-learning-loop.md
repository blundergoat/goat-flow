# ADR-004: Config File and Directory-Based Learning Loop

**Status:** Accepted
**Updated:** 2026-05-18 - repaired absorbed-history reference to the now-removed `ADR-021-category-bucket-learning-loop.md`; the current ADR-021 covers goat-critique mode.
**Date:** 2026-03-31

## Context

Phase M1b needs a stable configuration surface and scalable learning-loop format. Single-file `docs/footguns.md` and `ai/lessons.md` were becoming difficult to merge and caused PR noise in multi-agent workflows. We also needed a place to split local vs committed knowledge without overloading committed history.

Cross-repository review during the milestone planning showed recurring pressure to keep project-specific and team-wide learning loops separate, while still allowing scanner enforcement to enforce local conventions.

The first directory-based attempt used one incident per file. That removed the monolith, but it created 51 small files (20 footguns + 31 lessons), poor pattern visibility, and too much navigation overhead. The current record therefore needs to capture both the move into directories and the later refinement to category buckets.

## Decision

Adopt a YAML config file at `.goat-flow/config.yaml` with explicit paths for learning-loop sources:

- `footguns.path`: footgun entries (default `.goat-flow/learning-loop/footguns/`)
- `lessons.path`: lesson entries (default `.goat-flow/learning-loop/lessons/`)
- `decisions.path`: decision directory (`.goat-flow/learning-loop/decisions/`)
- `plans.path`: plan workspace (`.goat-flow/plans/`)
- `agents`: detected agent list or explicit override
- `skills.install`: explicit skill list or `all`

Replace monolithic `docs/footguns.md` and `ai/lessons.md` with directory formats:

- Directory-level `README.md` containing any preamble
- `.goat-flow/learning-loop/footguns/` and `.goat-flow/learning-loop/lessons/` for all entries
- `learning-loop/decisions/` for durable architecture history and `plans/` for local planning state

Within `footguns/` and `lessons/`, the current committed format is **category bucket files**, not one incident per file:

- **Footguns:** `.goat-flow/learning-loop/footguns/<category>.md` such as `hooks.md`, `auditor.md`, `setup.md`
- **Lessons:** `.goat-flow/learning-loop/lessons/<category>.md` such as `verification.md`, `agent-behavior.md`
- Each footgun entry uses `## Footgun: <name>` plus `Status / Created / Evidence`
- Each lesson entry uses `## Lesson: <name>` or `## Pattern: <name>` plus `Created`
- Create a new category only when no existing category fits
- Split a bucket at roughly 200 lines or 10 entries

Add `.goat-flow/` to the template `.gitignore` and scaffolding so per-session artifacts are gitignored:
- `.goat-flow/plans/` + logs
- `.goat-flow/learning-loop/footguns/`, `.goat-flow/learning-loop/lessons/`

## Rationale

- Directory entries remove monolithic merge conflicts and scale with project growth.
- Scanner logic becomes path-configurable and resilient to repo-specific layouts.
- Local/session-only entries stop contaminating committed history while still staying queryable by tools.
- YAML config makes behavior explicit and reviewable, and can be upgraded without hardcoded assumptions.
- Category buckets preserve the directory benefits while avoiding the file explosion of one-incident-per-file.
- Grouping related lessons and footguns makes patterns visible in a way isolated incident files cannot.

## Consequences

- Scanning and setup now read and validate config before applying paths.
- Setup seeds config plus directory scaffolding, and prompts direct users at directory paths.
- Scan checks now verify both committed and local learning-loop directories and treat both in score/reporting.
- Scanner/audit counting moved from “files exist” to heading-based counts such as `## Footgun:` and `## Lesson:`
- Evidence parsing needs to accept both `**Evidence type:**` and `**Evidence:** ACTUAL_MEASURED`
- All instruction files, workflow templates, and setup docs need to reference the bucket format, not the short-lived one-incident-per-file layout
