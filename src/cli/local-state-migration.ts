/** Relocate legacy operational state, and save install state before an upgrade, during a quiescent, all-writers-upgraded install. */
import {
  cpSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import type { Stats } from "node:fs";
import { join } from "node:path";

const LEGACY_INSTALL = ".goat-flow/install-state";
const LEGACY_LOCKS = ".goat-flow/write-claims";
const STATE_DIRECTORY = ".goat-flow/state";
const INSTALL_DIRECTORY = `${STATE_DIRECTORY}/install`;
const LOCK_DIRECTORY = `${STATE_DIRECTORY}/locks`;

/**
 * Inspect without following links; only missing paths return null.
 * @throws Error for inaccessible, linked or non-directory paths
 */
function directoryStats(
  projectPath: string,
  relativePath: string,
): Stats | null {
  let stats: Stats;
  try {
    stats = lstatSync(join(projectPath, relativePath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(
      `Could not inspect ${relativePath} before local-state migration.`,
    );
  }
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`${relativePath} must be a project-local directory.`);
  }
  return stats;
}

/** Validate existing ancestors before inspecting either storage generation. */
function inspectParents(projectPath: string): void {
  directoryStats(projectPath, ".goat-flow");
  directoryStats(projectPath, STATE_DIRECTORY);
}

/**
 * Read old installation evidence until apply moves it; never select between two baselines.
 *
 * @param projectPath - selected project root whose local evidence is being read
 * @returns the existing legacy directory or the canonical directory for current and fresh projects
 * @throws Error for unsafe ancestors or two competing installation directories
 */
export function installStateRelativeDirectory(projectPath: string): string {
  inspectParents(projectPath);
  const legacy = directoryStats(projectPath, LEGACY_INSTALL);
  const current = directoryStats(projectPath, INSTALL_DIRECTORY);
  if (legacy && current) {
    throw new Error(
      `Both ${LEGACY_INSTALL} and ${INSTALL_DIRECTORY} exist. Resolve the two directories before installing; neither was overwritten.`,
    );
  }
  return legacy ? LEGACY_INSTALL : INSTALL_DIRECTORY;
}

/**
 * Detect legacy storage before new writers allocate any claims.
 *
 * @param projectPath - selected project root whose old namespace must be absent
 * @returns whether either legacy directory still requires migration
 * @throws Error when an existing ancestor or legacy path cannot be safely inspected
 */
export function hasLegacyLocalState(projectPath: string): boolean {
  inspectParents(projectPath);
  return (
    directoryStats(projectPath, LEGACY_INSTALL) !== null ||
    directoryStats(projectPath, LEGACY_LOCKS) !== null
  );
}

/**
 * Select the existing namespace for explicit claim inspection and recovery without writing.
 *
 * @param projectPath - selected project root containing the operator's claim evidence
 * @returns the sole existing namespace, or the canonical path when neither exists
 * @throws Error for unsafe paths or ambiguous simultaneous namespaces
 */
export function claimInspectionDirectory(projectPath: string): string {
  inspectParents(projectPath);
  const legacy = directoryStats(projectPath, LEGACY_LOCKS);
  const current = directoryStats(projectPath, LOCK_DIRECTORY);
  if (legacy && current) {
    throw new Error(
      `Both ${LEGACY_LOCKS} and ${LOCK_DIRECTORY} exist. Inspect and resolve both directories before migration.`,
    );
  }
  return legacy ? LEGACY_LOCKS : LOCK_DIRECTORY;
}

/**
 * Keep recovery separate from migration, including for unknown or abandoned markers.
 * @throws Error when lock storage is unsafe, unreadable or nonempty
 */
function assertEmptyLocks(projectPath: string, relativePath: string): void {
  if (directoryStats(projectPath, relativePath) === null) return;
  if (readdirSync(join(projectPath, relativePath)).length !== 0) {
    throw new Error(
      `${relativePath} contains outstanding write claims. Stop all writers and explicitly recover abandoned claims before running goat-flow install.`,
    );
  }
}

/**
 * Move complete directories without rewriting their records or merging destinations.
 * Requires all writers stopped and upgraded. Concurrent old-version execution after cutover is unsupported.
 * Each rename preserves its directory; interruption between moves is safely resumed by another install.
 * Side effects: creates the private state parent and renames legacy directories into it.
 *
 * @param projectPath - selected real project root with quiescent legacy storage
 * @returns true when legacy storage was moved; false for fresh or already migrated projects
 * @throws Error when paths are unsafe, destinations are occupied, claims remain, or filesystem operations fail
 */
export function migrateLegacyLocalState(projectPath: string): boolean {
  inspectParents(projectPath);
  const moves = [
    { from: LEGACY_INSTALL, to: INSTALL_DIRECTORY },
    { from: LEGACY_LOCKS, to: LOCK_DIRECTORY },
  ].filter(({ from }) => directoryStats(projectPath, from) !== null);
  if (moves.length === 0) return false;
  for (const { from, to } of moves) {
    if (directoryStats(projectPath, to) !== null) {
      throw new Error(
        `Both ${from} and ${to} exist. Resolve the two directories before installing; neither was overwritten.`,
      );
    }
  }
  assertEmptyLocks(projectPath, LEGACY_LOCKS);
  assertEmptyLocks(projectPath, LOCK_DIRECTORY);
  mkdirSync(join(projectPath, STATE_DIRECTORY), {
    recursive: true,
    mode: 0o700,
  });
  for (const { from, to } of moves) {
    // Recheck after creating the parent: no occupied destination is admitted for replacement.
    directoryStats(projectPath, from);
    if (directoryStats(projectPath, to) !== null) {
      throw new Error(
        `${to} appeared during migration. Stop all writers before retrying.`,
      );
    }
    assertEmptyLocks(projectPath, LEGACY_LOCKS);
    assertEmptyLocks(projectPath, LOCK_DIRECTORY);
    // Validate the unlinked parents last so no other check widens the gap before the rename. Node has no renameat,
    // so a parent swapped inside that gap stays out of reach; the quiescent-writer precondition above covers it.
    inspectParents(projectPath);
    renameSync(join(projectPath, from), join(projectPath, to));
  }
  return true;
}

const INSTALL_BACKUP = `${STATE_DIRECTORY}/install-before-upgrade`;
/** Names the release and folder the copy came from; it sits beside the copy, so restoring the copy never carries it back. */
const INSTALL_BACKUP_RECORD = `${INSTALL_BACKUP}.json`;

/** The saved copy of install state, the folder it was copied from, and whether an earlier attempt of the same upgrade took it. */
export interface InstallStateBackup {
  backup: string;
  source: string;
  isFromEarlierAttempt: boolean;
}

/**
 * Find the copy an earlier, failed attempt of the same upgrade saved. That attempt may have moved or converted install state
 * before it failed, so its copy is the only one that still holds the earlier release's records.
 *
 * @param projectPath - selected real project root whose state folders were already inspected
 * @param fromVersion - release the project's config names now; null never matches a saved copy
 * @returns the kept copy, or null when no copy of this release exists and a new one must be taken
 * @throws Error when the backup path is linked or not a directory, which is refused rather than deleted
 */
function earlierAttemptBackup(
  projectPath: string,
  fromVersion: string | null,
): InstallStateBackup | null {
  const hasCopy = directoryStats(projectPath, INSTALL_BACKUP) !== null;
  const recordPath = join(projectPath, INSTALL_BACKUP_RECORD);
  // Without a known release, a copy, and a regular record file, nothing shows the copy came from this upgrade.
  if (
    fromVersion === null ||
    !hasCopy ||
    !lstatSync(recordPath, { throwIfNoEntry: false })?.isFile()
  )
    return null;
  try {
    const record = JSON.parse(readFileSync(recordPath, "utf8")) as {
      from?: unknown;
      source?: unknown;
    };
    // Only a copy of this same release, taken from one of the two known state folders, is kept.
    return record.from === fromVersion &&
      (record.source === INSTALL_DIRECTORY || record.source === LEGACY_INSTALL)
      ? {
          backup: INSTALL_BACKUP,
          source: record.source,
          isFromEarlierAttempt: true,
        }
      : null;
  } catch {
    // An unreadable record cannot vouch for the copy, so a new copy replaces it.
    return null;
  }
}

/**
 * Copy install state to one backup folder before a version-changing install first writes it, replacing a copy from any other
 * release. A retry of the same upgrade keeps the copy its first attempt took.
 * Side effects: reads the current or legacy install-state folder, creates the private state folder if needed, then rewrites the
 * backup folder and the record beside it.
 *
 * @param projectPath - selected real project root, inspected before the upgrade's first state write
 * @param fromVersion - release the project's config names before this install, recorded beside the copy; null when unknown
 * @returns the backup folder, the folder it holds a copy of, and whether an earlier attempt's copy was kept; null when the project has no install state to copy
 * @throws Error when a state path is linked or not a directory, or the copy fails; the caller stops before any state write
 */
export function backUpInstallState(
  projectPath: string,
  fromVersion: string | null,
): InstallStateBackup | null {
  const source = installStateRelativeDirectory(projectPath);
  const earlier = earlierAttemptBackup(projectPath, fromVersion);
  // A retried upgrade keeps the first attempt's copy, taken before that attempt moved or converted install state.
  if (earlier) return earlier;
  // A fresh project has no install state, so there is nothing to restore.
  if (directoryStats(projectPath, source) === null) return null;
  // The record goes first, so a copy interrupted part-way is never kept as a complete one.
  rmSync(join(projectPath, INSTALL_BACKUP_RECORD), { force: true });
  rmSync(join(projectPath, INSTALL_BACKUP), { recursive: true, force: true });
  mkdirSync(join(projectPath, STATE_DIRECTORY), {
    recursive: true,
    mode: 0o700,
  });
  cpSync(join(projectPath, source), join(projectPath, INSTALL_BACKUP), {
    recursive: true,
    errorOnExist: true,
    force: false,
    verbatimSymlinks: true,
  });
  writeFileSync(
    join(projectPath, INSTALL_BACKUP_RECORD),
    `${JSON.stringify({ from: fromVersion, source })}\n`,
    { mode: 0o600 },
  );
  return { backup: INSTALL_BACKUP, source, isFromEarlierAttempt: false };
}
