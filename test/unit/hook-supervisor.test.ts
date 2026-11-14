/** Real process boundaries protect native result delivery and bounded cleanup. */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
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
    await waitFor(() => existsSync(marker) && existsSync(controlMarker));
    workerPid = Number(readFileSync(marker, "utf8"));
    assert.ok(Number.isSafeInteger(workerPid) && workerPid > 0);
    const parentPid = parent.pid;
    const controlPid = control.pid;
    assert.ok(parentPid && controlPid);
    assert.ok(
      isRunning(parentPid) && isRunning(workerPid) && isRunning(controlPid),
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
    const readyWorkerPid = workerPid;
    await waitFor(() => !isRunning(parentPid) && !isRunning(readyWorkerPid));
    assert.ok(isRunning(controlPid), "unrelated work must remain running");
  });
}
