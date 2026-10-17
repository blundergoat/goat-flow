/**
 * Run one `goat-flow review` request: check its usage, open the reviewed project, read the report or request, and render the result.
 * A developer or skill reaches it through `goat-flow review snapshot|validate|validate-draft|validate-ledger`, usually piping input on stdin.
 *
 * `runReviewRequest` returns the text and exit status without printing, so tests can run a request in-process; `handleReviewCommand` prints them.
 * Validation lives in review-validate.ts and the review-validate-*.ts modules; this module owns the command's usage, input, output and exit status.
 */
import { readFileSync, realpathSync, statSync } from "node:fs";
import { getPackageVersion } from "./paths.js";
import { CLIError } from "./cli-error.js";
import type { ParsedCLI } from "./cli-types.js";
import { assertOutputPreservesInput, writeOutput } from "./cli-output.js";
import {
  canonicalReviewJson,
  captureReviewSnapshot,
  ReviewAuthorityError,
} from "./review-validate-authority.js";
import { validateRefutationLedgerText } from "./review-validate-ledger.js";
import {
  renderReviewValidationResult,
  validateReviewDraftEnvelope,
  validateReviewReport,
} from "./review-validate.js";

/** Render the transient ledger gate with the exact record count a report must claim. */
function renderLedgerValidationResult(
  result: ReturnType<typeof validateRefutationLedgerText>,
): string {
  // A valid ledger receives its record count; a failed ledger uses the shared issue renderer.
  if (result.status === "pass") {
    const noun = result.recordCount === 1 ? "record" : "records";
    return `review validate-ledger: PASS (${result.recordCount} ${noun})`;
  }
  return renderReviewValidationResult(result, "review validate-ledger");
}

/**
 * Produce canonical source metadata for the operator to retain throughout the review.
 *
 * @throws CLIError when the request or selected source cannot be captured without ambiguity
 */
function renderReviewSnapshot(input: string, projectRoot: string): string {
  try {
    return canonicalReviewJson(captureReviewSnapshot(input, projectRoot));
  } catch (error) {
    // A branch may have been removed or a selected path may be a symlink; neither can become a fallback review source.
    throw new CLIError(
      error instanceof ReviewAuthorityError
        ? `${error.code}: ${error.message}`
        : "Cannot capture the selected review source.",
      2,
    );
  }
}

/**
 * Read the supplied report or request without silently replacing invalid UTF-8 bytes.
 *
 * @param path - saved input file; null reads stdin from the calling terminal or pipeline
 * @param stdinText - stdin text a caller holds, which the UTF-8 round-trip check cannot reject; undefined reads real stdin when no file is named
 *
 * @returns exact decoded input; empty text remains empty so the selected parser can report its missing content
 * @throws CLIError when stdin or the named file is unreadable or cannot round-trip as UTF-8
 */
function readReviewInput(path: string | null, stdinText?: string): string {
  try {
    // A named file always wins, as on the command line; only an omitted file falls back to the supplied stdin text.
    const bytes =
      path === null && stdinText !== undefined
        ? Buffer.from(stdinText, "utf8")
        : readFileSync(path ?? 0);
    const text = bytes.toString("utf8");
    // Lossy decoding could select a different literal filename than the operator supplied.
    if (!Buffer.from(text, "utf8").equals(bytes))
      throw new CLIError("Review input must be round-trip UTF-8.", 2);
    return text;
  } catch (error) {
    // A moved or unreadable saved report cannot be validated; report the input error before evaluating any evidence.
    throw new CLIError(
      `Cannot read review input: ${error instanceof Error ? error.message : String(error)}`,
      2,
    );
  }
}

/** The text one review command prints and the exit status it leaves; 1 marks a failed report or ledger whose issues were still printed. */
interface ReviewRequestResult {
  rendered: string;
  exitCode: number;
}

/**
 * Run one review command without printing, for example `goat-flow review validate < report.md`, and return what it would print.
 * The CLI handler prints the result; tests call this directly so they need not start a CLI process.
 *
 * @param options - parsed review request; a missing operation, a mismatched --expected-version or an unreadable input is a usage error
 * @param stdinText - stdin text a caller holds, which the UTF-8 round-trip check cannot reject; undefined reads real stdin when no file is named
 *
 * @returns the text to print, without its trailing newline, and the exit status: 0 for a pass, warnings included, and 1 for a failure
 * @throws CLIError when command usage is invalid, the reviewed project cannot be opened, the input cannot be read, or a snapshot cannot be captured
 */
