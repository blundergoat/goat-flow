/**
 * Process and filesystem contract for cooperative path-write claims.
 *
 * Use when `install` or `learn new` changes claim admission, contention, cleanup, or operator-confirmed recovery.
 * These tests cover cooperating writers; direct file edits remain outside the helper's guarantee.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { after, describe, it, type TestContext } from "node:test";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  PathWriteClaimError,
  acquirePathWriteClaims,
  inspectPathWriteClaim,
  readPathWriteTargetIdentity,
  releasePathWriteClaims,
  removeConfirmedAbandonedPathWriteClaim,
  type PathWriteClaimFailureReason,
} from "../../src/cli/path-write-claim.js";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
const CLAIM_MODULE_URL = pathToFileURL(
  join(PROJECT_ROOT, "src", "cli", "path-write-claim.ts"),
).href;
const TSX_LOADER_URL = pathToFileURL(
  join(PROJECT_ROOT, "node_modules", "tsx", "dist", "loader.mjs"),
).href;

const disposableRoots: string[] = [];

after(() => {
  // Every recorded directory is a suite-owned project fixture, never a user's workspace.
  for (const disposableProjectRoot of disposableRoots) {
    fs.rmSync(disposableProjectRoot, { recursive: true, force: true });
  }
});

/** Create one real project root that claim tests may mutate freely. */
function makeProject(): string {
  const projectRoot = fs.mkdtempSync(join(tmpdir(), "goat-flow-write-claim-"));
  disposableRoots.push(projectRoot);
  return projectRoot;
}

/**
 * Create a directory symlink in a disposable fixture, or skip when the host forbids unprivileged links.
 *
 * @returns true when the link exists; false after marking the test skipped for EPERM
 * @throws when symlink creation fails for any reason other than EPERM
 */
function symlinkDirectoryOrSkip(
  context: TestContext,
  targetPath: string,
  linkPath: string,
): boolean {
  try {
    fs.symlinkSync(targetPath, linkPath, "dir");
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EPERM") {
      context.skip(
        "Skipped: host blocks unprivileged symlinks (Windows without Developer Mode)",
      );
      return false;
    }
    throw error;
  }
}

/** POSIX exposes claim mode bits; Windows does not implement the same permission contract. */
function assertPrivateClaimModeWhenSupported(markerPath: string): void {
  if (process.platform === "win32") return;
  assert.equal(fs.statSync(markerPath).mode & 0o777, 0o600);
}

/**
 * Change a live marker and return the exact foreign bytes left at its path.
 * Filesystem side effects: mutates bytes on Windows and replaces the inode with the same bytes on POSIX.
 */
function tamperWithOwnedClaimMarker(
  markerPath: string,
  markerBytes: Buffer,
): Buffer {
  if (process.platform === "win32") {
    fs.appendFileSync(markerPath, "foreign-marker-state\n", "utf8");
  } else {
    fs.unlinkSync(markerPath);
    fs.writeFileSync(markerPath, markerBytes, { mode: 0o600 });
  }
  return fs.readFileSync(markerPath);
}

/** Require one exact helper refusal without accepting an unrelated exception. */
function assertClaimFailure(
  action: () => unknown,
  reason: PathWriteClaimFailureReason,
  targetPath: string,
): PathWriteClaimError {
  let captured: PathWriteClaimError | null = null;
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof PathWriteClaimError);
    assert.equal(error.reason, reason);
    assert.equal(error.targetPath, targetPath);
    captured = error;
    return true;
  });
  assert.ok(captured);
  return captured;
}

/** Stable child-process outcome shared by contention and abandoned-owner fixtures. */
interface ClaimProcessResult {
  didAcquireClaim: boolean;
  reason?: string;
  targetPath?: string;
}

type ClaimProcessMode = "abandon" | "mutate-and-release";

