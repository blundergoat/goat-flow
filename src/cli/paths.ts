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

/** Resolve the first existing goat-flow path from a priority-ordered list. */
export function resolveFirstExistingPackagePath(
  relatives: readonly string[],
): string {
  for (const relative of relatives) {
    const absolute = getTemplatePath(relative);
    if (existsSync(absolute)) return absolute;
  }
  throw new Error(`Could not find any of: ${relatives.join(", ")}`);
}

/** Build the absolute CLI command used to run goat-flow from any project. */
export function getCliCommand(): string {
  return `node ${join(GOAT_FLOW_ROOT, "dist", "cli", "cli.js")}`;
}

/** True when goat-flow is running from a packaged install rather than a source
 *  checkout. `package.json` `files` ships only `dist/` + `workflow/` (plus a
 *  small set of runtime helpers), so consumer environments do not have `src/`
 *  or `.goat-flow/*` present. Code that reads source files at runtime, or
 *  validates evidence_paths that point at framework-repo docs, must gate on
 *  this to avoid spurious failures on consumer installs.
 *
 *  Set `GOAT_FLOW_PACKAGED_MODE=1` to force-enable (tests use this).
 */
export function isPackagedInstall(): boolean {
  if (process.env["GOAT_FLOW_PACKAGED_MODE"] === "1") return true;
  return !existsSync(join(GOAT_FLOW_ROOT, "src", "dashboard"));
}
