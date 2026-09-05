---
category: verification-testing
last_reviewed: 2026-09-05
---

**Scope:** What a test must actually establish - observable contracts over incidental shape, deadlines independent of the thing under test, telling a transient failure apart from a regression, and the ways a passing suite still fails to prove its claim. Proving a guard or scanner works is [verification-scanners.md](verification-scanners.md); building fixtures is [test-fixtures.md](test-fixtures.md).

## Lesson: Timeout completion needs a deadline independent of child close

**Status:** active | **Created:** 2026-07-12
**Decision changed:** Treat a timeout response as incomplete proof until the host-facing call also returns within its wall-clock bound.
**Trigger phase:** VERIFY
**Incident count:** 2 | **Latest occurrence:** 2026-08-09

**Prevention:** Test timeout runners with a confirmed-started descendant that retains an inherited output handle. Assert the marker, response mode, timeout message, and wall-clock bound; a kill signal or timeout message alone does not prove the user regains control. Evidence anchors: `scripts/preflight-command-runner.mjs` (search: `cleanup deadline reached after process-group escalation`), `workflow/hooks/run-with-bash.mjs` (search: `function stopHookProcessTree`).

**What happened:** The seven-skill pressure matrix reproduced a preflight runner that exceeded its hard timeout after process-group escalation: a detached test helper escaped the group, inherited stdout and stderr, and held those pipes open, so Node delayed the child's `close` event after the direct process exited. The runner now uses a one-shot cleanup deadline and closes its local capture streams; the hook launcher starts a detached POSIX process group, uses Windows tree termination on native Windows, stops the tree at the deadline, and delivers one timeout result without waiting for a late close.

**Root cause:** Both timeout paths treated direct-child termination as completion, and the hook launcher killed Bash without bounding the process tree it had started.

**Recurrence 2026-08-09:** A preflight run reported `bounds gruff hooks with a timeout-specific response` as transient because its full-suite retry passed. Running the named test directly reproduced the failure in 2.02 seconds: the launcher emitted the expected timeout message and status but missed its 1.5-second return bound, and a fixture that wrote a marker after starting the background child reproduced the wait. `workflow/hooks/run-with-bash.mjs` (search: `function stopHookProcessTree`), `test/unit/hook-launcher.test.ts` (search: `returns promptly after a started hook descendant exceeds its deadline`).

---

## Lesson: Delegated pressure runs need persistent recovery state

**Status:** active | **Created:** 2026-07-12

**Prevention:** Use persistent native sessions for delegated or multi-turn pressure tests; keep ephemeral sessions for single-turn probes. Record the thread ID early and prove a recovery path before treating a long run as the sole release evidence.

**What happened:** A long `goat-critique` run launched with `codex exec --ephemeral` persisted Phase 1-4 evidence, was interrupted before synthesis, and `codex exec resume` then failed with `no rollout found`, so the attempt stayed UNVERIFIED and had to be repeated.

**Root cause:** The runner contract optimized for session cleanup although delegated critique is expensive and its completion evidence spans multiple agent results plus a meta-audit.

---

## Lesson: Cache-behaviour tests need observable contracts

**Status:** active | **Created:** 2026-05-20
**Decision changed:** Tests observe a boundary-level signal or, when instrumenting a shared API, filter calls to the exact resource identity under test; read-caching fixtures are rebuilt after backing files change.
**Trigger phase:** ACT
**Caught at:** VERIFY
**Incident count:** 3 | **Latest occurrence:** 2026-08-27

**Prevention:** For server cache behaviour, expose a narrow response or debug contract or inject the dependency, then assert at the route boundary. When a fixture uses `createFS`, write its final state before the first consumer call, or build a fresh filesystem and audit context after each mutation. When a test must instrument a shared API, first capture the resources the system under test selects, then count only calls involving that identity set. Avoid timing ratios and late monkeypatches of already-imported helpers. Evidence anchors: `src/cli/server/dashboard-quality-routes.ts` (search: `getOrRunQualityAudit`), `test/integration/dashboard-server-dashboard-api-quality.test.ts` (search: `reuses cached quality audits unless fresh=true is requested`), `src/cli/audit/check-agent-deny-mechanism.ts` (search: `checkHookSelfTest`).

**What happened:** A counter-based replacement for a flaky Quality cache timing assertion monkeypatched `child_process.execFileSync` to observe deny-hook self-test executions, but the route imports `execFileSync` as a named binding before the patch, so the counter stayed at zero and the focused dashboard integration test failed although the product behaviour was correct.

