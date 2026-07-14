/**
 * Validates and stores the hash-only baseline used by managed setup previews.
 * Users rely on this local state after an install to distinguish their edits
 * from later goat-flow template changes without storing file contents.
 * Preview and install flows use this module at the target-project trust boundary.
 */
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  type Stats,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, posix } from "node:path";

import type {
  ManagedSetupBaselineStatus,
  ManagedSetupPreview,
} from "./managed-setup-preview.js";
import type { AgentId } from "./types.js";

const MANAGED_INSTALL_STATE_SCHEMA = "goat-flow.install-state.v1" as const;

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

/** One managed destination and the package hash supplied by the last successful install. */
interface ManagedInstallStateEntry {
  path: string;
  expectedSha256: string;
}

/**
 * Gitignored hash-only baseline used by the user's next setup preview.
 * Schema, selected agent, and sorted relative paths are required before any hash is trusted.
 */
interface ManagedInstallState {
  schemaVersion: typeof MANAGED_INSTALL_STATE_SCHEMA;
  agent: AgentId;
  goatFlowVersion: string;
  files: ManagedInstallStateEntry[];
}

/** Parsed baseline outcome; invalid state blocks installs instead of being guessed away. */
export interface ManagedInstallBaseline {
  status: ManagedSetupBaselineStatus;
  expectedHashes: Map<string, string>;
  error: string | null;
}

/**
 * Return the gitignored baseline path for the selected agent's next setup preview.
 * Use when previewing or recording one agent-specific managed installation.
 *
 * @param projectPath - selected project root; empty is invalid upstream and is never shown as a target
 * @param agent - selected agent whose managed mirror is compared; never null after CLI validation
 * @returns absolute local state path; never empty for a validated project and agent
 */
export function managedInstallStatePath(
  projectPath: string,
  agent: AgentId,
): string {
  return join(projectPath, ".goat-flow", "install-state", `${agent}.json`);
}

/**
 * Confirm a persisted path stays inside the selected project.
 * Use before a target-provided baseline can influence the paths shown to the user.
 *
 * @param candidatePath - stored relative path; empty means the baseline cannot identify a managed file
 * @returns true only for a portable repository-relative path; never null
 */
function isSafeRelativePath(candidatePath: string): boolean {
  // Empty, absolute, Windows-shaped, and traversal paths cannot identify managed target files.
  if (
    candidatePath.length === 0 ||
    isAbsolute(candidatePath) ||
    candidatePath.includes("\\") ||
    candidatePath.split("/").includes("..")
  ) {
    return false;
  }
  return posix.normalize(candidatePath) === candidatePath;
}

/**
 * Narrow unknown JSON before reading named install-state fields.
 * Use when a target may contain malformed or non-object baseline data.
 *
 * @param value - parsed target JSON; null or an array means no usable object was supplied
 * @returns true for a named-field object; false means the preview must reject the baseline
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  // Null and list-shaped JSON cannot provide the named fields a user baseline requires.
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Validate baseline metadata before accepting any target-provided file rows.
 * Use to keep incompatible or cross-agent state from authorizing an overwrite.
 *
 * @param rawState - parsed state; null or empty metadata means no trustworthy baseline is available
 * @param expectedAgent - selected CLI agent; never null after command validation
 * @returns untrusted file rows for per-entry validation; empty means the prior install managed no files
 */
function validatedManagedStateFiles(
  rawState: unknown,
  expectedAgent: AgentId,
): unknown[] {
  // Without a JSON object, the UI cannot trust any previous-install evidence.
  if (!isRecord(rawState)) {
    throw new Error("Install state must be a JSON object.");
  }
  // A different schema may use incompatible fields, so the preview blocks for migration.
  if (rawState["schemaVersion"] !== MANAGED_INSTALL_STATE_SCHEMA) {
    throw new Error(
      `Install state schema must be ${MANAGED_INSTALL_STATE_SCHEMA}.`,
    );
  }
  // Agent-specific state cannot authorize writes into another agent's skill mirror.
  if (rawState["agent"] !== expectedAgent) {
    throw new Error(`Install state agent must be ${expectedAgent}.`);
  }
  // Missing version metadata prevents users from tracing which package created the baseline.
  if (
    typeof rawState["goatFlowVersion"] !== "string" ||
    rawState["goatFlowVersion"].length === 0
  ) {
    throw new Error(
      "Install state goatFlowVersion must be a non-empty string.",
    );
  }
  // Missing file rows leave the preview with no trustworthy path-to-hash mapping.
  if (!Array.isArray(rawState["files"])) {
    throw new Error("Install state files must be an array.");
  }
  return rawState["files"];
}

