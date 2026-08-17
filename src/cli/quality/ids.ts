/**
 * Generates the stable ids that let a saved quality finding be recognised again in a later run.
 *
 * These ids are what `quality diff` compares, so a user can ask "is this the same problem I saw last week, or a new one?".
 *
 * Ids are derived from the finding's own file, line, and text rather than its position in the list, so:
 * - reordering findings does not make every one look new
 * - a finding with no file or line still gets a usable id instead of colliding with its neighbours
 */
import type {
  QualityFinding,
  QualityReport,
  SavedQualityFinding,
  SavedQualityReport,
} from "./schema.js";

/** Build the slug for one finding file path. */
function slugFindingFile(file: string | null): string {
  if (file === null) return "_";
  const slug = file
    .replace(/\\/g, "/")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "_";
}

/** Build a compact slug for null-line finding text. */
function slugFindingText(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || "_";
}

/** Build the legacy location ID for one finding. */
function buildLocationFindingId(
  finding: Pick<QualityFinding, "type" | "file" | "line">,
): string {
  return `${finding.type}:${slugFindingFile(finding.file)}:${finding.line ?? "_"}`;
}

/** Build a disambiguated ID for repeated findings at the same location. */
function buildFindingId(
  finding: Pick<QualityFinding, "type" | "file" | "line" | "summary">,
  isAmbiguousLocation: boolean,
): string {
  const location = buildLocationFindingId(finding);
  if (!isAmbiguousLocation && finding.line !== null) return location;
  return `${location}:${slugFindingText(finding.summary)}`;
}

/**
 * Attach stable finding IDs while preserving duplicate findings at the same location.
 *
 * @param report - raw quality report whose findings need deterministic ids
 * @returns saved-report shape, or a validation error when an id collision remains ambiguous
 */
export function attachFindingIds(
  report: QualityReport,
): { ok: true; report: SavedQualityReport } | { ok: false; error: string } {
  const locationCounts = new Map<string, number>();
  for (const finding of report.findings) {
    const locationId = buildLocationFindingId(finding);
    locationCounts.set(locationId, (locationCounts.get(locationId) ?? 0) + 1);
  }

  const seen = new Map<string, number>();
  const findings: SavedQualityFinding[] = [];

  for (const finding of report.findings) {
    const locationId = buildLocationFindingId(finding);
    const baseId = buildFindingId(
      finding,
      (locationCounts.get(locationId) ?? 0) > 1,
    );
    const occurrence = seen.get(baseId) ?? 0;
    seen.set(baseId, occurrence + 1);
    const id = occurrence === 0 ? baseId : `${baseId}:${occurrence + 1}`;
    findings.push({ ...finding, id });
  }

  return {
    ok: true,
    report: {
      ...report,
      findings,
    },
  };
}
