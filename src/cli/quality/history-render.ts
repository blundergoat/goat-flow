/**
 * Renders the tables a user sees from `goat-flow quality history` and `quality diff`.
 *
 * History answers "how has this project's quality moved over time"; diff answers "what actually changed between these two runs".
 *
 * First-run cells stay blank rather than showing a zero delta, because a fabricated "no change" reads as a real measurement.
 */
import type { AgentId } from "../types.js";
import type { QualityMode } from "./schema.js";
import type {
  QualityDiffFindingRow,
  QualityDiffResult,
  QualityHistoryRow,
} from "./history.js";

/** Format a score delta for the compact history table, keeping first-run cells blank. */
function formatDelta(delta: number | null): string {
  if (delta === null) return "";
  if (delta > 0) return ` (+${delta})`;
  if (delta < 0) return ` (${delta})`;
  return " (+0)";
}

/**
 * Render quality-history rows for CLI text output.
 *
 * @param rows - Rows returned by `buildQualityHistoryRows`.
 * @param options - Active filters used to render empty-state and limit hints.
 * @returns Markdown-like text table for terminal output.
 */
export function renderQualityHistoryText(
  rows: QualityHistoryRow[],
  options: {
    agent: AgentId | null;
    qualityMode: QualityMode | null;
    includeAll: boolean;
  },
): string {
  if (rows.length === 0) {
    const scope = options.agent ? ` for ${options.agent}` : "";
    const modeScope = options.qualityMode
      ? ` in ${options.qualityMode} mode`
      : "";
    return [
      `No saved quality history${scope}${modeScope}.`,
      "Generate a prompt with `goat-flow quality . --agent <id>`; the agent writes its report directly to `.goat-flow/logs/quality/`.",
    ].join("\n");
  }

  const lines = [
    "date | agent | mode | setup_total | system_total | blocker | major | minor",
  ];
  for (const row of rows) {
    lines.push(
      [
        row.date,
        row.agent,
        row.qualityMode,
        `${row.setupTotal}${formatDelta(row.setupDelta)}`,
        String(row.systemTotal),
        String(row.blockerCount),
        String(row.majorCount),
        String(row.minorCount),
      ].join(" | "),
    );
  }
  if (!options.includeAll) {
    lines.push("");
    lines.push(
      "Use `--all` to lift the 20-run default. Diff ids are saved report basenames under `.goat-flow/logs/quality/`.",
    );
  }
  return lines.join("\n");
}

/**
 * Render a quality diff for CLI text output.
 * Use when a user compares two saved quality reports and needs lifecycle buckets in terminal output.
 *
 * The four fixed sections mirror the lifecycle buckets because saved-report diffs are scanned by humans and shell output, not just JSON clients.
 *
 * The absent section carries an inline caveat whenever it has rows.
 * Readers previously took that bucket as a fixed-issue list and closed remediation on the count, so the warning belongs next to the rows rather than
 * in documentation.
 *
 * @param diff - diff returned by `buildQualityDiff`; empty buckets render as `(none)` so users see no hidden rows
 * @returns human-readable diff grouped by finding lifecycle for CLI review. It section order must match absent, new, persisted, then stuck
 *   findings.
 */
export function renderQualityDiffText(diff: QualityDiffResult): string {
  const header = `Setup ${diff.from.report.scores.setup.total}/100 → ${diff.to.report.scores.setup.total}/100 (${diff.setupDelta >= 0 ? `+${diff.setupDelta}` : diff.setupDelta}). System ${diff.from.report.scores.system.total}/100 → ${diff.to.report.scores.system.total}/100 (${diff.systemDelta >= 0 ? `+${diff.systemDelta}` : diff.systemDelta}).`;
  const lines = [header, ""];

  /** Render one labeled diff section, with an optional caveat shown only when rows exist. */
  const renderSection = (
    title: string,
    rows: QualityDiffFindingRow[],
    caveat?: string,
  ): void => {
    lines.push(`${title} (${rows.length})`);
    if (rows.length > 0 && caveat !== undefined) lines.push(caveat);
    for (const row of rows) {
      lines.push(`${row.id} | ${row.severity} | ${row.type} | ${row.summary}`);
    }
    if (rows.length === 0) lines.push("(none)");
    lines.push("");
  };

  renderSection(
    "Absent from newer report",
    diff.absent,
    "Not proof of a fix: a finding also lands here when the newer run never checked that artifact, or when its id shifted. Re-read each cited file before closing anything.",
  );
  renderSection("New", diff.newFindings);
  renderSection("Persisted", diff.persisted);
  renderSection("Stuck", diff.stuck);

  // Agent-vs-deterministic contradictions only render when present - most
  // diffs agree, and an always-on empty section would bury the real four.
  if (diff.deltaTagDisagreements.length > 0) {
    lines.push(
      `Delta-tag disagreements (${diff.deltaTagDisagreements.length}) - agent's claimed delta_tag vs the deterministic id diff:`,
    );
    for (const row of diff.deltaTagDisagreements) {
      lines.push(
        `${row.id} | ${row.severity} | agent said "${row.agentTag}", deterministic diff says "${row.deterministic}" | ${row.summary}`,
      );
    }
    lines.push(
      "Positional finding ids stay the source of truth; treat disagreements as a methodology signal about the agent's continuity claims.",
    );
    lines.push("");
  }

  lines.push(
    "Stuck counter resets on history gaps. For strict persistence tracking, ensure at least one quality run lands within every 30-day window.",
  );
  return lines.join("\n");
}
