/**
 * Checks the replies and process cleanup users rely on when a native hook runs.
 *
 * Use when deadlines, output limits, or cancellation handling changes.
 * Real subprocesses exercise the cases where workers can still be running after a hook is stopped.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { captureHookProcessUntilDeadline } from "../../workflow/hooks/hook-supervisor.mjs";

const managedEnvironment = {
  ...process.env,
  GOAT_FLOW_HOOK_PROVIDER_MODE: "managed",
};

/** Treat unreaped POSIX zombies as stopped; missing process identities also return false. */
function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    if (process.platform !== "win32") {
      const state = spawnSync("ps", ["-p", String(pid), "-o", "stat="], {
        encoding: "utf8",
      }).stdout.trim();
      return state.length > 0 && !state.startsWith("Z");
    }
    return true;
  } catch {
    return false;
  }
}

/** Wait for observable readiness or cleanup; throws if process state misses its five-second bound. */
async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    assert.ok(
      Date.now() < deadline,
      "process state missed its five-second bound",
    );
    await delay(10);
  }
}

/** Wait until a process marker contains the safe positive PID written by its running worker. */
async function waitForReadyPid(markerPath: string): Promise<number> {
  const deadline = Date.now() + 5000;
  while (true) {
    if (existsSync(markerPath)) {
      const pid = Number(readFileSync(markerPath, "utf8"));
      if (Number.isSafeInteger(pid) && pid > 0) return pid;
    }
    assert.ok(
      Date.now() < deadline,
      "worker PID did not arrive within five seconds",
    );
    await delay(10);
  }
}

