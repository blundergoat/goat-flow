/**
 * Terminal image upload validation and storage.
 *
 * Pure helpers used by the dashboard upload handler. Kept out of the HTTP
 * handler module so file-level constants, MIME tables, sanitization, and
 * containment checks can be unit-tested without spinning up an HTTP server.
 */
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  isPathWithin,
  resolveValidatedLocalStatePath,
  validateLocalPath,
} from "./local-paths.js";

const TERMINAL_UPLOAD_MAX_FILE_BYTES = 10 * 1024 * 1024; // File-size limit: 10 MiB keeps screenshots useful without letting one paste dominate disk.
export const TERMINAL_UPLOAD_MAX_FILES = 5; // Request limit: five images covers common before/after batches without flooding one terminal paste.
export const TERMINAL_UPLOAD_MAX_BODY_BYTES = 25 * 1024 * 1024; // Body limit: 25 MiB accounts for base64 inflation while bounding JSON memory.

const ALLOWED_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const WEBP_RIFF_BYTES = [0x52, 0x49, 0x46, 0x46] as const;
const WEBP_FORMAT_BYTES = [0x57, 0x45, 0x42, 0x50] as const;

/** Magic-byte prefixes for accepted image formats. */
const IMAGE_MAGIC_BYTES: Array<{ ext: string; bytes: number[] }> = [
  { ext: ".png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { ext: ".jpg", bytes: [0xff, 0xd8, 0xff] },
  { ext: ".gif", bytes: [0x47, 0x49, 0x46, 0x38] },
  // WEBP: "RIFF....WEBP" - checked separately because of the 4-byte gap
];

/** Upload metadata returned only after bytes have been written inside the session upload directory. */
interface AcceptedUpload {
  originalName: string;
  savedName: string;
  savedAbsPath: string;
  savedRelPath: string;
  bytes: number;
}

/** Per-file rejection shown to the caller while other valid files in the same request may continue. */
interface RejectedUpload {
  originalName: string;
  reason: string;
}

/** Batch result that keeps accepted and rejected files separate for partial-success responses. */
interface UploadResult {
  accepted: AcceptedUpload[];
  rejected: RejectedUpload[];
}

/** Validated session upload directory plus the real target root used for containment checks. */
interface UploadDirectory {
  absPath: string;
  relPath: string;
  realRootPath: string;
}

/**
 * Strip directory components and unsafe characters from an upload filename.
 *
 * @param rawName Browser-provided filename, which may include fake path components.
 * @returns Safe basename plus an allowed extension, or an empty extension when unsupported.
 */
export function sanitizeUploadFilename(rawName: string): {
  base: string;
  ext: string;
} {
  const stripped = rawName.replace(/^.*[\\/]/u, "");
  const dot = stripped.lastIndexOf(".");
  const rawExt = dot === -1 ? "" : stripped.slice(dot).toLowerCase();
  const rawBase = dot === -1 ? stripped : stripped.slice(0, dot);
  const safeBase =
    rawBase.replace(/[^a-zA-Z0-9._-]/gu, "_").slice(0, 64) || "image";
  const safeExt = ALLOWED_EXTENSIONS.has(rawExt) ? rawExt : "";
  return { base: safeBase, ext: safeExt };
}

/** Compare a decoded file prefix against one magic-byte signature. */
function hasByteSignature(
  bytes: Uint8Array,
  signature: readonly number[],
): boolean {
  return (
    bytes.length >= signature.length &&
    signature.every((byte, index) => bytes[index] === byte)
  );
}

/** WEBP stores its format marker after the RIFF length field, so prefix matching is insufficient. */
function hasWebpSignature(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 12 &&
    hasByteSignature(bytes.subarray(0, 4), WEBP_RIFF_BYTES) &&
    hasByteSignature(bytes.subarray(8, 12), WEBP_FORMAT_BYTES)
  );
}

/**
 * Detect image format by magic bytes because client MIME types and extensions are not trusted.
 *
 * @param bytes Decoded file bytes from the upload body.
 * @returns Canonical extension for supported image bytes, or null when the content is unsupported.
 */
export function detectImageExtension(bytes: Uint8Array): string | null {
  for (const candidate of IMAGE_MAGIC_BYTES) {
    if (hasByteSignature(bytes, candidate.bytes)) return candidate.ext;
  }
  if (hasWebpSignature(bytes)) {
    return ".webp";
  }
  return null;
}

/**
 * Compose the upload directory path for one terminal session.
 * Always under `<targetPath>/.goat-flow/logs/uploads/<sessionId>/` and asserted to remain inside
 * `targetPath` to prevent path traversal via the session id.
 *
 * @param targetPath Selected target project path that owns upload evidence.
 * @param sessionId Terminal session id used as the upload subdirectory.
 * @returns Absolute and relative upload paths plus the real target root.
 * @throws Error when the session id is not a simple path segment.
 */
