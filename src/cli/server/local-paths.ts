/**
 * Local path validation for dashboard browsing, terminal launch, state writes, and uploads.
 *
 * These guards keep browser-supplied paths inside the selected project or the allowed goat-flow
 * state area before server routes touch the filesystem.
 */
import { existsSync, lstatSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

/** Allowed local-path use cases, each with a different filesystem trust boundary. */
export type LocalPathPurpose =
  "browse" | "project-read" | "terminal-cwd" | "write-local-state" | "upload";

type LocalPathValidationClass =
  | "missing"
  | "not-directory"
  | "blocked-root"
  | "blocked-descendant"
  | "state-path-escape";

/** Resolved path plus the realpath used for symlink escape checks. */
export interface ValidatedLocalPath {
  path: string;
  realPath: string;
  purpose: LocalPathPurpose;
}

type LocalStatePathPurpose = Extract<
  LocalPathPurpose,
  "write-local-state" | "upload"
>;

/** Structured validation failure returned to dashboard callers as a safe rejection. */
class LocalPathValidationError extends Error {
  readonly validationClass: LocalPathValidationClass;
  readonly purpose: LocalPathPurpose | "state-path";

  constructor(
    purpose: LocalPathPurpose | "state-path",
    validationClass: LocalPathValidationClass,
  ) {
    super(
      `Local path validation failed (${purpose}): ${validationClass.replace(/-/gu, " ")}`,
    );
    this.name = "LocalPathValidationError";
    this.validationClass = validationClass;
    this.purpose = purpose;
  }
}

export { LocalPathValidationError };

const EXACT_BLOCKED_POSIX_ROOTS = new Set([
  "/",
  "/bin",
  "/sbin",
  "/usr/bin",
  "/usr/sbin",
  "/etc",
  "/var",
  "/tmp",
  "/dev",
  "/proc",
  "/sys",
  "/root",
  "/boot",
  "/lib",
  "/lib64",
  "/private/etc",
  "/private/var",
  "/private/tmp",
]);

const DESCENDANT_BLOCKED_POSIX_ROOTS = [
  "/bin",
  "/sbin",
  "/usr/bin",
  "/usr/sbin",
  "/etc",
  "/dev",
  "/proc",
  "/sys",
  "/root",
  "/boot",
  "/lib",
  "/lib64",
  "/private/etc",
];

/** Normalize candidate paths to POSIX shape before comparing against policy roots. */
function toPosixPath(path: string): string {
  const normalized = path.replace(/\\/gu, "/").replace(/\/+/gu, "/");
  return normalized.length > 1 ? normalized.replace(/\/$/u, "") : normalized;
}

// Containment guard used before filesystem access: true when child resolves
// inside parent (or equals it). Pure path arithmetic — it does NOT resolve
// symlinks, so callers needing real-path safety must canonicalise first.
export function isPathWithin(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  if (rel === "") return true;
  if (isAbsolute(rel)) return false;
  const [firstSegment] = rel.split(/[\\/]/u);
  return firstSegment !== "..";
}

/** Exempt browse-only requests from terminal/write local-path restrictions. */
function isPolicyEnforcedPurpose(purpose: LocalPathPurpose): boolean {
  return purpose !== "browse";
}

function blockedClassForPath(
  path: string,
  purpose: LocalPathPurpose,
): LocalPathValidationClass | null {
  if (!isPolicyEnforcedPurpose(purpose)) return null;

  const posixPath = toPosixPath(path);
  if (EXACT_BLOCKED_POSIX_ROOTS.has(posixPath)) return "blocked-root";
  if (
    DESCENDANT_BLOCKED_POSIX_ROOTS.some(
      (root) => posixPath === root || posixPath.startsWith(`${root}/`),
    )
  ) {
    return "blocked-descendant";
  }
  return null;
}

function assertAllowedByPurpose(
  resolvedPath: string,
  realPath: string,
  purpose: LocalPathPurpose,
): void {
  const resolvedBlock = blockedClassForPath(resolvedPath, purpose);
  if (resolvedBlock) throw new LocalPathValidationError(purpose, resolvedBlock);
  const realBlock = blockedClassForPath(realPath, purpose);
  if (realBlock) throw new LocalPathValidationError(purpose, realBlock);
}

export function validateLocalPath(
  rawPath: string,
  purpose: LocalPathPurpose,
): ValidatedLocalPath {
  const resolvedPath = resolve(rawPath);
  let stats;
  try {
    stats = statSync(resolvedPath);
  } catch {
    throw new LocalPathValidationError(purpose, "missing");
  }
  if (!stats.isDirectory()) {
    throw new LocalPathValidationError(purpose, "not-directory");
  }

  const realPath = realpathSync(resolvedPath);
  assertAllowedByPurpose(resolvedPath, realPath, purpose);
  return { path: resolvedPath, realPath, purpose };
}

/** Return existing path components so symlink checks only touch filesystem entries that exist. */
function existingPathComponents(from: string, target: string): string[] {
  const rel = relative(from, target);
  if (rel === "") return [from];
  if (isAbsolute(rel) || rel.startsWith("..")) return [];
  const components = rel.split(/[\\/]/u).filter(Boolean);
  const paths = [from];
  let current = from;
  for (const component of components) {
    current = join(current, component);
    paths.push(current);
  }
  return paths.filter((path) => existsSync(path));
}

function assertExistingComponentsStayInside(
  realRoot: string,
  components: string[],
): void {
  for (const [index, component] of components.entries()) {
    if (index > 0 && lstatSync(component).isSymbolicLink()) {
      throw new LocalPathValidationError("state-path", "state-path-escape");
    }
    if (!isPathWithin(realRoot, realpathSync(component))) {
      throw new LocalPathValidationError("state-path", "state-path-escape");
    }
  }
}

function assertLocalStatePathPurpose(
  project: ValidatedLocalPath,
): asserts project is ValidatedLocalPath & { purpose: LocalStatePathPurpose } {
  if (project.purpose !== "write-local-state" && project.purpose !== "upload") {
    throw new LocalPathValidationError("state-path", "state-path-escape");
  }
}

export function resolveValidatedLocalStatePath(
  project: ValidatedLocalPath,
  relativePath: string,
): string {
  assertLocalStatePathPurpose(project);
  const stateRoot = resolve(project.path, ".goat-flow");
  const candidate = resolve(stateRoot, relativePath);
  if (!isPathWithin(stateRoot, candidate)) {
    throw new LocalPathValidationError("state-path", "state-path-escape");
  }
  assertExistingComponentsStayInside(
    project.realPath,
    existingPathComponents(project.path, candidate),
  );
  return candidate;
}

export function resolveLocalStatePath(
  projectPath: string,
  relativePath: string,
  purpose: LocalStatePathPurpose = "write-local-state",
): string {
  return resolveValidatedLocalStatePath(
    validateLocalPath(projectPath, purpose),
    relativePath,
  );
}

// Security gate for terminal working directories: throws (via validateLocalPath)
// unless projectPath clears the terminal-cwd policy, otherwise returns the
// normalised absolute path safe to hand to a spawned shell.
export function validateProjectPath(projectPath: string): string {
  return validateLocalPath(projectPath, "terminal-cwd").path;
}
