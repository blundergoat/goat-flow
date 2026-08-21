#!/usr/bin/env node

/**
 * Starts the goat-flow command line and routes the user's requested workflow.
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

/** Current package version used in --version output. */
const PACKAGE_VERSION = getPackageVersion();

/** Print the current package version to stdout */
function printVersion(): void {
  console.log(`goat-flow v${PACKAGE_VERSION}`);
}

/**
 * Route the user's command and keep closed output pipes from showing false failures.
 * @returns completion after help, version, or the selected project command finishes
 * @throws non-EPIPE output, parse, and command errors for consistent top-level handling
 */
async function main(): Promise<void> {
  // Gracefully handle EPIPE (e.g., output piped to `head`)
  process.stdout.on("error", (err: NodeJS.ErrnoException) => {
    // A user may close `head` early; that successful partial read should exit quietly.
    if (err.code === "EPIPE") process.exit(0);
    throw err;
  });

  const rawArgs = process.argv.slice(2);

  // Empty argv opens the menu; every project action requires an explicit command.
  const options = parseCLIArgs(rawArgs);

  // Help requests show guidance without running a project command.
  if (options.showHelp) {
    console.log(renderHelp(options.command));
    return;
  }
  // Version requests give package identity without reading the target project.
  if (options.showVersion) {
    printVersion();
    return;
  }

  await dispatchCommand(options);
}

/**
 * Detect direct or symlinked CLI launches so library imports stay side-effect free.
 * @returns true for a runnable CLI entry; missing/unreadable paths safely return false
 * @throws Never; path-resolution failures are caught so imports remain safe
 */
function isMainModule(): boolean {
  const entry = process.argv[1];
  // An imported module has no launch path and must not start the CLI for the user.
  if (!entry) return false;
  try {
    return (
      realpathSync(resolve(entry)) ===
      realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    // Example: a deleted package symlink leaves the user's launch path unreadable.
    return false;
  }
}

// A direct CLI launch runs once; library consumers only receive exported helpers.
if (isMainModule()) {
  main().catch((err: unknown) => {
    // Expected input errors keep their actionable message and documented exit code.
    if (err instanceof CLIError) {
      console.error(err.message);
      process.exit(err.exitCode);
    }
    console.error(
      `Fatal error: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  });
}
