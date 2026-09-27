# ADR-060: Retain system ownership for managed docs consumers extend

**Status:** Accepted
**Date:** 2026-08-15
**Updated:** 2026-09-05 - condensed.

## Context

A consumer upgrading from 1.15.0 to 1.15.1 had appended 51 lines of project content to `.goat-flow/plans/README.md`. The package template had not changed between releases, yet the managed preview classified the row `local-edited` and blocked the whole upgrade: 48 replaces and two creates refused for one row, with `--force` as the only escape, which then removed the added lines. `test/integration/setup-install-upgrade-1150.test.ts` (search: `1.15.0 consumer upgrade`) reproduces it and ran RED before this decision.

The obvious fix was an ownership migration: mark the seventeen plausible extension targets `user-owned` so the installer seeds them once and never touches them again. Those are the directory `README.md` files under `plans/`, `logs/*`, `scratchpad/`, `learning-loop/*`, and `skill-docs/`, plus the three `.gitignore` files. Ownership is not a label: `workflow/install-goat-flow.sh` (search: `User-owned files stay create-only`) branches `copy_file` on it, `assert_file_ownership` fails the install when declared and actual policy disagree, and every path also appears in `workflow/manifest.json` `required_files`. Only the `skill-docs/` subset has template-versus-installed drift detection through `SHARED_ARTIFACT_MIRRORS` (`src/cli/audit/artifact-templates.ts`); the READMEs and `.gitignore` files rely on the install-state hash alone.

## Decision

All seventeen records keep system ownership, and consumer extension is handled by classification, not ownership.

| ID | Rule |
| --- | --- |
| D1 | Every currently system-owned managed doc and `.gitignore` keeps system ownership. |
| D2 | Divergent local bytes under an unchanged package template are preserved, not blocked and not replaced; the `local-preserved` / `none` classification decides this without an ownership change. |
| D3 | A genuine template change against divergent local bytes still asks the user to decide; no rule may resolve it silently. |
| D4 | `.goat-flow/learning-loop/decisions/README.md` keeps its existing `user-owned` policy. Its asymmetry with the three sibling bucket READMEs is recorded here, not settled. |

Refresh reach is the point of system ownership. These templates carry doctrine that must reach existing installs when it changes, such as the local-state contract in `workflow/setup/reference/plans-readme.md` (search: `## Data Boundary`); `user-owned` is create-only, so a doctrine correction would reach new projects and never the ones running the wrong contract. The measured incident is entirely an unchanged-template case, which D2 resolves without giving up refresh on seventeen paths. The decisions-README split has no explanation in the templates or the manifest: `workflow/setup/reference/decisions-readme.md` (search: `## When To Write An ADR`) and `workflow/setup/reference/lessons-readme.md` (search: `Mistakes the agent made`) both read as framework doctrine, so the ambiguous case preserves the status quo pending a separate reviewed migration.

## Failure Mode Comparison

| Option | What fails | Verdict |
| --- | --- | --- |
| Migrate the seventeen paths to `user-owned` | Doctrine corrections never reach existing installs; a far wider change than the evidence supports | Rejected |
| Keep blocking on `local-edited` | Consumers who extend a README lose the upgrade or, with `--force`, their content | Rejected |
| Preserve under unchanged templates, ask on real template changes | Extending a managed doc remains a decision with a cost, not a supported customisation point | Accepted |

## Consequences

- A consumer who extends a managed doc keeps that content across upgrades while the template is stable, with no flag and no data loss; when the template changes they see a conflict row and choose.
- The seventeen paths keep their `required_files` and `assert_file_ownership` bindings unchanged.
- The decisions-README ownership asymmetry stays open until evidence shows whether ADR capture policy is project-chosen.
