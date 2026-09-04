/**
 * Exposes explicit inspection and identity-bound recovery for one abandoned path-write claim.
 * The command never infers abandonment: the operator supplies the inspected digest and a separate confirmation flag.
 */
import { CLIError } from "./cli-error.js";
import { writeOutput } from "./cli-output.js";
import { assertTerminalSafeClaimArgument } from "./cli-parser-positionals.js";
import type { ParsedCLI } from "./cli-types.js";
import { quoteManagedInstallProjectArgument } from "./managed-install-evidence.js";
import {
  inspectPathWriteClaim,
  PathWriteClaimError,
  removeConfirmedAbandonedPathWriteClaim,
  type AbandonedPathWriteClaimEvidence,
} from "./path-write-claim.js";

const CLAIM_RECOVERY_SCHEMA = "goat-flow.path-write-claim-recovery.v1" as const;

/** Stable terminal/JSON result for one successful inspection or removal. */
interface PathWriteClaimRecoveryReport {
  schemaVersion: typeof CLAIM_RECOVERY_SCHEMA;
  command: "claims";
  subcommand: "inspect" | "recover";
  status: "present" | "absent" | "removed";
  projectRoot: string;
  targetPath: string;
  markerPath: string | null;
  markerSha256: string | null;
}

/** Parser-validated claim options shared by inspection, recovery, and rendering helpers. */
type ValidatedClaimsOptions = ParsedCLI & {
  claimsSubcommand: "inspect" | "recover";
  claimsTargetPath: string;
};

/**
 * Build the exact read-only command shown by every writer that encounters a busy target.
 *
 * @param projectRoot - selected project whose coordination state is inspected
 * @param targetPath - normalized project-relative path named by the busy claim
 * @returns one platform-quoted public inspection command
 */
export function pathWriteClaimInspectCommand(
  projectRoot: string,
  targetPath: string,
): string {
  return `goat-flow claims inspect ${quoteManagedInstallProjectArgument(projectRoot)} --target ${quoteManagedInstallProjectArgument(targetPath)}`;
}

/** Build the explicit mutation command only after inspection returned a concrete marker identity. */
function pathWriteClaimRecoveryCommand(
  evidence: AbandonedPathWriteClaimEvidence,
): string {
  return `goat-flow claims recover ${quoteManagedInstallProjectArgument(evidence.projectRoot)} --target ${quoteManagedInstallProjectArgument(evidence.targetPath)} --marker-sha256 ${evidence.markerSha256} --confirm-abandoned`;
}

/** Convert inspected evidence into the stable public output envelope. */
function claimReport(
  options: ValidatedClaimsOptions,
  evidence: AbandonedPathWriteClaimEvidence | null,
  status: PathWriteClaimRecoveryReport["status"],
): PathWriteClaimRecoveryReport {
  return {
    schemaVersion: CLAIM_RECOVERY_SCHEMA,
    command: "claims",
    subcommand: options.claimsSubcommand,
    status,
    projectRoot: evidence?.projectRoot ?? options.projectPath,
    targetPath: evidence?.targetPath ?? options.claimsTargetPath,
    markerPath: evidence?.markerPath ?? null,
    markerSha256: evidence?.markerSha256 ?? null,
  };
}

/** Render the operator boundary without implying that marker presence proves abandonment. */
function renderClaimReport(
  report: PathWriteClaimRecoveryReport,
  evidence: AbandonedPathWriteClaimEvidence | null,
): string {
  const lines = [
    `Path-write claim: ${report.status}`,
    `Project root: ${report.projectRoot}`,
    `Target: ${report.targetPath}`,
  ];
  if (report.status === "absent") {
    return [...lines, "No marker exists; nothing was removed."].join("\n");
  }
  lines.push(
    `Marker: ${report.markerPath ?? ""}`,
    `Marker SHA-256: ${report.markerSha256 ?? ""}`,
  );
  if (report.status === "removed") {
    return [
      ...lines,
      "Removed only the unchanged marker identified by the inspected SHA-256.",
    ].join("\n");
  }
  if (evidence === null) return lines.join("\n");
  return [
    ...lines,
    "No writer liveness or abandonment was inferred.",
    "Confirm that no writer still owns this target before recovery.",
    "Recovery command:",
    `  ${pathWriteClaimRecoveryCommand(evidence)}`,
  ].join("\n");
}

/** Turn a validated claim helper refusal into one actionable CLI error without weakening it. */
function claimInspectionError(
  error: PathWriteClaimError,
  projectRoot: string,
  targetPath: string,
): CLIError {
  const exitCode = error.reason === "invalid-target" ? 2 : 1;
  return new CLIError(
    `Could not inspect the path-write claim for ${targetPath}: ${error.message} Nothing was removed. Run ${pathWriteClaimInspectCommand(projectRoot, targetPath)} after correcting the problem.`,
    exitCode,
  );
}

