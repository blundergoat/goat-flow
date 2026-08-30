/**
 * Checks transient refutation records and the persisted ledger a completed review cites.
 *
 * "I considered this and ruled it out" is only meaningful if the reasoning was written down, so a report claiming refutations must point at a real
 * local ledger with records in the expected grammar - not just assert a number.
 *
 * An empty or skipped ledger is legitimate and handled explicitly; what is refused is a report
 * that claims refutations while pointing at nothing a reader could go and check.
 */
import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { resolve } from "node:path";
import {
  REFUTATION_LEDGER_PATH,
  REFUTATION_LEDGER_RECORD,
  addViolation,
  type ReviewValidationResult,
  type ReviewValidationViolation,
  type IntegrityResult,
} from "./review-validate-common.js";
import { isWithinProject } from "./review-validate-anchors.js";

/** Validate the ledger marker used when no refutations were logged. */
function validateEmptyRefutationLedger(
  integrity: IntegrityResult,
  claimLine: number | null,
  violations: ReviewValidationViolation[],
): void {
  const ledgerClaim = integrity.refutationLedger;
  // Compact zero-finding reviews intentionally have no ledger fields.
  if (ledgerClaim === null && integrity.refutationsLine === null) return;
  if (ledgerClaim === "n/a") return;
  addViolation(
    violations,
    "refutation-ledger",
    claimLine,
    "zero refutations require Refutation ledger: n/a",
  );
}

/** Validate the ledger marker used when durable redaction was unavailable. */
function validateSkippedRefutationLedger(
  ledgerClaim: string | null,
  claimLine: number | null,
  violations: ReviewValidationViolation[],
): void {
  if (ledgerClaim === "persist-skipped") return;
  addViolation(
    violations,
    "refutation-ledger",
    claimLine,
    "persist-skipped refutations require Refutation ledger: persist-skipped",
  );
}

/** Read one exact, non-symlink ledger that resolves inside the reviewed project; it throws when the path escapes, is absent, or is redirected. */
function readDeclaredLedgerLines(
  projectRoot: string,
  ledgerClaim: string,
): string[] {
  const lexicalProjectRoot = resolve(projectRoot);
  const candidatePath = resolve(lexicalProjectRoot, ledgerClaim);
  if (!isWithinProject(lexicalProjectRoot, candidatePath)) {
    throw new Error("declared ledger is outside the project");
  }
  if (!existsSync(candidatePath)) {
    throw new Error("declared ledger is absent");
  }
  if (lstatSync(candidatePath).isSymbolicLink()) {
    throw new Error("declared ledger is a symlink");
  }

  const realProjectRoot = realpathSync(lexicalProjectRoot);
  const realLedgerPath = realpathSync(candidatePath);
  if (!isWithinProject(realProjectRoot, realLedgerPath)) {
    throw new Error("declared ledger resolves outside the project");
  }
  if (!statSync(realLedgerPath).isFile()) {
    throw new Error("declared ledger is not a regular project file");
  }
  return readFileSync(realLedgerPath, "utf-8")
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0);
}

/** Fail the first non-canonical ledger record. */
function validateLedgerRecordGrammar(
  lines: string[],
  claimLine: number | null,
  violations: ReviewValidationViolation[],
): boolean {
  const invalidLine = lines.findIndex(
    (line) => !REFUTATION_LEDGER_RECORD.test(line),
  );
  if (invalidLine < 0) return true;
  addViolation(
    violations,
    "refutation-ledger",
    claimLine,
    `ledger record ${invalidLine + 1} does not match the required one-line grammar`,
  );
  return false;
}

/** Validate the path, grammar, and exact record count of a persisted ledger; it reports each problem as a violation rather than throwing. */
function validatePersistedRefutationLedger(
  projectRoot: string,
  integrity: IntegrityResult,
  claimLine: number | null,
  violations: ReviewValidationViolation[],
  shouldVerifyPersistedLedger: boolean,
): void {
  const ledgerClaim = integrity.refutationLedger;
  if (!ledgerClaim || !REFUTATION_LEDGER_PATH.test(ledgerClaim)) {
    addViolation(
      violations,
      "refutation-ledger",
      claimLine,
      "persisted refutations require one declared goat-review-refutations.<random>.txt ledger path",
    );
    return;
  }

  if (!shouldVerifyPersistedLedger) return;

  try {
    const ledgerLines = readDeclaredLedgerLines(projectRoot, ledgerClaim);
    if (!validateLedgerRecordGrammar(ledgerLines, claimLine, violations))
      return;
    if (ledgerLines.length !== integrity.refutationsLogged) {
      addViolation(
        violations,
        "refutation-ledger",
        claimLine,
        `declared ledger has ${ledgerLines.length} records but Refutations logged claims ${integrity.refutationsLogged}`,
      );
    }
  } catch (error) {
    addViolation(
      violations,
      "refutation-ledger",
      claimLine,
      `cannot verify declared refutation ledger: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Check that one declared ledger contains exactly the claimed canonical records.
 *
 * @param projectRoot - reviewed project root; anchors are confined to it so a report cannot cite files it was never authorised to read
 * @param integrity - the parsed Review Integrity block; absent fields are reported individually rather than failing the whole block
 * @param violations - shared violation list, appended in report order so a reader sees issues top-down; a violation makes the report fail
 * @param shouldVerifyPersistedLedger - false checks the declaration only, before the transient bytes are persisted
 */
export function validateRefutationLedger(
  projectRoot: string,
  integrity: IntegrityResult,
  violations: ReviewValidationViolation[],
  shouldVerifyPersistedLedger = true,
): void {
  const claimLine = integrity.refutationLedgerLine ?? integrity.refutationsLine;
  if (integrity.refutationsLogged === 0) {
    validateEmptyRefutationLedger(integrity, claimLine, violations);
    return;
  }
  if (integrity.isRefutationPersistenceSkipped) {
    validateSkippedRefutationLedger(
      integrity.refutationLedger,
      claimLine,
      violations,
    );
    return;
  }
  validatePersistedRefutationLedger(
    projectRoot,
    integrity,
    claimLine,
    violations,
    shouldVerifyPersistedLedger,
  );
}

/**
 * Validate transient ledger bytes before the redactor is allowed to persist them.
 *
 * @param text - raw in-memory ledger records, one per non-empty line
 * @returns structural status and the exact record count a report draft must declare
 */
export function validateRefutationLedgerText(
  text: string,
): ReviewValidationResult & { recordCount: number } {
  const lines = text.split(/\r?\n/u).filter((line) => line.trim().length > 0);
  const violations: ReviewValidationViolation[] = [];
  if (lines.length === 0) {
    addViolation(
      violations,
      "refutation-ledger",
      null,
      "refutation ledger must contain at least one canonical record",
    );
  } else {
    validateLedgerRecordGrammar(lines, null, violations);
  }
  return {
    status: violations.length === 0 ? "pass" : "fail",
    violations,
    warnings: [],
    recordCount: lines.length,
  };
}
