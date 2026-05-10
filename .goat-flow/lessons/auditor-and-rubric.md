---
category: auditor-and-rubric
last_reviewed: 2026-05-11
---

## Lesson: Rubric changes require fixture expectation sync

**Created:** 2026-04-03

Scanner and rubric changes can invalidate "known failing" fixture expectations even when the implementation is correct. If a check is renamed, tightened, or moves responsibility to a different detector, fixture assertions must be re-read against live scanner output before treating the failure as a code bug.

**Pattern:** For fixture-driven scanner tests, verify the current failing check IDs from the real scan result first, then update both the test assertions and fixture metadata together. Do not trust older expected IDs after rubric work.

**Trigger:** Human review reports a failing fixture after rubric or detector changes. Reproduce the failing scan, capture the actual check IDs, then sync the fixture corpus and test expectations in the same change.

---

## Lesson: Frontmatter can masquerade as rubric evidence

**Status:** active | **Created:** 2026-05-09

**What happened:** During M07 skill-quality calibration, the negative test for the prose phrase `which milestone` still scored tool-dependency handling as present because the broader `goat-flow` keyword matched `goat-flow-skill-version` frontmatter rather than a CLI dependency.

**Root cause:** The deterministic tool-dependency regex scanned full markdown, including metadata, and did not distinguish version fields from executable tool references.

**Prevention:** When broadening rubric keywords, add negative tests for frontmatter/version strings and ordinary prose, not only positive command examples. Evidence anchors: `src/cli/quality/skill-quality.ts` (search: `goat-flow-skill-version`), `test/unit/skill-quality.test.ts` (search: `which milestone`).

---

## Lesson: Generic skill rubrics must not require goat-flow inheritance

**Status:** active | **Created:** 2026-05-11

**What happened:** During M04 skill-quality shape detection, the evaluator treated `.goat-flow/skill-reference/skill-preamble.md` and the goat-flow Proof Gate as if they were universal skill-quality requirements. The dashboard then told an uploaded skill to "Reference `.goat-flow/skill-reference/skill-preamble.md` early so the skill inherits the Proof Gate and evidence discipline." The user correctly objected: not every skill is a goat-flow-installed skill, and standalone uploaded skills may never inherit that preamble.

**Root cause:** The rubric mixed two scopes: installed goat-flow skills that really compose `skill-preamble.md`, and generic uploaded/non-goat-flow skills that must be judged only by what they explicitly contain. The cold-start and evidence tips rewarded framework-specific inheritance instead of portable behavior such as explicit prerequisites, context, gates, and evidence rules.

**Prevention:** Every generic skill-quality rubric rule must be satisfiable by a standalone skill with no goat-flow files present. Framework inheritance can be credited only on installed artifact paths that actually compose the shared references; uploaded or external skills must earn credit through explicit local instructions. Add a negative regression whenever a rubric mentions a framework-specific path or doctrine. Evidence anchors: `src/cli/quality/skill-quality.ts` (search: `no prerequisites or operating context`), `test/unit/skill-quality.test.ts` (search: `does not require goat-flow preamble inheritance for portable uploaded skills`), `docs/skill-quality-config.md` (search: `Keep the scoring rubric portable`).

---

## Lesson: Changelog updates must be additive by section

**Created:** 2026-04-03

**What happened:** The `v0.10.0` block in `CHANGELOG.md` was replaced during an edit instead of being extended, so prior release deltas were effectively lost before being re-added later.

**Evidence:** `CHANGELOG.md` (search: `Version bump from v0.10.0`) after the overwrite step.

**Prevention:** When updating release notes, apply edits as additive patches and re-run `git diff CHANGELOG.md` to verify no existing top-level bullets were removed. For large release-note blocks, use a merge strategy: preserve current bullets, then append new bullets separately.

---

## Lesson: Doc counts drifted silently across multiple milestones

**Created:** 2026-04-13

**What happened:** architecture.md claimed "~165 rubric checks + 32 anti-patterns" but actual code had 79 rubric checks and 12 active anti-patterns. code-map.md said "AP1-AP23" implying 23 when only 12 are active. The counts changed as checks were removed/consolidated across milestones but docs were never updated. Seven-agent critique independently flagged this as a trust problem - the "canonical source of truth" file had wrong numbers.

