/**
 * Load, classify, and render persisted quality-report history.
 *
 * Agents write reports directly to `.goat-flow/logs/quality/<YYYY-MM-DD>-<HHMM>-<agent>-<rand5>.json`
 * in the agent-shape schema (no `id` field on findings). Positional finding ids
 * are attached deterministically at load time via `attachFindingIds`, so cross-run
 * diff/persistence tracking stays stable without trusting the agent's slugging.
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

/** Return the numeric rank for one finding severity. */
function severityRank(severity: SavedQualityFinding["severity"]): number {
  if (severity === "BLOCKER") return 0;
  if (severity === "MAJOR") return 1;
  return 2;
}

/** Compare diff rows by severity and finding ID. */
function diffRowSort(
  left: QualityDiffFindingRow,
  right: QualityDiffFindingRow,
): number {
  const severityDiff =
    severityRank(left.severity) - severityRank(right.severity);
  if (severityDiff !== 0) return severityDiff;
  return left.id.localeCompare(right.id);
}

/** Compare history entries in descending recency order. */
function compareEntriesDesc(
  left: QualityHistoryEntry,
  right: QualityHistoryEntry,
): number {
  if (left.date !== right.date) return right.date.localeCompare(left.date);
  if (left.time !== right.time) return right.time.localeCompare(left.time);
  if (left.agent !== right.agent) return left.agent.localeCompare(right.agent);
  return right.id.localeCompare(left.id);
}

/** Return the whole-day gap between two run dates. */
function daysBetween(newerDate: string, olderDate: string): number {
  const newer = new Date(`${newerDate}T00:00:00Z`);
  const older = new Date(`${olderDate}T00:00:00Z`);
  return Math.round((newer.getTime() - older.getTime()) / 86_400_000);
}

/** Count findings at one severity level. */
function countSeverity(
  report: SavedQualityReport,
  severity: SavedQualityFinding["severity"],
): number {
  return report.findings.filter((finding) => finding.severity === severity)
    .length;
}

/** Return true when one report belongs to the requested quality mode.
 *  Legacy reports predate quality_mode and are classified as agent-setup,
 *  because that was the only quality workflow at the time. */
function matchesQualityMode(
  entry: QualityHistoryEntry,
  qualityMode: QualityMode | null,
): boolean {
  if (qualityMode === null) return true;
  return entryQualityMode(entry) === qualityMode;
}

/** Return the mode used for comparisons, treating legacy reports as agent-setup. */
function entryQualityMode(entry: QualityHistoryEntry): QualityMode {
  return entry.report.quality_mode ?? "agent-setup";
}

