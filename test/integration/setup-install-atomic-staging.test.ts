/**
 * Atomic installer staging fixtures for the failure cases users cannot safely reproduce in-place.
 * These tests run the real Bash installer against disposable projects, replace only child-process
 * commands, and prove existing bytes survive copy, signal, rename, and symlink failures.
 * Use this suite when changing installer write, cleanup, or destination-safety behavior.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import {
  makeTempProject,
  runInstaller,
  runInstallerWithEnvironment,
} from "./setup-install.helpers.js";

const STAGING_NAME_FRAGMENT = ".goat-flow-stage.";

/**
 * Install a command wrapper that changes one child-process boundary without changing production code.
 * Use it to reproduce what a user sees when copy or rename stops partway through installation.
 */
function writeCommandWrapper(
  wrapperDirectory: string,
  commandName: "cp" | "mktemp" | "mv",
  scriptBody: string,
): void {
  mkdirSync(wrapperDirectory, { recursive: true });
  const wrapperPath = join(wrapperDirectory, commandName);
  writeFileSync(wrapperPath, scriptBody, "utf-8");
  chmodSync(wrapperPath, 0o755);
}

/**
 * Return installer-owned staging paths still visible to a user after the process exits.
 * An empty result means the target has no interrupted payload for the user to clean manually.
 */
function findStagingArtifacts(projectPath: string): string[] {
  return readdirSync(projectPath, { recursive: true, encoding: "utf-8" })
    .map(String)
    .filter((relativePath) => relativePath.includes(STAGING_NAME_FRAGMENT));
}

/** Run one successful Codex install so a failure fixture starts with real user-visible bytes. */
function installCodexFixture(projectPath: string): void {
  const initialInstall = runInstaller(projectPath, "--agent", "codex");
  assert.equal(
    initialInstall.status,
    0,
    initialInstall.stderr || initialInstall.stdout,
  );
}

/** Add a wrapper directory before the user's existing PATH without changing the parent process. */
function environmentWithWrapper(wrapperDirectory: string): NodeJS.ProcessEnv {
  return {
    PATH: `${wrapperDirectory}:${process.env.PATH ?? ""}`,
  };
}

