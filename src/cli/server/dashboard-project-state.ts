/**
 * Keeps the dashboard's saved projects, titles, favorites, and archive state together.
 *
 * Uses a Git remote hash, then a local marker, then an absolute path to recognise a checkout after the user selects it again.
 * Reads and merges saved state with stable ordering so older path-only lists still appear in Projects.
 *
 * Marker writes are optional; an unsafe state path throws when writing is requested, while read-only lookup can use the path fallback.
 */
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { resolveLocalStatePath } from "./local-paths.js";
import { writeFileAtomic } from "./safe-exec.js";

type ProjectIdentitySource = "git-remote" | "goat-marker" | "path";

/**
 * Identifies the checkout behind a Projects row across supported path changes.
 *
 * The source records whether matching used a remote hash, local marker, or current absolute path.
 * A path-only identity stops matching when the folder moves; optional source fields carry evidence for stronger matches.
 */
export interface DashboardProjectIdentity {
  identity: string;
  identitySource: ProjectIdentitySource;
  currentPath: string;
  remoteUrlHash?: string | undefined;
  markerId?: string | undefined;
}

/**
 * Stores one saved Projects row and its known local paths.
 *
 * An absent title leaves the dashboard free to use its default project label.
 * An archive timestamp hides the row from active projects while retaining its details for Restore.
 */
export interface DashboardProjectRecord extends DashboardProjectIdentity {
  paths: string[];
  title?: string | undefined;
  archivedAt?: string | undefined;
}

/**
 * Defines the local state loaded by the dashboard's Projects page.
 *
 * Paths and favorites support saved lists; identity records retain titles, path aliases, and archive state.
 * Empty collections mean there are no saved entries of that kind, including when neither state file can be loaded.
 */
export interface DashboardStateData {
  paths: string[];
  favorites: string[];
  projectTitles: Record<string, string>;
  projects: Record<string, DashboardProjectRecord>;
}

// Hash the remote identity input so saved project keys do not contain the raw remote URL.
function hashString(inputText: string): string {
  return createHash("sha256").update(inputText).digest("hex");
}

const PROJECT_MARKER_COMMENT =
  "# Local goat-flow dashboard project identity. Gitignored by default.";

// Accept a saved identity source; null means the row cannot be restored with a recognised matching rule.
function identitySourceFrom(candidate: unknown): ProjectIdentitySource | null {
  return candidate === "git-remote" ||
    candidate === "goat-marker" ||
    candidate === "path"
    ? candidate
    : null;
}

// Preserve first-seen saved paths or favorites while dropping empty values and duplicates.
function dedupeStrings(values: string[]): string[] {
  const result: string[] = [];
  // Keep the user's saved ordering while checking each path or favorite.
  for (const candidate of values) {
    // Empty values cannot identify a saved item; repeated values do not need another row.
    if (candidate && !result.includes(candidate)) result.push(candidate);
  }
  return result;
}

// Resolve a project path to its realpath, with fallback when realpath lookup fails.
function normalizeProjectPath(projectPath: string): string {
  const resolved = resolve(projectPath);
  try {
    return realpathSync(resolved);
  } catch {
    // A saved folder may have been removed since the last visit; keep its absolute path so the user can still archive the row.
    return resolved;
  }
}

// Probe optional project directories; swallows permission and removal races.
function directoryExists(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    // A moved project folder may be missing or unreadable; treat it as unavailable for marker lookup or identity changes.
    return false;
  }
}

// Canonicalise a git remote host/path pair into the identity hash input.
function cleanRemotePath(host: string | undefined, path: string | undefined) {
  const remotePath = path?.replace(/^\/+/u, "");
  // A remote without both host and repository path cannot identify the selected checkout.
  if (!host || !remotePath) return null;
  return `${host.toLowerCase()}/${remotePath}`
    .replace(/\.git$/u, "")
    .replace(/\/+$/u, "");
}

