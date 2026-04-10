/**
 * Resolves goat-flow package-root paths that need to work from source and packaged builds.
 * Template lookup and CLI self-reference should go through this module instead of hardcoding dist-relative paths.
 */
import { dirname, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Find the goat-flow project root by walking up from this file's directory */
function findGoatFlowRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, "package.json");
    if (existsSync(candidate)) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Could not find goat-flow project root");
}

/** Absolute path to the goat-flow project root */
const GOAT_FLOW_ROOT = findGoatFlowRoot();

/** Read the package version from the nearest package.json */
export function getPackageVersion(): string {
  const pkgPath = join(GOAT_FLOW_ROOT, "package.json");
  if (!existsSync(pkgPath)) return "0.0.0";
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
      version?: unknown;
    };
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** Resolve a relative template path to an absolute path within goat-flow */
export function getTemplatePath(relative: string): string {
  return join(GOAT_FLOW_ROOT, relative);
}

/** Resolve a template path and report whether the packaged source file exists. */
export function templateExists(relative: string): boolean {
  return existsSync(getTemplatePath(relative));
}

/**
 * Build the CLI command string that can run goat-flow from any project directory.
 * Returns the absolute `node /path/to/dist/cli/cli.js` form since goat-flow
 * may not be globally installed in target projects.
 */
export function getCliCommand(): string {
  return `node ${join(GOAT_FLOW_ROOT, "dist", "cli", "cli.js")}`;
}

/** Cached parsed project-structure.json */
let _projectStructure: Record<string, unknown> | null = null;

/**
 * Read and cache the canonical project-structure.json from goat-flow's workflow/setup/ dir.
 * Returns the parsed JSON object, or an empty object if the file is missing or unparseable.
 */
export function getProjectStructure(): Record<string, unknown> {
  if (_projectStructure !== null) return _projectStructure;
  const structurePath = join(
    GOAT_FLOW_ROOT,
    "workflow",
    "setup",
    "reference",
    "project-structure.json",
  );
  try {
    _projectStructure = JSON.parse(
      readFileSync(structurePath, "utf-8"),
    ) as Record<string, unknown>;
  } catch {
    _projectStructure = {};
  }
  return _projectStructure;
}
