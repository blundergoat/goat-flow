# ADR-051: Use template commit guidance only for Git projects

**Status:** Accepted
**Date:** 2026-08-08

## Decision

Commit guidance is applicable only when the target project contains a `.git` entry.

For an applicable target, setup uses these ordered branches:

1. Preserve an existing `docs/coding-standards/git-commit-message.md`.
2. When only `docs/coding-standards/git-commit.md` exists, copy it exclusively to the preferred path and remove the former path only after the copy succeeds.
3. When neither guide exists, copy `workflow/setup/reference/git-commit-message.md` without deriving policy from commit history.
4. When both guides exist, preserve both and resolve the preferred path.

For a target without `.git`, setup creates neither guide. Commit-guidance audit and Copilot bridge checks are skipped as not applicable.

This decision supersedes ADR-043's rule that upgrades never rename the former guide. It narrows ADR-010's external-file ownership rule with one Git-only setup seed and upgrade migration. Audit continues accepting the former path so projects remain readable before their next upgrade.

## Context

The commit-guidance installer sampled up to 100 commit messages and treated the dominant historical shape as project policy. The user reported that prior commit messages are often poor evidence for the standard future contributors should follow. History-derived output also varied between projects, and insufficient or unavailable history produced a generated stub instead of a reviewed standard.

The reported downstream workspace at `/home/devgoat/projects/gruff-workspace` contains no `.git`. A commit-message guide there has no repository workflow to govern, so creating or requiring one adds an irrelevant project file.

ADR-043 preferred the descriptive filename but preserved the former filename indefinitely to avoid mutating user-owned documentation. The approved upgrade contract now favors convergence while retaining collision safety: setup moves the former guide only when the preferred destination is absent and never overwrites either file.

## Failure Mode Comparison

| Option | What fails | Why rejected or accepted |
|---|---|---|
| Infer policy from Git history | Poor or inconsistent historical subjects become future policy; no-history targets receive a generated stub | Rejected because history is evidence of prior behavior, not an approved standard |
| Copy the template into every target | Non-Git workspaces receive guidance for a workflow they do not have | Rejected because applicability is determined by `.git` |
| Preserve the former filename indefinitely | Upgraded projects never converge on the preferred path and setup instructions retain a permanent fork | Rejected for upgrades after collision-safe migration was explicitly approved |
| Copy for Git targets and migrate former-only guides | Git projects receive deterministic rules, non-Git targets stay untouched, and upgrades converge without overwriting collisions | Accepted |

## Reversibility

The template copy and no-Git skip are two-way changes: setup can restore a different approved source without modifying existing project guides. The filename migration is not automatically reversible after a successful upgrade because references may adopt the preferred path. Reversal would require restoring ADR-043's preservation rule for future installs while continuing to accept both paths in audit.

## Consequences

- `workflow/setup/reference/git-commit-message.md` becomes the packaged source for new Git-project guides.
- Framework and workflow copies require byte-parity verification.
- Setup and audit must check `.git` before creating, requiring, or bridging commit guidance.
- Upgrade output reports a former-path rename; collisions remain untouched.
- Commit-history detection and insufficient-history stubs are removed from the setup contract.
