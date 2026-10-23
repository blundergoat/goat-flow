---
category: verification-gate-runs
last_reviewed: 2026-10-23
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
**Decision changed:** Stop dependent tool calls at the first failed admission or patch, then inspect every target; neither a patch nor an orchestrated batch is atomic.
**Trigger phase:** ACT
**Incident count:** 6 | **Latest occurrence:** 2026-10-17
**Merged:** 2026-10-11 - moved here from `.goat-flow/learning-loop/lessons/verification-testing.md` when that bucket was split to recover its headroom.

**Prevention:** For dependent tool calls, check each exit status and throw or exit before the next mutation; awaiting a call does not make a nonzero result fatal. Prefer one file, or one independently recoverable hunk group, per patch when source is changing concurrently. After any patch failure, inspect timestamps and exact semantic anchors across every target before retrying, then build the retry from current bytes. The affected artifacts were gitignored milestone files, so they are not cited as durable anchors; the evidence was the failed patch result and the same-session target-by-target read.

**What happened:** During peer-plan synthesis one patch updated the roadmap issue and provider-contract milestone, then failed when a later post-turn hunk used a near-match instead of the file's exact wording. The failure named only the unmatched hunk, so the operation looked rejected as a whole, but the earlier file edits had persisted.

**Root cause:** A multi-file patch was treated as a transaction and reasoned about from the final failing hunk instead of the state of every target, so the retry risked applying landed edits twice or building hunks against stale bytes.

**Incident ledger:**

- **Recurrence 2026-08-09:** A malformed Markdown-list hunk in a rollback patch failed after earlier file hunks in the same request; this time a target-by-target diff found no retained edits. The patch surface has shown both partial and atomic-looking failures, so inspection stays the recovery contract.

- **Recurrence 2026-10-17:** Two native-replay prototype patches failed: one returned to an earlier file region, and one guessed a suite heading. Hashes found the prior successful source edit retained while both test files were unchanged. After the second failure, the three-file prototype was rewound to its main-workspace baseline and reapplied in smaller, file-ordered edits. A later note-only patch also targeted a sentence inside a longer paragraph and failed before writing; the retry used the complete current line. Read exact anchors and inspect every target before retrying. Dependent checks stopped at each failure. Current successor evidence: `src/cli/server/agent-hook-command.ts` (search: `buildAgentHookDescriptor`) and `test/integration/hook-command-native-replay.test.ts` (search: `managed Node registered policy replay`).

- **Recurrence 2026-10-17:** Audit correction: A combined comment/test correction assumed a numeric assertion occupied several lines. The formatted test kept one assertion on a single line, so patch admission failed. Target inspection found both files unchanged; smaller file-specific patches used the exact current lines. Dependent formatting and tests stopped at the failed patch. Evidence: `test/integration/hook-native-audit-direct.test.ts` (search: `PROVIDERS.length`) and `src/cli/audit/check-agent-deny-runtime.ts` (search: `Spawns one blocked request`).

- **Recurrence 2026-10-12:** M01 combined config admission, timing, patch application and bookkeeping in one tool batch. Admission rejected an unexpected Stop config hash, but the batch continued: the full config patch refused, the approved source patch landed, and bookkeeping failed on absent approval metadata. Target-by-target hashes showed that the config already contained the approved POSIX prefix, while the runner and test exactly matched the approved patch. Recovery preserved that external prefix and applied only the missing Windows prefix. The evidence was the failed admission, per-call exits and same-session hash comparisons; affected surfaces are `.codex/hooks.json` (search: `GOAT_FLOW_POST_TURN_SAFETY_MAX_BYTES`) and `scripts/check-hook-parity.mjs` (search: `spawnReferenceCommand`).

- **Recurrence 2026-10-17:** During the Node-floor amendment, a combined plan patch returned to an earlier section and failed; a second hunk used only part of a paragraph line. Target inspection found the plan files unchanged and preserved the already applied package/CI edits. Ordered hunk groups and complete current lines resolved the mismatch. Read every target after failure, then rebuild the remaining patch from current bytes. Evidence: `package.json` (search: `"engines"`) and `test/integration/gruff-warning-ratchet.test.ts` (search: `minimumNodeJob`); local plan hunks are not durable evidence anchors.

## Lesson: Preserve repository-owned verification flags

