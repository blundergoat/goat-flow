---
category: policy-runtime-probes
last_reviewed: 2026-10-29
---

## Lesson: Policy feature changes must include the frozen expectation owner

**Status:** active | **Created:** 2026-10-29
**Decision changed:** Read the shipped corpus and its reference binding before approving a change to previously unsupported provider behavior.
**Trigger phase:** SCOPE
**Caught at:** VERIFY

**Prevention:** Follow the complete self-test path from the public hook entrypoint to its corpus and reference validator. Include any changed candidate expectation and named exception in the write scope. Preserve original observations and input hashes; never change historical evidence to make a new policy pass.

**What happened:** The native PowerShell plan included source, unit and child-process tests but omitted the frozen corpus. Focused tests passed while the full self-tests still required denial of the harmless PowerShell request. The implementation paused for a four-file amendment. Only the two candidate expectations and their explicit exception changed; the original locale observations and other cases stayed intact.

**Evidence:** `src/hooks/policy-corpus.mts` (`loadPolicyCorpus`, `policyRowMismatch`); `scripts/check-hook-parity.mjs` (`validateCorpora`, `isApprovedException`); `workflow/hooks/deny-dangerous/corpus.json` and `test/fixtures/hooks-bash/policy-reference.json` (search: `selftest-deny-dangerous-05c6ef8113f35b5d-1`, `native-powershell`).

## Lesson: Standalone hook probes need the generated dependency graph

**Status:** active | **Created:** 2026-10-29
**Decision changed:** Use the same generated hook module as the owning tests for standalone runtime probes, and check source/runtime parity separately.
**Trigger phase:** READ
**Caught at:** ACT

**Prevention:** Read the owning test's import before selecting a probe entrypoint. Some hook imports are generated CommonJS helpers that are unavailable beside the TypeScript source. A failed source-only import is a probe setup failure, not evidence about the policy decision.

**What happened:** The initial native-policy source-only probe failed to resolve `../gh-graphql-read.cjs` before evaluating any input. The probe was rerun through the generated evaluator, followed by the generator's check mode to confirm that the runtime matched its source. No source repair was needed for that import failure.

**Evidence:** `src/hooks/deny-dangerous/github-command.mts` (search: `gh-graphql-read.cjs`); `test/unit/hook-policy-evaluation.test.ts` (search: `../../workflow/hooks/policy-evaluation.mjs`); `scripts/generate-hook-runtime.mjs` (`generateHookRuntime`).

## Lesson: Finish runtime edits before running broad verification

**Status:** active | **Created:** 2026-10-29
**Decision changed:** Keep the generated runtime stable for the full duration of integration, touched-file and preflight checks.
**Trigger phase:** VERIFY

**Prevention:** Finish source edits, generate both runtime trees and check their hashes before starting broad checks. If a required correction changes source or runtime during a run, retain its output as invalidated evidence and rerun on stable final bytes.

**What happened:** During the native-policy repair, broad checks were still running when the PowerShell helpers were simplified. Typecheck observed stale generated output, and hook-sync integration observed files changing during admission. Those runs could not verify the final implementation. The separate complexity failures were real and required source refactoring; they were not dismissed as concurrency noise.

**Evidence:** `scripts/generate-hook-runtime.mjs` (`writeOrCheckRuntimeFiles`); `src/cli/server/hook-operation.ts` (search: `Hook files or choices changed during admission`); `test/integration/hook-sync-recovery.test.ts` (search: `migrates only the`).

## Lesson: Unicode policy probes need valid request encoding

**Status:** active | **Created:** 2026-10-29
**Decision changed:** Select UTF-8 explicitly for Unicode provider payloads while keeping malformed-byte tests separate.
**Trigger phase:** ACT
**Caught at:** VERIFY

**Prevention:** Check the test helper encoding before adding non-ASCII command cases. Assert the intended syntax refusal or safe result, not merely any denial from malformed input.

**What happened:** New Unicode cases used an existing Latin-1 helper intended for invalid-byte tests. Valid controls were denied during decoding instead of reaching command inspection. Selecting UTF-8 for the native matrix preserved the malformed-byte fixture and exposed the actual parser regressions.

**Evidence:** `test/unit/hook-policy-evaluation.test.ts` (`hook`, `stdinEncoding`, search: `native PowerShell decisions`).
