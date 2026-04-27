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

export interface QualityHistoryEntry {
  id: string;
  path: string;
  date: string;
  time: string;
  agent: AgentId;
  randomId: string;
  report: SavedQualityReport;
}

interface QualityHistoryRow {
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

interface QualityDiffFindingRow {
  id: string;
  severity: SavedQualityFinding["severity"];
  type: SavedQualityFinding["type"];
  summary: string;
}

interface QualityDiffResult {
  from: QualityHistoryEntry;
  to: QualityHistoryEntry;
  setupDelta: number;
  systemDelta: number;
  resolved: QualityDiffFindingRow[];
  newFindings: QualityDiffFindingRow[];
  persisted: QualityDiffFindingRow[];
  stuck: QualityDiffFindingRow[];
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

/** Format the delta. */
function formatDelta(delta: number | null): string {
  if (delta === null) return "";
  if (delta > 0) return ` (+${delta})`;
  if (delta < 0) return ` (${delta})`;
  return " (+0)";
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

/** Return quality JSON filenames in descending recency order. */
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

/** Load the quality history. */
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

/** Return the latest history entry for one agent. */
export function getLatestQualityHistoryEntry(
  entries: QualityHistoryEntry[],
  agent: AgentId,
  qualityMode: QualityMode | null = null,
): QualityHistoryEntry | null {
  return (
    entries.find(
      (entry) =>
        entry.agent === agent && matchesQualityMode(entry, qualityMode),
    ) ?? null
  );
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

/** Select quality history entries. */
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

/** Build the quality history rows. */
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
// eslint-disable-next-line complexity -- diff selection branches on implicit latest-vs-explicit pair resolution and validation
export function buildQualityDiff(
  entries: QualityHistoryEntry[],
  options: {
    agent: AgentId | null;
    pair: string | null;
    qualityMode?: QualityMode | null;
  },
): { ok: true; diff: QualityDiffResult } | { ok: false; error: string } {
  const qualityMode = options.qualityMode ?? null;
  let from: QualityHistoryEntry | undefined;
  let to: QualityHistoryEntry | undefined;

  if (options.pair) {
    const [fromId, toId, ...rest] = options.pair.split(":");
    if (!fromId || !toId || rest.length > 0) {
      return {
        ok: false,
        error: "quality diff pair must be in the form <from-id>:<to-id>",
      };
    }
    from = entries.find((entry) => entry.id === fromId);
    to = entries.find((entry) => entry.id === toId);
    if (!from || !to) {
      return {
        ok: false,
        error: "quality diff pair must reference existing saved report ids",
      };
    }
    if (from.agent !== to.agent) {
      return {
        ok: false,
        error: "quality diff rejects cross-agent comparisons",
      };
    }
    if (options.agent && from.agent !== options.agent) {
      return {
        ok: false,
        error: `quality diff pair does not match --agent ${options.agent}`,
      };
    }
    if (entryQualityMode(from) !== entryQualityMode(to)) {
      return {
        ok: false,
        error: "quality diff rejects cross-mode comparisons",
      };
    }
    if (
      qualityMode !== null &&
      (entryQualityMode(from) !== qualityMode ||
        entryQualityMode(to) !== qualityMode)
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
    to = latest;
    from = previous;
    if (
      qualityMode === null &&
      entryQualityMode(from) !== entryQualityMode(to)
    ) {
      return {
        ok: false,
        error: `quality diff would compare ${entryQualityMode(from)} to ${entryQualityMode(to)}. Pass --mode to diff one quality mode, or pass explicit same-mode report ids.`,
      };
    }
  }

  const fromMap = getFindingMap(from.report);
  const toMap = getFindingMap(to.report);

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
      return countConsecutivePresence(entries, to, finding.id) >= 3;
    })
    .sort(diffRowSort);

  return {
    ok: true,
    diff: {
      from,
      to,
      setupDelta: to.report.scores.setup.total - from.report.scores.setup.total,
      systemDelta:
        to.report.scores.system.total - from.report.scores.system.total,
      resolved,
      newFindings,
      persisted,
      stuck,
    },
  };
}

/** Render the quality history text. */
export function renderQualityHistoryText(
  rows: QualityHistoryRow[],
  options: {
    agent: AgentId | null;
    qualityMode: QualityMode | null;
    all: boolean;
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
  if (!options.all) {
    lines.push("");
    lines.push(
      "Use `--all` to lift the 20-run default. Diff ids are saved report basenames under `.goat-flow/logs/quality/`.",
    );
  }
  return lines.join("\n");
}

/** Render the quality diff text. */
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

  lines.push(
    "Stuck counter resets on history gaps. For strict persistence tracking, ensure at least one quality run lands within every 30-day window.",
  );
  return lines.join("\n");
}
