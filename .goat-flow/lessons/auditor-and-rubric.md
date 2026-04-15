---
category: auditor-and-rubric
---

## Lesson: Rubric changes require fixture expectation sync

**Created:** 2026-04-03

Scanner and rubric changes can invalidate "known failing" fixture expectations even when the implementation is correct. If a check is renamed, tightened, or moves responsibility to a different detector, fixture assertions must be re-read against live scanner output before treating the failure as a code bug.

**Pattern:** For fixture-driven scanner tests, verify the current failing check IDs from the real scan result first, then update both the test assertions and fixture metadata together. Do not trust older expected IDs after rubric work.

**Trigger:** Human review reports a failing fixture after rubric or detector changes. Reproduce the failing scan, capture the actual check IDs, then sync the fixture corpus and test expectations in the same change.

---

## Lesson: Changelog updates must be additive by section

**Created:** 2026-04-03

**What happened:** The `v0.10.0` block in `CHANGELOG.md` was replaced during an edit instead of being extended, so prior release deltas were effectively lost before being re-added later.

**Evidence:** `CHANGELOG.md:5-14` after the overwrite step.

**Prevention:** When updating release notes, apply edits as additive patches and re-run `git diff CHANGELOG.md` to verify no existing top-level bullets were removed. For large release-note blocks, use a merge strategy: preserve current bullets, then append new bullets separately.

---

## Lesson: Doc counts drifted silently across multiple milestones

**Created:** 2026-04-13

**What happened:** architecture.md claimed "~165 rubric checks + 32 anti-patterns" but actual code had 79 rubric checks and 12 active anti-patterns. code-map.md said "AP1-AP23" implying 23 when only 12 are active. The counts changed as checks were removed/consolidated across milestones but docs were never updated. Seven-agent critique independently flagged this as a trust problem - the "canonical source of truth" file had wrong numbers.

**Root cause:** No automated validation links count claims in docs to actual code. Each milestone that removed anti-patterns (AP2, AP3, AP4, AP7, AP10, AP11, AP17, AP18, AP21, AP22) updated the code but not the architecture doc.

**Prevention:** Either derive counts from code at build time, or add a CI check that greps architecture.md/code-map.md for count claims and compares against actual exports. After removing/adding any check or anti-pattern, grep docs for the old count.

---

## Lesson: Upgrade docs with hardcoded versions guarantee doc-rot

**Created:** 2026-04-13

**What happened:** Both `upgrade-from-0.9.x.md` and `upgrade-from-1.0.x.md` hardcode `goat-flow-skill-version: "1.1.0"` and `version 1.1.0` throughout. On the next release, users following these docs will create configs and skills with stale versions that immediately fail the config-version audit check.

**Prevention:** Replace hardcoded version strings with "use the current release version (run `goat-flow --version`)." Consider adding a CI grep that flags hardcoded version strings in upgrade docs after each release.

---

## Lesson: GitHub Actions heredocs can break YAML tooling

**Created:** 2026-04-03

Embedding an unindented shell heredoc directly inside a GitHub Actions `run: |` block can leave the workflow looking valid to the shell while still breaking YAML-aware tools like `knip`.

**Pattern:** For generated multi-line files inside workflow `run` blocks, prefer `printf '%s\n' ... > file` unless the heredoc indentation has been validated against both the YAML parser and the shell.

**Trigger:** `knip`, workflow loaders, or YAML parsers fail on a workflow that was edited only in a `run: |` block. Check for unindented heredoc bodies or terminators first.
