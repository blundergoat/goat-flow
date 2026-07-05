/**
 * Load and compare persisted quality-report history.
 * Use when the CLI or dashboard shows previous quality runs, latest summaries, or before/after diffs.
 * Agent-written reports are non-blocking: malformed files become warnings while valid history stays visible.
 * Finding ids are attached at load time so users can compare runs without trusting agent-written ids.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentId } from "../types.js";
import type {
  QualityMode,
  SavedQualityFinding,
  SavedQualityReport,
} from "./schema.js";
import { parseQualityReport } from "./schema.js";
import { attachFindingIds } from "./ids.js";
import { KNOWN_AGENT_IDS } from "../agents/registry.js";

const QUALITY_HISTORY_FILENAME = new RegExp(
  `^(\\d{4}-\\d{2}-\\d{2})-(\\d{4})-(${KNOWN_AGENT_IDS.join("|")})-([a-z0-9]{5})\\.json$`,
);

/** Parsed quality report; invariant: filename-derived ids are the cross-run diff keys. */
export interface QualityHistoryEntry {
  id: string;
  path: string;
  date: string;
  time: string;
  agent: AgentId;
  randomId: string;
  report: SavedQualityReport;
}

/** Display row for history tables after same-agent deltas have been calculated. */
export interface QualityHistoryRow {
  id: string;
  date: string;
  agent: AgentId;
  qualityMode: QualityMode;
  setupTotal: number;
  systemTotal: number;
  setupDelta: number | null;
  blockerCount: number;
  majorCount: number;
  minorCount: number;
  /** Distinct evidence methods used across this run's findings. Lets the
   *  dashboard distinguish runtime-probe runs from static-only runs. */
  evidenceMethods: SavedQualityFinding["evidence_method"][];
}

/** Finding summary row shared by resolved, new, persisted, and stuck diff sections. */
export interface QualityDiffFindingRow {
  id: string;
  severity: SavedQualityFinding["severity"];
  type: SavedQualityFinding["type"];
  summary: string;
}

/**
 * One finding where the agent's self-reported `delta_tag` contradicts the
 * deterministic id-based diff class. Surfaced as a methodology signal: the
 * agent either found a real continuity the id algorithm missed, or tagged
 * sloppily - either way the user should see it, not have it silently ignored.
 */
interface QualityDeltaTagDisagreementRow extends QualityDiffFindingRow {
  /** What the agent claimed when writing the report. */
  agentTag: "new" | "persisted";
  /** What the positional-id diff derived for the same finding. */
  deterministic: "new" | "persisted";
}

/**
 * Diff result for two same-agent, same-mode quality-history entries.
 * Use when a user asks whether a quality run resolved, introduced, or carried findings forward.
 * Invariant: both entries must be comparable before these buckets are rendered to the CLI.
 */
export interface QualityDiffResult {
  from: QualityHistoryEntry;
  to: QualityHistoryEntry;
  setupDelta: number;
  systemDelta: number;
  resolved: QualityDiffFindingRow[];
  newFindings: QualityDiffFindingRow[];
  persisted: QualityDiffFindingRow[];
  stuck: QualityDiffFindingRow[];
  /**
   * Agent-vs-deterministic `delta_tag` contradictions. Only populated when
   * this diff's source report IS the baseline the newer report was tagged
   * against (`to.report.prior_report_id === from.id`) - against any other
   * pair the agent's tags describe a different comparison and disagreement
   * would be noise.
   */
  deltaTagDisagreements: QualityDeltaTagDisagreementRow[];
}

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
 * Compare history entries newest first.
 * Use so quality history tables and latest-run lookup read from most recent to oldest.
 *
 * @param left - first saved report entry; empty date/time would sort by remaining stable fields
 * @param right - second saved report entry; empty date/time would sort by remaining stable fields
 * @returns sort result for descending quality history
 */
function compareEntriesDesc(
  left: QualityHistoryEntry,
  right: QualityHistoryEntry,
): number {
  // Newer run dates appear first in the user's history table.
  if (left.date !== right.date) return right.date.localeCompare(left.date);
  // Same-day runs use filename time to keep the newest run first.
  if (left.time !== right.time) return right.time.localeCompare(left.time);
  // Same timestamp entries group by agent for stable display.
  if (left.agent !== right.agent) return left.agent.localeCompare(right.agent);
  return right.id.localeCompare(left.id);
}

