#!/usr/bin/env node

/**
 * Starts the goat-flow command line and routes the user's requested workflow.
 *
 * Use this entry point for help, parsing, dispatch, and process exit status.
 * Product behavior belongs in the command modules this file invokes.
 */

import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getPackageVersion } from "./paths.js";
import { CLIError } from "./cli-error.js";
import { dispatchCommand } from "./cli-handlers.js";
import { renderHelp } from "./help.js";
import { parseCLIArgs } from "./cli-parser.js";

export { dispatchCommand } from "./cli-handlers.js";
export { parseCLIArgs } from "./cli-parser.js";
export type { ParsedCLI } from "./cli-types.js";

/** Current package version shown when a user asks which goat-flow release is installed. */
const PACKAGE_VERSION = getPackageVersion();

/**
 * Print package identity when a user runs `--version`.
 * Use before dispatch so version output never depends on project state.
 */
function printPackageVersion(): void {
  console.log(`goat-flow v${PACKAGE_VERSION}`);
}

/**
 * Route one terminal request to help, version output, or the selected workflow.
 * Use for direct CLI launches; imports remain side-effect free.
 *
 * @returns completion after help, version, or the selected project command finishes
 * @throws non-EPIPE output, parse, and command errors for consistent top-level handling
 */
async function routeCliRequest(): Promise<void> {
  // A user may stop reading piped output with `head`; that successful partial read exits quietly instead of showing a false failure.
  process.stdout.on("error", (outputError: NodeJS.ErrnoException) => {
    // A closed output pipe means the user already received the requested prefix, so no error message is useful.
    if (outputError.code === "EPIPE") process.exit(0);
    throw outputError;
  });

  const commandArguments = process.argv.slice(2);

  // No command opens the menu, while every project action still requires the user to name its workflow.
  const cliRequest = parseCLIArgs(commandArguments);

  // Help requests return guidance before a missing, incomplete, or drifted project can block the user.
  if (cliRequest.showHelp) {
    // A bare `--help` has no selected workflow, while `menu --help` asks for the menu topic even though both parse to the menu command.
    const requestedHelpCommand =
      commandArguments[0] === cliRequest.command ? cliRequest.command : null;
    console.log(renderHelp(requestedHelpCommand));
    return;
  }
  // Version requests identify the installed package without opening the user's target project.
  if (cliRequest.showVersion) {
    printPackageVersion();
    return;
  }

  await dispatchCommand(cliRequest);
}

/**
 * Detect whether a user launched this CLI directly, including through a package symlink.
 * Use at module load so tests and library imports do not run a terminal workflow.
 *
 * @returns true for a runnable CLI entry; missing/unreadable paths safely return false
 * @throws Never; path-resolution failures are caught so imports remain safe
 */
function isMainModule(): boolean {
  const launchPath = process.argv[1];
  // An empty launch path means another module imported the CLI, so no terminal workflow should start.
  if (!launchPath) return false;
  try {
    return (
      realpathSync(resolve(launchPath)) ===
      realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    // For example, a user may invoke a stale package symlink whose target was removed during an upgrade; imports must still remain safe.
    return false;
  }
}

// A direct terminal launch runs one request, while imported callers receive only the exported helpers.
if (isMainModule()) {
  // Invalid user input or a workflow failure reaches this boundary so the terminal receives one stable error and exit status.
  routeCliRequest().catch((commandError: unknown) => {
    // Expected input errors keep their actionable message and documented exit code.
    if (commandError instanceof CLIError) {
      console.error(commandError.message);
      process.exit(commandError.exitCode);
    }
    // For example, an unexpected filesystem failure becomes one concise terminal error instead of an unhandled promise trace.
    console.error(
      `Fatal error: ${commandError instanceof Error ? commandError.message : String(commandError)}`,
    );
    process.exit(1);
  });
}
