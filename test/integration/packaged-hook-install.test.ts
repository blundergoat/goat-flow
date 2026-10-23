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
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import { restrictedConsumerEnvironment } from "../helpers/restricted-consumer-env.js";
import {
  inspectPathWriteClaim,
  removeConfirmedAbandonedPathWriteClaim,
} from "../../src/cli/path-write-claim.js";
import { pathToFileURL } from "node:url";
import { readPolicyChoices } from "../../workflow/hooks/hook-policy-state.cjs";
import { loadConfig } from "../../src/cli/config/index.js";
import { agentHookSpawnDescriptor } from "../../src/cli/server/agent-hook-command.js";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
const PACKAGE_VERSION = (
  JSON.parse(readFileSync(join(PROJECT_ROOT, "package.json"), "utf8")) as {
    version: string;
  }
).version;
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
 *
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
 *
 * @param workingDirectoryPath - existing user cwd; empty would make root resolution meaningless
 * @returns Captured process result; empty output is valid only when the selected command is silent.
 */
function runPackedCli(
  packedCliLaunchPath: string,
  cliArguments: string[],
  workingDirectoryPath: string,
  environment: NodeJS.ProcessEnv = process.env,
) {
  return spawnSync(process.execPath, [packedCliLaunchPath, ...cliArguments], {
    cwd: workingDirectoryPath,
    encoding: "utf8",
    env: environment,
    timeout: 120_000,
  });
}

/**
 * Review an old launcher with no recorded install history before the packed CLI can sync it.
 *
 * Use the archived dashboard handler for consent, then prove the public CLI converges without another review.
 * Starts child processes that replace reviewed files in the disposable project.
 *
 * @param packedPackageRoot - extracted package whose handler performs the review; empty cannot locate that handler
 * @param packedCliLaunchPath - archived CLI entry; empty cannot start the user's Sync command
 *
 * @param projectPath - existing disposable install; empty would lose the selected-project boundary
 * @returns final CLI result; empty output is valid when Sync finishes silently
 */
