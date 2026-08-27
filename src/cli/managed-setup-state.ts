/**
 * Validates and stores the hash-only baseline used by managed setup previews.
 *
 * Users rely on this local state after an install to distinguish their edits from later goat-flow template changes without storing file contents.
 * Preview and install flows use this module at the target-project trust boundary.
 */
import { createHash } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  type Stats,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, posix, win32 } from "node:path";

import type { ManagedSetupPreview } from "./managed-setup-preview.js";
import { compareVersions, isReleaseVersion } from "./version-compare.js";
import { KNOWN_AGENT_IDS, type AgentId } from "./types.js";

const MANAGED_INSTALL_STATE_SCHEMA = "goat-flow.install-state.v1" as const;

/** Project-wide schema accepted by the ADR-064 state facade. */
const MANAGED_INSTALL_STATE_V2_SCHEMA = "goat-flow.install-state.v2" as const;

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
  const pathSegments = candidatePath.split("/");
  // Empty, absolute, Windows-shaped, and traversal paths cannot identify managed target files.
  if (
    candidatePath.length === 0 ||
    isAbsolute(candidatePath) ||
    win32.isAbsolute(candidatePath) ||
    candidatePath.includes("\\") ||
    candidatePath.includes("\0") ||
    pathSegments.some(
      (pathSegment) =>
        pathSegment.length === 0 || pathSegment === "." || pathSegment === "..",
    )
  ) {
    return false;
  }
  return posix.normalize(candidatePath) === candidatePath;
}

/**
 * Narrow unknown JSON before reading named install-state fields.
 * Use when a target may contain malformed or non-object baseline data.
 *
 * @param candidate - parsed target JSON; null or an array means no usable object was supplied
 * @returns true for a named-field object; false means the preview must reject the baseline
 */
function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  // Null and list-shaped JSON cannot provide the named fields a user baseline requires.
  return (
    candidate !== null &&
    typeof candidate === "object" &&
    !Array.isArray(candidate)
  );
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
 * Read local path metadata without exposing the absolute target path in errors.
 *
 * Use before reading or writing state so target symlinks cannot silently redirect the flow.
 * Error behavior: throws with the repo-relative label only, so an absolute target path is never echoed back to the user.
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
 * Refuse state writes through target-controlled symlinks or non-directory parents.
 *
 * Use after install verification and before creating the user's next local baseline.
 * Error behavior: throws when the state path is a symlink, a non-directory parent, or an existing non-regular file, so a redirected write is refused
 * rather than followed.
 *
 * @param projectPath - selected target root; empty is invalid upstream and cannot safely contain state
 * @param agent - installed agent whose state file may be replaced; never null after CLI validation
 * @returns nothing; returning at all means the write path is safe
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
 *
 * Use only after current target bytes match the preview's package templates.
 * Invariant: only system-owned, non-retired rows enter the baseline, because a hash for user-owned or generated content would later read as drift
 * against bytes the user legitimately controls.
 *
 * Side effect: writes the agent's install-state file under `.goat-flow/install-state/`.
 * Error behavior: throws when the write path is unsafe, leaving the previous baseline in place.
 *
 * @param projectPath - selected target root; empty is invalid upstream and cannot store state safely
 * @param preview - verified managed report; an empty files list records an empty baseline
 * @returns nothing; the new baseline is the file left on disk
 */
export function writeManagedInstallState(
  projectPath: string,
  preview: ManagedSetupPreview,
): void {
  const files: ManagedInstallStateEntry[] = [];
  // Only paths still managed by this package belong in the next expected baseline.
  for (const file of preview.files) {
    // User-owned and generated rows have no exact-copy template, so a baseline
    // hash for them would later read as drift against content the user owns.
    if (file.ownership !== "system-owned") continue;
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
    // A pre-planted temp entry (for example a symlink in an untrusted
    // checkout) must never receive the baseline bytes: clear it, then create
    // the temp file exclusively so the write cannot follow a redirection.
    rmSync(temporaryPath, { force: true });
    writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: "utf-8",
      flag: "wx",
    });
    renameSync(temporaryPath, statePath);
  } catch (error) {
    // For example, a user may make install-state read-only between preview and apply.
    rmSync(temporaryPath, { force: true });
    throw error;
  }
}

