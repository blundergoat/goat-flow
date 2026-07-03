/**
 * Canonical cross-module constants for skills and version-aligned aliases.
 *
 * Everything the CLI knows about "which skills exist" funnels through this
 * module so detection, prompts, and audit checks stay in sync. The skill
 * lists come from `workflow/manifest.json` and are read LAZILY on first use:
 * a user whose install has drifted (say, a stray folder under
 * `workflow/skills/`) must still be able to run `goat-flow --help` or
 * `goat-flow --version` to orient themselves - only the commands that
 * actually need the skill list (audit, setup, manifest checks) should
 * surface the drift error.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getPackageVersion } from "./paths.js";
import { getTemplatePath } from "./paths.js";

/** Minimal manifest schema contract needed to derive canonical and stale skill names. */
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

/** List skill template directories that contain a `SKILL.md` file with deterministic ordering. */
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

/** Read the manifest canonical skill list; throws when manifest/schema or template dirs drift. */
function readCanonicalSkillNames(): readonly string[] {
  const manifest = readSkillsManifest();
  const canonical = manifest.skills?.canonical;
  // Manifest schema broken (not a string array) -> fail with the exact reason.
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
  // Manifest and on-disk skill folders disagree -> name every offender so the
  // user can fix the drift instead of guessing.
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

/** Read the manifest stale skill-name list; throws when the manifest schema stops being an array of strings. */
function readStaleSkillNames(): readonly string[] {
  const manifest = readSkillsManifest();
  const staleNames = manifest.skills?.stale_names;
  // Manifest schema broken (not a string array) -> fail with the exact reason.
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

/** Cache for {@link getSkillNames} - the manifest is static for a process's lifetime. */
let cachedSkillNames: readonly string[] | undefined;

/** Cache for {@link getStaleSkillNames} - same lifetime rule as the canonical list. */
let cachedStaleSkillNames: readonly string[] | undefined;

/**
 * Canonical list of all GOAT Flow skill names - what `goat-flow audit` and
 * setup expect to find installed (e.g. under `.claude/skills/`).
 *
 * Lazy + cached: the first caller pays the manifest read and drift
 * validation. Diagnostic commands that never ask for the list keep working
 * when the manifest has drifted - a user typing `goat-flow --help` after a
 * botched upgrade still gets help instead of a crash.
 *
 * @returns canonical skill names in manifest order
 * @throws Error when `workflow/manifest.json` is invalid or drifts from `workflow/skills/`
 */
export function getSkillNames(): readonly string[] {
  // First call in this process -> read and validate the manifest now.
  cachedSkillNames ??= readCanonicalSkillNames();
  return cachedSkillNames;
}

/**
 * Deprecated skill names retained so audit/setup can flag leftovers from
 * older installs (e.g. a `.claude/skills/goat-test/` dir from a version the
 * user upgraded away from) instead of treating them as unknown files.
 *
 * Lazy + cached for the same reason as {@link getSkillNames}: reading the
 * manifest at import time would crash `--help`/`--version` under drift.
 *
 * @returns stale (retired) skill names from the manifest
 * @throws Error when `workflow/manifest.json` has an invalid stale_names list
 */
export function getStaleSkillNames(): readonly string[] {
  // First call in this process -> read and validate the manifest now.
  cachedStaleSkillNames ??= readStaleSkillNames();
  return cachedStaleSkillNames;
}

/**
 * Current audit version - derived from package.json so it stays in sync automatically.
 * Skills embed this as `goat-flow-skill-version: X` in their YAML frontmatter.
 * (Reads the CLI's own package.json, which always ships with the package -
 * unlike the skills manifest this is not a drift surface, so eager is safe.)
 */
export const AUDIT_VERSION = getPackageVersion();
