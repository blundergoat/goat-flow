/**
 * Deterministic validation for goat-review ledgers, pending drafts, and completed reports.
 * The validator reads only supplied input, semantic-anchor files under the reviewed project, and claimed local refutation ledgers; it never persists
 * review artifacts.
 */
import { readFileSync } from "node:fs";
import { CLIError } from "./cli-error.js";
import type { ParsedCLI } from "./cli-types.js";
import { writeOutput } from "./cli-output.js";
import { maskNonRenderedMarkdown } from "./rendered-markdown.js";
import {
  REVIEW_DRAFT_LEDGER_MARKER,
  addViolation,
  type IntegrityResult,
  type ReviewValidationResult,
  type ReviewValidationStage,
  type ReviewValidationViolation,
} from "./review-validate-common.js";
import { validateIntegrity } from "./review-validate-integrity.js";
import {
  validateRefutationLedger,
  validateRefutationLedgerText,
} from "./review-validate-ledger.js";
import {
  countFindingCandidates,
  readTopFiveSection,
  validateConditionalSections,
  validateFindingSections,
  validateIntegrityCounts,
  validateRefuterReferences,
  validateSectionAnchors,
  validateSpecDrift,
  validateTopFiveReferences,
  validateUniqueFindingIds,
} from "./review-validate-sections.js";
import { validateShipVerdict } from "./review-validate-verdict.js";

/** Parsed integrity retained beside the public result for draft-envelope checks. */
interface ReviewEvaluation {
  integrity: IntegrityResult;
  result: ReviewValidationResult;
}

/**
 * Evaluate one report while retaining parsed integrity for draft-envelope checks.
 *
 * @param markdown - human-readable report without a transient ledger appendix
 * @param projectRoot - reviewed project whose anchors and ledgers must resolve
 * @param shouldVerifyPersistedLedger - whether the declared ledger must already exist
 * @param validationStage - pending draft or completed final report
 * @returns parsed integrity and deterministic public validation result
 */
function evaluateReviewReport(
  markdown: string,
  projectRoot: string,
  shouldVerifyPersistedLedger: boolean,
  validationStage: ReviewValidationStage,
): ReviewEvaluation {
  const lines = maskNonRenderedMarkdown(markdown).split(/\r?\n/u);
  const violations: ReviewValidationViolation[] = [];
  const warnings: ReviewValidationViolation[] = [];
  const integrity = validateIntegrity(
    lines,
    countFindingCandidates(lines),
    violations,
    warnings,
    validationStage,
  );
  const definitions = validateFindingSections(
    lines,
    integrity.isAreaAudit,
    projectRoot,
    integrity.anchorAuthority,
    violations,
  );
  validateUniqueFindingIds(definitions, violations);
  validateIntegrityCounts(integrity, definitions, violations);
  validateShipVerdict(lines, integrity, definitions, violations);
  const topFive = readTopFiveSection(lines, violations);
  validateSectionAnchors(
    topFive,
    projectRoot,
    integrity.anchorAuthority,
    violations,
  );
  validateTopFiveReferences(topFive, definitions, violations);
  validateRefuterReferences(lines, definitions, violations);
  validateSpecDrift(lines, violations);
  validateConditionalSections(lines, topFive, definitions, warnings);
  validateRefutationLedger(
    projectRoot,
    integrity,
    violations,
    shouldVerifyPersistedLedger,
  );
  if (
    validationStage === "final" &&
    markdown
      .split(/\r?\n/u)
      .some((line) => line.trim() === REVIEW_DRAFT_LEDGER_MARKER)
  ) {
    addViolation(
      violations,
      "integrity-format",
      null,
      "final review must not include the transient draft-ledger marker",
    );
  }
  return {
    integrity,
    result: {
      status: violations.length === 0 ? "pass" : "fail",
      violations,
      warnings,
    },
  };
}

/**
 * Validate a completed report, including the exact persisted ledger it declares.
 *
 * @param markdown - completed human-readable review report
 * @param projectRoot - reviewed project whose anchors and ledger must resolve
 * @returns deterministic status plus structural violations and advisory warnings
 */
export function validateReviewReport(
  markdown: string,
  projectRoot: string,
): ReviewValidationResult {
  return evaluateReviewReport(markdown, projectRoot, true, "final").result;
}

/** Split the exact transient marker from the report bytes it must not enter. */
function splitReviewDraftEnvelope(input: string): {
  ledgerText: string | null;
  markerCount: number;
  reportMarkdown: string;
} {
  const lines = input.split(/\r?\n/u);
  const markerIndexes = lines.flatMap((line, index) =>
    line.trim() === REVIEW_DRAFT_LEDGER_MARKER ? [index] : [],
  );
  const firstMarker = markerIndexes.at(0);
  if (firstMarker === undefined) {
    return { ledgerText: null, markerCount: 0, reportMarkdown: input };
  }
  return {
    ledgerText: lines.slice(firstMarker + 1).join("\n"),
    markerCount: markerIndexes.length,
    reportMarkdown: `${lines.slice(0, firstMarker).join("\n")}\n`,
  };
}

