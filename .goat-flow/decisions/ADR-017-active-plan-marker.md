# ADR-017: Active-Plan Marker for `.goat-flow/tasks/`

**Status:** Accepted
**Date:** 2026-04-17
**Supersedes:** —
**Related:** M03 (`.goat-flow/tasks/1.2.0/M03-active-plan-marker.md`), `lessons/verification.md` "rename-survivor class" cross-reference fragility note.

## Context

`.goat-flow/tasks/` is local working state for milestone files, gitignored. On the goat-flow repo as of 2026-04-17 it holds 397 files across 6 top-level entries: `1.2.0/`, `1.4.0/`, `1.5.0/`, `_archived/`, `plugin-plan/`, `temp-list-of-rules.md` (plus `.gitignore`). `_archived/` alone holds prior versions, five `related-*/` research dirs, and screenshot dumps.

`/goat` and `/goat-plan` skills both instruct agents to scan `.goat-flow/tasks/` on Step 0 to inventory existing plans. With the directory in this state, the dispatcher and planner burn their read budget on archive clutter before they can plan. A coding-agent critique (2026-04-17) flagged this as the active failure mode.

## Decision

Adopt **Option B — marker file `.goat-flow/tasks/.active`**. Format: one-line, content = name of the active subdir relative to `.goat-flow/tasks/` (e.g. `1.2.0`). No trailing slash, no leading dot in the value.

Skills (`goat`, `goat-plan` SKILL.md files) read `.active` first, then scan only the named subdir. If `.active` is missing, fall back to scanning top-level entries and asking the user which is current.

The install script (`workflow/install-goat-flow.sh`) writes `.active` automatically when exactly one `X.Y.Z`-named subdir exists at install time; otherwise leaves it for the skill's fallback path.

## Alternatives considered

**Option A — Directory rename (`active/`).** Rename the current plan's subdir to `active/` and have skills scan only that. **Rejected.** On the goat-flow repo, renaming `1.2.0/` → `active/` would break ~20 cross-references inside the 1.2.0 plan and additional cross-refs in `1.4.0/`. The rename-survivor failure class is documented in `lessons/verification.md`. The find-replace sweep needed is out of proportion to the problem.

**Option C — Version-derived from `config.yaml`.** Use `config.yaml:version` to compute the scan path: `.goat-flow/tasks/${version}/`. **Rejected.** Config version is semver-stable; task plan versions churn faster. On this repo today, `config.yaml` says `1.1.0` but active work is `1.2.0` — strict coupling would break. Pre-release work, experimental forks (`1.1.0_mono-skill/`), and version-lag projects all break this scheme.

## Consequences

**Wins:**
- No path rewrites; cross-refs stay valid.
- Multiple version subdirs coexist freely; users keep history without polluting the active scan.
- Marker is one line, trivially parseable from skills, install script, and any future audit check.

**Costs:**
- One more file to keep in sync. Forgetting to update `.active` when starting a new plan version means the planner scans the wrong subdir until the user notices.
- Hidden file (`.active`) is invisible to default `ls`; contributors who never `ls -la` may not notice it exists. Mitigated by the glossary entry, code-map note, and the install script's automatic write.
- Skills must read the marker before the directory — a small protocol step, not a measurable performance cost.

**Future enforcement (deferred):** A setup-scope audit check that validates `.active` exists AND names a subdir that exists is sketched in M03 Section 5 as optional. Not implemented in M03's main scope; revisit in 1.3.0+ if marker drift becomes a recurring class of failure.
