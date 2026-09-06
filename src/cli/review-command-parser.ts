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
  reviewProjectPath: string | null;
  reviewExpectedVersion: string | null;
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
 * Reject ambiguous review options before selecting the report or reviewed project.
 *
 * @throws CLIError with usage exit 2 when project/version options are duplicated, empty, or attached to another command
 */
function validateReviewOptions(
  command: Command,
  projects: readonly string[],
  expectedVersions: readonly string[],
): void {
  // Repeating a selection flag could point validation at different evidence or a different contract.
  for (const [flag, values] of [
    ["--project", projects],
    ["--expected-version", expectedVersions],
  ] as const) {
    // Blank or repeated values cannot identify the operator's intended selection.
    if (values.length > 1 || values.some((value) => value.trim().length === 0))
      throw new CLIError(`${flag} requires exactly one nonempty value.`, 2);
    // Another command cannot honor these review-specific options.
    if (command !== "review" && values.length > 0)
      throw new CLIError(`${flag} is available only for review commands.`, 2);
  }
}

/**
 * Parse the review operation and optional file during CLI intake; omitted input uses stdin.
 *
 * @param command - selected top-level command; unrelated commands retain null review fields
 * @param positionals - operation and optional input filename after shared flags have been parsed
 * @param projects - supplied project options; empty preserves the invoking directory
 * @param expectedVersions - caller's installed contract stamp; empty keeps legacy version handling
 * @returns review fields; a null input path means the selected operation reads stdin
 *
 * @throws CLIError when review has no supported operation or receives multiple input paths
 */
export function buildReviewCLIFields(
  command: Command,
  positionals: string[],
  projects: readonly string[] = [],
  expectedVersions: readonly string[] = [],
): ReviewCLIFields {
  validateReviewOptions(command, projects, expectedVersions);
  // Other commands have no review input and must not inherit review-specific parsing.
  if (command !== "review") {
    return {
      reviewSubcommand: null,
      reviewValidatePath: null,
      reviewProjectPath: null,
      reviewExpectedVersion: null,
    };
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
  validateReviewOperands(reviewSubcommand, projects, extraPositionals);
  return {
    reviewSubcommand,
    reviewValidatePath: reportPath ? resolve(reportPath) : null,
    reviewProjectPath: projects[0] === undefined ? null : resolve(projects[0]),
    reviewExpectedVersion: expectedVersions[0] ?? null,
  };
}

/**
 * Reject operands the selected operation cannot use, before opening any review input.
 *
 * @throws CLIError with usage exit 2 when the selected operation cannot use the project option or extra operands
 */
function validateReviewOperands(
  reviewSubcommand: ReviewSubcommand,
  projects: readonly string[],
  extraPositionals: string[],
): void {
  // A transient ledger checks text grammar only; a project option would imply source validation it cannot perform.
  if (reviewSubcommand === "validate-ledger" && projects.length > 0)
    throw new CLIError("review validate-ledger does not accept --project.", 2);
  // Several input files would make the review request ambiguous, so only one saved input is accepted.
  if (extraPositionals.length > 0) {
    throw new CLIError(
      `review ${reviewSubcommand} accepts at most one ${REVIEW_INPUT_LABELS[reviewSubcommand]}.`,
      2,
    );
  }
}