/**
 * Run one separate cooperating writer so process exit owns abandoned-descriptor cleanup.
 *
 * Filesystem side effects: may write the requested mutation or leave one claim marker behind after the child exits.
 * Error behavior: asserts a clean child exit before parsing its bounded JSON result.
 */
function runClaimProcess(
  projectRoot: string,
  targetPath: string,
  mode: ClaimProcessMode,
  mutationPath = "",
): ClaimProcessResult {
  const script = String.raw`
    import { writeFileSync } from "node:fs";
    const [moduleUrl, projectRoot, targetPath, mode, mutationPath] = process.argv.slice(1);
    const claims = await import(moduleUrl);
    try {
      const expectedIdentity = claims.readPathWriteTargetIdentity(projectRoot, targetPath);
      const batch = claims.acquirePathWriteClaims(projectRoot, [{ targetPath, expectedIdentity }]);
      if (mode === "mutate-and-release") {
        writeFileSync(mutationPath, "mutated\n", "utf8");
        claims.releasePathWriteClaims(batch);
      }
      process.stdout.write(JSON.stringify({ didAcquireClaim: true }));
    } catch (error) {
      // Contention and unsafe targets become structured child output so the parent test can assert what a user-facing command would receive.
      process.stdout.write(JSON.stringify({
        didAcquireClaim: false,
        reason: error instanceof claims.PathWriteClaimError ? error.reason : "unexpected",
        targetPath: error instanceof claims.PathWriteClaimError ? error.targetPath : undefined,
      }));
    }
  `;
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      TSX_LOADER_URL,
      "--input-type=module",
      "--eval",
      script,
      CLAIM_MODULE_URL,
      projectRoot,
      targetPath,
      mode,
      mutationPath,
    ],
    { cwd: PROJECT_ROOT, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout) as ClaimProcessResult;
}

/** Run a separate cooperating writer that mutates only after admission succeeds. */
function runContender(
  projectRoot: string,
  targetPath: string,
  mutationPath: string,
): ClaimProcessResult {
  return runClaimProcess(
    projectRoot,
    targetPath,
    "mutate-and-release",
    mutationPath,
  );
}

/** Leave one real marker behind after process exit closes its owning descriptor. */
function runAbandoningOwner(
  projectRoot: string,
  targetPath: string,
): ClaimProcessResult {
  return runClaimProcess(projectRoot, targetPath, "abandon");
}