/**
 * Return the whole-day gap between two quality run dates.
 * Use when deciding whether a finding is stuck across consecutive recent runs.
 *
 * @param newerDate - newer run date in YYYY-MM-DD; empty/invalid values produce an invalid date gap
 * @param olderDate - older run date in YYYY-MM-DD; empty/invalid values produce an invalid date gap
 * @returns rounded day gap; large gaps break stuck-finding continuity
 */
function daysBetween(newerDate: string, olderDate: string): number {
  const newer = new Date(`${newerDate}T00:00:00Z`);
  const older = new Date(`${olderDate}T00:00:00Z`);
  return Math.round((newer.getTime() - older.getTime()) / 86_400_000);
}

/**
 * Count findings at one severity level.
 * Use for quality history row badges the user scans before opening a run.
 *
 * @param report - saved quality report; empty findings means the count is zero
 * @param severity - severity to count; missing/unknown severities cannot reach this helper after parsing
 * @returns matching finding count shown in history rows
 */
function countSeverity(
  report: SavedQualityReport,
  severity: SavedQualityFinding["severity"],
): number {
  return report.findings.filter((finding) => finding.severity === severity)
    .length;
}

/**
 * Check whether one entry belongs to a requested quality mode.
 * Use when filtering history or finding the latest run for a mode.
 *
 * @param entry - saved quality entry; missing `quality_mode` is treated as legacy agent-setup
 * @param qualityMode - requested mode; `null` means the user asked to see all modes
 * @returns whether the entry should remain visible
 */
function matchesQualityMode(
  entry: QualityHistoryEntry,
  qualityMode: QualityMode | null,
): boolean {
  // Null mode filter means the user wants all saved quality runs.
  if (qualityMode === null) return true;
  return entryQualityMode(entry) === qualityMode;
}

/**
 * Return the mode used for history filtering and comparisons.
 * Use so legacy reports remain visible in the agent-setup quality history.
 *
 * @param entry - saved quality entry; missing mode means it predates multi-mode quality
 * @returns quality mode for UI filters; legacy empty mode maps to `agent-setup`
 */
function entryQualityMode(entry: QualityHistoryEntry): QualityMode {
  return entry.report.quality_mode ?? "agent-setup";
}

/**
 * Parse a quality-history filename into display and lookup fields.
 * Use before opening a file so invalid filenames stay out of the user's history table.
 *
 * @param filename - history filename; empty or malformed names are ignored
 * @returns parsed filename fields, or `null` when the file is not a quality report
 */
function parseHistoryFilename(
  filename: string,
): { date: string; time: string; agent: AgentId; randomId: string } | null {
  const match = QUALITY_HISTORY_FILENAME.exec(filename);
  // Non-matching files in the quality directory are ignored as unrelated local state.
  if (!match) return null;
  const [, date, time, agent, randomId] = match;
  // Defensive capture check keeps malformed matches out of the history table.
  if (
    date === undefined ||
    time === undefined ||
    agent === undefined ||
    randomId === undefined
  ) {
    return null;
  }
  return { date, time, agent: agent as AgentId, randomId };
}

/**
 * Return the quality logs directory for a project.
 * Use wherever quality history reads or latest-run lookup starts.
 *
 * @param projectPath - target project root; empty produces a relative `.goat-flow` lookup
 * @returns absolute or joined quality log path; missing directory later means no history is shown
 */
function getQualityLogsDir(projectPath: string): string {
  return join(projectPath, ".goat-flow", "logs", "quality");
}

/**
 * Return quality JSON filenames newest first.
 * Use for bounded dashboard reads and latest-run lookup without parsing every old report first.
 *
 * @param dir - quality log directory; missing directories must be checked by callers first
 * @returns JSON filenames sorted newest-first; empty array means no history files are present
 */
function listHistoryFilenamesDesc(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse();
}

