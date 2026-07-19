/**
 * CLI adapter for pre-write durable artifact redaction.
 * Users pipe a draft through `goat-flow redact` before saving session,
 * review, quality, security, or export text. The scrubber runs in memory;
 * only its readable redacted result reaches stdout or `--output`.
 */
import { readFileSync } from "node:fs";
import type { ParsedCLI } from "./cli-types.js";
import { writeOutput } from "./cli-output.js";
import { scrubDurableText } from "./evidence/redaction.js";

/**
 * Normalize one trailing input newline because the shared output writer adds it back.
 * Empty input becomes one output newline, representing an empty durable note.
 *
 * @param inputText - raw stdin text; empty input means the user supplied no note body
 * @returns scrubbed output without one trailing newline, ready for the shared writer
 */
function renderRedactedDurableText(inputText: string): string {
  return scrubDurableText(inputText).replace(/\r?\n$/u, "");
}

/**
 * Read a candidate durable artifact from stdin and emit only its scrubbed form.
 * Use `--output` when the CLI should persist the safe result for the user.
 *
 * @param options - parsed CLI options; null output writes the scrubbed text to stdout
 * @returns nothing; output is written through the shared CLI sink
 */
export function handleRedactCommand(options: ParsedCLI): void {
  const inputText = readFileSync(0, "utf-8");
  writeOutput(options, renderRedactedDurableText(inputText));
}
