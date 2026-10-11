/**
 * Renders the tables a user sees from `goat-flow quality history` and `quality diff`.
 *
 * History answers "how has this project's quality moved over time"; diff answers "what actually changed between these two runs".
 *
 * First-run cells stay blank rather than showing a zero delta, because a fabricated "no change" reads as a real measurement.
 */
import type { AgentId } from "../types.js";
import type { QualityMode } from "./schema.js";
import type { QualityRepeatSpread } from "./repeat-spread.js";
import { countQualityConcerns, type QualityFixView } from "./fix-references.js";
import type {
  QualityDiffFindingRow,
  QualityDiffResult,
  QualityHistoryEntry,
  QualityHistoryRow,
} from "./history.js";
import {
  QUALITY_SETUP_SCORE_AXES,
  QUALITY_SYSTEM_SCORE_AXES,
  type QualityScoreAxisRationale,
  type QualityFixEvidence,
  type QualityFixTarget,
} from "./schema-types.js";

/**
 * Format a recorded score change for the compact history table.
 * Use when displaying a run; null leaves the cell blank because no earlier comparable score exists.
 *
 * @param delta - recorded score difference; null means no earlier comparable run exists
 * @returns a signed annotation, or an empty string for the first comparable run
 */
function formatDelta(delta: number | null): string {
  // No earlier comparable run exists, so the table leaves the delta blank.
  if (delta === null) return "";
  // A higher saved score receives a plus sign so the trend is easy to scan.
  if (delta > 0) return ` (+${delta})`;
  // A lower saved score retains its minus sign to show the drop.
  if (delta < 0) return ` (${delta})`;
  return " (+0)";
}

/** Show descriptive score variation without interpreting the adjacent change. */
function formatSpread(
  spread: QualityRepeatSpread | null | undefined,
  score: "setup" | "system",
): string {
  if (!spread) return "no comparable reruns";
  const values = spread[score];
  return `${spread.kind} reruns n=${spread.sampleSize}; median ${values.median}/100; range ${values.min}-${values.max}/100 (span ${values.range})`;
}

/**
 * Append each score axis beside the evidence and deduction recorded by its assessor.
 * Use after a history or diff summary; rendering preserves scores without recalculating them.
 *
 * @param lines - terminal output buffer receiving the axis rows
 * @param group - setup or system heading for this saved score group
 * @param axes - ordered rubric axes; an empty list appends no rows
 * @param scoreForAxis - reads the saved rating without changing it
 * @param rationale - validated explanations for every requested axis; missing rows cannot reach this renderer
 * @returns nothing; the supplied output buffer receives the original ratings and explanations
 */
function appendRationaleGroup<Axis extends string>(
  lines: string[],
  group: "setup" | "system",
  axes: readonly Axis[],
  scoreForAxis: (axis: Axis) => number,
  rationale: Record<Axis, QualityScoreAxisRationale>,
): void {
  // Show each recorded rating beside its original evidence and deduction.
  for (const axis of axes) {
    const row = rationale[axis];
    lines.push(
      `  ${group}.${axis} ${scoreForAxis(axis)}/25 | evidence: ${row.evidence} | deduction: ${row.deduction}`,
    );
  }
}

/**
 * Append a saved run's coverage, recommendations, and score explanations.
 * Use below history and diff summaries; absent legacy sections stay visibly unavailable.
 *
 * @param lines - terminal output buffer receiving this report's evidence and next steps
 * @param entry - saved run; missing legacy metadata remains unavailable instead of being inferred
 * @param label - identifies a history row or the older/newer side of a comparison
 * @returns nothing; the supplied buffer receives the report details
 */
