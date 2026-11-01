/**
 * Checks the process `goat-flow hooks verify` starts when it replays a registered hook on the user's platform.
 *
 * A replay that silently runs nothing would report a passing hook, so each case proves the configured command decided the exit.
 * Disposable launchers expose inherited settings; no user action runs.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { PROFILES } from "../../src/cli/detect/agents.js";
import {
  agentHookSpawnDescriptor,
  buildAgentHookDescriptor,
  entryCarriesHandlerDescriptor,
  matcherForAgent,
} from "../../src/cli/server/agent-hook-command.js";
import { getHookSpec } from "../../src/cli/server/hooks-registry.js";
import { writeAgentHookState } from "../../src/cli/server/agent-hook-writer.js";

describe("agent hook replay descriptors", () => {
  // Reading file content triggers the content policy without broadening Git-mutation checks to unrelated tools.
  it("matches Antigravity read_file only for its content policy", () => {
    const content = getHookSpec("deny-dangerous");
    const git = getHookSpec("deny-git-mutations");
    assert.ok(content);
    assert.ok(git);
    assert.ok(
      matcherForAgent(PROFILES.antigravity, content)
        .split("|")
        .includes("read_file"),
    );
    assert.equal(matcherForAgent(PROFILES.antigravity, git), "run_command");
    // Other providers keep their own tool vocabulary for the same user action.
    for (const agent of [PROFILES.claude, PROFILES.codex, PROFILES.copilot]) {
      assert.ok(
        !matcherForAgent(agent, content).split("|").includes("read_file"),
      );
    }
  });

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
  // Sync must recognize a Codex Stop registration whose default scan limit was removed on either platform.
  it("keeps the scan limit in exact managed identity on both platforms", () => {
    const spec = getHookSpec("post-turn-safety");
    assert.ok(spec);
    const descriptor = buildAgentHookDescriptor(
      "codex",
      ".goat-flow/hooks",
      spec,
    );
    // Codex stores shell commands; another form would bypass the registration contract under test.
    if (descriptor.form !== "shell")
      assert.fail("Codex uses shell descriptors");
    const prefix =
      "process.env.GOAT_FLOW_POST_TURN_SAFETY_MAX_BYTES??='4194304';";
    const replay = agentHookSpawnDescriptor(descriptor, "linux");
    assert.ok(replay.args[1].startsWith(prefix));
    const windowsCommand = descriptor.commandWindows;
    assert.ok(windowsCommand);
    const encoded = Buffer.from(replay.args[1]).toString("base64");
    assert.ok(windowsCommand.includes(encoded));
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
          command: registered.command.replace(prefix, ""),
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
          commandWindows: registered.commandWindows.replace(
            encoded,
            Buffer.from(replay.args[1].slice(prefix.length)).toString("base64"),
          ),
        },
        "codex",
        descriptor,
      ),
      false,
    );
  });
});

describe("Copilot Windows transport", () => {
  // Copilot runs `powershell` on Windows, where the JSON-quoted Bash command cannot be parsed.
  it("registers the literal PowerShell override and treats the old shared row as stale", () => {
    // Each shipped Copilot hook needs a Windows command that preserves its bootstrap and literal paths.
    for (const hookId of [
      "deny-dangerous",
      "deny-git-mutations",
      "gruff-code-quality",
    ]) {
      const spec = getHookSpec(hookId);
      assert.ok(spec);
      const descriptor = buildAgentHookDescriptor(
        "copilot",
        ".goat-flow/hooks",
        spec,
      );
      // Copilot supplies both shell fields so sync can detect a stale Windows command.
      if (descriptor.form !== "shell")
        assert.fail("Copilot uses shell descriptors");
      assert.ok(descriptor.command.startsWith('node -e "'));
      const windowsCommand = descriptor.commandWindows;
      assert.ok(windowsCommand);
      assert.ok(
        windowsCommand.startsWith("Set-Location -LiteralPath "),
        `${hookId} must use the literal PowerShell transport`,
      );
      assert.ok(
        windowsCommand.includes(`'.goat-flow/hooks/${spec.primaryScript}'`),
      );
      assert.equal(
        entryCarriesHandlerDescriptor(
          { bash: descriptor.command, powershell: windowsCommand },
          "copilot",
          descriptor,
        ),
        true,
      );
      assert.equal(
        entryCarriesHandlerDescriptor(
          { bash: descriptor.command, powershell: descriptor.command },
          "copilot",
          descriptor,
        ),
        false,
        `${hookId} rows written before the fix must be repaired`,
      );
    }
  });
});

describe("Claude Stop scan budget", () => {
  // Sync must recognize a Claude Stop registration whose default limit is missing from its ordered arguments.
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
      "process.env.GOAT_FLOW_POST_TURN_SAFETY_MAX_BYTES??='4194304';";
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

describe("Stop scan budget inheritance", () => {
  // Exercise each registered launch route that must deliver the user's Stop-scan settings.
  for (const [agent, transport] of [
    ["claude", "argv"],
    ["codex", "posix"],
    ["codex", "windows-bootstrap"],
  ] as const) {
    // Unset uses the shipped default; explicit larger and smaller user limits must both survive launch.
    for (const [label, inherited, expected] of [
      ["unset", undefined, "4194304"],
      ["larger", "8388608", "8388608"],
      ["smaller", "524288", "524288"],
    ] as const) {
      it(`${agent} ${transport} delivers the ${label} limit to its launcher`, () => {
        const root = mkdtempSync(join(tmpdir(), "goat-hook-scan-budget-"));
        try {
          const spec = getHookSpec("post-turn-safety");
          assert.ok(spec);
          const descriptor = buildAgentHookDescriptor(
            agent,
            ".goat-flow/hooks",
            spec,
          );
          const hookDirectory = join(root, ".goat-flow/hooks");
          mkdirSync(hookDirectory, { recursive: true });
          writeFileSync(join(hookDirectory, spec.primaryScript), "");
          writeFileSync(
            join(hookDirectory, "run-hook.mjs"),
            "process.stdout.write(process.env.GOAT_FLOW_POST_TURN_SAFETY_MAX_BYTES ?? 'missing');export function runHookNative(){return 0;}\n",
          );
          writeAgentHookState(root, PROFILES[agent], spec, true);
          const environment = { ...process.env };
          delete environment.GIT_DIR;
          delete environment.GIT_WORK_TREE;
          delete environment.GOAT_FLOW_POST_TURN_SAFETY_MAX_BYTES;
          // An absent setting means use defaults; any supplied user setting remains authoritative.
          if (inherited !== undefined)
            environment.GOAT_FLOW_POST_TURN_SAFETY_MAX_BYTES = inherited;

          let command: string;
          let args: string[];
          // Claude launches its registered argv directly, without shell reinterpretation of the user's settings.
          if (descriptor.form === "argv") {
            command = process.execPath;
            args = descriptor.args;
            // Codex on POSIX must pass the same setting through its registered shell command.
          } else if (transport === "posix") {
            command = "bash";
            args = ["-c", descriptor.command];
          } else {
            assert.ok(descriptor.commandWindows);
            // Run the exact Node payload and literal operands registered for PowerShell; native PowerShell remains a platform check.
            const operands = [
              ...descriptor.commandWindows.matchAll(/'((?:''|[^'])*)'/gu),
            ].map((match) => match[1].replaceAll("''", "'"));
            assert.equal(operands.length, 7);
            command = process.execPath;
            args = ["-e", ...operands];
          }
          const result = spawnSync(command, args, {
            cwd: root,
            encoding: "utf8",
            env: environment,
            timeout: 5000,
          });
          assert.equal(result.status, 0, result.stderr);
          assert.equal(result.stdout, expected);
        } finally {
          rmSync(root, { recursive: true, force: true });
        }
      });
    }
  }
});

describe("Claude host failure policy", () => {
  // Claude must refuse the user's command when its policy handler cannot start; optional feedback and Stop omit that host-only field.
  it("marks only Claude policy rows to block when the handler cannot run", () => {
    const policyIds = ["deny-dangerous", "deny-git-mutations"];
    const feedbackIds = ["gruff-code-quality", "post-turn-safety"];
    // Compare policies, feedback, and Stop so a host failure setting cannot change unrelated user flows.
    for (const hookId of [...policyIds, ...feedbackIds]) {
      const spec = getHookSpec(hookId);
      assert.ok(spec, hookId);
      const descriptor = buildAgentHookDescriptor(
        "claude",
        ".goat-flow/hooks",
        spec,
      );
      assert.ok(descriptor.form === "argv", "Claude uses argv descriptors");
      assert.equal(
        descriptor.onFailure,
        policyIds.includes(hookId) ? "block" : undefined,
        hookId,
      );
      // Replay never carries the host-only field, so `hooks verify` spawns the same argv as before.
      assert.deepEqual(agentHookSpawnDescriptor(descriptor, "linux"), {
        command: descriptor.command,
        args: descriptor.args,
      });
      // Shell-form providers never receive the Claude-only field.
      for (const agent of ["codex", "copilot", "antigravity"] as const) {
        assert.equal(
          "onFailure" in
            buildAgentHookDescriptor(agent, ".goat-flow/hooks", spec),
          false,
          `${agent} ${hookId}`,
        );
      }
    }
    // A policy row written by an older install lacks the field and must read as drift so sync repairs it.
    const denySpec = getHookSpec("deny-dangerous");
    assert.ok(denySpec);
    const denyDescriptor = buildAgentHookDescriptor(
      "claude",
      ".goat-flow/hooks",
      denySpec,
    );
    assert.ok(denyDescriptor.form === "argv");
    const { onFailure: _dropped, ...rowWithoutPolicy } = denyDescriptor;
    assert.equal(
      entryCarriesHandlerDescriptor(rowWithoutPolicy, "claude", denyDescriptor),
      false,
    );
    assert.equal(
      entryCarriesHandlerDescriptor(denyDescriptor, "claude", denyDescriptor),
      true,
    );
  });
});

describe("managed Node replay descriptors", () => {
  // Users upgrading hooks must retain their provider's command form, replay route, and Stop-scan default.
  it("retains provider forms, inert routes and the Codex Stop budget in shipped Node descriptors", () => {
    const spec = getHookSpec("deny-dangerous");
    assert.ok(spec);
    // Each provider replays its installed Node hook through its supported platform route.
    for (const agent of [
      "claude",
      "codex",
      "copilot",
      "antigravity",
    ] as const) {
      const installed = buildAgentHookDescriptor(
        agent,
        ".goat-flow/hooks",
        spec,
      );
      const candidate = buildAgentHookDescriptor(
        agent,
        ".goat-flow/hooks",
        spec,
      );
      assert.equal(candidate.form, installed.form);
      const replay = agentHookSpawnDescriptor(candidate, "linux");
      // Antigravity replays from its agent directory and needs a bootstrap path relative to that directory.
      if (agent === "antigravity") {
        assert.ok(candidate.form === "shell");
        assert.equal(
          candidate.command,
          "node ../.goat-flow/hooks/antigravity-hook-bootstrap.cjs .goat-flow/hooks/deny-dangerous.mjs antigravity CLAUDE_PROJECT_DIR .agents/hooks.json .goat-flow/hooks/run-hook.mjs",
        );
        assert.deepEqual(replay, {
          command: "sh",
          args: ["-c", candidate.command],
          cwd: ".agents",
        });
        assert.deepEqual(agentHookSpawnDescriptor(candidate, "win32"), {
          command: "cmd.exe",
          args: ["/c", `"${candidate.command}"`],
          cwd: ".agents",
          windowsVerbatimArguments: true,
        });
      } else {
        assert.equal(replay.command, "node");
        assert.equal(replay.args[2], ".goat-flow/hooks/deny-dangerous.mjs");
        assert.equal(replay.args[6], ".goat-flow/hooks/run-hook.mjs");
      }
      // Claude argv handlers keep inert shell routes so cross-loaded shell hosts do not run the hook twice.
      if (installed.form === "argv") {
        assert.equal(installed.args[6], ".goat-flow/hooks/run-hook.mjs");
        assert.ok(candidate.form === "argv");
        assert.equal(candidate.bash, "exit 0");
        assert.equal(candidate.powershell, "exit 0");
      } else {
        assert.match(installed.command, /run-hook\.mjs/u);
      }
      // Codex users on Windows must reach the explicit PowerShell override.
      if (agent === "codex") {
        assert.equal(
          agentHookSpawnDescriptor(candidate, "win32").command,
          "powershell.exe",
        );
      }
    }
    const stopSpec = getHookSpec("post-turn-safety");
    assert.ok(stopSpec);
    const stop = buildAgentHookDescriptor(
      "codex",
      ".goat-flow/hooks",
      stopSpec,
    );
    assert.equal(agentHookSpawnDescriptor(stop, "linux").env, undefined);
  });

  // A Windows override remains usable even when the default command cannot be parsed for replay.
  it("selects the Windows override before parsing the default native command", () => {
    const spec = getHookSpec("deny-dangerous");
    assert.ok(spec);
    const native = buildAgentHookDescriptor("codex", ".goat-flow/hooks", spec);
    assert.ok(native.form === "shell");
    assert.equal(typeof native.commandWindows, "string");
    const command = `${native.command}; printf "default command selected\\n" >&2; exit 99`;
    assert.deepEqual(
      agentHookSpawnDescriptor({ ...native, command }, "win32"),
      {
        command: "powershell.exe",
        args: [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          native.commandWindows,
        ],
      },
    );
    assert.throws(
      () => agentHookSpawnDescriptor({ ...native, command }, "linux"),
      /canonical Node command/u,
    );
    assert.throws(
      () => agentHookSpawnDescriptor({ form: "shell", command }, "win32"),
      /canonical Node command/u,
    );
    assert.equal(
      agentHookSpawnDescriptor(
        { ...native, command, commandWindows: "" },
        "win32",
      ).args.at(-1),
      "",
    );
  });

  // Verification rejects stale Bash operands and malformed commands instead of reporting a successful Node-hook replay.
  it("rejects mixed-runtime operands and malformed native commands", () => {
    const spec = getHookSpec("deny-dangerous");
    assert.ok(spec);
    // Both argv and shell registrations must reject stale script operands after the Node-hook migration.
    for (const agent of ["claude", "codex"] as const) {
      const installed = buildAgentHookDescriptor(
        agent,
        ".goat-flow/hooks",
        spec,
      );
      const mixed =
        installed.form === "argv"
          ? {
              ...installed,
              args: installed.args.map((value) =>
                value.replace("deny-dangerous.mjs", "deny-dangerous.sh"),
              ),
            }
          : {
              // Both platforms must select the malformed default; no Windows override is supplied.
              form: "shell" as const,
              command: installed.command.replace(
                "deny-dangerous.mjs",
                "deny-dangerous.sh",
              ),
            };
      assert.throws(
        () => agentHookSpawnDescriptor(mixed, "linux"),
        /native candidate replay/u,
      );
      assert.throws(
        () => agentHookSpawnDescriptor(mixed, "win32"),
        /native candidate replay/u,
      );
    }
    assert.throws(
      () =>
        agentHookSpawnDescriptor(
          { form: "shell", command: "node run-hook.mjs" },
          "linux",
        ),
      /canonical Node command/u,
    );
    const native = buildAgentHookDescriptor("claude", ".goat-flow/hooks", spec);
    assert.throws(
      () => agentHookSpawnDescriptor({ ...native, command: "bash" }, "linux"),
      /native candidate replay/u,
    );
  });
});
