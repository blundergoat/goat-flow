/** Windows provider-launch regressions, replay diagnostics and PowerShell parse checks for the spawn-matrix suite. */
import assert from "node:assert/strict";
import {
  spawnSync,
  type SpawnSyncOptionsWithStringEncoding,
} from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { it } from "node:test";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { agentHookSpawnDescriptor } from "../../src/cli/hook-spawn-descriptor.js";
import { PROFILES } from "../../src/cli/detect/agents.js";
import { writeAgentHookState } from "../../src/cli/server/agent-hook-writer.js";
import { getHookSpec } from "../../src/cli/server/hooks-registry.js";

type ReplayVariant = {
  environment: "full" | "managed";
  values: NodeJS.ProcessEnv;
  stdin: "file" | "pipe";
};

type FileStreamRunner = (
  command: string,
  args: string[],
  options: SpawnSyncOptionsWithStringEncoding,
  payload?: string,
) => ReturnType<typeof spawnSync>;

/** Match Go syscall.appendEscapeArg, used by Antigravity's exec.Command("cmd", "/c", command).
 * Source: https://go.dev/src/syscall/exec_windows.go (appendEscapeArg).
 */
export function goWindowsEscapeArg(value: string): string {
  if (value.length === 0) return '""';
  const hasSpace = /[ \t]/u.test(value);
  let escaped = hasSpace ? '"' : "";
  let slashes = 0;
  for (const character of value) {
    if (character === '"') {
      escaped += "\\".repeat(slashes + 1);
      slashes = 0;
    } else if (character === "\\") {
      slashes++;
    } else {
      slashes = 0;
    }
    escaped += character;
  }
  return hasSpace ? escaped + "\\".repeat(slashes) + '"' : escaped;
}

