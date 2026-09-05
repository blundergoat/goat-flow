/**
 * Coordinates project-file writers used by `install` and `learn new` with path-keyed exclusive claims.
 * Use before either command replaces shared files, so a concurrent writer is refused instead of overwriting newer user work.
 *
 * Callers capture target identities before admission, hold the returned batch through the complete write transaction, and release it in `finally`.
 * Claims never expire; an abandoned marker needs explicit operator-confirmed recovery.
 */
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import { join, posix, resolve } from "node:path";

const CLAIM_DIRECTORY = ".goat-flow/write-claims";
const CLAIM_SCHEMA = "goat-flow.path-write-claim.v1";
const CLAIM_KEY_DOMAIN = `${CLAIM_SCHEMA}\0`;
const MAX_CLAIM_BYTES = 4096;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const UNSUPPORTED_EXCLUSIVE_CREATE_CODES = new Set([
  "ENOSYS",
  "ENOTSUP",
  "EOPNOTSUPP",
]);
const INVALID_NORMALIZED_TARGETS = new Set([".", ".."]) as ReadonlySet<string>;

/** Exact target state a caller must capture before requesting write admission. */
export type PathWriteTargetIdentity =
  { state: "missing" } | { state: "present"; sha256: string };

/** One project-relative target and the exact state the caller read. */
export interface PathWriteClaimRequest {
  targetPath: string;
  expectedIdentity: PathWriteTargetIdentity;
}

/** Stable failure categories callers may translate into command-specific diagnostics. */
export type PathWriteClaimFailureReason =
  | "busy"
  | "claim-integrity"
  | "coordination-unavailable"
  | "duplicate-target"
  | "invalid-identity"
  | "invalid-target"
  | "target-changed"
  | "target-unreadable"
  | "unsafe-project"
  | "unsafe-target"
  | "unsupported-filesystem";

/** Result of releasing one marker from a completed or aborted batch. */
type PathWriteClaimReleaseStatus =
  "released" | "missing" | "ownership-changed" | "unreadable";

/** One target's owner-checked cleanup outcome. */
export interface PathWriteClaimReleaseResult {
  targetPath: string;
  status: PathWriteClaimReleaseStatus;
}

/** Opaque held batch; only the acquiring process can resolve its owner records. */
export interface PathWriteClaimBatch {
  readonly projectRoot: string;
  readonly targetPaths: readonly string[];
}

/** Opaque snapshot an operator-facing caller may use only after confirming that no writer remains active. */
export interface AbandonedPathWriteClaimEvidence {
  readonly projectRoot: string;
  readonly targetPath: string;
  readonly markerPath: string;
  readonly markerSha256: string;
}

/** Exact recovery outcome; changed evidence always remains in place. */
export type AbandonedPathWriteClaimRemoval = "removed" | "missing" | "changed";

const FAILURE_MESSAGES = {
  busy: (targetPath: string) =>
    `Another cooperating writer owns ${targetPath}; no write admission was granted.`,
  "claim-integrity": (targetPath: string) =>
    `The ownership marker for ${targetPath} is not a safe single-link claim file.`,
  "coordination-unavailable": (targetPath: string) =>
    `Write-claim coordination is unavailable for ${targetPath}.`,
  "duplicate-target": (targetPath: string) =>
    `${targetPath} appears more than once in the write-claim batch.`,
  "invalid-identity": (targetPath: string) =>
    `${targetPath} has an invalid expected content identity.`,
  "invalid-target": (targetPath: string) =>
    `${targetPath} is not a normalized project-relative target path.`,
  "target-changed": (targetPath: string) =>
    `${targetPath} changed after it was read; no write admission was granted.`,
  "target-unreadable": (targetPath: string) =>
    `${targetPath} could not be read for exact content identity.`,
  "unsafe-project": () =>
    "The selected project root must be a real local directory.",
  "unsafe-target": (targetPath: string) =>
    `${targetPath} contains a symlinked, linked, or non-regular path component.`,
  "unsupported-filesystem": (targetPath: string) =>
    `The filesystem cannot provide exclusive write claims for ${targetPath}.`,
} satisfies Record<PathWriteClaimFailureReason, (targetPath: string) => string>;

/**
 * Reports why a requested project-file write was refused before mutation.
 *
 * Install and learning commands use the reason and target to give users one stable recovery message.
 * Cleanup results show whether partial claim markers need operator attention.
 */
export class PathWriteClaimError extends Error {
  readonly reason: PathWriteClaimFailureReason;
  readonly targetPath: string;
  readonly cleanupResults: readonly PathWriteClaimReleaseResult[];

  /** Create one stable refusal that a consuming command may translate without parsing prose. */
  constructor(
    reason: PathWriteClaimFailureReason,
    targetPath: string,
    cleanupResults: readonly PathWriteClaimReleaseResult[] = [],
  ) {
    super(pathWriteClaimFailureMessage(reason, targetPath));
    this.name = "PathWriteClaimError";
    this.reason = reason;
    this.targetPath = targetPath;
    this.cleanupResults = cleanupResults;
  }
}

/** Bounded claim bytes plus the filesystem entry identity held by one owner. */
interface ClaimSnapshot {
  dev: bigint;
  ino: bigint;
  ctimeNs: bigint;
  size: bigint;
  sha256: string;
  bytes: Buffer;
}

