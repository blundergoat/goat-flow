/**
 * Shared M13/M16 negative-space test: quality flows must not execute project
 * constraint commands implicitly.
 */
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { resolve } from "node:path";
import { dispatchCommand, parseCLIArgs } from "../../src/cli/cli.js";
import { serveDashboard } from "../../src/cli/server/dashboard.js";

const require = createRequire(import.meta.url);
const childProcess =
  require("node:child_process") as typeof import("node:child_process");
const PROJECT_PATH = resolve(import.meta.dirname, "..", "..");
const originalSpawn = childProcess.spawn;
const originalStdoutWrite = process.stdout.write.bind(process.stdout);

afterEach(() => {
  childProcess.spawn = originalSpawn;
  syncBuiltinESMExports();
  process.stdout.write = originalStdoutWrite;
});

describe("quality constraint isolation", () => {
  it("goat-flow quality does not spawn project constraint commands", async () => {
    let spawnCalls = 0;
    childProcess.spawn = (() => {
      spawnCalls += 1;
      throw new Error("quality should not spawn project constraint commands");
    }) as typeof childProcess.spawn;
    syncBuiltinESMExports();
    process.stdout.write = (() => true) as typeof process.stdout.write;

    await dispatchCommand(
      parseCLIArgs([
        "quality",
        PROJECT_PATH,
        "--agent",
        "claude",
        "--format",
        "json",
      ]),
    );

    assert.equal(spawnCalls, 0);
  });

  it("dashboard home audit refresh does not spawn project constraint commands", async () => {
    let spawnCalls = 0;
    childProcess.spawn = (() => {
      spawnCalls += 1;
      throw new Error(
        "dashboard home audit refresh should not spawn project constraint commands",
      );
    }) as typeof childProcess.spawn;
    syncBuiltinESMExports();

    const server = await serveDashboard({ projectPath: PROJECT_PATH });
    try {
      const res = await fetch(
        `http://127.0.0.1:${server.port}/api/audit?path=${encodeURIComponent(
          PROJECT_PATH,
        )}&quality=true`,
      );
      assert.equal(res.status, 200);
      assert.equal(spawnCalls, 0);
    } finally {
      await server.close();
    }
  });
});
