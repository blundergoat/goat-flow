/**
 * The rules that decide whether Gruff warning debt regressed, kept apart from running the analyzer.
 * Loaded by scripts/check-gruff-warning-ratchet.mjs, which supplies a fresh scan and prints whatever
 * this module reports. It confirms the scan still meets the reviewed coverage floor, then compares
 * warnings with scripts/gruff-warning-baseline.json when that accepted-debt manifest exists. A
 * maintainer changes rules here when the definition of "this got worse" changes, and changes the
 * sibling file when the way the analyzer is launched changes. Failure lines are collected by
 * RatchetFailureReport from ratchet-failure-report.mjs, which every check here writes into.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Tests point this at a fixture manifest; a normal run looks for the reviewed list beside this script.
const MANIFEST_PATH =
  process.env.GOAT_FLOW_GRUFF_RATCHET_BASELINE ??
  join(REPO_ROOT, "scripts", "gruff-warning-baseline.json");
export const EXPECTED_SCHEMA = "gruff.analysis.v2";
/**
 * Coverage threshold retained when no accepted warning-debt manifest exists.
 *
 * The last reviewed manifest before warning debt reached zero recorded 494 analysed files. Removing
 * accepted findings does not revoke that coverage approval: a lower count still needs human review.
 */
const REVIEWED_MINIMUM_ANALYSED_FILES = 494;
/**
 * Build a stable text key for one occurrence so equal shapes compare equal whatever the key order.
 * Used when matching scanned occurrences against the reviewed ones for the same identity.
 *
 * @param occurrenceMetadata - one occurrence from the scan or the manifest; an empty object is a
 *   legitimate key meaning the rule records no distinguishing detail
 * @returns deterministic JSON text used only for comparison, never shown to the maintainer
 */
function occurrenceComparisonKey(occurrenceMetadata) {
  const sortedMetadata = {};
  // Sort the keys so two occurrences written in different orders still match.
  for (const key of Object.keys(occurrenceMetadata).sort()) {
    sortedMetadata[key] = occurrenceMetadata[key];
  }
  return JSON.stringify(sortedMetadata);
}

/**
 * Check that one reviewed entry's occurrence list can actually accept something.
 * Guards the review promise: an accepted process execution must never be one that enables a shell.
 *
 * @param acceptedEntry - one reviewed entry from the manifest
 * @param identity - the entry's stable identity, used to name it in failure lines
 * @param failures - collector the caller prints; nothing is added when the entry is sound
 * @returns nothing; problems are recorded as "invalid manifest" lines
 */
function validateAcceptedOccurrences(acceptedEntry, identity, failures) {
  const acceptedOccurrences = Array.isArray(acceptedEntry.occurrences)
    ? acceptedEntry.occurrences
    : [];
  // An entry with no occurrences accepts nothing, so it cannot be compared against a scan.
  if (acceptedOccurrences.length === 0) {
    failures.addFailure(
      "invalid manifest",
      `${identity}: occurrences must be non-empty`,
    );
  }
  // Each accepted occurrence is checked on its own, so one bad entry cannot hide behind a good one.
  for (const occurrence of acceptedOccurrences) {
    // Not an object, so there is no metadata to compare a scanned occurrence against.
    if (typeof occurrence !== "object" || occurrence === null) {
      failures.addFailure(
        "invalid manifest",
        `${identity}: occurrence must be an object`,
      );
    } else if (
      // Accepting a shell-enabled process execution would sign off the risky case, never allowed.
      acceptedEntry.ruleId === "security.process-exec" &&
      occurrence.shellEnabled !== false
    ) {
      failures.addFailure(
        "invalid manifest",
        `${identity}: accepted process occurrences require shellEnabled: false`,
      );
    }
  }
}

/**
 * Check that one reviewed entry names a real finding and says why it is accepted.
 * Keeps the manifest reviewable: every accepted warning must carry a human rationale.
 *
 * @param acceptedEntry - one reviewed entry from the manifest
 * @param failures - collector the caller prints; nothing is added when the entry is sound
 * @returns nothing; problems are recorded as "invalid manifest" lines
 */