/** Live descriptor and marker snapshot retained until owner-checked release. */
interface OwnedPathWriteClaim {
  targetPath: string;
  markerPath: string;
  snapshot: ClaimSnapshot;
  descriptor: number;
}

/** Physical directory identity retained across claim-directory creation and marker allocation. */
interface CoordinationDirectorySnapshot {
  path: string;
  dev: bigint;
  ino: bigint;
}

/** Project-local claim storage plus every ancestor identity that must remain stable during allocation. */
interface ClaimDirectory {
  path: string;
  snapshots: readonly CoordinationDirectorySnapshot[];
}

type ClaimSnapshotResult =
  | { status: "missing" }
  | { status: "unsafe" }
  | { status: "present"; snapshot: ClaimSnapshot };

type ClaimStatsResult =
  | { status: "missing" }
  | { status: "unsafe" }
  | { status: "present"; stats: fs.BigIntStats };

/** Canonical request shape retained after runtime validation and sorting. */
interface NormalizedPathWriteClaimRequest {
  targetPath: string;
  expectedIdentity: PathWriteTargetIdentity;
}

const OWNED_BATCHES = new WeakMap<
  PathWriteClaimBatch,
  readonly OwnedPathWriteClaim[]
>();
const RECOVERY_SNAPSHOTS = new WeakMap<
  AbandonedPathWriteClaimEvidence,
  ClaimSnapshot
>();

/** Render one generic failure without claiming that a command-specific transaction ran. */
function pathWriteClaimFailureMessage(
  reason: PathWriteClaimFailureReason,
  targetPath: string,
): string {
  return FAILURE_MESSAGES[reason](targetPath);
}

/** Return the stable SHA-256 identity of exact bytes. */
function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Compare paths by UTF-8 bytes so process locale cannot change claim order. */
function compareTargetPaths(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

/**
 * Require the project-relative POSIX path used to derive one cross-platform claim key.
 * Use before reading or claiming a user-selected target; the returned path is never empty.
 *
 * @throws PathWriteClaimError when the path is empty, absolute, traversing, backslash-shaped, or otherwise non-canonical
 */
function normalizeTargetPath(targetPath: string): string {
  const normalized = posix.normalize(targetPath);
  const invalidShape = [
    targetPath.length === 0,
    targetPath.includes("\\"),
    targetPath.includes("\0"),
    targetPath.startsWith("/"),
    /^[A-Za-z]:/u.test(targetPath),
    normalized !== targetPath,
    INVALID_NORMALIZED_TARGETS.has(normalized),
    normalized.startsWith("../"),
    targetPath.endsWith("/"),
  ].includes(true);
  if (invalidShape) {
    throw new PathWriteClaimError("invalid-target", targetPath);
  }
  return normalized;
}

/**
 * Resolve the selected project to a real directory before any coordination state is created.
 * Use at the claim API boundary so an invalid project stops the user's command before it writes.
 *
 * @throws PathWriteClaimError when the selected root is missing, unreadable, not a directory, or a symlink
 */
function resolveProjectRoot(projectRoot: string): string {
  const absoluteRoot = resolve(projectRoot);
  try {
    const stats = fs.lstatSync(absoluteRoot);
    // A symlink or non-directory root could redirect the command away from the project the user selected.
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new PathWriteClaimError("unsafe-project", ".");
    }
  } catch (error) {
    // A user reaches this after selecting a missing, unreadable, symlinked, or non-directory project root.
    if (error instanceof PathWriteClaimError) throw error;
    throw new PathWriteClaimError("unsafe-project", ".");
  }
  return absoluteRoot;
}

/**
 * Read metadata for a user-selected target while allowing that file not to exist yet.
 * A missing target returns null so a create operation can continue; any other read failure throws before the user file is changed.
 *
 * @returns current filesystem metadata, or null when the requested target does not exist
 * @throws PathWriteClaimError when metadata exists but cannot be read safely
 */
function readTargetStats(
  absolutePath: string,
  targetPath: string,
): fs.Stats | null {
  try {
    return fs.lstatSync(absolutePath);
  } catch (error) {
    // Another tool may remove the target between checks; that absence is safe, while permission and I/O errors block the write.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new PathWriteClaimError("target-unreadable", targetPath);
  }
}

/** Return whether one entry is a private regular-file identity safe to hash or replace. */
function isSingleLinkRegularFile(stats: fs.Stats): boolean {
  return stats.isFile() && !stats.isSymbolicLink() && stats.nlink === 1;
}

/**
 * Check every parent of a requested target without following a redirect outside the project.
 * Use before hashing or writing; false means the user-selected target is absent because one of its parent directories is absent.
 *
 * @returns true when every parent exists as a real directory, or false when the target path does not exist yet
 * @throws PathWriteClaimError when a parent is unreadable, symlinked, or not a directory
 */
function targetParentsExist(
  projectRoot: string,
  parentSegments: readonly string[],
  targetPath: string,
): boolean {
  let cursor = projectRoot;
  // Each existing parent must keep the eventual write inside the project the user selected.
  for (const segment of parentSegments) {
    cursor = join(cursor, segment);
    const stats = readTargetStats(cursor, targetPath);
    // A missing parent means this is a create request, not an unreadable existing file.
    if (stats === null) return false;
    // A file or symlink in the parent chain could redirect the requested write or make it impossible.
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new PathWriteClaimError("unsafe-target", targetPath);
    }
  }
  return true;
}

