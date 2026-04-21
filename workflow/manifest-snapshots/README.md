# Manifest snapshots

Frozen copies of `workflow/manifest.json` at each release. Immutable after
write. Used by CHANGELOG-scoped claim lint (M06b).

## Contract

- **Live source of truth:** `workflow/manifest.json` (edited freely across
  milestones).
- **Frozen snapshot:** `workflow/manifest-snapshots/vX.Y.Z.json` (never edited
  after release).
- **Relationship:** at release time, a post-release script copies
  `workflow/manifest.json` into this directory under the release tag. The
  snapshot then drops out of the edit surface - all future changes land in
  the live file.

## Why snapshots exist

CHANGELOG entries are frozen at release. The `## v1.1.0` section of
`CHANGELOG.md` describes v1.1.0 as it shipped - "7 canonical skills",
"12 setup + 4 agent build checks", "16 harness checks". When v1.2.1 changes
a count, the v1.1.0 CHANGELOG section must still read the v1.1.0 numbers.
Comparing CHANGELOG v1.1.0 claims against the live manifest would flag valid
historical entries as drift; comparing against the matching snapshot catches
only real edits to frozen text.

## Current snapshots

| Version | File | Captures |
|---------|------|----------|
| v1.1.0 | `v1.1.0.json` | 7 skills, 12 setup + 4 agent + 16 harness = 32 checks, 7 dashboard views, 20 presets |

## Adding a snapshot at release time

1. `cp workflow/manifest.json workflow/manifest-snapshots/v${VERSION}.json`
2. Open the snapshot file, add the `_snapshot_note` and `snapshot_facts`
   blocks (mirror v1.1.0.json's shape).
3. Commit together with the release.

M06b kill criterion (from the milestone): "If snapshots become burdensome,
drop and accept that CHANGELOG lint only compares claims within the current
version." A decision record in `.goat-flow/decisions/` captures that
kill-switch when pulled.
