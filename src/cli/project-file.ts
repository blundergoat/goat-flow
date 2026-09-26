/** Bounded reads and constant-memory hashing for project-controlled evidence, managed targets, and saved reports. */
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
  type Stats,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

const MAX_EVIDENCE_FILE_BYTES = 8 * 1024 * 1024;
const HASH_READ_CHUNK_BYTES = 64 * 1024;

/**
 * Hash the rest of an open file through one fixed buffer, so a target-controlled file of any size cannot exhaust memory.
 *
 * @param descriptor - open readable descriptor positioned at the first byte to hash; the caller owns closing it
 * @returns lowercase SHA-256 hex digest of the bytes read until end of file
 * @throws the underlying read error when the descriptor cannot be read
 */
export function hashDescriptorSha256(descriptor: number): string {
  const hash = createHash("sha256");
  const chunk = Buffer.alloc(HASH_READ_CHUNK_BYTES);
  for (;;) {
    const count = readSync(descriptor, chunk, 0, chunk.length, null);
    if (count === 0) return hash.digest("hex");
    hash.update(chunk.subarray(0, count));
  }
}

/** Compare the physical file identity independently of its pathname and contents. */
function hasSameFileIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

/** Inspect evidence without following links; throws for escapes, linked parents and non-regular leaves. */
function inspectProjectFile(root: string, target: string): Stats {
  const path = relative(root, target);
  if (
    path === "" ||
    path === ".." ||
    path.startsWith(`..${sep}`) ||
    isAbsolute(path)
  ) {
    throw new Error("Evidence file must be inside the project.");
  }
  let parent = dirname(target);
  while (parent !== root) {
    if (!lstatSync(parent).isDirectory())
      throw new Error("Evidence parent must be an unlinked directory.");
    parent = dirname(parent);
  }
  const stats = lstatSync(target);
  if (!stats.isFile())
    throw new Error(
      "Evidence must be a regular file, not a link or special file.",
    );
  return stats;
}

/** Read the observed file length plus one byte so concurrent growth stays bounded. */
function readBoundedBytes(
  descriptor: number,
  observedSize: number,
  maxBytes: number,
): Buffer {
  const buffer = Buffer.alloc(Math.min(observedSize, maxBytes) + 1);
  let length = 0;
  while (length < buffer.length) {
    const count = readSync(
      descriptor,
      buffer,
      length,
      buffer.length - length,
      length,
    );
    if (count === 0) break;
    length += count;
  }
  if (length > maxBytes)
    throw new Error(`Evidence file exceeds ${maxBytes} bytes.`);
  return buffer.subarray(0, length);
}

/**
 * Read project evidence without letting an input link, special file or concurrent growth escape the read contract.
 * Throws on unsafe paths, oversized files, filesystem errors or changes observed during the read.
 *
 * @param projectRoot - selected project; its root may itself be a resolved directory alias
 * @param path - absolute or project-relative evidence file
 * @param maxBytes - largest accepted file; defaults to the evidence ceiling
 * @returns UTF-8 text after the descriptor and pathname still identify the inspected file
 */
export function readProjectTextFile(
  projectRoot: string,
  path: string,
  maxBytes = MAX_EVIDENCE_FILE_BYTES,
): string {
  const lexicalRoot = resolve(projectRoot);
  const root = realpathSync(lexicalRoot);
  const target = resolve(
    root,
    relative(lexicalRoot, resolve(lexicalRoot, path)),
  );
  const before = inspectProjectFile(root, target);
  if (before.size > maxBytes)
    throw new Error(`Evidence file exceeds ${maxBytes} bytes.`);
  const descriptor = openSync(
    target,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || !hasSameFileIdentity(opened, before)) {
      throw new Error("Evidence file changed while opening.");
    }
    const buffer = readBoundedBytes(descriptor, opened.size, maxBytes);
    const after = inspectProjectFile(root, target);
    const finished = fstatSync(descriptor);
    if (
      !hasSameFileIdentity(after, opened) ||
      finished.size !== buffer.length ||
      finished.mtimeMs !== opened.mtimeMs ||
      finished.ctimeMs !== opened.ctimeMs ||
      realpathSync(lexicalRoot) !== root
    ) {
      throw new Error("Evidence file changed while reading.");
    }
    return buffer.toString("utf8");
  } finally {
    closeSync(descriptor);
  }
}
