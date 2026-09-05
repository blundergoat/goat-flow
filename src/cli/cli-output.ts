/**
 * Default sink for rendered command results, routing to a file or stdout.
 *
 * Commands with stronger persistence contracts may own their file branch; `redact` uses a project-local pinned descriptor. Other callers share this
 * `--output` contract and trailing-newline convention. File confirmations go to stderr so paths never contaminate piped stdout.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ParsedCLI } from "./cli-types.js";

/**
 * Write a command's rendered text to the resolved `--output` file, or to stdout when none was given.
 * The file branch touches the filesystem: it writes the output file and creates any missing parent directories under the target path, so callers pass
 * a path they intend to materialise on disk.
 *
 * @param options - parsed CLI options; only `options.output` is read - a non-null path triggers the
 *   file branch (parent directories are created) while null routes the text to stdout
 * @param rendered - the already-formatted command output; a single trailing newline is appended in
 *   both branches, so callers pass the body without their own terminator
 */
export function writeOutput(options: ParsedCLI, rendered: string): void {
  if (options.output) {
    mkdirSync(dirname(options.output), { recursive: true });
    writeFileSync(options.output, rendered + "\n", "utf-8");
    console.error(`Written to ${options.output}`);
    return;
  }

  process.stdout.write(rendered + "\n");
}
