/**
 * Parses the shared diagnostics namespace before a readout reaches its handler.
 * Use this module when an operator selects one diagnostics view and optional
 * project path; invalid names or extra paths return concise CLI usage evidence.
 */
import { resolve } from "node:path";

import { CLIError } from "./cli-error.js";
import type { DiagnosticsSubcommand } from "./cli-types.js";

/**
 * Parse `diagnostics context [project-path]` or reject ambiguous terminal input.
 *
 * @param positionals - namespace arguments; empty means the user omitted the required view
 * @returns the context view and one absolute target path for downstream fact extraction
 * @throws CLIError when the view is unsupported or more than one target path is supplied
 */
export function parseDiagnosticsPositionals(positionals: string[]): {
  diagnosticsSubcommand: DiagnosticsSubcommand;
  projectPath: string;
} {
  const [subcommand, projectPath, ...extraPositionals] = positionals;

  // Context is the only shipped diagnostics view until later milestones extend this namespace.
  if (subcommand !== "context") {
    throw new CLIError('diagnostics requires subcommand "context".', 2);
  }

  // One optional target keeps the report tied to a single project users can act on.
  if (extraPositionals.length > 0) {
    throw new CLIError(
      "diagnostics context accepts at most one project path.",
      2,
    );
  }

  return {
    diagnosticsSubcommand: "context",
    projectPath: resolve(projectPath ?? "."),
  };
}
