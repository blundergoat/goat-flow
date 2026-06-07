/**
 * Raw manifest-JSON layer: reads `workflow/manifest.json`, validates its
 * optional skill-docs shape, and resolves the required-instruction-section
 * list that harness checks compare agent instruction files against.
 *
 * Split out of `manifest.ts` to break an import cycle. `manifest.ts` imports
 * `HARNESS_CHECKS` to count them as a derived fact, while harness check
 * `check-context` needs the section list - so importing the section helper from
 * `manifest.ts` formed check-context -> manifest -> harness/index -> check-context.
 * This module imports neither the harness checks nor `manifest.ts`, so it is a
 * true leaf both can depend on. `required_sections` is raw JSON passthrough
 * (not a drift-validated fact), so reading it here returns the same value
 * without re-entering the cycle. (search: "design.circular-import")
 */
import { readFileSync } from "node:fs";

import { getTemplatePath } from "../paths.js";
import type { ManifestJson } from "./types.js";
import { ManifestValidationError } from "./types.js";

/** Validate optional `skills.references` shape before any consumer reads it. */
function validateOneSkillReference(
  canonical: ReadonlySet<string>,
  skillName: string,
  files: unknown,
): string[] {
  const findings: string[] = [];
  if (!canonical.has(skillName)) {
    findings.push(
      `skills.references.${skillName} must reference a canonical skill name.`,
    );
  }
  if (!Array.isArray(files)) {
    findings.push(`skills.references.${skillName} must be a string array.`);
    return findings;
  }
  if (files.some((file) => typeof file !== "string")) {
    findings.push(`skills.references.${skillName} must contain only strings.`);
  }
  return findings;
}

/**
 * Validate optional skill-docs metadata before consumers read it.
 *
 * Throws `ManifestValidationError` on malformed references because stale or
 * misspelled reference lists change what the installer copies.
 *
 * @param json - Parsed manifest JSON to validate.
 */
export function validateSkillReferenceSchema(json: ManifestJson): void {
  const references: unknown = json.skills.references;
  if (references === undefined) return;
  if (
    typeof references !== "object" ||
    references === null ||
    Array.isArray(references)
  ) {
    throw new ManifestValidationError(
      "workflow/manifest.json has an invalid `skills.references` value.",
      ["skills.references must be an object keyed by canonical skill name."],
    );
  }

  const findings: string[] = [];
  const canonical = new Set(json.skills.canonical);
  for (const [skillName, files] of Object.entries(references)) {
    findings.push(...validateOneSkillReference(canonical, skillName, files));
  }

  if (findings.length > 0) {
    throw new ManifestValidationError(
      `workflow/manifest.json has invalid skill reference metadata (${findings.length} finding${findings.length === 1 ? "" : "s"}).`,
      findings,
    );
  }
}

/**
 * Read and skill-docs-validate the on-disk `workflow/manifest.json`.
 *
 * @returns the parsed manifest JSON - throws on a missing or malformed file, or
 *   when `skills.references` is structurally invalid (`ManifestValidationError`).
 */
export function readManifestJson(): ManifestJson {
  const path = getTemplatePath("workflow/manifest.json");
  const raw = readFileSync(path, "utf-8");
  const json = JSON.parse(raw) as ManifestJson;
  validateSkillReferenceSchema(json);
  return json;
}

/** Regex for a markdown heading whose text equals `label` (case-insensitive).
 *  Used by harness checks to find required instruction-file sections. */
function instructionSectionRegex(label: string): RegExp {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^#+\\s+${escaped}`, "im");
}

/**
 * Resolved (label, pattern) pairs built from the manifest's required_sections.
 * Harness checks import this instead of hand-rolling their own section list.
 *
 * Reads the raw manifest JSON rather than the validated/cached `loadManifest`
 * result: `required_sections` is a straight passthrough field, so the value is
 * identical, and reading it here keeps this module free of the harness-check
 * import that would re-form the cycle described in the file header.
 *
 * @returns One entry per required section - its manifest label and the
 *   case-insensitive heading regex used to detect it in instruction files.
 */
export function getRequiredInstructionSections(): {
  label: string;
  pattern: RegExp;
}[] {
  const sections = readManifestJson().instruction_file.required_sections;
  return sections.map((label) => ({
    label,
    pattern: instructionSectionRegex(label),
  }));
}
