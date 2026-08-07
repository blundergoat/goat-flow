/**
 * Serialize dashboard quality-draft processing across independent server processes.
 * Owners acquire one `wx` marker before reading report text. A second marker fences
 * stale-claim rejection against an owner refreshing immediately before persistence,
 * so crash recovery rejects ambiguous work instead of replaying it.
 */
import { randomBytes } from "node:crypto";
import {
  lstatSync,
  readFileSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const DRAFT_NAME_PREFIX = "goat-quality-draft-";
const CLAIM_NAME_PREFIX = "goat-quality-claim-";
const REAP_NAME_PREFIX = "goat-quality-reap-";
const MAX_MARKER_BYTES = 4096;
const DRAFT_SUFFIX_PATTERN = /^[A-Za-z0-9_-]{1,64}\.json$/u;

/** Durable owner marker held while one process reads and persists a draft. */
export interface QualityDraftClaim {
  draftName: string;
  path: string;
  reapPath: string;
  token: string;
}

/** Inputs needed to acquire or reject one project-wide draft claim. */
export interface AcquireQualityDraftClaimOptions {
  stagingDir: string;
  draftName: string;
  staleMs: number;
  /** Write the bounded receipt that makes an ambiguous stale draft terminal. */
  rejectStaleDraft(): void;
}

/** Non-following identity used to avoid unlinking a marker that changed during recovery. */
interface ClaimSnapshot {
  dev: number;
  ino: number;
  mtimeMs: number;
  size: number;
}

/** Resolve one ownership marker paired with the draft filename. */
function claimMarkerPath(
  stagingDir: string,
  draftName: string,
  prefix: typeof CLAIM_NAME_PREFIX | typeof REAP_NAME_PREFIX,
): string {
  return join(stagingDir, prefix + draftName.slice(DRAFT_NAME_PREFIX.length));
}

/** Read a bounded owner token; unsafe, missing, or malformed markers recover as null. */
function readClaimOwner(path: string): string | null {
  try {
    const stats = lstatSync(path);
    if (!stats.isFile() || stats.nlink !== 1 || stats.size > MAX_MARKER_BYTES) {
      return null;
    }
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("owner" in parsed) ||
      typeof parsed.owner !== "string" ||
      !/^[a-f0-9]{32}$/u.test(parsed.owner)
    ) {
      return null;
    }
    return parsed.owner;
  } catch {
    return null;
  }
}

