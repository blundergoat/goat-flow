/**
 * Terminal image upload validation and storage.
 *
 * Pure helpers used by the dashboard upload handler. Kept out of the HTTP
 * handler module so file-level constants, MIME tables, sanitization, and
 * containment checks can be unit-tested without spinning up an HTTP server.
 */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

/** Maximum bytes per uploaded image file (raw, post-base64-decode). */
const TERMINAL_UPLOAD_MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MiB
/** Maximum number of files accepted in a single upload request. */
export const TERMINAL_UPLOAD_MAX_FILES = 5;
/** Maximum total raw request body size (base64 inflates by ~4/3). */
export const TERMINAL_UPLOAD_MAX_BODY_BYTES = 25 * 1024 * 1024; // 25 MiB

const ALLOWED_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

/** Magic-byte prefixes for accepted image formats. */
const IMAGE_MAGIC_BYTES: Array<{ ext: string; bytes: number[] }> = [
  { ext: ".png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { ext: ".jpg", bytes: [0xff, 0xd8, 0xff] },
  { ext: ".gif", bytes: [0x47, 0x49, 0x46, 0x38] },
  // WEBP: "RIFF....WEBP" — checked separately because of the 4-byte gap
];

interface AcceptedUpload {
  originalName: string;
  savedName: string;
  savedAbsPath: string;
  savedRelPath: string;
  bytes: number;
}

interface RejectedUpload {
  originalName: string;
  reason: string;
}

interface UploadResult {
  accepted: AcceptedUpload[];
  rejected: RejectedUpload[];
}

interface UploadDirectory {
  absPath: string;
  relPath: string;
  realRootPath: string;
}

function isPathWithin(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  if (rel === "") return true;
  if (isAbsolute(rel)) return false;
  const [firstSegment] = rel.split(/[\\/]/);
  return firstSegment !== "..";
}

function assertUploadComponentSafe(root: string, candidate: string): void {
  if (!existsSync(candidate)) return;
  if (lstatSync(candidate).isSymbolicLink()) {
    throw new Error("Upload path escapes session target directory");
  }
  const realRoot = existsSync(root) ? realpathSync(root) : root;
  const realCandidate = realpathSync(candidate);
  if (!isPathWithin(realRoot, realCandidate)) {
    throw new Error("Upload path escapes session target directory");
  }
}

/** Strip directory components and unsafe characters from an upload filename. */
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

/** Detect image format by magic bytes; returns the canonical extension or null. */
// eslint-disable-next-line complexity -- linear scan over each format's signature; splitting per format hides the table-driven match
export function detectImageExtension(bytes: Uint8Array): string | null {
  for (const candidate of IMAGE_MAGIC_BYTES) {
    if (bytes.length < candidate.bytes.length) continue;
    let matches = true;
    for (let i = 0; i < candidate.bytes.length; i += 1) {
      if (bytes[i] !== candidate.bytes[i]) {
        matches = false;
        break;
      }
    }
    if (matches) return candidate.ext;
  }
  // WEBP: "RIFF" at 0..4, "WEBP" at 8..12
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return ".webp";
  }
  return null;
}

/** Compose the upload directory path for one terminal session.
 *  Always under `<targetPath>/.goat-flow/logs/uploads/<sessionId>/` and
 *  asserted to remain inside `targetPath` to prevent path traversal via
 *  the session id. */
export function uploadDirForSession(
  targetPath: string,
  sessionId: string,
): UploadDirectory {
  if (!/^[a-zA-Z0-9_-]+$/u.test(sessionId)) {
    throw new Error("Invalid session id for upload path");
  }
  const root = resolve(targetPath);
  const absPath = resolve(root, ".goat-flow", "logs", "uploads", sessionId);
  const rel = relative(root, absPath);
  if (rel.startsWith("..") || resolve(root, rel) !== absPath) {
    throw new Error("Upload path escapes session target directory");
  }
  for (const component of [
    resolve(root, ".goat-flow"),
    resolve(root, ".goat-flow", "logs"),
    resolve(root, ".goat-flow", "logs", "uploads"),
    absPath,
  ]) {
    assertUploadComponentSafe(root, component);
  }
  return {
    absPath,
    relPath: rel.replace(/\\/gu, "/"),
    realRootPath: existsSync(root) ? realpathSync(root) : root,
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
  const random = Math.floor(Math.random() * 0x100000)
    .toString(36)
    .padStart(4, "0");
  return `${stamp}-${random}-${index.toString().padStart(2, "0")}-${base}${ext}`;
}

/** Validate one base64 image payload and decode it to bytes. */
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

/** Persist accepted uploads to disk and return their saved metadata.
 *  Caller is responsible for upstream session/path validation. */
export function persistUploads(
  uploadDir: { absPath: string; relPath: string; realRootPath?: string },
  files: Array<{ name: string; data: string }>,
  options: { now?: () => number } = {},
): UploadResult {
  const accepted: AcceptedUpload[] = [];
  const rejected: RejectedUpload[] = [];
  const now = options.now ?? Date.now;

  let dirCreated = false;
  for (const [index, file] of files.entries()) {
    const decoded = decodeUploadFile(file.name, file.data);
    if (!decoded.ok) {
      rejected.push({ originalName: file.name, reason: decoded.reason });
      continue;
    }
    if (!dirCreated) {
      mkdirSync(uploadDir.absPath, { recursive: true });
      if (
        uploadDir.realRootPath !== undefined &&
        !isPathWithin(uploadDir.realRootPath, realpathSync(uploadDir.absPath))
      ) {
        throw new Error("Upload path escapes session target directory");
      }
      dirCreated = true;
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

/** Build the terminal-paste note that announces saved upload paths.
 *  Callers paste this into the active PTY; it is plain text only. */
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
