/**
 * Persistent identity and on-disk state model for the dashboard's recent-projects list.
 *
 * Resolves a stable identity for each checkout (git remote hash, then a gitignored `.goat-flow` marker, then the absolute path) so the same project
 * is recognised after it moves on disk, and hydrates/normalises the JSON state file into a deduplicated, deterministically ordered shape.
 *
 * Reads and writes the local marker file and shells out to `git config` with a short timeout; all filesystem and git failures are swallowed into
 * path-based fallbacks so a read-only or non-git project still loads.
 * Consumed by dashboard-project-routes.ts.
 */
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { resolveLocalStatePath } from "./local-paths.js";

type ProjectIdentitySource = "git-remote" | "goat-marker" | "path";

/**
 * Stable project identity used to recognise the same checkout after it moves.
 */
export interface DashboardProjectIdentity {
  identity: string;
  identitySource: ProjectIdentitySource;
  currentPath: string;
  remoteUrlHash?: string | undefined;
  markerId?: string | undefined;
}

/**
 * Persistent dashboard project entry, including every known local path for the identity.
 */
interface DashboardProjectRecord extends DashboardProjectIdentity {
  paths: string[];
  title?: string | undefined;
  archivedAt?: string | undefined;
}

/**
 * On-disk dashboard state schema, including legacy path lists and identity records.
 */
export interface DashboardStateData {
  paths: string[];
  favorites: string[];
  projectTitles: Record<string, string>;
  projects: Record<string, DashboardProjectRecord>;
}

/** Hash cache and identity inputs without storing raw remote URLs in keys. */
function hashString(inputText: string): string {
  return createHash("sha256").update(inputText).digest("hex");
}

const PROJECT_MARKER_COMMENT =
  "# Local goat-flow dashboard project identity. Gitignored by default.";

/** Accept only persisted identity-source values understood by this dashboard build. */
function identitySourceFrom(candidate: unknown): ProjectIdentitySource | null {
  return candidate === "git-remote" ||
    candidate === "goat-marker" ||
    candidate === "path"
    ? candidate
    : null;
}

/** Preserve first-seen path order while removing duplicate project paths. */
function dedupeStrings(values: string[]): string[] {
  const result: string[] = [];
  for (const candidate of values) {
    if (candidate && !result.includes(candidate)) result.push(candidate);
  }
  return result;
}

