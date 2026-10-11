---
category: verification-testing
last_reviewed: 2026-10-11
---

**Scope:** What a test must actually establish - observable contracts over incidental shape, coverage judged per behaviour rather than per file, evidence identity proved through the same bytes and resolver the product uses, and skill branches whose stop or skip rule needs its own contract. Changing text that tests already pin is [contract-pinned-wording.md](contract-pinned-wording.md); size limits crossed by added text are [verification-size-gates.md](verification-size-gates.md); ordering edits and gate runs during a change is [verification-gate-runs.md](verification-gate-runs.md); proving a guard or scanner works is [verification-scanners.md](verification-scanners.md); building fixtures is [test-fixtures.md](test-fixtures.md); process-lifecycle and delegated-run tests are [verification-testing-process.md](verification-testing-process.md).

Related evidence moved intact to [platform-verification.md](platform-verification.md).

## Lesson: Cache-behaviour tests need observable contracts

**Status:** active | **Created:** 2026-05-20
**Severity:** INTEGRATION
**Decision changed:** Tests observe a boundary-level signal or, when instrumenting a shared API, filter calls to the exact resource identity under test; read-caching fixtures are rebuilt after backing files change.
**Trigger phase:** ACT
**Caught at:** VERIFY
**Incident count:** 3 | **Latest occurrence:** 2026-08-27

**Prevention:** Assert cache behavior through a response, debug contract or injected dependency. Finish `createFS` fixtures before the first read, or rebuild their audit context after mutation. Instrument shared APIs only after selecting the relevant resource identities; count calls to those resources. Avoid timing ratios and late monkeypatches of imported helpers. Owners: `src/cli/server/dashboard-quality-routes.ts` (search: `getOrRunQualityAudit`), `test/integration/dashboard-server-dashboard-api-quality.test.ts` (search: `reuses cached quality audits unless fresh=true is requested`), `src/cli/audit/check-agent-deny-mechanism.ts` (search: `checkHookSelfTest`).

**What happened:** Replacing a flaky Quality-cache timing assertion with an `execFileSync` counter failed: the route had already imported the named binding, so the monkeypatch observed zero self-tests despite correct behavior.

**Root cause:** Imported bindings, cached adapters and process-wide mocks hide or overcount the selected event.

**Recurrence 2026-08-26:** Mutating `.codex/hooks.json` after `checkHookRuntimeSmoke` left `createFS` reading cached bytes instead of the empty `commandWindows`. Fresh contexts restored proof. `src/cli/facts/fs.ts` (search: `createCachedReadFile`), `test/unit/audit-command/agent-deny-hooks-drift.test.ts` (search: `selects any present Codex Windows override`).
**Recurrence 2026-08-27:** A `closeSync` counter saw nine process-wide closes instead of two claim descriptors. Filtering descriptors from `.claim` opens with `"wx"` restored the assertion. `test/unit/path-write-claim.test.ts` (search: `acquires canonical target order and owner-releases every marker`).

---

## Lesson: Dated provider evidence must be resolved at publication time

**Status:** active | **Created:** 2026-09-21
**Decision changed:** Before publishing a provider-support claim, resolve the registry record through the same current-state function the product uses and preserve the capture's provider and configuration limits.
**Trigger phase:** VERIFY
**Caught at:** VERIFY

**Prevention:** Compare support prose with `currentHookProviderSupportGate` and the applicable capture history. Calendar expiry was removed on 2026-10-10: elapsed time must leave the gate unchanged; trust, registration, result delivery, and local scenario proof still gate effectiveness. Evidence: `src/cli/server/hooks-registry.ts` (search: `currentHookProviderSupportGate`) and `test/integration/hook-provider-contracts.test.ts` (search: `assertCurrentCodexDenyEvidence`).

**What happened:** Under the previous calendar-expiry rule, the v1.17.0 documentation alignment correctly restored fresh Codex Stop evidence but described all three dated captures as `scenario-unverified`. During final release verification, the current resolver reported both deny hooks as `provider-capture-stale` because their shared PreToolUse capture had expired earlier that day. The docs and contract were corrected without extending the evidence date.

**Root cause:** The first contract compared prose with the registry's stored gate and expiry fields. It did not execute the resolver that turns an elapsed date into the current support state.

---

## Lesson: Coverage classification by filename misjudges in both directions

**Status:** active | **Created:** 2026-06-14
**Severity:** INTEGRATION
**Decision changed:** Search the whole test tree and classify each named behaviour or invariant; a file-level label cannot promote uncovered siblings.
**Trigger phase:** READ
**Caught at:** VERIFY
**Incident count:** 3 | **Latest occurrence:** 2026-08-23

**Prevention:** Search all tests and end-to-end invocations before classifying. Inventory every named behaviour or invariant, make CRITICAL and HIGH exhaustive, and assign one coverage row per behaviour; BEHAVIOURAL applies only to what that row proves. Keep shipped examples non-evidence unless a contract locks live coverage. Evidence anchors: `workflow/skills/goat-qa/SKILL.md` (search: `A file summary cannot promote a row`), `test/contract/skill-hardening-shared-2.test.ts` (search: `keeps covered behaviours from deferring uncovered siblings`), `src/cli/audit/check-goat-flow.ts` (search: `SETUP_CHECKS`), `test/integration/audit-build.test.ts` (search: `assertBuildChecksPass`).

