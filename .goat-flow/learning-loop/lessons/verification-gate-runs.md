---
category: verification-gate-runs
last_reviewed: 2026-10-11
---

**Scope:** Running gates during a change - stopping each edit batch at its declared proof, checking every target after a failed multi-file patch, invoking tools with the repository's own flags, and telling a transient gate failure from a task regression. Adding or trusting a repo-wide gate is [verification-preflight.md](verification-preflight.md); what a test must establish is [verification-testing.md](verification-testing.md).

## Lesson: Mid-implementation proof gates split edit batches

**Status:** active | **Created:** 2026-08-23
**Severity:** INTEGRATION
**Decision changed:** Stop each mutation batch at a declared mid-implementation proof and record its result before applying later-surface edits.
**Trigger phase:** ACT
**Caught at:** VERIFY
**Incident count:** 4 | **Latest occurrence:** 2026-09-19
**Merged:** 2026-10-11 - moved here from `.goat-flow/learning-loop/lessons/verification-testing.md` when that bucket was split to recover its headroom.

**Prevention:** Split mutations at every declared mid-implementation proof: apply only the prerequisite files, run and record the exact gate with its exit status, then re-read and edit the later surfaces. Run explicit mechanical constraints, including requested line widths, immediately after each source patch. A late pass validates current state but never backfills the missed checkpoint; mark it late. Evidence anchors: `test/contract/skill-hardening-shared-1.test.ts` (search: `requires minimum evidence and rejects false proof for every claim type`), `workflow/skills/reference/skill-preamble.md` (search: `Claim controls set minimum evidence without changing proof classes`).

**What happened:** One approved edit batch grouped the shared evidence matrix, its contract, three instruction files, and a learning-loop consolidation, although the milestone required the focused contract after the matrix and test and before the instruction and lesson edits. The test later reported `# tests 16`, `# pass 16`, and `# fail 0`, but late, validating only the combined snapshot. In the same milestone the first exact comment-width scan caught a new 152-character context line against the 150-character ceiling.

**Root cause:** Files were grouped by one conceptual change and the patch boundary was treated as more important than the milestone's temporal proof boundary, which removed the gate's ability to catch a bad shared contract before it propagated; the width limit was judged visually instead of measured.

**Recurrence 2026-08-23:** The first write-scope fixture list included the three local instruction files although the midpoint gate had to run before they changed. Narrowed to the canonical reference plus four setup templates, the gate reported `# pass 76`; the three local paths joined afterwards and the final focused run reported `# pass 91`. `test/contract/command-phrases.test.ts` (search: `WRITE_SCOPE_RECONCILIATION_PATHS`).

**Recurrence 2026-09-19:** A milestone planned its protocol tests after the version-negotiation change and before the result-projection change. Both changes went into the Gruff hook through one scripted edit, so the midpoint never existed. The first combined run failed 7 cases: the new v2 branch fell through into the old v1 schema check, a negotiation defect the midpoint gate would have isolated. The final run passed, and the milestone closeout records the checkpoint as late, not backfilled.

---

## Lesson: Split transient preflight test failures from task regressions

**Status:** active | **Created:** 2026-04-26
**Severity:** CORRECTNESS
**Merged:** 2026-10-11 - moved here from `.goat-flow/learning-loop/lessons/verification-testing.md` when that bucket was split to recover its headroom.

**Prevention:** When preflight fails in the test phase after an unrelated gate fix, rerun the named failing test area and then the exact suite command directly before changing task files again. Preflight selects `test:fast` when available and runs the selected command once; a nonzero exit still fails. Coverage remains an explicit release check. Anchors: `scripts/preflight-checks.sh` (search: `test:fast`) and `test/integration/preflight-test-diagnostics.test.ts` (search: `selects only`). If release-scale TAP can exceed the caller's output limit, capture the first run to a fresh disposable path so the failing case survives beside the summary. Report the split explicitly: which gate was fixed, which direct suite passed, and whether the preflight failure reproduced.

**What happened:** After a quality-report fix cleared the ESLint error blocking preflight, two further preflight runs reached the fast test phase and failed on different tests, `agent deny hook template comparison` and then `harness does not affect build-only result`, while a direct `npm run test:fast` immediately afterwards reported `# pass 373` and `# fail 0`.