**Status:** active | **Created:** 2026-09-14 | **Evidence:** ACTUAL_MEASURED
**Severity:** INTEGRATION
**Incident count:** 3 | **Latest occurrence:** 2026-10-01
**Merged:** 2026-10-11 - moved here from `.goat-flow/learning-loop/lessons/verification-testing.md` when that bucket was split to recover its headroom.

**Prevention:** Read the owning command before running a tool directly. Bare Knip exhausted its default heap; the repository's 5120 MB and `--no-gitignore` invocation passed. Source: `scripts/preflight-checks.sh` (search: `knip_command=(`). Do not report the failed invocation as a code failure.

**Recurrence 2026-10-01:** Preflight found an unused export after scoped checks passed. Keeping `QualityConcern` private fixed it. Run the preflight-owned Knip gate too; `check:touched` omits it. `src/cli/quality/schema-types.ts` (search: `type QualityConcern =`).

**Recurrence 2026-09-14:** The change tried nonexistent `tsconfig.cli.json`; `package.json` (search: `"typecheck"`) owns the two-project check.


## Lesson: Configured hook replay does not prove managed registration consistency

**Status:** active | **Created:** 2026-10-12 | **Evidence:** ACTUAL_MEASURED
**Incident count:** 3 | **Latest occurrence:** 2026-10-23
**Decision changed:** Read the canonical descriptor writer and generated contract before changing a managed command, then verify both execution and exact registration identity.
**Trigger phase:** ACT
**Caught at:** VERIFY

**Prevention:** A local command that runs correctly can still be managed drift. Follow the writer to its provider template and generated installer contract; keep those owners consistent and retain strict descriptor comparisons. Replay the complete registered executable and ordered arguments; a bare executable's zero exit does not establish hook execution. Run configured replay, the generator check, identity tests and repository preflight before calling the registration verified. Record automatic provider delivery separately.

**What happened:** M01 added an approved four-MiB scan limit to both local Codex Stop commands. Configured WSL2 replay finished cleanly, scanner coverage was complete and a native Windows prefix probe received the setting. Full preflight still exited one because config parity and both audit views expected the unchanged canonical descriptor. The approved correction aligned the canonical writer, Codex template and generated installer contract and added a test that rejects either stripped prefix. Fresh full preflight exited zero with 93 checks and the existing learning-bucket warning. Configured replay and canonical consistency are verified separately; automatic host delivery remains unverified.

**Recurrence 2026-10-12:** Claude's local Stop registration and canonical template still used the scanner's one-MiB default after Codex received four MiB. Three untracked JSON artifacts measured 2,885,754 to 2,944,548 bytes each, so every Claude Stop reported incomplete coverage. The first diagnostic ran only `node`, omitting its registered arguments; its zero exit was discarded. Complete argv replay reproduced all three gaps with exit two. Setting the per-file limit inside Claude's Node bootstrap, in both the descriptor writer and template, then regenerating the installer contract changed that same replay to exit zero with no coverage gaps. Four MiB provides bounded headroom over these files and matches Codex; it is not a model context budget or the smallest possible limit. Automatic Claude delivery remains unverified.

**Evidence:** `src/cli/server/agent-hook-command.ts` (search: `buildAgentHookDescriptor`, `entryCarriesHandlerDescriptor`); `scripts/generate-managed-hook-desired-state.mjs` (search: `renderManagedHookContract`); `scripts/preflight-checks.sh` (search: `agent_config_output`); `workflow/hooks/agent-config/codex-hooks.json` and `workflow/hooks/agent-config/claude.json` (search: `Stop`); `.goat-flow/hooks/post-turn-safety.sh` (search: `MAX_FILE_BYTES`, `oversized untracked text not scanned`); `test/unit/agent-hook-command.test.ts` (search: `keeps the per-file scan limit in the managed argv identity`).

**Recurrence 2026-10-23:** The native registration cutover passed focused replay, but the full fast run failed 122 tests. Several fixtures treated only the explicit candidate as Node while the default installed runtime was already Node, selecting Bash filenames and ineffective shell fault injectors. Keep runtime selection, emitted fixture language, saved descriptors and fault injection aligned. Preserve legacy fixtures for explicit reference runs. Evidence: `test/helpers/hook-entrypoint.ts` (search: `selectedHookPath`), `test/integration/post-turn-safety-hook-scanning.test.ts` (search: `assertIncompleteOnBothScanners`) and `test/unit/hook-registrar.helpers.ts` (search: `GENERATED_AGENT_SURFACES`).
