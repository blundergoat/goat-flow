/**
 * Decides which saved Quality runs measure the same thing, so `quality history`, `quality diff` and the dashboard only compare like with like.
 *
 * - A rubric id hashes the current scoring text plus a policy revision; publishing a new package version alone never changes it.
 * - Reports saved without a rubric id, or with a package version in its place, share one legacy segment per quality mode.
 * - A score delta between two runs counts only when rubric and scope match; a project's own history holds only its own runs.
 */
import { createHash } from "node:crypto";
import { qualityScoringText } from "../prompt/compose-quality-static-sections.js";
import type { QualityMode, QualityReport } from "./schema-types.js";

// Bump when prior-context policy changes, even if static scoring text does not.
const QUALITY_RUBRIC_REVISION = 3;

/**
 * Name the current mode's scoring text and prior-context policy revision.
 *
 * @param mode - assessment family whose scores are compared
 * @returns non-semver id stable while scoring text and the policy revision are unchanged
 */
export function getQualityRubricId(mode: QualityMode): string {
  const digest = createHash("sha256")
    .update(qualityScoringText(mode))
    .digest("hex");
  return `quality-${mode}-r${QUALITY_RUBRIC_REVISION}-${digest}`;
}

/**
 * Identify pre-rubric reports without changing their stored metadata.
 *
 * @param report - historical or current rubric metadata
 * @returns whether the rubric is absent or a package semver
 */
export function isLegacyQualityRubric(
  report: Pick<QualityReport, "rubric_version">,
): boolean {
  return (
    report.rubric_version === undefined ||
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(
      report.rubric_version,
    )
  );
}

/**
 * Decide whether two saved reports score the same target, so `quality history`, `quality diff` and the dashboard compare only like runs.
 *
 * The project path is not compared here: saving and loading history require it to resolve to the selected project.
 * Symlink aliases remain equivalent; history from an old project location needs its ownership reconciled before loading.
 *
 * @param olderReport - previous report; its stored rubric and scope are compared unchanged
 * @param newerReport - subsequent report; a scope omitted by a legacy report matches only another omitted scope
 * @returns whether rubric identity and scope both match
 */
export function isSameQualityAssessmentTarget(
  olderReport: Pick<QualityReport, "rubric_version" | "quality_mode" | "scope">,
  newerReport: Pick<QualityReport, "rubric_version" | "quality_mode" | "scope">,
): boolean {
  return (
    qualityReportRubricId(olderReport) === qualityReportRubricId(newerReport) &&
    olderReport.scope === newerReport.scope
  );
}

/**
 * Read comparison identity without rewriting historical report fields.
 *
 * @param report - rubric and mode retained in a saved report
 * @returns stored rubric id, or one legacy segment for the report's mode
 */
export function qualityReportRubricId(
  report: Pick<QualityReport, "rubric_version" | "quality_mode">,
): string {
  const rubric = report.rubric_version;
  if (rubric === undefined || isLegacyQualityRubric(report)) {
    return `legacy:${report.quality_mode ?? "agent-setup"}`;
  }
  return rubric;
}
