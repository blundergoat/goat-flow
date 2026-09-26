/**
 * Compare saved quality runs so maintainers can inspect score changes, recurring findings, and missing evidence.
 *
 * Positional finding IDs group new, absent, persisted, and stuck issues; disappearance alone never proves a repair.
 *
 * Recorded workspace and grounding differences explain the limits behind comparisons without changing the saved scores.
 */
import type { AgentId } from "../types.js";
import type {
  QualityMode,
  SavedQualityFinding,
  SavedQualityReport,
} from "./schema.js";
import {
  entryQualityMode,
  matchesQualityMode,
  type QualityDeltaTagDisagreementRow,
  type QualityDiffFindingRow,
  type QualityDiffResult,
  type QualityHistoryEntry,
} from "./history.js";
import { isRealCalendarDate } from "./schema-parser.js";

/**
 * Rank a finding severity for user-facing sort order.
 * Use so blocker findings appear before major and minor findings in diff sections.
 *
 * @param severity - finding severity; missing/unknown severities cannot reach this helper after schema parsing
 * @returns numeric rank; lower numbers appear first in the CLI/dashboard lists
 */
function severityRank(severity: SavedQualityFinding["severity"]): number {
  // Blockers are the highest user-facing priority.
  if (severity === "BLOCKER") return 0;
  // Major findings come after blockers but before minor cleanup.
  if (severity === "MAJOR") return 1;
  return 2;
}

/**
 * Return the whole-day gap between two quality run dates.
 * Use when deciding whether a finding is stuck across consecutive recent runs.
 *
 * @param newerDate - newer run date in YYYY-MM-DD; empty/invalid values produce an invalid date gap
 * @param olderDate - older run date in YYYY-MM-DD; empty/invalid values produce an invalid date gap
 * @returns whole-day gap, or `null` when either date cannot prove continuity
 */
function daysBetween(newerDate: string, olderDate: string): number | null {
  // Invalid legacy dates stay loadable but cannot make a finding look continuously stuck.
  if (!isRealCalendarDate(newerDate) || !isRealCalendarDate(olderDate)) {
    return null;
  }
  const newer = new Date(`${newerDate}T00:00:00Z`);
  const older = new Date(`${olderDate}T00:00:00Z`);
  return Math.round((newer.getTime() - older.getTime()) / 86_400_000);
}

/**
 * Compare diff rows by severity and stable finding id.
 * Use so every diff bucket renders in a predictable order.
 *
 * @param left - first visible diff row; empty ids sort before later ids only after severity ties
 * @param right - second visible diff row; empty ids sort before later ids only after severity ties
 * @returns sort result for diff buckets
 */
function diffRowSort(
  left: QualityDiffFindingRow,
  right: QualityDiffFindingRow,
): number {
  const severityDiff =
    severityRank(left.severity) - severityRank(right.severity);
  // Different severities sort by the priority the user should read first.
  if (severityDiff !== 0) return severityDiff;
  return left.id.localeCompare(right.id);
}

/**
 * Build a finding map keyed by stable finding id.
 * Use when comparing two reports into absent/new/persisted buckets.
 *
 * @param report - saved quality report; empty findings produce an empty map
 * @returns finding map; empty map means this report has no visible findings
 */
function getFindingMap(
  report: SavedQualityReport,
): Map<string, SavedQualityFinding> {
  return new Map(report.findings.map((finding) => [finding.id, finding]));
}

/**
 * Count consecutive recent runs that still contain one finding.
 * Use to flag stuck blocker/major findings in quality diffs.
 *
 * @param entries - all sorted history entries; empty entries mean no continuity can be proven
 * @param currentEntry - target run; missing from entries means the finding is counted zero times
 * @param findingId - stable finding id; empty id will not match normal finding ids
 * @returns consecutive presence count; zero means the finding is not present in the current sequence
 */
