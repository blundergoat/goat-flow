---
category: internal-run-isolation
last_reviewed: 2026-05-27
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
