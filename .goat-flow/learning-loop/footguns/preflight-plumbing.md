---
category: preflight-plumbing
last_reviewed: 2026-10-14
---

**Scope:** Data crossing the Node-to-shell boundary inside preflight and CI scripts: command substitution, formatting that shell arithmetic cannot parse, and stdout fed into pattern matchers. What the audit checks mean lives in [auditor.md](auditor.md).

## Footgun: Knip's `ignore` cannot shrink what preflight's Knip step reads

**Status:** active | **Created:** 2026-08-16 | **Evidence:** ACTUAL_MEASURED

**Prevention:** Do not reach for `ignore` or `ignoreFiles` to fix a Knip memory failure; by their own schema they filter the report, not the walk, and raising the heap alone only pays the walk more slowly. Use `--no-gitignore` after confirming the analysed globs contain no gitignored files. Before treating any Knip failure as a code defect, run once with a larger heap; exit 0 with no findings means the change set is clean, and a detached worktree at the last commit with the same changed files separates change set from local state in one run.

**Symptoms:** Preflight's TypeScript phase fails with `Knip: 0 | ? unused exports/types` and Knip exits 134. The `0 | ?` is parsed from an OOM stack trace because `scripts/preflight-checks.sh` (search: `knip_command=(`) counts captured result lines and falls back to `?`. Adding the offending directory to `knip.json` `ignore` changes nothing.

**Why it happens:** The installed `node_modules/knip/schema.json` titles `ignore` "Files to exclude from the report (any issue type)" and `ignoreFiles` "Unused files to exclude from the report"; only `project` and `entry` define the analysed set, which here is already `src/**/*.ts`, `scripts/**/*.mjs`, and `test/**/*.ts`. `knip --debug` shows the real cost: it walks the entire checkout collecting every nested `.gitignore` into a `gitignoreFiles` list, and a scratchpad holding cloned repositories contributes hundreds, so the heap is spent deciding what to skip before analysis starts.

**Evidence:** Measured 2026-08-16 with `.goat-flow/scratchpad` holding 31,249 `.ts` files across 5.4 GB: a detached worktree at the same commit passed under the identical 5120 MB cap while this tree exhausted it, adding `.goat-flow/**` and `_temp/**` to `ignore` changed nothing, and a 10240 MB heap completed with zero findings. `scripts/preflight-checks.sh` (search: `--no-gitignore keeps Knip from walking`) now passes `--no-gitignore`: 0.845 s, exit 0, and the TypeScript phase fell from about 250 s to 15.9 s. Coverage was proven unchanged: `knip --debug` analysed 425 paths with and without the flag, a planted unused export in `src/` was still reported with exit 1, and `git status --ignored --short src test scripts` plus `git ls-files --others --ignored --exclude-standard` showed nothing gitignored under `src/`, `test/`, or `scripts/` against a `dist/` control that reported `!!`. CI runs Knip only through preflight on fresh checkouts, inside the round-trip test's temporary copy and in the `checks` job, so local scratchpad state cannot reach it there; re-run the path diff if the `project` globs ever widen to a directory holding gitignored files.

## Footgun: Colourized `node -e` output silently disables shell numeric guards

**Status:** active | **Created:** 2026-08-15 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Whether a preflight PASS proves every check ran.
**Trigger phase:** VERIFY

**Prevention:** Wrap every `node -e "console.log(...)"` value consumed by shell arithmetic in `String(...)`. If a loop's only outputs sit inside conditional branches, add an `else` that reports the unexpected state, because a check that can emit no verdict reads as success. Do not accept a PASS summary as proof every check ran; compare the reported check count against the previous run, and treat a drop with no removed checks as something that stopped reporting.

**Symptoms:** A preflight section reports its heading green while emitting no per-item verdicts and the total check count drops. `bash` prints `[[: 150: syntax error: operand expected (error token is "150")` to stderr, easy to scroll past because the summary still says PASS.

**Why it happens:** `console.log(x)` inspects a non-string argument, and Node colourizes inspected numbers when `FORCE_COLOR` is set, an agent-harness default in some terminals, so `node -e "console.log(require('./workflow/manifest.json').instruction_file.line_target)"` returns `\e[33m125\e[39m`. Command substitution captures the escapes, `[[ "$count" -gt "$limit" ]]` fails to parse, and both branches are skipped. String-valued extractions print raw, which is why the bug hides in exactly the numeric threshold checks that gate budgets.

