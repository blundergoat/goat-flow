/**
 * Cold-path content lint aggregator for `audit --check-content`.
 * Runs the three content scanners (quality, factual-claim, snapshot-claim) over a single audit context and folds their findings into one
 * ContentReport.
 *
 * Lives apart from the build checks because content linting is opt-in and far more expensive than the deterministic pass/fail checks the orchestrator
 * always runs.
 */
import { runContentQualityChecks } from "./check-content-quality.js";
import { runFactualClaimChecks } from "./check-factual-claims.js";
import { runSnapshotClaimChecks } from "./check-snapshot-claims.js";
import type { AuditContext, ContentReport } from "./types.js";

/**
 * Combine content-quality, factual-claim, and snapshot-claim findings into a single ContentReport.
 *
 * Status is `fail` only when at least one warning-severity finding exists; info-only findings still report `pass` because they are advisory.
 * Scanned-file counts are summed so coverage reflects all three scanners.
 *
 * @param ctx - audit context shared by every scanner; supplies the readonly FS, facts, and config
 * @returns merged report whose `status` is `fail` when any finding has `warning` severity, else `pass`
 */
export function computeContent(ctx: AuditContext): ContentReport {
  const quality = runContentQualityChecks(ctx);
  const factual = runFactualClaimChecks(ctx);
  const snapshot = runSnapshotClaimChecks(ctx);
  const findings = [
    ...quality.findings,
    ...factual.findings,
    ...snapshot.findings,
  ];
  const warnings = findings.filter((f) => f.severity === "warning").length;
  const infos = findings.filter((f) => f.severity === "info").length;
  return {
    status: warnings === 0 ? "pass" : "fail",
    findings,
    warnings,
    infos,
    filesScanned:
      quality.filesScanned + factual.filesScanned + snapshot.filesScanned,
  };
}
