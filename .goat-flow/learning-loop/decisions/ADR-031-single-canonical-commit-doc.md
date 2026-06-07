# ADR-031: Single canonical commit-conventions doc at docs/coding-standards/git-commit.md

**Status:** Accepted
**Date:** 2026-05-29

## Decision

Commit conventions live in exactly one file: `docs/coding-standards/git-commit.md`. The auto-read
agent instruction files (`.github/copilot-instructions.md`, and by the same pattern `CLAUDE.md` /
`AGENTS.md`) each carry a short `## Commit Messages` section that summarises the essentials and
references the canonical doc. The previously-required `.github/git-commit-instructions.md` is
removed.

Conformance points:

- `docs/coding-standards/git-commit.md` is the canonical full reference for humans and agents.
- `.github/copilot-instructions.md` MUST contain a `## Commit Messages` section that references
  `docs/coding-standards/git-commit.md`.
- The `commit-guidance` harness check (verification scope) requires the canonical doc; the legacy
  `.github/git-commit-instructions.md` and `.github/instructions/git-commit.md` are reported as
  misplaced.
- The Copilot `agent-instruction` build check requires `.github/copilot-instructions.md` to
  reference the canonical doc - the auto-read "bridge".
- `src/cli/prompt/commit-guidance.ts` (`ensureGitCommitInstructions`) seeds the canonical doc from
  detected git history on install, with no `.github/` dependency.
- Commit subjects follow conventional commits `type(scope): subject`; on a `feat/<digits>` branch
  the subject is prefixed with `#<digits> `, with the number taken from the branch name only.

## Context

`.github/git-commit-instructions.md` was treated as a Copilot-discoverable commit-rules file. In
practice it is not auto-read: GitHub Copilot auto-loads `.github/copilot-instructions.md` repo-wide
across VS Code, Visual Studio, and JetBrains IDEs, but commit-message guidance is wired through an
IDE setting (`commitMessageGeneration.instructions`), and JetBrains' own commit file is the
unrelated `global-git-commit-instructions.md`. A user on PhpStorm confirmed the bespoke file was
never read - only `.github/copilot-instructions.md` was.

Keeping the rules in a file no agent auto-reads meant the conventions did not reach the tool that
writes commits. We also maintained the same content in two places
(`.github/git-commit-instructions.md` and a `docs/coding-standards/git-commit.md` "byte-equivalent
mirror"), a manual-sync burden with no enforcing gate. Consolidating to one doc, surfaced through
the file IDEs actually read, removes both problems. goat-flow has no external users yet, so the old
path is removed outright with no migration shim.

## Failure Mode Comparison

| Option | What fails | Why rejected or accepted |
| --- | --- | --- |
| Keep `.github/git-commit-instructions.md` as canonical | IDEs never auto-read it, so rules miss the commit-message generator; content duplicated with a docs mirror | Rejected - the file's reason to exist (auto-discovery) does not hold |
| Single doc + a bare link in the instruction file | A link alone is not applied as guidance; the agent may never open it | Rejected - the essentials must be inline in the auto-read file |
| Single canonical doc + inline `## Commit Messages` summary in auto-read instruction files | Requires updating the harness check, generator, setup docs, and tests | Accepted - rules reach every agent via the file IDEs read, with one source of truth |

## Reversibility

Two-way door. Restoring `.github/git-commit-instructions.md` is a revert of this change plus
re-pointing `GIT_COMMIT_INSTRUCTIONS_PATH`, the `commit-guidance` facts resolver, and the Copilot
bridge. Revisit if a future Copilot/IDE release adds genuine auto-discovery of a repo-level commit
file, at which point a generated pointer file could be reintroduced.

## Consequences

- One file to maintain; no mirror-sync drift.
- The branch-prefix (`#<digits>`) rule is now documented and applies to goat-flow's own commits.
- Downstream installs get the doc seeded by the generator, and the `## Commit Messages` section
  added during setup (Step 02 and the agent guides); the audit enforces both the doc and the
  instruction-file reference.
