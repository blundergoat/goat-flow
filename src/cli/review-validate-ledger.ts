/**
 * Check the review receipts named by pending drafts and completed reports.
 *
 * Use the same path checks for bundles and refutation ledgers so neither can hide a redirected file or parent.
 * Drafts require fresh destinations; final reports require safe existing files unless persistence is explicitly skipped.
 * Counted ledger records give each refuted suspicion one inspectable ID.
 */
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  type Stats,
} from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import {
  REFUTATION_LEDGER_PATH,
  REFUTATION_LEDGER_RECORD,
  addViolation,
  SCOPE_SNAPSHOT,
  REVIEW_BUNDLE_PATH,
  type ReviewValidationResult,
  type ReviewValidationViolation,
  type IntegrityResult,
  type ReviewValidationStage,
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
  // An omitted ledger is normalized to n/a when the report has no refutations to persist.
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
  // The explicit skip marker keeps unavailable persistence visible without inventing a receipt path.
  if (ledgerClaim === "persist-skipped") return;
  addViolation(
    violations,
    "refutation-ledger",
    claimLine,
    "persist-skipped refutations require Refutation ledger: persist-skipped",
  );
}

/** Compare the retained filesystem entry with a later observation; changed bytes or a replacement cannot keep receipt credit. */
function sameReceiptEntry(before: Stats, after: Stats): boolean {
  return (
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.mode === after.mode &&
    before.size === after.size &&
    before.mtimeMs === after.mtimeMs &&
    before.ctimeMs === after.ctimeMs
  );
}

/**
 * Read a final receipt or check a fresh draft destination without writing anything.
 * Use for both bundle and ledger paths so a safe leaf cannot hide redirected parent directories.
 *
 * @param projectRoot - selected project; its canonical root contains every accepted receipt
 * @param receipt - project-relative path under the review log directory
 * @param stage - draft checks a future destination; final requires an existing regular file
 * @returns final bytes, including an allowed empty bundle; null means draft persistence remains unverified
 * @throws Error when a path is absent at final, already exists at draft, is redirected, or changes during the read
 */
export function readReviewReceipt(
  projectRoot: string,
  receipt: string,
  stage: ReviewValidationStage,
): Buffer | null {
  const root = realpathSync(projectRoot);
  const candidate = resolve(root, receipt);
  const receiptDirectory = join(root, ".goat-flow", "logs", "review");
  // A receipt outside the review directory is not part of the report's retained evidence.
  if (
    !isWithinProject(receiptDirectory, candidate) ||
    candidate === receiptDirectory
  )
    throw new Error("declared receipt is outside the review directory");
  const observed = inspectReceiptPath(root, candidate, stage);
  // A safe future destination has no final bytes to validate yet.
  if (observed === null) return null;
  return readUnchangedReceipt(candidate, observed);
}

/** Inspect the named receipt and its parents; null leaves draft persistence explicitly unverified. */
function inspectReceiptPath(
  root: string,
  candidate: string,
  stage: ReviewValidationStage,
): Array<{ path: string; details: Stats }> | null {
  const parts = relative(root, candidate).split(sep);
  const observed: Array<{ path: string; details: Stats }> = [
    { path: root, details: lstatSync(root) },
  ];
  let current = root;
  // Inspect each directory before the leaf so an internal symlink cannot redirect a seemingly contained path.
  for (let index = 0; index < parts.length; index += 1) {
    current = join(current, parts[index]!);
    const details = lstatSync(current, { throwIfNoEntry: false });
    // A future draft path may have missing parents; the validator reserves nothing and promises no persistence.
    if (!details) {
      // A final report must point to an existing receipt; only a draft may name a future destination.
      if (stage === "final") throw new Error("declared receipt is absent");
      assertReceiptEntries(observed);
      return null;
    }
    // Even a symlink pointing back inside the project changes who owns the receipt destination.
    if (details.isSymbolicLink())
      throw new Error("declared receipt has a symlink leaf or ancestor");
    const isLeaf = index === parts.length - 1;
    // Existing draft leaves would overwrite evidence from another review.
    if (isLeaf && stage === "draft")
      throw new Error("draft receipt destination already exists");
    // A folder cannot stand in for receipt bytes, and a file cannot serve as a receipt directory.
    if (isLeaf ? !details.isFile() : !details.isDirectory())
      throw new Error("declared receipt has an invalid file or directory type");
    observed.push({ path: current, details });
  }
  return observed;
}

/** Read the inspected file once and reject observed substitution before crediting its retained evidence. */
function readUnchangedReceipt(
  candidate: string,
  observed: Array<{ path: string; details: Stats }>,
): Buffer {
  const descriptor = openSync(
    candidate,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const opened = fstatSync(descriptor);
    // A replacement between path inspection and open cannot supply the bytes the report originally named.
    if (!sameReceiptEntry(observed.at(-1)!.details, opened))
      throw new Error("declared receipt changed before open");
    const bytes = readFileSync(descriptor);
    // Changing the opened file during its read invalidates the evidence the report named.
    if (!sameReceiptEntry(opened, fstatSync(descriptor)))
      throw new Error("declared receipt changed during read");
    assertReceiptEntries(observed);
    return bytes;
  } finally {
    closeSync(descriptor);
  }
}