function validateAcceptedEntry(acceptedEntry, failures) {
  const identity =
    typeof acceptedEntry.stableIdentity === "string"
      ? acceptedEntry.stableIdentity
      : "";
  // Without an identity there is nothing to match a scan against, so stop describing this entry.
  if (identity.length === 0) {
    failures.addFailure("invalid manifest", "entry without a stableIdentity");
    return;
  }
  // Missing rule or file means a reviewer cannot tell which finding was signed off.
  if (
    typeof acceptedEntry.ruleId !== "string" ||
    typeof acceptedEntry.file !== "string"
  ) {
    failures.addFailure(
      "invalid manifest",
      `${identity}: ruleId and file are required`,
    );
  }
  // A blank rationale is an unreviewed acceptance, which is exactly what this gate exists to stop.
  if (
    typeof acceptedEntry.rationale !== "string" ||
    acceptedEntry.rationale.trim().length === 0
  ) {
    failures.addFailure(
      "invalid manifest",
      `${identity}: rationale is required`,
    );
  }
  validateAcceptedOccurrences(acceptedEntry, identity, failures);
}

/**
 * Check the manifest's own header: the schema it was written against and the coverage floor.
 * A wrong schema or missing floor means the reviewed list cannot be trusted for this analyzer.
 *
 * @param parsedManifest - the manifest as read from disk
 * @param failures - collector the caller prints; nothing is added when the header is sound
 * @returns nothing; problems are recorded as "invalid manifest" lines
 */
function validateManifestHeader(parsedManifest, failures) {
  // The manifest was reviewed against a different analyzer contract, so its bounds may not apply.
  if (parsedManifest.schemaVersion !== EXPECTED_SCHEMA) {
    failures.addFailure(
      "invalid manifest",
      `schemaVersion ${String(parsedManifest.schemaVersion)} != ${EXPECTED_SCHEMA}`,
    );
  }
  // Without a positive floor, a scan that silently covered fewer files would still pass.
  if (
    !Number.isInteger(parsedManifest.minimumAnalysedFiles) ||
    parsedManifest.minimumAnalysedFiles <= 0
  ) {
    failures.addFailure(
      "invalid manifest",
      "minimumAnalysedFiles must be a positive integer",
    );
  }
}

/**
 * Index every reviewed entry by identity so scan findings can be looked up in one step.
 * Duplicates are reported rather than merged, because two entries for one identity leave it unclear
 * what was actually signed off.
 *
 * @param parsedManifest - the manifest as read from disk
 * @param failures - collector the caller prints; nothing is added when all entries are sound
 * @returns accepted entries keyed by identity; empty means the manifest accepts nothing, so any
 *   warning in the scan will be reported as new
 */
function collectAcceptedEntriesByIdentity(parsedManifest, failures) {
  const acceptedEntriesByIdentity = new Map();
  // Walk every reviewed entry so one malformed row does not stop the others being checked.
  for (const acceptedEntry of Array.isArray(parsedManifest.entries)
    ? parsedManifest.entries
    : []) {
    validateAcceptedEntry(acceptedEntry, failures);
    // Only identity-bearing entries can be matched, so malformed rows stay out of the lookup.
    if (
      typeof acceptedEntry.stableIdentity === "string" &&
      acceptedEntry.stableIdentity.length > 0
    ) {
      // The same identity twice makes acceptance ambiguous, so say so instead of picking one.
      if (acceptedEntriesByIdentity.has(acceptedEntry.stableIdentity)) {
        failures.addFailure(
          "invalid manifest",
          `duplicate entry ${acceptedEntry.stableIdentity}`,
        );
      }
      acceptedEntriesByIdentity.set(
        acceptedEntry.stableIdentity,
        acceptedEntry,
      );
    }
  }
  return acceptedEntriesByIdentity;
}

/**
 * Read the reviewed debt list a maintainer maintains by hand and confirm it is usable.
 * Runs before the scan so an unreviewable manifest stops the gate immediately instead of appearing
 * to approve whatever the analyzer reports.
 * Error behavior: never throws - a missing file, unreadable file, or JSON syntax error is reported
 * as an "invalid manifest" line and answered with null.
 * Invariant: once anything is recorded, null is always returned, so a broken manifest can never
 * accept a single warning.
 *
 * @param failures - collector the caller prints; nothing is added when the manifest is sound
 * @returns the coverage floor and accepted entries, or null when the manifest cannot be trusted and
 *   the maintainer must fix it before any debt comparison is meaningful
 */
