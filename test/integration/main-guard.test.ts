import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
const REAL_CLI = join(PROJECT_ROOT, "dist", "cli", "cli.js");

describe("main-module guard via symlink", () => {
  let dir: string;

  after(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("CLI runs when launched through a symlink", () => {
    dir = mkdtempSync(join(tmpdir(), "gf-symlink-"));
    const link = join(dir, "goat-flow");
    symlinkSync(REAL_CLI, link);
    chmodSync(REAL_CLI, 0o755);

    const stdout = execFileSync(process.execPath, [link, "--version"], {
      encoding: "utf-8",
      timeout: 10_000,
    });
    assert.match(stdout.trim(), /^goat-flow v\d+\.\d+\.\d+$/);
  });

  it("CLI runs when launched via the real path", () => {
    const stdout = execFileSync(process.execPath, [REAL_CLI, "--version"], {
      encoding: "utf-8",
      timeout: 10_000,
    });
    assert.match(stdout.trim(), /^goat-flow v\d+\.\d+\.\d+$/);
  });
});
