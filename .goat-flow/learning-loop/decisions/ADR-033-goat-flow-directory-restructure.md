# ADR-033: .goat-flow Directory Restructure

**Status:** Accepted
**Date:** 2026-06-07
**Supersedes:** ADR-017 path choice for `.goat-flow/tasks/.active`
**Ticket/Context:** `.goat-flow/plans/1.10.0/M04-goat-flow-directory-restructure.md`

## Context

The installed `.goat-flow/` layout had grown around historical top-level buckets:
`footguns/`, `lessons/`, `patterns/`, `decisions/`, `skill-reference/`,
`skill-playbooks/`, `hook-lib/`, and `tasks/`. M04 showed that a simple rename
would be unsafe because runtime code, setup templates, manifest checks, dashboard
APIs, hook launchers, skill routing, and local milestone history all reference
these paths.

The user approved the final skill-docs target name and required the `tasks` to
`plans` change to ship as a bundled migration that preserves `.active`, existing
local milestone subdirs, dashboard plan behavior, goat-plan routing, config
defaults, and old local history without overwriting same-named new files.

## Decision

Adopt the new installed layout:

- `.goat-flow/learning-loop/{decisions,footguns,lessons,patterns}/` for durable
  project memory.
- `.goat-flow/skill-docs/` for shared skill doctrine, with standalone playbooks
  under `.goat-flow/skill-docs/playbooks/` and skill-authoring methodology under
  `.goat-flow/skill-docs/skill-quality-testing/`.
- `.goat-flow/hooks/` for central installed hook dispatchers, with deny-dangerous
  policy modules under `.goat-flow/hooks/deny-dangerous/`.
- `.goat-flow/plans/` for local milestone plans and the `.active` marker.

Keep `workflow/` as the package template source. For example,
`workflow/skills/reference/` still sources shared skill doctrine, while the
installed copy lands in `.goat-flow/skill-docs/`.

Installer upgrades must move old directories idempotently with no-overwrite
semantics. When both old and new paths exist, the migration moves only entries
whose destination does not already exist and leaves conflicts in the old path
for human review rather than overwriting local work.

## Failure Mode Comparison

| Option | What fails | Why rejected or accepted |
| --- | --- | --- |
| Rename directories and chase compile errors | Dashboard APIs, installer upgrades, hook configs, and local `.active` state can split between old and new paths. | Rejected because it loses the upgrade safety contract. |
| Defer `tasks` to `plans` | Leaves the most user-visible rename out of the structural release and keeps ADR-017's old path as live doctrine. | Rejected after explicit user approval for bundled migration. |
| Move workflow template source directories too | Increases package churn and obscures the source/install separation. | Rejected for skill docs; `workflow/skills/reference/` and `workflow/skills/playbooks/` remain source paths. |
| Move installed state with no-overwrite migration | Preserves user-authored local content and lets setup/templates/runtime converge on one new layout. | Accepted. |

## Consequences

All active instructions, setup templates, manifest entries, audit checks,
dashboard plan APIs, config defaults, and goat-* skill routing must use the new
paths. Old path mentions are valid only in migration code, compatibility tests,
changelog/ADR history, or clearly historical learning-loop evidence.

`/goat-plan` continues to own `.active` semantics, but the marker path is now
`.goat-flow/plans/.active`. Missing or stale `.active` remains normal local
churn, not setup failure.

## Reversibility

This is reversible only by another coordinated migration release. A rollback
must restore installer migration, manifest, dashboard routes, hook configs,
skill-doc pointers, and goat-plan routing together; reverting only the directory
names would recreate the split-layout failure this ADR prevents.
