/**
 * Proves an unpublished npm tarball contains a working Codex feedback launcher.
 *
 * The fixture runs real package bytes in disposable consumer projects so source-only success cannot hide a broken release.
 * Use before release; a separate live Codex canary owns provider delivery evidence.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { agentHookSpawnDescriptor } from "../../src/cli/server/agent-hook-command.js";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
const CODEX_GRUFF_LAUNCHER_DEADLINE_MS = 75_000;
const CODEX_GRUFF_HOST_TIMEOUT_SECONDS = 90;
const CODEX_GRUFF_LAUNCH_CONTRACT = `codex:gruff:goat-flow.hook-result.v1:post-tool:1:${CODEX_GRUFF_LAUNCHER_DEADLINE_MS}`;
const disposablePackagePaths: string[] = [];

/** Paths a release test uses to launch archived code without falling back to the source checkout. */
interface PackedCliLaunch {
  packedPackageRoot: string;
  packedCliLaunchPath: string;
}

/** Minimal installed Codex shape needed to replay the exact user-facing deny command. */
interface CodexHookConfiguration {
  hooks?: {
    [eventName: string]: unknown;
    PreToolUse?: Array<{
      hooks?: Array<{ command?: string; commandWindows?: string }>;
    }>;
  };
}

after(() => {
  // Each tarball and extracted consumer is local proof state removed after its checks finish.
  for (const disposablePackagePath of disposablePackagePaths) {
    rmSync(disposablePackagePath, { recursive: true, force: true });
  }
});

/**
 * Create one isolated package workspace and register it for test cleanup.
 * Use when npm pack or extraction must not leave release artifacts in the repository.
 *
 * @param workspaceName - non-empty UI label for the temp prefix; empty would obscure failures
 * @returns Absolute disposable path; never empty after the operating system creates it.
 */
function makeDisposablePackageWorkspace(workspaceName: string): string {
  const disposablePackagePath = mkdtempSync(
    join(tmpdir(), `goat-flow-${workspaceName}-`),
  );
  disposablePackagePaths.push(disposablePackagePath);
  return disposablePackagePath;
}

/**
 * Pack the current candidate without publication and extract its real archived bytes.
 * Use before consumer execution so repository paths cannot satisfy package assertions.
 * Side effects: spawns npm and tar, which write a temporary archive and extracted package.
 *
 * @returns Extracted npm package root; never empty after pack and archive commands succeed.
 */
