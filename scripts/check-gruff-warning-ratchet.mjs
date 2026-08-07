/**
 * Release gate that stops reviewed Gruff warning debt from growing unnoticed.
 * Run from `bash scripts/preflight-checks.sh` before accepting risky work or tagging a release, and
 * from the Node 22 CI job on every pull request. This file owns launching the analyzer and reporting
 * the verdict; gruff-warning-ratchet-checks.mjs owns the rules for what counts as a regression, and
 * ratchet-failure-report.mjs collects the failure lines. A
 * maintainer reads one summary line on pass, or a short bounded list of what regressed on fail.
 * Exit codes: 0 debt unchanged or reduced, 1 policy or manifest failure, 2 analyzer could not run.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import {
  compareScanAgainstAcceptedDebt,
  loadReviewedDebtManifest,
  REPO_ROOT,
  splitFindingsBySeverity,
  validateScanShape,
} from "./gruff-warning-ratchet-checks.mjs";
import { RatchetFailureReport } from "./ratchet-failure-report.mjs";

/**
 * Work out how to start the analyzer as separate arguments, never as a shell string.
 * Used before every scan so the gate runs the project's own installed analyzer, not one a hostile
 * config could substitute.
 *
 * @returns the executable plus any leading arguments; `prefixArgs` is empty on a normal run and
 *   carries the fixture entry only when a test overrides the analyzer
 */
function resolveAnalyzerLaunchCommand() {
  const fixtureAnalyzerPath = process.env.GOAT_FLOW_GRUFF_RATCHET_ANALYZER_BIN;
  // A test is replaying a scripted analyzer result, so run that fixture through Node instead.
  if (fixtureAnalyzerPath) {
    return { command: process.execPath, prefixArgs: [fixtureAnalyzerPath] };
  }
  const require = createRequire(import.meta.url);
  const analyzerPackagePath =
    require.resolve("@blundergoat/gruff-ts/package.json");
  const analyzerPackage = JSON.parse(readFileSync(analyzerPackagePath, "utf8"));
  return {
    command: join(
      dirname(analyzerPackagePath),
      analyzerPackage.bin["gruff-ts"],
    ),
    prefixArgs: [],
  };
}

/**
 * Scan the whole repository once and hand back the analyzer's JSON report.
 * This is the evidence every comparison reads, so it asks for `--fail-on none`: ordinary findings are
 * this gate's subject matter and must not look like the analyzer breaking.
 * Side effect: starts one analyzer child process at the repository root.
 * Error behavior: never throws - a missing analyzer, non-zero exit, or unreadable output each come
 * back as a `failure` line so the gate exits through one path.
 *
 * @returns the parsed report, or a `failure` message when the analyzer could not produce one;
 *   `scan` absent means the maintainer sees an analyzer problem rather than a debt verdict
 */