**Root cause:** No automated validation links count claims in docs to actual code. Each milestone that removed anti-patterns (AP2, AP3, AP4, AP7, AP10, AP11, AP17, AP18, AP21, AP22) updated the code but not the architecture doc.

**Prevention:** Either derive counts from code at build time, or add a CI check that greps architecture.md/code-map.md for count claims and compares against actual exports. After removing/adding any check or anti-pattern, grep docs for the old count.

---

## Lesson: Unused upgrade docs with hardcoded versions guarantee doc-rot

**Created:** 2026-04-13

**What happened:** Two maintained upgrade docs hardcoded `goat-flow-skill-version: "1.1.0"` and `version 1.1.0` throughout. On the next release, anyone following those docs would create configs and skills with stale versions that immediately fail the config-version audit check.

**Resolution:** Deleted the unused upgrade docs on 2026-04-18 instead of continuing to maintain a stale path nobody uses.

**Prevention:** If an upgrade path is still meant to be used, replace hardcoded version strings with "use the current release version (run `goat-flow --version`)." Otherwise delete the stale path rather than carrying doc-rot forward.

---

## Lesson: GitHub Actions heredocs can break YAML tooling

**Created:** 2026-04-03

Embedding an unindented shell heredoc directly inside a GitHub Actions `run: |` block can leave the workflow looking valid to the shell while still breaking YAML-aware tools like `knip`.

**Pattern:** For generated multi-line files inside workflow `run` blocks, prefer `printf '%s\n' ... > file` unless the heredoc indentation has been validated against both the YAML parser and the shell.

**Trigger:** `knip`, workflow loaders, or YAML parsers fail on a workflow that was edited only in a `run: |` block. Check for unindented heredoc bodies or terminators first.

---

## Lesson: Audit checks must not encourage machine-specific content in shared files

**Created:** 2026-05-01

**What happened:** The `boundary-guidance-present` audit check encouraged adding `## Workspace Boundary` sections with hardcoded absolute paths (e.g., `/home/dev/projects/feature/example-app`) to version-controlled instruction files. In the first real deployment, the paths were wrong for every other developer (different WSL usernames) and for 2 of 3 checkouts on the same machine (the repo lives at `feature/`, `deploy/`, and `basedata/` paths). The audit check nudged users toward content that was guaranteed to go stale.

**Root cause:** The check validated the *presence* of boundary language without considering that satisfying it required environment-specific state. Any audit check whose remedy produces machine-specific content in shared files will create the same problem.

**Resolution:** Kept the check but made its remediation path-agnostic (ADR-026). The workspace boundary concept remains useful in committed instruction files when phrased generically, and runtime prompts still compute current paths dynamically in `compose-quality.ts`.

**Pattern:** Before adding an audit check, ask: "Can the user satisfy this check with content that is correct across all environments and checkouts?" If the answer is no, redesign the check or its remediation so it encourages portable guidance instead of shared machine-specific state.

---

## Lesson: Advisory warnings with no enforcement path train users to ignore output

**Created:** 2026-04-30

**What happened:** `stats --check` emitted 25 `decision-metadata` warnings on every run because all existing ADRs lacked Author(s) and Ticket/Context fields. The warnings were advisory (never failed the gate), but they produced a wall of noise that appeared in 12 of 16 quality assessment reports as a signal-to-noise problem. The `signal_to_noise` sub-score was docked to 15/25 in 9 of 16 reports.

**Root cause:** The `collectDecisionWarnings` function was added alongside the recommended-metadata guidance in the decisions README. But no existing ADRs were backfilled, and no enforcement deadline was set. The result: a permanent 25-line warning stream that trained every agent to scroll past stats output.

**Resolution:** Removed the `collectDecisionWarnings` function. The decisions README still recommends Author(s) and Ticket/Context, but their absence no longer produces per-run noise. If enforcement is later desired, it should be a finding (gate-bearing) with a migration path, not a warning.

**Pattern:** Advisory warnings must have an enforcement timeline or be removed. A warning that fires on 100% of the corpus with no path to resolution is not a safety net - it is noise that erodes trust in the tool.