/**
 * Read a target's bytes only when the same regular file remains at that path for the whole read.
 * Use while capturing admission identity so a concurrent editor cannot make the command approve stale user content.
 *
 * @throws PathWriteClaimError when the target cannot be read or changes during the identity read
 */
function readStableTargetBytes(
  absoluteTarget: string,
  targetPath: string,
  before: fs.Stats,
): Buffer {
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(absoluteTarget);
  } catch {
    // The user's editor or another command may remove or make the target unreadable after metadata was captured.
    throw new PathWriteClaimError("target-unreadable", targetPath);
  }
  const after = readTargetStats(absoluteTarget, targetPath);
  // A missing, replaced, linked, or inode-changed target means the command no longer has the bytes the user reviewed.
  if (
    after === null ||
    !isSingleLinkRegularFile(after) ||
    after.dev !== before.dev ||
    after.ino !== before.ino
  ) {
    throw new PathWriteClaimError("target-changed", targetPath);
  }
  return bytes;
}

/**
 * Read one target without following linked components, because an identity is safe only when every component remains project-local.
 * Missing parents or target files produce the create-only identity; unsafe or unstable entries throw before admission.
 *
 * @returns a missing identity for a new user file, or the exact digest of an existing file
 * @throws PathWriteClaimError when the target or any parent is unsafe, unreadable, or changes during the read
 */
function readIdentityAtRoot(
  projectRoot: string,
  targetPath: string,
): PathWriteTargetIdentity {
  const segments = targetPath.split("/");
  // A missing parent means the user's command is preparing to create this target for the first time.
  if (!targetParentsExist(projectRoot, segments.slice(0, -1), targetPath)) {
    return { state: "missing" };
  }
  const absoluteTarget = join(projectRoot, ...segments);
  const before = readTargetStats(absoluteTarget, targetPath);
  // A missing final file is also a valid create request and has no digest to compare.
  if (before === null) return { state: "missing" };
  // Only one real regular file can provide an identity that safely represents the user's current bytes.
  if (!isSingleLinkRegularFile(before)) {
    throw new PathWriteClaimError("unsafe-target", targetPath);
  }
  const bytes = readStableTargetBytes(absoluteTarget, targetPath, before);
  return { state: "present", sha256: sha256(bytes) };
}

/**
 * Validate the target identity captured before a user starts the write step.
 * Missing targets need no digest; present targets require one exact lowercase SHA-256 value.
 *
 * @throws PathWriteClaimError when a present target carries an invalid digest
 */
function validateExpectedIdentity(
  targetPath: string,
  identity: PathWriteTargetIdentity,
): void {
  // A new file has no earlier bytes, so its missing identity is already complete.
  if (identity.state === "missing") return;
  // An existing file can proceed only with the exact digest shape used during revalidation.
  if (SHA256_PATTERN.test(identity.sha256)) return;
  throw new PathWriteClaimError("invalid-identity", targetPath);
}

/** Compare only the existence and exact-byte digest required by ADR-048. */
function identitiesMatch(
  left: PathWriteTargetIdentity,
  right: PathWriteTargetIdentity,
): boolean {
  if (left.state === "missing" || right.state === "missing") {
    return left.state === right.state;
  }
  return left.sha256 === right.sha256;
}

/**
 * Create one private coordination directory, accepting another cooperating writer that creates it first.
 * Writes filesystem state for `install` or `learn new`, then rejects a presently unsafe shape before the user receives admission.
 *
 * @throws PathWriteClaimError when the directory cannot be created or verified as a real directory
 */
function ensureCoordinationDirectory(
  directoryPath: string,
  targetPath: string,
): CoordinationDirectorySnapshot {
  try {
    fs.mkdirSync(directoryPath, { mode: 0o700 });
  } catch (error) {
    // Another writer may create the directory first; permissions, read-only filesystems, and other failures stop the user's write.
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw new PathWriteClaimError("coordination-unavailable", targetPath);
    }
  }
  try {
    const stats = fs.lstatSync(directoryPath, { bigint: true });
    // A file or symlink at the coordination path cannot safely hold ownership markers for the selected project.
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new PathWriteClaimError("claim-integrity", targetPath);
    }
    return { path: directoryPath, dev: stats.dev, ino: stats.ino };
  } catch (error) {
    // The directory may become unreadable or disappear between creation and verification, so the command refuses admission.
    if (error instanceof PathWriteClaimError) throw error;
    throw new PathWriteClaimError("coordination-unavailable", targetPath);
  }
}

/**
 * Require one coordination path to retain the exact directory entry captured before a child operation.
 * Error behavior: throws a typed integrity or availability refusal without exposing the absolute path.
 */
function assertCoordinationDirectorySnapshot(
  snapshot: CoordinationDirectorySnapshot,
  targetPath: string,
): void {
  try {
    const current = fs.lstatSync(snapshot.path, { bigint: true });
    if (
      !current.isDirectory() ||
      current.isSymbolicLink() ||
      current.dev !== snapshot.dev ||
      current.ino !== snapshot.ino
    ) {
      throw new PathWriteClaimError("claim-integrity", targetPath);
    }
  } catch (error) {
    if (error instanceof PathWriteClaimError) throw error;
    throw new PathWriteClaimError("coordination-unavailable", targetPath);
  }
}

