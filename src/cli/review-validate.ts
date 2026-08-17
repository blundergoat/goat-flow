/**
 * Deterministic validation for drafted goat-review Markdown.
 * The validator reads only the supplied report, semantic-anchor files under the reviewed project, and claimed local refutation ledgers; it never
 * persists reports.
 */
import { readFileSync } from "node:fs";
import { CLIError } from "./cli-error.js";
import type { ParsedCLI } from "./cli-types.js";
import { writeOutput } from "./cli-output.js";
import { maskNonRenderedMarkdown } from "./rendered-markdown.js";
import {
  type ReviewValidationResult,
  type ReviewValidationViolation,
} from "./review-validate-common.js";
import { validateIntegrity } from "./review-validate-integrity.js";
import { validateRefutationLedger } from "./review-validate-ledger.js";
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

/**
 * Validate a drafted goat-review report against files in the reviewed project root.
 *
 * @param markdown - drafted human-readable review report
 * @param projectRoot - reviewed project whose anchors and ledgers must resolve
 * @returns deterministic status plus structural violations and advisory warnings
 */
export function validateReviewReport(
  markdown: string,
  projectRoot: string,
): ReviewValidationResult {
  const lines = maskNonRenderedMarkdown(markdown).split(/\r?\n/u);
  const violations: ReviewValidationViolation[] = [];
  const warnings: ReviewValidationViolation[] = [];
  const integrity = validateIntegrity(
    lines,
    countFindingCandidates(lines),
    violations,
    warnings,
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
  validateRefutationLedger(projectRoot, integrity, violations);
  return {
    status: violations.length === 0 ? "pass" : "fail",
    violations,
    warnings,
  };
}

/**
 * Render a deterministic human-readable validation result for shell pipelines.
 *
 * @param result - pure validation result
 * @returns a PASS/FAIL header followed by each structural violation and warning
 */
export function renderReviewValidationResult(
  result: ReviewValidationResult,
): string {
  if (result.status === "pass" && result.warnings.length === 0) {
    return "review validate: PASS";
  }
  const warningLabel = `${result.warnings.length} ${result.warnings.length === 1 ? "warning" : "warnings"}`;
  const warningSuffix = result.warnings.length > 0 ? `, ${warningLabel}` : "";
  const lines =
    result.status === "pass"
      ? [`review validate: PASS (${warningLabel})`]
      : [
          `review validate: FAIL (${result.violations.length} violations${warningSuffix})`,
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

/**
 * Read stdin or one saved report, validate it against the selected project, and emit every issue.
 * Usage and read errors throw CLIError; structural report failures set the process exit code after rendering.
 *
 * @param options - parsed review request; a missing validate subcommand or unreadable path is a usage error
 * @returns nothing; validation output is written through the shared CLI sink
 * @throws CLIError when command usage is invalid or the report cannot be read
 */
export function handleReviewCommand(options: ParsedCLI): void {
  if (options.reviewSubcommand !== "validate") {
    throw new CLIError('review requires subcommand "validate".', 2);
  }
  let markdown: string;
  try {
    markdown = readFileSync(options.reviewValidatePath ?? 0, "utf-8");
  } catch (error) {
    throw new CLIError(
      `Cannot read review report: ${error instanceof Error ? error.message : String(error)}`,
      2,
    );
  }
  const result = validateReviewReport(markdown, options.projectPath);
  writeOutput(options, renderReviewValidationResult(result));
  if (result.status === "fail") process.exitCode = 1;
}