function countConsecutivePresence(
  entries: QualityHistoryEntry[],
  currentEntry: QualityHistoryEntry,
  findingId: string,
): number {
  const currentMode = entryQualityMode(currentEntry);
  const sameAgent = entries.filter(
    (entry) =>
      entry.agent === currentEntry.agent &&
      entryQualityMode(entry) === currentMode,
  );
  const currentIndex = sameAgent.findIndex(
    (entry) => entry.id === currentEntry.id,
  );
  // If the current run is not in the comparable list, continuity cannot be proven.
  if (currentIndex === -1) return 0;

  let count = 0;
  let previousEntry: QualityHistoryEntry | undefined;
  // Walk older same-agent/same-mode runs until the finding disappears or history becomes stale.
  for (let index = currentIndex; index < sameAgent.length; index += 1) {
    const entry = sameAgent[index];
    // Defensive guard for sparse arrays keeps the count bounded.
    if (entry === undefined) break;
    // Long gaps mean the user should not treat this as continuous unresolved work.
    if (previousEntry !== undefined) {
      const dayGap = daysBetween(
        previousEntry.report.run_date,
        entry.report.run_date,
      );
      // Invalid, reversed, or stale dates cannot prove consecutive unresolved work.
      if (dayGap === null || dayGap < 0 || dayGap > 30) {
        break;
      }
    }
    const hasFinding = entry.report.findings.some(
      (finding) => finding.id === findingId,
    );
    // The streak stops when the finding no longer appears in an older run.
    if (!hasFinding) break;
    count += 1;
    previousEntry = entry;
  }
  return count;
}

/** The two runs a diff compares, oldest first. */
interface DiffPair {
  sourceEntry: QualityHistoryEntry;
  targetEntry: QualityHistoryEntry;
}

/** A resolved pair, or the reason the user's request cannot be compared. */
type DiffPairResult =
  { ok: true; pair: DiffPair } | { ok: false; error: string };

/**
 * Confirm that a report retained both snapshot identifiers before the diff tries to compare their bytes.
 * Use for optional historical provenance; false means snapshot evidence is missing, not that the workspace changed.
 *
 * @param snapshot - assessor-copied start/end identifiers; missing or null values provide no comparison evidence
 * @returns whether both identifiers are available for a comparison
 */
function hasCompleteWorkspaceSnapshot(
  snapshot: NonNullable<
    SavedQualityReport["assessment_context"]
  >["workspace_snapshot"],
): snapshot is { start: string; end: string } {
  return (
    typeof snapshot?.start === "string" && typeof snapshot.end === "string"
  );
}

/**
 * Explain whether two recorded workspace snapshots can support a byte-state comparison.
 * Use for report diffs; null captures stay unknown and changing snapshots never imply a completed comparison.
 *
 * @param olderContext - previous report provenance; omitted snapshot means no byte-state evidence was retained
 * @param newerContext - later report provenance; omitted snapshot has the same unknown meaning
 * @returns one workspace caveat, or null when both reports record the same stable snapshot
 */
function workspaceComparisonWarning(
  olderContext: NonNullable<SavedQualityReport["assessment_context"]>,
  newerContext: NonNullable<SavedQualityReport["assessment_context"]>,
): string | null {
  const olderSnapshot = olderContext.workspace_snapshot;
  const newerSnapshot = newerContext.workspace_snapshot;
  // A HEAD revision and a dirty flag cannot distinguish edits made during or between two assessments.
  if (
    !hasCompleteWorkspaceSnapshot(olderSnapshot) ||
    !hasCompleteWorkspaceSnapshot(newerSnapshot)
  ) {
    return "Workspace snapshot evidence is unavailable; matching revisions alone do not establish matching working-tree bytes.";
    // Changes during one assessment can mix evidence from before and after a concurrent edit.
  } else if (
    olderSnapshot.start !== olderSnapshot.end ||
    newerSnapshot.start !== newerSnapshot.end
  ) {
    return "Workspace bytes changed during an assessment; recheck affected findings before acting on this comparison.";
    // Different stable captures describe a before/after project comparison, not identical input for two assessors.
  } else if (olderSnapshot.end !== newerSnapshot.end) {
    return "Workspace snapshots differ between reports; this is a comparison of different repository states.";
  }
  return null;
}

