/**
 * Gruff warning-debt ratchet for preflight and the dedicated Node 22 CI job.
 *
 * Runs the repository-local gruff-ts analyzer once in JSON mode and compares
 * warning findings by `stableIdentity` against the reviewed manifest at
 * scripts/gruff-warning-baseline.json. The gate fails closed on analyzer
 * operational errors, malformed or drifted JSON, analyzer diagnostics, any
 * error-severity finding, warnings missing from the manifest, occurrence
 * growth on duplicated identities, worsened size or process metadata,
 * shell-enabled process execution (in the scan or the manifest), stale
 * accepted debt, and analysed-file coverage below the recorded floor.
 * Unchanged or reduced reviewed debt passes and is reported, never hidden;
 * advisory findings stay visible but are not gated here.
 *
 * Comparison keys follow the gruff playbook: `stableIdentity`, never line
 * numbers or fingerprints, and never the analyzer's own line-sensitive
 * gruff-baseline.json. Clearing this gate by disabling a rule or raising a
 * threshold is prohibited by the preflight Gruff Policy check that invokes it.
 *
 * Test seams (used only by test/integration/gruff-warning-ratchet.test.ts):
 * - GOAT_FLOW_GRUFF_RATCHET_ANALYZER_BIN: JS analyzer entry run via
 *   process.execPath instead of the installed gruff-ts bin.
 * - GOAT_FLOW_GRUFF_RATCHET_BASELINE: alternative manifest path.
 *
 * Exit codes: 0 debt unchanged or reduced; 1 policy or manifest failure;
 * 2 analyzer operational failure.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_PATH =
  process.env.GOAT_FLOW_GRUFF_RATCHET_BASELINE ??
  join(REPO_ROOT, "scripts", "gruff-warning-baseline.json");
const EXPECTED_SCHEMA = "gruff.analysis.v2";
// Eight detail lines per failure category keeps a worst-case report readable
// inside a preflight row while the suppressed-count line preserves the total,
// so this cap is a readability limit chosen because bounded output must never
// hide how much regressed; raise the threshold only if row details grow.
const DETAIL_CAP = 8;

/**
 * Collect bounded failure lines per category so one run reports every
 * regression class without dumping unrelated analyzer output.
 */
class FailureReport {
  /**
   * Start with no recorded categories so an untouched report always means
   * the gate passes.
   */
  constructor() {
    this.categories = new Map();
  }

  /**
   * Record one failure line under a category, keeping insertion order.
   *
   * @param {string} category - stable failure prefix, e.g. "new warning"
   * @param {string} detail - single bounded line describing the regression
   * @returns {void}
   */
  add(category, detail) {
    const lines = this.categories.get(category) ?? [];
    lines.push(detail);
    this.categories.set(category, lines);
  }

  /**
   * Report whether any failure line has been recorded on this run.
   *
   * @returns {boolean} true once any category holds at least one line
   */
  hasFailures() {
    return this.categories.size > 0;
  }

  /**
   * Render every category with at most {@link DETAIL_CAP} detail lines.
   * Invariant: truncation is never silent - whenever details are dropped, a
   * "... and N more suppressed" line always follows so counts stay honest.
   *
   * @returns {string[]} printable failure lines, sorted by category
   */
  render() {
    const lines = [];
    for (const category of [...this.categories.keys()].sort()) {
      const details = this.categories.get(category);
      for (const detail of details.slice(0, DETAIL_CAP)) {
        lines.push(`${category}: ${detail}`);
      }
      if (details.length > DETAIL_CAP) {
        lines.push(
          `${category}: ... and ${details.length - DETAIL_CAP} more suppressed`,
        );
      }
    }
    return lines;
  }
}

/**
 * Resolve the analyzer invocation as argv (never a shell string).
 *
 * @returns {{ command: string, prefixArgs: string[] }} spawn target; the test
 *   seam runs a JS entry through process.execPath, the default execs the
 *   installed gruff-ts bin directly
 */
function resolveAnalyzerCommand() {
  const override = process.env.GOAT_FLOW_GRUFF_RATCHET_ANALYZER_BIN;
  if (override) {
    return { command: process.execPath, prefixArgs: [override] };
  }
  const require = createRequire(import.meta.url);
  const packagePath = require.resolve("@blundergoat/gruff-ts/package.json");
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  const binRelPath = packageJson.bin["gruff-ts"];
  return {
    command: join(dirname(packagePath), binRelPath),
    prefixArgs: [],
  };
}

