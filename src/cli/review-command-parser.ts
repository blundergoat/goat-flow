/**
 * Lightweight positional grammar for the `review` namespace.
 * Kept outside the saturated shared parser so one command does not raise its complexity or load validator/runtime dependencies during unrelated
 * parsing.
 */
import { resolve } from "node:path";
import { CLIError } from "./cli-error.js";
import type { Command, ReviewSubcommand } from "./cli-types.js";

/** Parsed review namespace fields merged into the shared CLI request contract. */
export interface ReviewCLIFields {
  reviewSubcommand: ReviewSubcommand | null;
  reviewValidatePath: string | null;
}

/**
 * Parse stdin-first `review validate [report-file]` positionals.
 *
 * @param command - selected top-level command
 * @param positionals - namespace positionals after shared flag parsing
 * @returns review fields, or null fields for every unrelated command
 * @throws CLIError when review is missing `validate` or receives multiple report paths
 */
export function buildReviewCLIFields(
  command: Command,
  positionals: string[],
): ReviewCLIFields {
  if (command !== "review") {
    return { reviewSubcommand: null, reviewValidatePath: null };
  }
  const [subcommand, reportPath, ...extraPositionals] = positionals;
  if (subcommand !== "validate") {
    throw new CLIError('review requires subcommand "validate".', 2);
  }
  if (extraPositionals.length > 0) {
    throw new CLIError("review validate accepts at most one [report-file].", 2);
  }
  return {
    reviewSubcommand: "validate",
    reviewValidatePath: reportPath ? resolve(reportPath) : null,
  };
}
