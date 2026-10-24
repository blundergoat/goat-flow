/** Metadata-only Windows replay diagnostics for the spawn-matrix integration test. */
import type {
  spawnSync,
  SpawnSyncOptionsWithStringEncoding,
} from "node:child_process";
import { performance } from "node:perf_hooks";
import { agentHookSpawnDescriptor } from "../../src/cli/hook-spawn-descriptor.js";

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
