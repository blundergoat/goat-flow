/**
 * Installer dependency and lifecycle proof for the public CLI and low-level Bash helper.
 * Disposable package roots reproduce a package with missing dependencies without changing this checkout.
 * Use these fixtures to keep dependency failures ahead of project writes and verified install-state receipts.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import {
  makeTempProject,
  PROJECT_ROOT,
  runInstaller,
} from "./setup-install.helpers.js";

/**
 * Copy the minimum installer package into a disposable root with no installed dependencies.
 * Side effects: writes a temporary workflow directory, installer, manifest, and package metadata for the user's fixture.
 * @returns the non-empty package root users would receive from an incomplete package extraction
 */
function makePackageRootWithoutDependencies(): string {
  const packageRoot = makeTempProject();
  const workflowDirectory = join(packageRoot, "workflow");
  mkdirSync(workflowDirectory);
  copyFileSync(
    join(PROJECT_ROOT, "workflow", "install-goat-flow.sh"),
    join(workflowDirectory, "install-goat-flow.sh"),
  );
  copyFileSync(
    join(PROJECT_ROOT, "workflow", "manifest.json"),
    join(workflowDirectory, "manifest.json"),
  );
  copyFileSync(
    join(PROJECT_ROOT, "package.json"),
    join(packageRoot, "package.json"),
  );
  return packageRoot;
}

/**
 * Run the copied low-level helper as a user would after extracting an incomplete package.
 * Side effects: spawns Bash against the disposable target and clears inherited package lookup hints without changing this checkout.
 * @param packageRoot - non-empty disposable package root containing the installer but no `node_modules`
 * @param targetProjectPath - non-empty disposable project that must stay unchanged on preflight failure
 * @returns process evidence; a non-zero status with one controlled error means preflight protected the user
 */
function runInstallerWithoutPackageDependencies(
  packageRoot: string,
  targetProjectPath: string,
) {
  return spawnSync(
    "bash",
    [
      join(packageRoot, "workflow", "install-goat-flow.sh"),
      targetProjectPath,
      "--agent",
      "codex",
    ],
    {
      cwd: packageRoot,
      encoding: "utf-8",
      env: { ...process.env, NODE_PATH: "" },
      timeout: 30000,
    },
  );
}

describe("installer dependency preflight", () => {
  // An incomplete package must explain the repair before the user's selected project receives even one file.
  it("stops on a missing runtime package before writing the target", () => {
    const packageRoot = makePackageRootWithoutDependencies();
    const targetProjectPath = makeTempProject();
    const installResult = runInstallerWithoutPackageDependencies(
      packageRoot,
      targetProjectPath,
    );

    assert.notEqual(installResult.status, 0);
    assert.equal(installResult.stdout, "");
    assert.equal(
      installResult.stderr,
      `ERROR: installer dependency 'js-yaml' is missing from goat-flow root '${packageRoot}'; run npm install in that root or reinstall @blundergoat/goat-flow, then retry.\n`,
    );
    assert.deepEqual(readdirSync(targetProjectPath), []);
    assert.equal(
      existsSync(
        join(targetProjectPath, ".goat-flow", "install-state", "codex.json"),
      ),
      false,
    );
  });

  // The installed package remains usable, while direct helper completion stays distinct from a verified CLI receipt.
  it("installs from a dependency-complete package without recording CLI state", () => {
    const targetProjectPath = makeTempProject();
    const installResult = runInstaller(targetProjectPath, "--agent", "codex");

    assert.equal(
      installResult.status,
      0,
      installResult.stderr || installResult.stdout,
    );
    assert.match(
      installResult.stdout,
      /The public goat-flow CLI verifies managed files and records install state after this helper exits\./u,
    );
    assert.match(
      installResult.stdout,
      /Direct script use does not perform those CLI steps\./u,
    );
    assert.equal(
      existsSync(
        join(targetProjectPath, ".agents", "skills", "goat", "SKILL.md"),
      ),
      true,
    );
    assert.equal(
      existsSync(
        join(targetProjectPath, ".goat-flow", "install-state", "codex.json"),
      ),
      false,
    );
  });
});
