/**
 * Collect documentation findings when the user requests audit --check-content.
 *
 * Quality, factual-claim, and snapshot-claim scanners share the same project facts and configuration.
 * Their findings become one optional report; warning findings fail this section, while information stays advisory.
 */
import { runContentQualityChecks } from "./check-content-quality.js";
import { runFactualClaimChecks } from "./check-factual-claims.js";
import { runSnapshotClaimChecks } from "./check-snapshot-claims.js";
import type { AuditContext, ContentReport } from "./types.js";

/**
 * Merge the requested content scans into the report shown beside structural audit results.
 * The report contract fails this section only for warnings; information stays advisory, and file counts include each scanner's coverage.
 *
 * @param ctx - shared target filesystem, extracted facts, and configuration used by every content scanner
 * @returns - merged findings and coverage; no warning findings means pass, including an empty findings list
 */
export function computeContent(ctx: AuditContext): ContentReport {
  const qualityReport = runContentQualityChecks(ctx);
  const factualClaimReport = runFactualClaimChecks(ctx);
  const snapshotClaimReport = runSnapshotClaimChecks(ctx);
  const findings = [
    ...qualityReport.findings,
    ...factualClaimReport.findings,
    ...snapshotClaimReport.findings,
  ];
  // Only warnings affect audit status; information remains available for the user's review.
  const warnings = findings.filter(
    (finding) => finding.severity === "warning",
  ).length;
  const infos = findings.filter(
    (finding) => finding.severity === "info",
  ).length;
  return {
    status: warnings === 0 ? "pass" : "fail",
    findings,
    warnings,
    infos,
    filesScanned:
      qualityReport.filesScanned +
      factualClaimReport.filesScanned +
      snapshotClaimReport.filesScanned,
  };
}