/** Revalidate the full project-local directory chain around one marker allocation. */
function assertClaimDirectory(
  claimDirectory: ClaimDirectory,
  targetPath: string,
): void {
  // A changed ancestor stops the user's write; createClaimMarker separately binds the new descriptor before adding owner bytes.
  for (const snapshot of claimDirectory.snapshots) {
    assertCoordinationDirectorySnapshot(snapshot, targetPath);
  }
}

/** Create and validate the project-local claim directory. */
function ensureClaimDirectory(
  projectRoot: string,
  targetPath: string,
): ClaimDirectory {
  const goatFlowDirectory = join(projectRoot, ".goat-flow");
  const goatFlowSnapshot = ensureCoordinationDirectory(
    goatFlowDirectory,
    targetPath,
  );
  const claimDirectory = join(goatFlowDirectory, "write-claims");
  const claimDirectorySnapshot = ensureCoordinationDirectory(
    claimDirectory,
    targetPath,
  );
  const validatedClaimDirectory = {
    path: claimDirectory,
    snapshots: [goatFlowSnapshot, claimDirectorySnapshot],
  };
  // Creating the child traverses its parent again, so reject a replacement before any marker allocation.
  assertClaimDirectory(validatedClaimDirectory, targetPath);
  return validatedClaimDirectory;
}

/**
 * Find existing safe claim storage without creating project state during operator inspection.
 * Missing storage returns null, meaning the user has no claim marker to inspect or recover for this project.
 *
 * @returns the existing claim directory, or null when no coordination state exists
 * @throws PathWriteClaimError when existing coordination state is unreadable, symlinked, or not a directory
 */
function existingClaimDirectory(
  projectRoot: string,
  targetPath: string,
): string | null {
  const components = [
    join(projectRoot, ".goat-flow"),
    join(projectRoot, CLAIM_DIRECTORY),
  ];
  // Both coordination components must already exist as real directories before recovery evidence is trusted.
  for (const component of components) {
    try {
      const stats = fs.lstatSync(component);
      // A file or symlink here makes the visible claim state untrustworthy for the operator.
      if (!stats.isDirectory() || stats.isSymbolicLink()) {
        throw new PathWriteClaimError("claim-integrity", targetPath);
      }
    } catch (error) {
      // A removed directory means there is nothing to recover; permission or I/O failures leave the claim state unverified.
      if (error instanceof PathWriteClaimError) throw error;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new PathWriteClaimError("coordination-unavailable", targetPath);
    }
  }
  return components[1] ?? null;
}

/** Derive the filesystem-safe claim filename from one canonical target path. */
function claimMarkerPath(claimDirectory: string, targetPath: string): string {
  const key = createHash("sha256")
    .update(CLAIM_KEY_DOMAIN, "utf8")
    .update(targetPath, "utf8")
    .digest("hex");
  return join(claimDirectory, `${key}.claim`);
}

/**
 * Read claim-marker metadata without treating an absent marker as an integrity failure.
 * Error behavior: swallows metadata failures into `missing` or `unsafe` so callers can refuse unverified recovery without exposing raw I/O errors.
 */
function readClaimStats(markerPath: string): ClaimStatsResult {
  try {
    return {
      status: "present",
      stats: fs.lstatSync(markerPath, { bigint: true }),
    };
  } catch (error) {
    // A cooperating writer may already have removed its marker; other read failures keep the marker untrusted.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { status: "missing" };
    }
    return { status: "unsafe" };
  }
}

/** Require one bounded, single-link regular marker entry. */
function isSafeClaimEntry(stats: fs.BigIntStats): boolean {
  return (
    stats.isFile() &&
    !stats.isSymbolicLink() &&
    stats.nlink === 1n &&
    stats.size <= BigInt(MAX_CLAIM_BYTES)
  );
}

/** Require the marker path to name the same entry throughout its byte read. */
function isSameClaimEntry(
  before: fs.BigIntStats,
  after: fs.BigIntStats,
): boolean {
  return (
    isSafeClaimEntry(after) &&
    after.dev === before.dev &&
    after.ino === before.ino &&
    after.size === before.size
  );
}

/**
 * Read one already-validated marker and reject path replacement during the read.
 * Error behavior: swallows read and race failures as the `unsafe` fallback, so an operator never receives unverified ownership evidence.
 */
function readStableClaimSnapshot(
  markerPath: string,
  before: fs.BigIntStats,
): ClaimSnapshotResult {
  try {
    const bytes = fs.readFileSync(markerPath);
    const after = fs.lstatSync(markerPath, { bigint: true });
    if (!isSameClaimEntry(before, after)) {
      return { status: "unsafe" };
    }
    return {
      status: "present",
      snapshot: {
        dev: after.dev,
        ino: after.ino,
        ctimeNs: after.ctimeNs,
        size: after.size,
        sha256: sha256(bytes),
        bytes,
      },
    };
  } catch {
    // A marker can be replaced, removed, or made unreadable while an operator inspects it, so the snapshot stays unsafe.
    return { status: "unsafe" };
  }
}

/** Capture one bounded marker identity without accepting links or directories. */
function readClaimSnapshot(markerPath: string): ClaimSnapshotResult {
  const result = readClaimStats(markerPath);
  if (result.status !== "present") return result;
  if (!isSafeClaimEntry(result.stats)) return { status: "unsafe" };
  return readStableClaimSnapshot(markerPath, result.stats);
}

