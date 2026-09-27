/**
 * Check dashboard and CLI process helpers and atomic writes in disposable projects.
 * A requested write must keep the original destination if its temporary file is substituted.
 *
 * Real files and scoped mocks make cleanup and identity mistakes observable.
 */
import { strict as assert } from "node:assert";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
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
  it("refuses a temporary symlink collision without touching its target or deleting the collision", async (t) => {
    if (process.platform === "win32") return;
    const root = await mkdtemp(join(tmpdir(), "goat-flow-atomic-collision-"));
    const victim = join(root, "victim.txt");
    await writeFile(victim, "keep");
    const originalOpen = fs.openSync;
    let collision = "";
    t.mock.method(
      fs,
      "openSync",
      (path: fs.PathLike, flags: fs.OpenMode, mode?: fs.Mode) => {
        if (String(path).endsWith(".tmp")) {
          collision = String(path);
          fs.symlinkSync(victim, path);
        }
        return originalOpen(path, flags, mode);
      },
    );
    syncBuiltinESMExports();
    try {
      assert.throws(
        () => writeFileAtomic(join(root, "state.json"), "overwrite", root),
        /EEXIST/,
      );
      assert.equal(await readFile(victim, "utf8"), "keep");
      assert.equal(fs.lstatSync(collision).isSymbolicLink(), true);
    } finally {
      t.mock.restoreAll();
      syncBuiltinESMExports();
      await rm(root, { recursive: true, force: true });
    }
  });
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

  // Fixture purpose: preallocate a foreign file so the stage and replacement have distinct filesystem identities.
  // Filesystem side effects: swap it after close and confirm the destination and foreign stage both remain intact.
  it("rejects a replaced temporary file even when numeric file IDs collide", async (t) => {
    const root = await mkdtemp(join(tmpdir(), "goat-flow-atomic-identity-"));
    const targetPath = join(root, "state.json");
    const foreignPath = join(root, "foreign.tmp");
    await writeFile(targetPath, "before\n");
    await writeFile(foreignPath, "foreign\n");
    const originalOpen = fs.openSync;
    const originalClose = fs.closeSync;
    const originalFstat = fs.fstatSync;
    const originalLstat = fs.lstatSync;
    let stagedPath = "";
    let wasReplaced = false;
    t.mock.method(
      fs,
      "openSync",
      (path: fs.PathLike, flags: fs.OpenMode, mode?: fs.Mode) => {
        // Capture the temporary path chosen for this requested write so the fixture can replace that exact stage.
        if (String(path).endsWith(".tmp")) stagedPath = String(path);
        return originalOpen(path, flags, mode);
      },
    );
    t.mock.method(fs, "closeSync", (descriptor: number) => {
      originalClose(descriptor);
      // Replace the stage once after it closes, just before publication checks its identity.
      if (stagedPath && !wasReplaced) {
        wasReplaced = true;
        fs.unlinkSync(stagedPath);
        fs.renameSync(foreignPath, stagedPath);
      }
    });
    // Model two NTFS identities that round to the same Number; bigint reads retain the real file identity.
    t.mock.method(
      fs,
      "fstatSync",
      (descriptor: number, options?: { bigint?: boolean }) => {
        const stats = originalFstat(descriptor, options as { bigint: true });
        return options?.bigint
          ? stats
          : Object.assign(stats, { dev: 1, ino: 1 });
      },
    );
    t.mock.method(
      fs,
      "lstatSync",
      (path: fs.PathLike, options?: { bigint?: boolean }) => {
        const stats = originalLstat(path, options as { bigint: true });
        return options?.bigint || String(path) !== stagedPath
          ? stats
          : Object.assign(stats, { dev: 1, ino: 1 });
      },
    );
    syncBuiltinESMExports();
    try {
      assert.throws(
        () => writeFileAtomic(targetPath, "after\n", root),
        /Atomic write temporary file changed/u,
      );
      assert.equal(await readFile(targetPath, "utf8"), "before\n");
      assert.equal(await readFile(stagedPath, "utf8"), "foreign\n");
    } finally {
      t.mock.restoreAll();
      syncBuiltinESMExports();
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
    "applies caller-selected replacement permissions under the process umask",
    { skip: process.platform === "win32" },
    async () => {
      const root = await mkdtemp(join(tmpdir(), "goat-flow-atomic-mode-"));
      const targetPath = join(root, "instructions.md");
      const requestedFileMode = 0o640;
      // The runner may restrict new files, so the user's replacement gets only permission bits allowed by its umask.
      const expectedFileMode = requestedFileMode & ~process.umask();
      try {
        await writeFile(targetPath, "before\n", "utf-8");
        await chmod(targetPath, requestedFileMode);

        writeFileAtomic(targetPath, "after\n", root, requestedFileMode);

        assert.equal(await readFile(targetPath, "utf-8"), "after\n");
        assert.equal((await stat(targetPath)).mode & 0o777, expectedFileMode);
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
