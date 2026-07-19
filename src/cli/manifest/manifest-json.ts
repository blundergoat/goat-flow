/**
 * Raw manifest reader and skill-artifact schema guard.
 * Use before setup, audit, or harness code consumes workflow metadata so users
 * get precise duplicate/path errors instead of incomplete installed skills.
 * This leaf module stays outside the harness import cycle. (search: "design.circular-import")
 */
import { readFileSync } from "node:fs";

import { getTemplatePath } from "../paths.js";
import type { ManifestFileOwnership, ManifestJson } from "./types.js";
import { ManifestValidationError } from "./types.js";

const FILE_OWNERSHIP_CLASSES = new Set<ManifestFileOwnership>([
  "system-owned",
  "user-owned",
  "generated",
  "deprecated",
  "external",
]);

/** Narrow JSON values before ownership fields are read for user-facing validation. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Require visible source or generator text so operators can reproduce an ownership action. */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Accept only normalized repository-relative paths for managed artifact identities. */
function isSafeManifestPath(path: string): boolean {
  return (
    path.length > 0 &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !path.split("/").includes("..")
  );
}

/** Narrow a JSON value to one behavior the installer and manifest report understand. */
function isFileOwnership(value: unknown): value is ManifestFileOwnership {
  return (
    typeof value === "string" &&
    FILE_OWNERSHIP_CLASSES.has(value as ManifestFileOwnership)
  );
}

/** Collect every current file users can receive or optionally provide. */
function declaredOwnershipPaths(json: ManifestJson): Set<string> {
  const optionalPaths = Object.keys(json.optional_files).filter(
    (path) => path !== "_note",
  );
  return new Set([...json.required_files, ...optionalPaths]);
}

/**
 * Per-class evidence checks keep each installer behavior readable in isolation.
 * A null result means the operator has enough metadata to predict the write.
 */
const OWNERSHIP_EVIDENCE_FINDERS: Record<
  ManifestFileOwnership,
  (artifactPath: string, source: unknown, generator: unknown) => string | null
> = {
  // System installers need the exact canonical content they will write.
  "system-owned": (artifactPath, source) =>
    isNonEmptyString(source)
      ? null
      : `system-owned file ${artifactPath} must declare source.`,
  // User seeds need one first-write source while later local edits stay authoritative.
  "user-owned": (artifactPath, source, generator) =>
    isNonEmptyString(source) || isNonEmptyString(generator)
      ? null
      : `user-owned file ${artifactPath} must declare source or generator.`,
  // Generated files need the command an operator can rerun from current project evidence.
  generated: (artifactPath, _source, generator) =>
    isNonEmptyString(generator)
      ? null
      : `generated file ${artifactPath} must declare generator.`,
  // Retired paths only need audit cleanup guidance, not a writer.
  deprecated: () => null,
  // External files belong to another tool and must not name a goat-flow writer.
  external: (artifactPath, source, generator) =>
    source === undefined && generator === undefined
      ? null
      : `external file ${artifactPath} must not declare source or generator.`,
};

/** Return a source-path repair when a declared template cannot be safely packaged. */
function ownershipSourceFinding(
  artifactPath: string,
  source: unknown,
): string | null {
  // A missing source is valid for generated, deprecated, and external records.
  if (source === undefined) return null;
  // Template sources stay inside the packaged workflow so installs cannot escape the project contract.
  if (
    !isNonEmptyString(source) ||
    !source.startsWith("workflow/") ||
    !isSafeManifestPath(source)
  ) {
    return `file_ownership.${artifactPath}.source must be a safe workflow/ path.`;
  }
  return null;
}

/** Explain missing source/generator evidence for one otherwise valid ownership record. */
function ownershipEvidenceFindings(
  artifactPath: string,
  ownership: ManifestFileOwnership,
  source: unknown,
  generator: unknown,
): string[] {
  return [
    OWNERSHIP_EVIDENCE_FINDERS[ownership](artifactPath, source, generator),
    ownershipSourceFinding(artifactPath, source),
  ].filter((finding): finding is string => finding !== null);
}

/** Validate one path record and return user-actionable schema findings. */
function ownershipEntryFindings(
  artifactPath: string,
  rawSpec: unknown,
  declaredPaths: ReadonlySet<string>,
): string[] {
  // Unsafe identities could escape the project when installer paths are resolved.
  if (!isSafeManifestPath(artifactPath)) {
    return [
      `file_ownership path ${artifactPath} must be repository-relative with no traversal.`,
    ];
  }

  // A non-object spec cannot describe how setup should treat the user's file.
  if (!isRecord(rawSpec)) {
    return [`file_ownership.${artifactPath} must be an object.`];
  }

  const ownership = rawSpec["ownership"];

  // Unknown classes have no deterministic overwrite/preserve behavior.
  if (!isFileOwnership(ownership)) {
    return [
      `file_ownership.${artifactPath}.ownership must be one of: system-owned, user-owned, generated, deprecated, external.`,
    ];
  }

  const findings: string[] = [];

  // Current files cannot also be retired because users would receive contradictory guidance.
  if (ownership === "deprecated" && declaredPaths.has(artifactPath)) {
    findings.push(
      `deprecated file ${artifactPath} must not remain required or optional.`,
    );
  }

  // Extra records are accepted only when audit needs to report a retired path.
  if (!declaredPaths.has(artifactPath) && ownership !== "deprecated") {
    findings.push(
      `file_ownership contains undeclared current path ${artifactPath}.`,
    );
  }

  findings.push(
    ...ownershipEvidenceFindings(
      artifactPath,
      ownership,
      rawSpec["source"],
      rawSpec["generator"],
    ),
  );
  return findings;
}