/** Compare the exact directory entry and marker bytes acquired by one owner. */
function claimSnapshotsMatch(
  left: ClaimSnapshot,
  right: ClaimSnapshot,
): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.ctimeNs === right.ctimeNs &&
    left.size === right.size &&
    left.sha256 === right.sha256 &&
    left.bytes.equals(right.bytes)
  );
}

/** Bind a pathname snapshot to the descriptor returned by this owner's exclusive create. */
function claimSnapshotMatchesDescriptor(
  snapshot: ClaimSnapshot,
  descriptorStats: fs.BigIntStats,
): boolean {
  return (
    isSafeClaimEntry(descriptorStats) &&
    snapshot.dev === descriptorStats.dev &&
    snapshot.ino === descriptorStats.ino &&
    snapshot.ctimeNs === descriptorStats.ctimeNs &&
    snapshot.size === descriptorStats.size
  );
}

/**
 * Re-read one new marker and prove its path still names this owner's open descriptor.
 * Error behavior: returns the `unsafe` fallback when descriptor metadata or pathname evidence cannot prove ownership.
 */
function readOwnedClaimSnapshot(
  markerPath: string,
  descriptor: number,
  markerBytes: Buffer,
): ClaimSnapshotResult {
  let descriptorStats: fs.BigIntStats;
  try {
    descriptorStats = fs.fstatSync(descriptor, { bigint: true });
  } catch {
    // An invalidated descriptor means this process can no longer prove that the visible marker belongs to the user's command.
    return { status: "unsafe" };
  }
  const claim = readClaimSnapshot(markerPath);
  if (claim.status !== "present") return { status: "unsafe" };
  if (!claimSnapshotMatchesDescriptor(claim.snapshot, descriptorStats)) {
    return { status: "unsafe" };
  }
  return claim.snapshot.bytes.equals(markerBytes)
    ? claim
    : { status: "unsafe" };
}

/** Map exclusive-create capability errors without treating ordinary permissions as platform support. */
function exclusiveCreateFailure(
  error: unknown,
  targetPath: string,
): PathWriteClaimError {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "EEXIST") return new PathWriteClaimError("busy", targetPath);
  if (code && UNSUPPORTED_EXCLUSIVE_CREATE_CODES.has(code)) {
    return new PathWriteClaimError("unsupported-filesystem", targetPath);
  }
  return new PathWriteClaimError("coordination-unavailable", targetPath);
}

/**
 * Close a descriptor without masking the primary outcome.
 * Error behavior: swallows operating-system close errors and returns false so the caller reports unreadable cleanup to the operator.
 */
function closeClaimDescriptor(descriptor: number): boolean {
  try {
    fs.closeSync(descriptor);
    return true;
  } catch {
    // A rejected close becomes an unreadable cleanup result instead of replacing the command's primary success or failure.
    return false;
  }
}

/** Confirm a failed initialization path still contains the descriptor-created marker bytes. */
function isOwnedInitializationClaim(
  claim: ClaimSnapshotResult,
  descriptorStats: fs.BigIntStats,
  expectedMarkerBytes?: Buffer,
): claim is { status: "present"; snapshot: ClaimSnapshot } {
  return (
    claim.status === "present" &&
    claimSnapshotMatchesDescriptor(claim.snapshot, descriptorStats) &&
    (expectedMarkerBytes === undefined ||
      claim.snapshot.bytes.equals(expectedMarkerBytes))
  );
}

/**
 * Remove a failed initialization marker only when the path still names the descriptor-created entry.
 *
 * Side effects: closes the descriptor and may unlink that exact marker.
 * Error behavior: swallows identity, read, and cleanup failures after preserving any marker whose ownership cannot be proved.
 */
function cleanupFailedClaimInitialization(
  markerPath: string,
  descriptor: number,
  expectedMarkerBytes?: Buffer,
): void {
  let ownedSnapshot: ClaimSnapshot | null = null;
  try {
    const descriptorStats = fs.fstatSync(descriptor, { bigint: true });
    const claim = readClaimSnapshot(markerPath);
    if (
      isOwnedInitializationClaim(claim, descriptorStats, expectedMarkerBytes)
    ) {
      ownedSnapshot = claim.snapshot;
    }
  } catch {
    // A replaced or unreadable marker cannot be proven safe to delete, so the user may recover it only through explicit inspection.
    closeClaimDescriptor(descriptor);
    return;
  }
  // A close failure or missing owned snapshot leaves cleanup unresolved without risking another writer's marker.
  if (!closeClaimDescriptor(descriptor) || ownedSnapshot === null) return;
  const current = readClaimSnapshot(markerPath);
  // A marker changed after the first ownership check is left in place for operator review.
  if (
    current.status !== "present" ||
    !claimSnapshotsMatch(current.snapshot, ownedSnapshot)
  ) {
    return;
  }
  try {
    fs.unlinkSync(markerPath);
  } catch {
    // A concurrent removal or filesystem refusal leaves the original initialization failure as the message the user sees.
    return;
  }
}