**Evidence:** Measured 2026-08-15 with `FORCE_COLOR=3`: `node -e "console.log(...line_target)" | cat -v` printed `^[[33m125^[[39m`, and wrapping the value in `String(...)` printed `125`. `scripts/preflight-checks.sh` (search: `String() is load-bearing`) carries the fix; before it the instruction-file line-budget loop produced four fewer checks (82 to 78) while still reporting PASS.

## Footgun: A preflight diagnostics test cuts the Tests section out by its first marker string

**Status:** active | **Created:** 2026-10-14 | **Evidence:** OBSERVED
**Decision changed:** Before adding a branch, option or second call near a preflight section, search `test/` for tests that slice `scripts/preflight-checks.sh` by marker strings, and keep each marker's first occurrence in the section it delimits.

**Prevention:** `test/integration/preflight-test-diagnostics.test.ts` (search: `source.indexOf('section "Tests"')`) runs the Tests section alone by cutting the script from the first `section "Tests"` to `# Show coverage only when`. Add new behaviour after the section's closing `fi`, or as an extra test in its opening condition, so the first marker still begins the original body.

**Symptoms:** A `--skip-tests` branch placed before the original Tests block made preflight report `Tests failed (7/3235 failures)`. Each diagnostics case failed with `ENOENT` for its `ledger.tsv`, because the extracted shell began with the new branch and ended at a dangling `elif`, so bash rejected it before writing the ledger.

**Why it happens:** The test treats source text as an interface: `indexOf` returns the first match, so a second `section "Tests"` call earlier in the file silently changes what the test executes.

**Evidence:** `scripts/preflight-checks.sh` (search: `Package tests skipped by --skip-tests`) now records the skip in a separate block after the Tests section, and the diagnostics file passes 7 of 7.

---

## Footgun: Tests read `ci.yml` as text, so removing a CI step that preflight repeats still breaks them

**Status:** active | **Created:** 2026-10-14 | **Evidence:** OBSERVED
**Decision changed:** Before removing or reshaping a CI job or step, search `test/` for every reader of `.github/workflows/ci.yml`, including paths built with `join(..., "workflows", "ci.yml")`, and decide for each pin whether the step stays or the test changes.

**Prevention:** Three tests read the workflow: `test/contract/documented-shellcheck-command.test.ts` (search: `const CI_WORKFLOW`), `test/integration/gruff-warning-ratchet.test.ts` (search: `runs the warning ratchet in a dedicated Node 22 CI job`) and `test/integration/preflight-progress.test.ts` (search: `runs each published syntax command against a valid control and a later malformed file`). A literal search for `.github/workflows/ci.yml` misses the ratchet test, which builds the path with `join`.

**Symptoms:** Removing the `checks` steps that preflight already runs, and the Ubuntu ratchet leg, left a workflow that parsed and passed the touched-file checks. Preflight then reported `Tests failed (4/3235 failures)`, and after two tests were updated, `Tests failed (1/3235 failures)` from the third.

**Why it happens:** These tests treat the workflow as a place where a command is published, so a step is a contract even when preflight runs the same check.

**Evidence:** The shell-syntax step stays in `checks` (`.github/workflows/ci.yml`, search: `this published copy is the CI surface`), and the other two tests now assert that CI runs the preflight that owns shell lint and the Linux ratchet.

---

## Resolved Entries

> Historical record. These entries are no longer active traps.

## Footgun: Preflight node-to-grep pipeline passes unsanitized stdout into regex patterns

**Status:** resolved | **Created:** 2026-04-21 | **Resolved:** 2026-04-21 | **Evidence:** ACTUAL_MEASURED

**Resolution:** Node output is piped through `grep -oE '^[0-9]+$' | tail -1` to keep only numeric lines, architecture doc matching switched from `grep -q` to `grep -Fq`, and `setup_count` is initialized before the conditional block to avoid a `set -u` crash: `scripts/preflight-checks.sh` (search: `grep -oE '^[0-9]+$'`).

**Original symptoms:** `npm publish` failed because `test/integration/audit-drift-checkdrift-installer-round-trip-fixture.test.ts` (search: `installs fixture-backed references`) intermittently crashed with `grep: Unmatched [, [^, [:, [., or [=` in the Doc/Code Drift section. `node --input-type=module` commands that compute check counts captured stray diagnostic lines containing `[`, which grep then read as a character class, and the first fix left `setup_count` unset when the sanitized pipeline returned empty in a fixture without a working `dist/`.
