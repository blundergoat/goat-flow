---
goat-flow-reference-version: "1.9.0"
---
# Changelog

Use this when writing or editing `CHANGELOG.md` - the durable, in-repo, append-only record of what shipped in each version. This playbook covers WHAT to write, HOW to source it from the diff, how to align with SemVer, and the cadence options for keeping the file current.

For the per-release narrative aimed at end users (GitHub release body, blog post, email, in-app "what's new"), see the sibling [`release-notes.md`](./release-notes.md). The changelog is the source of truth; release notes are a derived view.

## Availability Check

This is a discipline reference, not a runnable tool. Load it when:

- Drafting a new version section in `CHANGELOG.md`.
- Reviewing a `CHANGELOG.md` diff before merge.
- Auditing an existing changelog to spot drift, missing entries, or misclassified version bumps.
- Bumping the version in `package.json` (or equivalent) and updating the changelog to match.

No availability command applies (the discipline ships with the playbook, not a tool). Some projects have a validation harness that catches a subset of changelog defects automatically - snapshot-claim linters, version-surface parity scripts, link checkers, or a release preflight. When those exist, name them here and run them; they catch mechanical errors but not the substantive ones this playbook protects against, so they augment the **Verification Gate** below, they do not replace it.

## Intent

A contributor or downstream maintainer opens `CHANGELOG.md` to answer one of three questions:

1. **What changed between version A and version B?** They are diffing two known versions and want a complete list.
2. **What is the contract now?** They are integrating against the current version and need to know what stabilised, what moved, and what is gone.
3. **Did this thing I noticed actually ship?** They saw new behaviour or a bug fix and want confirmation plus a version anchor.

If your changelog entry does not answer all three for someone who has never read your commit history, it is not yet a changelog entry - it is a working memo.

The customer is a future reader who has none of your context. They cannot read your Slack, your closed issues, your PR descriptions, or your commit log in full. They have the changelog, the code, and possibly the diff. Write so they need only the first.

## Convention

Pick one convention per project and stick to it. Two are common; **the project's existing `CHANGELOG.md` always wins** - if it follows neither, mirror what it has.

### Default for new projects: Keep a Changelog

