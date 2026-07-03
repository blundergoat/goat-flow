/**
 * Terminal renderers for quality history and diff output.
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
 *
 * The four fixed sections mirror the lifecycle buckets because saved-report
 * diffs are scanned by humans and shell output, not just JSON clients.
 *
 * @param diff - Diff returned by `buildQualityDiff`.
 * @returns Human-readable diff grouped by finding lifecycle.
 */
export function renderQualityDiffText(diff: QualityDiffResult): string {
  const header = `Setup ${diff.from.report.scores.setup.total}/100 → ${diff.to.report.scores.setup.total}/100 (${diff.setupDelta >= 0 ? `+${diff.setupDelta}` : diff.setupDelta}). System ${diff.from.report.scores.system.total}/100 → ${diff.to.report.scores.system.total}/100 (${diff.systemDelta >= 0 ? `+${diff.systemDelta}` : diff.systemDelta}).`;
  const lines = [header, ""];

  /** Render one labeled diff section. */
  const renderSection = (
    title: string,
    rows: QualityDiffFindingRow[],
  ): void => {
    lines.push(`${title} (${rows.length})`);
    for (const row of rows) {
      lines.push(`${row.id} | ${row.severity} | ${row.type} | ${row.summary}`);
    }
    if (rows.length === 0) lines.push("(none)");
    lines.push("");
  };

  renderSection("Resolved", diff.resolved);
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
