/**
 * Checks the process `goat-flow hooks verify` starts when it replays a registered hook on the user's platform.
 *
 * A replay that silently runs nothing would report a passing hook, so each case proves the configured command decided the exit.
 * The commands only exit; no managed hook or user action runs.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import {
  agentHookSpawnDescriptor,
  buildAgentHookDescriptor,
  entryCarriesHandlerDescriptor,
} from "../../src/cli/server/agent-hook-command.js";
import { getHookSpec } from "../../src/cli/server/hooks-registry.js";

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

describe("Codex Stop scan budget", () => {
  it("keeps the scan limit in exact managed identity on both platforms", () => {
    const spec = getHookSpec("post-turn-safety");
    assert.ok(spec);
    const descriptor = buildAgentHookDescriptor(
      "codex",
      ".goat-flow/hooks",
      spec,
    );
    if (descriptor.form !== "shell")
      assert.fail("Codex uses shell descriptors");
    const posixPrefix = "GOAT_FLOW_POST_TURN_SAFETY_MAX_BYTES=4194304 ";
    const windowsPrefix =
      "$env:GOAT_FLOW_POST_TURN_SAFETY_MAX_BYTES='4194304'; ";
    assert.ok(descriptor.command.startsWith(posixPrefix));
    const windowsCommand = descriptor.commandWindows;
    assert.ok(windowsCommand);
    assert.ok(windowsCommand.startsWith(windowsPrefix));
    const registered = {
      command: descriptor.command,
      commandWindows: windowsCommand,
    };
    assert.equal(
      entryCarriesHandlerDescriptor(registered, "codex", descriptor),
      true,
    );
    assert.equal(
      entryCarriesHandlerDescriptor(
        {
          ...registered,
          command: registered.command.slice(posixPrefix.length),
        },
        "codex",
        descriptor,
      ),
      false,
    );
    assert.equal(
      entryCarriesHandlerDescriptor(
        {
          ...registered,
          commandWindows: registered.commandWindows.slice(windowsPrefix.length),
        },
        "codex",
        descriptor,
      ),
      false,
    );
  });
});

describe("Claude Stop scan budget", () => {
  it("keeps the per-file scan limit in the managed argv identity", () => {
    const spec = getHookSpec("post-turn-safety");
    assert.ok(spec);
    const descriptor = buildAgentHookDescriptor(
      "claude",
      ".goat-flow/hooks",
      spec,
    );
    assert.ok(descriptor.form === "argv", "Claude uses argv descriptors");
    const prefix =
      "process.env.GOAT_FLOW_POST_TURN_SAFETY_MAX_BYTES='4194304';";
    assert.ok(descriptor.args[1].startsWith(prefix));
    assert.equal(
      entryCarriesHandlerDescriptor(descriptor, "claude", descriptor),
      true,
    );
    assert.equal(
      entryCarriesHandlerDescriptor(
        {
          ...descriptor,
          args: [
            descriptor.args[0],
            descriptor.args[1].slice(prefix.length),
            ...descriptor.args.slice(2),
          ],
        },
        "claude",
        descriptor,
      ),
      false,
    );
    assert.deepEqual(
      agentHookSpawnDescriptor(descriptor, "win32"),
      agentHookSpawnDescriptor(descriptor, "linux"),
    );
  });
});
