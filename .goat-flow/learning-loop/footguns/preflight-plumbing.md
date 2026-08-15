---
category: preflight-plumbing
last_reviewed: 2026-08-15
---

**Scope:** Data crossing the Node-to-shell boundary inside preflight and CI scripts - command substitution, formatting that shell arithmetic cannot parse, and stdout fed into pattern matchers. What the audit checks *mean* lives in [auditor.md](auditor.md).

## Footgun: Colourized `node -e` output silently disables shell numeric guards

**Status:** active | **Created:** 2026-08-15 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Whether a preflight PASS proves every check ran.
**Trigger phase:** VERIFY

**Symptoms:** A preflight section reports its heading green while emitting no per-item verdicts, and the run's total check count silently drops. `bash` prints `[[: 150: syntax error: operand expected (error token is "150")` to stderr, which is easy to scroll past because the summary line still says PASS.

**Why it happens:** `console.log(x)` inspects a non-string argument, and Node colourizes inspected numbers when `FORCE_COLOR` is set - an agent-harness default in some terminals. `node -e "console.log(require('./workflow/manifest.json').instruction_file.line_target)"` therefore returns `\e[33m125\e[39m`, not `125`. Command substitution captures the escape codes, `[[ "$count" -gt "$limit" ]]` fails to parse them, and both branches of the comparison are skipped - so the check emits neither pass nor fail. String-valued extractions (`.version`, `process.versions.node.split('.')[0]`) are unaffected because strings print raw, which is why the bug hides in exactly the numeric threshold checks that gate budgets.

**Evidence:** Measured 2026-08-15 with `FORCE_COLOR=3`: `node -e "console.log(...line_target)" | cat -v` printed `^[[33m125^[[39m`, and wrapping the value in `String(...)` printed `125`. `scripts/preflight-checks.sh` (search: `String() is load-bearing`) carries the fix and the reason. Before the fix the instruction-file line-budget loop produced four fewer checks (82 to 78) while still reporting PASS.

**Prevention:**
1. Wrap every `node -e "console.log(...)"` value consumed by shell arithmetic in `String(...)`. Treat a bare number as a formatting decision the shell cannot parse.
2. A check that can emit no verdict is worse than one that fails - a skipped branch reads as success. When a loop's only outputs are inside conditional branches, add an `else` that reports the unexpected state.
3. Do not accept a PASS summary as proof that every check ran. Compare the reported check count against the previous run; a drop with no removed checks means something stopped reporting.

---

## Resolved Entries

> Historical record. These entries are no longer active traps.

## Footgun: Preflight node-to-grep pipeline passes unsanitized stdout into regex patterns

**Status:** resolved | **Created:** 2026-04-21 | **Resolved:** 2026-04-21 | **Evidence:** ACTUAL_MEASURED

**Resolution:** Node output piped through `grep -oE '^[0-9]+$' | tail -1` to extract only numeric lines. Architecture doc matching switched from `grep -q` (BRE) to `grep -Fq` (fixed strings). `setup_count` initialized before the conditional block to prevent `set -u` crash. Commit on `dev` branch, `scripts/preflight-checks.sh` (search: `grep -oE '^[0-9]+$'`).

**Original symptoms:** `npm publish` failed: the round-trip fixture test (`test/integration/audit-drift.test.ts`, search: `installs fixture-backed references`) intermittently crashed with `grep: Unmatched [, [^, [:, [., or [=` in the Doc/Code Drift section. Root cause: `node --input-type=module` commands that compute check counts (`build_count`, `quality_count`, `setup_count`, `agent_count`) captured raw stdout including stray node diagnostic lines containing `[` characters. These were then interpolated into `grep -q "${build_count} build"` where grep interpreted `[` as a regex character class. The first fix (output sanitization) introduced a second failure: when the sanitized pipeline returned empty in the temp fixture (node imports fail without a working `dist/`), `setup_count` was never set because it was assigned inside the `if [[ -n "$build_count" ]]` block but referenced unconditionally on line 526 - crashing with `set -u` (`unbound variable`).