/**
 * Run the analyzer with `--fail-on none` so findings never look like an
 * operational failure. Side effect: spawns one synchronous analyzer child
 * process against the repository root. Error behavior: never throws - spawn
 * errors, non-zero exits, and unparseable stdout each return a bounded
 * `failure` message instead, so callers exit through one path.
 *
 * @returns {{ scan?: unknown, failure?: string }} parsed JSON or a bounded
 *   operational failure message
 */
function runAnalyzer() {
  const { command, prefixArgs } = resolveAnalyzerCommand();
  const result = spawnSync(
    command,
    [...prefixArgs, "analyse", "--format=json", "--fail-on", "none"],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      shell: false,
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  if (result.error) {
    return {
      failure: `analyzer failure: spawn failed (${result.error.message})`,
    };
  }
  if (result.status !== 0) {
    const stderrExcerpt = (result.stderr ?? "").trim().split("\n")[0] ?? "";
    return {
      failure: `analyzer failure: exit ${result.status} (${stderrExcerpt})`,
    };
  }
  try {
    return { scan: JSON.parse(result.stdout) };
  } catch (error) {
    const excerpt = (result.stdout ?? "").slice(0, 120).replaceAll("\n", " ");
    return {
      failure: `malformed analyzer output: ${error.message} (starts: ${excerpt})`,
    };
  }
}

/**
 * Canonicalize one metadata occurrence so multiset comparison is stable
 * regardless of key order.
 *
 * @param {Record<string, unknown>} metadata - one finding/manifest occurrence
 * @returns {string} deterministic JSON key
 */
function occurrenceKey(metadata) {
  const sorted = {};
  for (const key of Object.keys(metadata).sort()) {
    sorted[key] = metadata[key];
  }
  return JSON.stringify(sorted);
}

/**
 * Validate one manifest entry's occurrence list: non-empty, object-shaped,
 * and never accepting a shell-enabled process execution.
 *
 * @param {Record<string, unknown>} entry - parsed manifest entry
 * @param {string} id - the entry's stable identity for failure lines
 * @param {FailureReport} report - collector for invalid-manifest lines
 * @returns {void}
 */
function validateManifestOccurrences(entry, id, report) {
  const occurrences = Array.isArray(entry.occurrences) ? entry.occurrences : [];
  if (occurrences.length === 0) {
    report.add("invalid manifest", `${id}: occurrences must be non-empty`);
  }
  for (const occurrence of occurrences) {
    if (typeof occurrence !== "object" || occurrence === null) {
      report.add("invalid manifest", `${id}: occurrence must be an object`);
    } else if (
      entry.ruleId === "security.process-exec" &&
      occurrence.shellEnabled !== false
    ) {
      report.add(
        "invalid manifest",
        `${id}: accepted process occurrences require shellEnabled: false`,
      );
    }
  }
}

/**
 * Validate one manifest entry's shape, rationale, and per-rule occurrence
 * bounds before it can accept anything.
 *
 * @param {Record<string, unknown>} entry - parsed manifest entry
 * @param {FailureReport} report - collector for invalid-manifest lines
 * @returns {void}
 */
function validateManifestEntry(entry, report) {
  const id =
    typeof entry.stableIdentity === "string" ? entry.stableIdentity : "";
  if (id.length === 0) {
    report.add("invalid manifest", "entry without a stableIdentity");
    return;
  }
  if (typeof entry.ruleId !== "string" || typeof entry.file !== "string") {
    report.add("invalid manifest", `${id}: ruleId and file are required`);
  }
  if (
    typeof entry.rationale !== "string" ||
    entry.rationale.trim().length === 0
  ) {
    report.add("invalid manifest", `${id}: rationale is required`);
  }
  validateManifestOccurrences(entry, id, report);
}

/**
 * Load and validate the reviewed manifest; any structural problem is a
 * failure because an unreviewable manifest cannot accept debt. Error
 * behavior: never throws - a missing file, unreadable file, or JSON parse
 * error is caught, recorded as an invalid-manifest line, and answered with
 * null. Invariant: once any failure is recorded, null is always returned,
 * so a broken manifest can never accept a single entry (fail closed).
 *
 * @param {FailureReport} report - collector for invalid-manifest lines
 * @returns {{ minimumAnalysedFiles: number, entries: Map<string, Record<string, unknown>> } | null}
 */
function loadManifest(report) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  } catch (error) {
    report.add("invalid manifest", `${BASELINE_PATH}: ${error.message}`);
    return null;
  }
  validateManifestHeader(parsed, report);
  const entries = collectManifestEntries(parsed, report);
  if (report.hasFailures()) return null;
  return { minimumAnalysedFiles: parsed.minimumAnalysedFiles, entries };
}