/**
 * Explain evidence limits when a user compares two reports, while preserving the original scores and finding buckets.
 * Use after selecting the same agent and mode; matching snapshots still do not prove identical assessor coverage.
 *
 * @param olderReport - previous assessment; missing context means its workspace and coverage were not recorded
 * @param newerReport - subsequent assessment; empty findings never prove an earlier defect was repaired
 * @returns visible comparison caveats; an empty array means no recorded provenance difference was found
 */
function assessmentComparisonWarnings(
  olderReport: SavedQualityReport,
  newerReport: SavedQualityReport,
): string[] {
  const warnings: string[] = [];
  // A new rubric or project scope changes what a score means, even when both runs used the same agent.
  const targetFields = ["rubric_version", "scope", "project_path"] as const;
  // A changed rubric or project scope prevents the score delta from measuring the same target.
  if (targetFields.some((field) => olderReport[field] !== newerReport[field])) {
    warnings.push(
      "Assessment rubric, scope, or project differs; score deltas do not measure the same assessment target.",
    );
  }
  const olderContext = olderReport.assessment_context;
  const newerContext = newerReport.assessment_context;
  // Historical reports remain visible, but missing provenance cannot establish comparable evidence.
  if (!olderContext || !newerContext) {
    warnings.push(
      "Assessment provenance is unavailable for at least one report; comparison confidence is unknown.",
    );
    return warnings;
  }
  // For example, a report before a repair and one after it describe different repository revisions.
  if (olderContext.project_revision !== newerContext.project_revision) {
    warnings.push(
      "Repository revisions differ; score changes alone cannot identify which change affected quality.",
    );
  }
  // Skipped checks can hide defects in either report, so a higher score is not proof of better coverage.
  if (
    olderContext.grounding_status !== "complete" ||
    newerContext.grounding_status !== "complete"
  ) {
    warnings.push(
      "At least one assessment has incomplete grounding; inspect its unverified probes before interpreting score changes.",
    );
  }
  const workspaceWarning = workspaceComparisonWarning(
    olderContext,
    newerContext,
  );
  // Snapshot differences add context to the delta without changing its numeric value.
  if (workspaceWarning) warnings.push(workspaceWarning);
  return warnings;
}

/**
 * Explain why two named runs cannot be diffed, or confirm that they can.
 *
 * Two rejections protect the meaning of the diff itself: runs from different agents, or different quality modes, measure different things, so
 * comparing them would look informative while saying nothing.
 *
 * @param sourceEntry - the older run
 * @param targetEntry - the newer run
 * @param agent - the `--agent` filter, when supplied
 * @param qualityMode - the `--mode` filter, or null when unscoped
 * @returns the reason the pair cannot be compared, or null when it can. The other two rejections protect the user's intent: a pair contradicting
 *   `--agent` or `--mode` is refused rather than silently honouring one input.
 */
function describeIncomparablePair(
  sourceEntry: QualityHistoryEntry,
  targetEntry: QualityHistoryEntry,
  agent: AgentId | null,
  qualityMode: QualityMode | null,
): string | null {
  // Cross-agent diffs are rejected because runner outputs are not comparable.
  if (sourceEntry.agent !== targetEntry.agent) {
    return "quality diff rejects cross-agent comparisons";
  }
  // Agent filters must agree with the explicit pair so CLI flags do not mislead the user.
  if (agent && sourceEntry.agent !== agent) {
    return `quality diff pair does not match --agent ${agent}`;
  }
  // Cross-mode diffs are rejected because setup and system reviews measure different workflows.
  if (entryQualityMode(sourceEntry) !== entryQualityMode(targetEntry)) {
    return "quality diff rejects cross-mode comparisons";
  }
  // Mode filters must agree with both explicit ids.
  if (
    qualityMode !== null &&
    (entryQualityMode(sourceEntry) !== qualityMode ||
      entryQualityMode(targetEntry) !== qualityMode)
  ) {
    return `quality diff pair does not match --mode ${qualityMode}`;
  }
  return null;
}

