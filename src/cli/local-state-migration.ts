/** Relocate legacy operational state during a quiescent, all-writers-upgraded install. */
import { lstatSync, mkdirSync, readdirSync, renameSync } from "node:fs";
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
    inspectParents(projectPath);
    // Recheck after creating the parent: no occupied destination is admitted for replacement.
    directoryStats(projectPath, from);
    if (directoryStats(projectPath, to) !== null) {
      throw new Error(
        `${to} appeared during migration. Stop all writers before retrying.`,
      );
    }
    assertEmptyLocks(projectPath, LEGACY_LOCKS);
    assertEmptyLocks(projectPath, LOCK_DIRECTORY);
    renameSync(join(projectPath, from), join(projectPath, to));
  }
  return true;
}