/**
 * Validate the manifest's top-level schema and coverage-floor fields.
 *
 * @param {Record<string, unknown>} parsed - parsed manifest JSON
 * @param {FailureReport} report - collector for invalid-manifest lines
 * @returns {void}
 */
function validateManifestHeader(parsed, report) {
  if (parsed.schemaVersion !== EXPECTED_SCHEMA) {
    report.add(
      "invalid manifest",
      `schemaVersion ${String(parsed.schemaVersion)} != ${EXPECTED_SCHEMA}`,
    );
  }
  if (
    !Number.isInteger(parsed.minimumAnalysedFiles) ||
    parsed.minimumAnalysedFiles <= 0
  ) {
    report.add(
      "invalid manifest",
      "minimumAnalysedFiles must be a positive integer",
    );
  }
}

/**
 * Validate every manifest entry and index them by stable identity, reporting
 * duplicates instead of letting a later entry shadow an earlier one. The
 * duplicate branch exists because two entries under one identity would make
 * acceptance ambiguous, and identity-less entries stay out of the map so a
 * malformed entry can never accept a scan finding by accident.
 *
 * @param {Record<string, unknown>} parsed - parsed manifest JSON
 * @param {FailureReport} report - collector for invalid-manifest lines
 * @returns {Map<string, Record<string, unknown>>} entries keyed by identity
 */
function collectManifestEntries(parsed, report) {
  const entries = new Map();
  for (const entry of Array.isArray(parsed.entries) ? parsed.entries : []) {
    validateManifestEntry(entry, report);
    if (
      typeof entry.stableIdentity === "string" &&
      entry.stableIdentity.length > 0
    ) {
      if (entries.has(entry.stableIdentity)) {
        report.add(
          "invalid manifest",
          `duplicate entry ${entry.stableIdentity}`,
        );
      }
      entries.set(entry.stableIdentity, entry);
    }
  }
  return entries;
}

/**
 * Validate the scan's schema, diagnostics, and coverage before comparison.
 *
 * @param {Record<string, unknown>} scan - parsed analyzer JSON
 * @param {number} minimumAnalysedFiles - reviewed coverage floor
 * @param {FailureReport} report - collector for drift/diagnostic lines
 * @returns {void}
 */
function validateScan(scan, minimumAnalysedFiles, report) {
  if (scan.schemaVersion !== EXPECTED_SCHEMA) {
    report.add(
      "schema drift",
      `analyzer reported ${String(scan.schemaVersion)}, expected ${EXPECTED_SCHEMA}`,
    );
  }
  const diagnostics = Array.isArray(scan.diagnostics) ? scan.diagnostics : null;
  if (diagnostics === null) {
    report.add(
      "schema drift",
      "diagnostics array missing from analyzer output",
    );
  } else {
    for (const diagnostic of diagnostics) {
      report.add(
        "analyzer diagnostics",
        JSON.stringify(diagnostic).slice(0, 160),
      );
    }
  }
  const analysedFiles = scan.paths?.analysedFiles;
  if (!Number.isInteger(analysedFiles)) {
    report.add(
      "schema drift",
      "paths.analysedFiles missing from analyzer output",
    );
  } else if (analysedFiles < minimumAnalysedFiles) {
    report.add(
      "coverage regression",
      `analysedFiles ${analysedFiles} < recorded floor ${minimumAnalysedFiles}`,
    );
  }
  if (!Array.isArray(scan.findings)) {
    report.add("schema drift", "findings array missing from analyzer output");
  }
}

/**
 * Split findings by severity and reject error findings and identity-less
 * warnings up front. Why the three-way branch exists: error findings must
 * fail the gate outright, warnings are the ratchet's comparison currency and
 * therefore must carry a `stableIdentity`, and every other severity stays
 * advisory-only so this gate never blocks on ungated rules. Invariant: every
 * warning in the returned array has a non-empty `stableIdentity`.
 *
 * @param {Record<string, unknown>[]} findings - scan findings
 * @param {FailureReport} report - collector for error/drift lines
 * @returns {{ warnings: Record<string, unknown>[], advisoryCount: number }}
 */
