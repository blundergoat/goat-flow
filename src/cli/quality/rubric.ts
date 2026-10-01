/** Identity for comparable quality scores; package releases are independent. */
import { createHash } from "node:crypto";
import { qualityScoringText } from "../prompt/compose-quality-static-sections.js";
import type { QualityMode, QualityReport } from "./schema-types.js";

// Bump when prior-context policy changes, even if static scoring text does not.
const QUALITY_RUBRIC_REVISION = 1;

/**
 * Name the current mode's scoring text and prior-context policy revision.
 *
 * @param mode - assessment family whose scores are compared
 * @returns non-semver id stable across releases with unchanged scoring text
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
