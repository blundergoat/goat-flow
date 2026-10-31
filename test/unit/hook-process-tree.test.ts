/** Real Node processes protect native owned-tree cleanup and unrelated running work. */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import {
  stopHookProcessTree,
  windowsTaskkillExecutablePath,
} from "../../workflow/hooks/process-tree.mjs";

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

/** Waits for observable process state; throws when fixture readiness or cleanup misses its bound. */
async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    assert.ok(
      Date.now() < deadline,
      "process state did not arrive within five seconds",
    );
    await delay(10);
  }
}

test("native cleanup resolves taskkill only from an absolute system root", () => {
  assert.equal(
    windowsTaskkillExecutablePath({ SystemRoot: "D:\\Windows" }),
    "D:\\Windows\\System32\\taskkill.exe",
  );
  assert.equal(
    windowsTaskkillExecutablePath({ SystemRoot: "", WINDIR: "E:\\Windows" }),
    "E:\\Windows\\System32\\taskkill.exe",
  );
  assert.equal(windowsTaskkillExecutablePath({}), null);
  assert.equal(
    windowsTaskkillExecutablePath({ SystemRoot: "project-tools" }),
    null,
  );
});

test("native cleanup terminates a ready detached descendant and preserves unrelated work", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "goat-native-tree-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  // Fixture writes its own PID only after the Node worker is running; it spawns no shell.
  const worker =
    "require('node:fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000)";
  const marker = join(root, "worker.pid");
  const controlMarker = join(root, "control.pid");
  const program = `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(worker)}, process.argv[1]], {detached: process.platform !== 'win32', stdio: 'ignore'}); setInterval(() => {}, 1000)`;
  const parent = spawn(process.execPath, ["-e", program, marker], {
    detached: process.platform !== "win32",
    stdio: "ignore",
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
  assert.ok(isRunning(parentPid));
  assert.ok(isRunning(workerPid));
  assert.ok(isRunning(controlPid));
  stopHookProcessTree(parent, process.platform, process.env);
  const readyWorkerPid = workerPid;
  await waitFor(() => !isRunning(parentPid) && !isRunning(readyWorkerPid));
  assert.ok(isRunning(controlPid), "unrelated work must remain running");
});