function classifyFindings(findings, report) {
  const warnings = [];
  let advisoryCount = 0;
  for (const finding of findings) {
    if (finding.severity === "error") {
      report.add("error findings", `${finding.ruleId} ${finding.file}`);
    } else if (finding.severity === "warning") {
      const id =
        typeof finding.stableIdentity === "string"
          ? finding.stableIdentity
          : "";
      if (id.length === 0) {
        report.add(
          "schema drift",
          `warning without stableIdentity: ${finding.ruleId} ${finding.file}`,
        );
      } else {
        warnings.push(finding);
      }
    } else {
      advisoryCount += 1;
    }
  }
  return { warnings, advisoryCount };
}

/**
 * Compare one identity's size occurrences to its accepted bounds: lines may
 * only shrink and the reviewed threshold must match exactly.
 *
 * @param {string} id - stable identity under comparison
 * @param {Record<string, unknown>[]} occurrences - scan metadata occurrences
 * @param {Record<string, unknown>} entry - accepted manifest entry
 * @param {FailureReport} report - collector for metadata lines
 * @returns {void}
 */
function compareSizeOccurrences(id, occurrences, entry, report) {
  const accepted = entry.occurrences;
  const acceptedMaxLines = Math.max(
    ...accepted.map((occurrence) => occurrence.lines),
  );
  const acceptedThreshold = accepted[0].threshold;
  for (const metadata of occurrences) {
    if (
      !Number.isInteger(metadata?.lines) ||
      !Number.isInteger(metadata?.threshold)
    ) {
      report.add(
        "schema drift",
        `${id}: size warning without lines/threshold metadata`,
      );
    } else if (metadata.threshold !== acceptedThreshold) {
      report.add(
        "metadata regression",
        `${id}: threshold ${metadata.threshold} != reviewed ${acceptedThreshold}`,
      );
    } else if (metadata.lines > acceptedMaxLines) {
      report.add(
        "metadata regression",
        `${id}: ${entry.file} grew to ${metadata.lines} lines (accepted max ${acceptedMaxLines})`,
      );
    }
  }
}

/**
 * Compare one identity's metadata occurrences as a multiset against the
 * accepted occurrences; anything outside the reviewed multiset fails.
 *
 * @param {string} id - stable identity under comparison
 * @param {Record<string, unknown>[]} occurrences - scan metadata occurrences
 * @param {Record<string, unknown>} entry - accepted manifest entry
 * @param {FailureReport} report - collector for metadata lines
 * @returns {void}
 */
