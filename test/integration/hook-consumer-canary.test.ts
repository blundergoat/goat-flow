/**
 * Proves the proposed Codex feedback contract inside a disposable consumer.
 * The fixture uses the project hook shape users receive, then runs source launcher bytes.
 * Use this canary before registration propagation so silent deadlines cannot ship as support.
 * Packed-byte parity is covered separately by the packaged hook installation canary.
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
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
const CODEX_GRUFF_LAUNCHER_DEADLINE_MS = 75_000;
const CODEX_GRUFF_HOST_TIMEOUT_SECONDS = 90;
const CODEX_GRUFF_LAUNCH_CONTRACT = `codex:gruff:goat-flow.hook-result.v1:post-tool:1:${CODEX_GRUFF_LAUNCHER_DEADLINE_MS}`;
const disposableConsumerPaths: string[] = [];

after(() => {
  // Each generated consumer is local test state and is removed after its user flow finishes.
  for (const disposableConsumerPath of disposableConsumerPaths) {
    rmSync(disposableConsumerPath, { recursive: true, force: true });
  }
});

/**
 * Create one empty consumer with no Git metadata or inherited project configuration.
 * Use when the canary must prove installation behavior without touching a real user project.
 *
 * @returns Absolute disposable root; never empty after the operating system creates it.
 */
function makeDisposableConsumer(): string {
  const disposableConsumerPath = mkdtempSync(
    join(tmpdir(), "goat-flow-hook-consumer-canary-"),
  );
  disposableConsumerPaths.push(disposableConsumerPath);
  return disposableConsumerPath;
}

/**
 * Install source launcher bytes and one bounded stalling hook into the consumer.
 * Use to reproduce a user-visible deadline before any provider registration is propagated.
 * Side effects: creates the consumer's hook directory and writes four hook inputs.
 *
 * @param disposableConsumerPath - non-empty consumer root; empty would escape fixture ownership
 * @returns Absolute launcher path; never empty after source bytes are copied.
 */
function installSourceCanaryBytes(disposableConsumerPath: string): string {
  const installedHookDirectoryPath = join(
    disposableConsumerPath,
    ".goat-flow",
    "hooks",
  );
  mkdirSync(installedHookDirectoryPath, { recursive: true });
  cpSync(
    join(PROJECT_ROOT, "workflow", "hooks", "run-with-bash.mjs"),
    join(installedHookDirectoryPath, "run-with-bash.mjs"),
  );
  cpSync(
    join(PROJECT_ROOT, "workflow", "hooks", "hook-provider-adapters.mjs"),
    join(installedHookDirectoryPath, "hook-provider-adapters.mjs"),
  );
  cpSync(
    join(PROJECT_ROOT, "workflow", "hooks", "hook-launch-runtime.mjs"),
    join(installedHookDirectoryPath, "hook-launch-runtime.mjs"),
  );
  writeFileSync(
    join(installedHookDirectoryPath, "canary-stall.sh"),
    [
      "#!/usr/bin/env bash",
      "# Simulates an analyzer that cannot finish before the user's feedback deadline.",
      "# Keeps the child alive so the managed launcher must stop it and explain the result.",
      "# Use only inside the disposable source and packed consumer canaries.",
      "sleep 5",
      "",
    ].join("\n"),
  );
  return join(installedHookDirectoryPath, "run-with-bash.mjs");
}

/**
 * Writes the observed Codex project-hook nesting with the proposed managed contract.
 * Use so the canary checks the same matcher, command, and timeout a user would install.
 *
 * @param disposableConsumerPath - non-empty consumer root; empty has no project config location
 * @returns Registered command text; never empty because Codex needs a launch target.
 */
function writeObservedCodexFeedbackConfig(
  disposableConsumerPath: string,
): string {
  const codexConfigDirectoryPath = join(disposableConsumerPath, ".codex");
  mkdirSync(codexConfigDirectoryPath, { recursive: true });
  const registeredCommand =
    `node ".goat-flow/hooks/run-with-bash.mjs" ` +
    `".goat-flow/hooks/canary-stall.sh" "${CODEX_GRUFF_LAUNCH_CONTRACT}"`;
  writeFileSync(
    join(codexConfigDirectoryPath, "hooks.json"),
    `${JSON.stringify(
      {
        description:
          "Registers one disposable Codex feedback canary.\n" +
          "Keeps the managed deadline below the host timeout.\n" +
          "Use only to verify what an editing user would receive.",
        hooks: {
          PostToolUse: [
            {
              matcher: "^apply_patch$",
              hooks: [
                {
                  type: "command",
                  command: registeredCommand,
                  timeout: CODEX_GRUFF_HOST_TIMEOUT_SECONDS,
                },
              ],
            },
          ],
        },
      },
      null,
      2,
    )}\n`,
  );
  return registeredCommand;
}

/**
 * Spawns the installed launcher with a short test-only deadline and captures provider output.
 * Use to prove a stalled analyzer becomes model-facing Codex feedback before the host limit.
 *
 * @param disposableConsumerPath - non-empty installed consumer root; empty cannot resolve hook bytes
 * @param installedLauncherPath - non-empty absolute launcher path; empty cannot start Node
 * @returns Child-process evidence; empty stdout means the user received no provider response.
 */
function runDeadlineCanary(
  disposableConsumerPath: string,
  installedLauncherPath: string,
) {
  return spawnSync(
    process.execPath,
    [
      installedLauncherPath,
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

describe("source hook consumer canary", () => {
  /**
   * Check registration first because missing config must not masquerade as silent delivery.
   * Use the same user flow to prove a stalled analyzer stays visible before Codex times out.
   */
  it("delivers launcher-owned deadline feedback through the observed Codex shape", () => {
    const disposableConsumerPath = makeDisposableConsumer();
    const installedLauncherPath = installSourceCanaryBytes(
      disposableConsumerPath,
    );
    const registeredCommand = writeObservedCodexFeedbackConfig(
      disposableConsumerPath,
    );
    const installedConfig = JSON.parse(
      readFileSync(
        join(disposableConsumerPath, ".codex", "hooks.json"),
        "utf8",
      ),
    ) as {
      hooks: {
        PostToolUse: Array<{
          hooks: Array<{ command: string; timeout: number }>;
        }>;
      };
    };
    const registeredHook = installedConfig.hooks.PostToolUse[0]?.hooks[0];

    // Missing registration data would make the user's visible config impossible to invoke.
    assert.ok(registeredHook);
    assert.equal(registeredHook.command, registeredCommand);
    assert.equal(registeredHook.timeout, CODEX_GRUFF_HOST_TIMEOUT_SECONDS);
    assert.ok(
      CODEX_GRUFF_LAUNCHER_DEADLINE_MS < registeredHook.timeout * 1_000,
      "managed deadline must leave time for Codex to render unavailable feedback",
    );

    const canaryResult = runDeadlineCanary(
      disposableConsumerPath,
      installedLauncherPath,
    );
    assert.equal(canaryResult.status, 0, canaryResult.stderr);
    assert.equal(canaryResult.signal, null);
    // Empty stdout would reproduce the silent provider timeout the live canary exposed.
    assert.notEqual(canaryResult.stdout.trim(), "");
    const providerResponse = JSON.parse(canaryResult.stdout) as {
      hookSpecificOutput?: {
        hookEventName?: string;
        additionalContext?: string;
      };
    };
    const modelVisibleContext =
      providerResponse.hookSpecificOutput?.additionalContext ?? "";
    // Empty context means the editing user still cannot see why feedback was skipped.
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
  });
});
