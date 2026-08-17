/**
 * Single sink every command uses to emit its rendered result, routing to a file or stdout.
 *
 * Keeping all commands behind one writer means the `--output` contract (and the trailing newline convention) is defined in exactly one place.
 * Note the asymmetry callers rely on: when writing to a file the "Written to ..." confirmation goes to stderr so the file path never contaminates
 * piped stdout; with no `--output` the payload itself goes to stdout for piping.
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