export function loadReviewedDebtManifest(failures) {
  let manifestText;
  try {
    manifestText = readFileSync(MANIFEST_PATH, "utf8");
  } catch (error) {
    // No manifest at all is the intended steady state: this project fixes warnings rather than accepting them,
    // so there is nothing to review and every warning the scan reports counts as a regression.
    if (error.code === "ENOENT") {
      return {
        minimumAnalysedFiles: REVIEWED_MINIMUM_ANALYSED_FILES,
        acceptedEntriesByIdentity: new Map(),
      };
    }
    // Present but unreadable is a different story - for example a permission problem on the file.
    failures.addFailure(
      "invalid manifest",
      `${MANIFEST_PATH}: ${error.message}`,
    );
    return null;
  }
  let parsedManifest;
  try {
    parsedManifest = JSON.parse(manifestText);
  } catch (error) {
    // Half-edited manifest - for example a merge conflict left markers in the JSON.
    failures.addFailure(
      "invalid manifest",
      `${MANIFEST_PATH}: ${error.message}`,
    );
    return null;
  }
  validateManifestHeader(parsedManifest, failures);
  const acceptedEntriesByIdentity = collectAcceptedEntriesByIdentity(
    parsedManifest,
    failures,
  );
  // Anything wrong in the manifest means it cannot be used to accept debt on this run.
  if (failures.hasFailures()) return null;
  return {
    minimumAnalysedFiles: parsedManifest.minimumAnalysedFiles,
    acceptedEntriesByIdentity,
  };
}

/**
 * Confirm the scan is the report this gate knows how to read, and that it covered enough files.
 * Runs before any comparison so drifted output or a shrunken scan is never mistaken for clean code.
 *
 * @param scan - the analyzer's parsed report
 * @param minimumAnalysedFiles - reviewed coverage floor from the manifest
 * @param failures - collector the caller prints; nothing is added when the scan is sound
 * @returns nothing; problems are recorded as "schema drift", "analyzer diagnostics", or
 *   "coverage regression" lines
 */
export function validateScanShape(scan, minimumAnalysedFiles, failures) {
  // A different schema means the fields this gate compares may have moved or changed meaning.
  if (scan.schemaVersion !== EXPECTED_SCHEMA) {
    failures.addFailure(
      "schema drift",
      `analyzer reported ${String(scan.schemaVersion)}, expected ${EXPECTED_SCHEMA}`,
    );
  }
  const diagnostics = Array.isArray(scan.diagnostics) ? scan.diagnostics : null;
  // No diagnostics array at all, so the gate cannot tell a clean scan from a broken one.
  if (diagnostics === null) {
    failures.addFailure(
      "schema drift",
      "diagnostics array missing from analyzer output",
    );
  } else {
    // Each diagnostic is the analyzer reporting its own trouble, such as an unreadable config.
    for (const diagnostic of diagnostics) {
      failures.addFailure(
        "analyzer diagnostics",
        JSON.stringify(diagnostic).slice(0, 160),
      );
    }
  }
  const analysedFileCount = scan.paths?.analysedFiles;
  // Without a file count, a scan that quietly analysed nothing would read as zero debt.
  if (!Number.isInteger(analysedFileCount)) {
    failures.addFailure(
      "schema drift",
      "paths.analysedFiles missing from analyzer output",
    );
  } else if (analysedFileCount < minimumAnalysedFiles) {
    // Fewer files than reviewed - for example a path ignore now hides part of the codebase.
    failures.addFailure(
      "coverage regression",
      `analysedFiles ${analysedFileCount} < recorded floor ${minimumAnalysedFiles}`,
    );
  }
  // No findings array means there is nothing to compare, which is a contract change not a pass.
  if (!Array.isArray(scan.findings)) {
    failures.addFailure(
      "schema drift",
      "findings array missing from analyzer output",
    );
  }
}

/**
 * Sort the scan's findings into the ones this gate blocks on and the ones it only reports.
 * The three-way split exists because each severity has a different promise to the maintainer: errors
 * stop the release outright, warnings are the debt being ratcheted, and everything else stays
 * advisory so this gate never blocks on rules nobody agreed to enforce yet.
 * Invariant: every returned warning carries a non-empty `stableIdentity`, the only key used later.
 *
 * @param findings - findings from the scan; an empty list means the analyzer found nothing at all
 * @param failures - collector the caller prints; gains lines for error findings and identity-less
 *   warnings
 * @returns comparable warnings plus the advisory count shown in the pass summary
 */
export function splitFindingsBySeverity(findings, failures) {
  const comparableWarnings = [];
  let advisoryCount = 0;
  // Classify each finding once, so severity handling stays in a single place.
  for (const finding of findings) {
    // An error-severity finding is never accepted debt; it blocks the release on its own.
    if (finding.severity === "error") {
      failures.addFailure(
        "error findings",
        `${finding.ruleId} ${finding.file}`,
      );
    } else if (finding.severity === "warning") {
      const identity =
        typeof finding.stableIdentity === "string"
          ? finding.stableIdentity
          : "";
      // A warning with no identity cannot be matched to reviewed debt, so the contract has drifted.
      if (identity.length === 0) {
        failures.addFailure(
          "schema drift",
          `warning without stableIdentity: ${finding.ruleId} ${finding.file}`,
        );
      } else {
        comparableWarnings.push(finding);
      }
    } else {
      advisoryCount += 1;
    }
  }
  return { comparableWarnings, advisoryCount };
}

