/**
 * Proves an unpublished npm tarball contains a working Codex feedback launcher.
 * The fixture extracts real package bytes into a disposable consumer and runs them.
 * Use before release so source-only success cannot hide missing or stale packaged hooks.
 * Provider delivery itself is established by the separate live Codex canary.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
const CODEX_GRUFF_LAUNCHER_DEADLINE_MS = 75_000;
const CODEX_GRUFF_HOST_TIMEOUT_SECONDS = 90;
const CODEX_GRUFF_LAUNCH_CONTRACT = `codex:gruff:goat-flow.hook-result.v1:post-tool:1:${CODEX_GRUFF_LAUNCHER_DEADLINE_MS}`;
const disposablePackagePaths: string[] = [];

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
  const packResult = spawnSync(
    "npm",
    [
      "pack",
      "--json",
      "--ignore-scripts",
      "--pack-destination",
      archiveDirectoryPath,
    ],
    {
      cwd: PROJECT_ROOT,
      encoding: "utf8",
      timeout: 30_000,
    },
  );
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
    ["-xzf", packedArchivePath, "-C", extractedDirectoryPath],
    {
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
 * Install only packed hook bytes and one stalling analyzer into a disposable consumer.
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
 * Run packed launcher bytes with a short test-only deadline and capture Codex output.
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
      /hook exceeded its deadline and was killed/u,
    );
    assert.equal(canaryResult.stderr, "");
    assert.ok(
      CODEX_GRUFF_LAUNCHER_DEADLINE_MS <
        CODEX_GRUFF_HOST_TIMEOUT_SECONDS * 1_000,
      "packed registration must leave Codex time to render feedback",
    );
  });
});
