/**
 * Installer dependency and lifecycle proof for the public CLI and low-level Bash helper.
 *
 * Disposable package roots reproduce a package with missing dependencies without changing this checkout.
 * Use these fixtures to keep dependency failures ahead of project writes and verified install-state receipts.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { HookManagedInstallationError } from "../../src/cli/server/hook-managed-installation.js";
import { syncHookStates } from "../../src/cli/server/hook-registrar.js";
import { readPolicyChoices } from "../../workflow/hooks/hook-policy-state.cjs";

import {
  makeTempProject,
  PROJECT_ROOT,
  runInstaller,
  runCliInstaller,
} from "./setup-install.helpers.js";

/** Create only the old policy surfaces needed to prove installer refusal happens before any target write. */
function pendingPolicyUpgradeProject(): string {
  const projectPath = makeTempProject();
  mkdirSync(join(projectPath, ".goat-flow/hooks/deny-dangerous"), {
    recursive: true,
  });
  writeFileSync(
    join(projectPath, ".goat-flow/config.yaml"),
    "hooks: {deny-dangerous: {enabled: true}, deny-git-mutations: {enabled: false}}\n",
  );
  writeFileSync(
    join(projectPath, ".goat-flow/hooks/deny-dangerous.sh"),
    "# previous package entrypoint\n",
  );
  writeFileSync(
    join(projectPath, ".goat-flow/hooks/deny-dangerous/guard-runtime.sh"),
    "# previous ownership\n",
  );
  return projectPath;
}

/** Capture target bytes and directory membership so a refused upgrade cannot hide state or scaffolding writes. */
function installerTargetSnapshot(projectPath: string): Record<string, string> {
  return Object.fromEntries(
    readdirSync(projectPath, { recursive: true, withFileTypes: true }).map(
      (entry) => {
        const path = join(entry.parentPath, entry.name);
        return [
          path.slice(projectPath.length + 1),
          entry.isDirectory()
            ? "directory"
            : readFileSync(path).toString("base64"),
        ];
      },
    ),
  );
}

