/**
 * Own the private terminal receipts paired with dashboard quality drafts.
 *
 * Receipts use exclusive creation, reject linked destinations, and preserve a completed outcome from an earlier process.
 * Only unsafe pre-existing entries are replaced with a bounded rejection.
 */
import { lstatSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { scrubDurableText } from "../evidence/redaction.js";

const DRAFT_NAME_PREFIX = "goat-quality-draft-";
const RESULT_NAME_PREFIX = "goat-quality-result-";
const MAX_RECEIPT_BYTES = 64 * 1024;

/** Redacted success or failure shown to the reporting session. */
export type QualityCaptureReceipt =
  { ok: true; reportPath: string } | { ok: false; error: string };

/** Resolve the terminal receipt paired with one contract-shaped draft filename. */
function qualityCaptureReceiptPath(
  stagingDir: string,
  draftName: string,
): string {
  const resultName =
    RESULT_NAME_PREFIX + draftName.slice(DRAFT_NAME_PREFIX.length);
  return join(stagingDir, resultName);
}

/**
 * Refuse an occupied or unreadable receipt path before irreversible persistence.
 * It throws in both cases, so returning normally is the caller's proof that the destination is free.
 *
 * @param stagingDir - private capture directory; empty cannot locate a valid receipt
 * @param draftName - contract-shaped draft identity; empty cannot produce a valid result name
 */
export function assertQualityCaptureReceiptAvailable(
  stagingDir: string,
  draftName: string,
): void {
  try {
    lstatSync(qualityCaptureReceiptPath(stagingDir, draftName));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw new Error("quality capture: cannot inspect receipt destination.");
  }
  throw new Error("quality capture: receipt destination already exists.");
}

/** Recognize the bounded terminal receipt shape written by a prior owner. */
function isTerminalReceiptValue(value: unknown): boolean {
  if (typeof value !== "object" || value === null || !("ok" in value)) {
    return false;
  }
  if (value.ok === true) {
    return (
      "reportPath" in value &&
      typeof value.reportPath === "string" &&
      value.reportPath.length > 0
    );
  }
  return (
    value.ok === false &&
    "error" in value &&
    typeof value.error === "string" &&
    value.error.length > 0
  );
}

/**
 * Return true only for a bounded, single-link terminal receipt from an earlier owner.
 * It swallows a missing or unreadable receipt as false, because an absent receipt simply means nobody finished this draft yet.
 *
 * @param stagingDir - private capture directory; empty cannot locate a valid receipt
 * @param draftName - contract-shaped draft identity; empty cannot produce a valid result name
 * @returns true only when a completed success or rejection already owns this outcome
 */
export function hasValidTerminalQualityReceipt(
  stagingDir: string,
  draftName: string,
): boolean {
  const resultPath = qualityCaptureReceiptPath(stagingDir, draftName);
  try {
    const stats = lstatSync(resultPath);
    if (!stats.isFile() || stats.nlink !== 1) return false;
    if (stats.size > MAX_RECEIPT_BYTES) return false;
    return isTerminalReceiptValue(JSON.parse(readFileSync(resultPath, "utf8")));
  } catch {
    return false;
  }
}

/** Remove an unsafe receipt entry; filesystem cleanup failures recover as false. */
function removeUnsafeReceiptEntry(resultPath: string): boolean {
  try {
    unlinkSync(resultPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Write one scrubbed private receipt with exclusive-create and link-count enforcement.
 * It throws when the destination is already taken or is not a plain single-link file, so a receipt can never overwrite another owner's outcome.
 *
 * @param stagingDir - private capture directory; empty causes the filesystem write to throw
 * @param draftName - source draft identity; empty cannot satisfy the filename contract
 * @param body - bounded outcome shown to the agent; never contains raw draft text
 */
export function writeQualityCaptureReceipt(
  stagingDir: string,
  draftName: string,
  body: QualityCaptureReceipt,
): void {
  const resultPath = qualityCaptureReceiptPath(stagingDir, draftName);
  const serialized = scrubDurableText(`${JSON.stringify(body, null, 2)}\n`);
  try {
    writeFileSync(resultPath, serialized, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error("quality capture: receipt destination already exists.");
    }
    throw new Error("quality capture: could not write receipt.");
  }
  const stats = lstatSync(resultPath);
  if (!stats.isFile() || stats.nlink !== 1) {
    removeUnsafeReceiptEntry(resultPath);
    throw new Error(
      "quality capture: receipt must be a single-link regular file.",
    );
  }
}

/**
 * Replace an unsafe occupied entry with a fixed rejection; races recover as false.
 *
 * @param stagingDir - private capture directory; empty cannot locate a valid receipt
 * @param draftName - source draft identity; empty cannot satisfy the filename contract
 * @returns true only when the fixed rejection was written durably
 */
export function replaceUnsafeQualityReceiptWithRejection(
  stagingDir: string,
  draftName: string,
): boolean {
  const resultPath = qualityCaptureReceiptPath(stagingDir, draftName);
  try {
    unlinkSync(resultPath);
    writeQualityCaptureReceipt(stagingDir, draftName, {
      ok: false,
      error: "quality capture: receipt destination already existed.",
    });
    return true;
  } catch {
    return false;
  }
}
