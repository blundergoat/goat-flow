# ADR-017: Active-Plan Marker for `.goat-flow/plans/.active`

**Status:** Accepted
**Date:** 2026-04-17
**Updated:** 2026-09-05 - condensed. The 2026-08-15 amendment corrected the status from "Superseded by ADR-033": ADR-033 moved the marker from `tasks/` to `plans/` and left these semantics in force.
**Related:** ADR-033 (marker path); `.goat-flow/learning-loop/footguns/docs-and-crossrefs.md` (search: `Cross-reference fragility across docs`).

## Context

The plan workspace is gitignored local state. On this repository it held hundreds of current, archived, experimental, and scratch entries, and both `/goat` and `/goat-plan` told agents to scan the whole directory at Step 0, so they spent their read budget on archive clutter before planning. A 2026-04-17 coding-agent critique flagged this as the active failure.

## Decision

`.goat-flow/plans/.active` holds one line naming the active plan subdirectory, and `/goat-plan` alone reads it.

- The value is the subdirectory name relative to the plan workspace: no trailing slash, no leading dot.
- If the marker names an existing subdirectory, `/goat-plan` scans only that. If it is missing or stale, that is normal local churn: list top-level entries excluding archive directories, prefer directories with recent `M*.md` files, and ask the user which is current.
- `/goat` is a router only. It classifies planning intent and hands off without reading the marker.
- Mentioning a plan path does not move the marker. Without an action verb, `/goat-plan` treats the path as read-only orientation, may report that the marker points elsewhere, and asks before switching it, changing milestone status, or implementing.
- `workflow/install-goat-flow.sh` (search: `ADR-017`) writes the marker when exactly one `X.Y.Z`-named subdirectory exists at install time; otherwise it leaves the skill's fallback to run.
- No setup-scope audit check may fail on a missing or stale marker. Plan state is local working state, not setup integrity; at most a future check may verify skill fallback behaviour or emit an advisory metric.

## Failure Mode Comparison

| Option | What fails | Verdict |
| --- | --- | --- |
| Rename the current plan directory to `active/` | Breaks cross-references inside local plan files, the class recorded in the footgun above; the find-replace sweep outweighs the problem | Rejected |
| Derive the directory from the `config.yaml` version | Package version is semver-stable while plan versions churn; pre-release, experimental, and version-lag projects break the coupling | Rejected |
| One-line marker file | One more local pointer that can drift, and a hidden file that default `ls` hides; mitigated by the glossary, code map, and the installer's automatic write | Accepted |

## Consequences

- No path rewrites; multiple version subdirectories coexist.
- The marker is trivially parseable from skills, the installer, and `src/cli/prompt/compose-quality-static-sections.ts`.
- `/goat-plan` reads the marker before the directory; `/goat` must not duplicate the lookup.
