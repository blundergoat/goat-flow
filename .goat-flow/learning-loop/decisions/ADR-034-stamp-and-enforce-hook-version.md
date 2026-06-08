# ADR-034: Stamp a version into shipped hooks and enforce it in the audit

**Status:** Accepted
**Date:** 2026-06-08
**Author(s):** Matthew Hansen
**Ticket/Context:** 1.10.1 - installed hooks carried no version, so upgrades silently skipped them and staleness was undetectable

## Context

goat-flow's installed hook dispatchers (`.goat-flow/hooks/deny-dangerous.sh` and
`.goat-flow/hooks/gruff-code-quality.sh`) carried no version marker. Three
consequences:

- `bump-version.sh` seds the version string across templated files; with no
  version in the hooks it reported `gruff-code-quality.sh (no match, skipped)`,
  so a hook released at 1.10.1 was byte-distinguishable from a 1.8.0 copy only by
  full content comparison.
- A coding agent (or human) inspecting an installed hook could not tell which
  release it came from, so "is my hook out of date?" had no in-file answer.
- The audit detected deny-dangerous staleness only through a byte-comparison of
  the installed file against the bundled template (`checkTemplateDrift`), which
  needs the CLI bundle to run and does not cover the optional gruff hook at all.

Skills already self-describe their release via `goat-flow-skill-version`
frontmatter and reference docs via `goat-flow-reference-version`; hooks were the
gap.

## Decision

1. Stamp `# goat-flow-hook-version: X.Y.Z` into each shipped hook dispatcher
   (`workflow/hooks/{deny-dangerous,gruff-code-quality}.sh` and their installed
   `.goat-flow/hooks/` mirrors), following the existing `goat-flow-*-version`
   convention. `bump-version.sh` already seds `workflow/hooks/*.sh` and syncs the
   mirrors, so the stamp tracks the release automatically once present.
2. Add a hard-fail setup-scope audit check `hook-version`
   (`src/cli/audit/check-goat-flow.ts`): for each central dispatcher that is
   installed, fail when its stamp is missing (installed before the stamp shipped)
   or behind `AUDIT_VERSION`, with a "re-run hooks sync" remediation. An absent
   dispatcher is skipped (gruff-code-quality is optional), so projects that never
   installed it are unaffected.

Staleness is now detectable two ways: a human/agent greps the stamp and compares
it to the `.goat-flow/config.yaml` version, and the audit enforces it as a gate.

## Failure Mode Comparison

| Option | What it gives / costs | Why rejected or accepted |
| --- | --- | --- |
| Stamp only, no audit check | Greppable version; bump-version tracks it; no automated gate | Partial - kept as the floor, but the user wanted enforcement |
| Extend the deny byte-drift check to gruff | Reuses proven code; hard-fails any gruff content drift | Rejected as the mechanism - the byte-drift check is deny-mechanism-scoped and agent-filtered, and gruff is optional so a missing file would false-fail |
| Version-stamp check, advisory (non-blocking) | Surfaces staleness without breaking CI | Rejected per the user's call - a managed hook that is behind should gate, like skill/deny drift |
| Version-stamp check, hard-fail (chosen) | Enforces currency; clear re-sync message; uses the stamp | Accepted - matches goat-flow's no-drift stance; only fires when the dispatcher is actually installed |

## Reversibility

Two-way door. The stamp is a comment; the check is one `BuildCheck` entry in
`SETUP_CHECKS`. Downgrading to advisory is a small change (return a non-gating
result rather than an `AuditFailure`); removing the check drops the entry and its
test. The setup-check count (15 -> 16, total 36 -> 37) is computed from
`SETUP_CHECKS.length`, so reverting needs no `workflow/manifest.json` edit - only
the doc/snapshot count strings.

## Consequences

- Projects upgrading from <= 1.10.0 fail the new check until they re-run
  `setup` / `hooks sync` (their dispatchers have no stamp). This is the intended
  "your hooks are stale" signal; the deny byte-drift check already flagged the
  same projects.
- Adding a counted check rippled count strings across docs, the manifest
  snapshot, instruction files, and two learning-loop anchors; only
  `bash scripts/preflight-checks.sh` caught the full cascade - `npm test` passed.
  See `.goat-flow/learning-loop/lessons/verification-preflight.md`
  (search: `New harness checks need count locks`).
- If a third dispatcher ever ships, add it to the check's dispatcher list. Evidence
  anchors: `src/cli/audit/check-goat-flow.ts` (search: `hookVersionCurrent`),
  `test/integration/audit-build.test.ts` (search: `hook version currency`),
  `workflow/hooks/gruff-code-quality.sh` (search: `goat-flow-hook-version`).