export function runReviewRequest(
  options: ParsedCLI,
  stdinText?: string,
): ReviewRequestResult {
  validateReviewCommandUsage(options);
  const projectRoot =
    options.reviewSubcommand === "validate-ledger"
      ? options.projectPath
      : resolveReviewedProject(options.projectPath);
  assertOutputPreservesInput(options.output, options.reviewValidatePath ?? 0);
  const input = readReviewInput(options.reviewValidatePath, stdinText);
  return renderReviewInput(options, projectRoot, input);
}

/**
 * Read stdin or one saved validation input, run the selected review proof gate, and emit every issue.
 * Usage and read errors throw CLIError; structural failures set the process exit code after rendering.
 *
 * @param options - parsed review request; a missing validation operation or unreadable input path is a usage error
 *
 * @returns nothing; validation output is written through the shared CLI sink
 * @throws CLIError when command usage is invalid, the reviewed project cannot be opened, the input cannot be read, or a snapshot cannot be captured
 */
export function handleReviewCommand(options: ParsedCLI): void {
  const { rendered, exitCode } = runReviewRequest(options);
  writeOutput(options, rendered);
  // A failed report or ledger must signal failure to the operator's shell or calling tool even after every issue was printed.
  if (exitCode !== 0) process.exitCode = exitCode;
}

/** Refuse unsupported operations or validator versions before reading the operator's input; each refusal throws a usage error. */
function validateReviewCommandUsage(options: ParsedCLI): void {
  const actualVersion = getPackageVersion();
  // A skill can reject an older PATH binary before it reads report data or asks the operator for stdin.
  if (
    options.reviewExpectedVersion &&
    options.reviewExpectedVersion !== actualVersion
  )
    throw new CLIError(
      `Review validator version mismatch: expected ${JSON.stringify(options.reviewExpectedVersion)}, actual ${actualVersion}.`,
      2,
    );
  // Without an operation, the CLI cannot know which review artifact the operator wants checked.
  if (!options.reviewSubcommand) {
    throw new CLIError(
      'review requires subcommand "snapshot", "validate", "validate-draft", or "validate-ledger".',
      2,
    );
  }
  // Snapshot output is transient authority metadata; --output would create an unsupported persisted baseline.
  if (options.reviewSubcommand === "snapshot" && options.output)
    throw new CLIError(
      "review snapshot does not accept --output; retain its stdout metadata through the review.",
      2,
    );
}

/** Validate the selected input and return the result text and exit status the operator's request produces. */
function renderReviewInput(
  options: ParsedCLI,
  projectRoot: string,
  input: string,
): ReviewRequestResult {
  // The operator requested a source selection, so produce its authority before any report validation.
  if (options.reviewSubcommand === "snapshot") {
    return {
      rendered: renderReviewSnapshot(input, projectRoot),
      exitCode: 0,
    };
  }
  // Ledger-only validation checks its text grammar without claiming that a report has persisted it.
  if (options.reviewSubcommand === "validate-ledger") {
    const result = validateRefutationLedgerText(input);
    return {
      rendered: renderLedgerValidationResult(result),
      exitCode: result.status === "fail" ? 1 : 0,
    };
  }
  const result =
    options.reviewSubcommand === "validate-draft"
      ? validateReviewDraftEnvelope(input, projectRoot)
      : validateReviewReport(input, projectRoot);
  const rendered = renderReviewValidationResult(
    result,
    `review ${options.reviewSubcommand}`,
    options.reviewSubcommand === "validate-draft"
      ? "persistence unverified"
      : null,
  );
  // A failed report exits 1 even though all its repairable issues are still printed.
  return { rendered, exitCode: result.status === "fail" ? 1 : 0 };
}

/** Resolve the operator's chosen project once before any saved input is read; a missing directory throws a usage error. */
function resolveReviewedProject(selectedPath: string): string {
  try {
    const projectRoot = realpathSync(selectedPath);
    // Selecting a report file as the project cannot establish a directory for source evidence.
    if (!statSync(projectRoot).isDirectory())
      throw new Error("expected a directory");
    return projectRoot;
  } catch (error) {
    // A moved project folder or a file passed to --project needs a corrected path, not a fallback to this workspace.
    throw new CLIError(
      `Cannot open reviewed project ${JSON.stringify(selectedPath)}: ${error instanceof Error ? error.message : String(error)}`,
      2,
    );
  }
}