describe("installer atomic staging", () => {
  it("atomically replaces an existing supported system file without leaving staging artifacts", () => {
    const projectPath = makeTempProject();
    installCodexFixture(projectPath);
    const managedReadmePath = join(
      projectPath,
      ".goat-flow",
      "logs",
      "quality",
      "README.md",
    );
    writeFileSync(managedReadmePath, "previous managed bytes\n", "utf-8");

    const reinstall = runInstaller(projectPath, "--agent", "codex");

    assert.equal(reinstall.status, 0, reinstall.stderr || reinstall.stdout);
    assert.notEqual(
      readFileSync(managedReadmePath, "utf-8"),
      "previous managed bytes\n",
    );
    assert.deepEqual(findStagingArtifacts(projectPath), []);
  });

  // Fixture purpose: writes disposable files and spawns a failing staged copy to prove old bytes survive.
  it("preserves the previous destination and cleans staging when payload copy fails", () => {
    const projectPath = makeTempProject();
    installCodexFixture(projectPath);
    const managedGitignorePath = join(projectPath, ".goat-flow", ".gitignore");
    const previousBytes = Buffer.from("previous managed bytes\n");
    writeFileSync(managedGitignorePath, previousBytes);
    const wrapperDirectory = join(makeTempProject(), "bin");
    writeCommandWrapper(
      wrapperDirectory,
      "cp",
      `#!/usr/bin/env bash
# A staged destination means the user is between payload creation and replacement.
if [[ "\${!#}" == *"${STAGING_NAME_FRAGMENT}"* ]]; then
  printf 'simulated staging copy failure\n' >&2
  exit 71
fi
exec /bin/cp "$@"
`,
    );

    const failedInstall = runInstallerWithEnvironment(
      projectPath,
      environmentWithWrapper(wrapperDirectory),
      "--agent",
      "codex",
    );

    assert.notEqual(failedInstall.status, 0);
    assert.match(failedInstall.stderr, /staging copy failed/u);
    assert.deepEqual(readFileSync(managedGitignorePath), previousBytes);
    assert.deepEqual(findStagingArtifacts(projectPath), []);
  });

  // Fixture purpose: writes old bytes and spawns failed staging creation to prove they stay visible.
  it("preserves the previous destination when staging directory creation fails", () => {
    const projectPath = makeTempProject();
    installCodexFixture(projectPath);
    const managedGitignorePath = join(projectPath, ".goat-flow", ".gitignore");
    const previousBytes = Buffer.from("previous managed bytes\n");
    writeFileSync(managedGitignorePath, previousBytes);
    const wrapperDirectory = join(makeTempProject(), "bin");
    writeCommandWrapper(
      wrapperDirectory,
      "mktemp",
      `#!/usr/bin/env bash
# The adjacent marker identifies staging creation without affecting unrelated temp use.
if [[ "\${!#}" == *"${STAGING_NAME_FRAGMENT}"* ]]; then
  printf 'simulated staging directory failure\n' >&2
  exit 70
fi
exec /usr/bin/mktemp "$@"
`,
    );

    const failedInstall = runInstallerWithEnvironment(
      projectPath,
      environmentWithWrapper(wrapperDirectory),
      "--agent",
      "codex",
    );

    assert.notEqual(failedInstall.status, 0);
    assert.match(
      failedInstall.stderr,
      /could not create adjacent staging directory/u,
    );
    assert.deepEqual(readFileSync(managedGitignorePath), previousBytes);
    assert.deepEqual(findStagingArtifacts(projectPath), []);
  });

  // Fixture purpose: writes a partial payload and interrupts the installer to prove old bytes survive.
  it("preserves the previous destination and cleans partial staging after interruption", () => {
    const projectPath = makeTempProject();
    installCodexFixture(projectPath);
    const managedGitignorePath = join(projectPath, ".goat-flow", ".gitignore");
    const previousBytes = Buffer.from("previous managed bytes\n");
    writeFileSync(managedGitignorePath, previousBytes);
    const wrapperDirectory = join(makeTempProject(), "bin");
    writeCommandWrapper(
      wrapperDirectory,
      "cp",
      `#!/usr/bin/env bash
# A staged destination lets this fixture reproduce a user interrupt during partial output.
if [[ "\${!#}" == *"${STAGING_NAME_FRAGMENT}"* ]]; then
  printf 'partial payload' > "\${!#}"
  kill -TERM "$PPID"
  exit 143
fi
exec /bin/cp "$@"
`,
    );

    const interruptedInstall = runInstallerWithEnvironment(
      projectPath,
      environmentWithWrapper(wrapperDirectory),
      "--agent",
      "codex",
    );

    assert.notEqual(interruptedInstall.status, 0);
    assert.deepEqual(readFileSync(managedGitignorePath), previousBytes);
    assert.deepEqual(findStagingArtifacts(projectPath), []);
  });

  // Fixture purpose: writes disposable files and spawns a failed rename to prove no fallback copy appears.
  it("stops without a non-atomic fallback when adjacent rename fails", () => {
    const projectPath = makeTempProject();
    installCodexFixture(projectPath);
    const managedGitignorePath = join(projectPath, ".goat-flow", ".gitignore");
    const previousBytes = Buffer.from("previous managed bytes\n");
    writeFileSync(managedGitignorePath, previousBytes);
    const wrapperDirectory = join(makeTempProject(), "bin");
    writeCommandWrapper(
      wrapperDirectory,
      "mv",
      `#!/usr/bin/env bash
# The staging marker identifies the final atomic rename without affecting legacy migrations.
for commandArgument in "$@"; do
  # A staged payload must stop instead of falling back to a partial destination copy.
  if [[ "$commandArgument" == *"${STAGING_NAME_FRAGMENT}"* ]]; then
    printf 'simulated adjacent rename failure\n' >&2
    exit 72
  fi
done
exec /bin/mv "$@"
`,
    );

    const failedInstall = runInstallerWithEnvironment(
      projectPath,
      environmentWithWrapper(wrapperDirectory),
      "--agent",
      "codex",
    );

    assert.notEqual(failedInstall.status, 0);
    assert.match(failedInstall.stderr, /atomic replacement failed/u);
    assert.deepEqual(readFileSync(managedGitignorePath), previousBytes);
    assert.deepEqual(findStagingArtifacts(projectPath), []);
  });

  it("blocks symlinked destination parents even when force is supplied", () => {
    const projectPath = makeTempProject();
    const redirectedDirectory = makeTempProject();
    const redirectedReadmePath = join(redirectedDirectory, "README.md");
    const outsideBytes = Buffer.from("outside project bytes\n");
    writeFileSync(redirectedReadmePath, outsideBytes);
    mkdirSync(join(projectPath, ".goat-flow", "logs"), { recursive: true });
    symlinkSync(
      redirectedDirectory,
      join(projectPath, ".goat-flow", "logs", "quality"),
      "dir",
    );

    const install = runInstaller(projectPath, "--agent", "codex", "--force");

    assert.notEqual(install.status, 0);
    assert.match(install.stderr, /unsafe installer destination.*symlink/u);
    assert.deepEqual(readFileSync(redirectedReadmePath), outsideBytes);
    assert.deepEqual(findStagingArtifacts(projectPath), []);
  });

  // Fixture purpose: writes an outside sentinel and spawns setup through a root symlink to prove containment.
  it("blocks a symlinked goat-flow root before creating outside directories", () => {
    const projectPath = makeTempProject();
    const redirectedDirectory = makeTempProject();
    const outsideSentinelPath = join(
      redirectedDirectory,
      "outside-sentinel.txt",
    );
    writeFileSync(outsideSentinelPath, "outside project bytes\n", "utf-8");
    const outsidePathsBefore = readdirSync(redirectedDirectory, {
      recursive: true,
      encoding: "utf-8",
    }).map(String);
    symlinkSync(redirectedDirectory, join(projectPath, ".goat-flow"), "dir");

    const install = runInstaller(projectPath, "--agent", "codex", "--force");

    assert.notEqual(install.status, 0);
    assert.deepEqual(
      readdirSync(redirectedDirectory, {
        recursive: true,
        encoding: "utf-8",
      }).map(String),
      outsidePathsBefore,
    );
    assert.equal(
      readFileSync(outsideSentinelPath, "utf-8"),
      "outside project bytes\n",
    );
    assert.match(install.stderr, /unsafe installer directory.*symlink/u);
  });

  // Fixture purpose: writes config bytes and spawns a failed transform rename to prove they remain visible.
  it("keeps config bytes intact when an atomic transform rename fails", () => {
    const projectPath = makeTempProject();
    const configDirectory = join(projectPath, ".goat-flow");
    const configPath = join(configDirectory, "config.yaml");
    const previousBytes = Buffer.from(
      'version: "1.9.0"\n\nagents:\n  - codex\n\nskills:\n  install: all\n',
    );
    mkdirSync(configDirectory, { recursive: true });
    writeFileSync(configPath, previousBytes);
    const wrapperDirectory = join(makeTempProject(), "bin");
    writeCommandWrapper(
      wrapperDirectory,
      "mv",
      `#!/usr/bin/env bash
# The final argument identifies the user config transform after managed copies finish.
if [[ "\${!#}" == ".goat-flow/config.yaml" ]]; then
  printf 'simulated config rename failure\n' >&2
  exit 73
fi
exec /bin/mv "$@"
`,
    );

    const failedInstall = runInstallerWithEnvironment(
      projectPath,
      environmentWithWrapper(wrapperDirectory),
      "--agent",
      "codex",
    );

    assert.notEqual(failedInstall.status, 0);
    assert.match(failedInstall.stderr, /atomic replacement failed/u);
    assert.deepEqual(readFileSync(configPath), previousBytes);
    assert.deepEqual(findStagingArtifacts(projectPath), []);
  });

  // Fixture purpose: writes legacy bytes and spawns a cross-device-style failure to prove source recovery.
  it("keeps a legacy source intact when atomic migration rename is unavailable", () => {
    const projectPath = makeTempProject();
    const legacyDirectory = join(projectPath, ".goat-flow", "footguns");
    const legacyFilePath = join(legacyDirectory, "local-note.md");
    mkdirSync(legacyDirectory, { recursive: true });
    writeFileSync(legacyFilePath, "legacy user bytes\n", "utf-8");
    const wrapperDirectory = join(makeTempProject(), "bin");
    writeCommandWrapper(
      wrapperDirectory,
      "mv",
      `#!/usr/bin/env bash
# Migration helpers add safety flags, so inspect every operand for the legacy source.
for commandArgument in "$@"; do
  # This legacy source reproduces a rename boundary that cannot complete atomically.
  if [[ "$commandArgument" == ".goat-flow/footguns" ]]; then
    printf 'Invalid cross-device link\n' >&2
    exit 18
  fi
done
exec /bin/mv "$@"
`,
    );

    const failedInstall = runInstallerWithEnvironment(
      projectPath,
      environmentWithWrapper(wrapperDirectory),
      "--agent",
      "codex",
    );

    assert.notEqual(failedInstall.status, 0);
    assert.match(failedInstall.stderr, /atomic migration rename failed/u);
    assert.equal(existsSync(legacyFilePath), true);
    assert.equal(
      existsSync(
        join(
          projectPath,
          ".goat-flow",
          "learning-loop",
          "footguns",
          "local-note.md",
        ),
      ),
      false,
    );
    assert.deepEqual(findStagingArtifacts(projectPath), []);
  });
});