/**
 * Validate one persisted file row before it can protect or authorize a managed path.
 * It throws safe repair text when invalid paths or hashes cannot protect the user.
 *
 * @param rawEntry - one parsed row; null or empty fields cannot identify prior installed bytes
 * @returns safe relative path and SHA-256 hash; never null after validation
 */
function parseManagedStateEntry(rawEntry: unknown): ManagedInstallStateEntry {
  // Non-object rows cannot identify one managed path for the user's next preview.
  if (!isRecord(rawEntry)) {
    throw new Error("Every install state file entry must be an object.");
  }
  const managedPath = rawEntry["path"];
  const expectedSha256 = rawEntry["expectedSha256"];
  // Unsafe paths could make a target-controlled baseline read outside the selected project.
  if (typeof managedPath !== "string" || !isSafeRelativePath(managedPath)) {
    throw new Error(
      "Install state paths must be safe repository-relative paths.",
    );
  }
  // Invalid hashes cannot prove which bytes the previous install supplied.
  if (
    typeof expectedSha256 !== "string" ||
    !SHA256_PATTERN.test(expectedSha256)
  ) {
    throw new Error(`Install state hash for ${managedPath} must be SHA-256.`);
  }
  return { path: managedPath, expectedSha256 };
}

/**
 * Validate and index one hash-only baseline for the selected agent.
 * Use before comparing user files so duplicate or unsafe rows cannot weaken protection.
 *
 * @param rawState - parsed state object; null or malformed values are rejected
 * @param expectedAgent - selected agent; never null after CLI validation
 * @returns path-to-hash map; empty means the prior install managed no exact-copy files
 */
function parseManagedInstallState(
  rawState: unknown,
  expectedAgent: AgentId,
): Map<string, string> {
  const rawFiles = validatedManagedStateFiles(rawState, expectedAgent);
  const expectedHashes = new Map<string, string>();
  // Each row is independently validated so one corrupt path cannot weaken overwrite protection.
  for (const rawFile of rawFiles) {
    const file = parseManagedStateEntry(rawFile);
    // Duplicate identities make the old expected bytes ambiguous for one visible path.
    if (expectedHashes.has(file.path)) {
      throw new Error(`Install state contains duplicate path ${file.path}.`);
    }
    expectedHashes.set(file.path, file.expectedSha256);
  }
  return expectedHashes;
}

/**
 * Read local path metadata without exposing the absolute target path in errors.
 * Use before reading or writing state so target symlinks cannot silently redirect the flow.
 *
 * @param pathToInspect - absolute local path; empty is invalid upstream and cannot be inspected
 * @param displayPath - repository-relative label shown to the user; empty would make errors unusable
 * @returns path metadata, or null when the path does not exist and first-install behavior applies
 */
function readStatePathStats(
  pathToInspect: string,
  displayPath: string,
): Stats | null {
  try {
    return lstatSync(pathToInspect);
  } catch (error) {
    // For example, a first-time user has no install-state directory yet, so setup may create it later.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw new Error(
      `Could not inspect ${displayPath} before recording install state.`,
    );
  }
}

/**
 * Require project-local directories before any baseline read or write.
 * Use at the state trust boundary so users never follow a redirected parent path.
 * Throws safe relative-path errors that preview converts into an invalid-state block.
 *
 * @param projectPath - selected target root; empty is invalid upstream and cannot contain local state
 */
function assertManagedStateParentDirectories(projectPath: string): void {
  const parentDirectories = [
    { path: join(projectPath, ".goat-flow"), displayPath: ".goat-flow" },
    {
      path: join(projectPath, ".goat-flow", "install-state"),
      displayPath: ".goat-flow/install-state",
    },
  ];
  // Existing parents must be real directories so a target symlink cannot redirect state evidence.
  for (const parent of parentDirectories) {
    const stats = readStatePathStats(parent.path, parent.displayPath);
    // A non-directory parent could expose or replace state outside the project the user selected.
    if (stats !== null && !stats.isDirectory()) {
      throw new Error(
        `${parent.displayPath} must be a project-local directory.`,
      );
    }
  }
}

/**
 * Load the previous CLI install baseline without trusting target-controlled bytes.
 * Use before every preview; malformed or redirected state is visible and blocks by default.
 *
 * @param projectPath - selected target root; empty is invalid upstream and yields no useful state path
 * @param agent - selected agent baseline; never null after CLI validation
 * @returns loaded hashes, missing first-install state, or an invalid result with safe user-facing detail
 */