for (const damaged of [false, true]) {
  test(`native supervisor completes ${damaged ? "invalid UTF-8" : "split UTF-8 and exit status"}`, async (t) => {
    const program = damaged
      ? "process.stdout.write(Buffer.from([255]));"
      : "const bytes=Buffer.from('🐐'); process.stdout.write(bytes.subarray(0,2)); setImmediate(()=>{process.stdout.write(bytes.subarray(2)); process.stderr.write('details'); process.exitCode=7});";
    const child = spawn(process.execPath, ["-e", program], {
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    t.after(() => child.kill("SIGKILL"));
    const result = await captureHookProcessUntilDeadline(
      child,
      managedEnvironment,
      5000,
      process.platform,
      true,
    );
    assert.equal(result.status, damaged ? 0 : 7);
    assert.equal(result.launchError, null);
    assert.equal(result.timedOut, false);
    assert.equal(result.hasExceededOutputLimit, false);
    assert.equal(result.hasInvalidUtf8Output, damaged);
    assert.equal(result.stdout, damaged ? "�" : "🐐");
    assert.equal(result.stderr, damaged ? "" : "details");
    assert.equal(result.output?.stdoutBytes, damaged ? 1 : 4);
    assert.equal(result.output?.stderrBytes, damaged ? 0 : 7);
    assert.equal(result.output?.areByteCountsExact, true);
  });
}

test("native supervisor reports a missing executable without a trusted exit status", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "goat-native-launch-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const child = spawn(join(root, "missing-executable"), [], { stdio: "pipe" });
  const result = await captureHookProcessUntilDeadline(
    child,
    managedEnvironment,
    5000,
    process.platform,
    true,
  );
  assert.equal(result.status, null);
  assert.equal((result.launchError as NodeJS.ErrnoException).code, "ENOENT");
  assert.equal(result.timedOut, false);
  assert.equal(result.output?.areByteCountsExact, false);
});

// Simulate a check reaching its deadline and an agent stopping the launcher while a worker is still running.
for (const ending of ["deadline", "SIGTERM"] as const) {
  test(
    `native supervision cleans up inherited-group workers on ${ending}`,
    { skip: process.platform === "win32" },
    async (t) => {
      const root = mkdtempSync(join(tmpdir(), "goat-native-supervisor-"));
      const workerPidFile = join(root, "worker.pid");
      const resultMarker = join(root, "delivered");
      const worker = [
        "const fs = require('node:fs');",
        "fs.writeFileSync(process.argv[1], String(process.pid));",
        "setInterval(() => {}, 1000);",
      ].join("");
      const evaluator = [
        "const { spawn } = require('node:child_process');",
        `spawn(process.execPath, ['-e', ${JSON.stringify(worker)}, process.argv[1]], { stdio: ['ignore', 'inherit', 'inherit'] }).unref();`,
      ].join("");
      const supervisor = new URL(
        "../../workflow/hooks/hook-supervisor.mjs",
        import.meta.url,
      );
      const program = `
        import { spawn } from "node:child_process";
        import { writeFileSync } from "node:fs";
        import { captureHookProcessUntilDeadline } from ${JSON.stringify(supervisor.href)};
        const child = spawn(process.execPath, ["-e", ${JSON.stringify(evaluator)}, process.argv[1]], { detached: true, stdio: "pipe" });
        const result = await captureHookProcessUntilDeadline(child, process.env, ${ending === "deadline" ? 2000 : 8000}, process.platform, true, { handleCancellation: true });
        writeFileSync(process.argv[2], "result available");
        process.exitCode = result.timedOut ? 0 : 1;
      `;
      const launcher = spawn(
        process.execPath,
        ["--input-type=module", "-e", program, workerPidFile, resultMarker],
        {
          stdio: "ignore",
        },
      );
      const closed = once(launcher, "close");
      let workerPid: number | undefined;
      t.after(() => {
        launcher.kill("SIGKILL");
        // A failing check may leave a known worker running, so stop it before removing the project.
        if (workerPid !== undefined && isRunning(workerPid))
          process.kill(workerPid, "SIGKILL");
        rmSync(root, { recursive: true, force: true });
      });
      workerPid = await waitForReadyPid(workerPidFile);
      // Send cancellation only after a worker has started. The timeout case lets the launcher's timer fire.
      if (ending === "SIGTERM") launcher.kill("SIGTERM");
      assert.deepEqual(
        await closed,
        ending === "deadline" ? [0, null] : [null, "SIGTERM"],
      );
      assert.equal(existsSync(resultMarker), ending === "deadline");
      await waitFor(() => workerPid !== undefined && !isRunning(workerPid));
    },
  );
}

for (const ending of ["deadline", "envelope", "diagnostic-flood"] as const) {
  test(`native supervisor stops owned processes on ${ending} and preserves unrelated work`, async (t) => {
    const root = mkdtempSync(join(tmpdir(), "goat-native-supervisor-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const marker = join(root, "worker.pid");
    const controlMarker = join(root, "control.pid");
    // The descendant retains both pipes and writes its own PID only after it is running.
    const worker =
      "require('node:fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(()=>{},1000)";
    const channel = ending === "diagnostic-flood" ? "stderr" : "stdout";
    const size =
      ending === "deadline" ? 0 : ending === "envelope" ? 65537 : 1048577;
    const program = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(worker)},process.argv[1]],{detached:process.platform!=='win32',stdio:['ignore','inherit','inherit']}); process.stdin.once('data',()=>process.${channel}.write(Buffer.alloc(${size},97))); setInterval(()=>{},1000)`;
    const parent = spawn(process.execPath, ["-e", program, marker], {
      detached: process.platform !== "win32",
      stdio: "pipe",
    });
    const control = spawn(process.execPath, ["-e", worker, controlMarker], {
      stdio: "ignore",
    });
    let workerPid: number | undefined;
    t.after(() => {
      control.kill("SIGKILL");
      parent.kill("SIGKILL");
      if (workerPid !== undefined && isRunning(workerPid))
        process.kill(workerPid, "SIGKILL");
    });
    const [readyWorkerPid, readyControlPid] = await Promise.all([
      waitForReadyPid(marker),
      waitForReadyPid(controlMarker),
    ]);
    workerPid = readyWorkerPid;
    const parentPid = parent.pid;
    assert.ok(parentPid && control.pid);
    assert.equal(control.pid, readyControlPid);
    assert.ok(
      isRunning(parentPid) &&
        isRunning(workerPid) &&
        isRunning(readyControlPid),
    );
    const started = Date.now();
    const captured = captureHookProcessUntilDeadline(
      parent,
      managedEnvironment,
      ending === "deadline" ? 100 : 5000,
      process.platform,
      true,
    );
    parent.stdin.end("go");
    const result = await captured;
    assert.ok(
      Date.now() - started < 5000,
      "forced delivery must not wait for child close",
    );
    assert.equal(result.status, null);
    assert.equal(result.launchError, null);
    assert.equal(result.timedOut, ending === "deadline");
    assert.equal(result.hasExceededOutputLimit, ending !== "deadline");
    assert.equal(
      result.output?.failureStage,
      ending === "deadline" ? undefined : ending,
    );
    assert.equal(result.output?.areByteCountsExact, false);
    await waitFor(() => !isRunning(parentPid) && !isRunning(readyWorkerPid));
    assert.ok(isRunning(readyControlPid), "unrelated work must remain running");
  });
}