/** Recheck every observed entry after reading; a replaced parent or leaf throws instead of validating substituted evidence. */
function assertReceiptEntries(
  entries: Array<{ path: string; details: Stats }>,
): void {
  // Each retained ancestor must still identify the directory inspected before the receipt was opened.
  for (const entry of entries) {
    const after = lstatSync(entry.path);
    const unchanged = entry.details.isDirectory()
      ? entry.details.dev === after.dev &&
        entry.details.ino === after.ino &&
        entry.details.mode === after.mode
      : sameReceiptEntry(entry.details, after);
    // A replaced leaf or parent cannot retain credit from the path inspected before the read.
    if (!unchanged)
      throw new Error("declared receipt or ancestor changed during validation");
  }
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
  // Once record grammar is valid, unique IDs establish how many distinct suspicions were refuted.
  if (invalidLine < 0) {
    const ids = lines.map((line) => line.match(/^-\s+(R-\d{3})\s/u)![1]);
    // The same suspicion cannot earn several refutations merely by repeating its ledger record.
    if (new Set(ids).size === ids.length) return true;
    addViolation(
      violations,
      "refutation-ledger",
      claimLine,
      "refutation ledger contains duplicate R-IDs",
    );
    return false;
  }
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
  // A nonzero persisted count needs one exact ledger path so the reviewer can inspect its records.
  if (!ledgerClaim || !REFUTATION_LEDGER_PATH.test(ledgerClaim)) {
    addViolation(
      violations,
      "refutation-ledger",
      claimLine,
      "persisted refutations require one declared goat-review-refutations.<random>.txt ledger path",
    );
    return;
  }

  try {
    const bytes = readReviewReceipt(
      projectRoot,
      ledgerClaim,
      shouldVerifyPersistedLedger ? "final" : "draft",
    );
    // Draft path checks cannot claim that their transient ledger has been persisted.
    if (bytes === null) return;
    const ledgerLines = bytes
      .toString("utf8")
      .split(/\r?\n/u)
      .filter((line) => line.trim().length > 0);
    // Malformed or repeated records cannot contribute IDs to the report's final disposition map.
    if (!validateLedgerRecordGrammar(ledgerLines, claimLine, violations))
      return;
    integrity.ledgerIds = ledgerLines.map(
      (line) => line.match(/^-\s+(R-\d{3})\s/u)![1]!,
    );
    // The saved records must account for the exact number of refutations claimed to the reader.
    if (ledgerLines.length !== integrity.refutationsLogged) {
      addViolation(
        violations,
        "refutation-ledger",
        claimLine,
        `declared ledger has ${ledgerLines.length} records but Refutations logged claims ${integrity.refutationsLogged}`,
      );
    }
  } catch (error) {
    // A reviewer may move a receipt, point at a linked folder, or supply malformed records; show the concrete repairable cause.
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
  // A zero-refutation review has no ledger contents to verify.
  if (integrity.refutationsLogged === 0) {
    validateEmptyRefutationLedger(integrity, claimLine, violations);
    return;
  }
  // The disclosed persistence skip permits count checks but cannot prove any saved ledger contents.
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
): ReviewValidationResult & { recordCount: number; ids: string[] } {
  const lines = text.split(/\r?\n/u).filter((line) => line.trim().length > 0);
  const violations: ReviewValidationViolation[] = [];
  // An empty transient ledger cannot substantiate the nonzero refutation work sent to this command.
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
    ids:
      violations.length === 0
        ? lines.map((line) => line.match(/^-\s+(R-\d{3})\s/u)![1]!)
        : [],
  };
}

/**
 * Check the bundle's final file or fresh draft destination without granting it raw-source authority.
 *
 * @param projectRoot - selected project whose review directory contains the receipt
 * @param integrity - parsed scope and persistence claims; absent scope is diagnosed by its owning field check
 * @param violations - report errors to append when receipt claims disagree or the named file is unsafe
 */
export function validateBundleReceipt(
  projectRoot: string,
  integrity: IntegrityResult,
  violations: ReviewValidationViolation[],
): void {
  const field = integrity.fields.get("Scope snapshot");
  // Missing scope was already refused; there is no declared receipt to inspect.
  if (!field) return;
  const bundle = field.value.match(SCOPE_SNAPSHOT)?.[8]?.trim();
  // Malformed scope already blocks review; a persistence skip must remain paired with its visible limitation.
  if (!bundle) return;
  const isSkipped = validateBundlePersistenceClaim(
    bundle,
    integrity,
    violations,
  );
  // A disclosed skip has no file to read; malformed path grammar was reported with the scope field.
  if (isSkipped || !REVIEW_BUNDLE_PATH.test(bundle)) return;
  try {
    readReviewReceipt(projectRoot, bundle, integrity.validationStage);
  } catch (error) {
    // A renamed bundle or redirected log folder cannot substantiate the retained receipt claimed by the reviewer.
    addViolation(
      violations,
      "integrity-format",
      field.line,
      `cannot verify declared review bundle: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Align bundle and refutation skip markers with the report's persistence disclosure. */
function validateBundlePersistenceClaim(
  bundle: string,
  integrity: IntegrityResult,
  violations: ReviewValidationViolation[],
): boolean {
  const isSkipped = bundle === "persist-skipped: redactor-unavailable";
  // A report cannot claim both retained evidence and an inability to persist that same evidence.
  if (
    isSkipped !==
      integrity.flags.has("persist-skipped: redactor-unavailable") ||
    (integrity.refutationsLogged > 0 &&
      integrity.isRefutationPersistenceSkipped !== isSkipped)
  )
    addViolation(
      violations,
      "integrity-format",
      integrity.fields.get("Scope snapshot")?.line ?? null,
      "bundle, refutation persistence markers, and persist-skipped: redactor-unavailable flag must agree",
    );
  return isSkipped;
}