**Root cause:** The tests assumed their observation mechanism represented the behaviour under test; imported Node builtins, cached filesystem adapters, and unfiltered process-wide mocks hide or overcount the relevant event.

**Recurrence 2026-08-26:** A Windows hook-audit regression changed `.codex/hooks.json` after its first `checkHookRuntimeSmoke` call and expected the same audit context to observe the empty `commandWindows`; `createFS` had cached the first read, so the assertion exercised stale bytes. Fresh disposable audit contexts per scenario produced the intended proof. `src/cli/facts/fs.ts` (search: `const readFile = createCachedReadFile(resolvePath)`), `test/unit/audit-command/agent-deny-hooks-drift.test.ts` (search: `selects any present Codex Windows override`).
**Recurrence 2026-08-27:** A descriptor-lifetime test monkeypatched `fs.closeSync` and counted every close in the process, seeing nine before claim release when only two claim descriptors mattered. Recording descriptors from `.claim` opens with `"wx"` and filtering close observations to that set produced the intended assertion. `test/unit/path-write-claim.test.ts` (search: `acquires canonical target order and owner-releases every marker`).

---

## Lesson: Contract tests pin doctrine wording and path semantics

**Status:** active | **Created:** 2026-04-25
**Incident count:** 20 | **Latest occurrence:** 2026-08-29

**Prevention:** Before changing prose, a path, or an adjacent command, search the tests and durable semantic anchors for the exact old text; sibling parity proves agreement, not preservation of downstream contracts. Keep fixtures inside their consuming subtest. When fixture size feeds a derived assertion, recompute it with the production formula after every fixture edit. Update a contract only when product semantics change. Before drafting in a near-cap skill, measure the current word budget and pay for additions from unpinned text; before quoting a budget or score outcome, measure the exact sizes with the function the gate uses and state the margin.

**What happened:** Removing one forbidden phrase and changing dashboard quality-report ownership failed two contract checks in the first full `npm test`: a skill-hardening contract still required the "hardening debt" evidence language, and a dashboard prompt-source assertion still expected the old relative quality-report path message. `test/contract/skill-hardening-shared-3.test.ts` (search: `hardening debt`).

**Root cause:** Wording cleanup and path-semantics changes were treated as local edits, but these surfaces are pinned by tests because agents consume the exact phrasing.