/**
 * Exclusively create, fill, and flush one marker.
 *
 * Side effects: allocates one private marker, writes owner bytes only after binding it, and leaves its descriptor open for the caller.
 * Error behavior: owner-checks cleanup; an unprovable redirected allocation can remain empty when admission fails.
 *
 * @param markerPath - absolute claim path selected for this target; it must still identify the new descriptor
 * @param markerBytes - owner evidence written after binding; empty input would create no usable ownership evidence
 * @param targetPath - project-relative user target named in any refusal
 * @param claimDirectory - previously validated directory chain that must retain its identity
 * @returns open descriptor for the bound marker; the caller keeps it until ownership-checked release
 * @throws PathWriteClaimError when creation, binding, writing, or flushing cannot establish a usable claim
 */
function createClaimMarker(
  markerPath: string,
  markerBytes: Buffer,
  targetPath: string,
  claimDirectory: ClaimDirectory,
): number {
  assertClaimDirectory(claimDirectory, targetPath);
  let descriptor: number;
  try {
    descriptor = fs.openSync(markerPath, "wx", 0o600);
  } catch (error) {
    // Another writer may already own the target, or the selected filesystem may reject private exclusive creation.
    throw exclusiveCreateFailure(error, targetPath);
  }
  try {
    const emptyMarkerBinding = readOwnedClaimSnapshot(
      markerPath,
      descriptor,
      Buffer.alloc(0),
    );
    // A restored parent can hide the marker just opened elsewhere, so owner bytes wait until its visible path names this descriptor.
    if (emptyMarkerBinding.status !== "present") {
      throw new PathWriteClaimError("claim-integrity", targetPath);
    }
    // A marker can match through a substituted parent, so the selected project's directory chain must also retain its identity.
    assertClaimDirectory(claimDirectory, targetPath);
    fs.writeFileSync(descriptor, markerBytes);
    fs.fsyncSync(descriptor);
    // A swap during the write or flush must not return a descriptor that appears admitted for the original project.
    assertClaimDirectory(claimDirectory, targetPath);
    return descriptor;
  } catch (error) {
    // A full disk, lost permission, or failed flush aborts admission and removes only this command's proven marker.
    cleanupFailedClaimInitialization(markerPath, descriptor);
    if (error instanceof PathWriteClaimError) throw error;
    throw exclusiveCreateFailure(error, targetPath);
  }
}

/**
 * Write and re-read one private owner marker through exclusive creation.
 *
 * Invariant: schema-tagged random owner bytes stay bound to the open descriptor until release can prove this command still owns the marker.
 * Error behavior: throws a categorized claim refusal after ownership-checked cleanup when creation or verification fails.
 */
function acquireOneClaim(
  claimDirectory: ClaimDirectory,
  targetPath: string,
): OwnedPathWriteClaim {
  const markerPath = claimMarkerPath(claimDirectory.path, targetPath);
  const ownerToken = randomBytes(16).toString("hex");
  const markerBytes = Buffer.from(
    `${JSON.stringify({ schemaVersion: CLAIM_SCHEMA, targetPath, ownerToken })}\n`,
    "utf8",
  );
  const descriptor = createClaimMarker(
    markerPath,
    markerBytes,
    targetPath,
    claimDirectory,
  );
  const claim = readOwnedClaimSnapshot(markerPath, descriptor, markerBytes);
  // If the new path no longer matches this descriptor, the user's command never receives write admission.
  if (claim.status !== "present") {
    cleanupFailedClaimInitialization(markerPath, descriptor, markerBytes);
    throw new PathWriteClaimError("claim-integrity", targetPath);
  }
  // Owner bytes prove who wrote the marker; this separate chain check proves the marker still belongs to the selected project.
  try {
    assertClaimDirectory(claimDirectory, targetPath);
  } catch (error) {
    cleanupFailedClaimInitialization(markerPath, descriptor, markerBytes);
    throw error;
  }
  return { targetPath, markerPath, snapshot: claim.snapshot, descriptor };
}

/**
 * Release one marker only when its entry and exact bytes still identify this owner.
 * Error behavior: swallows missing, replaced, unlink, and close failures into a status the command can report without deleting foreign state.
 */
function releaseOneClaim(
  claim: OwnedPathWriteClaim,
): PathWriteClaimReleaseResult {
  const current = readClaimSnapshot(claim.markerPath);
  // A marker removed before release is reported as missing unless the descriptor also cannot be closed.
  if (current.status === "missing") {
    const status = closeClaimDescriptor(claim.descriptor)
      ? "missing"
      : "unreadable";
    return { targetPath: claim.targetPath, status };
  }
  // A changed or unreadable marker belongs to an uncertain owner, so only this process's descriptor is closed.
  if (
    current.status !== "present" ||
    !claimSnapshotsMatch(current.snapshot, claim.snapshot)
  ) {
    const status = closeClaimDescriptor(claim.descriptor)
      ? "ownership-changed"
      : "unreadable";
    return { targetPath: claim.targetPath, status };
  }
  try {
    fs.unlinkSync(claim.markerPath);
    const status = closeClaimDescriptor(claim.descriptor)
      ? "released"
      : "unreadable";
    return { targetPath: claim.targetPath, status };
  } catch (error) {
    // A concurrent removal becomes missing; permission and close failures become unreadable for operator follow-up.
    const descriptorClosed = closeClaimDescriptor(claim.descriptor);
    return {
      targetPath: claim.targetPath,
      status:
        descriptorClosed && (error as NodeJS.ErrnoException).code === "ENOENT"
          ? "missing"
          : "unreadable",
    };
  }
}

