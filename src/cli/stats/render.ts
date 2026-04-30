/**
 * Output renderers for `goat-flow stats` - text, JSON, markdown.
 * Text is the default for terminals; JSON/markdown are for CI and PR comments.
 */
import type {
  BucketSection,
  DecisionsSection,
  StatsCheckReport,
  StatsReport,
} from "./stats.js";

const BAND_LABEL: Record<string, string> = {
  fresh: "fresh",
  aging: "aging",
  stale: "stale",
  unknown: "unknown",
};

/** Format the days. */
function formatDays(days: number | null): string {
  return days === null ? "-" : `${days}d`;
}

/** Pad a string on the right to the target width. */
function padRight(value: string, width: number): string {
  return value.length >= width
    ? value
    : value + " ".repeat(width - value.length);
}

/** Render the section text. */
function renderSectionText(name: string, section: BucketSection): string {
  if (!section.exists) {
    return `${name} (${section.path}) - directory missing\n`;
  }

  const header = `${name} (${section.path}) - ${section.buckets.length} bucket(s), ${section.totalEntries} entrie(s)`;
  const summary = `  Freshness: ${section.bands.fresh} fresh, ${section.bands.aging} aging, ${section.bands.stale} stale, ${section.bands.unknown} unknown | Refs: ${section.totalStaleRefs} stale, ${section.totalInvalidLineRefs} invalid-line`;
  if (section.buckets.length === 0) {
    return [header, summary, ""].join("\n");
  }

  const nameWidth = Math.max(
    8,
    ...section.buckets.map((b) => basename(b.path).length),
  );
  const lines = section.buckets.map((bucket) => {
    const display = basename(bucket.path);
    const last = bucket.lastReviewed ?? "-";
    const days = formatDays(bucket.freshnessDays);
    const band = BAND_LABEL[bucket.freshnessBand] ?? bucket.freshnessBand;
    const refs = `${bucket.staleRefs.length}s/${bucket.invalidLineRefs.length}i`;
    return `  ${padRight(display, nameWidth)}  last=${last}  age=${padRight(days, 6)}  band=${padRight(band, 7)}  entries=${bucket.entryCount}  refs=${refs}`;
  });
  return [header, summary, ...lines, ""].join("\n");
}

/** Return the last segment of a slash-delimited path. */
function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

/** Render the stats report as human-readable text. */
export function renderStatsText(report: StatsReport): string {
  return (
    renderSectionText("Footguns", report.footguns) +
    "\n" +
    renderSectionText("Lessons", report.lessons) +
    (report.decisions ? "\n" + renderDecisionsText(report.decisions) : "")
  );
}

/** Render the stats report as JSON (stable shape for CI). */
export function renderStatsJson(report: StatsReport): string {
  return JSON.stringify(report, null, 2);
}

/** Render the stats report as markdown (PR-comment friendly). */
export function renderStatsMarkdown(report: StatsReport): string {
  const sections = [
    markdownSection("Footguns", report.footguns),
    markdownSection("Lessons", report.lessons),
    ...(report.decisions ? [markdownDecisions(report.decisions)] : []),
  ];
  return ["# Learning-loop stats", "", ...sections].join("\n");
}

function renderDecisionsText(section: DecisionsSection): string {
  if (!section.exists) {
    return `Decisions (${section.path}) - directory missing\n`;
  }
  const adrCount = section.files.filter((file) =>
    /^ADR-\d{3}-[a-z0-9-]+\.md$/.test(file.filename),
  ).length;
  const header = `Decisions (${section.path}) - ${adrCount} ADR file(s), ${section.warnings.length} warning(s)`;
  if (section.warnings.length === 0) return `${header}\n`;
  return [
    header,
    ...section.warnings.map(
      (warning) => `  - [${warning.rule}] ${warning.message}`,
    ),
    "",
  ].join("\n");
}

function markdownDecisions(section: DecisionsSection): string {
  if (!section.exists) {
    return `## Decisions\n\n_Directory missing: \`${section.path}\`_\n`;
  }
  const adrCount = section.files.filter((file) =>
    /^ADR-\d{3}-[a-z0-9-]+\.md$/.test(file.filename),
  ).length;
  const lines = [
    `## Decisions`,
    ``,
    `- Path: \`${section.path}\``,
    `- ADR files: ${adrCount}`,
    `- Warnings: ${section.warnings.length}`,
    ``,
  ];
  if (section.warnings.length > 0) {
    lines.push(
      ...section.warnings.map(
        (warning) => `- [${warning.rule}] ${warning.message}`,
      ),
      ``,
    );
  }
  return lines.join("\n");
}

/** Build the markdown section. */
function markdownSection(name: string, section: BucketSection): string {
  if (!section.exists) {
    return `## ${name}\n\n_Directory missing: \`${section.path}\`_\n`;
  }
  const head = [
    `## ${name}`,
    ``,
    `- Path: \`${section.path}\``,
    `- Entries: ${section.totalEntries}`,
    `- Freshness: ${section.bands.fresh} fresh / ${section.bands.aging} aging / ${section.bands.stale} stale / ${section.bands.unknown} unknown`,
    `- Refs: ${section.totalStaleRefs} stale, ${section.totalInvalidLineRefs} invalid-line`,
    ``,
  ];
  if (section.buckets.length === 0) return head.join("\n");
  const rows = section.buckets.map(
    (bucket) =>
      `| ${basename(bucket.path)} | ${bucket.lastReviewed ?? "-"} | ${formatDays(bucket.freshnessDays)} | ${bucket.freshnessBand} | ${bucket.entryCount} | ${bucket.staleRefs.length} | ${bucket.invalidLineRefs.length} |`,
  );
  return [
    ...head,
    `| File | last_reviewed | age | band | entries | stale refs | invalid-line refs |`,
    `| --- | --- | --- | --- | ---: | ---: | ---: |`,
    ...rows,
    ``,
  ].join("\n");
}

/** Render a `--check` verdict as text suitable for CI logs. */
export function renderStatsCheckText(check: StatsCheckReport): string {
  if (check.status === "pass") return renderStatsCheckPass(check);
  return renderStatsCheckFailure(check);
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function warningSuffix(check: StatsCheckReport): string {
  return check.warnings.length > 0
    ? ` (${plural(check.warnings.length, "warning")})`
    : "";
}

function renderStatsCheckPass(check: StatsCheckReport): string {
  if (check.warnings.length === 0) return "stats --check: PASS\n";
  return [
    `stats --check: PASS${warningSuffix(check)}`,
    ...check.warnings.map((w) => `  - [${w.rule}] ${w.message}`),
    "",
  ].join("\n");
}

function renderStatsCheckFailure(check: StatsCheckReport): string {
  const lines = [
    `stats --check: FAIL (${plural(check.findings.length, "finding")}${check.warnings.length > 0 ? `, ${plural(check.warnings.length, "warning")}` : ""})`,
  ];
  for (const f of check.findings) {
    lines.push(`  - [${f.rule}] ${f.message}`);
  }
  for (const w of check.warnings) {
    lines.push(`  - [${w.rule}] ${w.message}`);
  }
  const hasFrontmatterFindings = check.findings.some(
    (f) =>
      f.rule === "missing-last-reviewed" || f.rule === "invalid-last-reviewed",
  );
  if (hasFrontmatterFindings) {
    lines.push(
      "  Fix: bash scripts/maintenance/fix-bucket-frontmatter.sh [--dry-run]",
    );
  }
  return lines.join("\n") + "\n";
}