**Recurrence 2026-05-17:** `test/smoke/dashboard-endpoints.test.ts` (search: `rejects missing and file project paths before PTY launch`) still asserted the old `Invalid project path` wording after `validateProjectPath` moved to the shared contract in `src/cli/server/local-paths.ts` (search: `Local path validation failed`).
**Recurrence 2026-07-13:** A manual JSON probe assumed a root `groups` key instead of the implemented `surfaces` groups; the locked fixture was right and the probe was rewritten against `goat-flow.context-report.v1`. `test/unit/context-report.test.ts` (search: `renders parseable JSON without telemetry or provider state`).
**Recurrence 2026-07-19:** A `setupPrompt` fixture landed in the preceding subtest, so RED failed with `setupPrompt is not defined` instead of the intended prompt-copy assertion. `test/contract/command-phrases.test.ts` (search: `keeps git-history correlations as candidates until semantic proof exists`).
**Recurrence 2026-07-29:** Pins include adjacency: inserting an `## Effort Estimates` section between the illustrative-scenario label and `## Assumption Tracking` in `goat-plan/references/milestone-examples.md` failed `test/contract/skill-hardening-shared-3.test.ts` (search: `scenario label must immediately precede the assumption block`).
**Recurrence 2026-08-03:** The first GREEN wording for oversized review scope and critique context merging pushed `goat-review` and `goat-critique` from 2495/2494 words to 2592/2531; budget-neutral rewrites finished at 2498/2495. `workflow/skills/goat-review/SKILL.md` (search: `never guess commit windows`), `workflow/skills/goat-critique/SKILL.md` (search: `never replace baseline context`), `test/contract/skill-hardening-review-1.test.ts` (search: `stops oversized inferred branch scopes before review begins`).
**Recurrence 2026-08-09:** A new roadmap passed `plans check --strict` after six mid-proof estimates were fixed, while 24 `Read first` anchors still named stale paths or paraphrases; each validator proves only its named contract, so paths and semantic anchors need their own exact check. `src/cli/plans-check.ts` (search: `mid-proof item(s) missing an (est: ...) entry`), `test/unit/plans-check-lifecycle.test.ts` (search: `strict mode rejects unestimated testing and mid-proof work`).
**Recurrence 2026-08-09 (goat-debug):** Qualifying a boundary command as `ALWAYS in Diagnose mode` passed the focused goat-debug contract but failed a shared contract that required the unqualified label; the shared contract now accepts the canonical label or that explicit qualifier. `workflow/skills/goat-debug/SKILL.md` (search: `ALWAYS in Diagnose mode`), `test/contract/skill-hardening-shared-1.test.ts` (search: `keeps canonical skill boundaries explicit and route-focused`).
**Recurrence 2026-08-16:** A budget estimate from a glance ("~3,000 chars", reaching the 10/10 token tier) was wrong when measured: the two moved goat-security sections were 1,328 and 1,546 chars, the replacement pointers cut the net to 2,395, and the skill stayed at 5,151 tokens against a 5,000 boundary, after the user had approved the plan on the estimate. `.goat-flow/learning-loop/footguns/skill-guidance.md` (search: `Dense functional skills satisfy the ADR-023 word cap`), `src/cli/quality/skill-quality-metrics.ts` (search: `tokens > 5000`).
**Recurrence 2026-08-19:** Shortening the three instruction files passed parity and line-count checks, but `stats --check` rejected the removed durable anchor and full preflight failed 3 of 2,122 tests on the shortened external-write authorization sentence; both phrases were restored across the mirrors. `.goat-flow/learning-loop/lessons/agent-behavior.md` (search: `Coding agents never run`), `test/contract/command-phrases.test.ts` (search: `AUTHORIZATION_POLICY`).
**Recurrence 2026-08-23:** Compressing the evidence matrix to restore its word budget changed a phrase cited by the new proof-boundary lesson; `stats --check` rejected the stale reference, retargeted to the live anchor. `.goat-flow/learning-loop/lessons/verification-testing.md` (search: `Mid-implementation proof gates split edit batches`).
**Recurrence 2026-08-23 (report schema):** The first full fast suite failed nine tests: one goat-qa contract still pinned the old gate sentence, and the shared dashboard capture fixture omitted the newly required `refuted_candidates` field. Updating the doctrine assertion and the one current-report fixture restored `# pass 2174`; legacy fixtures stay field-optional. `test/contract/skill-hardening-skills-1.test.ts` (search: `requires goat-qa Standard-mode gap output`), `test/unit/quality-draft-capture.test.ts` (search: `function validReport`).
**Recurrence 2026-08-24:** Adding a heading to the INDEX unit fixture fixed the parser regression but changed the fixture's byte-derived token estimate from 70 to 80, failing the adjacent expectation; the first lesson record then cited the guessed field `tokenEstimate` until a source read gave the real name. `test/unit/learning-loop-index.test.ts` (search: `approxTokenEstimate`).
**Recurrence 2026-08-24 (goat-plan):** A budget-neutral trim removed the adjacent Step 0 ordering contract's exact anchor; `Pick exactly one mode. First match:` restored both goat-plan contract files at 2,149 words, and the first evidence search omitted the Markdown bold boundary until narrowed to a raw-text substring. `workflow/skills/goat-plan/SKILL.md` (search: `Pick exactly one mode.`), `test/contract/skill-hardening-plan-1.test.ts` (search: `missing mode selection`).
**Recurrence 2026-08-29:** Changing the code-comment playbook's tag doctrine failed one adjacent contract that required the superseded sentence; the first full suite then failed dashboard preset source/build parity until the dashboard build ran, and final preflight found an inherited Prettier failure in the unchanged doctrine contract. `workflow/skills/playbooks/code-comments.md` (search: `Preserve current valid tags`), `test/contract/comment-playbook-doctrine.test.ts` (search: `translates broad reviewability prompts into exhaustive diagnosis`), `scripts/build-dashboard-assets.mjs` (search: `preset-prompts.json`), `test/contract/skill-quality-testing-doctrine.test.ts` (search: `does not validate a specific skill`).
**Recurrence 2026-08-29 (M71 lesson anchor):** A recurrence cited `Score rationale`, absent from the target file in that case; `stats --check` rejected it, and the literal suite name restored the evidence chain. `test/unit/quality-diff-delta-tag.test.ts` (search: `quality diff score rationale`).

## Lesson: Mid-implementation proof gates split edit batches

