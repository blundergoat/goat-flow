/** Preserve scanner-owned exact-repeat recovery; verified launcher turn allowances stay with their existing owner. */
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  readStopStateMode,
  resolveStopReentryRootWithoutGit,
  setStopStatePaths,
  type PostTurnContext,
} from "./context.mjs";

// Windows has no uid, so ownership is not compared there; any other host without getuid rejects every existing state file.
const ownerId =
  process.getuid?.() ?? (process.platform === "win32" ? null : undefined);

function stopStateIsSafe(path: string, mayBeMissing = false): boolean {
  try {
    const state = lstatSync(path);
    return state.isFile() && (ownerId === null || state.uid === ownerId);
  } catch (error) {
    return mayBeMissing && (error as NodeJS.ErrnoException).code === "ENOENT";
  }
}

/** Clear only this session's regular owned record; unsafe state remains untouched. */
export function clearStopReentryState(
  context: PostTurnContext,
  root: string,
): boolean {
  if (!context.stopPayloadPresent) return true;
  const paths = setStopStatePaths(context, root);
  if (!stopStateIsSafe(paths.path, true)) return false;
  try {
    rmSync(paths.path, { force: true });
    return true;
  } catch {
    return false;
  }
}

/** Hash the Bash here-string bytes, including its final newline, without retaining the failure text. */
export function hashStopFailure(identity: string): string | null {
  try {
    return createHash("sha256").update(`${identity}\n`).digest("hex");
  } catch {
    return null;
  }
}

/** Persist only session/failure hashes through exclusive creation and atomic replacement. */
export function writeStopReentryState(
  context: PostTurnContext,
  root: string,
  failure: string,
): boolean {
  const paths = setStopStatePaths(context, root);
  try {
    for (const directory of [join(root, ".goat-flow"), paths.directory]) {
      if (lstatSync(directory, { throwIfNoEntry: false })?.isSymbolicLink())
        return false;
    }
    mkdirSync(paths.directory, { recursive: true, mode: 0o700 });
    if (
      !stopStateIsSafe(paths.path, true) ||
      !stopStateIsSafe(paths.tempPath, true)
    )
      return false;
    rmSync(paths.tempPath, { force: true });
    writeFileSync(
      paths.tempPath,
      `v1 ${context.sessionFingerprint} ${failure}\n`,
      { flag: "wx", mode: 0o600 },
    );
    chmodSync(paths.tempPath, 0o600);
    renameSync(paths.tempPath, paths.path);
    return true;
  } catch {
    try {
      if (stopStateIsSafe(paths.tempPath)) rmSync(paths.tempPath);
    } catch {
      /* Failed cleanup leaves recovery unavailable. */
    }
    return false;
  }
}

/** Require the exact saved session/failure and host-appropriate ownership before ending one replay. */
export function stopReentryStateMatches(
  context: PostTurnContext,
  root: string,
  failure: string,
): boolean {
  const paths = setStopStatePaths(context, root);
  if (!stopStateIsSafe(paths.path)) return false;
  if (process.platform !== "win32" && readStopStateMode(paths.path) !== "600")
    return false;
  try {
    const descriptor = openSync(paths.path, "r");
    let record: string;
    try {
      // Written records are 133 bytes; a first line that does not end within 512 bytes never matches, so the caller blocks and rewrites it.
      const bytes = Buffer.alloc(512);
      record = bytes
        .subarray(0, readSync(descriptor, bytes, 0, bytes.length, 0))
        .toString("utf8");
    } finally {
      closeSync(descriptor);
    }
    const newline = record.indexOf("\n");
    if (newline < 0) return false;
    const fields = record
      .slice(0, newline)
      .replace(/^ +| +$/gu, "")
      .split(/ +/u);
    return (
      fields.length === 3 &&
      fields[0] === "v1" &&
      fields[1] === context.sessionFingerprint &&
      fields[2] === failure
    );
  } catch {
    return false;
  }
}

/** Block fresh or changed infrastructure failures; only an exact active legacy replay may end incomplete. */
export function finishInfrastructureFailure(
  context: PostTurnContext,
  root: string,
  identity: string,
): number {
  context.infrastructureFailure = true;
  if (context.environment.GOAT_FLOW_STOP_RECOVERY_OWNER === "launcher")
    return 2;
  if (!context.stopPayloadPresent || context.sessionFingerprint === "")
    return 2;
  const failure = hashStopFailure(identity);
  if (failure === null) {
    process.stderr.write(
      "post-turn-safety: repeated-Stop state unavailable; keeping the turn blocked.\n",
    );
    return 2;
  }
  if (
    context.stopHookActive &&
    stopReentryStateMatches(context, root, failure)
  ) {
    context.boundedReentryEnded = true;
    clearStopReentryState(context, root);
    process.stderr.write(
      "post-turn-safety: ending repeated Stop after unchanged infrastructure failure; no clean scan was recorded.\n",
    );
    return 0;
  }
  if (!writeStopReentryState(context, root, failure))
    process.stderr.write(
      "post-turn-safety: repeated-Stop state unavailable; keeping the turn blocked.\n",
    );
  return 2;
}

/** An unavailable Git root may use exact-repeat state only under a verified managed installation. */
export function finishRepositoryRootFailure(
  context: PostTurnContext,
  identity: string,
): number {
  const root = resolveStopReentryRootWithoutGit(context);
  return root === null
    ? 2
    : finishInfrastructureFailure(context, root, identity);
}

/** Explain Git's root refusal without exposing arbitrary child diagnostics or changing trust configuration. */
export function reportRepositoryRootFailure(
  context: PostTurnContext,
  gitError: string,
): void {
  context.detail = "The selected Git repository root could not be opened";
  process.stderr.write(
    "post-turn-safety: scan incomplete (git repository root unavailable).\n",
  );
  if (gitError.includes("dubious ownership")) {
    context.detail =
      "Git refused this repository for dubious ownership; the user must add it to Git safe.directory before the scan can run";
    process.stderr.write(`post-turn-safety: ${context.detail}.\n`);
  }
}