describe("path write claims", () => {
  it("captures missing state and the SHA-256 identity of exact target bytes", () => {
    const projectRoot = makeProject();
    assert.deepEqual(readPathWriteTargetIdentity(projectRoot, "missing.txt"), {
      state: "missing",
    });

    const content = Buffer.from("managed bytes\n", "utf8");
    fs.writeFileSync(join(projectRoot, "managed.txt"), content);
    assert.deepEqual(readPathWriteTargetIdentity(projectRoot, "managed.txt"), {
      state: "present",
      sha256: createHash("sha256").update(content).digest("hex"),
    });
  });

  it("rejects a replaced coordination parent before allocating a claim marker", (context: TestContext) => {
    const projectRoot = makeProject();
    const outsideRoot = makeProject();
    const probePath = join(projectRoot, "symlink-probe");
    if (!symlinkDirectoryOrSkip(context, outsideRoot, probePath)) return;
    fs.unlinkSync(probePath);

    const targetPath = "managed.txt";
    const expectedIdentity = readPathWriteTargetIdentity(
      projectRoot,
      targetPath,
    );
    const goatFlowDirectory = join(projectRoot, ".goat-flow");
    const originalGoatFlowDirectory = join(projectRoot, "owned-goat-flow");
    const claimDirectory = join(goatFlowDirectory, "write-claims");
    const originalMkdirSync = fs.mkdirSync;
    let hasSwappedParent = false;
    context.mock.method(
      fs,
      "mkdirSync",
      (path: fs.PathLike, options?: fs.MakeDirectoryOptions) => {
        if (!hasSwappedParent && path === claimDirectory) {
          hasSwappedParent = true;
          fs.renameSync(goatFlowDirectory, originalGoatFlowDirectory);
          fs.symlinkSync(outsideRoot, goatFlowDirectory, "dir");
        }
        return originalMkdirSync(path, options);
      },
    );

    let capturedClaimError: PathWriteClaimError | null = null;
    try {
      const unexpectedBatch = acquirePathWriteClaims(projectRoot, [
        { targetPath, expectedIdentity },
      ]);
      releasePathWriteClaims(unexpectedBatch);
      assert.fail("claim acquisition must reject the replaced parent");
    } catch (error) {
      if (!(error instanceof PathWriteClaimError)) throw error;
      capturedClaimError = error;
    }
    assert.equal(capturedClaimError.reason, "claim-integrity");
    assert.equal(capturedClaimError.targetPath, targetPath);
    const outsideClaimDirectory = join(outsideRoot, "write-claims");
    const outsideClaimNames = fs.existsSync(outsideClaimDirectory)
      ? fs.readdirSync(outsideClaimDirectory)
      : [];
    assert.equal(
      outsideClaimNames.some((name) => name.endsWith(".claim")),
      false,
    );
  });

  /**
   * Pins deterministic ordering and proves descriptors remain open until owner release.
   * Filesystem side effects: creates two targets and temporary claim markers, then owner-releases both markers.
   */
  it("acquires canonical target order and owner-releases every marker", (context: TestContext) => {
    const projectRoot = makeProject();
    const originalOpenSync = fs.openSync;
    const originalCloseSync = fs.closeSync;
    const claimDescriptors = new Set<number>();
    const closedClaimDescriptors = new Set<number>();
    context.mock.method(
      fs,
      "openSync",
      (path: fs.PathLike, flags: fs.OpenMode, mode?: fs.Mode | null) => {
        const descriptor = originalOpenSync(path, flags, mode);
        if (
          typeof path === "string" &&
          path.endsWith(".claim") &&
          flags === "wx"
        ) {
          claimDescriptors.add(descriptor);
        }
        return descriptor;
      },
    );
    context.mock.method(fs, "closeSync", (descriptor: number) => {
      if (claimDescriptors.has(descriptor)) {
        closedClaimDescriptors.add(descriptor);
      }
      originalCloseSync(descriptor);
    });
    fs.writeFileSync(join(projectRoot, "b.txt"), "b\n");
    fs.writeFileSync(join(projectRoot, "a.txt"), "a\n");
    const batch = acquirePathWriteClaims(projectRoot, [
      {
        targetPath: "b.txt",
        expectedIdentity: readPathWriteTargetIdentity(projectRoot, "b.txt"),
      },
      {
        targetPath: "a.txt",
        expectedIdentity: readPathWriteTargetIdentity(projectRoot, "a.txt"),
      },
    ]);

    assert.deepEqual(batch.targetPaths, ["a.txt", "b.txt"]);
    const aEvidence = inspectPathWriteClaim(projectRoot, "a.txt");
    assert.ok(aEvidence);
    assertPrivateClaimModeWhenSupported(aEvidence.markerPath);
    assert.equal(claimDescriptors.size, 2);
    assert.equal(closedClaimDescriptors.size, 0);
    assert.deepEqual(releasePathWriteClaims(batch), [
      { targetPath: "a.txt", status: "released" },
      { targetPath: "b.txt", status: "released" },
    ]);
    assert.equal(closedClaimDescriptors.size, 2);
    assert.equal(inspectPathWriteClaim(projectRoot, "a.txt"), null);
    assert.equal(inspectPathWriteClaim(projectRoot, "b.txt"), null);
  });

  it("fails a second process before its mutation when another owner holds the path", () => {
    const projectRoot = makeProject();
    const targetPath = "managed.txt";
    const mutationPath = join(projectRoot, "contender-mutated.txt");
    fs.writeFileSync(join(projectRoot, targetPath), "baseline\n");
    const batch = acquirePathWriteClaims(projectRoot, [
      {
        targetPath,
        expectedIdentity: readPathWriteTargetIdentity(projectRoot, targetPath),
      },
    ]);
    try {
      assert.deepEqual(runContender(projectRoot, targetPath, mutationPath), {
        didAcquireClaim: false,
        reason: "busy",
        targetPath,
      });
      assert.equal(fs.existsSync(mutationPath), false);
    } finally {
      releasePathWriteClaims(batch);
    }
  });

  it("rejects changed expected bytes and removes the claim batch it acquired", () => {
    const projectRoot = makeProject();
    const targetPath = "managed.txt";
    fs.writeFileSync(join(projectRoot, targetPath), "before\n");
    const expectedIdentity = readPathWriteTargetIdentity(
      projectRoot,
      targetPath,
    );
    fs.writeFileSync(join(projectRoot, targetPath), "after\n");

    assertClaimFailure(
      () =>
        acquirePathWriteClaims(projectRoot, [{ targetPath, expectedIdentity }]),
      "target-changed",
      targetPath,
    );
    assert.equal(inspectPathWriteClaim(projectRoot, targetPath), null);
  });

  it("unwinds earlier sorted claims when a later target is busy", () => {
    const projectRoot = makeProject();
    fs.writeFileSync(join(projectRoot, "a.txt"), "a\n");
    fs.writeFileSync(join(projectRoot, "b.txt"), "b\n");
    const aIdentity = readPathWriteTargetIdentity(projectRoot, "a.txt");
    const bIdentity = readPathWriteTargetIdentity(projectRoot, "b.txt");
    const blocker = acquirePathWriteClaims(projectRoot, [
      { targetPath: "b.txt", expectedIdentity: bIdentity },
    ]);
    try {
      assertClaimFailure(
        () =>
          acquirePathWriteClaims(projectRoot, [
            { targetPath: "b.txt", expectedIdentity: bIdentity },
            { targetPath: "a.txt", expectedIdentity: aIdentity },
          ]),
        "busy",
        "b.txt",
      );
      const aBatch = acquirePathWriteClaims(projectRoot, [
        { targetPath: "a.txt", expectedIdentity: aIdentity },
      ]);
      assert.deepEqual(releasePathWriteClaims(aBatch), [
        { targetPath: "a.txt", status: "released" },
      ]);
    } finally {
      releasePathWriteClaims(blocker);
    }
  });

  it("reports ownership-changed and leaves foreign marker state untouched", () => {
    const projectRoot = makeProject();
    const targetPath = "managed.txt";
    const batch = acquirePathWriteClaims(projectRoot, [
      {
        targetPath,
        expectedIdentity: readPathWriteTargetIdentity(projectRoot, targetPath),
      },
    ]);
    const originalEvidence = inspectPathWriteClaim(projectRoot, targetPath);
    assert.ok(originalEvidence);
    let foreignMarkerBytes: Buffer;
    try {
      const markerBytes = fs.readFileSync(originalEvidence.markerPath);
      foreignMarkerBytes = tamperWithOwnedClaimMarker(
        originalEvidence.markerPath,
        markerBytes,
      );
    } catch (error) {
      // If fixture tampering fails after admission, release the suite-owned marker before surfacing the test failure.
      releasePathWriteClaims(batch);
      throw error;
    }

    assert.deepEqual(releasePathWriteClaims(batch), [
      { targetPath, status: "ownership-changed" },
    ]);
    assert.deepEqual(
      fs.readFileSync(originalEvidence.markerPath),
      foreignMarkerBytes,
    );
    const replacementEvidence = inspectPathWriteClaim(projectRoot, targetPath);
    assert.ok(replacementEvidence);
    assert.equal(
      removeConfirmedAbandonedPathWriteClaim(replacementEvidence),
      "removed",
    );
  });

  it("refuses marker tampering before ownership confirmation", (context: TestContext) => {
    const projectRoot = makeProject();
    const targetPath = "managed.txt";
    const expectedIdentity = readPathWriteTargetIdentity(
      projectRoot,
      targetPath,
    );
    const originalFsyncSync = fs.fsyncSync;
    let replacementPath = "";
    context.mock.method(fs, "fsyncSync", (descriptor: number) => {
      originalFsyncSync(descriptor);
      const claimDirectory = join(projectRoot, ".goat-flow", "write-claims");
      const markerName = fs.readdirSync(claimDirectory)[0];
      assert.ok(markerName);
      replacementPath = join(claimDirectory, markerName);
      const foreignBytes = Buffer.from("foreign-marker-state\n", "utf8");
      fs.writeSync(descriptor, foreignBytes, 0, foreignBytes.length, null);
      originalFsyncSync(descriptor);
    });

    assertClaimFailure(
      () =>
        acquirePathWriteClaims(projectRoot, [{ targetPath, expectedIdentity }]),
      "claim-integrity",
      targetPath,
    );
    assert.equal(fs.existsSync(replacementPath), true);
    const replacement = inspectPathWriteClaim(projectRoot, targetPath);
    assert.ok(replacement);
    assert.equal(
      removeConfirmedAbandonedPathWriteClaim(replacement),
      "removed",
    );
  });

  it("removes an unchanged marker after transient ownership readback failure", (context: TestContext) => {
    const projectRoot = makeProject();
    const targetPath = "managed.txt";
    const expectedIdentity = readPathWriteTargetIdentity(
      projectRoot,
      targetPath,
    );
    const originalFstatSync = fs.fstatSync;
    const originalFsyncSync = fs.fsyncSync;
    let shouldFailOwnershipReadback = false;
    let hasInjectedReadbackFailure = false;
    context.mock.method(fs, "fsyncSync", (descriptor: number) => {
      originalFsyncSync(descriptor);
      if (!hasInjectedReadbackFailure) {
        shouldFailOwnershipReadback = true;
        hasInjectedReadbackFailure = true;
      }
    });
    context.mock.method(
      fs,
      "fstatSync",
      (descriptor: number, options: { bigint: true }) => {
        if (shouldFailOwnershipReadback) {
          shouldFailOwnershipReadback = false;
          const error = new Error("fixture transient readback failure");
          Object.assign(error, { code: "EIO" });
          throw error;
        }
        return originalFstatSync(descriptor, options);
      },
    );

    assertClaimFailure(
      () =>
        acquirePathWriteClaims(projectRoot, [{ targetPath, expectedIdentity }]),
      "claim-integrity",
      targetPath,
    );
    assert.equal(inspectPathWriteClaim(projectRoot, targetPath), null);

    const retry = acquirePathWriteClaims(projectRoot, [
      { targetPath, expectedIdentity },
    ]);
    assert.deepEqual(releasePathWriteClaims(retry), [
      { targetPath, status: "released" },
    ]);
  });

  it("removes its marker when claim initialization fails", (context: TestContext) => {
    const projectRoot = makeProject();
    const targetPath = "managed.txt";
    const expectedIdentity = readPathWriteTargetIdentity(
      projectRoot,
      targetPath,
    );
    const originalFsyncSync = fs.fsyncSync;
    let shouldFailNextFlush = true;
    context.mock.method(fs, "fsyncSync", (descriptor: number) => {
      if (shouldFailNextFlush) {
        shouldFailNextFlush = false;
        const error = new Error("fixture flush failure");
        Object.assign(error, { code: "EIO" });
        throw error;
      }
      originalFsyncSync(descriptor);
    });

    assertClaimFailure(
      () =>
        acquirePathWriteClaims(projectRoot, [{ targetPath, expectedIdentity }]),
      "coordination-unavailable",
      targetPath,
    );
    assert.equal(inspectPathWriteClaim(projectRoot, targetPath), null);

    const retry = acquirePathWriteClaims(projectRoot, [
      { targetPath, expectedIdentity },
    ]);
    assert.deepEqual(releasePathWriteClaims(retry), [
      { targetPath, status: "released" },
    ]);
  });

  it("never expires or steals an old claim and permits explicit identity-bound recovery", () => {
    const projectRoot = makeProject();
    const targetPath = "managed.txt";
    const mutationPath = join(projectRoot, "contender-mutated.txt");
    assert.deepEqual(runAbandoningOwner(projectRoot, targetPath), {
      didAcquireClaim: true,
    });
    const firstEvidence = inspectPathWriteClaim(projectRoot, targetPath);
    assert.ok(firstEvidence);
    const markerBytes = fs.readFileSync(firstEvidence.markerPath);
    const oldTime = new Date("2000-01-01T00:00:00.000Z");
    fs.utimesSync(firstEvidence.markerPath, oldTime, oldTime);
    const recoveryEvidence = inspectPathWriteClaim(projectRoot, targetPath);
    assert.ok(recoveryEvidence);

    assert.deepEqual(runContender(projectRoot, targetPath, mutationPath), {
      didAcquireClaim: false,
      reason: "busy",
      targetPath,
    });
    assert.deepEqual(fs.readFileSync(firstEvidence.markerPath), markerBytes);
    assert.equal(fs.existsSync(mutationPath), false);
    fs.appendFileSync(firstEvidence.markerPath, "changed-after-inspection\n");
    assert.equal(
      removeConfirmedAbandonedPathWriteClaim(recoveryEvidence),
      "changed",
    );
    assert.throws(
      () => removeConfirmedAbandonedPathWriteClaim(recoveryEvidence),
      /was not inspected by this process/u,
    );
    const freshRecoveryEvidence = inspectPathWriteClaim(
      projectRoot,
      targetPath,
    );
    assert.ok(freshRecoveryEvidence);
    assert.equal(
      removeConfirmedAbandonedPathWriteClaim(freshRecoveryEvidence),
      "removed",
    );

    const next = acquirePathWriteClaims(projectRoot, [
      {
        targetPath,
        expectedIdentity: readPathWriteTargetIdentity(projectRoot, targetPath),
      },
    ]);
    assert.deepEqual(releasePathWriteClaims(next), [
      { targetPath, status: "released" },
    ]);
  });

  it("refuses filesystems that do not support exclusive claim creation", (context: TestContext) => {
    const projectRoot = makeProject();
    const targetPath = "managed.txt";
    const expectedIdentity = readPathWriteTargetIdentity(
      projectRoot,
      targetPath,
    );
    context.mock.method(fs, "openSync", () => {
      const error = new Error("exclusive creation is unsupported");
      Object.assign(error, { code: "ENOSYS" });
      throw error;
    });

    assertClaimFailure(
      () =>
        acquirePathWriteClaims(projectRoot, [{ targetPath, expectedIdentity }]),
      "unsupported-filesystem",
      targetPath,
    );
  });

  it("rejects unsafe and duplicate target identities before creating claims", () => {
    const projectRoot = makeProject();
    assertClaimFailure(
      () => readPathWriteTargetIdentity(projectRoot, "../outside.txt"),
      "invalid-target",
      "../outside.txt",
    );

    const targetPath = "managed.txt";
    const expectedIdentity = readPathWriteTargetIdentity(
      projectRoot,
      targetPath,
    );
    assertClaimFailure(
      () =>
        acquirePathWriteClaims(projectRoot, [
          { targetPath, expectedIdentity },
          { targetPath, expectedIdentity },
        ]),
      "duplicate-target",
      targetPath,
    );
    assert.equal(
      fs.existsSync(join(projectRoot, ".goat-flow", "write-claims")),
      false,
    );
  });
});