describe("installer policy-review preflight", () => {
  // Neither direct force nor the CLI's cooperative admission marker substitutes for a user's policy decision.
  for (const admission of ["", "v2"]) {
    it(`refuses direct force before writes with admission=${admission || "absent"}`, () => {
      const projectPath = pendingPolicyUpgradeProject();
      const before = installerTargetSnapshot(projectPath);
      const result = spawnSync(
        "bash",
        [
          join(PROJECT_ROOT, "workflow/install-goat-flow.sh"),
          projectPath,
          "--agent",
          "codex",
          "--force",
        ],
        {
          encoding: "utf8",
          env: { ...process.env, GOAT_FLOW_INSTALL_ADMISSION: admission },
        },
      );
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /GitHub policy review is required/u);
      assert.deepEqual(installerTargetSnapshot(projectPath), before);
    });
  }

  // Writes a disposable mixed-policy project to verify storage migration preserves record bytes and policy choices.
  // Reports policy/file conflicts before writes, then checks deterministic repeated-install output.
  it("reports review in CLI dry-run and refuses force before legacy-state migration", () => {
    const projectPath = pendingPolicyUpgradeProject();
    mkdirSync(join(projectPath, ".codex"));
    writeFileSync(join(projectPath, ".codex/hooks.json"), "{}");
    mkdirSync(join(projectPath, ".goat-flow/install-state"));
    const legacyReceipt =
      JSON.stringify(
        {
          schemaVersion: "goat-flow.install-state.v1",
          agent: "codex",
          goatFlowVersion: "1.16.0",
          files: [],
        },
        null,
        2,
      ) + "\n";
    writeFileSync(
      join(projectPath, ".goat-flow/install-state/codex.json"),
      legacyReceipt,
    );
    const before = installerTargetSnapshot(projectPath);
    const preview = runCliInstaller(
      projectPath,
      "--agent",
      "codex",
      "--dry-run",
      "--format",
      "json",
    );
    assert.notEqual(preview.status, 0);
    assert.match(
      preview.stdout + preview.stderr,
      /GitHub policy review is required/u,
    );
    assert.deepEqual(installerTargetSnapshot(projectPath), before);
    const install = runCliInstaller(
      projectPath,
      "--agent",
      "codex",
      "--force-managed",
    );
    assert.notEqual(install.status, 0);
    assert.match(
      install.stdout + install.stderr,
      /GitHub policy review is required/u,
    );
    assert.deepEqual(installerTargetSnapshot(projectPath), before);

    const migration = runCliInstaller(
      projectPath,
      "--agent",
      "codex",
      "--migrate-state-only",
    );
    assert.equal(migration.status, 0, migration.stderr);
    assert.match(migration.stdout, /Local state migrated/u);
    const afterMigration = installerTargetSnapshot(projectPath);
    const expectedMigration = { ...before };
    delete expectedMigration[".goat-flow/install-state"];
    delete expectedMigration[".goat-flow/install-state/codex.json"];
    expectedMigration[".goat-flow/state"] = "directory";
    expectedMigration[".goat-flow/state/install"] = "directory";
    expectedMigration[".goat-flow/state/install/codex.json"] =
      Buffer.from(legacyReceipt).toString("base64");
    assert.deepEqual(afterMigration, expectedMigration);

    // No review value exists until Sync returns the dashboard's exact policy-consent request.
    let review: HookManagedInstallationError["details"];
    try {
      syncHookStates(projectPath);
      assert.fail("Mixed policy choices must require the dashboard review");
    } catch (error) {
      // The user reaches this review after CLI install refuses to change which switch controls GitHub writes.
      assert.ok(error instanceof HookManagedInstallationError);
      review = error.details;
    }
    assert.equal(review?.code, "hook-policy-review-required");
    assert.ok(review?.confirmationIdentity);
    assert.deepEqual(installerTargetSnapshot(projectPath), afterMigration);
    syncHookStates(projectPath, {
      replace: true,
      acceptPolicyChange: true,
      confirmationIdentity: review.confirmationIdentity,
    });
    const reviewedChoices = readPolicyChoices(projectPath);
    assert.equal(reviewedChoices["deny-dangerous"], true);
    assert.equal(reviewedChoices["deny-git-mutations"], false);
    const beforeInstall = installerTargetSnapshot(projectPath);
    const unapprovedInstall = runCliInstaller(projectPath, "--agent", "codex");
    assert.equal(unapprovedInstall.status, 1, unapprovedInstall.stderr);
    assert.match(
      unapprovedInstall.stderr,
      /\.goat-flow\/\.gitignore \[unmanaged\]/u,
    );
    assert.deepEqual(installerTargetSnapshot(projectPath), beforeInstall);
    // Sync's new ignore rules are outside the old receipt; the user must separately approve this named file replacement.
    const firstInstall = runCliInstaller(
      projectPath,
      "--agent",
      "codex",
      "--force-path",
      ".goat-flow/.gitignore",
    );
    assert.equal(
      firstInstall.status,
      0,
      firstInstall.stderr || firstInstall.stdout,
    );
    const installedHooks = readFileSync(
      join(projectPath, ".codex/hooks.json"),
      "utf8",
    );
    assert.ok(installedHooks.includes("deny-dangerous.sh"));
    assert.ok(installedHooks.includes("deny-git-mutations.sh"));
    assert.ok(
      existsSync(join(projectPath, ".goat-flow/state/install/codex.json")),
    );
    const repeatedInstall = runCliInstaller(projectPath, "--agent", "codex");
    assert.equal(
      repeatedInstall.status,
      0,
      repeatedInstall.stderr || repeatedInstall.stdout,
    );
    assert.equal(
      readFileSync(join(projectPath, ".codex/hooks.json"), "utf8"),
      installedHooks,
    );
    assert.deepEqual(readPolicyChoices(projectPath), reviewedChoices);
  });
});