/**
 * Parse a history filename only if it belongs to the requested agent.
 * Use when the user filters history or latest-run lookup by runner.
 *
 * @param filename - history filename; malformed names return `null`
 * @param agent - requested agent; mismatches return `null` so the file is skipped
 * @returns parsed filename fields, or `null` when the file should not be shown for this agent
 */
function parseAgentHistoryFilename(
  filename: string,
  agent: AgentId,
): { date: string; time: string; agent: AgentId; randomId: string } | null {
  const parsedName = parseHistoryFilename(filename);
  // Malformed filenames stay out of filtered history.
  if (!parsedName) return null;
  return parsedName.agent === agent ? parsedName : null;
}

/**
 * Try to append one matching history entry to a bounded dashboard window.
 * Use so the dashboard can load enough rows for visible deltas without parsing all history.
 *
 * @param entries - visible entries collected so far; empty means this may become the newest row
 * @param warnings - non-fatal parse warning list shown to callers
 * @param options - file, agent, and mode filters; missing mode means all modes are accepted
 * @returns whether a matching entry was appended
 */
function appendMatchingHistoryEntry(
  entries: QualityHistoryEntry[],
  warnings: string[],
  options: {
    dir: string;
    filename: string;
    agent: AgentId;
    qualityMode: QualityMode | null;
  },
): boolean {
  const parsedName = parseAgentHistoryFilename(options.filename, options.agent);
  // Wrong-agent or malformed filenames do not count toward the visible window.
  if (!parsedName) return false;

  const { entry, warning } = tryParseHistoryFile(
    options.dir,
    options.filename,
    parsedName,
  );
  // Malformed matching files warn the user but do not block other history rows.
  if (warning) warnings.push(warning);
  // Invalid entries are skipped after their warning is recorded.
  if (!entry) return false;
  // Mode mismatches stay out of this filtered window.
  if (!matchesQualityMode(entry, options.qualityMode)) return false;

  entries.push(entry);
  return true;
}

/**
 * Load every saved quality-history report from disk.
 *
 * Reports malformed files as warnings and skips them because agent-written
 * history must be non-blocking. Invariant: returned entries stay newest-first
 * and use filename-derived ids for stable diff selection.
 *
 * @param projectPath - project root containing quality logs; missing directory means no history exists yet
 * @returns parsed entries sorted newest-first plus warnings; empty entries mean there are no valid saved runs
 */