/**
 * Normalize and validate a complete admission request before any marker is created.
 * Invariant: deterministic UTF-8 byte ordering makes cooperating writers acquire overlapping targets in the same order.
 *
 * @throws PathWriteClaimError when any target path or expected identity is invalid
 */
function normalizeClaimRequests(
  requests: readonly PathWriteClaimRequest[],
): NormalizedPathWriteClaimRequest[] {
  const normalizedRequests = requests.map((request) => {
    const targetPath = normalizeTargetPath(request.targetPath);
    validateExpectedIdentity(targetPath, request.expectedIdentity);
    return { targetPath, expectedIdentity: request.expectedIdentity };
  });
  normalizedRequests.sort((left, right) =>
    compareTargetPaths(left.targetPath, right.targetPath),
  );
  return normalizedRequests;
}

/**
 * Reject duplicate targets after canonical ordering makes them adjacent.
 * Use before admission so one user command cannot acquire the same project file twice.
 *
 * @throws PathWriteClaimError when two requests name the same canonical target
 */
function assertUniqueClaimTargets(
  requests: readonly NormalizedPathWriteClaimRequest[],
): void {
  // Adjacent comparison is sufficient because normalization has already placed equal target paths together.
  for (let index = 1; index < requests.length; index += 1) {
    const current = requests[index];
    const previous = requests[index - 1];
    // Duplicate requests would make one command contend with its own marker and hide the real input error.
    if (current && previous && current.targetPath === previous.targetPath) {
      throw new PathWriteClaimError("duplicate-target", current.targetPath);
    }
  }
}

/** Build an opaque batch and retain its process-local owner records. */
function createClaimBatch(
  projectRoot: string,
  requests: readonly NormalizedPathWriteClaimRequest[],
  ownedClaims: readonly OwnedPathWriteClaim[],
): PathWriteClaimBatch {
  const batch = Object.freeze({
    projectRoot,
    targetPaths: Object.freeze(requests.map((request) => request.targetPath)),
  });
  OWNED_BATCHES.set(batch, ownedClaims);
  return batch;
}

/** Reject unsafe target shapes before coordination state is created. */
function prevalidateClaimTargets(
  projectRoot: string,
  requests: readonly NormalizedPathWriteClaimRequest[],
): void {
  for (const request of requests) {
    readIdentityAtRoot(projectRoot, request.targetPath);
  }
}

/**
 * Acquire every sorted marker, then compare user-visible file identities while the full batch is held.
 * Error behavior: throws one typed admission failure with every partial cleanup result attached for operator recovery.
 */
function acquireAndValidateClaims(
  projectRoot: string,
  claimDirectory: ClaimDirectory,
  requests: readonly NormalizedPathWriteClaimRequest[],
  fallbackTargetPath: string,
): OwnedPathWriteClaim[] {
  const ownedClaims: OwnedPathWriteClaim[] = [];
  try {
    // Holding the complete sorted batch prevents cooperating commands from interleaving writes to any selected target.
    for (const request of requests) {
      ownedClaims.push(acquireOneClaim(claimDirectory, request.targetPath));
    }
    // Every file is re-read only after the full batch is held, so changed user bytes cancel the whole operation.
    for (const request of requests) {
      const currentIdentity = readIdentityAtRoot(
        projectRoot,
        request.targetPath,
      );
      // The user must retry from fresh bytes when any target changed between preview and admission.
      if (!identitiesMatch(currentIdentity, request.expectedIdentity)) {
        throw new PathWriteClaimError("target-changed", request.targetPath);
      }
    }
    return ownedClaims;
  } catch (error) {
    // Contention, changed files, and I/O failures all unwind this command's partial markers before the refusal reaches the user.
    throw admissionFailure(error, fallbackTargetPath, ownedClaims);
  }
}

/** Release a partial batch while preserving every cleanup outcome for the caller. */
function releaseOwnedClaims(
  claims: readonly OwnedPathWriteClaim[],
): PathWriteClaimReleaseResult[] {
  return claims.map((claim) => releaseOneClaim(claim));
}

/** Re-throw one admission failure with partial-claim cleanup evidence attached. */
function admissionFailure(
  error: unknown,
  fallbackTargetPath: string,
  ownedClaims: readonly OwnedPathWriteClaim[],
): PathWriteClaimError {
  const cleanupResults = releaseOwnedClaims(ownedClaims);
  if (error instanceof PathWriteClaimError) {
    return new PathWriteClaimError(
      error.reason,
      error.targetPath,
      cleanupResults,
    );
  }
  return new PathWriteClaimError(
    "coordination-unavailable",
    fallbackTargetPath,
    cleanupResults,
  );
}

/**
 * Capture one target's missing-or-digest identity without following linked path components.
 * Use before asking for admission; the batch acquisition repeats this read while claims are held.
 *
 * @param projectRoot - selected real project directory
 * @param targetPath - normalized POSIX-shaped project-relative file path
 * @returns missing state or the lowercase SHA-256 of exact current bytes
 */
export function readPathWriteTargetIdentity(
  projectRoot: string,
  targetPath: string,
): PathWriteTargetIdentity {
  const canonicalRoot = resolveProjectRoot(projectRoot);
  const canonicalTarget = normalizeTargetPath(targetPath);
  return readIdentityAtRoot(canonicalRoot, canonicalTarget);
}