/** Bind one report's refutation claim to the exact transient records in its draft envelope. */
function validateDraftLedgerEnvelope(
  ledgerText: string | null,
  markerCount: number,
  integrity: IntegrityResult,
  violations: ReviewValidationViolation[],
): void {
  if (markerCount > 1) {
    addViolation(
      violations,
      "refutation-ledger",
      null,
      "review draft envelope must contain exactly one ledger marker",
    );
    return;
  }
  if (integrity.refutationsLogged === 0) {
    if (markerCount > 0) {
      addViolation(
        violations,
        "refutation-ledger",
        null,
        "zero refutations must not include a draft-ledger appendix",
      );
    }
    return;
  }
  if (ledgerText === null) {
    addViolation(
      violations,
      "refutation-ledger",
      integrity.refutationsLine,
      `nonzero refutations require ${REVIEW_DRAFT_LEDGER_MARKER} followed by the transient records`,
    );
    return;
  }
  const ledgerResult = validateRefutationLedgerText(ledgerText);
  violations.push(...ledgerResult.violations);
  if (ledgerResult.recordCount !== integrity.refutationsLogged) {
    addViolation(
      violations,
      "refutation-ledger",
      integrity.refutationsLine,
      `draft ledger has ${ledgerResult.recordCount} records but Refutations logged claims ${integrity.refutationsLogged}`,
    );
  }
}

/** Validate one pending report and its transient ledger together before persistence. */
function validateReviewDraftEnvelope(
  input: string,
  projectRoot: string,
): ReviewValidationResult {
  const envelope = splitReviewDraftEnvelope(input);
  const evaluation = evaluateReviewReport(
    envelope.reportMarkdown,
    projectRoot,
    false,
    "draft",
  );
  validateDraftLedgerEnvelope(
    envelope.ledgerText,
    envelope.markerCount,
    evaluation.integrity,
    evaluation.result.violations,
  );
  evaluation.result.status =
    evaluation.result.violations.length === 0 ? "pass" : "fail";
  return evaluation.result;
}

/** Build the one-line command verdict before individual issues are appended. */
function renderReviewValidationHeader(
  result: ReviewValidationResult,
  commandLabel: string,
  passContext: string | null,
): string {
  const warningCount = result.warnings.length;
  const warningLabel = `${warningCount} ${warningCount === 1 ? "warning" : "warnings"}`;
  const passContextSuffix = passContext ? ` (${passContext})` : "";
  const contextualWarningLabel = passContext
    ? `${warningLabel}; ${passContext}`
    : warningLabel;
  const failureWarningSuffix = warningCount > 0 ? `, ${warningLabel}` : "";
  if (result.status === "pass") {
    if (warningCount === 0) {
      return `${commandLabel}: PASS${passContextSuffix}`;
    }
    return `${commandLabel}: PASS (${contextualWarningLabel})`;
  }
  return `${commandLabel}: FAIL (${result.violations.length} violations${failureWarningSuffix})`;
}

/**
 * Render a deterministic human-readable validation result for shell pipelines.
 *
 * @param result - pure validation result
 * @param commandLabel - subcommand name shown in the verdict header
 * @param passContext - optional qualifier appended to a passing header
 * @returns a PASS/FAIL header followed by each structural violation and warning
 */
export function renderReviewValidationResult(
  result: ReviewValidationResult,
  commandLabel = "review validate",
  passContext: string | null = null,
): string {
  const lines = [
    renderReviewValidationHeader(result, commandLabel, passContext),
  ];
  for (const violation of result.violations) {
    const location =
      violation.line === null ? "report" : `line ${violation.line}`;
    lines.push(
      `${location} [${violation.checkId}/${violation.code}] ERROR ${violation.message}`,
    );
  }
  for (const warning of result.warnings) {
    const location = warning.line === null ? "report" : `line ${warning.line}`;
    lines.push(
      `${location} [${warning.checkId}/${warning.code}] WARN ${warning.message}`,
    );
  }
  return lines.join("\n");
}

/** Render the transient ledger gate with the exact record count a report must claim. */
function renderLedgerValidationResult(
  result: ReturnType<typeof validateRefutationLedgerText>,
): string {
  if (result.status === "pass") {
    const noun = result.recordCount === 1 ? "record" : "records";
    return `review validate-ledger: PASS (${result.recordCount} ${noun})`;
  }
  return renderReviewValidationResult(result, "review validate-ledger");
}

/**
 * Read stdin or one saved validation input, run the selected review proof gate, and emit every issue.
 * Usage and read errors throw CLIError; structural failures set the process exit code after rendering.
 *
 * @param options - parsed review request; a missing validation operation or unreadable input path is a usage error
 * @returns nothing; validation output is written through the shared CLI sink
 * @throws CLIError when command usage is invalid or the selected input cannot be read
 */
export function handleReviewCommand(options: ParsedCLI): void {
  if (!options.reviewSubcommand) {
    throw new CLIError(
      'review requires subcommand "validate", "validate-draft", or "validate-ledger".',
      2,
    );
  }
  let input: string;
  try {
    input = readFileSync(options.reviewValidatePath ?? 0, "utf-8");
  } catch (error) {
    throw new CLIError(
      `Cannot read review input: ${error instanceof Error ? error.message : String(error)}`,
      2,
    );
  }
  if (options.reviewSubcommand === "validate-ledger") {
    const result = validateRefutationLedgerText(input);
    writeOutput(options, renderLedgerValidationResult(result));
    if (result.status === "fail") process.exitCode = 1;
    return;
  }
  const result =
    options.reviewSubcommand === "validate-draft"
      ? validateReviewDraftEnvelope(input, options.projectPath)
      : validateReviewReport(input, options.projectPath);
  const rendered = renderReviewValidationResult(
    result,
    `review ${options.reviewSubcommand}`,
    options.reviewSubcommand === "validate-draft"
      ? "persistence unverified"
      : null,
  );
  writeOutput(options, rendered);
  if (result.status === "fail") process.exitCode = 1;
}
