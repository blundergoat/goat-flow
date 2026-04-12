---
category: auditor-and-rubric
---

## Pattern: Scanner 100% does not mean the project is correct

**Created:** 2026-03-31

**What happened:** goat-flow scored 100% on its own scanner while preflight-checks.sh failed with 8 errors. Scanner checked structural presence (files exist, have right headings). Preflight checked functional correctness (commands work, paths resolve, versions match). The two tools disagreed about the repo's health.

**Root cause:** Scanner and preflight check different things. Neither is authoritative for the other's concerns. "100% scanner score" became a proxy for "everything is fine" when it only means "the skeleton is correct."

**Prevention:** Don't treat scanner score as a quality gate for the whole project. Use it for what it checks (structure) and preflight for what it checks (function). When they disagree, investigate - the more specific tool is usually right.

---

## Pattern: Complexity refactors need file-level lint before closeout

**Created:** 2026-04-03

When reducing a specific complexity hotspot, lint the whole file before declaring the pass complete. A single extracted function can still leave sibling offenders in the same file, and helper rewrites can introduce small follow-up mistakes that only show up once the file is re-linted. Treat the file, not the original function, as the verification unit for complexity work.

---

## Pattern: Refactors need typecheck before preflight

**Created:** 2026-04-03

After a large extraction pass, run `npx tsc --noEmit` before relying on preflight. Complexity-only verification can miss callback type drift, helper return narrowing, and small unused-parameter regressions that only show up once TypeScript checks the whole tree.

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

## Lesson: GitHub Actions heredocs can break YAML tooling

**Created:** 2026-04-03

Embedding an unindented shell heredoc directly inside a GitHub Actions `run: |` block can leave the workflow looking valid to the shell while still breaking YAML-aware tools like `knip`.

**Pattern:** For generated multi-line files inside workflow `run` blocks, prefer `printf '%s\n' ... > file` unless the heredoc indentation has been validated against both the YAML parser and the shell.

**Trigger:** `knip`, workflow loaders, or YAML parsers fail on a workflow that was edited only in a `run: |` block. Check for unindented heredoc bodies or terminators first.
