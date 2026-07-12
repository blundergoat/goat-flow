/**
 * Exercises the command runner that keeps preflight users informed during long Tests phases.
 * Use when changing timeout, capture, retry, or heartbeat behavior so interactive progress
 * remains visible without contaminating the deterministic CI report.
 * The fixtures execute harmless child processes and never run the repository test suite.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PREFLIGHT_SCRIPT_PATH = join(
  PROJECT_ROOT,
  "scripts",
  "preflight-checks.sh",
);
const PREFLIGHT_RUNNER_PATH = join(
  PROJECT_ROOT,
  "scripts",
  "preflight-command-runner.mjs",
);
const fixtureProcessIds = new Set<number>();

/** Captured runner evidence; empty streams mean that channel produced nothing for the user. */
interface PreflightRunnerResult {
  status: number | null;
  signal: NodeJS.Signals | null;
  capturedOutput: string;
  runnerErrorOutput: string;
  operatorProgress: string;
  firstProgressAfterMs: number | null;
  closedAfterMs: number;
}

/** Options for one harmless command-runner fixture used by the preflight progress tests. */
interface PreflightRunnerFixture {
  childSource?: string;
  childCommand?: string;
  childArguments?: string[];
  timeoutSeconds?: number;
  heartbeatSeconds?: number;
  progressLabel?: string;
  exposeProgress?: boolean;
  parentStopAfterMs?: number;
}

/**
 * Run the production preflight command runner and capture its three operator-visible channels.
 * Omitted fixture values select a short successful child; empty output means the child stayed silent.
 *
 * @param fixture - harmless child and timing choices; omitted progress uses a dedicated descriptor
 * @returns status, captured child output, runner errors, and progress timing; null status means signal exit
 */
function runPreflightRunnerFixture(
  fixture: PreflightRunnerFixture,
): Promise<PreflightRunnerResult> {
  // Omitted child input selects a harmless Node process, keeping every fixture local and deterministic.
  const childCommand = fixture.childCommand ?? process.execPath;
  const childArguments = fixture.childArguments ?? [
    "-e",
    fixture.childSource ?? "",
  ];

  // Omitted timing and labels use short test defaults; production keeps its separate ten-second constant.
  const runnerArguments = [
    PREFLIGHT_RUNNER_PATH,
    "--timeout-seconds",
    String(fixture.timeoutSeconds ?? 2),
    "--heartbeat-seconds",
    String(fixture.heartbeatSeconds ?? 0.05),
    "--label",
    fixture.progressLabel ?? "Tests",
  ];

  // Interactive callers expose descriptor 3, so progress bypasses captured child output.
  if (fixture.exposeProgress !== false) {
    runnerArguments.push("--progress-fd", "3");
  }
  runnerArguments.push("--", childCommand, ...childArguments);

  const fixtureStartedAt = Date.now();
  return new Promise((resolveFixture, rejectFixture) => {
    const runnerProcess = spawn(process.execPath, runnerArguments, {
      cwd: PROJECT_ROOT,
      stdio: ["ignore", "pipe", "pipe", "pipe"],
    });
    const operatorProgressStream = runnerProcess.stdio[3] as Readable;
    let capturedOutput = "";
    let runnerErrorOutput = "";
    let operatorProgress = "";
    let firstProgressAfterMs: number | null = null;

    // A requested parent stop simulates the user closing preflight while its test child is active.
    if (fixture.parentStopAfterMs !== undefined) {
      setTimeout(
        () => runnerProcess.kill("SIGTERM"),
        fixture.parentStopAfterMs,
      ).unref();
    }

    // Configured pipes always exist; optional access keeps a spawn failure reportable instead of crashing the test.
    runnerProcess.stdout?.setEncoding("utf-8");
    runnerProcess.stderr?.setEncoding("utf-8");
    operatorProgressStream.setEncoding("utf-8");
    runnerProcess.stdout?.on("data", (chunk: string) => {
      capturedOutput += chunk;
    });
    runnerProcess.stderr?.on("data", (chunk: string) => {
      runnerErrorOutput += chunk;
    });
    operatorProgressStream.on("data", (chunk: string) => {
      // The first heartbeat proves the user sees liveness before the child closes.
      if (firstProgressAfterMs === null) {
        firstProgressAfterMs = Date.now() - fixtureStartedAt;
      }
      operatorProgress += chunk;
    });
    runnerProcess.once("error", rejectFixture);
    runnerProcess.once("close", (status, signal) => {
      resolveFixture({
        status,
        signal,
        capturedOutput,
        runnerErrorOutput,
        operatorProgress,
        firstProgressAfterMs,
        closedAfterMs: Date.now() - fixtureStartedAt,
      });
    });
  });
}

