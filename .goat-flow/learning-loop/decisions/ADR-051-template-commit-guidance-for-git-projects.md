# ADR-051: Commit-guidance doc - one canonical file, Git projects only

**Status:** Accepted
**Date:** 2026-08-08
**Updated:** 2026-08-15 - absorbed ADR-031 (single canonical commit doc) and ADR-043 (prefer `git-commit-message.md`). The three were one chain on the same question; only the endpoint constrains current work, and the intermediate rulings survive below as the compatibility contract.

## Decision

Commit conventions live in exactly one file per project. The preferred path is `docs/coding-standards/git-commit-message.md`; `docs/coding-standards/git-commit.md` remains an accepted compatibility path for existing projects. The two are alternatives, not independently maintained mirrors - goat-flow never creates a redirect or duplicate guide.

Commit guidance is applicable only when the target project contains a `.git` entry. For an applicable target, setup uses these ordered branches:

1. Preserve an existing `docs/coding-standards/git-commit-message.md`.
2. When only `docs/coding-standards/git-commit.md` exists, copy it exclusively to the preferred path and remove the former path only after the copy succeeds.
3. When neither guide exists, copy `workflow/setup/reference/git-commit-message.md` without deriving policy from commit history.
4. When both guides exist, preserve both and resolve the preferred path.

For a target without `.git`, setup creates neither guide. Commit-guidance audit and Copilot bridge checks are skipped as not applicable.

### Compatibility contract

- The `commit-guidance` check passes when either docs path exists.
- Copilot's auto-read instruction bridge may reference either accepted path. `.github/copilot-instructions.md` MUST carry a `## Commit Messages` section referencing the canonical doc - the auto-read bridge is what makes the guidance reachable at all.
- Install skips commit-guidance generation when either path exists, preserving user-owned content and never seeding a second guide alongside the old one.
- When both paths exist, fact extraction resolves the preferred `git-commit-message.md`.
- `.github/git-commit-instructions.md` and `.github/instructions/git-commit.md` are misplaced legacy locations, not compatibility aliases. The previously-required `.github/git-commit-instructions.md` is removed.
- The auto-read instruction files (`CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`) each carry a short `## Commit Messages` section summarising the essentials and referencing the canonical doc, rather than restating it.

Commit subjects follow conventional commits `type(scope): subject`; on a `<type>/<digits>` branch the subject is prefixed with `#<digits> `, with the number taken from the branch name only.

This narrows ADR-010's external-file ownership rule with one Git-only setup seed and upgrade migration. It grants no execution authority: ADR-025 reserves `git commit` and `git push` for the user, and this guidance defines message format only.

## Context

Commit conventions were previously duplicated across `.github/git-commit-instructions.md`, `.github/instructions/git-commit.md`, and a docs path, so agents read whichever they found first and the copies drifted. Consolidating to one canonical file fixed that, but picked a filename (`git-commit.md`) less descriptive than the content warranted, and the follow-up rename had to avoid mutating user-owned documentation in existing projects.

The commit-guidance installer sampled up to 100 commit messages and treated the dominant historical shape as project policy. The user reported that prior commit messages are often poor evidence for the standard future contributors should follow. History-derived output also varied between projects, and insufficient or unavailable history produced a generated stub instead of a reviewed standard.

The reported downstream workspace at `/home/devgoat/projects/gruff-workspace` contains no `.git`. A commit-message guide there has no repository workflow to govern, so creating or requiring one adds an irrelevant project file.

The intermediate rule preferred the descriptive filename but preserved the former filename indefinitely. The approved upgrade contract now favors convergence while retaining collision safety: setup moves the former guide only when the preferred destination is absent and never overwrites either file.

## Failure Mode Comparison

| Option | What fails | Why rejected or accepted |
|---|---|---|
| Keep commit rules in several instruction files | Copies drift; agents read whichever they hit first | Rejected in favour of one canonical doc plus short referencing sections |
| Infer policy from Git history | Poor or inconsistent historical subjects become future policy; no-history targets receive a generated stub | Rejected because history is evidence of prior behavior, not an approved standard |
| Copy the template into every target | Non-Git workspaces receive guidance for a workflow they do not have | Rejected because applicability is determined by `.git` |
| Preserve the former filename indefinitely | Upgraded projects never converge on the preferred path and setup instructions retain a permanent fork | Rejected for upgrades after collision-safe migration was explicitly approved |
| Copy for Git targets and migrate former-only guides | Git projects receive deterministic rules, non-Git targets stay untouched, and upgrades converge without overwriting collisions | Accepted |

## Reversibility

The template copy and no-Git skip are two-way changes: setup can restore a different approved source without modifying existing project guides. The filename migration is not automatically reversible after a successful upgrade because references may adopt the preferred path. Reversal would require restoring indefinite preservation of the former filename for future installs while continuing to accept both paths in audit.

## Consequences

- `workflow/setup/reference/git-commit-message.md` is the packaged source for new Git-project guides.
- Framework and workflow copies require byte-parity verification.
- Setup and audit must check `.git` before creating, requiring, or bridging commit guidance.
- Upgrade output reports a former-path rename; collisions remain untouched.
- Commit-history detection and insufficient-history stubs are removed from the setup contract.
- `src/cli/audit/check-factual-claims.ts` keeps a compatibility alias for the former path; remove that entry only when support for `git-commit.md` retires.
