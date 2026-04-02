# ADR-018: Config File and Directory-Based Learning Loop

**Status:** Accepted
**Date:** 2026-03-31

## Context

Phase M1b needs a stable configuration surface and scalable learning-loop format. Single-file `docs/footguns.md` and `ai/lessons.md` were becoming difficult to merge and caused PR noise in multi-agent workflows. We also needed a place to split local vs committed knowledge without overloading committed history.

Cross-repository review during the milestone planning showed recurring pressure to keep project-specific and team-wide learning loops separate, while still allowing scanner enforcement to enforce local conventions.

## Decision

Adopt a YAML config file at `.goat-flow/config.yaml` with explicit paths for learning-loop sources:

- `footguns.committed`: canonical, committed entries (default `docs/footguns/`)
- `footguns.local`: session-local entries (default `.goat-flow/footguns/`)
- `lessons.committed`: canonical, committed entries (default `ai/lessons/`)
- `lessons.local`: session-local entries (default `.goat-flow/lessons/`)
- `decisions.path`: decision directory (`ai/decisions/`)
- `tasks.path`: task workspace (`.goat-flow/tasks/`)
- `agents`: detected agent list or explicit override
- `skills.install`: explicit skill list or `all`

Replace monolithic `docs/footguns.md` and `ai/lessons.md` with directory formats:

- One entry per file with YAML frontmatter
- Directory-level `README.md` containing any preamble
- `docs/footguns/` and `ai/lessons/` for committed entries
- `.goat-flow/footguns/` and `.goat-flow/lessons/` for local entries
- Migration in both directions via `split*` and `merge*` functions in `src/cli/migrate/`

Add `.goat-flow/` to the template `.gitignore` and scaffolding so per-session artifacts are gitignored:
- `.goat-flow/tasks/` + logs
- `.goat-flow/footguns/`, `.goat-flow/lessons/`

## Rationale

- Directory entries remove monolithic merge conflicts and scale with project growth.
- Scanner logic becomes path-configurable and resilient to repo-specific layouts.
- Local/session-only entries stop contaminating committed history while still staying queryable by tools.
- YAML config makes behavior explicit and reviewable, and can be upgraded without hardcoded assumptions.

## Consequences

- Scanning and setup now read and validate config before applying paths.
- Setup seeds config plus directory scaffolding, and prompts direct users at directory paths.
- Scan checks now verify both committed and local learning-loop directories and treat both in score/reporting.
- New migration utilities are required for rollback and for first-run migration from legacy monolithic files.
