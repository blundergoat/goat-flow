/**
 * Proves one interrupted writer can be inspected and recovered through the public CLI without creating a claim-stealing path.
 * Every marker lives under a temporary project; this suite never recovers a claim in the repository running the test.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  acquirePathWriteClaims,
  PathWriteClaimError,
  releasePathWriteClaims,
} from "../../src/cli/path-write-claim.js";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const cliEntryPath = join(repositoryRoot, "src", "cli", "cli.ts");
const claimModuleUrl = pathToFileURL(
  join(repositoryRoot, "src", "cli", "path-write-claim.ts"),
).href;
const targetPath = "notes.txt";

/** Stable public JSON fields asserted across inspection and recovery subprocesses. */
interface ClaimReport {
  schemaVersion: "goat-flow.path-write-claim-recovery.v1";
  command: "claims";
  subcommand: "inspect" | "recover";
  status: "present" | "absent" | "removed";
  projectRoot: string;
  targetPath: string;
  markerPath: string | null;
  markerSha256: string | null;
}

/**
 * Run the real CLI with bounded captured output.
 * Side effect: spawns one child process and may inspect or remove a marker in the selected temporary project.
 */
function runClaims(...args: string[]) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", cliEntryPath, "claims", ...args],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
}

/** Parse a successful JSON response while retaining subprocess diagnostics in the assertion. */
function parseClaimReport(result: ReturnType<typeof runClaims>): ClaimReport {
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout) as ClaimReport;
}

/** Wait for the child to confirm it owns the marker before sending a signal. */
async function waitForReady(child: ReturnType<typeof spawn>): Promise<void> {
  await new Promise<void>((resolveReady, rejectReady) => {
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      rejectReady(
        new Error(`claim-owning child did not become ready: ${stderr}`),
      );
    }, 10_000);
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
      if (!stdout.includes("READY\n")) return;
      clearTimeout(timeout);
      resolveReady();
    });
    child.once("exit", (code, signal) => {
      if (stdout.includes("READY\n")) return;
      clearTimeout(timeout);
      rejectReady(
        new Error(
          `claim-owning child exited before readiness: code=${String(code)} signal=${String(signal)} stderr=${stderr}`,
        ),
      );
    });
  });
}

/**
 * Spawn one writer that deliberately exits without releasing its temporary-project claim.
 * Side effect: starts a child process and creates one marker beneath the supplied temporary project.
 */