function appendReportScoreRationale(
  lines: string[],
  entry: QualityHistoryEntry,
  label: "Report" | "From" | "To",
): void {
  lines.push(`${label} ${entry.id}`);
  appendConcernAndFixEvidence(lines, entry);
  const context = entry.report.assessment_context;
  // Show recorded coverage before the scores so the reader can assess their evidence limits.
  if (context) {
    lines.push(
      `  assessment: ${context.grounding_status}; confidence: ${context.score_confidence}; revision: ${context.project_revision ?? "unavailable"}; worktree: ${context.working_tree_state}`,
    );
    // Unverified checks explain the scope behind the confidence label rather than silently disappearing.
    for (const probe of context.unverified_probes)
      lines.push(`  unverified: ${probe}`);
  }
  const improvements = entry.report.improvements;
  // A missing section means an older report did not preserve recommendations; it does not mean none were proposed.
  if (improvements === undefined) {
    lines.push("  improvements unavailable (not recorded)");
  } else {
    // An explicitly empty list is the assessor's statement that no improvement was proposed in this run.
    if (improvements.length === 0) lines.push("  improvements: none proposed");
    // Recommendations keep their category so optional maintenance does not become a defect count.
    for (const improvement of improvements) {
      lines.push(
        `  improvement [${improvement.category}]: ${improvement.summary}`,
      );
      lines.push(`    action: ${improvement.action}`);
      lines.push(
        `    evidence: ${improvement.file ?? "project-wide"} | ${improvement.evidence}`,
      );
    }
  }
  const rationale = entry.report.score_rationale;
  // Older reports may lack score explanations; label the gap instead of inventing a rationale.
  if (rationale === undefined) {
    lines.push("  rationale unavailable (legacy report)");
    return;
  }
  appendRationaleGroup(
    lines,
    "setup",
    QUALITY_SETUP_SCORE_AXES,
    (axis) => entry.report.scores.setup[axis],
    rationale.setup,
  );
  appendRationaleGroup(
    lines,
    "system",
    QUALITY_SYSTEM_SCORE_AXES,
    (axis) => entry.report.scores.system[axis],
    rationale.system,
  );
}

/** Display report-local counts and attributed proof without treating absence as resolution. */
function appendConcernAndFixEvidence(
  lines: string[],
  entry: QualityHistoryEntry,
): void {
  const counts = entry.concernCounts ?? countQualityConcerns(entry.report);
  lines.push(
    `  reported findings by concern: ${Object.entries(counts)
      .map(([concern, count]) => `${concern} ${count}`)
      .join(", ")} (not all open defects)`,
  );
  if (entry.report.fixes === undefined) {
    lines.push("  fix evidence unavailable (not recorded)");
    return;
  }
  if (entry.report.fixes.length === 0)
    lines.push("  fix evidence: none recorded");
  for (const record of entry.fixRecords ?? []) appendFixRecord(lines, record);
}

/** Keep uncommitted evidence visibly separate from a fixing commit; a workspace snapshot shows its capture fingerprint. */
function fixTargetLabel(target: QualityFixTarget | null): string {
  if (!target) return "target unavailable";
  return target.kind === "commit"
    ? `committed ${target.revision}`
    : `workspace snapshot ${target.fingerprint}`;
}

/** Show the original method and result without executing or reinterpreting it. */
function appendFixEvidence(
  lines: string[],
  evidence: QualityFixEvidence | null,
): void {
  if (!evidence) return;
  lines.push(
    `    ${evidence.method}: ${evidence.file} (sha256 ${evidence.sha256}); ${evidence.summary}`,
  );
  if (evidence.anchor) lines.push(`    anchor: ${evidence.anchor}`);
  if (evidence.command)
    lines.push(
      `    recorded command: ${evidence.command}; exit ${evidence.exit_code ?? "unavailable"}`,
    );
}

/** Keep assessor attribution and current availability beside the immutable correction claim. */
function appendFixRecord(lines: string[], record: QualityFixView): void {
  const { fix } = record;
  lines.push(
    `  ${record.status}: ${fix.prior_report_id ?? "unknown report"}#${fix.finding_id ?? "unknown finding"} | ${fixTargetLabel(fix.target)}`,
  );
  lines.push(
    `    assessor: ${record.assessor.agent} in ${record.assessor.report_id}; original conclusion: ${fix.conclusion}`,
  );
  if (fix.explanation) lines.push(`    correction: ${fix.explanation}`);
  appendFixEvidence(lines, fix.evidence);
  if (record.warning) lines.push(`    ${record.warning}`);
}

/**
 * Render quality-history rows for CLI text output.
 *
 * @param rows - Rows returned by `buildQualityHistoryRows`.
 * @param options - Active filters, limit mode, and selected reports whose rationale rows follow the summary table.
 * @returns Markdown-like text table for terminal output.
 */
export function renderQualityHistoryText(
  rows: QualityHistoryRow[],
  options: {
    agent: AgentId | null;
    qualityMode: QualityMode | null;
    includeAll: boolean;
    entries: QualityHistoryEntry[];
  },
): string {
  // An empty filtered history gives the user a direct no-reports message.
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
  // Keep visible history rows in their already selected, newest-first order.
  for (const row of rows) {
    lines.push(
      [
        row.date,
        row.agent,
        row.qualityMode,
        `${row.setupTotal}${formatDelta(row.setupDelta)} [${formatSpread(row.repeatSpread, "setup")}]`,
        `${row.systemTotal}${formatDelta(row.systemDelta)} [${formatSpread(row.repeatSpread, "system")}]`,
        String(row.blockerCount),
        String(row.majorCount),
        String(row.minorCount),
      ].join(" | "),
    );
  }
  lines.push("");
  lines.push("Score rationale");
  // Show each selected report's evidence and recommendations after its summary row.
  for (const entry of options.entries) {
    appendReportScoreRationale(lines, entry, "Report");
  }
  // A limited history explains how the user can request every saved run.
  if (!options.includeAll) {
    lines.push("");
    lines.push(
      "Use `--all` to lift the 20-run default. Diff ids are saved report basenames under `.goat-flow/logs/quality/`.",
    );
  }
  return lines.join("\n");
}