/**
 * Resolve the two runs named by an explicit `<from-id>:<to-id>` pair.
 *
 * Every rejection here protects a comparison the user would misread: runs from different agents or different quality modes measure different things,
 * so a diff between them would look meaningful while comparing nothing.
 *
 * @param entries - all saved history entries
 * @param pair - the raw pair text as typed
 * @param agent - the `--agent` filter, when the user supplied one
 * @param qualityMode - the `--mode` filter, or null when the user did not scope by mode
 * @returns the resolved pair, or the reason it cannot be compared. A pair contradicting `--agent` or `--mode` is refused too, because silently
 *   honouring one over the other would show a diff the user did not ask for.
 */
function resolveExplicitDiffPair(
  entries: QualityHistoryEntry[],
  pair: string,
  agent: AgentId | null,
  qualityMode: QualityMode | null,
): DiffPairResult {
  const [fromId, toId, ...rest] = pair.split(":");
  // Pair ids must be two report ids separated by one colon.
  if (!fromId || !toId || rest.length > 0) {
    return {
      ok: false,
      error: "quality diff pair must be in the form <from-id>:<to-id>",
    };
  }
  const sourceEntry = entries.find((entry) => entry.id === fromId);
  const targetEntry = entries.find((entry) => entry.id === toId);
  // Both ids must refer to saved reports the user can inspect.
  if (!sourceEntry || !targetEntry) {
    return {
      ok: false,
      error: "quality diff pair must reference existing saved report ids",
    };
  }
  const incomparable = describeIncomparablePair(
    sourceEntry,
    targetEntry,
    agent,
    qualityMode,
  );
  // A mismatched agent or mode explains why the requested pair cannot be compared.
  if (incomparable) return { ok: false, error: incomparable };
  return { ok: true, pair: { sourceEntry, targetEntry } };
}

/**
 * Resolve the two most recent matching runs when the user named no explicit pair.
 *
 * An agent is required here, because "the latest two" is otherwise ambiguous across runners and comparing a Claude run to a Codex one would be
 * meaningless.
 *
 * @param entries - all saved history entries, newest first
 * @param agent - the `--agent` filter; required for this path
 * @param qualityMode - the `--mode` filter, or null to accept any single mode
 * @returns the resolved pair, or the reason it cannot be compared. With no mode filter and two newest runs in different modes, the user is asked to
 *   scope rather than shown a cross-mode diff by accident.
 */
function resolveLatestDiffPair(
  entries: QualityHistoryEntry[],
  agent: AgentId | null,
  qualityMode: QualityMode | null,
): DiffPairResult {
  // Without explicit ids, the user must choose an agent so "latest two" is unambiguous.
  if (!agent) {
    return {
      ok: false,
      error: "quality diff without explicit ids requires --agent",
    };
  }
  const sameAgent = entries.filter(
    (entry) => entry.agent === agent && matchesQualityMode(entry, qualityMode),
  );
  // At least two matching runs are required to show before/after changes.
  if (sameAgent.length < 2) {
    const modeScope = qualityMode === null ? "" : ` in ${qualityMode} mode`;
    return {
      ok: false,
      error: `Not enough saved quality reports for ${agent}${modeScope}. Need at least 2 runs.`,
    };
  }
  const targetEntry = sameAgent[0];
  const sourceEntry = sameAgent[1];
  // Defensive guard keeps a sparse list from producing an undefined comparison.
  if (!targetEntry || !sourceEntry) {
    return {
      ok: false,
      error: "quality diff could not resolve the requested report pair",
    };
  }
  // If all modes are allowed but the newest two differ, ask the user to scope the comparison.
  if (
    qualityMode === null &&
    entryQualityMode(sourceEntry) !== entryQualityMode(targetEntry)
  ) {
    return {
      ok: false,
      error: `quality diff would compare ${entryQualityMode(sourceEntry)} to ${entryQualityMode(targetEntry)}. Pass --mode to diff one quality mode, or pass explicit same-mode report ids.`,
    };
  }
  return { ok: true, pair: { sourceEntry, targetEntry } };
}

