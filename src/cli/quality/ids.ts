/**
 * Positional finding-id generation for persisted quality reports.
 */
import type {
  QualityFinding,
  QualityReport,
  SavedQualityFinding,
  SavedQualityReport,
} from "./schema.js";

function slugFindingFile(file: string | null): string {
  if (file === null) return "_";
  const slug = file
    .replace(/\\/g, "/")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "_";
}

function buildFindingId(
  finding: Pick<QualityFinding, "type" | "file" | "line">,
): string {
  return `${finding.type}:${slugFindingFile(finding.file)}:${finding.line ?? "_"}`;
}

export function attachFindingIds(
  report: QualityReport,
): { ok: true; report: SavedQualityReport } | { ok: false; error: string } {
  const seen = new Set<string>();
  const findings: SavedQualityFinding[] = [];

  for (const finding of report.findings) {
    const id = buildFindingId(finding);
    if (seen.has(id)) {
      return {
        ok: false,
        error: `Duplicate positional finding id in report: ${id}`,
      };
    }
    seen.add(id);
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