function compareOccurrenceMultiset(id, occurrences, entry, report) {
  const remaining = new Map();
  for (const occurrence of entry.occurrences) {
    const key = occurrenceKey(occurrence);
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  for (const metadata of occurrences) {
    if (typeof metadata !== "object" || metadata === null) {
      report.add("schema drift", `${id}: warning without metadata`);
      continue;
    }
    if (
      entry.ruleId === "security.process-exec" &&
      metadata.shellEnabled !== false
    ) {
      report.add(
        "metadata regression",
        `${id}: process execution with shellEnabled ${String(metadata.shellEnabled)}`,
      );
      continue;
    }
    const key = occurrenceKey(metadata);
    const available = remaining.get(key) ?? 0;
    if (available <= 0) {
      report.add("metadata regression", `${id}: unreviewed occurrence ${key}`);
    } else {
      remaining.set(key, available - 1);
    }
  }
}

/**
 * Compare grouped scan warnings against the manifest in both directions:
 * unknown or grown identities fail forward, vanished identities fail stale.
 * Invariant: every scan identity is either accepted within its reviewed
 * bounds or reported as a failure, and every manifest identity must still be
 * observed - reviewed debt can only ever shrink, never silently regrow.
 *
 * @param {Record<string, unknown>[]} warnings - identity-bearing warnings
 * @param {Map<string, Record<string, unknown>>} entries - accepted entries
 * @param {FailureReport} report - collector for comparison lines
 * @returns {void}
 */
function compareWarnings(warnings, entries, report) {
  const byIdentity = new Map();
  for (const finding of warnings) {
    const group = byIdentity.get(finding.stableIdentity) ?? [];
    group.push(finding);
    byIdentity.set(finding.stableIdentity, group);
  }
  for (const id of [...byIdentity.keys()].sort()) {
    compareIdentityGroup(id, byIdentity.get(id), entries.get(id), report);
  }
  for (const id of [...entries.keys()].sort()) {
    if (!byIdentity.has(id)) {
      report.add(
        "stale accepted debt",
        `${id} ${entries.get(id).ruleId} no longer reported; remove its manifest entry`,
      );
    }
  }
}

/**
 * Compare one identity's scan findings against its accepted entry: unknown
 * identities fail as new debt, rule/file moves and occurrence growth fail
 * their own bounds, then per-rule metadata comparison runs.
 *
 * @param {string} id - stable identity under comparison
 * @param {Record<string, unknown>[]} group - scan findings for this identity
 * @param {Record<string, unknown> | undefined} entry - accepted entry, if any
 * @param {FailureReport} report - collector for comparison lines
 * @returns {void}
 */
function compareIdentityGroup(id, group, entry, report) {
  if (!entry) {
    const sample = group[0];
    report.add("new warning", `${id} ${sample.ruleId} ${sample.file}`);
    return;
  }
  if (entry.ruleId !== group[0].ruleId || entry.file !== group[0].file) {
    report.add(
      "metadata regression",
      `${id}: identity now reports ${group[0].ruleId} ${group[0].file}, reviewed as ${entry.ruleId} ${entry.file}`,
    );
    return;
  }
  if (group.length > entry.occurrences.length) {
    report.add(
      "duplicate growth",
      `${id}: ${group.length} occurrences exceed accepted ${entry.occurrences.length}`,
    );
    return;
  }
  const occurrences = group.map((finding) => finding.metadata);
  if (entry.ruleId === "size.file-length") {
    compareSizeOccurrences(id, occurrences, entry, report);
  } else {
    compareOccurrenceMultiset(id, occurrences, entry, report);
  }
}

/**
 * Print the visible accepted-debt summary preflight surfaces on success.
 * Invariant: accepted debt is always reported, never hidden - a passing run
 * still names every identity count, occurrence total, coverage floor, and
 * the ungated advisory count so green output cannot read as "zero debt".
 *
 * @param {Record<string, unknown>[]} warnings - identity-bearing warnings
 * @param {Map<string, Record<string, unknown>>} entries - accepted entries
 * @param {Record<string, unknown>} scan - parsed analyzer JSON
 * @param {number} advisoryCount - non-gated advisory findings
 * @param {number} floor - reviewed minimum analysed files
 * @returns {void}
 */
function printSummary(warnings, entries, scan, advisoryCount, floor) {
  const byRule = new Map();
  for (const finding of warnings) {
    byRule.set(finding.ruleId, (byRule.get(finding.ruleId) ?? 0) + 1);
  }
  const ruleSummary = [...byRule.keys()]
    .sort()
    .map((ruleId) => `${byRule.get(ruleId)} ${ruleId}`)
    .join(", ");
  console.log(
    `gruff warning ratchet: ${entries.size} accepted identities, ` +
      `${warnings.length} occurrences (${ruleSummary || "none"}); ` +
      `analysedFiles ${scan.paths.analysedFiles} >= floor ${floor}; ` +
      `advisories: ${advisoryCount} (not gated)`,
  );
}

/**
 * Entry point: load manifest, run analyzer, compare, and report with a
 * fail-closed exit code.
 *
 * @returns {number} process exit code
 */
function main() {
  const report = new FailureReport();
  const manifest = loadManifest(report);
  if (manifest === null) {
    for (const line of report.render()) console.error(line);
    return 1;
  }
  const analyzerResult = runAnalyzer();
  if (analyzerResult.failure) {
    console.error(analyzerResult.failure);
    return 2;
  }
  const scan = analyzerResult.scan;
  validateScan(scan, manifest.minimumAnalysedFiles, report);
  const findings = Array.isArray(scan.findings) ? scan.findings : [];
  const { warnings, advisoryCount } = classifyFindings(findings, report);
  if (!report.hasFailures()) {
    compareWarnings(warnings, manifest.entries, report);
  }
  if (report.hasFailures()) {
    for (const line of report.render()) console.error(line);
    return 1;
  }
  printSummary(
    warnings,
    manifest.entries,
    scan,
    advisoryCount,
    manifest.minimumAnalysedFiles,
  );
  return 0;
}

process.exit(main());