/**
 * Validate explicit update behavior for every required and optional manifest file.
 * Separate path, class, and evidence checks so operators receive every repair in one run.
 *
 * @param json - raw manifest; absent ownership means the installation needs explicit migration
 * @returns nothing on success; throws with every actionable ownership finding
 */
export function validateFileOwnershipSchema(json: ManifestJson): void {
  const ownershipValue: unknown = json.file_ownership;

  // Legacy manifests need an explicit migration because guessing ownership can destroy user edits.
  if (!isRecord(ownershipValue)) {
    throw new ManifestValidationError(
      "workflow/manifest.json file_ownership requires explicit migration; no default ownership is applied.",
      ["file_ownership must classify every required and optional file."],
    );
  }

  const findings: string[] = [];
  const declaredPaths = declaredOwnershipPaths(json);

  // Every current path needs one visible update contract before installers or audits consume it.
  for (const declaredPath of declaredPaths) {
    // A missing record would force callers to invent an unsafe default.
    if (!Object.hasOwn(ownershipValue, declaredPath)) {
      findings.push(`file_ownership is missing declared path ${declaredPath}.`);
    }
  }

  // Each ownership record must name one safe path, valid class, and usable source/generator evidence.
  for (const [artifactPath, rawSpec] of Object.entries(ownershipValue)) {
    findings.push(
      ...ownershipEntryFindings(artifactPath, rawSpec, declaredPaths),
    );
  }

  // A clean ownership registry is safe for setup, audit, and manifest reporting.
  if (findings.length === 0) return;
  throw new ManifestValidationError(
    `workflow/manifest.json has invalid file_ownership metadata (${findings.length} finding${findings.length === 1 ? "" : "s"}).`,
    findings,
  );
}

/**
 * List repeated values in one manifest array.
 * Use when a user-facing identifier or path must have exactly one owner.
 *
 * @param values - declared identifiers; empty means the manifest declares none
 * @returns repeated identifiers once each; empty means all supplied values are unique
 */