/** One package observation retained when legacy v1 state supplies a row. */
interface ManagedInstallLegacyObservation {
  agent: AgentId;
  goatFlowVersion: string;
}

/** Provenance that determines one path row's content-derived generation. */
type ManagedInstallStateProvenance =
  | { kind: "verified-install"; goatFlowVersion: string }
  | {
      kind: "legacy-v1-bootstrap";
      observations: ManagedInstallLegacyObservation[];
    };

/** One authoritative path/hash row in project-wide managed state. */
export interface ManagedInstallStateRow {
  path: string;
  expectedSha256: string;
  generation: string;
  provenance: ManagedInstallStateProvenance;
}

/** One hashless receipt reference to a managed path generation. */
interface ManagedInstallReceiptReference {
  path: string;
  generation: string;
}

/** One agent's hashless receipt in project-wide managed state. */
interface ManagedInstallReceipt {
  agent: AgentId;
  goatFlowVersion: string;
  files: ManagedInstallReceiptReference[];
}

/**
 * Canonical project-wide baseline and embedded receipt shape accepted by ADR-064.
 * Invariant: `files` owns one hash per path while receipts contain generation references only.
 */
export interface ManagedInstallStateV2 {
  schemaVersion: typeof MANAGED_INSTALL_STATE_V2_SCHEMA;
  files: ManagedInstallStateRow[];
  receipts: ManagedInstallReceipt[];
}

/** Read result from the selection-independent v1/v2 state boundary. */
export interface ManagedInstallStateFacade {
  status: "missing" | "loaded" | "malformed-blocking" | "conflicting";
  source: "missing" | "v2" | "legacy-bootstrap";
  expectedHashes: Map<string, string>;
  state: ManagedInstallStateV2 | null;
  canonicalBytes: string | null;
  legacyAgents: AgentId[];
  staleReceiptAgents: AgentId[];
  affectedAgents: AgentId[];
  affectedPaths: string[];
  error: string | null;
}

/** Input that derives its generation instead of accepting one from a caller. */
export interface CreateManagedInstallStateRowInput {
  path: string;
  expectedSha256: string;
  provenance: ManagedInstallStateProvenance;
}

/** One validated legacy v1 file and the rows it contributes to global bootstrap. */
interface ParsedLegacyInstallState {
  agent: AgentId;
  goatFlowVersion: string;
  files: ManagedInstallStateEntry[];
}

/** One path observation paired with the legacy hash it reported. */
interface LegacyPathObservation extends ManagedInstallLegacyObservation {
  expectedSha256: string;
}

/** Result of resolving every valid legacy observation without selected-agent input. */
type LegacyBootstrapResolution =
  | { status: "loaded"; state: ManagedInstallStateV2 }
  | {
      status: "conflicting";
      affectedAgents: AgentId[];
      affectedPaths: string[];
      error: string;
    };

/** Preserve structured subjects when target-controlled state cannot be parsed safely. */
class ManagedInstallStateEvidenceError extends Error {
  /** Store only known agents and portable project-relative paths for later status output. */
  constructor(
    message: string,
    readonly affectedAgents: AgentId[],
    readonly affectedPaths: string[],
  ) {
    super(message);
  }
}

/**
 * Return the sole project-wide managed baseline path.
 *
 * @param projectPath - selected project root; empty input is rejected by the command boundary
 * @returns absolute managed.json path below the selected project's install-state directory
 */
export function managedInstallStateV2Path(projectPath: string): string {
  return join(projectPath, ".goat-flow", "install-state", "managed.json");
}

/** Compare text by its UTF-8 bytes, matching ADR-064 canonical array ordering. */
function compareUtf8(left: string, right: string): number {
  return Buffer.compare(
    Buffer.from(left, "utf-8"),
    Buffer.from(right, "utf-8"),
  );
}

/**
 * Reject extra or missing JSON keys before target-controlled state can become authority.
 * Error behavior: throws a field-name-only diagnostic, never target-controlled values.
 */
function assertExactKeys(
  candidateObject: Record<string, unknown>,
  expectedKeys: readonly string[],
  label: string,
): void {
  const actualKeys = Object.keys(candidateObject);
  if (
    actualKeys.length !== expectedKeys.length ||
    expectedKeys.some((key) => !Object.hasOwn(candidateObject, key))
  ) {
    throw new Error(
      `${label} must contain exactly ${expectedKeys.join(", ")}.`,
    );
  }
}