[Keep a Changelog](https://keepachangelog.com): one `CHANGELOG.md` at the repo root, top-newest, an optional `## [Unreleased]` section above the latest tag, and every change sorted into a small fixed set of categories (Added / Changed / Deprecated / Removed / Fixed / Security). Skeleton:

```markdown
# Changelog

## [Unreleased]

### Added
- New `--timeout` flag for setting request timeouts in seconds.

## [1.4.0] - 2026-03-12

### Added
- ...
### Changed
- ...
### Deprecated
- ...
### Removed
- ...
### Fixed
- ...
### Security
- ...
```

### Alternative: themed-narrative

Many established projects (this repo's own `CHANGELOG.md` included) use a freeform shape: a `## vX.Y.Z - YYYY-MM-DD` header, a one-paragraph intro that names the release theme, and themed bullets without per-category sub-headings. Skeleton:

```markdown
# Changelog

## v1.4.0 - 2026-03-12

Cold-start performance pass plus a new authenticated upload endpoint. No breaking changes; existing callers are unaffected.

- **Faster cold start** - first request now serves in 0.6s vs 4.3s previously (`bench/cold-start.bench.ts`).
- **Authenticated uploads** - new `POST /v1/uploads` endpoint accepts multipart payloads up to 25MB with bearer-token auth.
- **Fixed: cache invalidation on schema migration** - prior versions could serve stale rows for up to 60s after a migration; cache now flushes synchronously.
```

The themed-narrative shape sacrifices machine-parseability (no tools that auto-summarise Keep-a-Changelog categories) for human-readability (one scan reveals what the release is *about*, not just what it lists). Pick this style when the audience reads changelogs end-to-end rather than diffing them.

**The rules below apply to both conventions** - SemVer alignment, source-from-the-diff, BREAKING-change discipline, voice, antipatterns, and the verification gate are independent of category mechanics. Only the **Categories** section and the **Stale Unreleased** antipattern below are Keep-a-Changelog-specific; they are no-ops for themed-narrative projects.

## Categories (Keep a Changelog only)

If the project follows Keep a Changelog, every entry sorts into one of these. (Themed-narrative projects skip this section.)

| Category | Use for |
|---|---|
| **Added** | New features, endpoints, flags, options, files - behaviour that did not exist |
| **Changed** | Behaviour that was already present and now works differently (non-breaking) |
| **Deprecated** | Behaviour that still works but will be removed; pair with a target removal version |
| **Removed** | Behaviour that existed in the prior release and no longer ships |
| **Fixed** | Bugs - behaviour that was wrong by design or contract |
| **Security** | Vulnerabilities; always include severity and whether disclosure preceded the release |

A single change rarely fits two categories. Pick the one that matches the user's mental model:

- A new flag that fixes a bug → **Added** (the flag is what the user touches).
- A bug fix that required removing a flag → **Removed** for the flag, **Fixed** for the bug, with cross-references.
- A breaking rename → **Changed** with a `BREAKING:` marker; do not split into Added + Removed.

## SemVer Alignment

If the project uses [SemVer](https://semver.org):

- **MAJOR** - any breaking change to a documented contract. Removing a flag, changing the meaning of an existing flag, dropping a supported runtime, changing default behaviour in a way that breaks reasonable callers.
- **MINOR** - new behaviour that does not break existing callers. New endpoints, new flags with safe defaults, optional fields, new error codes paired with broader handling.
- **PATCH** - bug fixes, doc-only changes, internal refactors, perf wins that do not change observable behaviour.

A MAJOR bump that contains only fixes (no breaks) is a misclassification - users will skip it expecting churn. A PATCH that contains a breaking change is a worse misclassification - users will apply it expecting safety.

Mismatch between the bump and the changelog content is a signal of one of two errors: either the bump is wrong, or the changelog is hiding the real change. Resolve before publishing.

For projects using **calendar versioning** (`2026.05.0`), SemVer guarantees do not apply by convention - say so in the README and flag breaking changes by prose, not by version-number signal.

For projects on **0.x.y** (pre-1.0): SemVer's stability guarantees do not apply by convention either - a minor bump (`0.4 → 0.5`) is permitted to break. State this in the README so users do not assume the post-1.0 SemVer contract. The `BREAKING:` marker is still required, and a migration path is still required - the only thing 0.x relaxes is the version-number signal.

## Source: the Diff, Not the Commits

The most common failure mode is summarising commit subjects instead of reading what actually changed. Commit subjects are written when the work is incomplete and reflect the author's intent at the time, not the merged behaviour.

Read in this order:

1. **`git diff <prev-tag>..<current-tag> --stat`** to see scope.
2. **`git diff <prev-tag>..<current-tag> --name-status`** to spot adds / deletes / renames.
3. **The actual file content of the most-changed areas.** Read the new code; do not infer from commit messages.
4. **`git log --oneline <prev-tag>..<current-tag>`** last, as one signal among several - never as the spine of the entry.

A merged feature often spans several commits, none of whose subjects describe the final shipped behaviour. A reverted change leaves commits in the log that did not ship. A rename can produce 1000 lines of "diff" with zero behaviour change. Only the diff tells you what shipped.

If the project uses squash merges, the commit subject is closer to user-impact-shaped but still incomplete - the PR body often carries the real description, and even that was written before the squashed work was merged.

## Breaking Changes

Breaking changes get a `BREAKING:` prefix on the entry (or a top-of-entry callout block) and a migration path. Without a migration path, the entry is documenting an incident, not a release.

Required elements:

1. **`BREAKING:` marker** at the start of the bullet or a callout block above it.
2. **What broke** - the contract that changed, named precisely (function signature, env var, flag, response shape, default value).
3. **Why it broke** - one sentence. Compliance, security, removing dead complexity, fixing a misdesign. Readers tolerate breakage better when they know the reason.
4. **Migration path** - exact steps. Before / after code snippets when possible. A script or codemod when available.
5. **Deprecation precursor** - if the breaking change had a prior deprecation entry, link to it. Breaking changes that ship without prior deprecation should explain why (the deprecation cycle was not viable; the bug was security-critical; this is a 0.x release where minor bumps can break).

Example (outer fence is four backticks so the inner ` ```bash ` block renders correctly inside the rendered changelog entry):

````markdown
- **BREAKING: `--legacy-format` flag removed.** Replace with `--format=v1` for the same behaviour. Deprecated in 1.4.0 (see entry below); removal was scheduled for 1.6.0.

  Migration:
  ```bash
  # before
  mytool export --legacy-format
  # after
  mytool export --format=v1
  ```
````

Anti-example:

```markdown
- BREAKING: removed `--legacy-format`. Update your scripts.
```

The bad one tells a user something is broken but not what to do. The good one names the replacement, references the deprecation, and shows the exact substitution.

For deprecation entries (one or more releases before removal), name the target removal version:

```markdown
### Deprecated
- `--legacy-format` flag is deprecated; will be removed in 1.6.0. Use `--format=v1` for the same behaviour.
```

A deprecation entry without a target version becomes a future surprise.

## Cadence

Three viable cadences. Pick one per project and stick to it.

**Write-at-commit (Keep a Changelog default).** Every PR that ships user-visible behaviour appends to an `## [Unreleased]` section at the top. On release day, rename `Unreleased` to the version + date and start a new empty `Unreleased` above it.

- Pro: change descriptions written by the person closest to the change, while context is fresh.
- Pro: release day is mechanical and low-risk.
- Con: merge conflicts on the changelog file.

**Write-at-release.** Diff the prior tag against `main`, theme the changes, write the entry in one sitting before tagging.

- Pro: themes are clearer when you can see the whole release.
- Pro: no merge conflicts mid-cycle.
- Con: requires the writer to reconstruct context from diffs, with the risk of missing intent that lived only in the PR.
- Con: release day takes longer.

**Tool-assisted (changesets, towncrier, news-fragments, release-please, etc.).** Contributors drop a small per-PR fragment (`.changeset/*.md`, `newsfragments/*.bugfix`, conventional-commit subjects); a tool concatenates and themes them at release time, then writes the `CHANGELOG.md` entry and (often) bumps the version.

- Pro: no merge conflicts; each PR writes its own file.
- Pro: changelog generation is reproducible and reviewable as a diff.
- Con: tool output is only as good as its inputs - a vague `fix(api): tweak` produces a vague entry. The "source from the diff" rule still applies: before merging the auto-generated entry, walk the actual diff and rewrite any entries that misrepresent what shipped.
- Con: tool conventions become a new contract contributors must learn; misuse silently produces wrong-category or wrong-severity entries.

A hybrid works: contributors add a bullet to `Unreleased` at PR time (or drop a tool fragment), the release manager re-themes and rewrites at release time using both the staged content AND the diff as input. The staged content becomes one input among several, not the final entry.

Whichever cadence: **never write entries from memory alone, and never accept tool output without reading the diff**. The diff is the source of truth.

## Voice and Specificity

Use **active voice**, **past tense or imperative**, **specific names**, and **no marketing language**.

Active voice:
- Bad: "An option has been added that allows configuration of timeouts."
- Good: "Added `--timeout` for setting request timeouts in seconds."

Specific names:
- Bad: "Improved the dashboard."
- Good: "Plans view (`src/dashboard/views/plans.html`) now reads `.goat-flow/tasks/` and previews milestones."

No marketing:
- Bad: "Blazing-fast new query engine, ground-up rewrite for the AI era."
- Good: "Query engine rewritten; benchmark suite runs in 0.6s vs 4.3s previously (`bench/queries.bench.ts`)."

Cut **adverbs and superlatives** unless you can prove them: "much faster", "significantly improved", "greatly enhanced" - delete or replace with a measured number.

Keep entries **short by default and long where they earn it**. A bug fix that affects one endpoint is one line. A breaking change with a migration script is a block. Mismatch is the signal something is wrong - a three-paragraph bug fix usually contains a hidden breaking change; a one-line breaking change usually has a missing migration path.

## Version Surfaces

Every release that bumps the version must update every surface that names it:

- `package.json` / `pyproject.toml` / `Cargo.toml` / the equivalent
- `CHANGELOG.md` entry header
- README install snippet (if it pins a version)
- Manifest or config files that embed the version
- Frozen snapshots (if the project uses them per ADR or convention)

Mismatch between any two surfaces is a debt every user pays. Preflight or a versions-check script should enforce; manual edits are too easy to miss.

## Antipatterns

Each of these has cost a downstream user a real upgrade-day surprise. Don't write them; if you see them in an existing entry while you're already editing, fix.

- **Commit-by-commit dumps.** "fix: corrected typo / chore: bump dep / refactor: split file" - this is `git log`, not a changelog. Theme and summarise.
- **"Various fixes and improvements."** Either name them or omit. This phrase guarantees an upgrade-day regression nobody can map back to a documented change.
- **"See git log for details."** The reader either has the git log (and didn't need your entry) or doesn't (and you've shipped nothing). Pick a third option: write the entry.
- **Marketing without numbers.** "Blazing fast" / "revolutionary" / "production-ready" - the reader cannot verify any of those. Show the benchmark, the prior limitation, the new guarantee.
- **Missing breaking changes.** A break that ships without a `BREAKING:` marker is the single most expensive changelog defect. Reviewers MUST scan for default-value changes, removed flags, signature changes, dropped runtimes, dropped browsers, changed response shapes.
- **Stale `Unreleased` section.** If using Keep a Changelog, the `Unreleased` section MUST be empty after a release tag. A non-empty `Unreleased` after release is a process bug.
- **Misclassified semver.** PATCH with a breaking change. MAJOR with no breaks. Spec mismatch between the bump and the content is debt every user pays.
- **Same change in two places.** A bug fix listed under **Fixed** and again under **Changed** reads as two separate releases of work. Cross-reference instead.
- **Stripped-out reasons.** "Removed the old caching layer" without "because it leaked memory on workers >2GB" tells the user nothing about whether they will be affected.
- **Tombstone entries.** "Cleanup: removed deprecated code." The reader cannot tell whether anything they use was deprecated. Name what was removed.
- **Version-mismatched surfaces.** `package.json` says 1.7.1, `CHANGELOG.md` tops out at 1.6.4, README says 1.9.0. Every release should bump every version surface; preflight should enforce.
- **Entries for the wrong audience.** Internal-only refactor entries in a user-facing release surface. Either omit, or move to an internal "engineering notes" file with a different audience contract.
- **Deprecation without a removal version.** "Will be removed in a future release" is a future surprise. Name the target version.

## Verification Gate

Before tagging a release or merging the changelog diff, walk these checks:

1. **Every user-visible change in the diff is represented in the entry.** Run `git diff <prev-tag>..HEAD --name-status` and check off each surface that changed. Files that changed without a corresponding entry are either internal-only (note it) or missing from the changelog (fix it).
2. **Every claim in the entry is verifiable from the code.** Each entry should either name a file/anchor or be obviously checkable. Bare claims age into folklore.
3. **The semver bump matches the entry content.** Breaking change present → MAJOR. New feature only → MINOR. Fix-only → PATCH. Mismatch means either the bump or the entry is wrong.
4. **Every breaking change has a `BREAKING:` marker and a migration path.** Before/after, or a codemod link, or a script. "Update your scripts" alone is not a migration path.
5. **Every deprecation has a target removal version.** "Will be removed" alone is a future-bug.
6. **No marketing without numbers.** "Faster", "improved", "better" - cut or replace with the measurement.
7. **No stale `Unreleased` section.** If using Keep a Changelog, the `Unreleased` section is empty after the release tag.
8. **Every version surface names the same version.** `package.json`, `CHANGELOG.md` header, README install snippet, manifest files, frozen snapshots if applicable.
9. **Each category contains only entries that match its mental model.** Bug under **Fixed**, new feature under **Added**, etc. - reclassify before merging.

If any check fails, fix before publishing. Each one has been the root cause of a downstream upgrade incident on some project.

## Troubleshooting

**The diff is huge and I don't know where to start.** Read `--stat` first to find the heaviest-changed areas; those usually anchor the marquee themes. New files added often signal a new feature; large deletes often signal a removal or rewrite. Use commit messages last, as one signal among several.

**I can't tell if a change is breaking.** It probably is. Default-value changes, removed flags, signature changes, response-shape changes, dropped runtimes, dropped browsers, changed error codes - all break callers. If you have to argue it isn't breaking, treat it as breaking until a contract test proves otherwise.

**A change shipped but the PR that introduced it had a misleading title.** The diff is the source of truth, not the title. Write the entry from what shipped.

**A change was reverted before release.** Don't list it. The revert is "no change shipped" for users, even if the log shows both the add and the revert.

**Two contributors added the same change under different categories.** Pick the category that matches the user's mental model (see Categories), keep one entry, delete the other, leave a cross-reference if helpful.

**The entry feels too long.** It probably has commit-shaped bullets that should collapse into themes. Re-cluster by user impact; each cluster becomes one bullet.

**The entry feels too short.** Either the release truly was small (fine - say so), or the writer relied on commit subjects and missed the actual scope. Walk the diff again.

## Related References

- [`release-notes.md`](./release-notes.md) - sibling playbook for the per-release narrative (GitHub release body, blog, email, in-app) that derives from this changelog.
- [`code-comments.md`](./code-comments.md) and [`observability.md`](./observability.md) - sibling discipline playbooks; same documentary structure.
- [keepachangelog.com](https://keepachangelog.com) - the conventional changelog format this playbook assumes by default.
- [semver.org](https://semver.org) - the version-bump semantics this playbook aligns release entries against.
- Project's existing `CHANGELOG.md` - the canonical example of the project's preferred entry style. New entries should match its voice, structure, and level of detail before introducing new conventions.
- Project instruction files (`CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`) - may declare a changelog policy that points here as the canonical source.
