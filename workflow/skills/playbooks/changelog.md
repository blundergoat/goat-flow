---
goat-flow-reference-version: "1.17.0"
---
# Changelog

Use this when writing or editing `CHANGELOG.md`: the durable in-repo record of what shipped in each version. For user-facing release announcements, load [`release-notes.md`](./release-notes.md) instead.

> **Illustrative examples below define shape only; they are not incident evidence.**

## Availability Check

This is a discipline reference, not a runnable tool. Load it when:

- Drafting a version section in `CHANGELOG.md`.
- Reviewing a changelog diff before merge.
- Bumping a version and checking all version surfaces.
- Auditing drift, missing entries, or misclassified version bumps.

No availability command applies. If the project has changelog, version, or link checks, run them; they augment the **Verification Gate** and do not replace it.

## Project Authority

Project-documented changelog style and policy govern categories, ordering, links, and version shape. When no designated project standard exists, use this playbook's defaults. Explicit current instructions and the authoritative project hierarchy remain controlling. Project policy and generic defaults cannot override safety, accepted architecture, verified facts, evidence requirements, or verification gates.

## Prose Routing

This playbook owns audience, release state, version attribution, categories, and output shape. Set those here, then apply [`writing-human-facing-prose.md`](./writing-human-facing-prose.md) as the core prose pass.

Load [`writing-structure-diagnostics.md`](./writing-structure-diagnostics.md) only when a document-level assembly defect remains, and [`writing-sentence-diagnostics.md`](./writing-sentence-diagnostics.md) only when a sentence-level reader cost remains. If both apply, repair structure first. Diagnostics may refine admitted prose but never add or remove release facts, change version attribution, or expand the write scope.

## Intent

Read release evidence, write the smallest accurate changelog entry for the product's actual reader, and preserve enough history to identify what changed and which version shipped it.

Agents default verbose. Counter that deliberately: write the first accurate entry, then cut about half the words while preserving user-visible effect, breaking-change markers, measurements, and migration steps.

## Audience Gate

The primary reader is the person who uses, calls, operates, or upgrades the shipped product. Select the real interface: CLI, API, library, service, runtime, installer, configuration, or UI. Do not invent a UI or an end-user workflow for a library, command, or operator surface.

An entry belongs only when that reader receives or experiences the change. In one scan, let them identify the affected surface, consequence, risk, and required action. Internal tooling is omitted unless it changes user behaviour or release safety.

Preserve exact public flags, config keys, versions, errors, measurements, and migration commands. A future maintainer is a secondary reader who needs truthful version attribution; maintenance interest alone does not admit an internal implementation detail.

## Source Order

Read richer signals before commit messages. Commit messages are often old intent, not shipped behavior.

Set `<release-ref>` to the candidate commit or `HEAD` before tagging, and to the published tag afterward. If the project does not tag, use its immutable published release commit. Apply the same rule to `<previous-published-ref>`.

1. `git diff <previous-published-ref>..<release-ref> --stat`
2. `git diff <previous-published-ref>..<release-ref> --name-status`
3. PR titles/bodies and closed issues for user-facing reason, if available.
4. Test names/descriptions for behavior the product now guarantees.
5. Actual changed source in the surfaces that moved most.
6. Config, dependency, runtime, CLI, API, and docs-install surfaces.
7. `git log --oneline <previous-published-ref>..<release-ref>` last, as a hint only.

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
- Apply that to the detail clause too, not just the bold headline. A reader who stops after the headline should lose detail, never meaning, so the clause after it carries the consequence or the action to take, not the mechanism that delivered it.
- Put the affected surface and effect first, then the consequence, risk, or required action the reader needs.
- Use active voice and plain English.
- Default to one sentence per bullet.
- Name the affected product surface: command, endpoint, config key, UI view, runtime, package, API, installer.
- Skip internal refactors, tests, CI, and style-only changes unless they alter user behavior or release safety.
- Do not write "various fixes", "improvements", "cleanup", or "see git log".
- Do not mention file names, function names, or PR numbers unless they are the product surface a user needs.
- Use measurements only when verified; otherwise avoid "faster", "better", "improved".

Bad: "Improved dashboard internals." Good: "Plans view now loads task previews without timing out on large workspaces."

The more common failure is a right headline followed by a mechanism detail, which reads as informative and tells the user nothing. Bad: "**A hook that ran twice now runs once** - Sync repairs duplicate and stale registrations through exec-form argv migration." Good: same headline, then "Sync and install remove the duplicate entries and leave hooks you added yourself alone."

## Length Fallback

The project's established changelog shape and the release surface own entry length. When the project or release surface owns no different shape, use one physical line and 150 characters as a fallback for an ordinary non-breaking bullet. Cut wrapper prose and internal mechanism first.

