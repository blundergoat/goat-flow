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

/**
 * Build the location half of a finding id, which is the part that must stay stable so `quality diff` recognises last week's finding again.
 *
 * @param finding - finding supplying its type, file, and line
 * @returns the location id; a finding with no line uses a placeholder rather than colliding with a different line on the same file
 */
function buildLocationFindingId(
  finding: Pick<QualityFinding, "type" | "file" | "line">,
): string {
  return `${finding.type}:${slugFindingFile(finding.file)}:${finding.line ?? "_"}`;
}

/**
 * Build the id a saved finding is recognised by, adding a text slug only when the location alone cannot stay unique.
 * Keeping the short form wherever possible is the contract that stops unrelated edits from making every finding look new.
 *
 * @param finding - finding supplying its type, file, line, and summary
 * @param isAmbiguousLocation - true when more than one finding shares this location and the text must disambiguate them
 * @returns the finding id used in saved reports and diffs
 */
function buildFindingId(
  finding: Pick<QualityFinding, "type" | "file" | "line" | "summary">,
  isAmbiguousLocation: boolean,
): string {
  const location = buildLocationFindingId(finding);
  // One finding at a known line needs nothing more, and the shorter id survives edits to the summary text.
  if (!isAmbiguousLocation && finding.line !== null) return location;
  return `${location}:${slugFindingText(finding.summary)}`;
}

/**
 * Attach stable finding ids while preserving duplicate findings at the same location.
 * Ids must stay deterministic across runs, so they are derived from each finding's own text rather than its position in the list.
 *
 * @param report - raw quality report whose findings need deterministic ids
 * @returns the saved-report shape; the error branch reports an id collision that could not be disambiguated
 */
export function attachFindingIds(
  report: QualityReport,
): { ok: true; report: SavedQualityReport } | { ok: false; error: string } {
  const locationCounts = new Map<string, number>();
  // First pass counts locations, because whether a finding needs its text in the id depends on the whole report.
  for (const finding of report.findings) {
    const locationId = buildLocationFindingId(finding);
    locationCounts.set(locationId, (locationCounts.get(locationId) ?? 0) + 1);
  }

  const seen = new Map<string, number>();
  const findings: SavedQualityFinding[] = [];

  // Second pass assigns ids, numbering genuine duplicates so two identical findings stay two rows for the user.
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