/** Parse the history filename. */
function parseHistoryFilename(
  filename: string,
): { date: string; time: string; agent: AgentId; randomId: string } | null {
  const match = QUALITY_HISTORY_FILENAME.exec(filename);
  if (!match) return null;
  const [, date, time, agent, randomId] = match;
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

/** Return the quality logs directory path. */
function getQualityLogsDir(projectPath: string): string {
  return join(projectPath, ".goat-flow", "logs", "quality");
}

/** Return quality JSON filenames newest-first; invariant: filename timestamps define recency. */
function listHistoryFilenamesDesc(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse();
}

/** Parse a filename only if it belongs to the requested agent. */
function parseAgentHistoryFilename(
  filename: string,
  agent: AgentId,
): { date: string; time: string; agent: AgentId; randomId: string } | null {
  const parsedName = parseHistoryFilename(filename);
  if (!parsedName) return null;
  return parsedName.agent === agent ? parsedName : null;
}

/** Try to append one parsed history entry to a limited dashboard window. */
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
  if (!parsedName) return false;

  const { entry, warning } = tryParseHistoryFile(
    options.dir,
    options.filename,
    parsedName,
  );
  if (warning) warnings.push(warning);
  if (!entry) return false;
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
 * @param projectPath - Project root containing `.goat-flow/logs/quality`.
 * @returns Parsed entries sorted newest-first plus non-fatal parse warnings.
 */
export function loadQualityHistory(projectPath: string): {
  entries: QualityHistoryEntry[];
  warnings: string[];
} {
  const dir = getQualityLogsDir(projectPath);
  if (!existsSync(dir)) return { entries: [], warnings: [] };

  const entries: QualityHistoryEntry[] = [];
  const warnings: string[] = [];

  for (const filename of readdirSync(dir)) {
    if (!filename.endsWith(".json")) continue;
    const parsedName = parseHistoryFilename(filename);
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
    if (!parsedReport.ok) {
      warnings.push(
        `Skipping malformed quality history file ${filename}: ${parsedReport.error}`,
      );
      continue;
    }
    const withIds = attachFindingIds(parsedReport.report);
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
 * @param projectPath - Project root containing `.goat-flow/logs/quality`.
 * @param options - Agent/mode filters and optional dashboard row limit.
 * @returns Bounded entries sorted newest-first plus non-fatal parse warnings.
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
  if (options.limit === null || options.agent === null) {
    return loadQualityHistory(projectPath);
  }

  const dir = getQualityLogsDir(projectPath);
  if (!existsSync(dir)) return { entries: [], warnings: [] };

  const qualityMode = options.qualityMode ?? null;
  const entries: QualityHistoryEntry[] = [];
  const warnings: string[] = [];
  const targetEntryCount = options.limit + 1;
  const filenames = listHistoryFilenamesDesc(dir);

  for (const filename of filenames) {
    const appended = appendMatchingHistoryEntry(entries, warnings, {
      dir,
      filename,
      agent: options.agent,
      qualityMode,
    });
    if (appended && entries.length >= targetEntryCount) break;
  }

  return { entries, warnings };
}

/** Try to load and validate one history file. Returns the entry or null + a warning. */
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
  if (!parsedReport.ok) {
    return {
      entry: null,
      warning: `Skipping malformed quality history file ${filename}: ${parsedReport.error}`,
    };
  }
  const withIds = attachFindingIds(parsedReport.report);
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
 * @param projectPath - Project root containing `.goat-flow/logs/quality`.
 * @param agent - Agent whose newest report should be found.
 * @param qualityMode - Optional mode filter; `null` accepts any mode.
 * @returns Latest valid entry plus warnings for malformed matching files.
 */
export function findLatestQualityReport(
  projectPath: string,
  agent: AgentId,
  qualityMode: QualityMode | null = null,
): { entry: QualityHistoryEntry | null; warnings: string[] } {
  const dir = getQualityLogsDir(projectPath);
  if (!existsSync(dir)) return { entry: null, warnings: [] };

  const warnings: string[] = [];
  const filenames = listHistoryFilenamesDesc(dir);

  for (const filename of filenames) {
    const parsedName = parseAgentHistoryFilename(filename, agent);
    if (!parsedName) continue;

    const { entry, warning } = tryParseHistoryFile(dir, filename, parsedName);
    if (warning) warnings.push(warning);
    if (entry && matchesQualityMode(entry, qualityMode)) {
      return { entry, warnings };
    }
  }

  return { entry: null, warnings };
}

/**
 * Select visible quality-history entries after agent, mode, and limit filters.
 *
 * @param entries - Pre-sorted quality-history entries.
 * @param options - Filter and limit options from CLI or dashboard callers.
 * @returns Filtered entries, preserving input order.
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
    if (options.agent && entry.agent !== options.agent) return false;
    return matchesQualityMode(entry, qualityMode);
  });
  if (options.limit === null) return filtered;
  return filtered.slice(0, options.limit);
}

/**
 * Build display rows with same-agent, same-mode setup deltas.
 *
 * @param entries - Pre-sorted quality-history entries.
 * @param options - Filter and limit options from CLI or dashboard callers.
 * @returns History table rows, preserving newest-first order.
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
  if (options.limit === null) return rows;
  return rows.slice(0, options.limit);
}

/** Build a finding map keyed by finding ID. */
function getFindingMap(
  report: SavedQualityReport,
): Map<string, SavedQualityFinding> {
  return new Map(report.findings.map((finding) => [finding.id, finding]));
}

/** Count consecutive runs that contain one finding. */
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
  if (currentIndex === -1) return 0;

  let count = 0;
  let previousEntry: QualityHistoryEntry | undefined;
  for (let index = currentIndex; index < sameAgent.length; index += 1) {
    const entry = sameAgent[index];
    if (entry === undefined) break;
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
    if (!hasFinding) break;
    count += 1;
    previousEntry = entry;
  }
  return count;
}

/** Build the diff between two quality-history runs. */
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

  if (options.pair) {
    const [fromId, toId, ...rest] = options.pair.split(":");
    if (!fromId || !toId || rest.length > 0) {
      return {
        ok: false,
        error: "quality diff pair must be in the form <from-id>:<to-id>",
      };
    }
    sourceEntry = entries.find((entry) => entry.id === fromId);
    targetEntry = entries.find((entry) => entry.id === toId);
    if (!sourceEntry || !targetEntry) {
      return {
        ok: false,
        error: "quality diff pair must reference existing saved report ids",
      };
    }
    if (sourceEntry.agent !== targetEntry.agent) {
      return {
        ok: false,
        error: "quality diff rejects cross-agent comparisons",
      };
    }
    if (options.agent && sourceEntry.agent !== options.agent) {
      return {
        ok: false,
        error: `quality diff pair does not match --agent ${options.agent}`,
      };
    }
    if (entryQualityMode(sourceEntry) !== entryQualityMode(targetEntry)) {
      return {
        ok: false,
        error: "quality diff rejects cross-mode comparisons",
      };
    }
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
    if (sameAgent.length < 2) {
      const modeScope = qualityMode === null ? "" : ` in ${qualityMode} mode`;
      return {
        ok: false,
        error: `Not enough saved quality reports for ${options.agent}${modeScope}. Need at least 2 runs.`,
      };
    }
    const latest = sameAgent[0];
    const previous = sameAgent[1];
    if (!latest || !previous) {
      return {
        ok: false,
        error: "quality diff could not resolve the requested report pair",
      };
    }
    targetEntry = latest;
    sourceEntry = previous;
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

  const resolved = [...fromMap.values()]
    .filter((finding) => !toMap.has(finding.id))
    .map((finding) => ({
      id: finding.id,
      severity: finding.severity,
      type: finding.type,
      summary: finding.summary,
    }))
    .sort(diffRowSort);

  const persisted = [...toMap.values()]
    .filter((finding) => fromMap.has(finding.id))
    .map((finding) => ({
      id: finding.id,
      severity: finding.severity,
      type: finding.type,
      summary: finding.summary,
    }))
    .sort(diffRowSort);

  const newFindings = [...toMap.values()]
    .filter((finding) => !fromMap.has(finding.id))
    .map((finding) => ({
      id: finding.id,
      severity: finding.severity,
      type: finding.type,
      summary: finding.summary,
    }))
    .sort(diffRowSort);

  const stuck = persisted
    .filter((finding) => {
      if (!["BLOCKER", "MAJOR"].includes(finding.severity)) return false;
      return countConsecutivePresence(entries, targetEntry, finding.id) >= 3;
    })
    .sort(diffRowSort);

  // Agent-claimed delta_tags are only comparable when this diff's source IS
  // the baseline the agent tagged against; a user diffing any other pair
  // would see false "disagreements" about a comparison the agent never made.
  const baselineMatches = targetEntry.report.prior_report_id === sourceEntry.id;
  const deltaTagDisagreements: QualityDeltaTagDisagreementRow[] =
    !baselineMatches
      ? []
      : [...toMap.values()]
          .flatMap((finding) => {
            // Finding carries no agent tag -> nothing to cross-check.
            if (
              finding.delta_tag !== "new" &&
              finding.delta_tag !== "persisted"
            ) {
              return [];
            }
            const deterministic = fromMap.has(finding.id)
              ? ("persisted" as const)
              : ("new" as const);
            // Agent and deterministic diff agree -> no signal to surface.
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