Never generalise an exact public flag, config key, version, error, or measurement to meet the fallback. Breaking impact, migration commands, verified caveats, and distinct user actions may use a second sentence or sub-bullet. A cap is a scanning aid, not permission to remove facts.

Pass the exact heading of the section being edited so published history does not drown the current candidates. Then judge each hit against the exemptions in this section:

```bash
awk -v heading='## [1.4.0] - 2026-03-12' '
$0 == heading { active=1; next }
active && /^## / { exit }
active && /^- / && length($0)>150 {
  print FILENAME ":" FNR " (" length($0) ")"
}
' CHANGELOG.md
```

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

## Release State and Version Attribution

Start the release comparison at the last published release, not an arbitrary commit or the last time the file was edited. Attribute each shipped behaviour to one version and one category. If one change has several reader effects, keep one owning entry and add detail there instead of duplicating it across categories.

Track release facts through three states:

- **`Unreleased`.** Holds the net state that will ship but has not entered a prepared release. Remove superseded intermediate behaviour, merge a fix into the feature it corrects when neither shipped separately, and preserve any visible regression or migration step that remains true.
- **Prepared release.** A versioned heading may hold the candidate before publication or a tag exists. It remains editable from verified candidate evidence; work started after the release cut stays in `Unreleased`.
- **Published release.** A tag or release artifact establishes what shipped. Freeze its attribution and edit it only under **Historical Editing**.

Move net facts from `Unreleased` when the project cuts a prepared section, or at publication when it does not prepare one earlier. Leave later work in `Unreleased` instead of folding it into the candidate.

If the project uses SemVer: **MAJOR** breaks contracts, **MINOR** adds non-breaking behaviour, and **PATCH** fixes behaviour or ships safe internal work. For `0.x.y` or calendar versioning, mark risk in prose and provide migration steps rather than relying on the number.

Every release bump updates the project's live version surfaces: package metadata, changelog header, install snippets, manifests, and configuration. Frozen historical snapshots change only when their owning release workflow explicitly regenerates them.

## Historical Editing

Historical entries may receive fact-preserving cleanup when the user asks or when a verified correction is necessary. Preserve version attribution, public identifiers, measurements, regressions, chronology, and migration facts. Do not rewrite every prior release to match a new house style, move an old fact into a version where it did not ship, or erase an obsolete constraint without recording when it changed.

For a published section, evidence from that release controls. For `Unreleased`, current net shipped intent controls. For a prepared section, candidate evidence controls until publication freezes it. If attribution cannot be verified from tags, release artifacts, the diff, or another source of truth, leave the entry unchanged and mark the uncertainty rather than guessing.

## Compression Pass

Before publishing:

1. Remove throat-clearing: "This release adds", "We improved", "This change now enables".
2. Remove implementation detail unless it changes a contract or proves a measurement.
3. Replace abstract verbs (`enhanced`, `streamlined`, `improved`) with the user-visible action.
4. Collapse commit-shaped bullets into user-impact bullets.
5. Keep non-breaking bullets to one sentence unless a second sentence carries a measurement or contract reason.

If cutting 30-50% changes no facts, the original was too verbose. That is a diagnosis after the cut, not a quota: the drafting agent is the only reader who can see the original, so the binding limits are one sentence per bullet and the Length Fallback.

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
9. `Unreleased`, any prepared section, and published history reflect their real lifecycle; work after a release cut remains in `Unreleased`.
10. The compression pass ran.
11. Published history keeps its version attribution, public facts, and chronology.
12. The Length Fallback was used only when no project or surface shape controlled, without generalising exact detail.

## Troubleshooting

- **Huge diff:** start with `--stat` and `--name-status`; group by user-visible surface.
- **Maybe breaking:** default changes, removed flags, response-shape changes, runtime drops, and changed error codes are breaking until proven otherwise.
- **Too long:** cut wrapper prose, duplicated context, and internal mechanism first; preserve public facts and migration detail.

## Related References

- [`release-notes.md`](./release-notes.md) - user-facing announcement derived from the changelog.
- [`writing-human-facing-prose.md`](./writing-human-facing-prose.md) - core correctness and routing after audience, category, and version are settled.
- [`writing-structure-diagnostics.md`](./writing-structure-diagnostics.md) - optional document-level assembly diagnosis before sentence work.
- [`writing-sentence-diagnostics.md`](./writing-sentence-diagnostics.md) - optional sentence-level diagnosis after structure is sound.
- [keepachangelog.com](https://keepachangelog.com)
- [semver.org](https://semver.org)
- Project instruction files (`CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`) may declare project-specific changelog policy.
