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

const REVIEW_SUBCOMMANDS = new Set<ReviewSubcommand>([
  "validate",
  "validate-draft",
  "validate-ledger",
]);
const REVIEW_INPUT_LABELS: Record<ReviewSubcommand, string> = {
  validate: "[report-file]",
  "validate-draft": "[draft-envelope-file]",
  "validate-ledger": "[ledger-file]",
};

/**
 * Parse stdin-first review validation positionals.
 *
 * @param command - selected top-level command
 * @param positionals - namespace positionals after shared flag parsing
 * @returns review fields, or null fields for every unrelated command
 * @throws CLIError when review is missing a validation operation or receives multiple input paths
 */
export function buildReviewCLIFields(
  command: Command,
  positionals: string[],
): ReviewCLIFields {
  if (command !== "review") {
    return { reviewSubcommand: null, reviewValidatePath: null };
  }
  const [subcommand, reportPath, ...extraPositionals] = positionals;
  if (!REVIEW_SUBCOMMANDS.has(subcommand as ReviewSubcommand)) {
    throw new CLIError(
      'review requires subcommand "validate", "validate-draft", or "validate-ledger".',
      2,
    );
  }
  const reviewSubcommand = subcommand as ReviewSubcommand;
  if (extraPositionals.length > 0) {
    throw new CLIError(
      `review ${reviewSubcommand} accepts at most one ${REVIEW_INPUT_LABELS[reviewSubcommand]}.`,
      2,
    );
  }
  return {
    reviewSubcommand,
    reviewValidatePath: reportPath ? resolve(reportPath) : null,
  };
}
