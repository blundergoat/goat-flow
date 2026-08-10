---
category: internal-run-isolation
last_reviewed: 2026-08-11
---

## Footgun: Internal / intermediate runs against a user target must strip side-effect-bearing config

**Status:** active | **Created:** 2026-05-25 | **Evidence:** EXTERNAL_REFERENCE

**Symptoms:** A user runs a meta-command (optimize, preview, dry-run, dashboard scan, compare) that internally invokes the primary engine N times to evaluate candidates. Each internal invocation reuses the user's config wholesale. The engine sees `outputPath: "user-results.jsonl"` in the config and writes every intermediate result to the user's real output file. The user's "real" run output is now polluted with N rounds of internal scratch results, often interleaved unpredictably with their actual data. Worse, log files, report files, trace sinks, and any other side-effect-bearing path get the same treatment.

**Why it happens:** The internal runner takes the user's config object and constructs a new engine instance with a `{persisted: false}` (or similar) flag to skip the DB write. But "persisted: false" only suppresses the DB write — every other side-effect path (`outputPath`, `reportPath`, `logFile`, `tracesPath`, webhook callbacks) is still active because the engine constructor reads them from config and instantiates writers eagerly. The "no DB" flag was added as a single-knob fix; the other side effects were never audited.

**Evidence (external — promptfoo PR #9364):** `optimize` ran baseline + candidate evals against the user's target via `new Eval(config, { persisted: false })`. The `Evaluator` constructor still saw `config.outputPath` and instantiated a `JsonlFileWriter`, which appended every intermediate row to the user's actual jsonl. Fix strips `outputPath` from the config copy before constructing the internal run. The bug shipped because "persisted: false" was treated as the complete isolation primitive when it actually only covered DB persistence.

**Goat-flow applicability — HIGH:** Goat-flow has multiple surfaces where a meta-command invokes the primary engine against a user target:
- Dashboard audit / quality previews that re-run audit against the target project repeatedly as the user navigates (`src/cli/server/dashboard-routes.ts` audit + quality routes).
- Quality preview that runs a focused subset of checks before the full run commits.
- Any future "compare two skill versions side-by-side" or "preview audit fix" flow that re-runs the engine against the user's tree.
- `src/cli/audit/audit.ts` accepts an output JSON path via `--output`; if a dashboard route constructs an `AuditContext` from user config and forwards `--output` without stripping, the internal run will overwrite the user's saved audit output.

**Prevention:**
1. Define an explicit config-sanitization boundary for internal runs that nulls every field whose presence triggers a side-effect writer: output paths, log files, report files, trace sinks, share URLs, webhook callbacks. Use that boundary AT EVERY SITE that constructs an internal / intermediate run from user config. Document the field list in a comment that names this footgun.
2. Internal runs should pipe results back via in-memory return values or scratch tmpdirs, never the user's configured output paths. If a writer is truly needed for an intermediate run, it should be a temp file in `os.tmpdir()` that the caller deletes.
3. Contract test pattern: for every meta-command (optimize / preview / dry-run / batch-compare), assert that running it does NOT touch the user's `outputPath` file. Fixture: set `outputPath: "/tmp/should-not-be-written-N.jsonl"`, run the meta-command, assert the file does not exist after the run completes.
4. When adding a new side-effect-bearing config field (a new output sink, a new external integration), add it to the internal-run sanitization field list in the same PR. If you don't, the next meta-command that runs will silently pollute it.

## Footgun: Nested npm commands inherit the parent publish lifecycle's config

**Status:** active | **Created:** 2026-08-11 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** When a test or script spawns npm from inside a lifecycle script, pin the flags whose side effects it depends on rather than trusting npm's defaults.
**Trigger phase:** VERIFY

**Symptoms:** `npm run test:full` passes on its own, and the same suite fails under `npm publish --dry-run`. The failing test spawns `npm pack`, receives a normal `--json` payload naming a tarball, then cannot read that tarball from disk. The surfaced error names `tar`, not npm.

**Why it happens:** npm exports resolved config into the lifecycle environment, so `npm publish --dry-run` sets `npm_config_dry_run=true` for `prepublishOnly` and for every npm command that script starts. Environment config outranks a nested command's defaults, so `npm pack` runs as a dry run: it prints the filename it would have written and writes nothing to `--pack-destination`. Only the file write disappears, so the failure surfaces one step later in whatever reads the archive.

**Evidence (measured 2026-08-11):** a probe package whose `prepublishOnly` printed its own environment reported `npm_config_dry_run="true"` under `npm publish --dry-run`. In this repo, `npm pack --json --ignore-scripts --pack-destination <dir>` wrote one tarball normally and zero tarballs under `npm_config_dry_run=true`, printing the same filename both times. `test/integration/packaged-hook-install.test.ts` (search: `extractPackedCandidate`) then failed with `# fail 2` and `tar (child): ... Cannot open: No such file or directory`, which blocked the 1.15.1 run of `scripts/npm-publish.sh`.

**Prevention:**
1. A nested npm command that depends on a side effect must pin the flag that controls it. `extractPackedCandidate` passes `--dry-run=false`, and command-line flags outrank inherited `npm_config_*`.
2. Reproduce the lifecycle context when a test spawns npm. `npm_config_dry_run=true node --import tsx --test <file>` separates the two cases; a bare run passes either way.
3. Keep release-gate output visible. The 1.15.1 script piped `npm publish --dry-run` - and with it the whole test run - through `tail -8`, which cut the `# fail` count and every `not ok` line and left `npm error code 1` as the only visible symptom. The gate now runs directly as `npm run publish:check` with live output, and both publish calls pass `--ignore-scripts` behind a pack-shasum identity guard, so the lifecycle never wraps the suites at all: `scripts/npm-publish.sh` (search: `pack_shasum`).
