# ADR-060: Retain system ownership for managed docs consumers extend

**Status:** Accepted
**Date:** 2026-08-15

## Context

A consumer upgrading from 1.15.0 to 1.15.1 had appended 51 lines of project content under
`.goat-flow/plans/README.md`. Its package template had not changed between the two releases, so the
managed preview classified the row `local-edited` and blocked the whole upgrade - 48 replaces and two
creates refused for one row. The only escape, `--force`, then replaced the file and removed the added
lines. The failure is reproduced as a committed regression in
`test/integration/setup-install-upgrade-1150.test.ts` (search: `1.15.0 consumer upgrade`), which ran
RED against current `dev` on 2026-08-15 before this decision was applied.

That failure invites an ownership migration: mark the extended destinations `user-owned` so the
installer seeds them once and never touches them again. Seventeen system-owned records are plausible
extension targets - the directory `README.md` files under `plans/`, `logs/*`, `scratchpad/`,
`learning-loop/*`, and `skill-docs/`, plus the three `.gitignore` files.

Ownership is not a label. `workflow/install-goat-flow.sh` (search: `User-owned files stay create-only`)
branches `copy_file` on it, `assert_file_ownership` fails the install when the declared and actual
policies disagree, and every one of these paths also appears in `workflow/manifest.json`
`required_files`. Flipping ownership changes installer behaviour and audit expectations together.

Only the `skill-docs/` subset carries template-versus-installed drift detection, through
`src/cli/audit/artifact-templates.ts` (search: `SHARED_ARTIFACT_MIRRORS`). The directory READMEs and
`.gitignore` files have no such mirror; their refresh path is the install-state hash comparison alone.

## Decision

Retain system ownership for all seventeen records. Handle consumer extension through classification,
not ownership.

| ID | Decision |
|---|---|
| D1 | Every currently system-owned managed doc and `.gitignore` keeps system ownership. |
| D2 | Divergent local bytes under an unchanged package template are preserved, not blocked and not replaced: the `local-preserved` / `none` classification decides this, and no ownership change is needed to reach it. |
| D3 | A genuine template change against divergent local bytes still asks the user to decide. That is the decision a user should be asked to make, and no rule may silently resolve it. |
| D4 | `.goat-flow/learning-loop/decisions/README.md` keeps its existing `user-owned` policy. Its asymmetry with the three sibling bucket READMEs is unresolved and is recorded below rather than settled here. |

## Rationale

**Refresh reach is the point of system ownership.** These templates carry doctrine that must arrive at
existing installs when it changes - the local-state contract and Data Boundary in
`workflow/setup/reference/plans-readme.md` (search: `## Data Boundary`) are the clearest case.
`user-owned` is create-only, so a doctrine correction would reach new projects and never reach the
projects already running the wrong contract.

**The extension case does not need an ownership change.** The measured incident is entirely an
unchanged-template case, which D2 resolves. Migrating ownership would fix the same incident by
permanently giving up refresh on seventeen paths - a much wider change than the evidence supports.

**Ambiguity resolves toward the status quo.** The decisions-bucket README is `user-owned` while
lessons, footguns, and patterns are `system-owned`, and both template bodies read as framework
doctrine rather than project-configurable content. Compare
`workflow/setup/reference/decisions-readme.md` (search: `## When To Write An ADR`) with
`workflow/setup/reference/lessons-readme.md` (search: `Mistakes the agent made`): neither invites the
project to supply its own format. No evidence in the templates or the manifest explains the split, so
the ambiguous case preserves current ownership and requests a separate reviewed migration instead.

## Consequences

- A consumer who extends a managed doc keeps that content across upgrades for as long as the shipped
  template is stable, with no flag and no data loss.
- When goat-flow does change one of those templates, that consumer sees a conflict row and chooses.
  Extending a managed doc therefore remains a decision with a cost, not a supported customisation point.
- The seventeen paths keep their `required_files` and `assert_file_ownership` bindings unchanged, so
  no installer branch or audit expectation moves in this milestone.
- The decisions-README asymmetry stays open. Resolving it needs its own evidence about whether ADR
  capture policy is project-chosen; until then the two policies coexist and this ADR records why.
