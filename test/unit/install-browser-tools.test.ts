/**
 * Safety regressions for browser-tool venv cleanup.
 *
 * Every candidate path stays inside a suite-owned temporary directory.
 * A Python shim exits before package installation if the guard regresses, so the test never reaches the network or a user environment.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";

const installerPath = resolve(
  import.meta.dirname,
  "..",
  "..",
  "scripts",
  "install-browser-tools.sh",
);

/**
 * Write the minimum Python discovery shim; any attempted venv creation exits 99.
 * Filesystem side effects: creates one directory and executable inside the caller's disposable fixture.
 *
 * @param fixtureRoot - suite-owned temporary root that contains the shim
 * @returns the fixture-local binary directory to prepend to PATH
 */
function writePythonShim(fixtureRoot: string): string {
  const binaryDirectory = join(fixtureRoot, "bin");
  const pythonPath = join(binaryDirectory, "python3.13");
  mkdirSync(binaryDirectory, { recursive: true });
  writeFileSync(
    pythonPath,
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "-c" ]]; then
  if [[ "\${2:-}" == *"print("* ]]; then printf '3.11\\n'; fi
  exit 0
fi
exit 99
`,
  );
  chmodSync(pythonPath, 0o755);
  return binaryDirectory;
}

describe("install-browser-tools force cleanup", () => {
  for (const protectedRelation of ["checkout", "home"] as const) {
    it(`refuses a venv target that is an ancestor of the ${protectedRelation}`, () => {
      const fixtureRoot = mkdtempSync(
        join(tmpdir(), "goatflow-browser-force-"),
      );
      const protectedTarget = join(fixtureRoot, "protected-target");
      const checkoutPath =
        protectedRelation === "checkout"
          ? join(protectedTarget, "checkout")
          : join(fixtureRoot, "checkout");
      const homePath =
        protectedRelation === "home"
          ? join(protectedTarget, "home")
          : join(fixtureRoot, "home");
      const installRoot = join(fixtureRoot, "install-root");
      const wrapperDirectory = join(fixtureRoot, "wrappers");
      const sentinelPath = join(protectedTarget, "keep.txt");

      try {
        mkdirSync(checkoutPath, { recursive: true });
        mkdirSync(homePath, { recursive: true });
        mkdirSync(installRoot, { recursive: true });
        writeFileSync(join(protectedTarget, "pyvenv.cfg"), "home = fixture\n");
        writeFileSync(sentinelPath, "keep\n");
        const shimDirectory = writePythonShim(fixtureRoot);

        const result = spawnSync(
          "bash",
          [installerPath, "--force", "--no-system-deps"],
          {
            cwd: checkoutPath,
            encoding: "utf-8",
            env: {
              ...process.env,
              HOME: homePath,
              PATH: `${shimDirectory}:${process.env.PATH ?? ""}`,
              BROWSER_TOOLS_HOME: installRoot,
              BROWSER_TOOLS_VENV: protectedTarget,
              BROWSER_TOOLS_BIN_DIR: wrapperDirectory,
            },
          },
        );

        assert.equal(result.status, 4, result.stderr || result.stdout);
        assert.match(result.stderr, /Refusing --force removal of broad path/u);
        assert.equal(
          existsSync(sentinelPath),
          true,
          "validation must stop before recursive cleanup",
        );
      } finally {
        rmSync(fixtureRoot, { recursive: true, force: true });
      }
    });
  }
});
