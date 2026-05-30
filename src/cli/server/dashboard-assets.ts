/**
 * Dashboard shell and static-asset loaders.
 * These helpers keep file-resolution and asset-shape validation out of the
 * main HTTP server so route code can stay focused on request handling.
 */
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { getTemplatePath, resolveFirstExistingPackagePath } from "../paths.js";

/** Relative locations where the dashboard preset catalog may exist. */
const DASHBOARD_PRESET_CATALOG_PATHS = [
  "dist/dashboard/preset-prompts.json",
  "src/dashboard/preset-prompts.json",
] as const;

/** Dashboard preset definitions injected into the browser shell. */
interface DashboardPreset extends Record<string, unknown> {
  id: string;
  name: string;
  desc: string;
  prompt: string;
  cat: string;
}

/** Cached asset bytes plus stable HTTP metadata derived from the source file stats. */
interface CachedDashboardAsset {
  content: Buffer;
  etag: string;
  sourcePath: string;
  mtimeMs: number;
  size: number;
}

const dashboardAssetCache = new Map<string, CachedDashboardAsset>();

/**
 * Replace `<!-- include: path -->` markers with fragment file contents.
 * Uses a recover fallback for missing fragments by embedding an HTML error comment so the
 * dashboard shell still loads and the broken include is visible in source.
 *
 * @param shellPath - dashboard shell HTML file to assemble
 * @returns assembled dashboard HTML with one-level includes expanded
 */
export function assembleDashboardHtml(shellPath: string): string {
  let html = readFileSync(shellPath, "utf-8");
  const includePattern = /<!-- include: (.+?) -->/g;
  html = html.replace(includePattern, (_, path: string) => {
    const fragmentPath = join(dirname(shellPath), path);
    try {
      return readFileSync(fragmentPath, "utf-8");
    } catch {
      return `<!-- ERROR: Could not include ${path} -->`;
    }
  });
  return html;
}

/**
 * Read the dashboard preset definitions shipped with the frontend bundle.
 * Throws when the JSON schema is not the expected preset array.
 *
 * @returns validated preset prompt definitions
 */
export function loadDashboardPresets(): DashboardPreset[] {
  const presetPath = resolveFirstExistingPackagePath(
    DASHBOARD_PRESET_CATALOG_PATHS,
  );
  const relativePath =
    DASHBOARD_PRESET_CATALOG_PATHS.find(
      (candidate) => getTemplatePath(candidate) === presetPath,
    ) ?? DASHBOARD_PRESET_CATALOG_PATHS[0];
  const raw = JSON.parse(readFileSync(presetPath, "utf-8")) as unknown;
  if (!Array.isArray(raw)) {
    throw new Error(`${relativePath} must contain an array`);
  }
  return raw.map((entry, index) => {
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

/** Resolve one asset to the actual file path used for this runtime mode. */
function resolveDashboardAssetPath(filename: string): string {
  return filename === "preset-prompts.json"
    ? resolveFirstExistingPackagePath(DASHBOARD_PRESET_CATALOG_PATHS)
    : getTemplatePath(`dist/dashboard/${filename}`);
}

/**
 * Read one bundled dashboard asset through a small mtime/size-aware memory cache.
 *
 * @param filename - dashboard asset filename relative to the bundled asset root
 * @returns asset bytes and cache metadata for HTTP responses
 */
export function loadDashboardAssetCached(
  filename: string,
): CachedDashboardAsset {
  const sourcePath = resolveDashboardAssetPath(filename);
  const stats = statSync(sourcePath);
  const cached = dashboardAssetCache.get(filename);
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
