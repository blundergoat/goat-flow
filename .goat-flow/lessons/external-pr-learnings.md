---
category: external-pr-learnings
last_reviewed: 2026-05-25
---

Lessons extracted from reviewing merged PRs in external projects relevant to goat-flow's
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