/**
 * Compare two saved runs; the comparison contract requires the same agent and quality mode.
 * Use to inspect score deltas and finding lifecycles; disappearance alone is not proof that a defect was repaired.
 *
 * @param entries - sorted quality-history entries; an empty list cannot produce a diff
 * @param options - agent, explicit pair, and mode filters; no pair means the latest two matching runs
 * @returns the diff, or a user-facing error explaining why the comparison is not possible
 */
export function buildQualityDiff(
  entries: QualityHistoryEntry[],
  options: {
    agent: AgentId | null;
    pair: string | null;
    qualityMode?: QualityMode | null;
  },
): { ok: true; diff: QualityDiffResult } | { ok: false; error: string } {
  const qualityMode = options.qualityMode ?? null;
  const resolved = options.pair
    ? resolveExplicitDiffPair(entries, options.pair, options.agent, qualityMode)
    : resolveLatestDiffPair(entries, options.agent, qualityMode);
  // Without a valid pair of saved runs, there is no comparison to display.
  if (!resolved.ok) return resolved;
  const { sourceEntry, targetEntry } = resolved.pair;

  const fromMap = getFindingMap(sourceEntry.report);
  const toMap = getFindingMap(targetEntry.report);

  // Absent findings existed before and are missing from the newer report. Missing
  // is not fixed: an unexamined artifact and a shifted line-based id land here too.
  const absent = [...fromMap.values()]
    .filter((finding) => !toMap.has(finding.id))
    .map((finding) => ({
      id: finding.id,
      severity: finding.severity,
      type: finding.type,
      summary: finding.summary,
    }))
    .sort(diffRowSort);

  // Persisted findings still appear in the newer report.
  const persisted = [...toMap.values()]
    .filter((finding) => fromMap.has(finding.id))
    .map((finding) => ({
      id: finding.id,
      severity: finding.severity,
      type: finding.type,
      summary: finding.summary,
    }))
    .sort(diffRowSort);

  // New findings appear in the newer report but not the older one.
  const newFindings = [...toMap.values()]
    .filter((finding) => !fromMap.has(finding.id))
    .map((finding) => ({
      id: finding.id,
      severity: finding.severity,
      type: finding.type,
      summary: finding.summary,
    }))
    .sort(diffRowSort);

  // Stuck findings are serious issues that have persisted across recent runs.
  const stuck = persisted
    .filter((finding) => {
      // Only blocker/major findings are highlighted as stuck work.
      if (!["BLOCKER", "MAJOR"].includes(finding.severity)) return false;
      return countConsecutivePresence(entries, targetEntry, finding.id) >= 3;
    })
    .sort(diffRowSort);

  // Agent delta tags are comparable only against the baseline the agent used.
  const baselineMatches = targetEntry.report.prior_report_id === sourceEntry.id;
  const deltaTagDisagreements: QualityDeltaTagDisagreementRow[] =
    // If the user picked a different baseline, hide tag disagreements as irrelevant noise.
    !baselineMatches
      ? []
      : [...toMap.values()]
          .flatMap((finding) => {
            // Findings without agent delta tags have no self-reported comparison to check.
            if (
              finding.delta_tag !== "new" &&
              finding.delta_tag !== "persisted"
            ) {
              return [];
            }
            const deterministic = fromMap.has(finding.id)
              ? ("persisted" as const)
              : ("new" as const);
            // Matching tags need no methodology warning in the diff output.
            if (finding.delta_tag === deterministic) return [];
            return [
              {
                id: finding.id,
                severity: finding.severity,
                type: finding.type,
                summary: finding.summary,
                agentTag: finding.delta_tag,
                deterministic,
              },
            ];
          })
          .sort(diffRowSort);

  return {
    ok: true,
    diff: {
      from: sourceEntry,
      to: targetEntry,
      comparisonWarnings: assessmentComparisonWarnings(
        sourceEntry.report,
        targetEntry.report,
      ),
      setupDelta:
        targetEntry.report.scores.setup.total -
        sourceEntry.report.scores.setup.total,
      systemDelta:
        targetEntry.report.scores.system.total -
        sourceEntry.report.scores.system.total,
      absent,
      newFindings,
      persisted,
      stuck,
      deltaTagDisagreements,
    },
  };
}
