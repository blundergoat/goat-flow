---
goat-flow-reference-version: "1.11.0"
---
# Changelog

Use this when writing or editing `CHANGELOG.md`: the durable in-repo record of what shipped in each version. For user-facing release announcements, load [`release-notes.md`](./release-notes.md) instead.

## Availability Check

This is a discipline reference, not a runnable tool. Load it when:

- Drafting a version section in `CHANGELOG.md`.
- Reviewing a changelog diff before merge.
- Bumping a version and checking all version surfaces.
- Auditing drift, missing entries, or misclassified version bumps.

No availability command applies. If the project has changelog, version, or link checks, run them; they augment the **Verification Gate** and do not replace it.

## Intent

You are a coding agent producing or reviewing a release artifact. Your job is to read evidence, write the smallest accurate changelog entry, and verify it before claiming done.

A future maintainer opens `CHANGELOG.md` to answer: what changed, what contract changed, and which version shipped it. They should not need commit history or PR context.

Agents default verbose. Counter that deliberately: write the first accurate entry, then cut about half the words while preserving user-visible effect, breaking-change markers, measurements, and migration steps.

## Source Order

Read richer signals before commit messages. Commit messages are often old intent, not shipped behavior.

1. `git diff <prev-tag>..<current-tag> --stat`
2. `git diff <prev-tag>..<current-tag> --name-status`
3. PR titles/bodies and closed issues for user-facing reason, if available.
4. Test names/descriptions for behavior the product now guarantees.
5. Actual changed source in the surfaces that moved most.
6. Config, dependency, runtime, CLI, API, and docs-install surfaces.
7. `git log --oneline <prev-tag>..<current-tag>` last, as a hint only.

If the diff contradicts the PR title or commit subject, the diff wins.

## Output Shape

The existing project style wins. If there is no style yet, default to Keep a Changelog:

```markdown
## [1.4.0] - 2026-03-12

### Added
- Add `--timeout` for setting request timeouts in seconds.

### Fixed
- Fix incorrect totals on the billing summary page.
```

Categories: **Added** new behavior, **Changed** altered behavior, **Deprecated** scheduled removal, **Removed** no longer ships, **Fixed** wrong behavior corrected, **Security** vulnerability or security posture change.

Themed-narrative changelogs are allowed when the repo already uses them; keep the same rules.

## Writing Rules

- Lead with the user-visible change, not the implementation.
- Use active voice and plain English.
- Default to one sentence per bullet.
- Name the affected product surface: command, endpoint, config key, UI view, runtime, package, API, installer.
- Skip internal refactors, tests, CI, and style-only changes unless they alter user behavior or release safety.
- Do not write "various fixes", "improvements", "cleanup", or "see git log".
- Do not mention file names, function names, or PR numbers unless they are the product surface a user needs.
- Use measurements only when verified; otherwise avoid "faster", "better", "improved".

Bad: "Improved dashboard internals." Good: "Plans view now loads task previews without timing out on large workspaces."

## Breaking Changes

Every breaking change needs:

1. `BREAKING:` marker.
2. The contract that changed: flag, env var, API shape, default, runtime, config, behavior.
3. Migration path with exact before/after when possible.
4. Deprecation link or reason there was no deprecation window.

```markdown
- **BREAKING: `--legacy-format` flag removed.** Replace with `--format=v1`. Deprecated in 1.4.0 and removed in 1.6.0.
```

For deprecations before removal, name the target removal version. "Will be removed in a future release" is not enough.

## Version Semantics

If the project uses SemVer: **MAJOR** breaks contracts, **MINOR** adds non-breaking behavior, **PATCH** fixes or safe internal work.

For `0.x.y` or calendar versioning, do not rely on the version number to communicate risk. Mark breaking changes in prose and provide migration steps.

Every release bump should update all version surfaces: package metadata, changelog header, README install snippets, manifests/configs, and frozen snapshots if the project uses them.

## Compression Pass

Before publishing:

1. Remove throat-clearing: "This release adds", "We improved", "This change now enables".
2. Remove implementation detail unless it changes a contract or proves a measurement.
3. Replace abstract verbs (`enhanced`, `streamlined`, `improved`) with the user-visible action.
4. Collapse commit-shaped bullets into user-impact bullets.
5. Keep non-breaking bullets to one sentence unless a second sentence carries a measurement or contract reason.

If cutting 30-50% changes no facts, the original was too verbose.

## Antipatterns

- **Commit dumps:** "fix typo / chore deps / refactor handler".
- **Vague buckets:** "Various fixes and improvements".
- **Hidden breaks:** breaking behavior without `BREAKING:` and migration steps.
- **Wrong SemVer:** PATCH with a break, MAJOR with no break.
- **Duplicate entries:** the same change under two categories.
- **Tombstones:** "Removed deprecated code" without naming what users lost.
- **Agent prose bloat:** paragraphs for non-breaking fixes.
- **Version mismatch:** package, README, manifest, and changelog name different versions.

## Verification Gate

Before merging or tagging:

1. Every user-visible diff has an entry, or is intentionally omitted as internal-only.
2. Every entry is verifiable from diff, PR, issue, test, or changed product surface.
3. The category matches the user's mental model.
4. The version bump matches the content.
5. Every break has `BREAKING:` and migration steps.
6. Every deprecation names a target removal version.
7. No marketing, hedging, or vague improvement claims.
8. Version surfaces agree.
9. Keep-a-Changelog `Unreleased` is empty after release.
10. The compression pass ran.

## Troubleshooting

- **Huge diff:** start with `--stat` and `--name-status`; group by user-visible surface.
- **Maybe breaking:** default changes, removed flags, response-shape changes, runtime drops, and changed error codes are breaking until proven otherwise.
- **Too long:** assume the first agent draft is 50% too long; cut implementation detail and repeated context first.

## Related References

- [`release-notes.md`](./release-notes.md) - user-facing announcement derived from the changelog.
- [keepachangelog.com](https://keepachangelog.com)
- [semver.org](https://semver.org)
- Project instruction files (`CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`) may declare project-specific changelog policy.