**Status:** active | **Created:** 2026-08-23
**Decision changed:** Stop each mutation batch at a declared mid-implementation proof and record its result before applying later-surface edits.
**Trigger phase:** ACT
**Caught at:** VERIFY
**Incident count:** 3 | **Latest occurrence:** 2026-08-23

**Prevention:** Split mutations at every declared mid-implementation proof: apply only the prerequisite files, run and record the exact gate with its exit status, then re-read and edit the later surfaces. Run explicit mechanical constraints, including requested line widths, immediately after each source patch. A late pass validates current state but never backfills the missed checkpoint; mark it late. Evidence anchors: `test/contract/skill-hardening-shared-1.test.ts` (search: `requires minimum evidence and rejects false proof for every claim type`), `workflow/skills/reference/skill-preamble.md` (search: `Claim controls set minimum evidence without changing proof classes`).

**What happened:** One approved edit batch grouped the shared evidence matrix, its contract, three instruction files, and a learning-loop consolidation, although the milestone required the focused contract after the matrix and test and before the instruction and lesson edits. The test later reported `# tests 16`, `# pass 16`, and `# fail 0`, but late, validating only the combined snapshot. In the same milestone the first exact comment-width scan caught a new 152-character context line against the 150-character ceiling.

**Root cause:** Files were grouped by one conceptual change and the patch boundary was treated as more important than the milestone's temporal proof boundary, which removed the gate's ability to catch a bad shared contract before it propagated; the width limit was judged visually instead of measured.

**Recurrence 2026-08-23:** The first write-scope fixture list included the three local instruction files although the midpoint gate had to run before they changed. Narrowed to the canonical reference plus four setup templates, the gate reported `# pass 76`; the three local paths joined afterwards and the final focused run reported `# pass 91`. `test/contract/command-phrases.test.ts` (search: `WRITE_SCOPE_RECONCILIATION_PATHS`).

---

## Lesson: Split transient preflight test failures from task regressions

**Status:** active | **Created:** 2026-04-26

**Prevention:** When preflight fails in the test phase after an unrelated gate fix, rerun the named failing test area and then the exact suite command directly before changing task files again. Preflight runs the coverage suite exactly once and fails on any `not ok`; there is no retry or warning downgrade; anchors `scripts/preflight-checks.sh` (search: `test_reports_coverage=true`) and `test/integration/preflight-progress.test.ts` (search: `pins one bounded coverage run`). If release-scale TAP can exceed the caller's output limit, capture the first run to a fresh disposable path so the failing case survives beside the summary. Report the split explicitly: which gate was fixed, which direct suite passed, and whether the preflight failure reproduced.

**What happened:** After a quality-report fix cleared the ESLint error blocking preflight, two further preflight runs reached the fast test phase and failed on different tests, `agent deny hook template comparison` and then `harness does not affect build-only result`, while a direct `npm run test:fast` immediately afterwards reported `# pass 373` and `# fail 0`.

**Root cause:** A failure inside the final gate was read as a task regression; the changing test names and the direct pass showed the task fix was complete and the wrapper was surfacing intermittent failures needing separate investigation. An earlier version of this Prevention described a one-shot `test:fast` retry; that retry was removed on 2026-08-16 (`refactor(core): consolidate setup preflight checks`), the removal is test-pinned, and two quality reports flagged the stale claim on 2026-08-18.

**Recurrence 2026-08-17:** After an ESLint fix cleared preflight's TypeScript stage, the fast suite observed a changelog mirror mismatch while playbook edits were in progress; the isolated sync suite passed `26/26` and a direct diff between `.goat-flow/skill-docs/playbooks/changelog.md` and `workflow/skills/playbooks/changelog.md` was empty, so no task file changed. Rerun the full gate only after mirrored writes are quiescent. `test/integration/preamble-sync.test.ts` (search: `template and installed changelog.md match`).
**Recurrence 2026-09-04:** A release repair's first `npm run test:full` stopped after the fast phase with `tests 2650`, `pass 2644`, `fail 1`, `skipped 5`, but truncated output no longer held the failing case. An immediate `npm run test:fast` captured to a fresh path exited 0 with `pass 2645`, and the exact full retry passed that plus the slow suite's `tests 474`, `pass 472`, `fail 0`, `skipped 2`. `package.json` (search: `"test:full": "npm run test:fast && npm run test:slow"`).

---

## Lesson: Coverage classification by filename misjudges in both directions

**Status:** active | **Created:** 2026-06-14
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
**Incident count:** 3 | **Latest occurrence:** 2026-09-03

