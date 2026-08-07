/**
 * Compares two saved quality runs so a user can see what actually changed between them.
 * Answering "did this get better" means more than two scores: it means naming the findings
 * that appeared, the ones that were resolved, the ones still present, and how long the
 * stubborn ones have been outstanding.
 *
 * Findings are matched by their attached ids rather than by wording, because an agent
 * rephrasing the same problem between runs must not read as "one fixed, one new". A finding
 * that has survived several consecutive runs is counted and surfaced, since a persistent
 * finding is the signal a user most needs and the easiest one to lose in a diff.
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
 * Use when comparing two reports into resolved/new/persisted buckets.
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

/**
 * Build the diff between two comparable quality-history runs.
 * Use when the user asks what was resolved, introduced, persisted, or stuck between runs.
 *
 * @param entries - sorted quality-history entries; empty entries cannot produce a diff
 * @param options - agent, explicit pair, and mode filters; missing pair uses latest two matching runs
 * @returns diff result, or a user-facing error explaining why comparison is not possible
 */
// eslint-disable-next-line complexity -- intentional because diff selection branches on implicit latest-vs-explicit pair resolution and validation before the shared comparison path.
export function buildQualityDiff(
  entries: QualityHistoryEntry[],
  options: {
    agent: AgentId | null;
    pair: string | null;
    qualityMode?: QualityMode | null;
  },
): { ok: true; diff: QualityDiffResult } | { ok: false; error: string } {
  const qualityMode = options.qualityMode ?? null;
  let sourceEntry: QualityHistoryEntry | undefined;
  let targetEntry: QualityHistoryEntry | undefined;

  // Explicit pairs let the user compare two chosen saved runs by id.
  if (options.pair) {
    const [fromId, toId, ...rest] = options.pair.split(":");
    // Pair ids must be two report ids separated by one colon.
    if (!fromId || !toId || rest.length > 0) {
      return {
        ok: false,
        error: "quality diff pair must be in the form <from-id>:<to-id>",
      };
    }
    sourceEntry = entries.find((entry) => entry.id === fromId);
    targetEntry = entries.find((entry) => entry.id === toId);
    // Both ids must refer to saved reports the user can inspect.
    if (!sourceEntry || !targetEntry) {
      return {
        ok: false,
        error: "quality diff pair must reference existing saved report ids",
      };
    }
    // Cross-agent diffs are rejected because runner outputs are not comparable.
    if (sourceEntry.agent !== targetEntry.agent) {
      return {
        ok: false,
        error: "quality diff rejects cross-agent comparisons",
      };
    }
    // Agent filters must agree with the explicit pair so CLI flags do not mislead the user.
    if (options.agent && sourceEntry.agent !== options.agent) {
      return {
        ok: false,
        error: `quality diff pair does not match --agent ${options.agent}`,
      };
    }
    // Cross-mode diffs are rejected because setup and system reviews measure different workflows.
    if (entryQualityMode(sourceEntry) !== entryQualityMode(targetEntry)) {
      return {
        ok: false,
        error: "quality diff rejects cross-mode comparisons",
      };
    }
    // Mode filters must agree with both explicit ids.
    if (
      qualityMode !== null &&
      (entryQualityMode(sourceEntry) !== qualityMode ||
        entryQualityMode(targetEntry) !== qualityMode)
    ) {
      return {
        ok: false,
        error: `quality diff pair does not match --mode ${qualityMode}`,
      };
    }
  } else {
    // Without explicit ids, the user must choose an agent so "latest two" is unambiguous.
    if (!options.agent) {
      return {
        ok: false,
        error: "quality diff without explicit ids requires --agent",
      };
    }
    const sameAgent = entries.filter(
      (entry) =>
        entry.agent === options.agent && matchesQualityMode(entry, qualityMode),
    );
    // At least two matching runs are required to show before/after changes.
    if (sameAgent.length < 2) {
      const modeScope = qualityMode === null ? "" : ` in ${qualityMode} mode`;
      return {
        ok: false,
        error: `Not enough saved quality reports for ${options.agent}${modeScope}. Need at least 2 runs.`,
      };
    }
    const latest = sameAgent[0];
    const previous = sameAgent[1];
    // Defensive guard keeps a sparse list from producing an undefined comparison.
    if (!latest || !previous) {
      return {
        ok: false,
        error: "quality diff could not resolve the requested report pair",
      };
    }
    targetEntry = latest;
    sourceEntry = previous;
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
  }

  const fromMap = getFindingMap(sourceEntry.report);
  const toMap = getFindingMap(targetEntry.report);

  // Resolved findings existed before and are absent from the newer report.
  const resolved = [...fromMap.values()]
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
      setupDelta:
        targetEntry.report.scores.setup.total -
        sourceEntry.report.scores.setup.total,
      systemDelta:
        targetEntry.report.scores.system.total -
        sourceEntry.report.scores.system.total,
      resolved,
      newFindings,
      persisted,
      stuck,
      deltaTagDisagreements,
    },
  };
}