/**
 * Check an accepted oversized file has not grown past what was reviewed.
 * Lines may shrink freely; growing past the accepted maximum, or reporting a different threshold
 * than the one signed off, blocks the release.
 *
 * @param identity - stable identity being compared, used to name it in failure lines
 * @param scannedOccurrences - metadata for this identity from the scan
 * @param acceptedEntry - the reviewed entry holding the accepted line count and threshold
 * @param failures - collector the caller prints; nothing is added when the file is within bounds
 * @returns nothing; problems are recorded as "metadata regression" or "schema drift" lines
 */
function compareAcceptedFileGrowth(
  identity,
  scannedOccurrences,
  acceptedEntry,
  failures,
) {
  const acceptedMaxLines = Math.max(
    ...acceptedEntry.occurrences.map((occurrence) => occurrence.lines),
  );
  const acceptedThreshold = acceptedEntry.occurrences[0].threshold;
  // Compare every occurrence, since one identity can be reported more than once.
  for (const scannedMetadata of scannedOccurrences) {
    // Missing size metadata means the analyzer changed what it reports for this rule.
    if (
      !Number.isInteger(scannedMetadata?.lines) ||
      !Number.isInteger(scannedMetadata?.threshold)
    ) {
      failures.addFailure(
        "schema drift",
        `${identity}: size warning without lines/threshold metadata`,
      );
    } else if (scannedMetadata.threshold !== acceptedThreshold) {
      // The rule's limit moved - someone tuned config instead of fixing or re-reviewing the file.
      failures.addFailure(
        "metadata regression",
        `${identity}: threshold ${scannedMetadata.threshold} != reviewed ${acceptedThreshold}`,
      );
    } else if (scannedMetadata.lines > acceptedMaxLines) {
      // The file got bigger than reviewed, which is the slow growth this gate exists to catch.
      failures.addFailure(
        "metadata regression",
        `${identity}: ${acceptedEntry.file} grew to ${scannedMetadata.lines} lines (accepted max ${acceptedMaxLines})`,
      );
    }
  }
}

/**
 * Check every scanned occurrence matches one a reviewer actually signed off.
 * Used for rules whose detail matters, such as how a process is launched, so a familiar identity
 * cannot quietly change into a riskier shape.
 *
 * @param identity - stable identity being compared, used to name it in failure lines
 * @param scannedOccurrences - metadata for this identity from the scan
 * @param acceptedEntry - the reviewed entry holding the accepted occurrence shapes
 * @param failures - collector the caller prints; nothing is added when every shape was reviewed
 * @returns nothing; problems are recorded as "metadata regression" or "schema drift" lines
 */
function compareAcceptedOccurrenceShapes(
  identity,
  scannedOccurrences,
  acceptedEntry,
  failures,
) {
  const unmatchedAcceptedShapes = new Map();
  // Count the accepted shapes first, so each one can only absorb one scanned occurrence.
  for (const occurrence of acceptedEntry.occurrences) {
    const shapeKey = occurrenceComparisonKey(occurrence);
    unmatchedAcceptedShapes.set(
      shapeKey,
      (unmatchedAcceptedShapes.get(shapeKey) ?? 0) + 1,
    );
  }
  // Match each scanned occurrence against the remaining accepted ones.
  for (const scannedMetadata of scannedOccurrences) {
    // No metadata to compare, so the analyzer contract changed rather than the code.
    if (typeof scannedMetadata !== "object" || scannedMetadata === null) {
      failures.addFailure(
        "schema drift",
        `${identity}: warning without metadata`,
      );
      continue;
    }
    // A shell-enabled launch is the risky form; it is blocked even where the identity is known.
    if (
      acceptedEntry.ruleId === "security.process-exec" &&
      scannedMetadata.shellEnabled !== false
    ) {
      failures.addFailure(
        "metadata regression",
        `${identity}: process execution with shellEnabled ${String(scannedMetadata.shellEnabled)}`,
      );
      continue;
    }
    const shapeKey = occurrenceComparisonKey(scannedMetadata);
    const remainingForShape = unmatchedAcceptedShapes.get(shapeKey) ?? 0;
    // Nothing accepted left for this shape, so the code now does something nobody reviewed.
    if (remainingForShape <= 0) {
      failures.addFailure(
        "metadata regression",
        `${identity}: unreviewed occurrence ${shapeKey}`,
      );
    } else {
      unmatchedAcceptedShapes.set(shapeKey, remainingForShape - 1);
    }
  }
}