/**
 * Report whether a fixture process is still alive after the runner claims cleanup.
 * A missing process means the user can safely rerun preflight without leaked work.
 *
 * @param processId - fixture PID; zero or absent is never registered by these tests
 * @returns true while the process exists; false after cleanup removes it
 */
function fixtureProcessIsAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    // A timed-out fixture normally reaches ESRCH because the process group was already removed.
    if ((error as NodeJS.ErrnoException).code === "ESRCH") {
      return false;
    }
    throw error;
  }
}

/**
 * Wait a bounded time for process-group cleanup after timeout or parent termination.
 * Empty cleanup never waits forever; false tells the test exactly which process leaked.
 *
 * @param processId - child or grandchild PID shown by the fixture output
 * @param timeoutMs - maximum wait; zero means perform one immediate check
 * @returns true once the process disappears, or false when the bounded wait expires
 */
async function waitForFixtureProcessExit(
  processId: number,
  timeoutMs = 1_500,
): Promise<boolean> {
  const cleanupDeadline = Date.now() + timeoutMs;

  // Cleanup gets a short bounded grace period instead of holding the test suite indefinitely.
  while (Date.now() <= cleanupDeadline) {
    // The process is gone, so the next user run cannot inherit leaked fixture work.
    if (!fixtureProcessIsAlive(processId)) {
      fixtureProcessIds.delete(processId);
      return true;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  return false;
}

/**
 * Read one PID marker from captured fixture output for the cleanup assertions.
 * A missing marker fails with the full output instead of returning an unusable null PID.
 *
 * @param capturedOutput - child output retained by the runner; empty means startup failed
 * @param marker - marker preceding the decimal PID; empty is not a valid fixture contract
 * @returns positive process ID registered for emergency cleanup
 */
function fixtureProcessId(capturedOutput: string, marker: string): number {
  const processIdMatch = capturedOutput.match(
    new RegExp(`${marker}=(\\d+)`, "u"),
  );
  assert.ok(
    processIdMatch,
    `expected ${marker} in fixture output:\n${capturedOutput}`,
  );
  const processId = Number(processIdMatch[1]);
  fixtureProcessIds.add(processId);
  return processId;
}

afterEach(() => {
  // A failed assertion still removes any harmless timeout fixture left behind.
  for (const processId of fixtureProcessIds) {
    try {
      process.kill(processId, "SIGKILL");
    } catch (error) {
      // ESRCH is expected when production cleanup already removed the process.
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
        throw error;
      }
    }
  }
  fixtureProcessIds.clear();
});

describe("preflight Tests-phase progress", () => {
  it("shows retry progress before close while keeping child output captured", async () => {
    const runnerResult = await runPreflightRunnerFixture({
      progressLabel: "Tests retry",
      heartbeatSeconds: 0.04,
      childSource:
        'process.stdout.write("CHILD_START\\n"); setTimeout(() => { process.stderr.write("CHILD_END\\n"); }, 150);',
    });

    assert.equal(runnerResult.status, 0);
    assert.match(runnerResult.operatorProgress, /Tests retry still running/u);
    assert.ok(
      runnerResult.firstProgressAfterMs !== null,
      "expected a heartbeat timestamp",
    );
    assert.ok(
      runnerResult.firstProgressAfterMs < runnerResult.closedAfterMs,
      "heartbeat should be visible before child close",
    );
    assert.match(runnerResult.capturedOutput, /CHILD_START/u);
    assert.match(runnerResult.capturedOutput, /CHILD_END/u);
    assert.doesNotMatch(runnerResult.capturedOutput, /still running/u);
    assert.equal(runnerResult.runnerErrorOutput, "");
    const heartbeatElapsedSeconds = [
      ...runnerResult.operatorProgress.matchAll(/\((\d+\.\d+)s elapsed\)/gu),
    ].map((heartbeatMatch) => Number(heartbeatMatch[1]));
    assert.ok(heartbeatElapsedSeconds.length >= 1);

    // Consecutive heartbeats stay bounded instead of flooding the developer's terminal.
    for (
      let heartbeatIndex = 1;
      heartbeatIndex < heartbeatElapsedSeconds.length;
      heartbeatIndex += 1
    ) {
      const currentHeartbeatSeconds = heartbeatElapsedSeconds[heartbeatIndex];
      const previousHeartbeatSeconds =
        heartbeatElapsedSeconds[heartbeatIndex - 1];
      assert.ok(currentHeartbeatSeconds !== undefined);
      assert.ok(previousHeartbeatSeconds !== undefined);
      assert.ok(
        currentHeartbeatSeconds - previousHeartbeatSeconds >= 0.03,
        "heartbeat intervals should stay near the configured 0.04-second test interval",
      );
    }
  });

  it("keeps short successful commands quiet", async () => {
    const runnerResult = await runPreflightRunnerFixture({
      heartbeatSeconds: 0.2,
      childSource: 'process.stdout.write("SHORT_SUCCESS\\n");',
    });

    assert.equal(runnerResult.status, 0);
    assert.equal(runnerResult.operatorProgress, "");
    assert.equal(runnerResult.capturedOutput, "SHORT_SUCCESS\n");
  });

  it("keeps non-interactive output deterministic without a progress descriptor", async () => {
    const runnerResult = await runPreflightRunnerFixture({
      exposeProgress: false,
      heartbeatSeconds: 0.02,
      childSource:
        'setTimeout(() => process.stdout.write("CI_CAPTURE\\n"), 100);',
    });

    assert.equal(runnerResult.status, 0);
    assert.equal(runnerResult.operatorProgress, "");
    assert.equal(runnerResult.capturedOutput, "CI_CAPTURE\n");
  });

  it("returns child failure details exactly once", async () => {
    const standardOutputFailureMarker = "PRECISE_STDOUT_FAILURE";
    const standardErrorFailureMarker = "PRECISE_STDERR_FAILURE";
    const runnerResult = await runPreflightRunnerFixture({
      childSource: `
        process.stdout.write("${standardOutputFailureMarker}\\n");
        setTimeout(() => {
          process.stderr.write("${standardErrorFailureMarker}\\n");
          process.exit(7);
        }, 20);
      `,
    });

    assert.equal(runnerResult.status, 7);
    assert.equal(
      runnerResult.capturedOutput.split(standardOutputFailureMarker).length - 1,
      1,
    );
    assert.equal(
      runnerResult.capturedOutput.split(standardErrorFailureMarker).length - 1,
      1,
    );
    assert.equal(runnerResult.runnerErrorOutput, "");
  });

  it("times out with exit 124 and removes the whole child process group", async () => {
    const timeoutFixtureSource = String.raw`
      const { spawn } = require("node:child_process");
      process.on("SIGTERM", () => {});
      const worker = spawn(
        process.execPath,
        ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"],
        { stdio: "ignore" },
      );
      process.stdout.write("PARENT_PID=" + process.pid + "\\n");
      process.stdout.write("WORKER_PID=" + worker.pid + "\\n");
      setInterval(() => {}, 1000);
    `;
    const runnerResult = await runPreflightRunnerFixture({
      timeoutSeconds: 0.2,
      heartbeatSeconds: 0.05,
      childSource: timeoutFixtureSource,
    });
    const parentProcessId = fixtureProcessId(
      runnerResult.capturedOutput,
      "PARENT_PID",
    );
    const workerProcessId = fixtureProcessId(
      runnerResult.capturedOutput,
      "WORKER_PID",
    );

    assert.equal(runnerResult.status, 124);
    assert.equal(
      runnerResult.capturedOutput.split("command timed out").length - 1,
      1,
    );
    assert.match(runnerResult.operatorProgress, /Tests still running/u);
    assert.equal(await waitForFixtureProcessExit(parentProcessId), true);
    assert.equal(await waitForFixtureProcessExit(workerProcessId), true);
  });

  // A developer still gets a bounded timeout result when a test helper escapes and keeps output open.
  it(
    "returns after escalation when an escaped descendant retains the capture pipe",
    { skip: process.platform === "win32" },
    async () => {
      const escapedPipeFixtureSource = String.raw`
        const { spawn } = require("node:child_process");
        process.on("SIGTERM", () => {});
        const escapedOutputHolder = spawn(
          process.execPath,
          ["-e", "setTimeout(() => {}, 3000);"],
          { detached: true, stdio: ["ignore", 1, 2] },
        );
        process.stdout.write(
          "ESCAPED_OUTPUT_HOLDER_PID=" + escapedOutputHolder.pid + "\\n",
        );
        setInterval(() => {}, 1000);
      `;
      const runnerResult = await runPreflightRunnerFixture({
        timeoutSeconds: 0.1,
        heartbeatSeconds: 0,
        childSource: escapedPipeFixtureSource,
      });
      fixtureProcessId(
        runnerResult.capturedOutput,
        "ESCAPED_OUTPUT_HOLDER_PID",
      );

      assert.equal(runnerResult.status, 124);
      assert.ok(
        runnerResult.closedAfterMs < 2_000,
        `runner returned after ${runnerResult.closedAfterMs}ms instead of its bounded cleanup window`,
      );
      assert.match(runnerResult.capturedOutput, /cleanup deadline reached/u);
    },
  );

  it("reports signal exits and spawn errors once with status 1", async () => {
    const signalledResult = await runPreflightRunnerFixture({
      childSource: 'process.kill(process.pid, "SIGTERM");',
    });
    const missingCommandResult = await runPreflightRunnerFixture({
      childCommand: join(PROJECT_ROOT, "missing-preflight-fixture-command"),
      childArguments: [],
    });

    assert.equal(signalledResult.status, 1);
    assert.equal(
      signalledResult.capturedOutput.split("terminated by SIGTERM").length - 1,
      1,
    );
    assert.equal(missingCommandResult.status, 1);
    assert.equal(
      missingCommandResult.capturedOutput.split("failed to start").length - 1,
      1,
    );
  });

  it("cleans the child process group before returning a parent termination", async () => {
    const parentStopFixtureSource = String.raw`
      const { spawn } = require("node:child_process");
      process.on("SIGTERM", () => {});
      const worker = spawn(
        process.execPath,
        ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"],
        { stdio: "ignore" },
      );
      process.stdout.write("PARENT_STOP_PID=" + process.pid + "\\n");
      process.stdout.write("PARENT_STOP_WORKER_PID=" + worker.pid + "\\n");
      setInterval(() => {}, 1000);
    `;
    const runnerResult = await runPreflightRunnerFixture({
      timeoutSeconds: 3,
      heartbeatSeconds: 0.05,
      parentStopAfterMs: 200,
      childSource: parentStopFixtureSource,
    });
    const parentProcessId = fixtureProcessId(
      runnerResult.capturedOutput,
      "PARENT_STOP_PID",
    );
    const workerProcessId = fixtureProcessId(
      runnerResult.capturedOutput,
      "PARENT_STOP_WORKER_PID",
    );

    assert.equal(runnerResult.status, 143);
    assert.equal(
      runnerResult.capturedOutput.split("stopped after parent SIGTERM").length -
        1,
      1,
    );
    assert.equal(await waitForFixtureProcessExit(parentProcessId), true);
    assert.equal(await waitForFixtureProcessExit(workerProcessId), true);
  });

  it("pins the production heartbeat to interactive Tests runs at ten seconds", () => {
    const preflightSource = readFileSync(PREFLIGHT_SCRIPT_PATH, "utf-8");

    assert.match(preflightSource, /preflight_test_heartbeat_seconds=10/u);
    assert.match(preflightSource, /\[\[ "\$_is_tty" -eq 1 \]\]/u);
    assert.match(preflightSource, /"Tests" "\$\{test_command\[@\]\}"/u);
    assert.match(preflightSource, /"Tests retry"/u);
    assert.doesNotMatch(preflightSource, /GOAT_FLOW_PREFLIGHT_TEST_COMMAND/u);
    assert.equal(
      [...preflightSource.matchAll(/run_command_capture_with_timeout/gu)]
        .length,
      3,
      "expected one helper definition plus first-run and retry call sites",
    );
  });
});