/** Resolve a project path to its realpath, with fallback when realpath lookup fails. */
function normalizeProjectPath(projectPath: string): string {
  const resolved = resolve(projectPath);
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

/** Probe optional project directories; swallows permission and removal races. */
function directoryExists(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Canonicalise a git remote host/path pair into the identity hash input. */
function cleanRemotePath(host: string | undefined, path: string | undefined) {
  const remotePath = path?.replace(/^\/+/u, "");
  if (!host || !remotePath) return null;
  return `${host.toLowerCase()}/${remotePath}`
    .replace(/\.git$/u, "")
    .replace(/\/+$/u, "");
}

/** Normalise `git@host:owner/repo` remotes before URL parsing gets a chance. */
function normalizeScpLikeRemote(trimmed: string): string | null {
  const scpLike = trimmed.match(/^(?:[^@/\s]+@)?([^:/\s]+):(.+)$/u);
  if (!scpLike || trimmed.includes("://")) return null;
  return cleanRemotePath(scpLike[1], scpLike[2]);
}

/** Normalise URL-style git remotes; swallows invalid URL inputs as `null`. */
function normalizeUrlRemote(trimmed: string): string | null {
  try {
    const parsed = new URL(trimmed);
    return cleanRemotePath(parsed.hostname, parsed.pathname);
  } catch {
    return null;
  }
}

/** Build the stable remote identity string used before hashing project records. */
function normalizeGitRemoteUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return (
    normalizeScpLikeRemote(trimmed) ??
    normalizeUrlRemote(trimmed) ??
    trimmed.replace(/\.git$/u, "").replace(/\/+$/u, "")
  );
}

/** Spawns `git config` with a short timeout; swallows failures into marker/path fallback. */
function readGitRemote(projectPath: string): string | null {
  try {
    const output = execFileSync(
      "git",
      ["-C", projectPath, "config", "--get", "remote.origin.url"],
      {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 1000,
      },
    );
    return typeof output === "string" ? output.trim() : String(output).trim();
  } catch {
    return null;
  }
}

/** Read the first non-comment project marker line; swallows missing marker files. */
function readProjectMarkerIdentifier(markerPath: string): string | null {
  try {
    const raw = readFileSync(markerPath, "utf-8");
    for (const line of raw.split(/\r?\n/u)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      return trimmed;
    }
  } catch {
    /* missing or unreadable marker */
  }
  return null;
}

/** Writes a gitignored project marker; swallows read-only projects as `null`. */
function writeProjectMarkerIdentifier(markerPath: string): string | null {
  try {
    const markerIdentifier = `gf_${randomUUID()}`;
    writeFileSync(
      markerPath,
      `${PROJECT_MARKER_COMMENT}\n${markerIdentifier}\n`,
      {
        encoding: "utf-8",
      },
    );
    return markerIdentifier;
  } catch {
    return null;
  }
}

/**
 * Identify a project by its normalised Git remote, the most portable identity available.
 * The remote URL is hashed rather than stored, so a private host name never reaches local state.
 *
 * @param currentPath - realpath-normalised project root
 * @returns the remote-backed identity, or null when the project has no usable remote
 */
function resolveGitRemoteIdentity(
  currentPath: string,
): DashboardProjectIdentity | null {
  const normalizedRemote = normalizeGitRemoteUrl(
    readGitRemote(currentPath) ?? "",
  );
  if (!normalizedRemote) return null;
  const remoteUrlHash = hashString(normalizedRemote);
  return {
    identity: `git-remote:${remoteUrlHash}`,
    identitySource: "git-remote",
    currentPath,
    remoteUrlHash,
  };
}

/**
 * Identify a project by its local `.goat-flow` marker file, the fallback when no remote exists.
 * Error behavior: throws only when a marker write was requested and the state path is unsafe; in read-only mode the same failure reports as a null
 * identity so a preview cannot be blocked by it.
 *
 * @param currentPath - realpath-normalised project root
 * @param allowMarkerWrite - true permits creating a missing marker; false keeps the call read-only
 * @returns the marker-backed identity, or null when no marker exists and none may be written
 */
function resolveMarkerIdentity(
  currentPath: string,
  allowMarkerWrite: boolean,
): DashboardProjectIdentity | null {
  const goatFlowDir = join(currentPath, ".goat-flow");
  if (!directoryExists(goatFlowDir)) return null;
  let markerPath: string | null = null;
  try {
    markerPath = resolveLocalStatePath(currentPath, "project-id");
  } catch (err) {
    if (allowMarkerWrite) throw err;
  }
  const markerIdentifier =
    markerPath === null
      ? null
      : (readProjectMarkerIdentifier(markerPath) ??
        (allowMarkerWrite ? writeProjectMarkerIdentifier(markerPath) : null));
  if (!markerIdentifier) return null;
  return {
    identity: `goat-marker:${markerIdentifier}`,
    identitySource: "goat-marker",
    currentPath,
    markerId: markerIdentifier,
  };
}

/**
 * Resolve the stable identity the dashboard uses to recognise one project across path changes.
 *
 * Sources are tried in descending durability: Git remote, then local marker, then the path itself.
 * A path identity is deliberately last because it stops matching as soon as the user moves the directory, which is exactly what the other two sources
 * exist to survive.
 *
 * @param projectPath - project root as the user selected it; normalised to a realpath first
 * @param options - `allowMarkerWrite` true permits creating a missing marker file
 * @returns the resolved identity; never null, because the path fallback always succeeds
 */
export function resolveProjectIdentity(
  projectPath: string,
  options: { allowMarkerWrite?: boolean } = {},
): DashboardProjectIdentity {
  const currentPath = normalizeProjectPath(projectPath);
  return (
    resolveGitRemoteIdentity(currentPath) ??
    resolveMarkerIdentity(currentPath, options.allowMarkerWrite === true) ?? {
      identity: `path:${currentPath}`,
      identitySource: "path",
      currentPath,
    }
  );
}

/** Read one optional string array property from a parsed dashboard state file. */
function readOptionalStringArrayProperty(
  stateRecord: Record<string, unknown>,
  key: string,
): string[] | null {
  const raw = stateRecord[key];
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return null;
  const items: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") return null;
    items.push(entry);
  }
  return items;
}

/** Read an optional `{ [path]: title }` map from parsed dashboard state.
 *  Invalid entries are dropped rather than failing the whole load so one bad
 *  title can't wipe the user's `paths` / `favorites`. */
function readOptionalStringMapProperty(
  stateRecord: Record<string, unknown>,
  key: string,
): Record<string, string> {
  const raw = stateRecord[key];
  if (raw === undefined) return {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "string" && v.length > 0) result[k] = v;
  }
  return result;
}

/** Normalise legacy project-record paths before merging them into identity records. */
function normalizeProjectRecordPaths(record: Record<string, unknown>) {
  return Array.isArray(record.paths)
    ? record.paths
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => normalizeProjectPath(entry))
    : [];
}

/**
 * Read one non-empty string field from an untrusted project record.
 *
 * @param record - parsed record from local state; any field may be missing or wrongly typed
 * @param key - field to read
 * @returns the string, or null when the field is absent, not a string, or empty
 */