export function uploadDirForSession(
  targetPath: string,
  sessionId: string,
): UploadDirectory {
  if (!/^[a-zA-Z0-9_-]+$/u.test(sessionId)) {
    throw new Error("Invalid session id for upload path");
  }
  const target = validateLocalPath(targetPath, "upload");
  const relPath = `.goat-flow/logs/uploads/${sessionId}`;
  return {
    absPath: resolveValidatedLocalStatePath(
      target,
      `logs/uploads/${sessionId}`,
    ),
    relPath,
    realRootPath: target.realPath,
  };
}

/** Generate a collision-safe saved filename for one accepted upload. */
function buildSavedName(
  index: number,
  base: string,
  ext: string,
  now: () => number = Date.now,
): string {
  const stamp = now().toString(36);
  const random = randomBytes(3).toString("hex");
  return `${stamp}-${random}-${index.toString().padStart(2, "0")}-${base}${ext}`;
}

/**
 * Validate one base64 image payload and decode it to bytes.
 *
 * @param rawName Browser-provided filename used for extension and saved-name hints.
 * @param base64 Base64 file body from the upload request.
 * @returns Decoded bytes with sanitized filename metadata, or a caller-safe rejection reason.
 */
export function decodeUploadFile(
  rawName: string,
  base64: string,
):
  | { ok: true; bytes: Uint8Array; sanitized: { base: string; ext: string } }
  | { ok: false; reason: string } {
  const sanitized = sanitizeUploadFilename(rawName);
  if (sanitized.ext === "") {
    return {
      ok: false,
      reason: `Unsupported extension. Allowed: ${Array.from(ALLOWED_EXTENSIONS).join(", ")}`,
    };
  }

  let bytes: Buffer;
  try {
    bytes = Buffer.from(base64, "base64");
  } catch {
    return { ok: false, reason: "Invalid base64 payload" };
  }
  if (bytes.length === 0) {
    return { ok: false, reason: "Empty file payload" };
  }
  if (bytes.length > TERMINAL_UPLOAD_MAX_FILE_BYTES) {
    return {
      ok: false,
      reason: `File exceeds ${TERMINAL_UPLOAD_MAX_FILE_BYTES} bytes`,
    };
  }

  const detected = detectImageExtension(bytes);
  if (!detected) {
    return {
      ok: false,
      reason: "File contents do not match a supported image format",
    };
  }
  if (sanitized.ext !== detected) {
    // Trust the magic bytes over the claimed extension to prevent .gif → .png trickery.
    return {
      ok: true,
      bytes,
      sanitized: { base: sanitized.base, ext: detected },
    };
  }
  return { ok: true, bytes, sanitized };
}

/**
 * Persist accepted uploads to disk and return their saved metadata.
 * Caller is responsible for upstream session/path validation.
 *
 * @param uploadDir Validated session upload directory.
 * @param files Browser-provided file payloads from one upload request.
 * @param options Test seams for deterministic saved filenames.
 * @returns Accepted file metadata and per-file rejection reasons.
 * @throws Error when the created upload directory escapes the real target root.
 */
export function persistUploads(
  uploadDir: { absPath: string; relPath: string; realRootPath?: string },
  files: Array<{ name: string; data: string }>,
  options: { now?: () => number } = {},
): UploadResult {
  const accepted: AcceptedUpload[] = [];
  const rejected: RejectedUpload[] = [];
  const now = options.now ?? Date.now;

  let hasCreatedUploadDir = false;
  for (const [index, file] of files.entries()) {
    const decoded = decodeUploadFile(file.name, file.data);
    if (!decoded.ok) {
      rejected.push({ originalName: file.name, reason: decoded.reason });
      continue;
    }
    if (!hasCreatedUploadDir) {
      mkdirSync(uploadDir.absPath, { recursive: true });
      if (
        uploadDir.realRootPath !== undefined &&
        !isPathWithin(uploadDir.realRootPath, realpathSync(uploadDir.absPath))
      ) {
        throw new Error("Upload path escapes session target directory");
      }
      hasCreatedUploadDir = true;
    }
    const savedName = buildSavedName(
      index,
      decoded.sanitized.base,
      decoded.sanitized.ext,
      now,
    );
    const savedAbsPath = join(uploadDir.absPath, savedName);
    writeFileSync(savedAbsPath, decoded.bytes);
    accepted.push({
      originalName: file.name,
      savedName,
      savedAbsPath,
      savedRelPath: `${uploadDir.relPath}/${savedName}`,
      bytes: decoded.bytes.length,
    });
  }

  return { accepted, rejected };
}

/**
 * Build the terminal-paste note that announces saved upload paths.
 * Callers paste this into the active PTY; it is plain text only.
 *
 * @param accepted Files that were saved for the active terminal session.
 * @returns Plain text note to paste into the PTY, or an empty string when nothing was accepted.
 */
export function buildAttachmentNote(accepted: AcceptedUpload[]): string {
  if (accepted.length === 0) return "";
  const first = accepted[0];
  if (accepted.length === 1 && first) {
    return `Attached image: ${first.savedRelPath}\n`;
  }
  const lines = ["Attached images:"];
  for (const file of accepted) lines.push(`  ${file.savedRelPath}`);
  return lines.join("\n") + "\n";
}
