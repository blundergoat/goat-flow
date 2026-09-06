/**
 * Parse the review operation and its optional saved input path.
 * Use this during CLI intake for snapshot, report, draft, or ledger requests.
 *
 * Unrelated commands keep null review fields; review input defaults to stdin.
 * This parser loads no source readers or validator runtime while checking command usage.
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
  "snapshot",
  "validate",
  "validate-draft",
  "validate-ledger",
]);
const REVIEW_INPUT_LABELS: Record<ReviewSubcommand, string> = {
  snapshot: "[request-file]",
  validate: "[report-file]",
  "validate-draft": "[draft-envelope-file]",
  "validate-ledger": "[ledger-file]",
};

/**
 * Parse the review operation and optional file during CLI intake; omitted input uses stdin.
 *
 * @param command - selected top-level command; unrelated commands retain null review fields
 * @param positionals - operation and optional input filename after shared flags have been parsed
 * @returns review fields; a null input path means the selected operation reads stdin
 *
 * @throws CLIError when review has no supported operation or receives multiple input paths
 */
export function buildReviewCLIFields(
  command: Command,
  positionals: string[],
): ReviewCLIFields {
  // Other commands have no review input and must not inherit review-specific parsing.
  if (command !== "review") {
    return { reviewSubcommand: null, reviewValidatePath: null };
  }
  const [subcommand, reportPath, ...extraPositionals] = positionals;
  // An unsupported or missing operation needs a usage error before any source or report is read.
  if (!REVIEW_SUBCOMMANDS.has(subcommand as ReviewSubcommand)) {
    throw new CLIError(
      'review requires subcommand "snapshot", "validate", "validate-draft", or "validate-ledger".',
      2,
    );
  }
  const reviewSubcommand = subcommand as ReviewSubcommand;
  // Several input files would make the review request ambiguous, so only one saved input is accepted.
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
