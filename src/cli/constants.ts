/**
 * Canonical cross-module constants for skills and version-aligned aliases.
 * Keep definitions here so detection, prompts, and audit checks stay in sync.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getPackageVersion } from "./paths.js";
import { getTemplatePath } from "./paths.js";

interface SkillsManifestShape {
  skills?: {
    canonical?: unknown;
    stale_names?: unknown;
  };
}

/** Read the on-disk skills manifest used by shared constants. */
function readSkillsManifest(): SkillsManifestShape {
  const path = getTemplatePath("workflow/manifest.json");
  return JSON.parse(readFileSync(path, "utf-8")) as SkillsManifestShape;
}

/** List skill template directories that contain a `SKILL.md` file. */
function readObservedSkillDirs(): string[] {
  const root = getTemplatePath("workflow/skills");
  return readdirSync(root, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && existsSync(join(root, entry.name, "SKILL.md")),
    )
    .map((entry) => entry.name)
    .sort();
}

/** Read the manifest canonical skill list and validate it against the template dirs. */
function readCanonicalSkillNames(): readonly string[] {
  const manifest = readSkillsManifest();
  const canonical = manifest.skills?.canonical;
  if (
    !Array.isArray(canonical) ||
    canonical.some((name) => typeof name !== "string")
  ) {
    throw new Error(
      "workflow/manifest.json has an invalid skills.canonical list",
    );
  }

  const observed = readObservedSkillDirs();
  const missingDirs = canonical.filter((name) => !observed.includes(name));
  const extraDirs = observed.filter((name) => !canonical.includes(name));
  if (missingDirs.length > 0 || extraDirs.length > 0) {
    const findings: string[] = [];
    if (missingDirs.length > 0) {
      findings.push(`missing workflow/skills dirs: ${missingDirs.join(", ")}`);
    }
    if (extraDirs.length > 0) {
      findings.push(`unlisted workflow/skills dirs: ${extraDirs.join(", ")}`);
    }
    throw new Error(
      `workflow/manifest.json skills.canonical drifted from workflow/skills/: ${findings.join("; ")}`,
    );
  }

  return canonical;
}

/** Read the manifest stale skill-name list. */
function readStaleSkillNames(): readonly string[] {
  const manifest = readSkillsManifest();
  const staleNames = manifest.skills?.stale_names;
  if (
    !Array.isArray(staleNames) ||
    staleNames.some((name) => typeof name !== "string")
  ) {
    throw new Error(
      "workflow/manifest.json has an invalid skills.stale_names list",
    );
  }
  return staleNames;
}

/** Canonical list of all GOAT Flow skill names. */
export const SKILL_NAMES = readCanonicalSkillNames();

/** Deprecated skill names retained for migration and drift detection. */
export const STALE_SKILL_NAMES = readStaleSkillNames();

/**
 * Current audit version - derived from package.json so it stays in sync automatically.
 * Skills embed this as `goat-flow-skill-version: X` in their YAML frontmatter.
 */
export const AUDIT_VERSION = getPackageVersion();