function scanRepositoryWithAnalyzer() {
  const { command, prefixArgs } = resolveAnalyzerLaunchCommand();
  const analyzerRun = spawnSync(
    command,
    [...prefixArgs, "analyse", "--format=json", "--fail-on", "none"],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      shell: false,
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  // The analyzer never started - for example `npm ci` has not run in a fresh clone.
  if (analyzerRun.error) {
    return {
      failure: `analyzer failure: spawn failed (${analyzerRun.error.message})`,
    };
  }
  // The analyzer ran but gave up, so its own first line explains more than a debt diff would.
  if (analyzerRun.status !== 0) {
    const firstStderrLine =
      (analyzerRun.stderr ?? "").trim().split("\n")[0] ?? "";
    return {
      failure: `analyzer failure: exit ${analyzerRun.status} (${firstStderrLine})`,
    };
  }
  try {
    return { scan: JSON.parse(analyzerRun.stdout) };
  } catch (error) {
    // Output was not JSON - for example a plugin printed a banner onto stdout ahead of the report.
    const outputStart = (analyzerRun.stdout ?? "")
      .slice(0, 120)
      .replaceAll("\n", " ");
    return {
      failure: `malformed analyzer output: ${error.message} (starts: ${outputStart})`,
    };
  }
}

/**
 * Print the one-line accepted-debt summary a maintainer sees when the gate passes.
 * Invariant: a green run still states every count - identities, occurrences, coverage floor, and
 * ungated advisories - so passing can never be read as "this repository has no debt".
 *
 * @param comparableWarnings - identity-bearing warnings from the scan; empty prints "none" for rules
 * @param acceptedEntriesByIdentity - reviewed entries keyed by identity
 * @param scan - the analyzer's parsed report, read for its analysed-file count
 * @param advisoryCount - advisory findings this gate never blocks on; zero means none were reported
 * @param minimumAnalysedFiles - reviewed coverage floor the scan had to meet
 * @returns nothing; the summary goes to stdout, which preflight shows as the row's detail
 */
function printAcceptedDebtSummary(
  comparableWarnings,
  acceptedEntriesByIdentity,
  scan,
  advisoryCount,
  minimumAnalysedFiles,
) {
  const occurrenceCountByRule = new Map();
  // Tally per rule so the summary says what kind of debt remains, not just how much.
  for (const finding of comparableWarnings) {
    occurrenceCountByRule.set(
      finding.ruleId,
      (occurrenceCountByRule.get(finding.ruleId) ?? 0) + 1,
    );
  }
  const ruleSummary = [...occurrenceCountByRule.keys()]
    .sort()
    .map((ruleId) => `${occurrenceCountByRule.get(ruleId)} ${ruleId}`)
    .join(", ");
  console.log(
    `gruff warning ratchet: ${acceptedEntriesByIdentity.size} accepted identities, ` +
      `${comparableWarnings.length} occurrences (${ruleSummary || "none"}); ` +
      `analysedFiles ${scan.paths.analysedFiles} >= floor ${minimumAnalysedFiles}; ` +
      `advisories: ${advisoryCount} (not gated)`,
  );
}

/**
 * Run the gate end to end and answer with the exit code preflight and CI act on.
 * This is the entry point: read the reviewed list, scan the repository, compare, then either print
 * the accepted-debt summary or the bounded list of what blocks the release.
 *
 * @returns 0 when debt is unchanged or reduced, 1 for a policy or manifest failure, 2 when the
 *   analyzer could not run at all
 */
function main() {
  // e.g. a maintainer ran `bash scripts/preflight-checks.sh` before tagging a release, or CI started
  // the Node 22 ratchet job on a pull request.
  const failures = new RatchetFailureReport();
  const manifest = loadReviewedDebtManifest(failures);
  // The reviewed list itself is unusable, so stop before implying the scan was approved.
  if (manifest === null) {
    for (const line of failures.renderReportLines()) console.error(line);
    return 1;
  }
  const analyzerResult = scanRepositoryWithAnalyzer();
  // No usable scan means an operational problem to fix, told apart from a debt regression by exit 2.
  if (analyzerResult.failure) {
    console.error(analyzerResult.failure);
    return 2;
  }
  const scan = analyzerResult.scan;
  validateScanShape(scan, manifest.minimumAnalysedFiles, failures);
  const findings = Array.isArray(scan.findings) ? scan.findings : [];
  const { comparableWarnings, advisoryCount } = splitFindingsBySeverity(
    findings,
    failures,
  );
  // Only compare debt when the scan itself is trustworthy, so drift is not reported as new warnings.
  if (!failures.hasFailures()) {
    compareScanAgainstAcceptedDebt(
      comparableWarnings,
      manifest.acceptedEntriesByIdentity,
      failures,
    );
  }
  // Something regressed, so print the bounded categories and fail the release gate.
  if (failures.hasFailures()) {
    for (const line of failures.renderReportLines()) console.error(line);
    return 1;
  }
  printAcceptedDebtSummary(
    comparableWarnings,
    manifest.acceptedEntriesByIdentity,
    scan,
    advisoryCount,
    manifest.minimumAnalysedFiles,
  );
  return 0;
}

process.exit(main());
