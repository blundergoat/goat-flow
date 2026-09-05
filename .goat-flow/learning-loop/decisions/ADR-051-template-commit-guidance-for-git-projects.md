# ADR-051: Commit-guidance doc - one canonical file, Git projects only

**Status:** Accepted
**Date:** 2026-08-08
**Updated:** 2026-09-05 - condensed. The 2026-08-30 amendment documented the installed-instruction reference preflight and byte-parity enforcer; the 2026-08-15 amendment absorbed now-removed ADR-031 (single canonical commit doc) and ADR-043 (prefer `git-commit-message.md`).

## Context

Commit conventions were duplicated across `.github/git-commit-instructions.md`, `.github/instructions/git-commit.md`, and a docs path, so agents read whichever they found first and the copies drifted. Consolidating to one file fixed that but chose a filename (`git-commit.md`) less descriptive than the content, and the rename had to avoid mutating user-owned documentation in existing projects.

The installer also sampled up to 100 commit messages and treated the dominant historical shape as policy. The user reported that past messages are poor evidence for the standard future contributors should follow; history-derived output varied between projects, and thin history produced a generated stub. A reported downstream workspace had no `.git`, where a commit guide governs nothing.

## Decision

Commit conventions live in exactly one file per project, seeded and migrated only when the target contains `.git`.

The preferred path is `docs/coding-standards/git-commit-message.md`; `docs/coding-standards/git-commit.md` is an accepted compatibility path. They are alternatives, never mirrors, and goat-flow never creates a redirect or duplicate. For a Git target, setup follows these branches in order:

1. Preserve an existing `git-commit-message.md`.
2. When only `git-commit.md` exists, inspect every installed agent instruction file. If former-path references are absent or confined to the selected agent's `## Commit Messages` section, copy to the preferred path, rewrite that bridge if needed, and remove the former path only after both succeed. Otherwise preserve it and report `skipped-references`.
3. When neither exists, copy `workflow/setup/reference/git-commit-message.md` without deriving policy from history.
4. When both exist, preserve both and resolve the preferred path.

For a target without `.git`, setup creates neither guide, and the commit-guidance audit and Copilot bridge checks are skipped.

**Compatibility contract.** The `commit-guidance` check passes when either path exists. Install skips seeding when either exists. Fact extraction resolves the preferred path when both exist. `.github/git-commit-instructions.md` and `.github/instructions/git-commit.md` are misplaced legacy locations, not aliases. The three auto-read instruction files each carry a short `## Commit Messages` section that summarises the essentials and references the canonical doc; for Copilot that bridge is what makes the guidance reachable at all.

Subjects follow conventional commits `type(scope): subject`; on a `<type>/<digits>` branch the subject is prefixed `#<digits> `, taken from the branch name only. This narrows ADR-010's external-file rule with one Git-only seed and migration. It grants no execution authority: ADR-025 reserves committing and pushing for the user.

## Failure Mode Comparison

| Option | What fails | Verdict |
| --- | --- | --- |
| Commit rules in several instruction files | Copies drift; agents read whichever they hit first | Rejected |
| Infer policy from Git history | Poor historical subjects become future policy; no-history targets get a stub | Rejected |
| Copy the template into every target | Non-Git workspaces receive guidance for a workflow they lack | Rejected |
| Preserve the former filename indefinitely | Upgraded projects never converge and setup keeps a permanent fork | Rejected after collision-safe migration was approved |
| Seed Git targets, migrate former-only guides | Deterministic rules for Git projects, untouched non-Git targets, convergence without overwriting collisions | Accepted |

## Consequences

- `workflow/setup/reference/git-commit-message.md` is the packaged source; `scripts/check-instruction-parity.mjs` enforces byte parity between it and `docs/coding-standards/git-commit-message.md`.
- Setup and audit check `.git` before creating, requiring, or bridging commit guidance; upgrade output reports a rename or `skipped-references`.
- `src/cli/audit/check-factual-claims.ts` keeps a compatibility alias for the former path until `git-commit.md` support retires.

## Reversibility

The template copy and the no-Git skip are two-way. The filename migration is not automatically reversible after a successful upgrade, because references may adopt the preferred path; reversal would mean preserving the former filename indefinitely for new installs while audit accepts both.
