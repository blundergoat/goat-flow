/**
 * Dashboard shell and static-asset loaders.
 * These helpers keep file-resolution and asset-shape validation out of the
 * main HTTP server so route code can stay focused on request handling.
 */
import { readFileSync } from "node:fs";
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

/** Replace `<!-- include: path -->` markers with fragment file contents (one level, no nesting). */
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

/** Read the dashboard preset definitions shipped with the frontend bundle. */
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

/** Read one bundled dashboard asset, with preset JSON supporting source-run fallback. */
export function loadDashboardAsset(filename: string): string {
  return filename === "preset-prompts.json"
    ? readFileSync(
        resolveFirstExistingPackagePath(DASHBOARD_PRESET_CATALOG_PATHS),
        "utf-8",
      )
    : readFileSync(getTemplatePath(`dist/dashboard/${filename}`), "utf-8");
}