// Normalise `git@host:owner/repo` remotes before URL parsing gets a chance.
function normalizeScpLikeRemote(trimmed: string): string | null {
  const scpLike = trimmed.match(/^(?:[^@/\s]+@)?([^:/\s]+):(.+)$/u);
  // URL-style or unmatched remotes still need the next parser before choosing a project identity.
  if (!scpLike || trimmed.includes("://")) return null;
  return cleanRemotePath(scpLike[1], scpLike[2]);
}

// Normalise URL-style git remotes; swallows invalid URL inputs as `null`.
function normalizeUrlRemote(trimmed: string): string | null {
  try {
    const parsed = new URL(trimmed);
    return cleanRemotePath(parsed.hostname, parsed.pathname);
  } catch {
    // A configured remote may not be a URL; the caller can still use its cleaned text or another identity source.
    return null;
  }
}

// Build the stable remote identity string used before hashing project records.
function normalizeGitRemoteUrl(raw: string): string | null {
  const trimmed = raw.trim();
  // No configured remote leaves marker or path matching responsible for the Projects row.
  if (!trimmed) return null;
  // Try supported remote formats first; an unrecognised non-empty remote still contributes its cleaned text.
  return (
    normalizeScpLikeRemote(trimmed) ??
    normalizeUrlRemote(trimmed) ??
    trimmed.replace(/\.git$/u, "").replace(/\/+$/u, "")
  );
}

// Spawns `git config` with a short timeout; swallows failures into marker/path fallback.
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
    // A selected folder may have no Git repository or origin; this optional lookup falls back to the local marker or path.
    return null;
  }
}

// Read the first non-comment project marker line; swallows missing marker files.
function readProjectMarkerIdentifier(markerPath: string): string | null {
  try {
    const raw = readFileSync(markerPath, "utf-8");
    // Inspect the local marker until its first identity value can reconnect this folder with a saved row.
    for (const line of raw.split(/\r?\n/u)) {
      const trimmed = line.trim();
      // Blank lines and explanatory comments do not identify a saved project.
      if (!trimmed || trimmed.startsWith("#")) continue;
      return trimmed;
    }
  } catch {
    // A checkout may not have a marker yet; ignore this optional read failure so the caller can create one or match by path.
  }
  // A missing or comment-only marker provides no identity for this checkout.
  return null;
}