function spawnClaimOwner(projectRoot: string): ReturnType<typeof spawn> {
  const childSource = `
    import { acquirePathWriteClaims } from ${JSON.stringify(claimModuleUrl)};
    const projectRoot = process.env.GOAT_FLOW_TEST_CLAIM_PROJECT;
    if (!projectRoot) throw new Error("missing temporary project");
    acquirePathWriteClaims(projectRoot, [{ targetPath: ${JSON.stringify(targetPath)}, expectedIdentity: { state: "missing" } }]);
    process.stdout.write("READY\\n");
    setInterval(() => {}, 1000);
  `;
  return spawn(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "--eval", childSource],
    {
      cwd: repositoryRoot,
      env: { ...process.env, GOAT_FLOW_TEST_CLAIM_PROJECT: projectRoot },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

/** Inspect one temporary-project marker through the real JSON CLI route. */
function inspectClaim(projectRoot: string): ClaimReport {
  return parseClaimReport(
    runClaims(
      "inspect",
      projectRoot,
      "--target",
      targetPath,
      "--format",
      "json",
    ),
  );
}

/** Prove an existing marker still blocks normal cooperative acquisition. */
function assertClaimIsBusy(projectRoot: string): void {
  assert.throws(
    () =>
      acquirePathWriteClaims(projectRoot, [
        { targetPath, expectedIdentity: { state: "missing" } },
      ]),
    (error: unknown) =>
      error instanceof PathWriteClaimError && error.reason === "busy",
  );
}

/** Exercise every bad recovery input against the original stranded marker and prove it remains. */
function assertRecoveryInputsFailClosed(
  projectRoot: string,
  inspection: ClaimReport,
): void {
  const textInspection = runClaims(
    "inspect",
    projectRoot,
    "--target",
    targetPath,
    "--format",
    "text",
  );
  assert.equal(textInspection.status, 0, textInspection.stderr);
  assert.match(
    textInspection.stdout,
    /No writer liveness or abandonment was inferred/u,
  );
  assert.match(textInspection.stdout, /--confirm-abandoned/u);

  const unconfirmed = runClaims(
    "recover",
    projectRoot,
    "--target",
    targetPath,
    "--marker-sha256",
    inspection.markerSha256 ?? "",
  );
  assert.equal(unconfirmed.status, 2, unconfirmed.stderr);
  assert.match(
    unconfirmed.stderr,
    /claims recover requires --confirm-abandoned/u,
  );
  assert.equal(existsSync(inspection.markerPath ?? ""), true);

  const malformed = runClaims(
    "recover",
    projectRoot,
    "--target",
    targetPath,
    "--marker-sha256",
    "ABC",
    "--confirm-abandoned",
  );
  assert.equal(malformed.status, 2, malformed.stderr);
  assert.equal(existsSync(inspection.markerPath ?? ""), true);

  const mismatchedSha =
    inspection.markerSha256 === "0".repeat(64)
      ? "1".repeat(64)
      : "0".repeat(64);
  const mismatched = runClaims(
    "recover",
    projectRoot,
    "--target",
    targetPath,
    "--marker-sha256",
    mismatchedSha,
    "--confirm-abandoned",
  );
  assert.equal(mismatched.status, 1, mismatched.stderr);
  assert.match(mismatched.stderr, /Nothing was removed/u);
  assert.equal(existsSync(inspection.markerPath ?? ""), true);
}

/** Recover the original marker, then prove a normal writer can acquire and release the target. */
function recoverAndReacquire(
  projectRoot: string,
  inspection: ClaimReport,
): void {
  const recovery = parseClaimReport(
    runClaims(
      "recover",
      projectRoot,
      "--target",
      targetPath,
      "--marker-sha256",
      inspection.markerSha256 ?? "",
      "--confirm-abandoned",
      "--format",
      "json",
    ),
  );
  assert.equal(recovery.status, "removed");
  assert.equal(recovery.markerSha256, inspection.markerSha256);
  assert.equal(existsSync(inspection.markerPath ?? ""), false);

  const reacquired = acquirePathWriteClaims(projectRoot, [
    { targetPath, expectedIdentity: { state: "missing" } },
  ]);
  releasePathWriteClaims(reacquired);
}

/** Replace a marker after inspection and prove the stale digest cannot remove the new owner. */
function assertChangedMarkerFailsClosed(projectRoot: string): string {
  const firstReplacement = acquirePathWriteClaims(projectRoot, [
    { targetPath, expectedIdentity: { state: "missing" } },
  ]);
  const firstInspection = inspectClaim(projectRoot);
  releasePathWriteClaims(firstReplacement);

  const secondReplacement = acquirePathWriteClaims(projectRoot, [
    { targetPath, expectedIdentity: { state: "missing" } },
  ]);
  try {
    const secondInspection = inspectClaim(projectRoot);
    assert.notEqual(
      firstInspection.markerSha256,
      secondInspection.markerSha256,
    );
    const staleRecovery = runClaims(
      "recover",
      projectRoot,
      "--target",
      targetPath,
      "--marker-sha256",
      firstInspection.markerSha256 ?? "",
      "--confirm-abandoned",
    );
    assert.equal(staleRecovery.status, 1, staleRecovery.stderr);
    assert.equal(existsSync(secondInspection.markerPath ?? ""), true);
    return secondInspection.markerPath ?? "";
  } finally {
    releasePathWriteClaims(secondReplacement);
  }
}

/**
 * Prove absent and structurally unsafe marker states never become removal evidence.
 * Side effect: writes one oversized marker only beneath the supplied temporary project.
 */
function assertAbsentAndUnsafeMarkersFailClosed(
  projectRoot: string,
  markerPath: string,
): void {
  const absentRecovery = runClaims(
    "recover",
    projectRoot,
    "--target",
    targetPath,
    "--marker-sha256",
    "a".repeat(64),
    "--confirm-abandoned",
  );
  assert.equal(absentRecovery.status, 1, absentRecovery.stderr);
  assert.match(absentRecovery.stderr, /Nothing was removed/u);

  const absent = inspectClaim(projectRoot);
  assert.equal(absent.status, "absent");
  assert.equal(absent.markerPath, null);
  assert.equal(absent.markerSha256, null);

  // Oversized marker bytes violate the helper's bounded regular-file identity and must never become deletion evidence.
  writeFileSync(markerPath, "x".repeat(4097));
  const invalidMarker = runClaims(
    "inspect",
    projectRoot,
    "--target",
    targetPath,
    "--format",
    "json",
  );
  assert.equal(invalidMarker.status, 1, invalidMarker.stderr);
  assert.match(invalidMarker.stderr, /Nothing was removed/u);
  assert.equal(existsSync(markerPath), true);
}

describe("public abandoned path-write claim recovery", () => {
  let projectRoot = "";

  before(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "goat-flow-claim-recovery-"));
  });

  after(() => {
    if (projectRoot) rmSync(projectRoot, { recursive: true, force: true });
  });

  // The fixture kills an owning child to reproduce the real crash residue. Invariant: only the inspected unchanged marker is removed; every stale or invalid route preserves current ownership.
  it("recovers only the inspected unchanged marker and refuses every stale or invalid route", async () => {
    const claimOwner = spawnClaimOwner(projectRoot);
    try {
      await waitForReady(claimOwner);
      const childExit = once(claimOwner, "exit");
      assert.equal(claimOwner.kill("SIGINT"), true);
      await childExit;
      assertClaimIsBusy(projectRoot);

      const inspection = inspectClaim(projectRoot);
      assert.deepEqual(
        {
          schemaVersion: inspection.schemaVersion,
          command: inspection.command,
          subcommand: inspection.subcommand,
          status: inspection.status,
          projectRoot: inspection.projectRoot,
          targetPath: inspection.targetPath,
        },
        {
          schemaVersion: "goat-flow.path-write-claim-recovery.v1",
          command: "claims",
          subcommand: "inspect",
          status: "present",
          projectRoot,
          targetPath,
        },
      );
      assert.ok(inspection.markerPath);
      assert.match(inspection.markerSha256 ?? "", /^[a-f0-9]{64}$/u);
      assert.equal(existsSync(inspection.markerPath), true);
      assertRecoveryInputsFailClosed(projectRoot, inspection);
      recoverAndReacquire(projectRoot, inspection);
      const markerPath = assertChangedMarkerFailsClosed(projectRoot);
      assertAbsentAndUnsafeMarkersFailClosed(projectRoot, markerPath);
    } finally {
      if (claimOwner.exitCode === null && claimOwner.signalCode === null) {
        claimOwner.kill("SIGKILL");
        await once(claimOwner, "exit");
      }
    }
  });
});
