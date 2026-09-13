/**
 * Present hook list, Sync, toggle and verification results to terminal users.
 *
 * The shared registrar owns project changes; this adapter chooses text or JSON and prints actionable failures.
 * Unknown hooks produce usage exit 2; other registrar failures produce exit 1.
 */

import { CLIError } from "./cli-error.js";
import { writeOutput } from "./cli-output.js";
import { BATCH_HOOK_SCENARIOS } from "./cli-types.js";
import type { HookScenario, ParsedCLI } from "./cli-types.js";
import type { HookState, HookRegistrarError } from "./server/hook-registrar.js";

/** Render desired and effective hook state as a compact terminal table. */
function renderHooksText(hooks: HookState[]): string {
  const lines = ["Hook state", ""];
  // Each hook keeps agent evidence separate because shared files do not prove shared provider support.
  for (const hook of hooks) {
    const agentBits = Object.entries(hook.agents).map(([agentId, state]) => {
      const repair = state.repairCommand
        ? `; next: ${state.repairCommand}`
        : state.effectiveState.status === "effective"
          ? ""
          : `; ${state.repairSummary}`;
      return `${agentId}: ${state.effectiveStateLabel} [${state.effectiveState.severity}]${repair}`;
    });
    lines.push(
      `${hook.id}  ${hook.enabled ? "enabled" : "disabled"}  ${agentBits.join(", ")}`,
    );
    // Only hooks that scan project folders show scan-root details; null means this row has no scan-root status.
    if (hook.scanRoots !== null) {
      const roots =
        hook.scanRoots.roots.length === 0
          ? "none"
          : hook.scanRoots.roots.join(", ");
      lines.push(`  scan roots: ${roots} [${hook.scanRoots.status}]`);
      // A scan-root issue explains why the user's selected folders cannot currently be scanned.
      if (hook.scanRoots.issue !== null) {
        lines.push(`  ${hook.scanRoots.issue}`);
      }
    }
  }
  return lines.join("\n");
}

/**
 * Require the hook ID chosen by an enable or disable command.
 * Throws a usage error with exit 2 when the ID is missing, including for callers that bypass argument parsing.
 */
function requireHookId(options: ParsedCLI): string {
  // An explicit hook ID identifies the row the user wants to enable or disable.
  if (options.hookId) return options.hookId;
  throw new CLIError(`hooks ${options.hookSubcommand} requires <hook-id>.`, 2);
}

/** Render all hook rows in the user's selected text or JSON format. */
function renderHooksResult(
  options: ParsedCLI,
  result: { hooks: HookState[] },
): void {
  writeOutput(
    options,
    options.format === "json"
      ? JSON.stringify(result, null, 2)
      : renderHooksText(result.hooks),
  );
}

/**
 * Render the changed hook as one terminal row or a JSON object containing `hook`.
 * This preserves the existing toggle output contract for scripts.
 */
function renderHookToggleResult(options: ParsedCLI, hook: HookState): void {
  writeOutput(
    options,
    options.format === "json"
      ? JSON.stringify({ hook }, null, 2)
      : renderHooksText([hook]),
  );
}

/**
 * Run and render the explicit managed-hook proof selected by a terminal or CI user.
 * A failed or unavailable proof keeps its structured report on stdout and sets exit 1.
 *
 * @param options - Parsed hook request; agent and scenario must be non-null and supported.
 *
 * @returns Nothing; the user receives the report through stdout and the process exit code.
 * @throws CLIError When the agent or fixed scenario choice is missing or invalid.
 */