function reviewAndSyncPackedHooks(
  packedPackageRoot: string,
  packedCliLaunchPath: string,
  projectPath: string,
) {
  const priorFiles = [
    ".codex/hooks.json",
    ".goat-flow/hooks/hook-launch-runtime.mjs",
  ];
  const priorBytes = priorFiles.map((file) =>
    readFileSync(join(projectPath, file)),
  );
  const refused = runPackedCli(
    packedCliLaunchPath,
    ["hooks", "sync", projectPath],
    projectPath,
  );
  assert.equal(refused.status, 1, refused.stderr || refused.stdout);
  assert.match(refused.stderr, /review and explicitly replace/u);
  // Asking for review must preserve the user's launcher and provider configuration.
  for (const [index, file] of priorFiles.entries()) {
    assert.deepEqual(readFileSync(join(projectPath, file)), priorBytes[index]);
  }
  const registrarUrl = pathToFileURL(
    join(packedPackageRoot, "dist/cli/server/hook-registrar.js"),
  ).href;
  const reviewed = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import assert from "node:assert/strict";
    const { syncHookStates } = await import(${JSON.stringify(registrarUrl)});
    const projectPath = ${JSON.stringify(projectPath)};
    let review;
    // An old launcher without recorded install history requires the user's replacement review.
    try { syncHookStates(projectPath); } catch (error) { review = error.details; }
    assert.equal(review?.code, "hook-replacement-required");
    assert.deepEqual(review.paths, [".goat-flow/hooks/hook-launch-runtime.mjs"]);
    assert.equal(review.replacementAvailable, true);
    syncHookStates(projectPath, { replace: true, confirmationIdentity: review.confirmationIdentity });
  `,
    ],
    { cwd: projectPath, encoding: "utf8", timeout: 120_000 },
  );
  assert.equal(reviewed.status, 0, reviewed.stderr || reviewed.stdout);
  return runPackedCli(
    packedCliLaunchPath,
    ["hooks", "sync", projectPath],
    projectPath,
  );
}

/**
 * Read an exact prior-release file for a real upgrade fixture.
 *
 * Use when migration behavior must not be approximated from current source.
 * Side effects: starts a read-only Git process without changing the checkout.
 *
 * @param releaseVersion - release version used to select the exact `v`-prefixed tag
 *
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
const V1_16_0_LAUNCH_RUNTIME = readTaggedReleaseFile(
  "1.16.0",
  "workflow/hooks/hook-launch-runtime.mjs",
);
const V1_16_0_PACKAGE_MIGRATION_UNAVAILABLE =
  V1_16_0_CODEX_HOOKS === null ||
  V1_16_0_BASH_RUNNER === null ||
  V1_16_0_LAUNCH_RUNTIME === null;

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
  // Reviewed registration order belongs to Codex trust; locate the general policy by its owned script.
  const installedDenyHandler =
    installedHookConfiguration.hooks?.PreToolUse?.flatMap(
      (entry) => entry.hooks ?? [],
    ).find((handler) => handler.command?.includes("deny-dangerous.mjs"));
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
 *
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
 *
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
 *
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
    assert.equal(
      packedVersionResult.stdout.trim(),
      `goat-flow v${PACKAGE_VERSION}`,
    );

    const freshProjectPath = makeDisposablePackageWorkspace("fresh-non-git");
    const restricted = restrictedConsumerEnvironment(
      makeDisposablePackageWorkspace("install-process-proof"),
    );
    const freshInstallResult = runPackedCli(
      packedCliLaunchPath,
      ["install", freshProjectPath, "--agent", "codex"],
      freshProjectPath,
      restricted,
    );
    assert.equal(
      freshInstallResult.status,
      0,
      freshInstallResult.stderr || freshInstallResult.stdout,
    );
    assert.equal(existsSync(join(freshProjectPath, ".git")), false);
    assert.equal(
      readFileSync(
        join(freshProjectPath, ".goat-flow", "hooks", "run-hook.mjs"),
        "utf8",
      ),
      readFileSync(
        join(packedPackageRoot, "workflow", "hooks", "run-hook.mjs"),
        "utf8",
      ),
    );
    const corpusPath = ".goat-flow/hooks/deny-dangerous/corpus.json";
    assert.deepEqual(
      readFileSync(join(freshProjectPath, corpusPath)),
      readFileSync(
        join(packedPackageRoot, "workflow/hooks/deny-dangerous/corpus.json"),
      ),
      "archive consumers receive declared corpus bytes without checkout fallback",
    );
    assert.equal(
      existsSync(join(packedPackageRoot, "test/fixtures/hooks-bash")),
      false,
    );
    assertInstalledCodexPolicy(freshProjectPath);
    for (const [command, status] of [
      ["echo safe", 0],
      ["rm -rf /", 2],
    ] as const) {
      const candidate = spawnSync(
        process.execPath,
        [
          join(freshProjectPath, ".goat-flow/hooks/deny-dangerous.mjs"),
          "--root",
          freshProjectPath,
        ],
        {
          cwd: freshProjectPath,
          env: restricted,
          encoding: "utf8",
          input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }),
        },
      );
      assert.equal(
        candidate.status,
        status,
        candidate.stderr || candidate.stdout,
      );
    }
    const journal = readFileSync(restricted.GOAT_TEST_SPAWN_LOG ?? "", "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { event: string });
    assert.ok(journal.some((entry) => entry.event === "loaded"));
    assert.equal(
      journal.filter((entry) => entry.event === "denied").length,
      0,
      "archived installer and candidate policy must launch no shell tools",
    );
  });

  // Retain exact 1.16.0 launcher migration and user-owned rows alongside a fresh archived install.
  it(
    "runs fresh install and 1.16.0 sync through the archived CLI bin",
    { skip: V1_16_0_PACKAGE_MIGRATION_UNAVAILABLE },
    () => {
      // The skip above handles shallow clones; release proof preflights both tagged objects before selecting this case.
      assert.ok(V1_16_0_CODEX_HOOKS);
      assert.ok(V1_16_0_BASH_RUNNER);
      assert.ok(V1_16_0_LAUNCH_RUNTIME);
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
      assert.equal(
        packedVersionResult.stdout.trim(),
        `goat-flow v${PACKAGE_VERSION}`,
      );

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
      writeFileSync(
        join(upgradedProjectPath, ".goat-flow/hooks/hook-launch-runtime.mjs"),
        V1_16_0_LAUNCH_RUNTIME,
      );

      const migrationResult = reviewAndSyncPackedHooks(
        packedPackageRoot,
        packedCliLaunchPath,
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
      assert.equal(
        readFileSync(
          join(upgradedProjectPath, ".goat-flow/hooks/run-with-bash.mjs"),
          "utf8",
        ),
        V1_16_0_BASH_RUNNER,
        "Sync preserves unclassified legacy bytes",
      );
      assert.equal(
        readFileSync(
          join(upgradedProjectPath, ".goat-flow/hooks/hook-launch-runtime.mjs"),
          "utf8",
        ),
        readFileSync(
          join(packedPackageRoot, "workflow/hooks/hook-launch-runtime.mjs"),
          "utf8",
        ),
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
      // This release has no shared native launcher to replace: adding Node files needs no overwrite consent.
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
          join(upgradedProjectPath, ".goat-flow/hooks/run-with-bash.mjs"),
          "utf8",
        ),
        V1_15_0_BASH_RUNNER,
      );
      assert.equal(
        readFileSync(
          join(upgradedProjectPath, ".goat-flow/hooks/hook-launch-runtime.mjs"),
          "utf8",
        ),
        readFileSync(
          join(packedPackageRoot, "workflow/hooks/hook-launch-runtime.mjs"),
          "utf8",
        ),
      );
      assertInstalledCodexPolicy(upgradedProjectPath);
    },
  );
  it("recovers an interrupted archived installer only after confirmed claim recovery", async () => {
    const { packedCliLaunchPath } = preparePackedCliLaunch();
    const project = makeDisposablePackageWorkspace("interrupted-install");
    const output = makeDisposablePackageWorkspace("installer-owner");
    const preload = join(output, "pause.cjs");
    writeFileSync(
      preload,
      `const fs = require("node:fs");
const allocate = fs.mkdtempSync; let stages = 0;
fs.mkdtempSync = (prefix, ...args) => {
  if (String(prefix).includes(".goat-flow-stage.") && ++stages === 2) {
    process.stdout.write("READY\\n");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
  }
  return allocate(prefix, ...args);
};
require("node:module").syncBuiltinESMExports();
`,
    );
    const spawnClaimOwner = () => {
      const streams = ["stdout", "stderr"].map((name) =>
        fs.openSync(join(output, name), "wx", 0o600),
      );
      try {
        return spawn(
          process.execPath,
          [packedCliLaunchPath, "install", project, "--agent", "codex"],
          {
            cwd: project,
            env: {
              ...process.env,
              NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require ${JSON.stringify(preload)}`,
            },
            stdio: ["ignore", ...streams],
          },
        );
      } finally {
        streams.forEach((descriptor) => fs.closeSync(descriptor));
      }
    };
    const owner = spawnClaimOwner();
    try {
      await new Promise<void>((resolveReady, rejectReady) => {
        const deadline = setTimeout(() => {
          clearInterval(poll);
          rejectReady(
            new Error(
              readFileSync(join(output, "stderr"), "utf8") ||
                "installer did not reach its claimed write",
            ),
          );
        }, 15000);
        const poll = setInterval(() => {
          if (!readFileSync(join(output, "stdout"), "utf8").includes("READY\n"))
            return;
          clearInterval(poll);
          clearTimeout(deadline);
          resolveReady();
        }, 10);
      });
      const exited = once(owner, "exit");
      assert.equal(owner.kill("SIGKILL"), true);
      await exited;
      const state = join(project, ".goat-flow/state/install/managed.json");
      assert.deepEqual(
        (JSON.parse(readFileSync(state, "utf8")) as { receipts: unknown[] })
          .receipts,
        [],
      );
      assert.ok(
        existsSync(join(project, ".goat-flow/.gitignore")),
        "one real file was published before process death",
      );
      const retry = runPackedCli(
        packedCliLaunchPath,
        ["install", project, "--agent", "codex"],
        project,
      );
      assert.equal(retry.status, 1);
      assert.match(retry.stderr, /busy|cooperating writer/u);

      const locks = join(project, ".goat-flow/state/locks");
      const targets = fs
        .readdirSync(locks)
        .filter((name) => name.endsWith(".claim"))
        .map(
          (name) =>
            (
              JSON.parse(readFileSync(join(locks, name), "utf8")) as {
                targetPath: string;
              }
            ).targetPath,
        );
      assert.ok(targets.length > 1);
      const first = targets[0];
      assert.ok(first);
      const inspection = runPackedCli(
        packedCliLaunchPath,
        ["claims", "inspect", project, "--target", first, "--format", "json"],
        project,
      );
      assert.equal(inspection.status, 0, inspection.stderr);
      const evidence = JSON.parse(inspection.stdout) as {
        markerSha256: string;
      };
      const unconfirmed = runPackedCli(
        packedCliLaunchPath,
        [
          "claims",
          "recover",
          project,
          "--target",
          first,
          "--marker-sha256",
          evidence.markerSha256,
        ],
        project,
      );
      assert.equal(unconfirmed.status, 2);
      const confirmed = runPackedCli(
        packedCliLaunchPath,
        [
          "claims",
          "recover",
          project,
          "--target",
          first,
          "--marker-sha256",
          evidence.markerSha256,
          "--confirm-abandoned",
        ],
        project,
      );
      assert.equal(confirmed.status, 0, confirmed.stderr);
      // The terminated owner is now explicitly confirmed absent; use the same recovery primitive for the remaining inspected markers.
      for (const target of targets.slice(1)) {
        const claim = inspectPathWriteClaim(project, target);
        assert.ok(claim);
        assert.equal(removeConfirmedAbandonedPathWriteClaim(claim), "removed");
      }
      const reapplied = runPackedCli(
        packedCliLaunchPath,
        ["install", project, "--agent", "codex"],
        project,
      );
      assert.equal(reapplied.status, 0, reapplied.stderr || reapplied.stdout);
      assert.match(reapplied.stdout, /Install verified for codex/u);
    } finally {
      if (owner.exitCode === null && owner.signalCode === null) {
        const exited = once(owner, "exit");
        owner.kill("SIGKILL");
        await exited;
      }
    }
  });

  // Complete released state proves the archived upgrade keeps saved opt-outs and user files.
  it("upgrades a complete pinned 1.18.0 install while preserving disabled choices and user files", (t) => {
    const predecessor = "bd800f792968b0243eecd6983bc6f0ad9f84af3c";
    if (
      spawnSync("git", ["cat-file", "-e", `${predecessor}^{commit}`], {
        cwd: PROJECT_ROOT,
      }).status !== 0
    ) {
      assert.ok(
        !process.env.CI,
        `CI must fetch pinned v1.18.0 commit ${predecessor} before running upgrade coverage`,
      );
      t.skip("Pinned v1.18.0 commit is absent from local Git history");
      return;
    }
    const priorRoot = makeDisposablePackageWorkspace("release-1-18-0");
    const archive = join(priorRoot, "release.tar");
    for (const [command, args] of [
      ["git", ["archive", predecessor, "--output", archive]],
      ["tar", ["-xf", archive, "-C", priorRoot]],
    ] as const) {
      const seeded = spawnSync(command, [...args], {
        cwd: PROJECT_ROOT,
        encoding: "utf8",
      });
      assert.equal(seeded.status, 0, seeded.stderr);
    }
    assert.equal(
      JSON.parse(readFileSync(join(priorRoot, "package.json"), "utf8")).version,
      "1.18.0",
    );
    symlinkSync(
      join(PROJECT_ROOT, "node_modules"),
      join(priorRoot, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const project = makeDisposablePackageWorkspace("upgrade-1-18-0");
    mkdirSync(join(project, ".goat-flow"));
    writeFileSync(
      join(project, ".goat-flow/config.yaml"),
      'version: "1.18.0"\nhooks:\n  deny-dangerous: {enabled: false}\n  deny-git-mutations: {enabled: false}\n  gruff-code-quality: {enabled: false}\n',
    );
    const userPath = join(project, "user-notes.txt");
    writeFileSync(userPath, "User notes survive the supported upgrade.\n");
    const oldInstall = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        join(priorRoot, "src/cli/cli.ts"),
        "install",
        project,
        "--agent",
        "codex",
      ],
      { cwd: priorRoot, encoding: "utf8", timeout: 120_000 },
    );
    assert.equal(oldInstall.status, 0, oldInstall.stderr || oldInstall.stdout);
    const statePath = join(project, ".goat-flow/state/install/managed.json");
    const priorState = JSON.parse(readFileSync(statePath, "utf8"));
    assert.equal(priorState.schemaVersion, "goat-flow.install-state.v2");
    const { packedPackageRoot, packedCliLaunchPath } = preparePackedCliLaunch();
    const pinnedCli = readFileSync(packedCliLaunchPath);
    const restricted = restrictedConsumerEnvironment(
      makeDisposablePackageWorkspace("upgrade-spawn-proof"),
    );
    const upgraded = runPackedCli(
      packedCliLaunchPath,
      ["install", project, "--agent", "codex"],
      project,
      restricted,
    );
    assert.equal(upgraded.status, 0, upgraded.stderr || upgraded.stdout);
    assert.match(upgraded.stdout, /Install verified for codex/u);
    assert.equal(
      readFileSync(userPath, "utf8"),
      "User notes survive the supported upgrade.\n",
    );
    const choices = readPolicyChoices(project);
    for (const id of ["deny-dangerous", "deny-git-mutations"])
      assert.equal(choices[id], false);
    const config = loadConfig(project);
    assert.equal(config.valid, true);
    assert.equal(config.config.hooks["gruff-code-quality"]?.enabled, false);
    const currentState = JSON.parse(readFileSync(statePath, "utf8"));
    assert.equal(currentState.schemaVersion, priorState.schemaVersion);
    assert.ok(currentState.receipts.length >= priorState.receipts.length);
    assert.ok(
      currentState.files.some(
        (row: { path: string }) =>
          row.path === ".goat-flow/hooks/deny-dangerous.mjs",
      ),
    );
    const handler = readInstalledCodexDenyHandler(project);
    const launch = agentHookSpawnDescriptor({ form: "shell", ...handler });
    const disabled = spawnSync(launch.command, launch.args, {
      cwd: project,
      env: restricted,
      encoding: "utf8",
      input: JSON.stringify({
        tool_name: "Bash",
        tool_input: { command: "rm -rf /" },
      }),
      timeout: 30_000,
    });
    assert.equal(disabled.status, 0, disabled.stderr || disabled.stdout);
    assert.equal(disabled.stdout, "");
    assert.equal(disabled.stderr, "");
    assert.deepEqual(readFileSync(packedCliLaunchPath), pinnedCli);
    assert.deepEqual(
      readFileSync(join(project, ".goat-flow/hooks/run-hook.mjs")),
      readFileSync(join(packedPackageRoot, "workflow/hooks/run-hook.mjs")),
    );
    const journal = readFileSync(restricted.GOAT_TEST_SPAWN_LOG ?? "", "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.ok(journal.some((row) => row.event === "loaded"));
    assert.equal(journal.filter((row) => row.event === "denied").length, 0);
  });
});
