---
category: platform-verification
last_reviewed: 2026-10-01
---

**Scope:** Platform-dependent test evidence: Windows environment keys and host file-creation permissions. General guidance remains in [verification-testing.md](verification-testing.md).

## Lesson: Windows environment filters need mixed-case native proof

**Status:** active | **Created:** 2026-09-27 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Verify environment-key filtering on Windows with both uppercase and mixed-case keys before claiming isolation.
**Trigger phase:** ACT
**Caught at:** VERIFY

**Prevention:** Match environment keys without regard to case when a supported platform treats them that way.
Run a native process with uppercase and mixed-case inputs; a Linux-only assertion cannot establish Windows environment isolation.
From WSL, check existing native executables before leaving that proof unresolved because they are absent from the shell's PATH.

**What happened:** The Git reader removed uppercase trace keys, and its regression used only uppercase names.
A native Windows reproduction created both trace files with `git_trace` and `Git_Trace2_Event`, while uppercase controls created neither.
Normalizing key case before filtering left both destinations absent in the same native reproduction.

The first expanded test hid its cases in a loop inside one test; Gruff caught that shape, and named cases made platform coverage visible.

**Root cause:** The filter and fixture both assumed case-sensitive names, hiding a supported platform's different contract.
Evidence: `src/cli/review-validate-anchors.ts` (search: `key.toUpperCase().startsWith("GIT_")`) and
`test/integration/review-validate-git-env.test.ts` (search: `traceEnvironmentCases`).

---

## Lesson: File-mode tests must account for the runner's umask

**Status:** active | **Created:** 2026-09-26 | **Evidence:** OBSERVED
**Decision changed:** Check the permissions of a created file against the requested mode after the runner's umask is applied.
**Trigger phase:** ACT
**Caught at:** VERIFY

**Prevention:** Keep test-output capture from changing the environment inherited by the test process. For a newly created file, compare its mode with the requested mode masked by `process.umask()`. Evidence anchors: `test/unit/safe-exec.test.ts` (search: `applies caller-selected replacement permissions under the process umask`), `src/cli/server/safe-exec.ts` (search: `openSync(tempPath, "wx", fileMode)`).

**What happened:** A full `npm test` run inherited `umask 077` from its output-capture wrapper and failed one existing permission assertion: the created file had mode `0600` while the test expected `0640`. The focused case passed under the normal `0022` mask and reproduced the failure under `0077`.

**Root cause:** The assertion assumed a fixed process umask, and the proof wrapper changed that umask before starting the suite.

---

