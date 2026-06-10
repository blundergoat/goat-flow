/**
 * CLI command helpers for regenerating generated learning-loop bucket indexes.
 */
import type { ParsedCLI } from "../cli-types.js";
import { writeOutput } from "../cli-output.js";
import { loadConfig } from "../config/reader.js";
import { createFS } from "../facts/fs.js";
import { generateIndexes } from "./generate.js";
import { resolveIndexBucketPaths } from "./parse-bucket.js";

/**
 * Regenerate learning-loop INDEX.md files after a successful install so new projects start with
 * fresh indexes (and `stats --check` index freshness) without a separate manual `goat-flow index`
 * run. The installer has just created the bucket directories, so this never creates them itself.
 *
 * @param projectPath - target project root whose existing bucket indexes should be regenerated
 */
export function emitIndexGenerationInstallResult(projectPath: string): void {
  const fs = createFS(projectPath);
  const configState = loadConfig(projectPath, fs);
  const written = generateIndexes(
    projectPath,
    fs,
    resolveIndexBucketPaths(configState.config),
  ).filter((result) => result.entryCount !== null);
  if (written.length === 0) return;
  console.log("");
  console.log("Learning-loop indexes:");
  console.log(
    `  ✓ ${written.length} INDEX.md file(s) regenerated (re-run \`goat-flow index\` after editing entries)`,
  );
}

/**
 * Regenerate the four learning-loop INDEX.md files from bucket content.
 * Missing bucket directories are skipped rather than created, and user-visible paths stay POSIX-shaped.
 *
 * @param options - parsed CLI options carrying the target project and output mode
 */
export function handleIndexCommand(options: ParsedCLI): void {
  const fs = createFS(options.projectPath);
  const configState = loadConfig(options.projectPath, fs);
  const results = generateIndexes(
    options.projectPath,
    fs,
    resolveIndexBucketPaths(configState.config),
  );
  const lines = results.map((result) =>
    result.entryCount === null
      ? `- ${result.bucket}: skipped (${result.indexRelPath} directory missing)`
      : `✓ ${result.indexRelPath} (${result.entryCount} entries)`,
  );
  writeOutput(options, lines.join("\n"));
}
