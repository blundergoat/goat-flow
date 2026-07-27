# ADR-043: Prefer git-commit-message.md while accepting git-commit.md

**Status:** Accepted
**Date:** 2026-07-27

## Decision

The preferred commit-guidance path is
`docs/coding-standards/git-commit-message.md`. New installs seed that path, goat-flow's living
documentation points there, and goat-flow's own guide uses that filename.

`docs/coding-standards/git-commit.md` remains an accepted compatibility path for existing
projects. The compatibility contract is:

- `commit-guidance` passes when either docs path exists.
- Copilot's auto-read instruction bridge may reference either accepted path.
- Install skips commit-guidance generation when either path exists, preserving user-owned
  content and never seeding a second guide alongside the old one.
- When both paths exist, fact extraction resolves the preferred `git-commit-message.md`.
- The old path is not auto-renamed, warned about, or treated as misplaced.
- `.github/git-commit-instructions.md` and `.github/instructions/git-commit.md` remain misplaced
  legacy locations; they are not compatibility aliases.

This supersedes ADR-031's exact-path and no-migration-shim decisions. It preserves ADR-031's
one-file principle: the two docs paths are alternatives, not independently maintained mirrors,
and goat-flow does not create a redirect or duplicate file.

## Context

ADR-031 chose `docs/coding-standards/git-commit.md` while goat-flow had no external users and
therefore removed the previous location without a migration shim. That premise no longer fits a
path seeded into existing consumer projects. Reinstalling goat-flow must preserve a project's
hand-maintained rules rather than rename project-owned content or create a conflicting second
guide.

The old filename also describes a broader Git concern than the document actually owns. The guide's
opening scope says it covers commit-message text only and does not define branch naming, staging,
when to commit, release workflow, or quality gates. `git-commit-message.md` makes that boundary
visible before a reader opens the file.

The runtime conformance points are `ensureGitCommitInstructions` in
`src/cli/prompt/commit-guidance.ts`, `compatiblePath` in
`src/cli/facts/shared/index.ts`, and `acceptedCommitGuides` in
`src/cli/audit/check-agent-setup.ts`.

## Failure Mode Comparison

| Option | What fails | Why rejected or accepted |
| --- | --- | --- |
| Hard-rename every consumer project to `git-commit-message.md` | Install mutates user-owned documentation and existing references fail until every project migrates | Rejected — existing users should not have to change a working guide |
| Seed the new file while retaining the old file | A project gets two potentially divergent sources of commit-message truth | Rejected — violates the one-file principle and risks silent rule drift |
| Keep `git-commit.md` as the only path | Existing projects remain stable, but new projects inherit a filename that overstates the document's scope | Rejected — preserves the naming problem indefinitely |
| Prefer the new path and accept the old path | Runtime carries a small permanent alias, while new installs are self-describing and existing projects remain untouched | Accepted |

## Reversibility

Two-way door before the 1.15.0 release. Restoring the old preferred path requires reverting the
generator, fact ordering, living references, and goat-flow's own file rename. The accepted alias
can remain in either direction, so rollback does not require consumer-project changes.

Removing support for `git-commit.md` is not part of this decision. That would require a separate
decision backed by migration evidence and an explicit user-facing deprecation path.

## Consequences

- Fresh installs create `docs/coding-standards/git-commit-message.md`.
- Existing projects with only `docs/coding-standards/git-commit.md` continue to install and audit
  without changes or warnings.
- New setup instructions and remediation text consistently name the preferred path.
- A project that manually carries both files is read from the preferred path; goat-flow does not
  delete, merge, or rewrite either file.
- Historical CHANGELOG entries and ADR-031's title/body retain the path that was true when they
  were written; ADR-031's status points readers to this replacement decision.