function readRecordString(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const fieldValue = record[key];
  return typeof fieldValue === "string" && fieldValue.length > 0
    ? fieldValue
    : null;
}

/**
 * Copy the optional identity and title fields onto a normalised record.
 *
 * Absent fields are left unset rather than written as empty, so a later merge can still take the value from another record for the same project.
 * Side effect: mutates `normalized` in place.
 *
 * @param normalized - record being built; only present fields are assigned
 * @param record - untrusted parsed record supplying the optional values
 * @returns nothing; the result is the fields assigned to `normalized`
 */
function applyOptionalProjectRecordFields(
  normalized: DashboardProjectRecord,
  record: Record<string, unknown>,
): void {
  const remoteUrlHash = readRecordString(record, "remoteUrlHash");
  const markerId = readRecordString(record, "markerId");
  const title = readRecordString(record, "title")?.trim();
  const archivedAt = readRecordString(record, "archivedAt");
  if (remoteUrlHash) normalized.remoteUrlHash = remoteUrlHash;
  if (markerId) normalized.markerId = markerId;
  if (title) normalized.title = title.slice(0, 120);
  if (archivedAt) normalized.archivedAt = archivedAt;
}

/**
 * Validate one untrusted project record into the shape the dashboard can trust.
 * A record missing identity, source, or current path is rejected outright, because a partial record would let the dashboard claim it recognises a
 * project it cannot actually locate.
 *
 * @param identity - map key used as the identity when the record does not carry its own
 * @param candidate - untrusted parsed value; anything that is not a plain object is rejected
 * @returns the normalised record, or null when required fields are missing or malformed
 */
function normalizeDashboardProjectRecord(
  identity: string,
  candidate: unknown,
): DashboardProjectRecord | null {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }
  const record = candidate as Record<string, unknown>;
  const identityValue = readRecordString(record, "identity") ?? identity;
  const identitySource = identitySourceFrom(record.identitySource);
  const currentPath = readRecordString(record, "currentPath");
  if (!identityValue || !identitySource || !currentPath) return null;

  const normalized: DashboardProjectRecord = {
    identity: identityValue,
    identitySource,
    currentPath: normalizeProjectPath(currentPath),
    paths: dedupeStrings([
      normalizeProjectPath(currentPath),
      ...normalizeProjectRecordPaths(record),
    ]),
  };
  applyOptionalProjectRecordFields(normalized, record);
  return normalized;
}

/**
 * Read and validate the `projects` map from parsed dashboard state.
 * Invalid records are dropped individually rather than failing the load, so one corrupt entry cannot wipe every project the user has added.
 *
 * @param stateRecord - parsed state object; a missing or non-object `projects` yields an empty map
 * @returns validated records keyed by their own identity; empty when none survive validation
 */
function readOptionalProjectRecordsProperty(
  stateRecord: Record<string, unknown>,
): Record<string, DashboardProjectRecord> {
  const raw = stateRecord.projects;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const records: Record<string, DashboardProjectRecord> = {};
  for (const [identity, record] of Object.entries(raw)) {
    const normalized = normalizeDashboardProjectRecord(identity, record);
    if (normalized) records[normalized.identity] = normalized;
  }
  return records;
}

/**
 * Merge one project record into the accumulating identity map.
 *
 * An existing entry keeps its optional fields unless the incoming record supplies them, so re-adding a project by a new path never discards the title
 * or marker learned earlier.
 * Side effect: mutates the `records` map in place.
 *
 * @param records - accumulator keyed by identity
 * @param next - record to merge; its `currentPath` always wins as the most recent location
 * @returns nothing; the result is the merged entry in `records`
 */
function addProjectRecord(
  records: Map<string, DashboardProjectRecord>,
  next: DashboardProjectRecord,
): void {
  const existing = records.get(next.identity);
  if (!existing) {
    records.set(next.identity, {
      ...next,
      paths: dedupeStrings(next.paths),
    });
    return;
  }
  records.set(next.identity, {
    ...existing,
    currentPath: next.currentPath,
    paths: dedupeStrings([...existing.paths, ...next.paths]),
    title: next.title ?? existing.title,
    remoteUrlHash: next.remoteUrlHash ?? existing.remoteUrlHash,
    markerId: next.markerId ?? existing.markerId,
    archivedAt: next.archivedAt ?? existing.archivedAt,
  });
}

/**
 * Rebuild full project records from persisted state, re-resolving each path's identity.
 * Legacy state carries only paths, so every path is resolved again and merged into the record map.
 * That also repairs state written before a project gained a Git remote.
 *
 * @param state - parsed state, possibly from an older schema carrying only `paths`
 * @param options - `allowMarkerWrite` true permits creating missing marker files while resolving
 * @returns fully hydrated state with deduplicated paths and per-identity records
 */