**What happened:** A shipped Audit example classified coverage from same-name unit files and made three NONE or untested claims that integration suites disproved or later invalidated. On 2026-07-19 goat-qa A3's single label per file let one covered behaviour hide an uncovered sibling, and the first correction required only CRITICAL and HIGH rows, leaving MEDIUM and LOW rows ambiguous until manual verification.

**Root cause:** Filename and file-level summaries are lossy coverage proxies; tests cross filenames, and one source file holds behaviours with different coverage depths.

**Recurrence 2026-08-23:** A quality-diff consumer inventory searched the implementation symbols `QualityDiffResult`, `buildQualityDiff`, `renderQualityDiffText`, and `.absent`, then inferred the complete test-owner set. A shipped-contract phrase sweep exposed `test/unit/quality-report-contract.test.ts` (search: `prior-report runs re-test claims while fresh runs keep the no-prior contract`), which separately pins the prompt rule in `src/cli/prompt/compose-quality-common.ts` (search: `omission is not verified resolution`); the inventory was reopened and its focused run reported 54/54.

## Lesson: Declined optional verification must not create a degradation flag

**Status:** active | **Created:** 2026-07-12

**Prevention:** Optional verification gets a separate status and cannot create degradation by absence alone. Name forbidden flags and pin each path. Evidence: `workflow/skills/goat-review/SKILL.md` (search: `Optional skip is not degradation`), `test/contract/skill-hardening-review-3.test.ts` (search: `solely because the user declined`), `test/contract/skill-hardening-review-3.test.ts` (search: `keeps an unselected optional Spec Drift pass out of review degradation`).

**What happened:** On 2026-07-12 declining goat-review's optional external refuter added `coverage-degraded`; on 2026-07-18 an unselected Spec Drift pass added `spec-drift-skipped`. Both penalized a complete local review for omitting optional verification.

---

## Lesson: Depth headings do not create runtime stop boundaries

**Status:** active | **Created:** 2026-07-12
**Severity:** INTEGRATION
**Incident count:** 3 | **Latest occurrence:** 2026-09-03

**Prevention:** Every branch and nested requirement group needs an explicit stop, continue, or applicability rule plus a contract; headings are orientation, not control flow. Evidence: `workflow/skills/goat-security/SKILL.md` (search: `Quick-stop boundary`), `workflow/skills/goat-security/SKILL.md` (search: `Proportional Quick finding gate`), `workflow/skills/goat-security/SKILL.md` (search: `Exhaustive inventory gate`), `workflow/skills/goat-security/references/common-threats.md` (search: `For Proportional Quick`), `workflow/skills/goat-debug/SKILL.md` (search: `continue to I2 without waiting`), `test/contract/skill-hardening-security-1.test.ts` (search: `Quick Scan out of Full-only specialist work`), `test/contract/skill-hardening-security-1.test.ts` (search: `allows only observed trusted-component Quick risks`), `test/contract/skill-hardening-shared-2.test.ts` (search: `lets an explicit read-only investigation pass its scope checkpoint`).

**What happened:** On 2026-07-12 goat-security Quick Scan entered a Full-only specialist phase and waited about eight minutes; on 2026-07-18 goat-debug Investigate made an explicit read-only scope wait at I1. In both cases headings implied flow but did not define the runtime boundary.

**Recurrence 2026-09-03:** Goat-security had an explicit Quick stop, but unqualified inventory and baseline-family rules still made Full-grade completeness a precondition for retaining a supported component risk; the proportional finding gate and exhaustive inventory gate now own that split. `workflow/skills/goat-security/SKILL.md` (search: `Proportional Quick finding gate`), `test/contract/skill-hardening-security-2.test.ts` (search: `uses one Quick gap-ledger row while Full keeps exhaustive rows`).

---

## Lesson: Hash evidence bytes before decoding text

**Status:** active | **Created:** 2026-09-14 | **Evidence:** ACTUAL_MEASURED
**Severity:** CORRECTNESS
**Incident count:** 2 | **Latest occurrence:** 2026-10-01

**Prevention:** Hash the file buffer before decoding. Malformed UTF-8 changed the hash in `src/cli/plans-forecast-history.ts` (search: `readHistoryPlan`); the raw-buffer correction passed the same reproduction. `test/unit/plans-check-history.test.ts` (search: `Buffer.from([0xff])`) preserves that case.

**Recurrence 2026-10-01:** The change rejected a raw hash after decoding `0xff`. `test/integration/quality-history-diff.test.ts` (search: `hashes original evidence bytes`) failed before correction. `src/cli/project-file.ts` (search: `readProjectFileBytes`) supplies guarded bytes to `src/cli/quality/fix-references.ts` (search: `function sha256`); Git output also stays raw until hashed.

## Lesson: Exercise reference identity and availability independently

**Status:** active | **Created:** 2026-10-01 | **Evidence:** ACTUAL_MEASURED
**Trigger phase:** ACT | **Caught at:** VERIFY
**Decision changed:** Test identity, availability and artifact formats before delivery.

**Prevention:** Pair accepted project aliases with a foreign-project control. Restore evidence without changing saved admission. Check metadata alongside hashes.

The change rejected an alias, hid restored evidence and admitted a capture without source identity. Each regression failed before correction and passed afterward. Requiring canonical JSON then broke three workspace cases; hashes already bind artifact bytes. Evidence: `test/integration/quality-history-diff.test.ts` (search: `project aliases`, `restored references`, `missing source identity`, `binds workspace static proof`).