**Root cause:** A failure inside the final gate was read as a task regression; the changing test names and the direct pass showed the task fix was complete and the wrapper was surfacing intermittent failures needing separate investigation. An earlier version of this Prevention described a one-shot `test:fast` retry; that retry was removed on 2026-08-16 (`refactor(core): consolidate setup preflight checks`), the removal is test-pinned, and two quality reports flagged the stale claim on 2026-08-18.

**Recurrence 2026-08-17:** After an ESLint fix cleared preflight's TypeScript stage, the fast suite observed a changelog mirror mismatch while playbook edits were in progress; the isolated sync suite passed `26/26` and a direct diff between `.goat-flow/skill-docs/playbooks/changelog.md` and `workflow/skills/playbooks/changelog.md` was empty, so no task file changed. Rerun the full gate only after mirrored writes are quiescent. `test/integration/preamble-sync.test.ts` (search: `SHARED_ARTIFACT_MIRRORS`).
**Recurrence 2026-09-04:** A release repair's first `npm run test:full` stopped after the fast phase with `tests 2650`, `pass 2644`, `fail 1`, `skipped 5`, but truncated output no longer held the failing case. An immediate `npm run test:fast` captured to a fresh path exited 0 with `pass 2645`, and the exact full retry passed that plus the slow suite's `tests 474`, `pass 472`, `fail 0`, `skipped 2`. `package.json` (search: `"test:full": "npm run test:fast && npm run test:slow"`).

---

## Lesson: A failed multi-file patch can preserve earlier edits

**Status:** active | **Created:** 2026-08-09
**Severity:** CORRECTNESS
**Decision changed:** Inspect every target after a failed multi-file patch; never assume the operation was atomic.
**Trigger phase:** ACT
**Incident count:** 2 | **Latest occurrence:** 2026-08-09
**Merged:** 2026-10-11 - moved here from `.goat-flow/learning-loop/lessons/verification-testing.md` when that bucket was split to recover its headroom.

**Prevention:** Prefer one file, or one independently recoverable hunk group, per patch when source is changing concurrently. After any patch failure, inspect timestamps and exact semantic anchors across every target before retrying, then build the retry from current bytes. The affected artifacts were gitignored milestone files, so they are not cited as durable anchors; the evidence was the failed patch result and the same-session target-by-target read.

**What happened:** During peer-plan synthesis one patch updated the roadmap issue and provider-contract milestone, then failed when a later post-turn hunk used a near-match instead of the file's exact wording. The failure named only the unmatched hunk, so the operation looked rejected as a whole, but the earlier file edits had persisted.

**Root cause:** A multi-file patch was treated as a transaction and reasoned about from the final failing hunk instead of the state of every target, so the retry risked applying landed edits twice or building hunks against stale bytes.

**Recurrence 2026-08-09:** A malformed Markdown-list hunk in a rollback patch failed after earlier file hunks in the same request; this time a target-by-target diff found no retained edits. The patch surface has shown both partial and atomic-looking failures, so inspection stays the recovery contract.

## Lesson: Preserve repository-owned verification flags

**Status:** active | **Created:** 2026-09-14 | **Evidence:** ACTUAL_MEASURED
**Severity:** INTEGRATION
**Incident count:** 3 | **Latest occurrence:** 2026-10-01
**Merged:** 2026-10-11 - moved here from `.goat-flow/learning-loop/lessons/verification-testing.md` when that bucket was split to recover its headroom.

**Prevention:** Read the owning command before running a tool directly. Bare Knip exhausted its default heap; the repository's 5120 MB and `--no-gitignore` invocation passed. Source: `scripts/preflight-checks.sh` (search: `knip_command=(`). Do not report the failed invocation as a code failure.

**Recurrence 2026-10-01:** Preflight found an unused export after scoped checks passed. Keeping `QualityConcern` private fixed it. Run the preflight-owned Knip gate too; `check:touched` omits it. `src/cli/quality/schema-types.ts` (search: `type QualityConcern =`).

**Recurrence 2026-09-14:** The change tried nonexistent `tsconfig.cli.json`; `package.json` (search: `"typecheck"`) owns the two-project check.