/**
 * Acquire a complete sorted claim batch and revalidate every expected identity.
 * Use before staging or mutating any target; contention or changed bytes unwind only this operation's acquired markers.
 *
 * @param projectRoot - selected real project directory shared by every request
 * @param requests - complete target set with identities captured before admission
 * @returns opaque held batch whose target paths are in canonical UTF-8 byte order
 * @throws PathWriteClaimError when targets are unsafe, changed, busy, unreadable, duplicated, or unsupported by the selected filesystem
 */
export function acquirePathWriteClaims(
  projectRoot: string,
  requests: readonly PathWriteClaimRequest[],
): PathWriteClaimBatch {
  const canonicalRoot = resolveProjectRoot(projectRoot);
  const normalizedRequests = normalizeClaimRequests(requests);
  assertUniqueClaimTargets(normalizedRequests);
  const firstRequest = normalizedRequests[0];
  if (!firstRequest) return createClaimBatch(canonicalRoot, [], []);

  prevalidateClaimTargets(canonicalRoot, normalizedRequests);
  const firstTarget = firstRequest.targetPath;
  const claimDirectory = ensureClaimDirectory(canonicalRoot, firstTarget);
  const ownedClaims = acquireAndValidateClaims(
    canonicalRoot,
    claimDirectory,
    normalizedRequests,
    firstTarget,
  );
  return createClaimBatch(canonicalRoot, normalizedRequests, ownedClaims);
}

/**
 * Release every marker still owned by this batch and report missing or changed entries.
 * Use in a caller's `finally` block; a non-released result needs operator-visible recovery rather than pattern deletion.
 *
 * @param batch - exact opaque value returned by `acquirePathWriteClaims`
 * @returns one owner-check result per canonical target path
 * @throws Error when this process did not acquire the supplied batch
 */
export function releasePathWriteClaims(
  batch: PathWriteClaimBatch,
): PathWriteClaimReleaseResult[] {
  const ownedClaims = OWNED_BATCHES.get(batch);
  if (!ownedClaims) {
    throw new Error("Path-write claim batch was not acquired by this process.");
  }
  OWNED_BATCHES.delete(batch);
  return releaseOwnedClaims(ownedClaims);
}

/**
 * Inspect the bounded marker for one canonical target without removing it or creating directories.
 * Use to show an operator the exact marker identity that explicit abandoned-claim recovery would remove.
 *
 * @param projectRoot - selected real project directory
 * @param targetPath - normalized POSIX-shaped project-relative target path
 * @returns opaque recovery evidence, or null when no marker exists
 * @throws PathWriteClaimError when the project, target, or marker cannot be validated safely
 */
export function inspectPathWriteClaim(
  projectRoot: string,
  targetPath: string,
): AbandonedPathWriteClaimEvidence | null {
  const canonicalRoot = resolveProjectRoot(projectRoot);
  const canonicalTarget = normalizeTargetPath(targetPath);
  const claimDirectory = existingClaimDirectory(canonicalRoot, canonicalTarget);
  // No coordination directory means the user has no abandoned marker to inspect for this target.
  if (claimDirectory === null) return null;
  const markerPath = claimMarkerPath(claimDirectory, canonicalTarget);
  const marker = readClaimSnapshot(markerPath);
  // A marker removed before inspection likewise leaves no recovery action for the operator.
  if (marker.status === "missing") return null;
  // Unsafe marker bytes or shape are never converted into evidence that could authorize deletion.
  if (marker.status !== "present") {
    throw new PathWriteClaimError("claim-integrity", canonicalTarget);
  }
  const evidence = Object.freeze({
    projectRoot: canonicalRoot,
    targetPath: canonicalTarget,
    markerPath,
    markerSha256: marker.snapshot.sha256,
  });
  RECOVERY_SNAPSHOTS.set(evidence, marker.snapshot);
  return evidence;
}

/**
 * Remove only the unchanged marker an operator has confirmed is abandoned.
 * Never call from elapsed time or process-liveness guesses; changed evidence stays fail-closed for a fresh inspection.
 *
 * @param evidence - exact opaque snapshot returned by `inspectPathWriteClaim`
 * @returns whether that same marker was removed, had disappeared, or changed
 * @throws Error when this process did not issue the supplied evidence
 */
export function removeConfirmedAbandonedPathWriteClaim(
  evidence: AbandonedPathWriteClaimEvidence,
): AbandonedPathWriteClaimRemoval {
  const expected = RECOVERY_SNAPSHOTS.get(evidence);
  // Only evidence issued by this process can authorize the operator-confirmed removal step.
  if (!expected) {
    throw new Error(
      "Abandoned path-write claim evidence was not inspected by this process.",
    );
  }
  RECOVERY_SNAPSHOTS.delete(evidence);
  const current = readClaimSnapshot(evidence.markerPath);
  // Another actor may already have removed the confirmed marker, leaving no recovery work.
  if (current.status === "missing") return "missing";
  // Any change since inspection cancels deletion so the operator can review fresh evidence.
  if (
    current.status !== "present" ||
    !claimSnapshotsMatch(current.snapshot, expected)
  ) {
    return "changed";
  }
  try {
    fs.unlinkSync(evidence.markerPath);
    return "removed";
  } catch (error) {
    // A concurrent removal is complete; permission or I/O failures leave the marker classified as changed for fresh inspection.
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? "missing"
      : "changed";
  }
}