function extractPackedCandidate(): string {
  const packageWorkspacePath =
    makeDisposablePackageWorkspace("packed-hook-canary");
  const archiveDirectoryPath = join(packageWorkspacePath, "archive");
  const extractedDirectoryPath = join(packageWorkspacePath, "extracted");
  mkdirSync(archiveDirectoryPath, { recursive: true });
  mkdirSync(extractedDirectoryPath, { recursive: true });
  const npmPackArguments = [
    "pack",
    "--json",
    "--ignore-scripts",
    // `npm publish --dry-run` exports npm_config_dry_run=true to prepublishOnly,
    // and a nested pack inherits it: npm still reports a filename it never wrote.
    "--dry-run=false",
    "--pack-destination",
    archiveDirectoryPath,
  ];
  // Native Windows has an npm command shim, so launch its JavaScript entry through Node.
  const npmLaunchCommand =
    process.platform === "win32" ? process.execPath : "npm";
  const npmLaunchArguments =
    process.platform === "win32"
      ? [
          join(
            dirname(process.execPath),
            "node_modules",
            "npm",
            "bin",
            "npm-cli.js",
          ),
          ...npmPackArguments,
        ]
      : npmPackArguments;
  const packResult = spawnSync(npmLaunchCommand, npmLaunchArguments, {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(packResult.status, 0, packResult.stderr || packResult.stdout);
  const packRecords = JSON.parse(packResult.stdout) as Array<{
    filename?: string;
  }>;
  const packedArchiveName = packRecords[0]?.filename ?? "";
  // Empty npm metadata means there is no archived candidate to give a user.
  assert.notEqual(packedArchiveName, "");
  const packedArchivePath = join(
    archiveDirectoryPath,
    basename(packedArchiveName),
  );
  const extractionResult = spawnSync(
    "tar",
    ["-xzf", basename(packedArchivePath), "-C", "../extracted"],
    {
      cwd: archiveDirectoryPath,
      encoding: "utf8",
      timeout: 30_000,
    },
  );
  assert.equal(
    extractionResult.status,
    0,
    extractionResult.stderr || extractionResult.stdout,
  );
  return join(extractedDirectoryPath, "package");
}

/**
 * Prepare the archived package's declared CLI for direct Node execution.
 *
 * POSIX gets an npm-style bin link; Windows uses the declared JavaScript target that Node can launch without a command shim.
 * Use before release; writes disposable package paths and spawns npm and tar before cleanup.
 *
 * @returns Packed package root and launch path; neither is empty after archive validation.
 */
function preparePackedCliLaunch(): PackedCliLaunch {
  const packedPackageRoot = extractPackedCandidate();
  const packedPackageManifest = JSON.parse(
    readFileSync(join(packedPackageRoot, "package.json"), "utf8"),
  ) as { bin?: Record<string, string> };
  // Missing bin metadata means npm users have no goat-flow command to run.
  const packedCliRelativePath = packedPackageManifest.bin?.["goat-flow"] ?? "";
  assert.notEqual(packedCliRelativePath, "");
  const declaredCliEntryPath = join(packedPackageRoot, packedCliRelativePath);
  assert.equal(existsSync(declaredCliEntryPath), true);

  const packedCliWorkspacePath = makeDisposablePackageWorkspace("packed-cli");
  const packedCliBinDirectoryPath = join(
    packedCliWorkspacePath,
    "node_modules",
    ".bin",
  );
  mkdirSync(packedCliBinDirectoryPath, { recursive: true });
  // Windows launches the declared JavaScript target; POSIX models the npm-style bin link a shell user receives.
  const packedCliLaunchPath =
    process.platform === "win32"
      ? declaredCliEntryPath
      : join(packedCliBinDirectoryPath, "goat-flow");
  // POSIX package users receive the bin symlink this fixture replays through Node.
  if (process.platform !== "win32") {
    symlinkSync(declaredCliEntryPath, packedCliLaunchPath, "file");
  }
  symlinkSync(
    join(PROJECT_ROOT, "node_modules"),
    join(packedPackageRoot, "node_modules"),
    "junction",
  );
  return { packedPackageRoot, packedCliLaunchPath };
}

/**
 * Spawns the disposable npm-style command exactly where a package user would run it.
 * Use for version, fresh-install, and hook-sync checks against archived CLI bytes.
 *
 * @param packedCliLaunchPath - non-empty bin link or declared JavaScript entry; empty cannot start the package
 * @param cliArguments - user-entered CLI arguments; empty means the package should show its default flow
 * @param workingDirectoryPath - existing user cwd; empty would make root resolution meaningless
 * @returns Captured process result; empty output is valid only when the selected command is silent.
 */
function runPackedCli(
  packedCliLaunchPath: string,
  cliArguments: string[],
  workingDirectoryPath: string,
) {
  return spawnSync(process.execPath, [packedCliLaunchPath, ...cliArguments], {
    cwd: workingDirectoryPath,
    encoding: "utf8",
    timeout: 120_000,
  });
}

/**
 * Read an exact prior-release file for a real upgrade fixture.
 * Use when migration behavior must not be approximated from current source.
 * Side effects: starts a read-only Git process without changing the checkout.
 *
 * @param releaseVersion - release version used to select the exact `v`-prefixed tag
 * @param relativePath - non-empty tagged file path; empty cannot identify prior release bytes
 * @returns Tagged bytes, or `null` when a shallow checkout cannot provide the release fixture.
 */
function readTaggedReleaseFile(
  releaseVersion: string,
  relativePath: string,
): string | null {
  const taggedFileResult = spawnSync(
    "git",
    ["show", `v${releaseVersion}:${relativePath}`],
    {
      cwd: PROJECT_ROOT,
      encoding: "utf8",
    },
  );
  // A shallow checkout cannot claim that an exact tagged migration scenario ran.
  return taggedFileResult.status === 0 ? taggedFileResult.stdout : null;
}

const V1_15_0_CODEX_HOOKS = readTaggedReleaseFile(
  "1.15.0",
  "workflow/hooks/agent-config/codex-hooks.json",
);
const V1_15_0_BASH_RUNNER = readTaggedReleaseFile(
  "1.15.0",
  "workflow/hooks/run-with-bash.mjs",
);
// Missing tagged bytes skips only the unavailable release fixture, never a synthetic substitute.
const V1_15_0_PACKAGE_MIGRATION_UNAVAILABLE =
  V1_15_0_CODEX_HOOKS === null || V1_15_0_BASH_RUNNER === null;
const V1_16_0_CODEX_HOOKS = readTaggedReleaseFile(
  "1.16.0",
  "workflow/hooks/agent-config/codex-hooks.json",
);
const V1_16_0_BASH_RUNNER = readTaggedReleaseFile(
  "1.16.0",
  "workflow/hooks/run-with-bash.mjs",
);
const V1_16_0_PACKAGE_MIGRATION_UNAVAILABLE =
  V1_16_0_CODEX_HOOKS === null || V1_16_0_BASH_RUNNER === null;

/**
 * Read the exact deny command a Codex user receives after install or sync.
 * Use before replaying safe and dangerous shell requests through configured policy.
 *
 * @param targetProjectPath - non-empty installed project root; empty has no Codex configuration
 * @returns Configured shell descriptor; its cross-platform command is never empty after a successful managed installation.
 */
function readInstalledCodexDenyHandler(targetProjectPath: string): {
  command: string;
  commandWindows?: string;
} {
  const installedHookConfiguration = JSON.parse(
    readFileSync(join(targetProjectPath, ".codex", "hooks.json"), "utf8"),
  ) as CodexHookConfiguration;
  // Empty registration means the package left the user's shell without the managed deny guard.
  const installedDenyHandler =
    installedHookConfiguration.hooks?.PreToolUse?.[0]?.hooks?.[0];
  assert.equal(typeof installedDenyHandler?.command, "string");
  return {
    command: installedDenyHandler.command,
    ...(typeof installedDenyHandler.commandWindows === "string"
      ? { commandWindows: installedDenyHandler.commandWindows }
      : {}),
  };
}

/**
 * Replay the user's installed policy command and prove safe work passes while danger blocks.
 * Use after fresh install or migration so direct-script success cannot hide stale registration.
 * Side effects: starts two bounded policy processes; the submitted shell text is classified, not run.
 *
 * @param targetProjectPath - non-empty installed project root; empty cannot resolve managed hooks
 * @returns Nothing; failed policy outcomes throw assertions with captured user-facing output.
 */
function assertInstalledCodexPolicy(targetProjectPath: string): void {
  const installedDenyHandler = readInstalledCodexDenyHandler(targetProjectPath);
  const platformDenyLaunch = agentHookSpawnDescriptor({
    form: "shell",
    ...installedDenyHandler,
  });
  const safePolicyResult = spawnSync(
    platformDenyLaunch.command,
    platformDenyLaunch.args,
    {
      cwd: targetProjectPath,
      encoding: "utf8",
      input: JSON.stringify({
        tool_name: "Bash",
        tool_input: { command: "echo safe" },
      }),
      timeout: 30_000,
    },
  );
  assert.equal(
    safePolicyResult.status,
    0,
    safePolicyResult.stderr || safePolicyResult.stdout,
  );

  const dangerousPolicyResult = spawnSync(
    platformDenyLaunch.command,
    platformDenyLaunch.args,
    {
      cwd: targetProjectPath,
      encoding: "utf8",
      input: JSON.stringify({
        tool_name: "Bash",
        tool_input: { command: "rm -rf /" },
      }),
      timeout: 30_000,
    },
  );
  assert.equal(dangerousPolicyResult.status, 2);
  assert.match(dangerousPolicyResult.stderr, /BLOCKED:/u);
}

/**
 * Writes only packed hook bytes and one stalling analyzer into a disposable consumer.
 * Use to prove the canary cannot fall back to source-checkout launcher modules.
 *
 * @param packedPackageRoot - non-empty extracted package root; empty has no archived hooks
 * @param disposableConsumerPath - non-empty consumer root; empty would escape fixture ownership
 * @returns Absolute packed launcher path; never empty after archived bytes are copied.
 */
function installPackedCanaryBytes(
  packedPackageRoot: string,
  disposableConsumerPath: string,
): string {
  const installedHookDirectoryPath = join(
    disposableConsumerPath,
    ".goat-flow",
    "hooks",
  );
  mkdirSync(installedHookDirectoryPath, { recursive: true });
  cpSync(
    join(packedPackageRoot, "workflow", "hooks", "run-with-bash.mjs"),
    join(installedHookDirectoryPath, "run-with-bash.mjs"),
  );
  cpSync(
    join(packedPackageRoot, "workflow", "hooks", "hook-provider-adapters.mjs"),
    join(installedHookDirectoryPath, "hook-provider-adapters.mjs"),
  );
  cpSync(
    join(packedPackageRoot, "workflow", "hooks", "hook-launch-runtime.mjs"),
    join(installedHookDirectoryPath, "hook-launch-runtime.mjs"),
  );
  writeFileSync(
    join(installedHookDirectoryPath, "canary-stall.sh"),
    [
      "#!/usr/bin/env bash",
      "# Simulates packaged analyzer work that exceeds the user's feedback deadline.",
      "# Keeps the child alive so archived launcher bytes must stop it and explain why.",
      "# Use only inside this disposable package installation canary.",
      "sleep 5",
      "",
    ].join("\n"),
  );
  return join(installedHookDirectoryPath, "run-with-bash.mjs");
}

/**
 * Spawns packed launcher bytes with a short test-only deadline and captures Codex output.
 * Use to compare archived behavior with the source consumer's user-visible result.
 *
 * @param disposableConsumerPath - non-empty installed consumer root; empty cannot resolve hooks
 * @param packedLauncherPath - non-empty archived launcher path; empty cannot start Node
 * @returns Child-process evidence; empty stdout means packed users receive no feedback.
 */
function runPackedDeadlineCanary(
  disposableConsumerPath: string,
  packedLauncherPath: string,
) {
  return spawnSync(
    process.execPath,
    [
      packedLauncherPath,
      ".goat-flow/hooks/canary-stall.sh",
      CODEX_GRUFF_LAUNCH_CONTRACT,
    ],
    {
      cwd: disposableConsumerPath,
      encoding: "utf8",
      env: {
        ...process.env,
        GOAT_FLOW_HOOK_LAUNCH_TIMEOUT_MS: "25",
      },
      timeout: 2_000,
    },
  );
}

describe("packaged hook installation canary", () => {
  // An npm consumer must receive the same explicit deadline context as the source candidate.
  it("delivers Codex deadline feedback from archived launcher bytes", () => {
    const packedPackageRoot = extractPackedCandidate();
    const disposableConsumerPath =
      makeDisposablePackageWorkspace("packed-consumer");
    const packedLauncherPath = installPackedCanaryBytes(
      packedPackageRoot,
      disposableConsumerPath,
    );

    assert.equal(
      readFileSync(packedLauncherPath, "utf8"),
      readFileSync(
        join(PROJECT_ROOT, "workflow", "hooks", "run-with-bash.mjs"),
        "utf8",
      ),
      "npm archive must contain the candidate launcher bytes",
    );
    assert.equal(
      readFileSync(
        join(
          disposableConsumerPath,
          ".goat-flow",
          "hooks",
          "hook-provider-adapters.mjs",
        ),
        "utf8",
      ),
      readFileSync(
        join(PROJECT_ROOT, "workflow", "hooks", "hook-provider-adapters.mjs"),
        "utf8",
      ),
      "npm archive must contain the candidate provider adapter bytes",
    );
    assert.equal(
      readFileSync(
        join(
          disposableConsumerPath,
          ".goat-flow",
          "hooks",
          "hook-launch-runtime.mjs",
        ),
        "utf8",
      ),
      readFileSync(
        join(PROJECT_ROOT, "workflow", "hooks", "hook-launch-runtime.mjs"),
        "utf8",
      ),
      "npm archive must contain the candidate launch runtime bytes",
    );

    const canaryResult = runPackedDeadlineCanary(
      disposableConsumerPath,
      packedLauncherPath,
    );
    assert.equal(canaryResult.status, 0, canaryResult.stderr);
    assert.equal(canaryResult.signal, null);
    // Empty packed stdout would mean source proof hid a release artifact failure.
    assert.notEqual(canaryResult.stdout.trim(), "");
    const providerResponse = JSON.parse(canaryResult.stdout) as {
      hookSpecificOutput?: {
        hookEventName?: string;
        additionalContext?: string;
      };
    };
    const modelVisibleContext =
      providerResponse.hookSpecificOutput?.additionalContext ?? "";
    // Empty context means a package user cannot see why analyzer feedback was skipped.
    assert.notEqual(modelVisibleContext, "");
    assert.equal(
      providerResponse.hookSpecificOutput?.hookEventName,
      "PostToolUse",
    );
    assert.match(modelVisibleContext, /gruff-code-quality: UNAVAILABLE/u);
    assert.match(modelVisibleContext, /execution-timeout/u);
    assert.match(
      modelVisibleContext,
      /hook exceeded its deadline; process-tree termination was requested/u,
    );
    assert.equal(canaryResult.stderr, "");
    assert.ok(
      CODEX_GRUFF_LAUNCHER_DEADLINE_MS <
        CODEX_GRUFF_HOST_TIMEOUT_SECONDS * 1_000,
      "packed registration must leave Codex time to render feedback",
    );
  });

  // A new user must be able to install and run the archived CLI even when CI has no historical Git tags.
  it("runs fresh install through the archived CLI bin", () => {
    const { packedPackageRoot, packedCliLaunchPath } = preparePackedCliLaunch();
    const packedVersionResult = runPackedCli(
      packedCliLaunchPath,
      ["--version"],
      packedPackageRoot,
    );
    assert.equal(
      packedVersionResult.status,
      0,
      packedVersionResult.stderr || packedVersionResult.stdout,
    );
    assert.equal(packedVersionResult.stdout.trim(), "goat-flow v1.17.0");

    const freshProjectPath = makeDisposablePackageWorkspace("fresh-non-git");
    const freshInstallResult = runPackedCli(
      packedCliLaunchPath,
      ["install", freshProjectPath, "--agent", "codex"],
      freshProjectPath,
    );
    assert.equal(
      freshInstallResult.status,
      0,
      freshInstallResult.stderr || freshInstallResult.stdout,
    );
    assert.equal(existsSync(join(freshProjectPath, ".git")), false);
    assert.equal(
      readFileSync(
        join(freshProjectPath, ".goat-flow", "hooks", "run-with-bash.mjs"),
        "utf8",
      ),
      readFileSync(
        join(packedPackageRoot, "workflow", "hooks", "run-with-bash.mjs"),
        "utf8",
      ),
    );
    assertInstalledCodexPolicy(freshProjectPath);
  });

  // The release gate combines a fresh archived install with the exact direct-predecessor sync users will run.
  it(
    "runs fresh install and 1.16.0 sync through the archived CLI bin",
    { skip: V1_16_0_PACKAGE_MIGRATION_UNAVAILABLE },
    () => {
      // The skip above handles shallow clones; release proof preflights both tagged objects before selecting this case.
      assert.ok(V1_16_0_CODEX_HOOKS);
      assert.ok(V1_16_0_BASH_RUNNER);
      const { packedPackageRoot, packedCliLaunchPath } =
        preparePackedCliLaunch();
      const packedVersionResult = runPackedCli(
        packedCliLaunchPath,
        ["--version"],
        packedPackageRoot,
      );
      assert.equal(
        packedVersionResult.status,
        0,
        packedVersionResult.stderr || packedVersionResult.stdout,
      );
      assert.equal(packedVersionResult.stdout.trim(), "goat-flow v1.17.0");

      const freshProjectPath = makeDisposablePackageWorkspace(
        "fresh-direct-predecessor",
      );
      const freshInstallResult = runPackedCli(
        packedCliLaunchPath,
        ["install", freshProjectPath, "--agent", "codex"],
        freshProjectPath,
      );
      assert.equal(
        freshInstallResult.status,
        0,
        freshInstallResult.stderr || freshInstallResult.stdout,
      );
      assertInstalledCodexPolicy(freshProjectPath);

      const upgradedProjectPath =
        makeDisposablePackageWorkspace("upgrade-1-16-0");
      mkdirSync(join(upgradedProjectPath, ".codex"), { recursive: true });
      mkdirSync(join(upgradedProjectPath, ".goat-flow", "hooks"), {
        recursive: true,
      });
      const taggedHookConfiguration = JSON.parse(
        V1_16_0_CODEX_HOOKS,
      ) as CodexHookConfiguration;
      assert.ok(taggedHookConfiguration.hooks);
      const userOwnedSibling = [{ command: "node custom-user-hook.mjs" }];
      taggedHookConfiguration.hooks.CustomEvent = userOwnedSibling;
      const predecessorHookBytes = `${JSON.stringify(taggedHookConfiguration, null, 2)}\n`;
      writeFileSync(
        join(upgradedProjectPath, ".codex", "hooks.json"),
        predecessorHookBytes,
      );
      writeFileSync(
        join(upgradedProjectPath, ".goat-flow", "hooks", "run-with-bash.mjs"),
        V1_16_0_BASH_RUNNER,
      );

      const migrationResult = runPackedCli(
        packedCliLaunchPath,
        ["hooks", "sync", upgradedProjectPath],
        upgradedProjectPath,
      );
      assert.equal(
        migrationResult.status,
        0,
        migrationResult.stderr || migrationResult.stdout,
      );
      const installedHookBytes = readFileSync(
        join(upgradedProjectPath, ".codex", "hooks.json"),
        "utf8",
      );
      assert.notEqual(installedHookBytes, predecessorHookBytes);
      const installedHookConfiguration = JSON.parse(
        installedHookBytes,
      ) as CodexHookConfiguration;
      assert.deepEqual(
        installedHookConfiguration.hooks?.CustomEvent,
        userOwnedSibling,
      );
      const packedBashRunner = readFileSync(
        join(packedPackageRoot, "workflow", "hooks", "run-with-bash.mjs"),
        "utf8",
      );
      assert.notEqual(packedBashRunner, V1_16_0_BASH_RUNNER);
      assert.equal(
        readFileSync(
          join(upgradedProjectPath, ".goat-flow", "hooks", "run-with-bash.mjs"),
          "utf8",
        ),
        packedBashRunner,
      );
      assert.equal(
        typeof readInstalledCodexDenyHandler(upgradedProjectPath)
          .commandWindows,
        "string",
      );
      assertInstalledCodexPolicy(upgradedProjectPath);
    },
  );

  // Existing 1.15.0 users get migration proof only when the exact released fixture is available.
  it(
    "syncs a 1.15.0 install through the archived CLI bin",
    { skip: V1_15_0_PACKAGE_MIGRATION_UNAVAILABLE },
    () => {
      // The skip above handles shallow clones; these assertions narrow the exact tagged bytes.
      assert.ok(V1_15_0_CODEX_HOOKS);
      assert.ok(V1_15_0_BASH_RUNNER);
      const { packedPackageRoot, packedCliLaunchPath } =
        preparePackedCliLaunch();
      const upgradedProjectPath =
        makeDisposablePackageWorkspace("upgrade-1-15-0");
      mkdirSync(join(upgradedProjectPath, ".codex"), { recursive: true });
      mkdirSync(join(upgradedProjectPath, ".goat-flow", "hooks"), {
        recursive: true,
      });
      writeFileSync(
        join(upgradedProjectPath, ".codex", "hooks.json"),
        V1_15_0_CODEX_HOOKS,
      );
      writeFileSync(
        join(upgradedProjectPath, ".goat-flow", "hooks", "run-with-bash.mjs"),
        V1_15_0_BASH_RUNNER,
      );
      const migrationResult = runPackedCli(
        packedCliLaunchPath,
        ["hooks", "sync", upgradedProjectPath],
        upgradedProjectPath,
      );
      assert.equal(
        migrationResult.status,
        0,
        migrationResult.stderr || migrationResult.stdout,
      );
      assert.equal(existsSync(join(upgradedProjectPath, ".git")), false);
      assert.notEqual(
        readFileSync(join(upgradedProjectPath, ".codex", "hooks.json"), "utf8"),
        V1_15_0_CODEX_HOOKS,
      );
      assert.equal(
        readFileSync(
          join(upgradedProjectPath, ".goat-flow", "hooks", "run-with-bash.mjs"),
          "utf8",
        ),
        readFileSync(
          join(packedPackageRoot, "workflow", "hooks", "run-with-bash.mjs"),
          "utf8",
        ),
      );
      assertInstalledCodexPolicy(upgradedProjectPath);
    },
  );
});
