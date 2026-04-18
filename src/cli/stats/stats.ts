/**
 * Learning-loop health report (`goat-flow stats`).
 *
 * Consumes the live `SharedFacts` pipeline — no second on-disk read path and no
 * persisted derived counts. `--check` mode reuses the same report data to decide
 * pass/fail, so CI and the human-readable report never disagree.
 */
import type { SharedFacts, BucketFreshness } from "../types.js";

/** Aggregated per-surface view over one learning-loop directory (footguns or lessons). */
export interface BucketSection {
  path: string;
  exists: boolean;
  totalEntries: number;
  totalStaleRefs: number;
  totalInvalidLineRefs: number;
  bands: { fresh: number; aging: number; stale: number; unknown: number };
  buckets: BucketFreshness[];
  formatDiagnostic: string | null;
}

/** Full `goat-flow stats` report payload. */
export interface StatsReport {
  footguns: BucketSection;
  lessons: BucketSection;
}

/** One actionable problem surfaced by `goat-flow stats --check`. */
export interface StatsFinding {
  file: string;
  rule:
    | "missing-last-reviewed"
    | "invalid-last-reviewed"
    | "stale-ref"
    | "invalid-line-ref"
    | "format";
  message: string;
}

/** Pass/fail verdict produced by `goat-flow stats --check`. */
export interface StatsCheckReport {
  status: "pass" | "fail";
  findings: StatsFinding[];
}

function buildSection(
  side: SharedFacts["footguns"] | SharedFacts["lessons"],
  totalInvalidLineRefs: number,
): BucketSection {
  const bands = { fresh: 0, aging: 0, stale: 0, unknown: 0 };
  for (const bucket of side.buckets) bands[bucket.freshnessBand] += 1;
  return {
    path: side.path,
    exists: side.exists,
    totalEntries: side.entryCount,
    totalStaleRefs: side.staleRefs.length,
    totalInvalidLineRefs,
    bands,
    buckets: side.buckets,
    formatDiagnostic: side.formatDiagnostic,
  };
}

/** Build the full stats report from the learning-loop slice of shared facts. */
export function buildStatsReport(shared: {
  footguns: SharedFacts["footguns"];
  lessons: SharedFacts["lessons"];
}): StatsReport {
  return {
    footguns: buildSection(
      shared.footguns,
      shared.footguns.invalidLineRefs.length,
    ),
    lessons: buildSection(shared.lessons, 0),
  };
}

function collectFindings(section: BucketSection): StatsFinding[] {
  const findings: StatsFinding[] = [];
  for (const bucket of section.buckets) {
    if (bucket.lastReviewed === null) {
      findings.push({
        file: bucket.path,
        rule: "missing-last-reviewed",
        message: `${bucket.path}: missing or invalid frontmatter last_reviewed (expected YYYY-MM-DD)`,
      });
    }
    for (const ref of bucket.staleRefs) {
      findings.push({
        file: bucket.path,
        rule: "stale-ref",
        message: `${bucket.path}: stale file ref ${ref}`,
      });
    }
    for (const ref of bucket.invalidLineRefs) {
      findings.push({
        file: bucket.path,
        rule: "invalid-line-ref",
        message: `${bucket.path}: invalid line ref ${ref}`,
      });
    }
  }
  if (section.formatDiagnostic !== null) {
    const alreadyReported = findings.some(
      (f) => f.rule === "missing-last-reviewed",
    );
    for (const piece of section.formatDiagnostic.split("; ")) {
      if (
        alreadyReported &&
        /missing frontmatter last_reviewed/.test(piece)
      ) {
        continue;
      }
      if (/invalid last_reviewed format/.test(piece)) {
        findings.push({
          file: section.path,
          rule: "invalid-last-reviewed",
          message: piece,
        });
        continue;
      }
      findings.push({ file: section.path, rule: "format", message: piece });
    }
  }
  return findings;
}

/** Run the `--check` verdict against an already-built stats report. */
export function checkStats(report: StatsReport): StatsCheckReport {
  const findings = [
    ...collectFindings(report.footguns),
    ...collectFindings(report.lessons),
  ];
  return { status: findings.length === 0 ? "pass" : "fail", findings };
}