function duplicateValues(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  // Each repeated declaration would make the installer or command owner ambiguous.
  for (const value of values) {
    // A second occurrence creates a duplicate users cannot distinguish during setup.
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
}

/**
 * Check whether one manifest reference stays inside a committed skill pack.
 * Use before installers resolve the path relative to `workflow/skills/<skill>/`.
 *
 * @param referencePath - manifest path; empty or local-state paths are invalid
 * @returns true only for normalized Markdown below `references/`
 */
function isCommittedSkillReference(referencePath: string): boolean {
  // Windows separators and traversal can escape the pack even when the text starts with references.
  if (referencePath.includes("\\") || referencePath.includes("..")) {
    return false;
  }

  // Only committed Markdown inside the skill's reference pack can be mirrored safely.
  return /^references\/[A-Za-z0-9][A-Za-z0-9._/-]*\.md$/u.test(referencePath);
}

/**
 * Validate one skill's declared reference-pack entry.
 * Use so setup copies a unique, committed set of files for the named skill.
 *
 * @param canonical - valid skill names; empty means every reference key is unknown
 * @param skillName - manifest key; empty means no skill can own the references
 * @param files - raw JSON value; null/empty means the skill has no usable declared pack
 * @returns precise schema findings; empty means this skill entry is safe to install
 */
function validateOneSkillReference(
  canonical: ReadonlySet<string>,
  skillName: string,
  files: unknown,
): string[] {
  const findings: string[] = [];

  // Unknown keys would install files under a skill command users cannot invoke.
  if (!canonical.has(skillName)) {
    findings.push(
      `skills.references.${skillName} must reference a canonical skill name.`,
    );
  }

  // A non-array value cannot describe an ordered set of files for the installer.
  if (!Array.isArray(files)) {
    findings.push(`skills.references.${skillName} must be a string array.`);
    return findings;
  }

  // Non-text entries cannot resolve to a canonical file path.
  if (files.some((file) => typeof file !== "string")) {
    findings.push(`skills.references.${skillName} must contain only strings.`);
    return findings;
  }

  const referencePaths = files as string[];

  // Repeated paths can mask stale-copy and checked-count mistakes during setup.
  for (const duplicatePath of duplicateValues(referencePaths)) {
    findings.push(
      `skills.references.${skillName} contains duplicate path ${duplicatePath}.`,
    );
  }

  // Every declared file must stay within the committed reference pack, never logs, plans, or scratchpad.
  for (const referencePath of referencePaths) {
    // A safe committed path is ready for the installer and needs no finding.
    if (isCommittedSkillReference(referencePath)) continue;
    findings.push(
      `skills.references.${skillName} path ${referencePath} must be a committed \`references/\` path ending in .md with no traversal.`,
    );
  }
  return findings;
}

/**
 * Report duplicate canonical install paths from the manifest's required sets.
 * Use so each required file or directory has one deterministic setup owner.
 *
 * @param json - parsed manifest; empty required arrays mean no install paths are declared
 * @returns duplicate-path findings; empty means every required path is unique; never throws
 */
function canonicalPathFindings(json: ManifestJson): string[] {
  const findings: string[] = [];

  // Required files and directories are canonical install IDs, so each path can have only one owner.
  for (const [pathListName, manifestPaths] of [
    ["required_files", json.required_files],
    ["required_dirs", json.required_dirs],
  ] as const) {
    // Each duplicate in this required set needs its own actionable path finding.
    for (const duplicatePath of duplicateValues(manifestPaths)) {
      findings.push(
        `${pathListName} contains duplicate canonical path ${duplicatePath}.`,
      );
    }
  }
  return findings;
}

/**
 * Report duplicate or contradictory canonical and retired skill IDs.
 * Use so one manifest identity always means either installable or retired, never both.
 *
 * @param json - parsed manifest; empty skill arrays mean no identities are declared
 * @returns skill-ID findings; empty means canonical and retired names are internally consistent; never throws
 */
function skillIdentifierFindings(json: ManifestJson): string[] {
  const findings: string[] = [];

  // Duplicate canonical names make one skill ID own multiple manifest positions.
  for (const duplicateName of duplicateValues(json.skills.canonical)) {
    findings.push(
      `skills.canonical contains duplicate skill identifier ${duplicateName}.`,
    );
  }

  // Duplicate retired names make migration ownership ambiguous and inflate artifact counts.
  for (const duplicateName of duplicateValues(json.skills.stale_names)) {
    findings.push(
      `skills.stale_names contains duplicate skill identifier ${duplicateName}.`,
    );
  }

  const canonicalNames = new Set(json.skills.canonical);

  // A skill cannot be both installable and retired in the same release contract.
  for (const staleName of json.skills.stale_names) {
    // A retired-only name does not conflict with the commands users can install.
    if (!canonicalNames.has(staleName)) continue;
    findings.push(
      `skill identifier ${staleName} appears in both skills.canonical and skills.stale_names.`,
    );
  }
  return findings;
}

/**
 * Validate the optional per-skill reference map against canonical skill IDs.
 * Use so setup receives a complete map of safe committed files or no map at all.
 *
 * @param json - parsed manifest; absent references mean no skill has an extra pack
 * @returns reference-map findings; empty means every declared pack is safe and canonical; never throws
 */
function skillReferenceFindings(json: ManifestJson): string[] {
  const references: unknown = json.skills.references;

  // A release may declare no per-skill reference packs.
  if (references === undefined) return [];

  // Reference metadata must be a map so each pack has one canonical skill owner.
  if (
    typeof references !== "object" ||
    references === null ||
    Array.isArray(references)
  ) {
    return [
      "skills.references must be an object keyed by canonical skill name.",
    ];
  }

  const findings: string[] = [];
  const canonicalNames = new Set(json.skills.canonical);

  // Each reference-pack entry contributes all of its actionable schema findings.
  for (const [skillName, files] of Object.entries(references)) {
    findings.push(
      ...validateOneSkillReference(canonicalNames, skillName, files),
    );
  }
  return findings;
}

/**
 * Stop manifest loading when artifact metadata would produce incomplete user guidance.
 * Use after collecting independent findings so one run reports every repair path.
 *
 * @param findings - artifact errors to report; empty means manifest loading may continue
 * @returns nothing; throws `ManifestValidationError` when one or more findings exist
 */
function throwForArtifactFindings(findings: readonly string[]): void {
  // A clean manifest continues silently into the normal derived-fact checks.
  if (findings.length === 0) return;
  throw new ManifestValidationError(
    `workflow/manifest.json has invalid skill artifact metadata (${findings.length} finding${findings.length === 1 ? "" : "s"}).`,
    [...findings],
  );
}

/**
 * Validate optional skill-docs metadata before consumers read it.
 *
 * Throws `ManifestValidationError` on malformed references because stale or
 * misspelled reference lists change what the installer copies.
 *
 * @param json - parsed manifest; empty identity/reference arrays mean no artifacts are declared
 * @returns nothing on success; throws with all identity/reference findings on failure
 */
export function validateSkillReferenceSchema(json: ManifestJson): void {
  const findings = [
    ...canonicalPathFindings(json),
    ...skillIdentifierFindings(json),
    ...skillReferenceFindings(json),
  ];
  throwForArtifactFindings(findings);
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
  validateFileOwnershipSchema(json);
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
