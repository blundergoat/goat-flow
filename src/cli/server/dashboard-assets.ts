/**
 * Load the dashboard page, preset prompts, and browser assets from the installed package.
 *
 * HTML fragments assemble the page shell, while preset validation prevents malformed catalog entries reaching browser startup.
 * The asset cache retains file bytes and HTTP metadata so repeated page requests can reuse unchanged bundles.
 */
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { getTemplatePath, resolveFirstExistingPackagePath } from "../paths.js";

// Relative locations where the dashboard preset catalog may exist.
const DASHBOARD_PRESET_CATALOG_PATHS = [
  "dist/dashboard/preset-prompts.json",
  "src/dashboard/preset-prompts.json",
] as const;

/**
 * Carry one validated prompt preset into the browser's dashboard controls.
 *
 * The required string fields supply the choice's identifier, label, description, prompt, and category.
 * Extra catalog fields remain available because validation preserves the original entry.
 */
interface DashboardPreset extends Record<string, unknown> {
  id: string;
  name: string;
  desc: string;
  prompt: string;
  cat: string;
}

/**
 * Keep a browser asset's bytes beside the filesystem metadata used to decide whether they can be reused.
 *
 * sourcePath distinguishes package locations, while modification time and size detect changes between requests.
 * The route sends the ETag to let the browser reuse a matching asset without downloading its bytes again.
 */
interface CachedDashboardAsset {
  content: Buffer;
  etag: string;
  sourcePath: string;
  mtimeMs: number;
  size: number;
}

const dashboardAssetCache = new Map<string, CachedDashboardAsset>();

/**
 * Read the dashboard page and expand its one-level HTML includes before the server returns the shell.
 * An unreadable fragment uses an HTML-comment fallback so the remaining page can load and the missing include is visible in source.
 *
 * @param shellPath - dashboard shell HTML file to assemble; a missing or unreadable shell still throws to the caller
 * @returns assembled HTML with one-level includes expanded and error comments for unavailable fragments
 */
export function assembleDashboardHtml(shellPath: string): string {
  let html = readFileSync(shellPath, "utf-8");
  const includePattern = /<!-- include: (.+?) -->/g;
  html = html.replace(includePattern, (_, path: string) => {
    const fragmentPath = join(dirname(shellPath), path);
    try {
      return readFileSync(fragmentPath, "utf-8");
    } catch {
      // An installation missing a view fragment leaves an error marker in page source while the remaining dashboard shell still loads.
      return `<!-- ERROR: Could not include ${path} -->`;
    }
  });
  return html;
}

/**
 * Read the dashboard preset definitions shipped with the frontend bundle.
 * Throws when the JSON schema is not the expected preset array.
 *
 * @returns validated preset definitions; an empty catalog leaves the browser without preset choices
 */
export function loadDashboardPresets(): DashboardPreset[] {
  const presetPath = resolveFirstExistingPackagePath(
    DASHBOARD_PRESET_CATALOG_PATHS,
  );
  // Keep catalog failures tied to a package-relative filename the operator can locate, even when resolution used a fallback.
  const relativePath =
    DASHBOARD_PRESET_CATALOG_PATHS.find(
      (candidate) => getTemplatePath(candidate) === presetPath,
    ) ?? DASHBOARD_PRESET_CATALOG_PATHS[0];
  const raw = JSON.parse(readFileSync(presetPath, "utf-8")) as unknown;
  // A malformed catalog cannot populate the prompt choices, so startup reports its file instead of injecting an unusable value.
  if (!Array.isArray(raw)) {
    throw new Error(`${relativePath} must contain an array`);
  }
  // Validate every preset before any of the catalog is injected into the dashboard page.
  return raw.map((entry, index) => {
    // Missing, null, or incorrectly typed preset fields cannot supply a complete prompt choice to the browser.
    if (
      typeof entry !== "object" ||
      entry === null ||
      Array.isArray(entry) ||
      typeof entry.id !== "string" ||
      typeof entry.name !== "string" ||
      typeof entry.desc !== "string" ||
      typeof entry.prompt !== "string" ||
      typeof entry.cat !== "string"
    ) {
      throw new Error(
        `${relativePath} has an invalid preset at index ${index}`,
      );
    }
    return entry;
  });
}

// Locate the requested browser asset, allowing the preset catalog's source fallback when it is not in the built bundle.
function resolveDashboardAssetPath(filename: string): string {
  return filename === "preset-prompts.json"
    ? resolveFirstExistingPackagePath(DASHBOARD_PRESET_CATALOG_PATHS)
    : getTemplatePath(`dist/dashboard/${filename}`);
}

/**
 * Read a browser asset once and reuse its bytes while the resolved path, modification time, and size remain unchanged.
 *
 * @param filename - bundled asset filename already checked by the route; it does not accept arbitrary request paths
 * @returns bytes and HTTP cache metadata; filesystem failures throw so the asset route can return its missing-asset response
 */
export function loadDashboardAssetCached(
  filename: string,
): CachedDashboardAsset {
  const sourcePath = resolveDashboardAssetPath(filename);
  const stats = statSync(sourcePath);
  const cached = dashboardAssetCache.get(filename);
  // A matching saved file state lets repeated page requests reuse bytes; a cache miss or changed file reloads the bundle.
  if (
    cached &&
    cached.sourcePath === sourcePath &&
    cached.mtimeMs === stats.mtimeMs &&
    cached.size === stats.size
  ) {
    return cached;
  }
  const content = readFileSync(sourcePath);
  const asset = {
    content,
    etag: `"${stats.size}-${Math.floor(stats.mtimeMs)}"`,
    sourcePath,
    mtimeMs: stats.mtimeMs,
    size: stats.size,
  };
  dashboardAssetCache.set(filename, asset);
  return asset;
}