/**
 * Require one non-empty string without retaining unsafe raw state in diagnostics.
 * Error behavior: throws the caller-owned field label without echoing the candidate.
 */
function requiredNonEmptyString(candidateText: unknown, label: string): string {
  if (typeof candidateText !== "string" || candidateText.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return candidateText;
}

/**
 * Narrow one target-controlled agent id to the canonical supported tuple.
 * Error behavior: throws a fixed label and never echoes an unknown candidate.
 */
function requiredAgentId(candidateAgent: unknown, label: string): AgentId {
  if (
    typeof candidateAgent !== "string" ||
    !(KNOWN_AGENT_IDS as readonly string[]).includes(candidateAgent)
  ) {
    throw new Error(`${label} must name a known agent.`);
  }
  return candidateAgent as AgentId;
}

/**
 * Validate a safe persisted path and return it unchanged for canonical output.
 * Error behavior: throws the caller-owned label without echoing an unsafe path.
 */
function requiredManagedPath(candidatePath: unknown, label: string): string {
  if (typeof candidatePath !== "string" || !isSafeRelativePath(candidatePath)) {
    throw new Error(`${label} must be a safe repository-relative path.`);
  }
  return candidatePath;
}

/**
 * Validate a lowercase SHA-256 string before it can authorize any managed bytes.
 * Error behavior: throws the safe path or field label, never the invalid hash.
 */
function requiredSha256(candidateHash: unknown, label: string): string {
  if (
    typeof candidateHash !== "string" ||
    !SHA256_PATTERN.test(candidateHash)
  ) {
    throw new Error(`${label} must be lowercase SHA-256.`);
  }
  return candidateHash;
}

/**
 * Parse and canonically order one row's provenance object.
 * Invariant: a legacy agent contributes at most one observation to a row generation.
 * Error behavior: throws safe schema diagnostics without retaining raw provenance.
 */
function parseManagedInstallProvenance(
  rawProvenance: unknown,
): ManagedInstallStateProvenance {
  if (!isRecord(rawProvenance)) {
    throw new Error("Managed install provenance must be an object.");
  }
  const kind = rawProvenance["kind"];
  if (kind === "verified-install") {
    assertExactKeys(
      rawProvenance,
      ["kind", "goatFlowVersion"],
      "Verified install provenance",
    );
    return {
      kind,
      goatFlowVersion: requiredNonEmptyString(
        rawProvenance["goatFlowVersion"],
        "Verified install provenance goatFlowVersion",
      ),
    };
  }
  if (kind !== "legacy-v1-bootstrap") {
    throw new Error("Managed install provenance kind is invalid.");
  }
  assertExactKeys(
    rawProvenance,
    ["kind", "observations"],
    "Legacy bootstrap provenance",
  );
  const rawObservations = rawProvenance["observations"];
  if (!Array.isArray(rawObservations) || rawObservations.length === 0) {
    throw new Error(
      "Legacy bootstrap provenance observations must be a non-empty array.",
    );
  }
  const seenAgents = new Set<AgentId>();
  const observations = rawObservations.map((rawObservation) => {
    if (!isRecord(rawObservation)) {
      throw new Error("Every legacy bootstrap observation must be an object.");
    }
    assertExactKeys(
      rawObservation,
      ["agent", "goatFlowVersion"],
      "Legacy bootstrap observation",
    );
    const agent = requiredAgentId(
      rawObservation["agent"],
      "Legacy bootstrap observation agent",
    );
    if (seenAgents.has(agent)) {
      throw new Error(
        `Legacy bootstrap provenance contains duplicate agent ${agent}.`,
      );
    }
    seenAgents.add(agent);
    return {
      agent,
      goatFlowVersion: requiredNonEmptyString(
        rawObservation["goatFlowVersion"],
        "Legacy bootstrap observation goatFlowVersion",
      ),
    };
  });
  observations.sort((left, right) => {
    const agentOrder = compareUtf8(left.agent, right.agent);
    return agentOrder === 0
      ? compareUtf8(left.goatFlowVersion, right.goatFlowVersion)
      : agentOrder;
  });
  return { kind, observations };
}

/** Compute the content-derived generation for one already normalized row identity. */
function managedInstallRowGeneration(
  path: string,
  expectedSha256: string,
  provenance: ManagedInstallStateProvenance,
): string {
  return createHash("sha256")
    .update("goat-flow.install-state.row-generation.v1\0")
    .update(path)
    .update("\0")
    .update(expectedSha256)
    .update("\0")
    .update(JSON.stringify(provenance))
    .digest("hex");
}

/**
 * Build one validated row whose deterministic generation cannot depend on caller order.
 *
 * @param input - safe path, package hash, and verified or legacy provenance identity
 * @returns normalized row with its lowercase content-derived generation
 * @throws when any input field cannot form authoritative managed state
 */
export function createManagedInstallStateRow(
  input: CreateManagedInstallStateRowInput,
): ManagedInstallStateRow {
  const path = requiredManagedPath(input.path, "Managed install row path");
  const expectedSha256 = requiredSha256(
    input.expectedSha256,
    `Managed install hash for ${path}`,
  );
  const provenance = parseManagedInstallProvenance(input.provenance);
  return {
    path,
    expectedSha256,
    generation: managedInstallRowGeneration(path, expectedSha256, provenance),
    provenance,
  };
}

/**
 * Parse one persisted v2 path row and verify its content-derived generation.
 * Error behavior: throws before returning any hash when shape or generation is invalid.
 */
function parseManagedInstallStateRow(rawRow: unknown): ManagedInstallStateRow {
  if (!isRecord(rawRow)) {
    throw new Error("Every managed install state row must be an object.");
  }
  assertExactKeys(
    rawRow,
    ["path", "expectedSha256", "generation", "provenance"],
    "Managed install state row",
  );
  const generatedRow = createManagedInstallStateRow({
    path: requiredManagedPath(rawRow["path"], "Managed install row path"),
    expectedSha256: requiredSha256(
      rawRow["expectedSha256"],
      "Managed install row expectedSha256",
    ),
    provenance: parseManagedInstallProvenance(rawRow["provenance"]),
  });
  const persistedGeneration = requiredSha256(
    rawRow["generation"],
    `Managed install generation for ${generatedRow.path}`,
  );
  if (persistedGeneration !== generatedRow.generation) {
    throw new Error(
      `Managed install generation for ${generatedRow.path} does not match its row identity.`,
    );
  }
  return generatedRow;
}

/**
 * Parse one receipt while allowing stale row references to remain syntactically valid.
 * Invariant: missing paths and non-current generations are preserved for stale-receipt classification.
 * Error behavior: throws on malformed identity or duplicate path references.
 */
function parseManagedInstallReceipt(
  rawReceipt: unknown,
): ManagedInstallReceipt {
  if (!isRecord(rawReceipt)) {
    throw new Error("Every managed install receipt must be an object.");
  }
  assertExactKeys(
    rawReceipt,
    ["agent", "goatFlowVersion", "files"],
    "Managed install receipt",
  );
  const agent = requiredAgentId(
    rawReceipt["agent"],
    "Managed install receipt agent",
  );
  const goatFlowVersion = requiredNonEmptyString(
    rawReceipt["goatFlowVersion"],
    `Managed install receipt goatFlowVersion for ${agent}`,
  );
  const rawFiles = rawReceipt["files"];
  if (!Array.isArray(rawFiles)) {
    throw new Error(
      `Managed install receipt files for ${agent} must be an array.`,
    );
  }
  const seenPaths = new Set<string>();
  const files = rawFiles.map((rawReference) => {
    if (!isRecord(rawReference)) {
      throw new Error(
        "Every managed install receipt reference must be an object.",
      );
    }
    assertExactKeys(
      rawReference,
      ["path", "generation"],
      "Managed install receipt reference",
    );
    const path = requiredManagedPath(
      rawReference["path"],
      "Managed install receipt path",
    );
    if (seenPaths.has(path)) {
      throw new Error(
        `Managed install receipt for ${agent} contains duplicate path ${path}.`,
      );
    }
    seenPaths.add(path);
    return {
      path,
      generation: requiredSha256(
        rawReference["generation"],
        `Managed install receipt generation for ${path}`,
      ),
    };
  });
  files.sort((left, right) => compareUtf8(left.path, right.path));
  return { agent, goatFlowVersion, files };
}

/**
 * Validate and canonically order one complete project-wide state object.
 * Invariant: each path and receipt agent appears once, with nested rows sorted by UTF-8 byte order.
 * Error behavior: throws before the state can become authority when any schema value is malformed.
 */
function parseManagedInstallStateV2(rawState: unknown): ManagedInstallStateV2 {
  if (!isRecord(rawState)) {
    throw new Error("Managed install state must be a JSON object.");
  }
  assertExactKeys(
    rawState,
    ["schemaVersion", "files", "receipts"],
    "Managed install state",
  );
  if (rawState["schemaVersion"] !== MANAGED_INSTALL_STATE_V2_SCHEMA) {
    throw new Error(
      `Managed install state schema must be ${MANAGED_INSTALL_STATE_V2_SCHEMA}.`,
    );
  }
  const rawFiles = rawState["files"];
  const rawReceipts = rawState["receipts"];
  if (!Array.isArray(rawFiles)) {
    throw new Error("Managed install state files must be an array.");
  }
  if (!Array.isArray(rawReceipts)) {
    throw new Error("Managed install state receipts must be an array.");
  }
  const seenPaths = new Set<string>();
  const files = rawFiles.map((rawRow) => {
    const row = parseManagedInstallStateRow(rawRow);
    if (seenPaths.has(row.path)) {
      throw new Error(
        `Managed install state contains duplicate path ${row.path}.`,
      );
    }
    seenPaths.add(row.path);
    return row;
  });
  files.sort((left, right) => compareUtf8(left.path, right.path));

  const seenReceiptAgents = new Set<AgentId>();
  const receipts = rawReceipts.map((rawReceipt) => {
    const receipt = parseManagedInstallReceipt(rawReceipt);
    if (seenReceiptAgents.has(receipt.agent)) {
      throw new Error(
        `Managed install state contains duplicate receipt for ${receipt.agent}.`,
      );
    }
    seenReceiptAgents.add(receipt.agent);
    return receipt;
  });
  receipts.sort((left, right) => compareUtf8(left.agent, right.agent));
  return { schemaVersion: MANAGED_INSTALL_STATE_V2_SCHEMA, files, receipts };
}

/**
 * Serialize one logical v2 state to the sole canonical byte representation.
 * Error behavior: throws when the supplied state violates the strict v2 schema.
 *
 * @param state - Complete project-wide state to validate and serialize.
 * @returns Two-space-indented canonical JSON terminated by one newline.
 */
export function canonicalManagedInstallStateBytes(
  state: ManagedInstallStateV2,
): string {
  return `${JSON.stringify(parseManagedInstallStateV2(state), null, 2)}\n`;
}

/**
 * Parse one complete legacy v1 file for a known path-derived agent.
 * Error behavior: throws on unknown keys, invalid values, or duplicate managed paths.
 */
function parseLegacyInstallState(
  rawState: unknown,
  expectedAgent: AgentId,
): ParsedLegacyInstallState {
  if (!isRecord(rawState)) {
    throw new Error(
      `Legacy install state for ${expectedAgent} must be an object.`,
    );
  }
  assertExactKeys(
    rawState,
    ["schemaVersion", "agent", "goatFlowVersion", "files"],
    `Legacy install state for ${expectedAgent}`,
  );
  if (rawState["schemaVersion"] !== MANAGED_INSTALL_STATE_SCHEMA) {
    throw new Error(
      `Legacy install state schema for ${expectedAgent} must be ${MANAGED_INSTALL_STATE_SCHEMA}.`,
    );
  }
  if (rawState["agent"] !== expectedAgent) {
    throw new Error(`Legacy install state agent must be ${expectedAgent}.`);
  }
  const goatFlowVersion = requiredNonEmptyString(
    rawState["goatFlowVersion"],
    `Legacy install state goatFlowVersion for ${expectedAgent}`,
  );
  const rawFiles = rawState["files"];
  if (!Array.isArray(rawFiles)) {
    throw new Error(
      `Legacy install state files for ${expectedAgent} must be an array.`,
    );
  }
  const seenPaths = new Set<string>();
  const files = rawFiles.map((rawFile) => {
    if (!isRecord(rawFile)) {
      throw new Error(
        "Every legacy install state file entry must be an object.",
      );
    }
    assertExactKeys(
      rawFile,
      ["path", "expectedSha256"],
      "Legacy install state file entry",
    );
    const file = parseManagedStateEntry(rawFile);
    if (seenPaths.has(file.path)) {
      throw new Error(
        `Legacy install state for ${expectedAgent} contains duplicate path ${file.path}.`,
      );
    }
    seenPaths.add(file.path);
    return file;
  });
  return { agent: expectedAgent, goatFlowVersion, files };
}

/**
 * Read every known legacy state file before resolving any path baseline.
 * Invariant: every present known-agent file is inspected without consulting agent selection.
 * Error behavior: throws if any discovered legacy file is unsafe, malformed, or non-canonical.
 */
function readLegacyInstallStateInventory(
  projectPath: string,
): ParsedLegacyInstallState[] {
  const inventory: ParsedLegacyInstallState[] = [];
  for (const agent of KNOWN_AGENT_IDS) {
    const affectedPath = `.goat-flow/install-state/${agent}.json`;
    try {
      const statePath = managedInstallStatePath(projectPath, agent);
      const stateStats = readStatePathStats(statePath, affectedPath);
      if (stateStats === null) continue;
      if (!stateStats.isFile() || stateStats.nlink !== 1) {
        throw new Error(`${affectedPath} must be a safe regular file.`);
      }
      let serializedState: string;
      let rawState: unknown;
      try {
        serializedState = readFileSync(statePath, "utf-8");
        rawState = JSON.parse(serializedState) as unknown;
      } catch {
        throw new Error(`Legacy install state for ${agent} is not valid JSON.`);
      }
      const legacyState = parseLegacyInstallState(rawState, agent);
      // V1 predates UTF-8 canonical ordering, so preserve its parsed row sequence while rejecting duplicate-key or formatting ambiguity.
      const normalizedLegacyBytes = `${JSON.stringify(
        {
          schemaVersion: MANAGED_INSTALL_STATE_SCHEMA,
          agent: legacyState.agent,
          goatFlowVersion: legacyState.goatFlowVersion,
          files: legacyState.files,
        },
        null,
        2,
      )}\n`;
      if (serializedState !== normalizedLegacyBytes) {
        throw new Error(`Legacy install state for ${agent} is not canonical.`);
      }
      const canonicalFiles = [...legacyState.files].sort((left, right) =>
        compareUtf8(left.path, right.path),
      );
      inventory.push({ ...legacyState, files: canonicalFiles });
    } catch (error) {
      if (error instanceof ManagedInstallStateEvidenceError) throw error;
      throw new ManagedInstallStateEvidenceError(
        error instanceof Error
          ? error.message
          : `Legacy install state for ${agent} is malformed.`,
        [agent],
        [affectedPath],
      );
    }
  }
  return inventory;
}

/** Resolve one path's legacy observations using ADR-064 version precedence. */
function resolveLegacyPathRow(
  path: string,
  observations: LegacyPathObservation[],
): ManagedInstallStateRow | null {
  const distinctHashes = new Set(
    observations.map((observation) => observation.expectedSha256),
  );
  let winningObservations = observations;
  if (distinctHashes.size > 1) {
    if (
      observations.some(
        (observation) => !isReleaseVersion(observation.goatFlowVersion),
      )
    ) {
      return null;
    }
    let highestVersion = observations[0]?.goatFlowVersion ?? "";
    for (const observation of observations.slice(1)) {
      if (compareVersions(observation.goatFlowVersion, highestVersion) > 0) {
        highestVersion = observation.goatFlowVersion;
      }
    }
    winningObservations = observations.filter(
      (observation) =>
        compareVersions(observation.goatFlowVersion, highestVersion) === 0,
    );
    if (
      new Set(
        winningObservations.map((observation) => observation.expectedSha256),
      ).size > 1
    ) {
      return null;
    }
  }
  const expectedSha256 = winningObservations[0]?.expectedSha256;
  if (expectedSha256 === undefined) return null;
  return createManagedInstallStateRow({
    path,
    expectedSha256,
    provenance: {
      kind: "legacy-v1-bootstrap",
      observations: winningObservations.map((observation) => ({
        agent: observation.agent,
        goatFlowVersion: observation.goatFlowVersion,
      })),
    },
  });
}

/**
 * Build the virtual receipt-free v2 state from a complete clean v1 inventory.
 * Invariant: resolution depends only on the complete inventory, never selected agents or current bytes.
 */
function resolveLegacyBootstrap(
  inventory: ParsedLegacyInstallState[],
): LegacyBootstrapResolution {
  const observationsByPath = new Map<string, LegacyPathObservation[]>();
  for (const legacyState of inventory) {
    for (const file of legacyState.files) {
      const observations = observationsByPath.get(file.path) ?? [];
      observations.push({
        agent: legacyState.agent,
        goatFlowVersion: legacyState.goatFlowVersion,
        expectedSha256: file.expectedSha256,
      });
      observationsByPath.set(file.path, observations);
    }
  }
  const files: ManagedInstallStateRow[] = [];
  for (const [path, observations] of observationsByPath) {
    const row = resolveLegacyPathRow(path, observations);
    if (row === null) {
      return {
        status: "conflicting",
        affectedAgents: [
          ...new Set(observations.map((observation) => observation.agent)),
        ].sort(compareUtf8),
        affectedPaths: [path],
        error: `Legacy install state has conflicting baselines for ${path}.`,
      };
    }
    files.push(row);
  }
  files.sort((left, right) => compareUtf8(left.path, right.path));
  return {
    status: "loaded",
    state: {
      schemaVersion: MANAGED_INSTALL_STATE_V2_SCHEMA,
      files,
      receipts: [],
    },
  };
}

/** Return path hashes and stale receipt references from one validated v2 state. */
function facadeEvidence(state: ManagedInstallStateV2): {
  expectedHashes: Map<string, string>;
  staleReceiptAgents: AgentId[];
} {
  const expectedHashes = new Map(
    state.files.map((row) => [row.path, row.expectedSha256]),
  );
  const generations = new Map(
    state.files.map((row) => [row.path, row.generation]),
  );
  const staleReceiptAgents = state.receipts
    .filter((receipt) =>
      receipt.files.some(
        (reference) => generations.get(reference.path) !== reference.generation,
      ),
    )
    .map((receipt) => receipt.agent);
  return { expectedHashes, staleReceiptAgents };
}

/**
 * Read and validate one existing managed.json file into a loaded facade result.
 * Error behavior: throws if the authority file is unsafe, unreadable, malformed, or non-canonical.
 */
function readPersistedManagedInstallStateFacade(
  statePath: string,
  stateStats: Stats,
): ManagedInstallStateFacade {
  if (!stateStats.isFile() || stateStats.nlink !== 1) {
    throw new Error(
      ".goat-flow/install-state/managed.json must be a safe regular file.",
    );
  }
  let serializedState: string;
  try {
    serializedState = readFileSync(statePath, "utf-8");
  } catch {
    throw new Error("Managed install state could not be read.");
  }
  let rawState: unknown;
  try {
    rawState = JSON.parse(serializedState) as unknown;
  } catch {
    throw new Error("Managed install state is not valid JSON.");
  }
  const state = parseManagedInstallStateV2(rawState);
  const canonicalBytes = canonicalManagedInstallStateBytes(state);
  if (serializedState !== canonicalBytes) {
    throw new Error("Managed install state bytes are not canonical.");
  }
  return {
    status: "loaded",
    source: "v2",
    ...facadeEvidence(state),
    state,
    canonicalBytes,
    legacyAgents: [],
    affectedAgents: [],
    affectedPaths: [],
    error: null,
  };
}

/**
 * Build one missing, conflicting, or loaded facade result from all legacy files.
 * Invariant: the result reflects the full known-agent inventory and is independent of selection order.
 */
function readLegacyManagedInstallStateFacade(
  projectPath: string,
): ManagedInstallStateFacade {
  const inventory = readLegacyInstallStateInventory(projectPath);
  if (inventory.length === 0) {
    return {
      status: "missing",
      source: "missing",
      expectedHashes: new Map(),
      state: null,
      canonicalBytes: null,
      legacyAgents: [],
      staleReceiptAgents: [],
      affectedAgents: [],
      affectedPaths: [],
      error: null,
    };
  }
  const legacyAgents = inventory
    .map((legacyState) => legacyState.agent)
    .sort(compareUtf8);
  const bootstrap = resolveLegacyBootstrap(inventory);
  if (bootstrap.status === "conflicting") {
    return {
      status: bootstrap.status,
      source: "legacy-bootstrap",
      expectedHashes: new Map(),
      state: null,
      canonicalBytes: null,
      legacyAgents,
      staleReceiptAgents: [],
      affectedAgents: bootstrap.affectedAgents,
      affectedPaths: bootstrap.affectedPaths,
      error: bootstrap.error,
    };
  }
  return {
    status: "loaded",
    source: "legacy-bootstrap",
    ...facadeEvidence(bootstrap.state),
    state: bootstrap.state,
    canonicalBytes: canonicalManagedInstallStateBytes(bootstrap.state),
    legacyAgents,
    affectedAgents: [],
    affectedPaths: [],
    error: null,
  };
}

/**
 * Read canonical v2 state or build the same virtual bootstrap for every caller.
 * @throws Never; unsafe or malformed persisted state becomes a malformed-blocking result.
 *
 * @param projectPath - Project root whose install-state directory supplies authority.
 * @returns A non-throwing facade over canonical v2 state or the complete legacy inventory.
 */
export function readManagedInstallStateFacade(
  projectPath: string,
): ManagedInstallStateFacade {
  const statePath = managedInstallStateV2Path(projectPath);
  let source: ManagedInstallStateFacade["source"] = "legacy-bootstrap";
  try {
    assertManagedStateParentDirectories(projectPath);
    const stateStats = readStatePathStats(
      statePath,
      ".goat-flow/install-state/managed.json",
    );
    if (stateStats !== null) {
      source = "v2";
      return readPersistedManagedInstallStateFacade(statePath, stateStats);
    }
    return readLegacyManagedInstallStateFacade(projectPath);
  } catch (error) {
    const structuredError =
      error instanceof ManagedInstallStateEvidenceError ? error : null;
    return {
      status: "malformed-blocking",
      source,
      expectedHashes: new Map(),
      state: null,
      canonicalBytes: null,
      legacyAgents: [],
      staleReceiptAgents: [],
      affectedAgents: structuredError?.affectedAgents ?? [],
      affectedPaths:
        structuredError?.affectedPaths ??
        [
          source === "v2"
            ? ".goat-flow/install-state/managed.json"
            : ".goat-flow/install-state",
        ],
      error:
        error instanceof Error
          ? error.message
          : "Managed install state is malformed.",
    };
  }
}

/**
 * Require the managed.json destination to remain a project-local regular file.
 * Error behavior: throws when a parent or existing destination violates safe-file constraints.
 */
function assertManagedStateV2WritePath(projectPath: string): void {
  assertManagedStateParentDirectories(projectPath);
  const stateStats = readStatePathStats(
    managedInstallStateV2Path(projectPath),
    ".goat-flow/install-state/managed.json",
  );
  if (stateStats !== null && (!stateStats.isFile() || stateStats.nlink !== 1)) {
    throw new Error(
      ".goat-flow/install-state/managed.json must be a safe regular file.",
    );
  }
}

/**
 * Atomically publish canonical project-wide state without following a planted temp link.
 * Side effects: creates the install-state directory, writes and flushes a private temp file, then renames it.
 * @throws Error when schema validation, path safety, or atomic publication fails; cleanup is attempted before propagation.
 *
 * @param projectPath - Project root that receives managed.json.
 * @param state - Complete v2 state to validate and publish.
 */
export function writeManagedInstallStateV2(
  projectPath: string,
  state: ManagedInstallStateV2,
): void {
  const serializedState = canonicalManagedInstallStateBytes(state);
  const statePath = managedInstallStateV2Path(projectPath);
  const temporaryPath = `${statePath}.tmp-${process.pid}`;
  assertManagedStateV2WritePath(projectPath);
  mkdirSync(dirname(statePath), { recursive: true });
  let temporaryDescriptor: number | null = null;
  try {
    rmSync(temporaryPath, { force: true });
    temporaryDescriptor = openSync(temporaryPath, "wx", 0o600);
    writeFileSync(temporaryDescriptor, serializedState, "utf-8");
    fsyncSync(temporaryDescriptor);
    closeSync(temporaryDescriptor);
    temporaryDescriptor = null;
    renameSync(temporaryPath, statePath);
  } catch (error) {
    if (temporaryDescriptor !== null) closeSync(temporaryDescriptor);
    rmSync(temporaryPath, { force: true });
    throw error;
  }
}
