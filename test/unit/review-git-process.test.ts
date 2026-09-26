/**
 * Protect review authority when Node reports child-process metadata after Git has completed.
 * A confirmed non-repository response remains distinct from a process that never ran.
 */
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { describe, it } from "node:test";
import { gitContext } from "../../src/cli/review-validate-anchors.js";

describe("review Git process outcomes", () => {
  it("uses completed Git output despite EPERM metadata", (test) => {
    const root = fs.realpathSync(process.cwd());
    const outputs = [Buffer.from(`${root}\n`), Buffer.from("sha1\n")];
    let calls = 0;
    test.mock.method(childProcess, "execFileSync", () => {
      throw Object.assign(new Error("spawn metadata"), {
        code: "EPERM",
        status: 0,
        stdout: outputs[calls],
      });
    });
    test.mock.method(childProcess, "spawnSync", () => ({
      status: 0,
      signal: null,
      error: Object.assign(new Error("spawn metadata"), { code: "EPERM" }),
      stdout: outputs[calls++],
      stderr: Buffer.alloc(0),
    }));
    syncBuiltinESMExports();
    try {
      assert.equal(gitContext(root).objectFormat, "sha1");
      assert.equal(calls, 2);
    } finally {
      test.mock.restoreAll();
      syncBuiltinESMExports();
    }
  });

  it("distinguishes failed Git launch from a confirmed standalone folder", (test) => {
    const root = fs.realpathSync(process.cwd());
    let reply: {
      status: number | null;
      signal: null;
      error: (Error & { code: string }) | undefined;
      stdout: Buffer;
      stderr: Buffer;
    } = {
      status: null,
      signal: null,
      error: Object.assign(new Error("launch denied"), { code: "EPERM" }),
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
    };
    test.mock.method(childProcess, "spawnSync", () => reply);
    syncBuiltinESMExports();
    try {
      assert.throws(
        () => gitContext(root),
        /cannot read local Git rev-parse metadata/u,
      );
      reply = {
        status: 128,
        signal: null,
        error: undefined,
        stdout: Buffer.alloc(0),
        stderr: Buffer.from(
          "fatal: not a git repository (or any of the parent directories): .git\n",
        ),
      };
      assert.equal(gitContext(root).objectFormat, null);
    } finally {
      test.mock.restoreAll();
      syncBuiltinESMExports();
    }
  });
});