export function loadQualityHistory(projectPath: string): {
  entries: QualityHistoryEntry[];
  warnings: string[];
} {
  const dir = getQualityLogsDir(projectPath);
  // No quality directory means the user has not saved any quality runs yet.
  if (!existsSync(dir)) return { entries: [], warnings: [] };

  const entries: QualityHistoryEntry[] = [];
  const warnings: string[] = [];

  // Read every JSON history file so CLI history can show the complete saved set.
  for (const filename of readdirSync(dir)) {
    // Non-JSON files in the logs directory are ignored as local/user artifacts.
    if (!filename.endsWith(".json")) continue;
    const parsedName = parseHistoryFilename(filename);
    // JSON files with non-history names are ignored so the table stays well-formed.
    if (!parsedName) continue;
    const fullPath = join(dir, filename);
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(fullPath, "utf-8"));
    } catch (error) {
      warnings.push(
        `Skipping malformed quality history file ${filename}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      continue;
    }
    const parsedReport = parseQualityReport(raw, {
      requireCurrentFields: false,
    });
    // Schema-invalid reports warn but do not hide other history rows.
    if (!parsedReport.ok) {
      warnings.push(
        `Skipping malformed quality history file ${filename}: ${parsedReport.error}`,
      );
      continue;
    }
    const withIds = attachFindingIds(parsedReport.report);
    // Reports without stable finding ids cannot participate in history/diff views.
    if (!withIds.ok) {
      warnings.push(
        `Skipping malformed quality history file ${filename}: ${withIds.error}`,
      );
      continue;
    }

    entries.push({
      id: filename.replace(/\.json$/, ""),
      path: fullPath,
      date: parsedName.date,
      time: parsedName.time,
      agent: parsedName.agent,
      randomId: parsedName.randomId,
      report: withIds.report,
    });
  }

  entries.sort(compareEntriesDesc);
  return { entries, warnings };
}

/**
 * Load only the newest dashboard-sized quality-history window. For selected
 * agent tables, one extra matching entry is parsed so the oldest displayed row
 * can still calculate its delta without parsing the whole history directory.
 *
 * @param projectPath - project root containing quality logs; missing directory means no history exists yet
 * @param options - agent/mode filters and row limit; `null` limit or agent loads full history
 * @returns bounded entries sorted newest-first plus warnings; empty entries mean no matching valid runs
 */
export function loadQualityHistoryWindow(
  projectPath: string,
  options: {
    agent: AgentId | null;
    limit: number | null;
    qualityMode?: QualityMode | null;
  },
): {
  entries: QualityHistoryEntry[];
  warnings: string[];
} {
  // Without a concrete agent/limit, callers need the full history path.
  if (options.limit === null || options.agent === null) {
    return loadQualityHistory(projectPath);
  }

  const dir = getQualityLogsDir(projectPath);
  // No quality directory means the dashboard has no rows to show.
  if (!existsSync(dir)) return { entries: [], warnings: [] };

  const qualityMode = options.qualityMode ?? null;
  const entries: QualityHistoryEntry[] = [];
  const warnings: string[] = [];
  const targetEntryCount = options.limit + 1;
  const filenames = listHistoryFilenamesDesc(dir);

  // Parse newest matching files until the visible rows plus one delta baseline are loaded.
  for (const filename of filenames) {
    const appended = appendMatchingHistoryEntry(entries, warnings, {
      dir,
      filename,
      agent: options.agent,
      qualityMode,
    });
    // Once the extra baseline row is loaded, the dashboard can calculate visible deltas.
    if (appended && entries.length >= targetEntryCount) break;
  }

  return { entries, warnings };
}

/**
 * Load and validate one quality-history file.
 * Use for latest-run lookup and bounded windows so malformed files stay non-blocking.
 *
 * @param dir - quality log directory; missing directories must be checked by callers first
 * @param filename - history filename to read; empty names produce a bad file path
 * @param parsedName - filename-derived metadata; missing fields would make the entry unusable
 * @returns parsed entry plus optional warning; `null` entry means the row is skipped
 */
function tryParseHistoryFile(
  dir: string,
  filename: string,
  parsedName: { date: string; time: string; agent: AgentId; randomId: string },
): { entry: QualityHistoryEntry | null; warning: string | null } {
  const fullPath = join(dir, filename);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(fullPath, "utf-8"));
  } catch (error) {
    return {
      entry: null,
      warning: `Skipping malformed quality history file ${filename}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const parsedReport = parseQualityReport(raw, {
    requireCurrentFields: false,
  });
  // Schema-invalid history files are skipped but reported so users can inspect bad saved runs.
  if (!parsedReport.ok) {
    return {
      entry: null,
      warning: `Skipping malformed quality history file ${filename}: ${parsedReport.error}`,
    };
  }
  const withIds = attachFindingIds(parsedReport.report);
  // Finding-id failures prevent reliable cross-run diffing for this file.
  if (!withIds.ok) {
    return {
      entry: null,
      warning: `Skipping malformed quality history file ${filename}: ${withIds.error}`,
    };
  }
  return {
    entry: {
      id: filename.replace(/\.json$/, ""),
      path: fullPath,
      date: parsedName.date,
      time: parsedName.time,
      agent: parsedName.agent,
      randomId: parsedName.randomId,
      report: withIds.report,
    },
    warning: null,
  };
}

/**
 * Find the latest quality report for one agent/mode without parsing all files.
 * Scans filenames newest-first, filters by agent from the filename, and parses
 * only matching JSON until a valid entry is found.
 *
 * @param projectPath - project root containing quality logs; missing directory means no latest run exists
 * @param agent - agent whose newest report should be found; mismatches are skipped by filename
 * @param qualityMode - optional mode filter; `null` accepts any mode
 * @returns latest valid entry plus warnings; `null` entry means no matching valid report exists
 */
export function findLatestQualityReport(
  projectPath: string,
  agent: AgentId,
  qualityMode: QualityMode | null = null,
): { entry: QualityHistoryEntry | null; warnings: string[] } {
  const dir = getQualityLogsDir(projectPath);
  // No quality directory means the user has not saved a report for this project.
  if (!existsSync(dir)) return { entry: null, warnings: [] };

  const warnings: string[] = [];
  const filenames = listHistoryFilenamesDesc(dir);

  // Scan newest-first so the first valid matching report is the latest visible run.
  for (const filename of filenames) {
    const parsedName = parseAgentHistoryFilename(filename, agent);
    // Wrong-agent or malformed filenames are skipped before opening the file.
    if (!parsedName) continue;

    const { entry, warning } = tryParseHistoryFile(dir, filename, parsedName);
    // Malformed matching files are reported while the search continues.
    if (warning) warnings.push(warning);
    // The first valid mode-matching entry is the latest run the user asked for.
    if (entry && matchesQualityMode(entry, qualityMode)) {
      return { entry, warnings };
    }
  }

  return { entry: null, warnings };
}

/**
 * Select visible quality-history entries after agent, mode, and limit filters.
 *
 * @param entries - pre-sorted quality-history entries; empty entries produce an empty visible list
 * @param options - filter and limit options; `null` agent/mode/limit means no filtering for that dimension
 * @returns filtered entries in input order; empty array means no saved run matches the user's filters
 */
export function selectQualityHistoryEntries(
  entries: QualityHistoryEntry[],
  options: {
    agent: AgentId | null;
    limit: number | null;
    qualityMode?: QualityMode | null;
  },
): QualityHistoryEntry[] {
  const qualityMode = options.qualityMode ?? null;
  const filtered = entries.filter((entry) => {
    // Agent filter shows only runs for the runner the user selected.
    if (options.agent && entry.agent !== options.agent) return false;
    return matchesQualityMode(entry, qualityMode);
  });
  // Null limit means the caller wants every matching row.
  if (options.limit === null) return filtered;
  return filtered.slice(0, options.limit);
}

/**
 * Build display rows with same-agent, same-mode setup deltas.
 *
 * @param entries - pre-sorted quality-history entries; empty entries produce no history rows
 * @param options - filter and limit options; `null` limit means return every matching row
 * @returns history table rows in newest-first order; empty array means no visible saved runs
 */
export function buildQualityHistoryRows(
  entries: QualityHistoryEntry[],
  options: {
    agent: AgentId | null;
    limit: number | null;
    qualityMode?: QualityMode | null;
  },
): QualityHistoryRow[] {
  const filtered = selectQualityHistoryEntries(entries, {
    agent: options.agent,
    limit: null,
    qualityMode: options.qualityMode ?? null,
  });
  const rows = filtered.map((entry, index) => {
    const entryMode = entryQualityMode(entry);
    // Find the next older same-agent/same-mode run so the visible row can show a delta.
    const previousSameAgent = filtered
      .slice(index + 1)
      .find(
        (candidate) =>
          candidate.agent === entry.agent &&
          entryQualityMode(candidate) === entryMode,
      );
    const previousSetup = previousSameAgent?.report.scores.setup.total ?? null;
    return {
      id: entry.id,
      date: entry.report.run_date,
      agent: entry.agent,
      qualityMode: entryQualityMode(entry),
      setupTotal: entry.report.scores.setup.total,
      systemTotal: entry.report.scores.system.total,
      setupDelta:
        previousSetup === null
          ? null
          : entry.report.scores.setup.total - previousSetup,
      blockerCount: countSeverity(entry.report, "BLOCKER"),
      majorCount: countSeverity(entry.report, "MAJOR"),
      minorCount: countSeverity(entry.report, "MINOR"),
      evidenceMethods: Array.from(
        new Set(
          entry.report.findings.map((finding) => finding.evidence_method),
        ),
      ),
    };
  });
  // Null limit means the caller wants every computed history row.
  if (options.limit === null) return rows;
  return rows.slice(0, options.limit);
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
      if (
        daysBetween(previousEntry.report.run_date, entry.report.run_date) > 30
      ) {
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

export {
  renderQualityDiffText,
  renderQualityHistoryText,
} from "./history-render.js";
