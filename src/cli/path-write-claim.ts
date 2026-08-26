/**
 * Coordinate cooperative filesystem writers with path-keyed exclusive claims.
 *
 * Callers capture target identities before admission, hold the returned batch through their complete write transaction, and release it in a
 * `finally` block. Claims never expire: an abandoned marker needs explicit operator-confirmed recovery.
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

/** A fail-closed claim refusal with the target and any rollback cleanup evidence. */
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

/** Require the POSIX-shaped target identity used to derive a cross-platform claim key. */
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

/** Resolve a real, non-symlink project root before any coordination state is created. */
function resolveProjectRoot(projectRoot: string): string {
  const absoluteRoot = resolve(projectRoot);
  try {
    const stats = fs.lstatSync(absoluteRoot);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new PathWriteClaimError("unsafe-project", ".");
    }
  } catch (error) {
    if (error instanceof PathWriteClaimError) throw error;
    throw new PathWriteClaimError("unsafe-project", ".");
  }
  return absoluteRoot;
}

/** Read optional target metadata; absence is valid and every other read error is blocking. */
function readTargetStats(
  absolutePath: string,
  targetPath: string,
): fs.Stats | null {
  try {
    return fs.lstatSync(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new PathWriteClaimError("target-unreadable", targetPath);
  }
}

/** Return whether one entry is a private regular-file identity safe to hash or replace. */
function isSingleLinkRegularFile(stats: fs.Stats): boolean {
  return stats.isFile() && !stats.isSymbolicLink() && stats.nlink === 1;
}

/** Require every existing parent to be a real directory; a missing parent means the target is missing. */
function targetParentsExist(
  projectRoot: string,
  parentSegments: readonly string[],
  targetPath: string,
): boolean {
  let cursor = projectRoot;
  for (const segment of parentSegments) {
    cursor = join(cursor, segment);
    const stats = readTargetStats(cursor, targetPath);
    if (stats === null) return false;
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new PathWriteClaimError("unsafe-target", targetPath);
    }
  }
  return true;
}

/** Read bytes and require the directory entry to retain its identity through that read. */
function readStableTargetBytes(
  absoluteTarget: string,
  targetPath: string,
  before: fs.Stats,
): Buffer {
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(absoluteTarget);
  } catch {
    throw new PathWriteClaimError("target-unreadable", targetPath);
  }
  const after = readTargetStats(absoluteTarget, targetPath);
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
 */
function readIdentityAtRoot(
  projectRoot: string,
  targetPath: string,
): PathWriteTargetIdentity {
  const segments = targetPath.split("/");
  if (!targetParentsExist(projectRoot, segments.slice(0, -1), targetPath)) {
    return { state: "missing" };
  }
  const absoluteTarget = join(projectRoot, ...segments);
  const before = readTargetStats(absoluteTarget, targetPath);
  if (before === null) return { state: "missing" };
  if (!isSingleLinkRegularFile(before)) {
    throw new PathWriteClaimError("unsafe-target", targetPath);
  }
  const bytes = readStableTargetBytes(absoluteTarget, targetPath, before);
  return { state: "present", sha256: sha256(bytes) };
}

/** Validate a caller-supplied expected state before it can authorize admission. */
function validateExpectedIdentity(
  targetPath: string,
  identity: PathWriteTargetIdentity,
): void {
  if (identity.state === "missing") return;
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

/** Create one directory component or accept a concurrent creator, then reject redirection. */
function ensureCoordinationDirectory(
  directoryPath: string,
  targetPath: string,
): void {
  try {
    fs.mkdirSync(directoryPath, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw new PathWriteClaimError("coordination-unavailable", targetPath);
    }
  }
  try {
    const stats = fs.lstatSync(directoryPath);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new PathWriteClaimError("claim-integrity", targetPath);
    }
  } catch (error) {
    if (error instanceof PathWriteClaimError) throw error;
    throw new PathWriteClaimError("coordination-unavailable", targetPath);
  }
}

/** Create and validate the project-local claim directory. */
function ensureClaimDirectory(projectRoot: string, targetPath: string): string {
  const goatFlowDirectory = join(projectRoot, ".goat-flow");
  ensureCoordinationDirectory(goatFlowDirectory, targetPath);
  const claimDirectory = join(goatFlowDirectory, "write-claims");
  ensureCoordinationDirectory(claimDirectory, targetPath);
  return claimDirectory;
}