export function hydrateDashboardState(
  state: DashboardStateData,
  options: { allowMarkerWrite: boolean },
): DashboardStateData {
  const records = new Map<string, DashboardProjectRecord>();
  for (const record of Object.values(state.projects)) {
    addProjectRecord(records, record);
  }

  for (const path of state.paths) {
    const identity = resolveProjectIdentity(path, {
      allowMarkerWrite: options.allowMarkerWrite,
    });
    const title =
      state.projectTitles[identity.identity] ?? state.projectTitles[path];
    addProjectRecord(records, {
      ...identity,
      paths: [identity.currentPath],
      ...(title ? { title } : {}),
    });
  }

  const projectTitles: Record<string, string> = {};
  for (const record of records.values()) {
    const title =
      record.title ??
      state.projectTitles[record.identity] ??
      state.projectTitles[record.currentPath];
    if (title) {
      record.title = title;
      projectTitles[record.identity] = title;
    }
  }

  const projects = Object.fromEntries(
    [...records.entries()].sort(([a], [b]) => a.localeCompare(b)),
  );
  const paths = dedupeStrings(
    Object.values(projects)
      .filter((record) => !record.archivedAt)
      .flatMap((record) => record.paths),
  );
  return {
    paths,
    favorites: dedupeStrings(state.favorites),
    projectTitles,
    projects,
  };
}

/**
 * Archive or restore one dashboard project without deleting its identity, aliases, or title.
 * Use for explicit Projects-page actions so older path-list saves cannot erase recoverable state.
 *
 * @param state - current dashboard state loaded from disk
 * @param projectPath - validated project directory selected by the user
 * @param archivedAt - archive timestamp, or `null` to restore the project
 * @returns normalized state with the project retained and active paths derived from archive state
 */
export function setDashboardProjectArchived(
  state: DashboardStateData,
  projectPath: string,
  archivedAt: string | null,
): DashboardStateData {
  const currentPath = normalizeProjectPath(projectPath);
  const identity = resolveProjectIdentity(currentPath, {
    allowMarkerWrite: false,
  });
  const matchedRecord =
    state.projects[identity.identity] ??
    Object.values(state.projects).find(
      (record) =>
        record.currentPath === currentPath ||
        record.paths.includes(currentPath),
    );
  const record: DashboardProjectRecord = matchedRecord
    ? {
        ...matchedRecord,
        currentPath,
        paths: dedupeStrings([...matchedRecord.paths, currentPath]),
      }
    : { ...identity, paths: [currentPath] };

  // Archive retains the complete record; restore removes only the archive marker.
  if (archivedAt === null) {
    Reflect.deleteProperty(record, "archivedAt");
  } else {
    record.archivedAt = archivedAt;
  }

  const projects = { ...state.projects, [record.identity]: record };
  const paths =
    archivedAt === null
      ? dedupeStrings([...state.paths, currentPath])
      : state.paths.filter(
          (path) => normalizeProjectPath(path) !== currentPath,
        );

  return hydrateDashboardState(
    { ...state, paths, projects },
    { allowMarkerWrite: false },
  );
}

/** Normalize parsed dashboard state JSON into the server's expected shape. */
function normalizeDashboardState(
  candidate: unknown,
): DashboardStateData | null {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }
  const record = candidate as Record<string, unknown>;
  const paths = readOptionalStringArrayProperty(record, "paths");
  if (paths === null) return null;
  const favorites = readOptionalStringArrayProperty(record, "favorites");
  if (favorites === null) return null;
  const projectTitles = readOptionalStringMapProperty(record, "projectTitles");
  return hydrateDashboardState(
    {
      paths,
      favorites,
      projectTitles,
      projects: readOptionalProjectRecordsProperty(record),
    },
    { allowMarkerWrite: false },
  );
}

/**
 * Read dashboard state from the new file first, then the legacy projects-only file.
 *
 * Swallows malformed or missing state files so the dashboard can recover to empty state.
 *
 * @param dashboardStateFile - current state file path, tried first
 * @param legacyProjectsListFile - older projects-only file, tried when the current one is unusable
 * @returns loaded state, or empty state when neither file yields a usable document
 */
export async function loadDashboardState(
  dashboardStateFile: string,
  legacyProjectsListFile: string,
): Promise<DashboardStateData> {
  const { readFile } = await import("node:fs/promises");
  for (const filePath of [dashboardStateFile, legacyProjectsListFile]) {
    try {
      const parsed = normalizeDashboardState(
        JSON.parse(await readFile(filePath, "utf-8")),
      );
      if (parsed) return parsed;
    } catch {
      /* try next location */
    }
  }
  return { paths: [], favorites: [], projectTitles: {}, projects: {} };
}