/** Return a non-following identity; missing is null and the function throws on other errors. */
function claimSnapshot(path: string): ClaimSnapshot | null {
  try {
    const stats = lstatSync(path);
    return {
      dev: stats.dev,
      ino: stats.ino,
      mtimeMs: stats.mtimeMs,
      size: stats.size,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** Compare a marker against the exact non-following entry previously judged stale. */
function claimStillMatches(path: string, expected: ClaimSnapshot): boolean {
  const current = claimSnapshot(path);
  return (
    current !== null &&
    current.dev === expected.dev &&
    current.ino === expected.ino &&
    current.mtimeMs === expected.mtimeMs &&
    current.size === expected.size
  );
}

/** Treat unsafe marker shapes as abandoned and valid files as stale after their lease. */
function staleClaimSnapshot(
  path: string,
  staleMs: number,
): ClaimSnapshot | null {
  const snapshot = claimSnapshot(path);
  if (snapshot === null) return null;
  let isSafeFile = false;
  try {
    const stats = lstatSync(path);
    isSafeFile =
      stats.isFile() && stats.nlink === 1 && stats.size <= MAX_MARKER_BYTES;
  } catch {
    return null;
  }
  if (!isSafeFile) return snapshot;
  // Zero is the test/recovery contract for immediate expiry. Bypass timestamp
  // arithmetic because filesystem mtime precision may place a fresh marker
  // fractionally ahead of the integer-valued Date.now() clock.
  if (staleMs <= 0) return snapshot;
  return Date.now() - snapshot.mtimeMs >= staleMs ? snapshot : null;
}

/** Writes a private marker atomically; `EEXIST` returns false and the function throws otherwise. */
function writeExclusiveMarker(path: string, token: string): boolean {
  try {
    writeFileSync(
      path,
      `${JSON.stringify({ owner: token, pid: process.pid, claimed_at: new Date().toISOString() })}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw new Error("quality capture: could not create draft ownership claim.");
  }
  const stats = lstatSync(path);
  if (!stats.isFile() || stats.nlink !== 1 || readClaimOwner(path) !== token) {
    throw new Error(
      "quality capture: draft ownership claim must be a single-link regular file.",
    );
  }
  return true;
}

/** Remove only this token's marker; filesystem cleanup failures recover as false. */
function releaseOwnedMarker(path: string, token: string): boolean {
  if (readClaimOwner(path) !== token) return false;
  try {
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}

/** Remove an unchanged abandoned marker; filesystem cleanup failures recover as false. */
function removeStaleMarker(path: string, snapshot: ClaimSnapshot): boolean {
  if (!claimStillMatches(path, snapshot)) return false;
  try {
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}

/** Complete one fenced stale rejection and retire only the entries the reaper inspected. */
function finishStaleClaimRejection(
  options: AcquireQualityDraftClaimOptions,
  claimPath: string,
  claimIdentity: ClaimSnapshot | null,
  reapPath: string,
  reapIdentity: ClaimSnapshot,
): void {
  try {
    options.rejectStaleDraft();
  } finally {
    if (claimIdentity !== null) removeStaleMarker(claimPath, claimIdentity);
    removeStaleMarker(reapPath, reapIdentity);
  }
}

/** Fence and reject a stale claim while live owners and competing reapers skip it. */
function rejectIfClaimIsStale(
  options: AcquireQualityDraftClaimOptions,
  claimPath: string,
  reapPath: string,
): boolean {
  const anyClaim = claimSnapshot(claimPath);
  const claimIdentity = staleClaimSnapshot(claimPath, options.staleMs);
  const existingReap = claimSnapshot(reapPath);
  if (existingReap !== null) {
    const staleReap = staleClaimSnapshot(reapPath, options.staleMs);
    if (staleReap === null) return true;
    // A refreshed owner outlived an abandoned reaper, so its draft remains untouched.
    if (anyClaim !== null && claimIdentity === null) {
      removeStaleMarker(reapPath, staleReap);
      return true;
    }
    finishStaleClaimRejection(
      options,
      claimPath,
      claimIdentity,
      reapPath,
      staleReap,
    );
    return true;
  }
  if (claimIdentity === null) return false;

  const reapToken = randomBytes(16).toString("hex");
  if (!writeExclusiveMarker(reapPath, reapToken)) return true;
  const reapIdentity = claimSnapshot(reapPath);
  if (reapIdentity === null) return true;

  // A lease refresh before persistence wins; the reaper backs off without touching the draft.
  if (
    !claimStillMatches(claimPath, claimIdentity) ||
    staleClaimSnapshot(claimPath, options.staleMs) === null
  ) {
    releaseOwnedMarker(reapPath, reapToken);
    return true;
  }
  finishStaleClaimRejection(
    options,
    claimPath,
    claimIdentity,
    reapPath,
    reapIdentity,
  );
  return true;
}

/**
 * Acquire the project-wide claim required before reading one stable draft.
 * A live owner or reaper returns null. A stale owner invokes the supplied
 * terminal-rejection callback while the reaper fence blocks persistence.
 *
 * @param options - staging paths, lease, draft identity, and bounded stale-rejection action
 * @returns owned claim, or null when this process must skip the draft
 */
export function acquireQualityDraftClaim(
  options: AcquireQualityDraftClaimOptions,
): QualityDraftClaim | null {
  const path = claimMarkerPath(
    options.stagingDir,
    options.draftName,
    CLAIM_NAME_PREFIX,
  );
  const reapPath = claimMarkerPath(
    options.stagingDir,
    options.draftName,
    REAP_NAME_PREFIX,
  );
  if (claimSnapshot(reapPath) !== null) {
    rejectIfClaimIsStale(options, path, reapPath);
    return null;
  }

  const token = randomBytes(16).toString("hex");
  if (!writeExclusiveMarker(path, token)) {
    rejectIfClaimIsStale(options, path, reapPath);
    return null;
  }
  return { draftName: options.draftName, path, reapPath, token };
}

/**
 * Recover the draft identity encoded by one claim or reaper directory entry.
 * Invalid or unrelated entries remain outside the ownership pipeline.
 *
 * @param entry - one staging-directory basename; paths and malformed suffixes are rejected
 * @returns paired draft basename, or null for an unrelated/invalid marker
 */
export function qualityDraftNameFromOwnershipMarker(
  entry: string,
): string | null {
  const prefix = entry.startsWith(CLAIM_NAME_PREFIX)
    ? CLAIM_NAME_PREFIX
    : entry.startsWith(REAP_NAME_PREFIX)
      ? REAP_NAME_PREFIX
      : null;
  if (prefix === null) return null;
  const suffix = entry.slice(prefix.length);
  return DRAFT_SUFFIX_PATTERN.test(suffix)
    ? `${DRAFT_NAME_PREFIX}${suffix}`
    : null;
}

/**
 * Inspect an existing owner/reaper pair without ever acquiring a new claim.
 * This recovers the crash window where the former owner deleted its draft but
 * died before writing a receipt: fresh owners remain untouched, while stale or
 * abandoned ownership invokes the same fenced terminal-rejection path.
 *
 * @param options - staging paths, lease, draft identity, and bounded rejection action
 */
export function rejectStaleQualityDraftClaim(
  options: AcquireQualityDraftClaimOptions,
): void {
  const path = claimMarkerPath(
    options.stagingDir,
    options.draftName,
    CLAIM_NAME_PREFIX,
  );
  const reapPath = claimMarkerPath(
    options.stagingDir,
    options.draftName,
    REAP_NAME_PREFIX,
  );
  if (claimSnapshot(path) === null && claimSnapshot(reapPath) === null) return;
  rejectIfClaimIsStale(options, path, reapPath);
}

/**
 * Refresh and revalidate this process's claim immediately before persistence.
 * Filesystem errors recover as false so the caller skips the irreversible write.
 *
 * @param claim - marker acquired for this draft; an absent marker fails ownership
 * @returns true only while the owner token remains fenced against stale rejection
 */
export function refreshQualityDraftClaim(claim: QualityDraftClaim): boolean {
  if (claimSnapshot(claim.reapPath) !== null) return false;
  if (readClaimOwner(claim.path) !== claim.token) return false;
  try {
    const now = new Date();
    utimesSync(claim.path, now, now);
  } catch {
    return false;
  }
  return (
    claimSnapshot(claim.reapPath) === null &&
    readClaimOwner(claim.path) === claim.token
  );
}

/**
 * Return whether the durable claim still carries this process's owner token.
 *
 * @param claim - marker expected to belong to this process; missing means ownership was lost
 * @returns true only for the same bounded regular-file owner token
 */
export function isQualityDraftClaimOwned(claim: QualityDraftClaim): boolean {
  return readClaimOwner(claim.path) === claim.token;
}

/**
 * Release only this process's claim; missing or replaced markers remain untouched.
 *
 * @param claim - marker to remove; absent or foreign ownership produces no filesystem mutation
 */
export function releaseQualityDraftClaim(claim: QualityDraftClaim): void {
  releaseOwnedMarker(claim.path, claim.token);
}