/** Resolve an existing safe claim directory without creating local state. */
function existingClaimDirectory(
  projectRoot: string,
  targetPath: string,
): string | null {
  const components = [
    join(projectRoot, ".goat-flow"),
    join(projectRoot, CLAIM_DIRECTORY),
  ];
  for (const component of components) {
    try {
      const stats = fs.lstatSync(component);
      if (!stats.isDirectory() || stats.isSymbolicLink()) {
        throw new PathWriteClaimError("claim-integrity", targetPath);
      }
    } catch (error) {
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

/** Read marker metadata without treating an absent claim as an integrity error. */
function readClaimStats(markerPath: string): ClaimStatsResult {
  try {
    return {
      status: "present",
      stats: fs.lstatSync(markerPath, { bigint: true }),
    };
  } catch (error) {
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

/** Read one already-validated marker and reject path replacement during the read. */
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

/** Re-read one new marker and prove its path still names this owner's open descriptor. */
function readOwnedClaimSnapshot(
  markerPath: string,
  descriptor: number,
  markerBytes: Buffer,
): ClaimSnapshotResult {
  let descriptorStats: fs.BigIntStats;
  try {
    descriptorStats = fs.fstatSync(descriptor, { bigint: true });
  } catch {
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

/** Close a held descriptor and report cleanup failure without masking the primary outcome. */
function closeClaimDescriptor(descriptor: number): boolean {
  try {
    fs.closeSync(descriptor);
    return true;
  } catch {
    return false;
  }
}

/** Exclusively create, fill, and flush one marker while retaining its descriptor. */
function createClaimMarker(
  markerPath: string,
  markerBytes: Buffer,
  targetPath: string,
): number {
  let descriptor: number;
  try {
    descriptor = fs.openSync(markerPath, "wx", 0o600);
  } catch (error) {
    throw exclusiveCreateFailure(error, targetPath);
  }
  try {
    fs.writeFileSync(descriptor, markerBytes);
    fs.fsyncSync(descriptor);
    return descriptor;
  } catch (error) {
    closeClaimDescriptor(descriptor);
    throw exclusiveCreateFailure(error, targetPath);
  }
}

/** Write and re-read one private owner marker through exclusive creation. */
function acquireOneClaim(
  claimDirectory: string,
  targetPath: string,
): OwnedPathWriteClaim {
  const markerPath = claimMarkerPath(claimDirectory, targetPath);
  const ownerToken = randomBytes(16).toString("hex");
  const markerBytes = Buffer.from(
    `${JSON.stringify({ schemaVersion: CLAIM_SCHEMA, targetPath, ownerToken })}\n`,
    "utf8",
  );
  const descriptor = createClaimMarker(markerPath, markerBytes, targetPath);
  const claim = readOwnedClaimSnapshot(markerPath, descriptor, markerBytes);
  if (claim.status !== "present") {
    closeClaimDescriptor(descriptor);
    throw new PathWriteClaimError("claim-integrity", targetPath);
  }
  return { targetPath, markerPath, snapshot: claim.snapshot, descriptor };
}

/** Release one marker only when its entry and exact bytes still identify this owner. */
function releaseOneClaim(
  claim: OwnedPathWriteClaim,
): PathWriteClaimReleaseResult {
  const current = readClaimSnapshot(claim.markerPath);
  if (current.status === "missing") {
    const status = closeClaimDescriptor(claim.descriptor)
      ? "missing"
      : "unreadable";
    return { targetPath: claim.targetPath, status };
  }
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
    closeClaimDescriptor(claim.descriptor);
    return {
      targetPath: claim.targetPath,
      status:
        (error as NodeJS.ErrnoException).code === "ENOENT"
          ? "missing"
          : "unreadable",
    };
  }
}

/** Normalize, validate, and deterministically order a complete admission request. */
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

/** Reject duplicate targets after canonical ordering makes them adjacent. */
function assertUniqueClaimTargets(
  requests: readonly NormalizedPathWriteClaimRequest[],
): void {
  for (let index = 1; index < requests.length; index += 1) {
    const current = requests[index];
    const previous = requests[index - 1];
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

/** Acquire every sorted marker, then compare identities while the full batch is held. */
function acquireAndValidateClaims(
  projectRoot: string,
  claimDirectory: string,
  requests: readonly NormalizedPathWriteClaimRequest[],
  fallbackTargetPath: string,
): OwnedPathWriteClaim[] {
  const ownedClaims: OwnedPathWriteClaim[] = [];
  try {
    for (const request of requests) {
      ownedClaims.push(acquireOneClaim(claimDirectory, request.targetPath));
    }
    for (const request of requests) {
      const currentIdentity = readIdentityAtRoot(
        projectRoot,
        request.targetPath,
      );
      if (!identitiesMatch(currentIdentity, request.expectedIdentity)) {
        throw new PathWriteClaimError("target-changed", request.targetPath);
      }
    }
    return ownedClaims;
  } catch (error) {
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
 */
export function inspectPathWriteClaim(
  projectRoot: string,
  targetPath: string,
): AbandonedPathWriteClaimEvidence | null {
  const canonicalRoot = resolveProjectRoot(projectRoot);
  const canonicalTarget = normalizeTargetPath(targetPath);
  const claimDirectory = existingClaimDirectory(canonicalRoot, canonicalTarget);
  if (claimDirectory === null) return null;
  const markerPath = claimMarkerPath(claimDirectory, canonicalTarget);
  const marker = readClaimSnapshot(markerPath);
  if (marker.status === "missing") return null;
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
 */
export function removeConfirmedAbandonedPathWriteClaim(
  evidence: AbandonedPathWriteClaimEvidence,
): AbandonedPathWriteClaimRemoval {
  const expected = RECOVERY_SNAPSHOTS.get(evidence);
  if (!expected) {
    throw new Error(
      "Abandoned path-write claim evidence was not inspected by this process.",
    );
  }
  RECOVERY_SNAPSHOTS.delete(evidence);
  const current = readClaimSnapshot(evidence.markerPath);
  if (current.status === "missing") return "missing";
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
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? "missing"
      : "changed";
  }
}