**Prevention:** Every branch and nested requirement group needs an explicit stop, continue, or applicability rule plus a contract; headings are orientation, not control flow. Evidence: `workflow/skills/goat-security/SKILL.md` (search: `Quick-stop boundary`), `workflow/skills/goat-security/SKILL.md` (search: `Proportional Quick finding gate`), `workflow/skills/goat-security/SKILL.md` (search: `Exhaustive inventory gate`), `workflow/skills/goat-security/references/common-threats.md` (search: `For proportional trusted-component Quick`), `workflow/skills/goat-debug/SKILL.md` (search: `continue to I2 without waiting`), `test/contract/skill-hardening-security-1.test.ts` (search: `Quick Scan out of Full-only specialist work`), `test/contract/skill-hardening-security-1.test.ts` (search: `allows only observed trusted-component Quick risks`), `test/contract/skill-hardening-shared-2.test.ts` (search: `lets an explicit read-only investigation pass its scope checkpoint`).

**What happened:** On 2026-07-12 goat-security Quick Scan entered a Full-only specialist phase and waited about eight minutes; on 2026-07-18 goat-debug Investigate made an explicit read-only scope wait at I1. In both cases headings implied flow but did not define the runtime boundary.

**Recurrence 2026-09-03:** Goat-security had an explicit Quick stop, but unqualified inventory and baseline-family rules still made Full-grade completeness a precondition for retaining a supported component risk; the proportional finding gate and exhaustive inventory gate now own that split. `workflow/skills/goat-security/SKILL.md` (search: `Proportional Quick finding gate`), `test/contract/skill-hardening-security-2.test.ts` (search: `uses one Quick gap-ledger row while Full keeps exhaustive rows`).

---

## Lesson: A documentation pass can push a file past a size gate it was written to enforce

**Status:** active | **Created:** 2026-08-07
**Incident count:** 10 | **Latest occurrence:** 2026-09-04
**Merged:** 2026-09-05 - absorbed three file-length recurrences (2026-08-09 x2, 2026-08-28) from the Gruff comment-fixes lesson in `.goat-flow/learning-loop/lessons/verification-gruff.md`; same mechanism, different gate.

**Prevention:** Before adding comments, contract cases, or learning text to a file within about 20 percent of its size threshold, measure its headroom with the gate's own counter and plan the split first; `wc -l` and a word count are not the gate. Split by responsibility. Never accept the new finding: an oversized file created by the change that added the gate is what the gate exists to stop. Evidence anchors: `scripts/check-gruff-warning-ratchet.mjs` (search: `Release gate that stops reviewed Gruff warning debt`), `scripts/gruff-warning-ratchet-checks.mjs` (search: `The rules that decide whether Gruff warning debt regressed`), `scripts/ratchet-failure-report.mjs` (search: `Collects everything blocking a warning-ratchet run`).

**What happened:** Applying the mandatory comment standard to `scripts/check-gruff-warning-ratchet.mjs` grew it from 626 to 783 lines, past the 750-line `size.file-length` threshold, so the warning-debt ratchet reported its own checker as new debt on the run meant to prove the release clean.

**Root cause:** Comment work was treated as free of quality-gate consequences; doc comments on every function, context lines on every branch, and tag meanings add real lines, so a file near a threshold crosses it.

