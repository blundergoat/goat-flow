/**
 * Resolves goat-flow package-root paths that need to work from source and packaged builds.
 * Template lookup and CLI self-reference should go through this module instead of hardcoding dist-relative paths.
 */
import { dirname, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Find the goat-flow project root by walking up from this file's directory; throws when no package root is found. */
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

/**
 * Read the package version from the nearest package.json.
 * Uses a recover fallback of `0.0.0` when the file is absent or unreadable so help output still renders.
 *
 * @returns package version string, or `0.0.0` when unavailable
 */
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

/**
 * Resolve a relative template path to an absolute path within goat-flow.
 *
 * @param relative - package-relative template or workflow path
 * @returns absolute path inside the resolved goat-flow package root
 */
export function getTemplatePath(relative: string): string {
  return join(GOAT_FLOW_ROOT, relative);
}

/**
 * Resolve the first existing goat-flow path from a priority-ordered list.
 * Throws when none exist so callers do not silently use a missing template.
 *
 * @param relatives - package-relative candidate paths in preference order
 * @returns absolute path for the first candidate present on disk
 */
export function resolveFirstExistingPackagePath(
  relatives: readonly string[],
): string {
  for (const relative of relatives) {
    const absolute = getTemplatePath(relative);
    if (existsSync(absolute)) return absolute;
  }
  throw new Error(`Could not find any of: ${relatives.join(", ")}`);
}

/**
 * Build the absolute CLI command used to run goat-flow from any project.
 * Returns a forward-slash path so it renders cleanly in user-visible setup
 * prompts and is identically callable from PowerShell, CMD, and Bash on
 * Windows, where Node accepts forward slashes everywhere argv-style.
 *
 * @returns shell-safe `node .../dist/cli/cli.js` command string
 */
export function getCliCommand(): string {
  return `node ${join(GOAT_FLOW_ROOT, "dist", "cli", "cli.js").replace(/\\/g, "/")}`;
}

/**
 * Detect whether goat-flow is running from a packaged install rather than a source
 * checkout. `package.json` `files` ships only `dist/` + `workflow/` plus a small
 * set of runtime helpers, so consumer environments do not have `src/` or
 * `.goat-flow/*` present. Code that reads source files at runtime, or validates
 * evidence_paths that point at framework-repo docs, must gate on this to avoid
 * spurious failures on consumer installs.
 *
 * @returns true - when packaged-mode override is set or source dashboard files are absent
 */
export function isPackagedInstall(): boolean {
  if (process.env["GOAT_FLOW_PACKAGED_MODE"] === "1") return true;
  return !existsSync(join(GOAT_FLOW_ROOT, "src", "dashboard"));
}