/**
 * Require the complete parser-owned command shape for programmatic dispatch callers too.
 * Error behavior: throws a usage error before marker access when required fields, terminal output, or format constraints are bypassed.
 */
function validateClaimsOptions(
  options: ParsedCLI,
): asserts options is ValidatedClaimsOptions {
  if (options.claimsSubcommand === null || options.claimsTargetPath === null) {
    throw new CLIError(
      "Usage: goat-flow claims <inspect|recover> [project-path] --target <project-relative-path> [flags]",
      2,
    );
  }
  if (options.output !== null) {
    throw new CLIError(
      "claims is terminal-only and does not support --output.",
      2,
    );
  }
  if (options.format !== "text" && options.format !== "json") {
    throw new CLIError("claims supports only text or json output.", 2);
  }
  assertTerminalSafeClaimArgument("project path", options.projectPath);
  assertTerminalSafeClaimArgument("target path", options.claimsTargetPath);
}

/**
 * Inspect one marker and preserve the helper's fail-closed diagnostics as a public CLI error.
 * Error behavior: throws CLIError for known claim errors; unexpected filesystem errors propagate.
 */
function inspectClaim(
  options: ValidatedClaimsOptions,
): AbandonedPathWriteClaimEvidence | null {
  try {
    return inspectPathWriteClaim(options.projectPath, options.claimsTargetPath);
  } catch (error) {
    if (error instanceof PathWriteClaimError) {
      throw claimInspectionError(
        error,
        options.projectPath,
        options.claimsTargetPath,
      );
    }
    throw error;
  }
}

/** Write one successful claim result through the selected text or JSON output contract. */
function writeClaimReport(
  options: ValidatedClaimsOptions,
  evidence: AbandonedPathWriteClaimEvidence | null,
  status: PathWriteClaimRecoveryReport["status"],
): void {
  const report = claimReport(options, evidence, status);
  writeOutput(
    options,
    options.format === "json"
      ? JSON.stringify(report, null, 2)
      : renderClaimReport(report, evidence),
  );
}

/**
 * Require matching inspected evidence and remove only that unchanged abandoned marker.
 * Error behavior: throws CLIError without removal for absent, mismatched, changed, or unconfirmed evidence; unexpected helper errors propagate.
 */
function recoverClaim(
  options: ValidatedClaimsOptions,
  evidence: AbandonedPathWriteClaimEvidence | null,
): AbandonedPathWriteClaimEvidence {
  if (options.claimsMarkerSha256 === null || !options.shouldConfirmAbandoned) {
    throw new CLIError(
      "claims recover requires --marker-sha256 and --confirm-abandoned after you verify that no writer still owns the target.",
      2,
    );
  }
  const inspectAgain = pathWriteClaimInspectCommand(
    options.projectPath,
    options.claimsTargetPath,
  );
  if (evidence === null) {
    throw new CLIError(
      `No path-write claim exists for ${options.claimsTargetPath}. Nothing was removed. Run ${inspectAgain} again before recovery.`,
      1,
    );
  }
  if (evidence.markerSha256 !== options.claimsMarkerSha256) {
    throw new CLIError(
      `The path-write claim for ${evidence.targetPath} does not match --marker-sha256. Nothing was removed. Run ${inspectAgain} again before recovery.`,
      1,
    );
  }

  const removal = removeConfirmedAbandonedPathWriteClaim(evidence);
  if (removal !== "removed") {
    throw new CLIError(
      `The path-write claim for ${evidence.targetPath} ${removal === "missing" ? "disappeared" : "changed"} after inspection. Nothing was removed. Run ${inspectAgain} again before recovery.`,
      1,
    );
  }
  return evidence;
}

/**
 * Inspect one marker or remove only the unchanged marker the operator explicitly confirmed as abandoned.
 * Error behavior: invalid or changed evidence throws a CLI error and leaves the marker in place; unexpected filesystem errors propagate.
 *
 * @param options - parsed claim action, target, confirmation, and output format
 * @returns nothing; the command writes its successful report through the shared CLI sink
 */
export function handleClaimsCommand(options: ParsedCLI): void {
  validateClaimsOptions(options);
  const evidence = inspectClaim(options);

  if (options.claimsSubcommand === "inspect") {
    writeClaimReport(
      options,
      evidence,
      evidence === null ? "absent" : "present",
    );
    return;
  }

  writeClaimReport(options, recoverClaim(options, evidence), "removed");
}
