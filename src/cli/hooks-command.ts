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

/** Render hook state as a compact terminal table. */
function renderHooksText(hooks: Array<Record<string, unknown>>): string {
  const lines = ["Hook state", ""];
  for (const hook of hooks) {
    const agents =
      hook.agents && typeof hook.agents === "object"
        ? (hook.agents as Record<string, Record<string, unknown>>)
        : {};
    const agentBits = Object.entries(agents).map(([agentId, state]) => {
      if (state.supported === false) return `${agentId}: not-supported`;
      const installed = state.installed === true ? "installed" : "missing";
      const drift = typeof state.drift === "string" ? ` (${state.drift})` : "";
      return `${agentId}: ${installed}${drift}`;
    });
    lines.push(
      `${String(hook.id)}  ${hook.enabled === true ? "enabled" : "disabled"}  ${agentBits.join(", ")}`,
    );
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

function renderHooksResult(
  options: ParsedCLI,
  result: { hooks: unknown[] },
): void {
  writeOutput(
    options,
    options.format === "json"
      ? JSON.stringify(result, null, 2)
      : renderHooksText(result.hooks as Array<Record<string, unknown>>),
  );
}

/**
 * Render the single hook returned by an enable/disable toggle, reusing the list table for one row.
 * Emits JSON wrapping the hook under a `hook` key when `--format json`, otherwise the one-row text
 * table, so toggle output stays shape-compatible with `hooks list` for scripts that parse either.
 */
function renderHookToggleResult(options: ParsedCLI, hook: unknown): void {
  writeOutput(
    options,
    options.format === "json"
      ? JSON.stringify({ hook }, null, 2)
      : renderHooksText([hook] as Array<Record<string, unknown>>),
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
  // Direct callers must select the only bounded scenario group shipped in this release.
  if (options.hookScenario !== "deny-hook") {
    throw new CLIError('hooks verify requires --scenario "deny-hook".', 2);
  }
  const {
    renderHookRuntimeReportJson,
    renderHookRuntimeReportText,
    verifyManagedDenyHook,
  } = await import("./hooks-runtime-evidence.js");
  const report = verifyManagedDenyHook({
    projectPath: options.projectPath,
    agent: options.agent,
    scenarioGroup: options.hookScenario,
    isTargetUntrusted: options.isTargetUntrusted,
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
