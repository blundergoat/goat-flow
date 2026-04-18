/**
 * Output renderers for `goat-flow stats` — text, JSON, markdown.
 * Text is the default for terminals; JSON/markdown are for CI and PR comments.
 */
import type {
  BucketSection,
  StatsCheckReport,
  StatsReport,
} from "./stats.js";

const BAND_LABEL: Record<string, string> = {
  fresh: "fresh",
  aging: "aging",
  stale: "stale",
  unknown: "unknown",
};

function formatDays(days: number | null): string {
  return days === null ? "—" : `${days}d`;
}

function padRight(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

function renderSectionText(name: string, section: BucketSection): string {
  if (!section.exists) {
    return `${name} (${section.path}) — directory missing\n`;
  }

  const header = `${name} (${section.path}) — ${section.buckets.length} bucket(s), ${section.totalEntries} entrie(s)`;
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
    const last = bucket.lastReviewed ?? "—";
    const days = formatDays(bucket.freshnessDays);
    const band = BAND_LABEL[bucket.freshnessBand] ?? bucket.freshnessBand;
    const refs = `${bucket.staleRefs.length}s/${bucket.invalidLineRefs.length}i`;
    return `  ${padRight(display, nameWidth)}  last=${last}  age=${padRight(days, 6)}  band=${padRight(band, 7)}  entries=${bucket.entryCount}  refs=${refs}`;
  });
  return [header, summary, ...lines, ""].join("\n");
}

function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

/** Render the stats report as human-readable text. */
export function renderStatsText(report: StatsReport): string {
  return (
    renderSectionText("Footguns", report.footguns) +
    "\n" +
    renderSectionText("Lessons", report.lessons)
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
  ];
  return ["# Learning-loop stats", "", ...sections].join("\n");
}

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
      `| ${basename(bucket.path)} | ${bucket.lastReviewed ?? "—"} | ${formatDays(bucket.freshnessDays)} | ${bucket.freshnessBand} | ${bucket.entryCount} | ${bucket.staleRefs.length} | ${bucket.invalidLineRefs.length} |`,
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
  if (check.status === "pass") return "stats --check: PASS\n";
  const lines = [
    `stats --check: FAIL (${check.findings.length} finding${check.findings.length === 1 ? "" : "s"})`,
  ];
  for (const f of check.findings) {
    lines.push(`  - [${f.rule}] ${f.message}`);
  }
  return lines.join("\n") + "\n";
}
