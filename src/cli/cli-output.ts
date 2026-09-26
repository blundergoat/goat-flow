/**
 * Default sink for rendered command results, routing to a file or stdout.
 *
 * Commands with stronger persistence contracts may own their file branch; `redact` uses a project-local pinned descriptor. Other callers share this
 * `--output` contract and trailing-newline convention. File confirmations go to stderr so paths never contaminate piped stdout.
 */

import { fstatSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ParsedCLI } from "./cli-types.js";
import { CLIError } from "./cli-error.js";

/**
 * Write a command's rendered text to the resolved `--output` file, or to stdout when none was given.
 *
 * A file destination creates missing parent directories and replaces existing output; callers must first protect any source evidence.
 * File confirmations go to stderr so a developer piping stdout receives only the command result.
 *
 * @param options - parsed CLI options; a non-null output path writes a file, while null sends the result to stdout
 * @param rendered - formatted command result without its trailing newline; an empty result writes a single newline
 */
export function writeOutput(options: ParsedCLI, rendered: string): void {
  // A requested export is saved on disk; otherwise the result stays available for terminal display or piping.
  if (options.output) {
    mkdirSync(dirname(options.output), { recursive: true });
    writeFileSync(options.output, rendered + "\n", "utf-8");
    console.error(`Written to ${options.output}`);
    return;
  }

  process.stdout.write(rendered + "\n");
}

/**
 * Protect a saved review when the developer also requests validation output in a file.
 * Throws a CLI error before writing if the paths name the same file or their identity cannot be checked.
 *
 * @param outputPath - requested result file; null keeps output in the terminal and needs no alias check
 * @param inputPath - saved evidence path or input descriptor, including 0 for redirected stdin
 */
export function assertOutputPreservesInput(
  outputPath: string | null,
  inputPath: string | number,
): void {
  // Terminal output leaves the developer's saved evidence untouched.
  if (!outputPath) return;
  try {
    const outputFile = statSync(outputPath, { throwIfNoEntry: false });
    // A new destination cannot already be a link to the saved report.
    if (!outputFile) return;
    // Redirected stdin can name the same report as --output, so inspect the open descriptor instead of treating 0 as a path.
    const inputFile =
      typeof inputPath === "number"
        ? fstatSync(inputPath)
        : statSync(inputPath);
    // The same file can have several paths through symbolic or hard links; compare its filesystem identity.
    if (
      inputFile.isFile() &&
      inputFile.dev === outputFile.dev &&
      inputFile.ino === outputFile.ino
    ) {
      throw new CLIError(
        "Review output must not overwrite its input file. Choose a separate output path.",
        2,
      );
    }
  } catch (error) {
    // Keep the specific alias warning; a removed file or denied metadata read gets the generic repair message below.
    if (error instanceof CLIError) throw error;
    throw new CLIError(
      "Cannot verify that review output is separate from its input file.",
      2,
    );
  }
}
