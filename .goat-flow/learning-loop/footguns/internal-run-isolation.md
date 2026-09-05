---
category: internal-run-isolation
last_reviewed: 2026-09-05
---

## Footgun: Internal / intermediate runs against a user target must strip side-effect-bearing config

**Status:** active | **Created:** 2026-05-25 | **Evidence:** EXTERNAL_REFERENCE

**Prevention:**
1. Define one config-sanitization boundary for internal runs that nulls every field whose presence triggers a side-effect writer (output paths, log files, report files, trace sinks, share URLs, webhook callbacks) and use it at every site that builds an internal run from user config. Document the field list beside it, and add any new side-effect-bearing field to it in the same change.
2. Return internal-run results through in-memory values or a scratch directory under `os.tmpdir()` that the caller deletes, never through the user's configured output paths.
3. For every meta-command (preview, dry-run, compare, batch), keep a test that sets an `outputPath` fixture and asserts the file does not exist after the run.

**Symptoms:** A meta-command that internally invokes the primary engine N times reuses the user's config wholesale, so every intermediate result is appended to the user's real output file, log, or report, interleaved with their actual data.

**Why it happens:** The internal runner passes a single "no persistence" flag that suppresses one writer, the database, while the engine constructor still reads every other sink from config and instantiates its writer eagerly. The flag was a single-knob fix; the other side effects were never audited.

**Evidence:** External, promptfoo PR #9364: `optimize` ran baseline and candidate evals through `new Eval(config, { persisted: false })`, the `Evaluator` still saw `config.outputPath` and instantiated a `JsonlFileWriter`, and every intermediate row landed in the user's jsonl until `outputPath` was stripped from the copy. Local surface with the same shape: `src/cli/server/dashboard-quality-routes.ts` (search: "function getOrRunQualityAudit") re-runs audit against the target as the user navigates, and `src/cli/audit/audit.ts` accepts an output JSON path through `--output`, so any route that builds an `AuditContext` from user config must strip that path before an internal run.

## Footgun: Nested npm commands inherit the parent publish lifecycle's config

**Status:** active | **Created:** 2026-08-11 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** When a test or script spawns npm from inside a lifecycle script, pin the flags whose side effects it depends on rather than trusting npm's defaults.
**Trigger phase:** ACT
**Caught at:** VERIFY

**Prevention:** A nested npm command that depends on a side effect pins the flag that controls it; `extractPackedCandidate` passes `--dry-run=false`, and command-line flags outrank inherited `npm_config_*`. Reproduce the lifecycle context when a test spawns npm: `npm_config_dry_run=true node --import tsx --test <file>` separates the two cases where a bare run passes either way. Keep release-gate output visible: the gate runs directly as `npm run publish:check` with live output, and both publish calls pass `--ignore-scripts` behind a pack-shasum identity guard so the lifecycle never wraps the suites, per `scripts/npm-publish.sh` (search: `pack_shasum`).

**Symptoms:** `npm run test:full` passes on its own and the same suite fails under `npm publish --dry-run`. The failing test spawns `npm pack`, receives a normal `--json` payload naming a tarball, then cannot read it from disk, and the surfaced error names `tar`, not npm.

**Why it happens:** npm exports resolved config into the lifecycle environment, so `npm publish --dry-run` sets `npm_config_dry_run=true` for `prepublishOnly` and every npm command it starts. Environment config outranks a nested command's defaults, so `npm pack` runs as a dry run, prints the filename, and writes nothing. The 1.15.1 script also piped the whole run through `tail -8`, which cut the `# fail` count and every `not ok` line.

**Evidence:** Measured 2026-08-11: a probe package whose `prepublishOnly` printed its environment reported `npm_config_dry_run="true"` under `npm publish --dry-run`; in this repo `npm pack --json --ignore-scripts --pack-destination <dir>` wrote one tarball normally and zero under `npm_config_dry_run=true` while printing the same filename. `test/integration/packaged-hook-install.test.ts` (search: `extractPackedCandidate`) failed with `# fail 2` and `tar (child): ... Cannot open: No such file or directory`, blocking the 1.15.1 run of `scripts/npm-publish.sh`.