**Recurrence 2026-08-09:** A launcher refactor stopped at exactly 750 lines by `wc`, but gruff-ts counted 751 and still emitted `size.file-length`; removing one blank line restored a one-line buffer. `workflow/hooks/hook-launch-runtime.mjs` (search: `hookProcess.once("error"`).
**Recurrence 2026-08-09 (fixture):** Typed delivery assertions grew a registrar fixture to 752 lines and only full preflight caught the file-length warning; remove optional separators in touched long files, then run targeted Gruff before preflight. `test/integration/hook-effective-state.test.ts` (search: `keeps deterministic delivery evidence below live support`).
**Recurrence 2026-08-10:** Expanding hook-capability evidence pushed `.goat-flow/learning-loop/footguns/docs-and-crossrefs.md` to 40,372 bytes against the 40,000-byte bucket limit; compressing the new entry preserved its decisions and anchors. `src/cli/stats/stats.ts` (search: `BUCKET_SIZE_WARN_BYTES`), `.goat-flow/learning-loop/footguns/docs-and-crossrefs.md` (search: `Agent capability metadata goes stale when upstream docs add hooks`).
**Recurrence 2026-08-10 (playbook prose):** A reader-selection section and an anti-template rule took `.goat-flow/skill-docs/playbooks/code-comments.md` from 2,856 to 3,180 words against the 3,000-word ADR-023 progressive cap; trimming a fractal summary and a PHP rule stated in four places restored 2,983 with no rule lost. `test/contract/skill-hardening-contracts.test.ts` (search: `progressive reference packs stay within`).
**Recurrence 2026-08-12:** Two verification corrections pushed `.goat-flow/learning-loop/lessons/verification-preflight.md` to 40,736 bytes; consolidating the new gate rule into its existing Prevention reduced it to 39,999 without dropping the decision or anchor. `.goat-flow/learning-loop/lessons/agent-evidence-claims.md` (search: `A predecessor may exempt one named RED fixture`).
**Recurrence 2026-08-23:** The evidence matrix raised the always-loaded skill preamble to 1,507 words against its strict sub-1,500 cap; the focused 16-test doctrine contract passed, `npm run test:fast` exposed the budget regression, and compressing only the new wording to 1,489 words kept every tested control. `workflow/skills/reference/skill-preamble.md` (search: `Claim controls set minimum evidence without changing proof classes`), `test/contract/skill-hardening-contracts.test.ts` (search: `always-loaded shared references stay within the 1500-word cap`).
**Recurrence 2026-08-23 (module size):** Placing all refutation-ledger validation inside `src/cli/quality/schema-parser.ts` raised it to 1,377 lines and created the Gruff identity `design.large-module-concentration`; moving it into the focused ledger parser removed the identity while preserving the three-item baseline. `src/cli/quality/schema-refuted-candidates.ts` (search: `parseReportRefutedCandidates`), `src/cli/quality/schema-parser.ts` (search: `parseReportCollections`).
**Recurrence 2026-08-28:** M41 Task 9 ignored the already-read "Hold the file-length line continuously, not in a cleanup pass" pattern and expanded `src/cli/managed-setup-preview.ts` to 1,224 substantive lines, above Gruff's 1,000-line error threshold; the status collector moved to `src/cli/managed-install-evidence.ts` before CLI wiring or verification. `src/cli/managed-setup-preview.ts` (search: `selectedManagedReceiptProblems`), `src/cli/managed-install-evidence.ts` (search: `buildManagedInstallEvidenceReport`).
**Recurrence 2026-08-29:** M71 placed score-rationale cases in `test/unit/quality-subcommands.test.ts` and `test/unit/quality-report-contract.test.ts`, raising them to 1,049 and 1,005 substantive lines against Gruff's 1,000-line threshold; a focused owner restored both. `test/unit/quality-score-rationale.test.ts` (search: `quality score rationale schema`).
**Recurrence 2026-09-04:** Recording M15's activation-order recurrence made `milestone-accounting.md` 40,053 bytes, so `stats --check` stopped the integration gate; compressing only the new recurrence reduced it to 39,908 bytes with its decision and anchor intact. `.goat-flow/learning-loop/lessons/milestone-accounting.md` (search: `go-live M15 activation`), `src/cli/stats/stats.ts` (search: `BUCKET_SIZE_WARN_BYTES`).

---

## Lesson: A failed multi-file patch can preserve earlier edits

**Status:** active | **Created:** 2026-08-09
**Decision changed:** Inspect every target after a failed multi-file patch; never assume the operation was atomic.
**Trigger phase:** ACT
**Incident count:** 2 | **Latest occurrence:** 2026-08-09

**Prevention:** Prefer one file, or one independently recoverable hunk group, per patch when source is changing concurrently. After any patch failure, inspect timestamps and exact semantic anchors across every target before retrying, then build the retry from current bytes. The affected artifacts were gitignored milestone files, so they are not cited as durable anchors; the evidence was the failed patch result and the same-session target-by-target read.

**What happened:** During peer-plan synthesis one patch updated the roadmap issue and provider-contract milestone, then failed when a later post-turn hunk used a near-match instead of the file's exact wording. The failure named only the unmatched hunk, so the operation looked rejected as a whole, but the earlier file edits had persisted.

**Root cause:** A multi-file patch was treated as a transaction and reasoned about from the final failing hunk instead of the state of every target, so the retry risked applying landed edits twice or building hunks against stale bytes.

**Recurrence 2026-08-09:** A malformed Markdown-list hunk in a rollback patch failed after earlier file hunks in the same request; this time a target-by-target diff found no retained edits. The patch surface has shown both partial and atomic-looking failures, so inspection stays the recovery contract.