/**
 * Collapse a saved finding summary onto one line before it joins a pipe-delimited diff row.
 * The schema keeps line breaks in summaries, so without this one summary could print a forged row beneath its own.
 *
 * @param summary - saved finding summary; tabs and line breaks become single spaces
 * @returns single-line summary text for the diff row
 */
function flattenSummary(summary: string): string {
  return summary.replace(/\s+/gu, " ").trim();
}

/**
 * Render the score evidence and finding changes between two saved runs in terminal text.
 * Use for quality diff; comparison limits and absent-finding caveats explain what the result can support.
 *
 * @param diff - diff returned by `buildQualityDiff`; empty buckets render as `(none)` so users see no hidden rows
 * @returns terminal text whose finding sections must appear in this order: absent, new, persisted, then stuck
 */
export function renderQualityDiffText(diff: QualityDiffResult): string {
  const header = `Setup ${diff.from.report.scores.setup.total}/100 → ${diff.to.report.scores.setup.total}/100 (${diff.setupDelta >= 0 ? `+${diff.setupDelta}` : diff.setupDelta}). System ${diff.from.report.scores.system.total}/100 → ${diff.to.report.scores.system.total}/100 (${diff.systemDelta >= 0 ? `+${diff.systemDelta}` : diff.systemDelta}).`;
  const lines = [header];
  appendDiffSpread(lines, diff);
  // Comparison warnings belong beside the deltas, before readers mistake score movement for proof of improvement.
  for (const warning of diff.comparisonWarnings ?? [])
    lines.push(`Comparison limit: ${warning}`);
  lines.push("", "Score rationale");
  appendReportScoreRationale(lines, diff.from, "From");
  appendReportScoreRationale(lines, diff.to, "To");
  lines.push("");

  /** Render one labeled diff section, with an optional caveat shown only when rows exist. */
  const renderSection = (
    title: string,
    rows: QualityDiffFindingRow[],
    caveat?: string,
  ): void => {
    lines.push(`${title} (${rows.length})`);
    // Explain an evidence limit only when the corresponding finding bucket contains rows.
    if (rows.length > 0 && caveat !== undefined) lines.push(caveat);
    // Render every finding in the selected lifecycle bucket without changing its classification.
    for (const row of rows) {
      lines.push(
        `${row.id} | ${row.severity} | ${row.type} | ${flattenSummary(row.summary)}`,
      );
    }
    // An empty bucket explicitly says none, so omission is not mistaken for missing output.
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

  // Semantic tags and exact-ID differences only render when present - most
  // diffs agree, and an always-on empty section would bury the real four.
  if (diff.deltaTagDisagreements.length > 0) {
    lines.push(
      `Assessor tags and exact-ID matches differ (${diff.deltaTagDisagreements.length}):`,
    );
    // Show each mismatch so the maintainer can recheck the assessor's continuity claim.
    for (const row of diff.deltaTagDisagreements) {
      lines.push(
        `${row.id} | ${row.severity} | assessor tagged "${row.agentTag}", exact-ID diff says "${row.deterministic}" | ${flattenSummary(row.summary)}`,
      );
    }
    lines.push(
      "Exact-ID classes describe matching report records, not semantic continuity. A rewritten summary or location can change the ID. Recheck the cited evidence before treating either classification as a fix or a new issue.",
    );
    lines.push("");
  }

  lines.push(
    "Stuck counter resets on history gaps. For strict persistence tracking, ensure at least one quality run lands within every 30-day window.",
  );
  return lines.join("\n");
}

/** Keep both groups beside the delta; they may describe different unchanged-input samples. */
function appendDiffSpread(lines: string[], diff: QualityDiffResult): void {
  for (const side of ["from", "to"] as const) {
    lines.push(
      `${side === "from" ? "From" : "To"} rerun spread: setup ${formatSpread(diff.repeatSpread?.[side], "setup")}; system ${formatSpread(diff.repeatSpread?.[side], "system")}`,
    );
  }
}