async function handleHookVerification(options: ParsedCLI): Promise<void> {
  // Runtime evidence must name one agent so support and registration state stay unambiguous.
  if (options.agent === null) {
    throw new CLIError("hooks verify requires --agent <id>.", 2);
  }
  // Direct callers must select one bounded offline scenario group before target hook code runs.
  if (options.hookScenario === null) {
    throw new CLIError(
      'hooks verify requires --scenario "deny-hook", "post-turn-hook", "gruff-hook", or "all".',
      2,
    );
  }
  const {
    renderHookRuntimeBatchReportJson,
    renderHookRuntimeBatchReportText,
    renderHookRuntimeReportJson,
    renderHookRuntimeReportText,
    summarizeHookRuntimeBatch,
    verifyManagedDenyHook,
  } = await import("./hooks-runtime-evidence.js");
  const { verifyManagedConfiguredHook } =
    await import("./hooks-configured-runtime-evidence.js");
  const agent = options.agent;

  /** Run one group through the entrypoint that owns it, keeping the single trust decision. */
  const verifyScenarioGroup = (scenarioGroup: HookScenario) =>
    scenarioGroup === "deny-hook" || scenarioGroup === "git-mutations-hook"
      ? verifyManagedDenyHook({
          projectPath: options.projectPath,
          agent,
          scenarioGroup,
          // The runtime-evidence layer uses this field as its no-execution gate.
          // Omission and the deprecated alias both stay static; only explicit trusted-target selection releases the gate.
          isTargetUntrusted: !options.isTargetTrusted,
        })
      : verifyManagedConfiguredHook({
          projectPath: options.projectPath,
          agent,
          scenarioGroup,
          isTargetUntrusted: !options.isTargetTrusted,
        });

  // One batch runs every shipped group in order and keeps each verdict, so a failed group never hides a later one.
  if (options.hookScenario === "all") {
    const batch = summarizeHookRuntimeBatch(
      options.projectPath,
      agent,
      BATCH_HOOK_SCENARIOS.map(verifyScenarioGroup),
    );
    writeOutput(
      options,
      options.format === "json"
        ? renderHookRuntimeBatchReportJson(batch)
        : renderHookRuntimeBatchReportText(batch),
    );
    // CI must receive failure when any group in the batch lacks matching recorded proof.
    if (batch.status === "fail") process.exitCode = 1;
    return;
  }

  const report = verifyScenarioGroup(options.hookScenario);
  writeOutput(
    options,
    options.format === "json"
      ? renderHookRuntimeReportJson(report)
      : renderHookRuntimeReportText(report),
  );
  // CI must receive failure when any requested scenario lacks matching recorded proof.
  if (report.status === "fail") process.exitCode = 1;
}

/** Keep file-level refusal and recovery details visible to CLI users without exposing the reviewed contents. */
function renderHookFailure(error: HookRegistrarError): string {
  const details = error.details;
  const paths = [
    ...new Set([...(details?.paths ?? []), ...(details?.changedPaths ?? [])]),
  ];
  return [
    error.message,
    ...paths.map((path) => `  - ${path}`),
    ...(details?.recovery ? [details.recovery] : []),
  ].join("\n");
}

/**
 * Run the user's hook command and render its result through the shared guarded registrar.
 *
 * Unknown hooks or subcommands produce usage exit 2; other registrar failures produce exit 1, and unrelated errors propagate.
 *
 * @param options - parsed CLI options; reads `hookSubcommand`, `hookId`, `projectPath`, and `format`
 * @returns a promise that resolves once output is written; rejects (throws) on the error paths above
 */
export async function handleHooksCommand(options: ParsedCLI): Promise<void> {
  const {
    applyHookState,
    HookRegistrarError,
    readAllHookStates,
    syncHookStates,
  } = await import("./server/hook-registrar.js");

  try {
    switch (options.hookSubcommand) {
      case "list":
        renderHooksResult(options, {
          hooks: readAllHookStates(options.projectPath),
        });
        return;
      case "sync":
        renderHooksResult(options, {
          hooks: syncHookStates(options.projectPath),
        });
        return;
      case "enable":
      case "disable":
        renderHookToggleResult(
          options,
          applyHookState(
            requireHookId(options),
            options.hookSubcommand === "enable",
            options.projectPath,
          ),
        );
        return;
      case "verify":
        await handleHookVerification(options);
        return;
    }
  } catch (err) {
    // For example, Sync may find a locally edited hook; print its refusal and recovery steps with a failure exit.
    // Known hook failures carry actionable file details; unknown hook IDs are command usage errors.
    if (err instanceof HookRegistrarError) {
      throw new CLIError(
        renderHookFailure(err),
        err.statusCode === 404 ? 2 : 1,
      );
    }
    throw err;
  }

  throw new CLIError(
    "Usage: goat-flow hooks <list|sync|enable <hook-id>|disable <hook-id>|verify> [path] [--agent <id>]",
    2,
  );
}