// Writes a gitignored project marker; swallows read-only projects as `null`.
function writeProjectMarkerIdentifier(
  markerPath: string,
  projectRoot: string,
): string | null {
  try {
    const markerIdentifier = `gf_${randomUUID()}`;
    writeFileAtomic(
      markerPath,
      `${PROJECT_MARKER_COMMENT}\n${markerIdentifier}\n`,
      projectRoot,
    );
    return markerIdentifier;
  } catch {
    // A read-only project can reject the marker write; the dashboard still opens it using its path.
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
  // No usable remote leaves the local marker or path to identify this checkout.
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
 * Identify a checkout by its local marker when Git remote matching is unavailable.
 * Throws for an unsafe state path only when a marker write was requested; read-only lookup can recover with a path identity.
 *
 * @param currentPath - realpath-normalised project root
 * @param allowMarkerWrite - true permits creating a missing marker; false keeps the call read-only
 * @returns the marker identity, or null when the directory, safe marker path, readable value, or permitted write is unavailable
 */
function resolveMarkerIdentity(
  currentPath: string,
  allowMarkerWrite: boolean,
): DashboardProjectIdentity | null {
  const goatFlowDir = join(currentPath, ".goat-flow");
  // Projects without a readable harness directory use path identity when no remote is available.
  if (!directoryExists(goatFlowDir)) return null;
  let markerPath: string | null = null;
  try {
    markerPath = resolveLocalStatePath(currentPath, "project-id");
  } catch (err) {
    // A state-directory symlink may escape the project; read-only lookup can ignore it and use path identity.
    // A requested marker write must report the unsafe path instead of using that location.
    if (allowMarkerWrite) throw err;
  }
  // A rejected marker path stays unused; a missing value is created only when this operation permits local state writes.
  const markerIdentifier =
    markerPath === null
      ? null
      : (readProjectMarkerIdentifier(markerPath) ??
        (allowMarkerWrite
          ? writeProjectMarkerIdentifier(markerPath, currentPath)
          : null));
  // Without a readable or newly written marker, the Projects row uses its path identity.
  if (!markerIdentifier) return null;
  return {
    identity: `goat-marker:${markerIdentifier}`,
    identitySource: "goat-marker",
    currentPath,
    markerId: markerIdentifier,
  };
}

/**
 * Resolve the identity used to recognise a project when the user selects its folder again.
 * Try the remote, local marker, then path; requested marker writes can still report an unsafe state path.
 *
 * @param projectPath - project root as the user selected it; normalised to a realpath first
 * @param options - `allowMarkerWrite` true permits creating a missing marker; omitted or empty options keep lookup read-only
 * @returns an identity on success; the final path fallback is non-null but cannot follow a folder move
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

// Read a saved paths or favorites list; absent lists become empty, while malformed lists reject this state file.
function readOptionalStringArrayProperty(
  stateRecord: Record<string, unknown>,
  key: string,
): string[] | null {
  const raw = stateRecord[key];
  // Older state files may omit this list; the dashboard starts that collection empty.
  if (raw === undefined) return [];
  // A malformed saved list makes this state file unusable so loading can try the legacy file.
  if (!Array.isArray(raw)) return null;
  const items: string[] = [];
  // Check every saved entry before rebuilding the user's projects and favorites.
  for (const entry of raw) {
    // A non-text entry cannot identify a path or favorite; reject the list instead of inventing a saved value.
    if (typeof entry !== "string") return null;
    items.push(entry);
  }
  return items;
}

/**
 * Read saved titles keyed by project identity or legacy path.
 * Drop invalid titles independently so a bad label cannot discard the user's saved project list.
 */
function readOptionalStringMapProperty(
  stateRecord: Record<string, unknown>,
  key: string,
): Record<string, string> {
  const raw = stateRecord[key];
  // State saved before custom titles existed has no labels to restore.
  if (raw === undefined) return {};
  // An invalid title collection leaves default labels available while other saved state remains usable.
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const result: Record<string, string> = {};
  // Restore each usable custom label under its saved identity or path.
  for (const [projectKey, candidateTitle] of Object.entries(raw)) {
    // Only non-empty text can replace a project's default label.
    if (typeof candidateTitle === "string" && candidateTitle.length > 0)
      result[projectKey] = candidateTitle;
  }
  return result;
}

// Normalise legacy project-record paths before merging them into identity records.
function normalizeProjectRecordPaths(record: Record<string, unknown>) {
  // Missing or malformed aliases contribute no older locations; valid text paths can still reconnect a saved row.
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
  // Missing, empty, or non-text fields supply no saved identity or optional display value.
  return typeof fieldValue === "string" && fieldValue.length > 0
    ? fieldValue
    : null;
}

/**
 * Copy usable identity details and a trimmed title onto a saved project row.
 * Mutates the row only for present values so later merges can preserve details from another record.
 *
 * @param normalized - record being built; absent optional values remain unset
 * @param record - parsed record; missing, empty, or malformed optional fields supply no replacement value
 * @returns nothing; usable fields are assigned to `normalized`
 */
function applyOptionalProjectRecordFields(
  normalized: DashboardProjectRecord,
  record: Record<string, unknown>,
): void {
  const remoteUrlHash = readRecordString(record, "remoteUrlHash");
  const markerId = readRecordString(record, "markerId");
  const title = readRecordString(record, "title")?.trim();
  const archivedAt = readRecordString(record, "archivedAt");
  // Retain a usable remote hash so the row can keep its remote-backed identity.
  if (remoteUrlHash) normalized.remoteUrlHash = remoteUrlHash;
  // Retain a usable local marker so this checkout can be recognised without a remote.
  if (markerId) normalized.markerId = markerId;
  // Blank labels leave the default name available; custom titles stay within the dashboard's 120-character limit.
  if (title) normalized.title = title.slice(0, 120);
  // An archive timestamp keeps this saved row out of active projects until Restore.
  if (archivedAt) normalized.archivedAt = archivedAt;
}

/**
 * Validate one saved Projects row before the dashboard restores it.
 * Reject incomplete identity data because a partial record cannot reliably identify or locate the checkout.
 *
 * @param identity - map key used as the identity when the record does not carry its own
 * @param candidate - parsed value; null, arrays, and non-objects cannot describe a saved row
 * @returns the normalised record, or null when required fields are missing or malformed
 */
function normalizeDashboardProjectRecord(
  identity: string,
  candidate: unknown,
): DashboardProjectRecord | null {
  // A non-record value cannot restore a Projects row, but other saved records can still load.
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }
  const record = candidate as Record<string, unknown>;
  // Older rows may rely on their map key instead of repeating the identity inside the record.
  const identityValue = readRecordString(record, "identity") ?? identity;
  const identitySource = identitySourceFrom(record.identitySource);
  const currentPath = readRecordString(record, "currentPath");
  // The row needs an identity, a recognised source, and a location before the dashboard can reuse it.
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
  // Missing or malformed identity records leave legacy path lists available for rebuilding Projects.
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const records: Record<string, DashboardProjectRecord> = {};
  // Validate each saved row separately so one damaged entry does not hide every project.
  for (const [identity, record] of Object.entries(raw)) {
    const normalized = normalizeDashboardProjectRecord(identity, record);
    // Only a usable row is restored under its own identity.
    if (normalized) records[normalized.identity] = normalized;
  }
  return records;
}

/**
 * Merge one project record into the accumulating identity map.
 *
 * An existing entry keeps its optional fields unless the incoming record supplies them, so re-adding a project by a new path never discards the title
 * or marker learned earlier.
 *
 * @param records - accumulator keyed by identity
 * @param next - record to merge; its `currentPath` always wins as the most recent location
 * @returns nothing; the result is the merged entry in `records`. It mutates the `records` map in place.
 */
function addProjectRecord(
  records: Map<string, DashboardProjectRecord>,
  next: DashboardProjectRecord,
): void {
  const existing = records.get(next.identity);
  // The first record for this identity establishes the row and its known paths.
  if (!existing) {
    records.set(next.identity, {
      ...next,
      paths: dedupeStrings(next.paths),
    });
    return;
  }
  // Merge another location into this row; absent incoming labels or identity details preserve saved values.
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
 * Rebuild project rows from saved identity records and legacy path lists.
 *
 * Resolve listed paths again to reflect current identities, then keep stable row ordering and omit archived records from active paths.
 *
 * @param state - parsed state, possibly from an older schema carrying only paths; empty collections produce an empty saved list
 * @param options - `allowMarkerWrite` true permits creating missing local markers while resolving paths
 * @returns hydrated state with deduplicated paths and per-identity records
 */
export function hydrateDashboardState(
  state: DashboardStateData,
  options: { allowMarkerWrite: boolean },
): DashboardStateData {
  const records = new Map<string, DashboardProjectRecord>();
  // Retain saved identity records first, including archived rows absent from the active path list.
  for (const record of Object.values(state.projects)) {
    addProjectRecord(records, record);
  }

  // Revisit each active saved path so older path-only state can acquire its current project identity.
  for (const path of state.paths) {
    const identity = resolveProjectIdentity(path, {
      allowMarkerWrite: options.allowMarkerWrite,
    });
    // Prefer the identity label; a legacy path label still follows the project into its rebuilt row.
    const title =
      state.projectTitles[identity.identity] ?? state.projectTitles[path];
    addProjectRecord(records, {
      ...identity,
      paths: [identity.currentPath],
      ...(title ? { title } : {}),
    });
  }

  const projectTitles: Record<string, string> = {};
  // Collect one custom title per identity after all saved locations have been merged.
  for (const record of records.values()) {
    // Use the row's title first, then identity and path labels; no match leaves the default label available.
    const title =
      record.title ??
      state.projectTitles[record.identity] ??
      state.projectTitles[record.currentPath];
    // A non-empty custom label follows this row into the rebuilt title map.
    if (title) {
      record.title = title;
      projectTitles[record.identity] = title;
    }
  }

  const projects = Object.fromEntries(
    [...records.entries()].sort(([leftIdentity], [rightIdentity]) =>
      leftIdentity.localeCompare(rightIdentity),
    ),
  );
  // Archived rows retain their saved details but contribute no paths to the active Projects list.
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
 * Tell whether a path is one of the saved project rows, so a row whose folder was deleted can still be archived by the exact path the user saved.
 * Use before acting on a path that failed folder validation.
 *
 * @param state - saved dashboard state loaded from disk; an empty `projects` map means no row can match
 * @param projectPath - path as the user saved it; resolved to its real location when the folder still exists, else to its absolute form
 * @returns true when some row's current path or alias list contains that path
 */
export function dashboardStateHasProjectPath(
  state: DashboardStateData,
  projectPath: string,
): boolean {
  const currentPath = normalizeProjectPath(projectPath);
  return Object.values(state.projects).some(
    (record) =>
      record.currentPath === currentPath || record.paths.includes(currentPath),
  );
}

/**
 * Find the freshly resolved identity a saved row should move to, when its folder now resolves differently than the key it was saved under.
 *
 * Use during a whole-list save, where every posted path has just been resolved, so a checkout whose git remote changed is not treated as a different
 * project.
 *
 * @param record - one saved row; its current path and known paths are what the match runs on
 * @param resolvedIdentities - identities resolved for the posted paths, in posted order
 * @returns the identity to move the row to, or null when no posted path names this row or its key already matches
 */
export function freshIdentityForSavedRecord(
  record: DashboardProjectRecord,
  resolvedIdentities: readonly DashboardProjectIdentity[],
): DashboardProjectIdentity | null {
  const fresh = resolvedIdentities.find(
    (candidate) =>
      record.currentPath === candidate.currentPath ||
      record.paths.includes(candidate.currentPath),
  );
  // No posted path match, or an unchanged identity, means the saved row needs no new key.
  if (fresh === undefined || fresh.identity === record.identity) return null;
  return fresh;
}

/**
 * Move a saved row onto a freshly resolved identity in place, so the Projects list never shows the same checkout twice.
 * Use after the folder has been proven to exist and resolve to that identity.
 *
 * @param record - the row to move; its title and known paths stay as they were
 * @param identity - identity the folder resolves to now; its fields replace the row's identity, remote hash, and marker id
 * @returns nothing; the row is mutated in place
 */
export function moveProjectRecordToIdentity(
  record: DashboardProjectRecord,
  identity: DashboardProjectIdentity,
): void {
  // Clear the old key's identity fields before copying the new identity in, so a stale remote hash or marker id cannot survive the move.
  Reflect.deleteProperty(record, "remoteUrlHash");
  Reflect.deleteProperty(record, "markerId");
  Object.assign(record, identity);
}

/**
 * Decide whether a row that was found only by its path must move to the folder's freshly resolved identity.
 * Use while archiving or restoring, after the row has been matched, so the Projects list never shows the same checkout twice.
 *
 * @param matchedRecord - the saved row the click landed on; undefined means the folder was never saved and nothing can move
 * @param wasIdentityMatch - true when the row was found under the folder's current identity, so it already sits at the right key
 * @param identity - identity the folder resolves to right now, for example a new `git-remote:` key after the user added a remote
 * @param currentPath - folder of the row; a folder that no longer exists cannot prove a new identity
 * @returns the old key to drop after re-keying, or null when the row keeps the key it was saved under
 */
function obsoleteIdentityAfterRekey(
  matchedRecord: DashboardProjectRecord | undefined,
  wasIdentityMatch: boolean,
  identity: DashboardProjectIdentity,
  currentPath: string,
): string | null {
  // A row found only by path may now resolve to a different identity, for example the folder gained a git remote while it was archived.
  //
  // Move it to that key, or the list would show the same checkout twice after restore.
  // A folder that no longer exists cannot prove a new identity, so a stale row being archived keeps the key it was saved under.
  return matchedRecord &&
    !wasIdentityMatch &&
    matchedRecord.identity !== identity.identity &&
    directoryExists(currentPath)
    ? matchedRecord.identity
    : null;
}

/**
 * Archive or restore one dashboard project without losing its identity, known paths, or title.
 * Use for the Archive and Restore buttons on the Projects page, so an older whole-list save cannot erase a row the user may want back.
 *
 * @param state - saved dashboard state loaded from disk
 * @param projectPath - folder of the row the user clicked; for archive it may be a saved path whose folder no longer exists
 * @param archivedAt - archive timestamp, or `null` to restore the project
 * @returns rebuilt state with the row kept and the active path list derived from what is archived
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
  // Prefer the row saved under this folder's current identity; otherwise any row that lists the folder among its known paths,
  // which is how a project saved before it gained a git remote is found again.
  const identityMatchedRecord = state.projects[identity.identity];
  const matchedRecord =
    identityMatchedRecord ??
    Object.values(state.projects).find(
      (record) =>
        record.currentPath === currentPath ||
        record.paths.includes(currentPath),
    );
  // A known row keeps its title and known paths; a folder never saved before becomes a fresh row.
  const record: DashboardProjectRecord = matchedRecord
    ? {
        ...matchedRecord,
        currentPath,
        paths: dedupeStrings([...matchedRecord.paths, currentPath]),
      }
    : { ...identity, paths: [currentPath] };

  const obsoleteIdentity = obsoleteIdentityAfterRekey(
    matchedRecord,
    identityMatchedRecord !== undefined,
    identity,
    currentPath,
  );
  // A confirmed identity change moves this row before its archive state is saved.
  if (obsoleteIdentity !== null) moveProjectRecordToIdentity(record, identity);

  // Archive keeps the complete row; restore removes only the archive marker.
  if (archivedAt === null) {
    Reflect.deleteProperty(record, "archivedAt");
  } else {
    record.archivedAt = archivedAt;
  }

  const projects = { ...state.projects, [record.identity]: record };
  // Without this the old key would come back as a second row when the state is rebuilt below.
  if (obsoleteIdentity !== null) {
    Reflect.deleteProperty(projects, obsoleteIdentity);
  }
  // Restore puts the folder back in the active list; archive takes every spelling of it out.
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

// Normalize parsed dashboard state JSON into the server's expected shape.
function normalizeDashboardState(
  candidate: unknown,
): DashboardStateData | null {
  // A non-object state file cannot restore saved projects; loading can try the older file.
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }
  const record = candidate as Record<string, unknown>;
  const paths = readOptionalStringArrayProperty(record, "paths");
  // A malformed saved path list rejects this state file instead of silently replacing the user's projects.
  if (paths === null) return null;
  const favorites = readOptionalStringArrayProperty(record, "favorites");
  // A malformed favorites list also rejects this file; a missing list was already accepted as empty.
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
  // Try the current state first, then the legacy file so saved projects survive the format transition.
  for (const filePath of [dashboardStateFile, legacyProjectsListFile]) {
    try {
      const parsed = normalizeDashboardState(
        JSON.parse(await readFile(filePath, "utf-8")),
      );
      // The first usable file supplies saved projects; invalid shapes leave the next location available.
      if (parsed) return parsed;
    } catch {
      // A missing file or interrupted JSON save can leave state unreadable; try the next location before showing an empty saved list.
    }
  }
  return { paths: [], favorites: [], projectTitles: {}, projects: {} };
}
