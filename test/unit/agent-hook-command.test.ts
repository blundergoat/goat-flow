/**
 * Checks the process `goat-flow hooks verify` starts when it replays a registered hook on the user's platform.
 *
 * A replay that silently runs nothing would report a passing hook, so each case proves the configured command decided the exit.
 * The commands only exit; no managed hook or user action runs.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { agentHookSpawnDescriptor } from "../../src/cli/server/agent-hook-command.js";

describe("agent hook replay descriptors", () => {
  /** Spawns two inert Bash replays so `hooks verify` stays honest on Windows when a caller drops the replay environment. */
  it("fails a Windows hook replay whose command environment was dropped", () => {
    // A shell handler without a Windows override carries its Bash source in the environment on Windows.
    const configuredExitStatus = 7;
    const replay = agentHookSpawnDescriptor(
      { form: "shell", command: `exit ${configuredExitStatus}` },
      "win32",
    );
    const environmentWithoutReplayCommand = { ...process.env };
    delete environmentWithoutReplayCommand.GOAT_FLOW_HOOK_REPLAY_COMMAND;
    // The configured command decides the exit, so a passing replay cannot come from evaluating an empty string.
    const replayWithCommand = spawnSync(replay.command, replay.args, {
      encoding: "utf8",
      env: { ...environmentWithoutReplayCommand, ...replay.env },
    });
    assert.equal(
      replayWithCommand.status,
      configuredExitStatus,
      replayWithCommand.stderr,
    );
    const replayWithoutCommand = spawnSync(replay.command, replay.args, {
      encoding: "utf8",
      env: environmentWithoutReplayCommand,
    });
    assert.notEqual(replayWithoutCommand.status, 0);
    assert.match(replayWithoutCommand.stderr, /hook replay command missing/u);
  });
});
