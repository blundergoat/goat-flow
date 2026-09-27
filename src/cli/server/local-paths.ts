/**
 * Validate local directories and state destinations before dashboard routes browse, read projects, launch terminals, or write files.
 *
 * Project actions reject protected locations in both typed and resolved paths; folder browsing is exempt from those location rules.
 * State-path helpers additionally check containment and existing symlinks beneath the selected project's .goat-flow directory.
 */
import { existsSync, lstatSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

// Allowed local-path use cases, each with a different filesystem trust boundary.
export type LocalPathPurpose =
  "browse" | "project-read" | "terminal-cwd" | "write-local-state" | "upload";

type LocalPathValidationClass =
  | "missing"
  | "not-directory"
  | "blocked-root"
  | "blocked-descendant"
  | "state-path-escape";

/**
 * Carry a directory that passed the caller's requested local-path policy.
 *
 * The typed path remains available for requests and display, while realPath records the symlink-resolved location checked.
 * The purpose records which policy ran; state writers require a write or upload purpose before deriving a destination.
 */
export interface ValidatedLocalPath {
  path: string;
  realPath: string;
  purpose: LocalPathPurpose;
}

type LocalStatePathPurpose = Extract<
  LocalPathPurpose,
  "write-local-state" | "upload"
>;

/**
 * Explain why the server refused a directory or state destination requested through the dashboard.
 *
 * The purpose identifies the attempted action, and validationClass identifies the failed location rule.
 * Routes can map this error to a request rejection without parsing the human-readable message.
 */
class LocalPathValidationError extends Error {
  readonly validationClass: LocalPathValidationClass;
  readonly purpose: LocalPathPurpose | "state-path";

  /**
   * Carry both what the user was trying to do and which rule stopped them, so the dashboard can explain the refusal instead of showing a bare error.
   *
   * @param purpose - what the caller intended to do with the path, echoed in the message the user sees
   * @param validationClass - which rule refused it, used by the dashboard to choose the wording
   */
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

// Normalize candidate paths to POSIX shape before comparing against policy roots.
function toPosixPath(path: string): string {
  const normalized = path.replace(/\\/gu, "/").replace(/\/+/gu, "/");
  return normalized.length > 1 ? normalized.replace(/\/$/u, "") : normalized;
}

/**
 * Check lexical path containment before a route accesses the requested location.
 *
 * Equal paths count as contained; this helper does not resolve symlinks.
 * Callers checking filesystem containment must supply canonical paths.
 *
 * @param parent - containment boundary; empty resolves to the process working directory
 * @param child - requested location to compare; empty resolves to the process working directory
 * @returns true for the boundary itself or a descendant, otherwise false for a different drive or escaping path
 */
export function isPathWithin(parent: string, child: string): boolean {
  const relativePath = relative(parent, child);
  // Choosing the boundary directory itself remains within the caller's allowed location.
  if (relativePath === "") return true;
  // A path on another drive cannot be contained by the selected directory.
  if (isAbsolute(relativePath)) return false;
  const [firstSegment] = relativePath.split(/[\\/]/u);
  return firstSegment !== "..";
}

// Apply protected-location rules to project reads, terminal launches, and writes; folder browsing remains exempt.
function isPolicyEnforcedPurpose(purpose: LocalPathPurpose): boolean {
  return purpose !== "browse";
}

/**
 * Decide whether a path is somewhere the server refuses to act, such as a system root the user should never be able to launch a terminal in.
 *
 * @param path - absolute path to judge, already resolved
 * @param purpose - what the caller intends to do; browsing is exempt because reading a directory listing changes nothing
 * @returns the rule that blocks it, or null when the path is allowed for this purpose
 */
function blockedClassForPath(
  path: string,
  purpose: LocalPathPurpose,
): LocalPathValidationClass | null {
  // The folder picker can navigate locations that the server refuses to use for project actions.
  if (!isPolicyEnforcedPurpose(purpose)) return null;

  const posixPath = toPosixPath(path);
  // A protected system root cannot become the selected project or the destination of a server action.
  if (EXACT_BLOCKED_POSIX_ROOTS.has(posixPath)) return "blocked-root";
  // Protected system trees remain unavailable even when the caller selects a nested folder.
  if (
    DESCENDANT_BLOCKED_POSIX_ROOTS.some(
      (root) => posixPath === root || posixPath.startsWith(`${root}/`),
    )
  ) {
    return "blocked-descendant";
  }
  return null;
}

/**
 * Refuse a blocked location before any route acts on it, checking the typed path and the path it really resolves to.
 * It throws `LocalPathValidationError`; returning normally is the caller's evidence that both forms passed.
 *
 * @param resolvedPath - the path as typed, resolved to absolute
 * @param realPath - the same path with symlinks followed, which is where work would actually land
 * @param purpose - what the caller intends to do, which selects the rules and appears in the error
 */
function assertAllowedByPurpose(
  resolvedPath: string,
  realPath: string,
  purpose: LocalPathPurpose,
): void {
  const resolvedBlock = blockedClassForPath(resolvedPath, purpose);
  // The path the user typed is blocked outright.
  if (resolvedBlock) throw new LocalPathValidationError(purpose, resolvedBlock);
  const realBlock = blockedClassForPath(realPath, purpose);
  // A symlink pointing somewhere blocked is refused too, so a link cannot be used to reach a protected root.
  if (realBlock) throw new LocalPathValidationError(purpose, realBlock);
}

/**
 * Validate a directory from a dashboard request before the route uses it for the requested action.
 *
 * The Add Project path is untrusted text; both its typed and symlink-resolved locations must pass the selected policy.
 * Throws LocalPathValidationError for rejected locations so the route can explain which action was refused.
 *
 * @param rawPath - submitted path; an empty string resolves to the server process's working directory
 * @param purpose - intended use, which selects the location policy and appears in rejection messages
 * @returns the typed and resolved directory paths with the purpose that was checked
 */
export function validateLocalPath(
  rawPath: string,
  purpose: LocalPathPurpose,
): ValidatedLocalPath {
  const resolvedPath = resolve(rawPath);
  let stats;
  try {
    stats = statSync(resolvedPath);
  } catch {
    // A folder removed after selection, or one the server cannot stat, is reported as missing for the requested action.
    throw new LocalPathValidationError(purpose, "missing");
  }
  // Selecting a file cannot provide the working directory or project root the route needs.
  if (!stats.isDirectory()) {
    throw new LocalPathValidationError(purpose, "not-directory");
  }

  const realPath = realpathSync(resolvedPath);
  assertAllowedByPurpose(resolvedPath, realPath, purpose);
  return { path: resolvedPath, realPath, purpose };
}

// List existing components toward a state destination; newly created directories have no filesystem entries to inspect yet.
function existingPathComponents(from: string, target: string): string[] {
  const relativePath = relative(from, target);
  // Selecting the starting directory still requires checking that directory's real location.
  if (relativePath === "") return [from];
  // A path that does not descend from this root supplies no components for this containment walk.
  if (isAbsolute(relativePath) || relativePath.startsWith("..")) return [];
  const components = relativePath.split(/[\\/]/u).filter(Boolean);
  const paths = [from];
  let current = from;
  // Check every existing ancestor, because a nested symlink could redirect the user's state write before the destination is reached.
  for (const component of components) {
    current = join(current, component);
    paths.push(current);
  }
  // Missing suffixes are omitted here so later writers can create their directories after existing ancestors have been checked.
  return paths.filter((path) => existsSync(path));
}

/**
 * Check existing path components so a state destination cannot use them to reach outside the selected project.
 * It throws `LocalPathValidationError`; returning normally is the caller's evidence that the whole chain stays inside.
 *
 * @param realRoot - project root with symlinks already resolved
 * @param components - existing path components from the root down to the target, in order
 */
function assertExistingComponentsStayInside(
  realRoot: string,
  components: string[],
): void {
  // Each existing ancestor and destination must preserve the selected project's boundary before a state write can proceed.
  for (const [index, component] of components.entries()) {
    // A symlink anywhere below the root could point outside the project, so it is refused rather than followed.
    if (index > 0 && lstatSync(component).isSymbolicLink()) {
      throw new LocalPathValidationError("state-path", "state-path-escape");
    }
    // Even without a symlink, a component that resolves outside the root means the target is not really inside it.
    if (!isPathWithin(realRoot, realpathSync(component))) {
      throw new LocalPathValidationError("state-path", "state-path-escape");
    }
  }
}

/**
 * Prove the caller validated this project for writing before any state path is derived from it.
 * It throws `LocalPathValidationError`; returning normally narrows the type so later code cannot forget the check.
 *
 * @param project - a path already validated for some purpose, which must be a writing one here
 */
function assertLocalStatePathPurpose(
  project: ValidatedLocalPath,
): asserts project is ValidatedLocalPath & { purpose: LocalStatePathPurpose } {
  // A path validated only for browsing or terminal launch was never checked for writing, so it cannot be used to build one.
  if (project.purpose !== "write-local-state" && project.purpose !== "upload") {
    throw new LocalPathValidationError("state-path", "state-path-escape");
  }
}

/**
 * Resolve a destination within the validated project's .goat-flow directory before the caller reads or writes local state.
 * Containment and existing symlinks must be checked again because a valid project root does not validate every requested destination.
 *
 * @param project - project already checked by validateLocalPath for a write or upload purpose
 * @param relativePath - state destination; empty selects .goat-flow itself, and normalization must keep the result inside that directory
 * @returns absolute destination; throws LocalPathValidationError when the purpose or containment checks reject it
 */
export function resolveValidatedLocalStatePath(
  project: ValidatedLocalPath,
  relativePath: string,
): string {
  assertLocalStatePathPurpose(project);
  const stateRoot = resolve(project.path, ".goat-flow");
  const candidate = resolve(stateRoot, relativePath);
  // A destination resolving outside .goat-flow is refused before any caller can write state into another project location.
  if (!isPathWithin(stateRoot, candidate)) {
    throw new LocalPathValidationError("state-path", "state-path-escape");
  }
  assertExistingComponentsStayInside(
    project.realPath,
    existingPathComponents(project.path, candidate),
  );
  return candidate;
}

/**
 * Validate a project and resolve its local-state destination when the caller does not already hold a checked project path.
 *
 * Use the two-step form when several state paths share one validated project.
 * Throws LocalPathValidationError from either check so the caller can report a rejected project or escaping destination.
 *
 * @param projectPath - submitted project path; empty resolves from the server process's working directory
 * @param relativePath - path within .goat-flow; empty selects the state directory itself
 * @param purpose - intended write use; omitted means ordinary local-state writing rather than uploading
 * @returns absolute state destination after project and containment validation
 */
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

/**
 * Validate the directory before a caller starts a terminal session there.
 * Throws LocalPathValidationError for a rejected location; returns the absolute working directory for an accepted launch.
 *
 * @param projectPath - requested terminal directory; empty resolves to the process working directory
 * @returns absolute working directory after the terminal location policy accepts it
 */
export function validateProjectPath(projectPath: string): string {
  return validateLocalPath(projectPath, "terminal-cwd").path;
}