/**
 * Compare one identity's scanned warnings against the entry that accepted it.
 * Unknown identities are new debt, a moved rule or file is treated as a different finding, extra
 * occurrences are growth, and only then are the rule's own bounds checked.
 *
 * @param identity - stable identity being compared, used to name it in failure lines
 * @param scannedFindings - every scan finding sharing this identity; never empty
 * @param acceptedEntry - the matching reviewed entry, or undefined when nobody reviewed this yet
 * @param failures - collector the caller prints; nothing is added when the identity is in bounds
 * @returns nothing; problems are recorded under the category naming what changed
 */
function compareOneWarningIdentity(
  identity,
  scannedFindings,
  acceptedEntry,
  failures,
) {
  const firstFinding = scannedFindings[0];
  // Nobody reviewed this warning, so it is new debt a maintainer must fix or explicitly accept.
  if (!acceptedEntry) {
    failures.addFailure(
      "new warning",
      `${identity} ${firstFinding.ruleId} ${firstFinding.file}`,
    );
    return;
  }
  // Same identity, different rule or file: this is a different finding than the one reviewed.
  if (
    acceptedEntry.ruleId !== firstFinding.ruleId ||
    acceptedEntry.file !== firstFinding.file
  ) {
    failures.addFailure(
      "metadata regression",
      `${identity}: identity now reports ${firstFinding.ruleId} ${firstFinding.file}, reviewed as ${acceptedEntry.ruleId} ${acceptedEntry.file}`,
    );
    return;
  }
  // More occurrences than accepted, so the same problem now happens in more places.
  if (scannedFindings.length > acceptedEntry.occurrences.length) {
    failures.addFailure(
      "duplicate growth",
      `${identity}: ${scannedFindings.length} occurrences exceed accepted ${acceptedEntry.occurrences.length}`,
    );
    return;
  }
  const scannedOccurrences = scannedFindings.map((finding) => finding.metadata);
  // Oversized files are judged on growth; every other rule is judged on its occurrence shapes.
  if (acceptedEntry.ruleId === "size.file-length") {
    compareAcceptedFileGrowth(
      identity,
      scannedOccurrences,
      acceptedEntry,
      failures,
    );
  } else {
    compareAcceptedOccurrenceShapes(
      identity,
      scannedOccurrences,
      acceptedEntry,
      failures,
    );
  }
}

/**
 * Compare the whole scan against the reviewed list in both directions.
 * Forward catches debt that grew or appeared; backward catches entries the code no longer reports,
 * so a fixed file must be removed from the manifest and cannot silently come back later.
 *
 * @param comparableWarnings - identity-bearing warnings from the scan; empty means the only possible
 *   failures are stale entries the manifest still claims
 * @param acceptedEntriesByIdentity - reviewed entries keyed by identity
 * @param failures - collector the caller prints; nothing is added when debt is unchanged or reduced
 * @returns nothing; problems are recorded under the category naming what changed
 */
export function compareScanAgainstAcceptedDebt(
  comparableWarnings,
  acceptedEntriesByIdentity,
  failures,
) {
  const scannedFindingsByIdentity = new Map();
  // Group by identity first, because one identity can be reported several times in one scan.
  for (const finding of comparableWarnings) {
    const findingsForIdentity =
      scannedFindingsByIdentity.get(finding.stableIdentity) ?? [];
    findingsForIdentity.push(finding);
    scannedFindingsByIdentity.set(finding.stableIdentity, findingsForIdentity);
  }
  // Judge everything the scan reported, in a stable order so reruns read the same.
  for (const identity of [...scannedFindingsByIdentity.keys()].sort()) {
    compareOneWarningIdentity(
      identity,
      scannedFindingsByIdentity.get(identity),
      acceptedEntriesByIdentity.get(identity),
      failures,
    );
  }
  // Now the other direction: reviewed entries the scan no longer reports at all.
  for (const identity of [...acceptedEntriesByIdentity.keys()].sort()) {
    // The finding is gone - someone fixed it, so the manifest must stop claiming it as debt.
    if (!scannedFindingsByIdentity.has(identity)) {
      failures.addFailure(
        "stale accepted debt",
        `${identity} ${acceptedEntriesByIdentity.get(identity).ruleId} no longer reported; remove its manifest entry`,
      );
    }
  }
}
