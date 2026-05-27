---
category: external-lessons
last_reviewed: 2026-05-27
---

Patterns extracted from reviewing merged PRs in external projects relevant to goat-flow's
surfaces (CLI, dashboard, audit pipeline, config merging, persistence). Each entry names
the source PR(s), the root cause, and the goat-flow surface where the rule applies.

## Lesson: Error messages MUST include the input identity that caused them

**Status:** active | **Created:** 2026-05-25

**What happened (external — promptfoo PR #9317 + #9333):**

PR #9317: A cache no-cache fetch path threw with only the raw body: `Error: error code: 1006`. No URL, no HTTP status, no parse position. Cloudflare-blocked failures were unattributable because the consumer of the error had no way to tell which URL had failed or whether the response was malformed JSON, an empty body, or a 5xx HTML page. Fix included URL, parse message, HTTP status + text, and the body snippet in the thrown error.

PR #9333: `eval --import` had three error-shape bugs in one go: (1) schema-invalid JSONL re-threw a stale `JSON.parse` position from earlier in the file because the parser didn't reset state between rows; (2) unparseable `evaluationCreatedAt` crashed as `RangeError: Invalid time value` with no field name; (3) `collectBlobHashes` overflowed the stack on nested input because the recursion was unbounded. Fixes: report row / field for parse errors, warn-and-fallback on invalid dates with the field name, bound recursion with `maxDepth: 64`.

**Root cause across both:** Error messages were constructed by the function that detected the failure, not by the function that knew the input identity. By the time the error bubbled up, the URL / row / field / file was several stack frames away and discarded. "Failed to parse JSON" is the same error message for every JSON file in the system.

**Prevention:**
1. Every thrown error from audit, CLI, hook, or HTTP-fetch code MUST include the input identity that caused it: file path, line / row number, URL, HTTP status, schema field name. "Failed to parse JSON" alone is a bug.
2. Validate dates and numbers with explicit checks before they reach formatters: `Number.isFinite(n)`, `!Number.isNaN(Date.parse(s))`. A `RangeError: Invalid time value` is the JS formatter complaining that no upstream check caught the malformed value.
3. Any recursive walker over user-supplied or external data needs an explicit `maxDepth` (and ideally a `maxNodes`). Stack overflow on a hostile input is a denial-of-service, not a parse error. Goat-flow surface: audit file walkers in `src/cli/facts/fs.ts` and `src/cli/audit/check-*.ts` that traverse target-project repositories.
4. When error context is far from the throw site, wrap with a typed error class that takes a context object: `throw new AuditError("parse failed", {file, line, content: content.slice(0, 200)})`. The caller's catch block has the full context for free.

Applies wherever goat-flow throws on user-supplied or external-supplied data: audit checks reading target-project files, dashboard server reading config files, CLI commands parsing user-supplied JSON / YAML / CSV.

---

## Lesson: Bug-fix clusters arc fix → over-correct → calibrate when the original bug was a silent equality-contract violation

**Status:** active | **Created:** 2026-05-25

**What happened (external — promptfoo PR cluster #9402 → #9408 → #9430):** Three PRs over three days fixing the same root cause (function-as-dedupe-key collisions in `combineConfigs`):
- #9402: Branch on `typeof` — functions use reference identity, plain data use `JSON.stringify`. Fixed the originally-reported "lost providers" bug.
- #9408: Found three cases #9402 missed (objects containing functions, class instances, cycle / BigInt configs). Rule changed to "give up — preserve any item whose key can't be computed."
- #9430: #9408's "give up" rule was too eager — same reference twice was kept as duplicates. Final fix uses a `JSON.stringify` replacer that swaps each function for `{__functionReference: id}` keyed by reference identity.

The three PRs landed within 72 hours. Each commit message says "fix" but the bug class kept shifting: from "lost providers" to "duplicated providers" to "non-deterministic dedupe key." The team didn't ship a regression; they shipped the predictable arc of fixing a silent-equality-contract bug.

**Root cause of the arc shape:** When the original bug is a silent equality-contract violation (two values that "should be equal" are not, or vice versa), the first fix trades one silent failure for a louder one. The next PR walks back the over-correction. The third (or fourth) PR finds the principled invariant. This arc happens because:
1. The original symptom is observable (count of items dropped from N to M), so the first fix is scoped to that symptom.
2. The first fix necessarily changes the equality definition, which immediately surfaces a second class of failure that was previously masked.
3. Each fix ships behind "this passes the regression test for the originally-reported case," which is true but insufficient.

**Prevention:**
1. When reviewing a fix for a silent-equality-contract bug, ask: "what does this fix change about how items are considered equal, and what previously-silent cases now become loud or quiet differently?" Don't ship until both directions are covered.
2. Write the test for the OPPOSITE failure mode before the fix. If you're fixing "items dropped that should have been kept," also write the test for "items kept that should have been dropped." If you can construct only one direction, you don't understand the equality surface.
3. Expect a follow-up PR. When the commit message says "fix X" and X involves equality / dedupe / merge / hash-keying, schedule a calibration pass within the same milestone. The promptfoo team shipped the calibration on day 3; budgeting for it up front would have saved the second incident.
4. For goat-flow merge surfaces (`compose-setup.ts` skill merging, manifest reconciliation, hook config dedupe), prefer "preserve when uncertain" over "drop on suspected duplicate." A visible duplicate is a loud failure; a silent loss is a quiet one. Document the rule once in the merge function's docstring.

Reinforces existing CLAUDE.md verification discipline: "Fix verified by passing the test suite" is not "fix verified." The reproducer for the OPPOSITE failure mode must also be exercised. Cross-reference: `.goat-flow/footguns/config.md` (search: `dedupe key silently drops function values`) documents the specific footgun this arc fixed.

---

## Lesson: New polymorphic classes ship with silent bugs without integration tests at parity

**Status:** active | **Created:** 2026-05-25

**What happened (external — mini-swe-agent PR #777, 2026-03-10):** `ContreeEnvironment.execute()` had two `self.session.run(...)` calls back-to-back; every command ran twice with no integration tests to catch it. The fix added 10 unit tests at parity with sibling env classes; the duplicate surfaced immediately. Evidence: `.goat-flow/scratchpad/related/mini-swe-agent/src/minisweagent/environments/extra/contree.py`.

**Prevention:** Every new audit check, harness check, agent profile, environment-style class, or hook script must land with parametrized tests at the same scenario surface as its siblings. Mini's `model_factory` parametrizes every agent test across three action formats; goat-flow's equivalent runs across all four agent harness configs in `test/integration/`. Code review for new polymorphic classes must include "show me the integration tests at parity with sibling X."

---

## Lesson: Tests that monkeypatch the function under test mask empty production paths

**Status:** active | **Created:** 2026-05-25

**What happened (external — awslabs/cli-agent-orchestrator PR #245):** CAO shipped `_get_terminal_context()` returning `{"cwd": None, ...}` with a comment claiming dynamic tmux resolution but no resolution was wired. All 65 tests passed because they monkeypatched `_get_terminal_context` itself, never exercising the empty production code path. Production silently routed every `project`-scoped memory store into the global container. Caught at code review by reading the code, not by tests (P0-A in haofeif's 2 P0 / 3 P1 / 6 P2 tally).

**Root cause:** Replacing the system-under-test with a stub means tests measure the stub's behaviour, not the production code. The hole is invisible to coverage tools because the stubbed function appears to "run" in tests.

**Prevention:**
1. When stubbing for tests, stub the function's *dependencies* (DB, network, tmux helpers), not the function itself.
2. For any helper that reads from environment state (tmux, env vars, system queries), the production-path test must call the real function with the *environment* mocked. CAO's fix added `TestTerminalContextResolution` (P3-B) that stubs `SessionLocal` and the tmux helper but exercises the real `_get_terminal_context`.
3. If a specific scenario genuinely needs to monkeypatch the SUT, add at least one production-path test that doesn't.

Related principle: replacing the subject of measurement with a stub or shortcut - the function under test here, a peer verifier doing only half the checks elsewhere - means the measurement no longer covers what was claimed.

---

## Lesson: CLI must enforce every constraint the service silently applies

**Status:** active | **Created:** 2026-05-25

**What happened (external — awslabs/cli-agent-orchestrator PR #245 P2-E):** CAO shipped a CLI key validator that checked charset (`^[a-z0-9-]+$`) but not length, while the downstream `MemoryService._sanitize_key` silently truncated keys to 60 chars. Users could store a 100-char key via the CLI; downstream lookup truncated and never found it. The length constraint existed - only one of two boundary layers enforced it. Fix added a `len(key) > _MAX_KEY_LENGTH` check at the CLI boundary mirroring the service's silent ceiling.

**Root cause:** The CLI deferred to the service for validation, the service deferred to its sanitiser, the sanitiser silently fixed bad input. Each layer assumed someone else would reject. No layer rejected; data became unrecoverable.

**Prevention:**
1. Every public boundary that accepts an identifier (CLI arg, HTTP query param, MCP tool argument) MUST enforce charset, length, and reserved-name rules at the boundary - not delegate them downstream.
2. Mirror existing discipline: `src/cli/server/safe-exec.ts` (search: `security boundary, not`) - explicit allowlists at the call site, not `command -v` lookups at the inner layer.
3. When adding a sanitiser that silently truncates or rewrites input, audit existing callers and ensure every boundary that may pass input to it rejects what the sanitiser would silently mutate.

**Applies to:** any goat-flow CLI command that accepts a slug, key, or path component (skill names in `src/cli/cli.ts`, project labels in `src/cli/server/dashboard-routes.ts`, custom prompt IDs surfaced by dashboard custom-prompts UI). Verification: grep for user-supplied identifiers becoming file/directory components and confirm each has a boundary validator at the public surface, not only at the inner layer.

---

## Lesson: Verify a fix by re-running the original reproducer, not just the test suite

**Status:** active | **Created:** 2026-05-25

**What happened (external — stanfordnlp/dspy PR #9741):** `Module.load_state` walked `named_parameters()` and applied each value in place. If parameter N raised mid-loop, parameters 0..N-1 were already overwritten — the module passed `isinstance` checks, looked structurally valid, but served inference from a mix of saved demos and fresh defaults. Users attributed weeks of silent degradation to "model drift." Three closed predecessor PRs (`#9590`, `#9657`, `#9655` — all verified `CLOSED`, none merged) each shipped a "fix" that validated keys/structure first then applied — and ran the existing test suite to confirm. None ever ran the issue's reproducer end-to-end. The bug was specifically about mid-loop *value* corruption, not key/structure corruption, so structural validation passed and the suite stayed green while the bug remained. #9741's author wrote in the PR body: "I have been following this thread since the issue was filed and reviewed all three closed PRs before writing this," and added a deepcopy dry-run pass that reproduces the entire mutation against a sidecar before touching `self`. Evidence: `.goat-flow/scratchpad/related/dspy/dspy/primitives/base_module.py` (search: `_apply(self.deepcopy())  # trial run raises before self is touched`).

**Root cause across the three failed PRs:** "Fix verified by passing the test suite" is not "fix verified." The bug authored a test (the reproducer in the issue); the team authored a test (the existing suite). The reproducer was the specific test that surfaced this specific failure mode. Skipping it three times in a row produced three closed PRs and weeks of degradation in the field.

**Prevention:** When fixing any bug whose original report includes a reproducer:
1. Run the reproducer once *before* the fix to confirm it still fails in the current environment (proves the harness surfaces the bug).
2. Apply the fix.
3. Run the *same* reproducer to confirm it now passes — separately from the test suite.
4. Only then run the full test suite as regression coverage.

"Test suite passes" is necessary but not sufficient evidence of a bug fix. Reinforces CLAUDE.md's "Fix verification" hallucination red-flag ("Do not claim a fix works without running the reproduction steps that originally demonstrated the bug. 'Looks correct' is not verification."). The dspy case is concrete cost evidence: three failed PRs over weeks of repeated review cycles, traceable to skipping step 3.

---

## Lesson: Status markers drift from ground truth unless the audit verifies the underlying change

**Status:** active | **Created:** 2026-05-26

**What happened (external — kennyjpowers/claude-flow PR #3, MERGED 2025-11-22, 14,693 additions):** An OIDC workflow change was logged as done across two sessions but the underlying file was never modified. Session 1 created the publish workflow using `NPM_TOKEN`. Session 2 marked Task 1.12 as `🔄 UPDATED` to indicate the OIDC switch was complete — but the workflow file itself was never edited. The divergence persisted until a user noticed both production workflows looked identical. The post-incident commit `9e2e3b3` ("fix: properly implement OIDC workflow and temporarily disable") records the discovery, and the implementation log at `specs/package-publishing-strategy/04-implementation.md` distills the rule: *"Task 1.12 was marked UPDATED for OIDC but file was never modified. Session 1 created workflow with NPM_TOKEN. Session 2 updated task spec but not actual file. Caught by user noticing both workflows looked identical. Documented lesson: UPDATED tasks need code changes verified."*

**Root cause:** Status markers in human-curated task files (`✅ DONE`, `🔄 UPDATED`, `⏳ NEW`, or checkbox `[x]`) are *claims* about the world, not measurements of it. When the marker is updated but the corresponding code change is missed — because the session was interrupted, the agent assumed the change was trivial, or the task was incrementally re-marked across multiple sessions — the marker file drifts from ground truth. Subsequent audits that read the marker as authoritative reinforce the divergence. No purely structural check (does the marker exist? is the heading correct?) can catch this; the marker is structurally valid even when its claim is false.

This is the task-tracking analogue of the goat-flow baseline pain point #2 (scanner compliance vs quality divergence): the structural signal (marker says DONE) passed while the truth (file unchanged) did not. The existing split between deterministic audit and inferential critique is designed to surface this shape; M14 (directive enforcement gradient) extends it to instruction-file directives. Neither mechanism today covers task-file completion claims directly.

**Prevention:**
1. When a task tracker (markdown checklist, milestone file, plan section) marks an item DONE or UPDATED, the audit (or peer review) must verify the underlying artifact changed in the expected way. Reading only the marker is reading the team's claim, not the world.
2. For goat-flow's own milestone files (`.goat-flow/tasks/**/*.md` and the `M*.md` files in `related-improvement-ideas/`), the Mid-Implementation Proof section and Exit Criteria already require verification beyond marking the checkbox. The lesson here is that this discipline only works if the proof is *executed*; marking the box without running the proof reproduces the kennyjpowers OIDC failure mode.
3. The lightest-weight defence is a paired check: each completion claim cites a specific changed file, section, and grep-friendly evidence string, and the audit greps for the cited evidence. If the grep fails, the claim is unverified.
4. For interactive sessions that span multiple turns, save-as-you-go on the marker file is necessary but not sufficient — the corresponding edit on the underlying file must land in the same session, or the marker must be reverted before the session closes. Treat any session-end state where the marker advances without a corresponding code diff as a defect.

Goat-flow surfaces where this could bite: every milestone Exit Criteria checklist; every Mid-Implementation Proof; every change to `.goat-flow/tasks/*.md` that doesn't pair with a code diff in the same PR. Cross-reference: `.goat-flow/footguns/quality.md` (search: `Structural validation passes while content is still unanswerable`) records the parallel structural-vs-content failure at the audit boundary; this lesson is its task-tracking analogue. Also reinforces existing CLAUDE.md verification discipline ("MUST read relevant files before changes. Never fabricate codebase facts.") — the marker file is part of the relevant set, but it is not authoritative about what was actually changed.