export function readManagedInstallBaseline(
  projectPath: string,
  agent: AgentId,
): ManagedInstallBaseline {
  const statePath = managedInstallStatePath(projectPath, agent);
  let stateStats: Stats | null;
  try {
    assertManagedStateParentDirectories(projectPath);
    stateStats = readStatePathStats(
      statePath,
      `.goat-flow/install-state/${agent}.json`,
    );
  } catch (error) {
    // For example, a copied project may retain an install-state symlink into another checkout.
    const safeErrorMessage =
      error instanceof Error
        ? error.message
        : "Install state path could not be inspected safely.";
    return {
      status: "invalid",
      expectedHashes: new Map(),
      error: safeErrorMessage,
    };
  }
  // A first install has no baseline and relies on current-vs-template byte evidence.
  if (stateStats === null) {
    return { status: "missing", expectedHashes: new Map(), error: null };
  }
  // A state symlink or directory could expose unrelated data, so never read it.
  if (!stateStats.isFile()) {
    return {
      status: "invalid",
      expectedHashes: new Map(),
      error: "Install state must be a regular project-local file.",
    };
  }
  let serializedState: string;
  try {
    serializedState = readFileSync(statePath, "utf-8");
  } catch {
    // For example, a user may remove read permission after opening the preview command.
    return {
      status: "invalid",
      expectedHashes: new Map(),
      error: "Install state could not be read.",
    };
  }
  let rawState: unknown;
  try {
    rawState = JSON.parse(serializedState) as unknown;
  } catch {
    // For example, a partial manual edit can leave the local state file as invalid JSON.
    return {
      status: "invalid",
      expectedHashes: new Map(),
      error: "Install state is not valid JSON.",
    };
  }
  try {
    return {
      status: "loaded",
      expectedHashes: parseManagedInstallState(rawState, agent),
      error: null,
    };
  } catch (error) {
    // For example, a copied state file may name another agent or contain an obsolete schema.
    const safeErrorMessage =
      error instanceof Error ? error.message : "Install state is invalid.";
    return {
      status: "invalid",
      expectedHashes: new Map(),
      error: safeErrorMessage,
    };
  }
}

/**
 * Refuse state writes through target-controlled symlinks or non-directory parents.
 * Use after install verification and before creating the user's next local baseline.
 *
 * @param projectPath - selected target root; empty is invalid upstream and cannot safely contain state
 * @param agent - installed agent whose state file may be replaced; never null after CLI validation
 */
function assertManagedStateWritePath(
  projectPath: string,
  agent: AgentId,
): void {
  assertManagedStateParentDirectories(projectPath);
  const statePath = managedInstallStatePath(projectPath, agent);
  const stateStats = readStatePathStats(
    statePath,
    `.goat-flow/install-state/${agent}.json`,
  );
  // An existing baseline may be replaced only when it is a regular local file.
  if (stateStats !== null && !stateStats.isFile()) {
    throw new Error(
      `.goat-flow/install-state/${agent}.json must be a project-local regular file.`,
    );
  }
}

/**
 * Persist verified package hashes after a successful CLI install.
 * Use only after current target bytes match the preview's package templates.
 *
 * @param projectPath - selected target root; empty is invalid upstream and cannot store state safely
 * @param preview - verified managed report; an empty files list records an empty baseline
 */
export function writeManagedInstallState(
  projectPath: string,
  preview: ManagedSetupPreview,
): void {
  const files: ManagedInstallStateEntry[] = [];
  // Only paths still managed by this package belong in the next expected baseline.
  for (const file of preview.files) {
    // Retired paths stay out of the next baseline so future previews do not claim ownership.
    if (file.newExpectedSha256 === null) continue;
    files.push({
      path: file.path,
      expectedSha256: file.newExpectedSha256,
    });
  }
  // Stable ordering keeps the next preview's baseline readable and deterministic.
  files.sort((left, right) => left.path.localeCompare(right.path));

  const state: ManagedInstallState = {
    schemaVersion: MANAGED_INSTALL_STATE_SCHEMA,
    agent: preview.agent,
    goatFlowVersion: preview.goatFlowVersion,
    files,
  };
  const statePath = managedInstallStatePath(projectPath, preview.agent);
  const temporaryPath = `${statePath}.tmp-${process.pid}`;
  assertManagedStateWritePath(projectPath, preview.agent);
  mkdirSync(dirname(statePath), { recursive: true });
  try {
    writeFileSync(
      temporaryPath,
      `${JSON.stringify(state, null, 2)}\n`,
      "utf-8",
    );
    renameSync(temporaryPath, statePath);
  } catch (error) {
    // For example, a user may make install-state read-only between preview and apply.
    rmSync(temporaryPath, { force: true });
    throw error;
  }
}
