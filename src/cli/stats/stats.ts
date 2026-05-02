/**
 * Learning-loop health report (`goat-flow stats`).
 *
 * Consumes the live `SharedFacts` pipeline - no second on-disk read path and no
 * persisted derived counts. `--check` mode reuses the same report data to decide
 * pass/fail, so CI and the human-readable report never disagree.
 */
import type { SharedFacts, BucketFreshness, ReadonlyFS } from "../types.js";

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
  decisions?: DecisionsSection;
}

interface DecisionFileSummary {
  path: string;
  filename: string;
  content: string | null;
}

interface StatsWarning {
  file: string;
  rule: "decision-metadata";
  message: string;
}

export interface DecisionsSection {
  path: string;
  exists: boolean;
  files: DecisionFileSummary[];
  warnings: StatsWarning[];
}

/** One actionable problem surfaced by `goat-flow stats --check`. */
interface StatsFinding {
  file: string;
  rule:
    | "missing-last-reviewed"
    | "invalid-last-reviewed"
    | "stale-last-reviewed"
    | "stale-ref"
    | "invalid-line-ref"
    | "format"
    | "bucket-size"
    | "decision-filename"
    | "decision-structure";
  message: string;
}

/** Pass/fail verdict produced by `goat-flow stats --check`. */
export interface StatsCheckReport {
  status: "pass" | "fail";
  findings: StatsFinding[];
  warnings: StatsWarning[];
}

/** Build one learning-loop section summary. */
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
  decisions?: DecisionsSection;
}): StatsReport {
  return {
    footguns: buildSection(
      shared.footguns,
      shared.footguns.invalidLineRefs.length,
    ),
    lessons: buildSection(
      shared.lessons,
      shared.lessons.invalidLineRefs.length,
    ),
    ...(shared.decisions ? { decisions: shared.decisions } : {}),
  };
}

export function buildDecisionsSection(
  fs: ReadonlyFS,
  rawPath: string,
): DecisionsSection {
  const path = rawPath.replace(/\/$/, "");
  const exists = fs.exists(path);
  const filenames = exists ? fs.listDir(path).sort() : [];
  const files = filenames.map((filename) => ({
    filename,
    path: `${path}/${filename}`,
    content: fs.readFile(`${path}/${filename}`),
  }));
  return {
    path,
    exists,
    files,
    warnings: [],
  };
}

/** Check one bucket for stale or missing last_reviewed metadata. */
function checkBucketLastReviewed(
  bucket: BucketSection["buckets"][number],
): StatsFinding | null {
  if (bucket.lastReviewed === null) {
    return {
      file: bucket.path,
      rule: "missing-last-reviewed",
      message: `${bucket.path}: missing or invalid frontmatter last_reviewed (expected YYYY-MM-DD)`,
    };
  }
  if (
    bucket.maxEntryDate !== null &&
    bucket.maxEntryDate > bucket.lastReviewed
  ) {
    return {
      file: bucket.path,
      rule: "stale-last-reviewed",
      message: `${bucket.path}: last_reviewed (${bucket.lastReviewed}) is older than the newest entry date (${bucket.maxEntryDate}); bump frontmatter last_reviewed.`,
    };
  }
  return null;
}

const BUCKET_SIZE_WARN_BYTES = 40_000;

/** Collect bucket findings. */
function collectBucketFindings(
  bucket: BucketSection["buckets"][number],
): StatsFinding[] {
  const findings: StatsFinding[] = [];
  const reviewFinding = checkBucketLastReviewed(bucket);
  if (reviewFinding !== null) findings.push(reviewFinding);
  if (bucket.sizeBytes > BUCKET_SIZE_WARN_BYTES) {
    const kb = Math.round(bucket.sizeBytes / 1024);
    findings.push({
      file: bucket.path,
      rule: "bucket-size",
      message: `${bucket.path}: ${kb}KB exceeds ${Math.round(BUCKET_SIZE_WARN_BYTES / 1024)}KB threshold; consider splitting into narrower category buckets`,
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
  return findings;
}

/** Collect findings. */
function collectFindings(section: BucketSection): StatsFinding[] {
  const findings: StatsFinding[] = [];
  for (const bucket of section.buckets) {
    findings.push(...collectBucketFindings(bucket));
  }
  if (section.formatDiagnostic !== null) {
    const alreadyReported = findings.some(
      (f) => f.rule === "missing-last-reviewed",
    );
    for (const piece of section.formatDiagnostic.split("; ")) {
      if (alreadyReported && /missing frontmatter last_reviewed/.test(piece)) {
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

const ADR_FILENAME = /^ADR-\d{3}-[a-z0-9-]+\.md$/;
const ROUTING_HINT =
  "Wrong home -> right home: implementation TODOs and scoped work plans belong in .goat-flow/tasks/; recurring hazards with evidence belong in .goat-flow/footguns/; reusable takeaways belong in .goat-flow/lessons/; temporary notes belong in .goat-flow/scratchpad/; backlog requests belong in Linear/GitHub issues.";

function hasHeading(content: string, heading: string): boolean {
  return new RegExp(`^##\\s+${heading}\\b`, "m").test(content);
}

function decisionFilenameFinding(file: DecisionFileSummary): StatsFinding {
  return {
    file: file.path,
    rule: "decision-filename",
    message: `${file.path}: decision records must be named ADR-NNN-kebab-case-title.md. ${ROUTING_HINT}`,
  };
}

function hasDecisionTradeoffSection(content: string): boolean {
  return (
    hasHeading(content, "Consequences") ||
    hasHeading(content, "Failure Mode Comparison") ||
    hasHeading(content, "Reversibility")
  );
}

function missingDecisionStructure(content: string): string[] {
  const missing: string[] = [];
  if (!/^\*\*Status:\*\*/m.test(content)) missing.push("**Status:**");
  if (!/^\*\*Date:\*\*/m.test(content)) missing.push("**Date:**");
  if (!hasHeading(content, "Context")) missing.push("## Context");
  if (!hasHeading(content, "Decision")) missing.push("## Decision");
  if (!hasDecisionTradeoffSection(content)) {
    missing.push(
      "## Consequences or ## Failure Mode Comparison or ## Reversibility",
    );
  }
  return missing;
}

function decisionStructureFinding(
  file: DecisionFileSummary,
  missing: string[],
): StatsFinding {
  return {
    file: file.path,
    rule: "decision-structure",
    message: `${file.path}: malformed ADR is missing ${missing.join(", ")}. ${ROUTING_HINT}`,
  };
}

function collectDecisionFileFinding(
  file: DecisionFileSummary,
): StatsFinding | null {
  if (file.filename === "README.md") return null;
  if (!ADR_FILENAME.test(file.filename)) return decisionFilenameFinding(file);

  const missing = missingDecisionStructure(file.content ?? "");
  return missing.length > 0 ? decisionStructureFinding(file, missing) : null;
}

function collectDecisionFindings(section: DecisionsSection): StatsFinding[] {
  if (!section.exists) return [];
  return section.files.flatMap(
    (file) => collectDecisionFileFinding(file) ?? [],
  );
}

/** Run the `--check` verdict against an already-built stats report. */
export function checkStats(report: StatsReport): StatsCheckReport {
  const findings = [
    ...collectFindings(report.footguns),
    ...collectFindings(report.lessons),
    ...(report.decisions ? collectDecisionFindings(report.decisions) : []),
  ];
  return {
    status: findings.length === 0 ? "pass" : "fail",
    findings,
    warnings: report.decisions?.warnings ?? [],
  };
}