/** Record the argv Node receives through Go's cmd launch in a caller-owned temporary project. */
export function assertAntigravityWindowsArgv(
  root: string,
  hookId: string,
  install: (root: string) => void,
): void {
  mkdirSync(join(root, ".agents"));
  install(root);
  const spec = getHookSpec(hookId);
  assert.ok(spec);
  writeAgentHookState(root, PROFILES.antigravity, spec, true);
  const config = JSON.parse(
    readFileSync(join(root, ".agents/hooks.json"), "utf8"),
  );
  const command = config[hookId].PreToolUse[0].hooks[0].command as string;
  const recorder = join(root, "record-argv.cjs");
  writeFileSync(
    recorder,
    "console.log(JSON.stringify({args:process.argv.slice(2),cwd:process.cwd()}));process.exit(0);\n",
  );
  const result = spawnSync("cmd.exe", ["/c", goWindowsEscapeArg(command)], {
    cwd: join(root, ".agents"),
    encoding: "utf8",
    windowsVerbatimArguments: true,
    env: {
      ...process.env,
      PATH: `${join(process.execPath, "..")};${process.env.PATH ?? ""}`,
      NODE_OPTIONS: `--require="${recorder.replaceAll("\\", "/")}"`,
    },
    timeout: 10_000,
  });
  assert.equal(
    result.status,
    0,
    `status=${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  assert.deepEqual(JSON.parse(result.stdout), {
    args: [
      `.goat-flow/hooks/${hookId}.mjs`,
      "antigravity",
      "CLAUDE_PROJECT_DIR",
      ".agents/hooks.json",
      ".goat-flow/hooks/run-hook.mjs",
    ],
    cwd: join(root, ".agents"),
  });
}

/** Register both policy argv regressions while leaving fixture cleanup with the owning suite. */
export function registerAntigravityWindowsArgvTests(
  disposableParents: string[],
  install: (root: string) => void,
): void {
  for (const hookId of ["deny-dangerous", "deny-git-mutations"]) {
    it(
      `Antigravity cmd launch preserves ${hookId} argv from .agents`,
      { skip: process.platform !== "win32" },
      () => {
        const root = mkdtempSync(join(tmpdir(), "goat-antigravity-cmd-"));
        disposableParents.push(root);
        assertAntigravityWindowsArgv(root, hookId, install);
      },
    );
  }
}

/**
 * Emit metadata immediately so CI process samples can be matched to each replay.
 * @param details - Stage, transport and result metadata; never payloads or environment values.
 */
export function recordWindowsReplayStage(
  details: Record<string, string | number | null>,
): void {
  process.stderr.write(
    `codex-windows-stage ${JSON.stringify({
      time: new Date().toISOString(),
      pid: process.pid,
      ...details,
    })}\n`,
  );
}

/**
 * Compare shell startup and direct Node replay without replacing the registered-command assertions.
 * Compare the managed module path present, absent, then restored to distinguish its effect from probe order.
 * @param command - Registered non-Windows command, decoded into native Node argv for the control.
 */
export function runWindowsDiagnosticControls(
  projectRoot: string,
  command: string,
  payload: string,
  variants: readonly ReplayVariant[],
  runWithFileStreams: FileStreamRunner,
): void {
  const nativeHandler = agentHookSpawnDescriptor({ form: "shell", command });
  const locationArguments = [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "Set-Location -LiteralPath ([Environment]::CurrentDirectory); exit 0",
  ];
  for (const variant of variants.filter((row) => row.stdin === "file")) {
    for (const control of [
      {
        name: "powershell-startup",
        command: "powershell.exe",
        args: ["-NoProfile", "-NonInteractive", "-Command", "exit 0"],
        payload: undefined,
      },
      {
        name: "powershell-location",
        command: "powershell.exe",
        args: locationArguments,
        payload: undefined,
      },
      {
        name: "powershell-node-startup",
        command: "powershell.exe",
        args: [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "$global:LASTEXITCODE = $null; & node.exe -e 'process.exit(0)'; if ($null -eq $LASTEXITCODE) { exit 1 }; exit $LASTEXITCODE",
        ],
        payload: undefined,
      },
      {
        name: "native-node-hook",
        command: nativeHandler.command,
        args: nativeHandler.args,
        payload,
      },
      ...(variant.environment === "managed"
        ? (["present", "absent", "restored"] as const).map(
            (modulePathState) => ({
              name: `powershell-location-PSModulePath-${modulePathState}`,
              command: "powershell.exe",
              args: locationArguments,
              payload: undefined,
              modulePathState,
            }),
          )
        : []),
    ]) {
      let environment = variant.values;
      if ("modulePathState" in control) {
        // An absent managed value cannot establish the present and restored comparison arms.
        if (!variant.values.PSModulePath) {
          recordWindowsReplayStage({
            phase: "skip",
            probe: control.name,
            environment: variant.environment,
            reason: "managed-module-path-unavailable",
          });
          continue;
        }
        // Each arm starts from the same managed environment; removal never changes later replays.
        environment = { ...variant.values };
        if (control.modulePathState === "absent")
          delete environment.PSModulePath;
      }
      const stdin = control.payload === undefined ? "ignore" : "file";
      recordWindowsReplayStage({
        phase: "start",
        probe: control.name,
        environment: variant.environment,
        stdin,
      });
      const startedAt = performance.now();
      const result = runWithFileStreams(
        control.command,
        control.args,
        {
          cwd: projectRoot,
          encoding: "utf8",
          env: environment,
          timeout: 10_000,
        },
        control.payload,
      );
      recordWindowsReplayStage({
        phase: "end",
        probe: control.name,
        environment: variant.environment,
        stdin,
        duration_ms: Math.round(performance.now() - startedAt),
        status: result.status,
        error:
          (result.error as NodeJS.ErrnoException | undefined)?.code ?? "none",
      });
    }
  }
}

/**
 * List the PowerShell hosts on this machine that can parse registered Windows commands.
 * Windows always offers Windows PowerShell; `pwsh` joins wherever it is on PATH, which is the host Copilot uses.
 */
export function availablePowerShellHosts(): string[] {
  const windowsRoot = process.env.SystemRoot ?? process.env.WINDIR;
  const candidates = ["pwsh"];
  // Windows PowerShell has a fixed location; other hosts have only the PATH lookup.
  if (process.platform === "win32" && windowsRoot) {
    candidates.push(
      join(
        windowsRoot,
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      ),
    );
  }
  return candidates.filter(
    (candidate) =>
      spawnSync(
        candidate,
        ["-NoProfile", "-NonInteractive", "-Command", "exit 0"],
        {
          timeout: 60_000,
        },
      ).status === 0,
  );
}

/**
 * Read the `powershell` command of every Copilot row the public writer registered in one project.
 * Copilot runs this field on Windows; the fixture registers two policy rows and one Gruff row.
 */
export function registeredCopilotPowerShellCommands(
  projectRoot: string,
): string[] {
  const config = JSON.parse(
    readFileSync(join(projectRoot, ".github", "hooks", "hooks.json"), "utf8"),
  ) as { hooks: Record<string, Array<{ powershell: string }>> };
  const commands = Object.values(config.hooks)
    .flat()
    .map((row) => row.powershell);
  assert.equal(commands.length, 3, "two policy rows and one Gruff row");
  return commands;
}

/**
 * Assert every command parses without errors in each host, without running it.
 * Commands travel in the environment so test-side argument quoting cannot change the parsed text.
 */
export function assertPowerShellParses(
  hosts: string[],
  commands: string[],
): void {
  const parseScript =
    "$parseErrors = $null; $tokens = $null; [void][System.Management.Automation.Language.Parser]::ParseInput($env:GOAT_FLOW_PARSE_TEXT, [ref]$tokens, [ref]$parseErrors); @($parseErrors).Count";
  for (const host of hosts) {
    for (const command of commands) {
      const result = spawnSync(
        host,
        ["-NoProfile", "-NonInteractive", "-Command", parseScript],
        {
          encoding: "utf8",
          env: { ...process.env, GOAT_FLOW_PARSE_TEXT: command },
          timeout: 60_000,
        },
      );
      assert.equal(result.status, 0, result.stderr);
      assert.equal(
        Number(result.stdout.trim()),
        0,
        `${host} must parse this registered command:\n${command}`,
      );
    }
  }
}
