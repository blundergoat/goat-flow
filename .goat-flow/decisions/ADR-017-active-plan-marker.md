# ADR-017: Active-Plan Marker for `.goat-flow/tasks/`

**Status:** Accepted
**Date:** 2026-04-17
**Updated:** 2026-05-01
**Supersedes:** -
**Related:** M03 (`.goat-flow/tasks/1.2.0/M03-active-plan-marker.md`), `lessons/verification.md` "rename-survivor class" cross-reference fragility note.

## Context

`.goat-flow/tasks/` is local working state for milestone files, gitignored. On the goat-flow repo as of 2026-04-17 it holds 397 files across 6 top-level entries: `1.2.0/`, `1.4.0/`, `1.5.0/`, `_archived/`, `plugin-plan/`, `temp-list-of-rules.md` (plus `.gitignore`). `_archived/` alone holds prior versions, five `related-*/` research dirs, and screenshot dumps.

`/goat` and `/goat-plan` skills originally both instructed agents to scan `.goat-flow/tasks/` on Step 0 to inventory existing plans. With the directory in this state, the dispatcher and planner burned their read budget on archive clutter before they could plan. A coding-agent critique (2026-04-17) flagged this as the active failure mode.

## Decision

Adopt **Option B - marker file `.goat-flow/tasks/.active`**. Format: one-line, content = name of the active subdir relative to `.goat-flow/tasks/` (e.g. `1.2.0`). No trailing slash, no leading dot in the value.

`/goat-plan` owns `.active` lookup. If it exists and names an existing subdir, `/goat-plan` scans only that subdir. If `.active` is missing or names a missing subdir, `/goat-plan` treats that as normal local churn (completed plan, project switch, or no task workflow), lists top-level entries excluding `_archived`, prefers dirs with recent `M*.md` files, and asks the user which is current. `/goat` remains a router only: it classifies planning intent and routes to `/goat-plan` without reading task-state markers.

A referenced task path does not update or override `.active` by itself. If a user mentions `.goat-flow/tasks/<name>` without an explicit action verb, `/goat-plan` treats it as read-only orientation context, may report that `.active` currently points elsewhere, and must ask before switching `.active`, changing milestone status, or implementing code.

The install script (`workflow/install-goat-flow.sh`) writes `.active` automatically when exactly one `X.Y.Z`-named subdir exists at install time; otherwise leaves it for the skill's fallback path.

## Alternatives considered

**Option A - Directory rename (`active/`).** Rename the current plan's subdir to `active/` and have skills scan only that. **Rejected.** On the goat-flow repo, renaming `1.2.0/` → `active/` would break ~20 cross-references inside the 1.2.0 plan and additional cross-refs in `1.4.0/`. The rename-survivor failure class is documented in `lessons/verification.md`. The find-replace sweep needed is out of proportion to the problem.

**Option C - Version-derived from `config.yaml`.** Use `config.yaml:version` to compute the scan path: `.goat-flow/tasks/${version}/`. **Rejected.** Config version is semver-stable; task plan versions churn faster. On this repo today, `config.yaml` says `1.1.0` but active work is `1.2.0` - strict coupling would break. Pre-release work, experimental forks (`1.1.0_mono-skill/`), and version-lag projects all break this scheme.

## Consequences

**Wins:**
- No path rewrites; cross-refs stay valid.
- Multiple version subdirs coexist freely; users keep history without polluting the active scan.
- Marker is one line, trivially parseable from skills, install script, and any future audit check.

**Costs:**
- One more local pointer that can drift. Forgetting to update `.active` when starting a new plan version means the planner may need to ask which subdir is current.
- Hidden file (`.active`) is invisible to default `ls`; contributors who never `ls -la` may not notice it exists. Mitigated by the glossary entry, code-map note, and the install script's automatic write.
- `/goat-plan` must read the marker before the directory - a small protocol step, not a measurable performance cost. `/goat` must not duplicate this lookup.

**Future enforcement (rejected):** Do not add a setup-scope audit check that fails when `.active` is missing or names a missing subdir. Task state is gitignored local working state, not committed setup integrity. At most, future checks may verify skill fallback behavior or surface an advisory metric; they must not turn local pointer drift into a setup-quality failure.