describe("explicit state-only install recovery", () => {
  // Each incompatible request must be rejected before even the legacy bookkeeping moves.
  for (const incompatibleFlags of [
    ["--dry-run"],
    ["--force"],
    ["--force-managed"],
    ["--force-path", "notes.txt"],
    ["--force-user-owned", "--force-path", "notes.txt"],
    ["--update-config-version"],
    ["--clean-deprecated"],
  ]) {
    it(`refuses state-only recovery with ${incompatibleFlags.join(" ")}`, () => {
      const projectPath = pendingPolicyUpgradeProject();
      mkdirSync(join(projectPath, ".goat-flow/install-state"));
      const before = installerTargetSnapshot(projectPath);
      const result = runCliInstaller(
        projectPath,
        "--agent",
        "codex",
        "--migrate-state-only",
        ...incompatibleFlags,
      );
      assert.equal(result.status, 2, result.stderr);
      assert.match(result.stderr, /--migrate-state-only cannot be combined/u);
      assert.deepEqual(installerTargetSnapshot(projectPath), before);
    });
  }

  // Recovery belongs to install; another command must never inherit a request to move project state.
  for (const command of ["audit", "setup"]) {
    it(`rejects the migration-only flag on ${command}`, () => {
      const projectPath = pendingPolicyUpgradeProject();
      const before = installerTargetSnapshot(projectPath);
      const result = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          join(PROJECT_ROOT, "src/cli/cli.ts"),
          command,
          projectPath,
          "--agent",
          "codex",
          "--migrate-state-only",
        ],
        { cwd: PROJECT_ROOT, encoding: "utf8" },
      );
      assert.equal(result.status, 2, result.stderr);
      assert.match(
        result.stderr,
        /--migrate-state-only is only valid for install/u,
      );
      assert.deepEqual(installerTargetSnapshot(projectPath), before);
    });
  }

  // A new project and an already migrated project both need a harmless repeated recovery action.
  for (const stateDirectory of [".goat-flow", ".goat-flow/state/install"]) {
    it(`leaves ${stateDirectory} unchanged when no legacy state exists`, () => {
      const projectPath = makeTempProject();
      mkdirSync(join(projectPath, stateDirectory), { recursive: true });
      const before = installerTargetSnapshot(projectPath);
      const result = runCliInstaller(
        projectPath,
        "--agent",
        "codex",
        "--migrate-state-only",
      );
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /No legacy local state requires migration/u);
      assert.deepEqual(installerTargetSnapshot(projectPath), before);
    });
  }

  // Existing migration checks still protect the user's evidence when install-file admission is intentionally omitted.
  for (const refusal of [
    "malformed receipt",
    "competing storage",
    "legacy claim",
    "current claim",
  ]) {
    it(`preserves all files when state-only migration finds ${refusal}`, () => {
      const projectPath = pendingPolicyUpgradeProject();
      mkdirSync(join(projectPath, ".goat-flow/install-state"));
      // Each fixture creates the actual invalid state named in the user's recovery error.
      switch (refusal) {
        case "malformed receipt":
          writeFileSync(
            join(projectPath, ".goat-flow/install-state/codex.json"),
            "invalid JSON\n",
          );
          break;
        case "competing storage":
          mkdirSync(join(projectPath, ".goat-flow/state/install"), {
            recursive: true,
          });
          break;
        case "legacy claim":
          mkdirSync(join(projectPath, ".goat-flow/write-claims"));
          writeFileSync(
            join(projectPath, ".goat-flow/write-claims/active.json"),
            "owned claim\n",
          );
          break;
        case "current claim":
          mkdirSync(join(projectPath, ".goat-flow/state/locks"), {
            recursive: true,
          });
          writeFileSync(
            join(projectPath, ".goat-flow/state/locks/active.json"),
            "owned claim\n",
          );
          break;
      }
      const before = installerTargetSnapshot(projectPath);
      const result = runCliInstaller(
        projectPath,
        "--agent",
        "codex",
        "--migrate-state-only",
      );
      assert.equal(result.status, 1, result.stderr);
      assert.deepEqual(installerTargetSnapshot(projectPath), before);
      assert.doesNotMatch(result.stdout, /Local state migrated/u);
    });
  }
});

/**
 * Copy the minimum installer package into a disposable root with no installed dependencies.
 *
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
 *
 * @param packageRoot - non-empty disposable package root containing the installer but no `node_modules`
 * @param targetProjectPath - non-empty disposable project that must stay unchanged on preflight failure
 *
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
  it("retains both off policy registrations and portable dependencies across repeated installation", () => {
    const root = makeTempProject();
    mkdirSync(join(root, ".goat-flow"));
    writeFileSync(
      join(root, ".goat-flow/config.yaml"),
      "hooks: {deny-dangerous: {enabled: false}, deny-git-mutations: {enabled: false}}\n",
    );
    let previous: string | undefined;
    // Repeat setup to prove current provider config stays stable after its first completed install.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = runInstaller(root, "--agent", "codex");
      assert.equal(result.status, 0, result.stderr || result.stdout);
      const config = readFileSync(join(root, ".codex/hooks.json"), "utf8");
      // Once the first config is captured, later setup must retain the same bytes.
      if (previous !== undefined) assert.equal(config, previous);
      previous = config;
      // Both policy launchers must be present and replay successfully after setup.
      for (const hookId of ["deny-dangerous", "deny-git-mutations"]) {
        assert.ok(config.includes(`${hookId}.sh`));
        const launch = spawnSync(
          process.execPath,
          [
            join(root, ".goat-flow/hooks/run-with-bash.mjs"),
            `.goat-flow/hooks/${hookId}.sh`,
            "policy",
          ],
          {
            cwd: root,
            input: '{"tool_name":"Bash","tool_input":{"command":"git status"}}',
            encoding: "utf8",
          },
        );
        assert.equal(launch.status, 0, launch.stderr);
        assert.equal(launch.stdout, "");
        assert.equal(launch.stderr, "");
      }
      assert.equal(existsSync(join(root, "node_modules")), false);
      // The installed choice reader and parser must exist before provider hooks can read the user's saved switches.
      for (const name of ["hook-policy-state.cjs", "vendor/js-yaml.cjs"])
        assert.equal(existsSync(join(root, ".goat-flow/hooks", name)), true);
    }
  });

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
        join(targetProjectPath, ".goat-flow", "state", "install", "codex.json"),
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
        join(targetProjectPath, ".goat-flow", "state", "install", "codex.json"),
      ),
      false,
    );
  });
});
