/**
 * Implements the `hooks` command family (list / sync / enable / disable / verify) for the CLI.
 * It is a thin presentation+validation layer over the server-side hook registrar: it lazy-imports
 * the registrar so the heavy module only loads when a hooks command actually runs, picks JSON vs
 * the compact text table from `--format`, and translates the registrar's typed errors into
 * CLIErrors with the right exit code (404 -> usage error 2, everything else -> failure 1).
 */

import { CLIError } from "./cli-error.js";
import { writeOutput } from "./cli-output.js";
import type { ParsedCLI } from "./cli-types.js";
import type { HookState } from "./server/hook-registrar.js";

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
    if (hook.scanRoots !== null) {
      const roots =
        hook.scanRoots.roots.length === 0
          ? "none"
          : hook.scanRoots.roots.join(", ");
      lines.push(`  scan roots: ${roots} [${hook.scanRoots.status}]`);
      if (hook.scanRoots.issue !== null) {
        lines.push(`  ${hook.scanRoots.issue}`);
      }
    }
  }
  return lines.join("\n");
}

/**
 * Assert a hook id is present for the enable/disable toggles, which cannot run without a target.
 * Throws a usage CLIError (exit 2) naming the offending subcommand when the id is missing; the
 * parser normally enforces this, so a throw here is a defensive guard for direct callers.
 */
function requireHookId(options: ParsedCLI): string {
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
 * Render the single hook returned by an enable/disable toggle, reusing the list table for one row.
 * Emits JSON wrapping the hook under a `hook` key when `--format json`, otherwise the one-row text
 * table, so toggle output stays shape-compatible with `hooks list` for scripts that parse either.
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
      'hooks verify requires --scenario "deny-hook", "post-turn-hook", or "gruff-hook".',
      2,
    );
  }
  const {
    renderHookRuntimeReportJson,
    renderHookRuntimeReportText,
    verifyManagedDenyHook,
  } = await import("./hooks-runtime-evidence.js");
  const { verifyManagedConfiguredHook } =
    await import("./hooks-configured-runtime-evidence.js");
  const report =
    options.hookScenario === "deny-hook"
      ? verifyManagedDenyHook({
          projectPath: options.projectPath,
          agent: options.agent,
          scenarioGroup: options.hookScenario,
          // The runtime-evidence layer uses this field as its no-execution gate.
          // Omission and the deprecated alias both stay static; only explicit
          // trusted-target selection releases the gate.
          isTargetUntrusted: !options.isTargetTrusted,
        })
      : verifyManagedConfiguredHook({
          projectPath: options.projectPath,
          agent: options.agent,
          scenarioGroup: options.hookScenario,
          isTargetUntrusted: !options.isTargetTrusted,
        });
  writeOutput(
    options,
    options.format === "json"
      ? renderHookRuntimeReportJson(report)
      : renderHookRuntimeReportText(report),
  );
  // CI must receive failure when any requested scenario lacks matching recorded proof.
  if (report.status === "fail") process.exitCode = 1;
}

/**
 * Handle the hooks command, dispatching list/sync/enable/disable to the lazily-imported registrar.
 * Reports registrar failures as CLIErrors: a HookRegistrarError 404 (unknown hook) throws exit 2,
 * any other registrar error throws exit 1, and non-registrar errors are rethrown unchanged. An
 * unrecognised subcommand that reaches the end throws a usage CLIError (exit 2) with the syntax.
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
    if (err instanceof HookRegistrarError) {
      throw new CLIError(err.message, err.statusCode === 404 ? 2 : 1);
    }
    throw err;
  }

  throw new CLIError(
    "Usage: goat-flow hooks <list|sync|enable <hook-id>|disable <hook-id>|verify> [path] [--agent <id>]",
    2,
  );
}
