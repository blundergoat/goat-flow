/**
 * Unit tests for safe process execution and project-bounded atomic file writes.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { tmpdir } from "node:os";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { withEnv } from "../helpers/global-fixtures.js";

import {
  execSafely,
  SafeExecRejection,
  sideEffectfulRouteKey,
  spawnInheritedSync,
  writeFileAtomic,
} from "../../src/cli/server/safe-exec.js";

describe("safe-exec/writeFileAtomic", () => {
  it("replaces the complete destination", async () => {
    const root = await mkdtemp(join(tmpdir(), "goat-flow-atomic-write-"));
    const targetPath = join(root, "state.json");
    try {
      await writeFile(targetPath, "before\n", "utf-8");

      writeFileAtomic(targetPath, "after\n", root);

      assert.equal(await readFile(targetPath, "utf-8"), "after\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("preserves the destination when replacement fails after staging", async () => {
    const root = await mkdtemp(join(tmpdir(), "goat-flow-atomic-failure-"));
    const targetPath = join(root, "state.json");
    try {
      await mkdir(targetPath);
      await writeFile(join(targetPath, "sentinel"), "before\n", "utf-8");

      assert.throws(() => writeFileAtomic(targetPath, "after\n", root));

      assert.equal(
        await readFile(join(targetPath, "sentinel"), "utf-8"),
        "before\n",
      );
      const stagedFiles = (await readdir(root)).filter(
        (name) => name.startsWith(".state.json.") && name.endsWith(".tmp"),
      );
      assert.deepEqual(stagedFiles, []);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it(
    "uses the caller-selected replacement permissions",
    { skip: process.platform === "win32" },
    async () => {
      const root = await mkdtemp(join(tmpdir(), "goat-flow-atomic-mode-"));
      const targetPath = join(root, "instructions.md");
      try {
        await writeFile(targetPath, "before\n", "utf-8");
        await chmod(targetPath, 0o640);

        writeFileAtomic(targetPath, "after\n", root, 0o640);

        assert.equal(await readFile(targetPath, "utf-8"), "after\n");
        assert.equal((await stat(targetPath)).mode & 0o777, 0o640);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});

describe("safe-exec/spawnInheritedSync", () => {
  it("rejects a command whose basename is not allow-listed", () => {
    assert.throws(
      () =>
        spawnInheritedSync({
          command: "/usr/bin/python3",
          args: [],
          allowedBasenames: ["bash", "bash.exe"],
        }),
      (err: unknown) =>
        err instanceof SafeExecRejection &&
        err.reason === "command-not-in-allow-list",
    );
  });

  it("rejects shell metacharacters in args before spawning", () => {
    assert.throws(
      () =>
        spawnInheritedSync({
          command: process.execPath,
          args: ["-e", "true; process.exit(1)"],
          allowedBasenames: ["node", "node.exe"],
        }),
      (err: unknown) =>
        err instanceof SafeExecRejection &&
        err.reason === "args-contain-metacharacters",
    );
  });

  it("propagates the child exit status for an allow-listed command", () => {
    // Arbitrary non-zero, non-one status so pass-through is distinguishable from defaults.
    const expectedExitCode = 7;
    const result = spawnInheritedSync({
      command: process.execPath,
      args: ["-e", `process.exit(${expectedExitCode})`],
      allowedBasenames: ["node", "node.exe"],
    });
    assert.equal(result.status, expectedExitCode);
  });
});

describe("safe-exec/execSafely", () => {
  it("rejects when command not in allow-list", async () => {
    await assert.rejects(
      execSafely({
        command: "rm",
        args: ["-rf", "/"],
        cwd: tmpdir(),
        allowList: ["ls"],
        timeoutMs: 1_000,
      }),
      (err: unknown) =>
        err instanceof SafeExecRejection &&
        err.reason === "command-not-in-allow-list",
    );
  });

  it("rejects shell metacharacters in args", async () => {
    await assert.rejects(
      execSafely({
        command: "ls",
        args: ["-la", "; rm -rf /"],
        cwd: tmpdir(),
        allowList: ["ls"],
        timeoutMs: 1_000,
      }),
      (err: unknown) =>
        err instanceof SafeExecRejection &&
        err.reason === "args-contain-metacharacters",
    );
  });

  it("rejects command substitution in args", async () => {
    await assert.rejects(
      execSafely({
        command: "ls",
        args: ["$(whoami)"],
        cwd: tmpdir(),
        allowList: ["ls"],
        timeoutMs: 1_000,
      }),
      (err: unknown) =>
        err instanceof SafeExecRejection &&
        err.reason === "args-contain-metacharacters",
    );
  });

  it("rejects backtick command substitution in args", async () => {
    await assert.rejects(
      execSafely({
        command: "ls",
        args: ["`whoami`"],
        cwd: tmpdir(),
        allowList: ["ls"],
        timeoutMs: 1_000,
      }),
      (err: unknown) =>
        err instanceof SafeExecRejection &&
        err.reason === "args-contain-metacharacters",
    );
  });

  it("captures stdout and reports ok on exit code 0", async () => {
    const result = await execSafely({
      command: "node",
      args: ["-e", "process.stdout.write('hello')"],
      cwd: tmpdir(),
      allowList: ["node"],
      timeoutMs: 5_000,
    });
    assert.equal(result.ok, true);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "hello");
    assert.equal(result.timedOut, false);
  });

  it("reports exit code non-zero as ok:false", async () => {
    const failingExitCode = 7;
    const result = await execSafely({
      command: "node",
      args: ["-e", `process.exit(${failingExitCode})`],
      cwd: tmpdir(),
      allowList: ["node"],
      timeoutMs: 5_000,
    });
    assert.equal(result.ok, false);
    assert.equal(result.exitCode, failingExitCode);
  });

  it("kills long-running processes on timeout", async () => {
    const result = await execSafely({
      command: "node",
      args: ["-e", "setInterval(() => {}, 1000)"],
      cwd: tmpdir(),
      allowList: ["node"],
      timeoutMs: 200,
    });
    assert.equal(result.timedOut, true);
    assert.equal(result.ok, false);
  });

  it("truncates stdout above the configured cap", async () => {
    const result = await execSafely({
      command: "node",
      args: ["-e", "process.stdout.write('x'.repeat(50000))"],
      cwd: tmpdir(),
      allowList: ["node"],
      timeoutMs: 5_000,
      stdoutCapBytes: 1024,
    });
    assert.equal(result.truncated, true);
    assert.ok(result.stdout.includes("output truncated at 1024 bytes"));
  });

  it("applies stdout caps as bytes without returning partial UTF-8 characters", async () => {
    const result = await execSafely({
      command: "node",
      args: ["-e", "process.stdout.write('€'.repeat(3))"],
      cwd: tmpdir(),
      allowList: ["node"],
      timeoutMs: 5_000,
      stdoutCapBytes: 5,
    });
    const head = result.stdout.split("\n")[0] ?? "";
    assert.equal(result.truncated, true);
    assert.equal(head, "€");
    assert.ok(Buffer.byteLength(head, "utf8") <= 5);
  });

  it("does not inherit parent environment variables by default", async () => {
    const result = await withEnv(
      { GOAT_SAFE_EXEC_SECRET: "parent-secret" },
      () =>
        execSafely({
          command: "node",
          args: [
            "-e",
            'process.stdout.write(process.env.GOAT_SAFE_EXEC_SECRET ? process.env.GOAT_SAFE_EXEC_SECRET : "missing")',
          ],
          cwd: tmpdir(),
          allowList: ["node"],
          timeoutMs: 5_000,
        }),
    );
    assert.equal(result.stdout, "missing");
  });

  it("populates commandBasename from the command path", async () => {
    const result = await execSafely({
      command: "node",
      args: ["-e", "process.exit(0)"],
      cwd: tmpdir(),
      allowList: ["node"],
      timeoutMs: 5_000,
    });
    assert.equal(result.commandBasename, "node");
  });

  it("records a redacted audit.exec evidence event when requested", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "goat-flow-safe-exec-"));
    try {
      const result = await execSafely({
        command: "node",
        args: ["-e", "process.stdout.write('secret-output')"],
        cwd: projectPath,
        allowList: ["node"],
        timeoutMs: 5_000,
        evidence: { projectPath },
      });

      assert.equal(result.ok, true);
      const eventsDir = join(projectPath, ".goat-flow", "logs", "events");
      const eventFiles = (await readdir(eventsDir))
        .filter((name) => /^\d{4}-\d{2}-\d{2}\.jsonl$/u.test(name))
        .sort();
      assert.equal(eventFiles.length, 1);
      const logPath = join(eventsDir, eventFiles[0]!);
      const line = (await readFile(logPath, "utf-8")).trim();
      const event = JSON.parse(line) as {
        event_kind: string;
        actor: string;
        payload: Record<string, unknown>;
      };
      assert.equal(event.event_kind, "audit.exec");
      assert.equal(event.actor, "server");
      assert.equal(event.payload.command, "node");
      assert.equal(event.payload.ok, true);
      assert.equal(event.payload.exitCode, 0);
      assert.equal(event.payload.timedOut, false);
      assert.equal("stdout" in event.payload, false);
      assert.equal("args" in event.payload, false);
    } finally {
      await rm(projectPath, { recursive: true, force: true });
    }
  });
});

describe("safe-exec/sideEffectfulRouteKey", () => {
  it("builds the canonical route key", () => {
    assert.equal(sideEffectfulRouteKey("post", "/api/foo"), "POST /api/foo");
  });
});
