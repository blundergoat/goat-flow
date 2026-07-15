/**
 * Lightweight positional and flag rules for the `skill` CLI namespace.
 * Use during argv parsing so `skill new` and read-only `skill doctor` remain
 * isolated without importing their heavier authoring or diagnostic runtimes.
 * Every failure is a user-facing CLI usage error with exit code 2.
 */
import { resolve } from "node:path";
import { CLIError } from "./cli-error.js";
import type {
  Command,
  ParsedArgValues,
  QualitySubcommand,
  SkillCLIFields,
  SkillSubcommand,
} from "./cli-types.js";

/** Skill-specific positionals resolved before shared CLI fields are assembled. */
export interface SkillPositionals {
  skillSubcommand: SkillSubcommand | null;
  skillDescription: string | null;
  projectPath: string;
}

/** Return a raw string flag without trusting the generic parseArgs value map. */
function parsedString(
  values: ParsedArgValues,
  name: string,
): string | undefined {
  const value = values[name];
  return typeof value === "string" ? value : undefined;
}

/** Return whether one raw boolean flag was explicitly selected by the user. */
function parsedFlag(values: ParsedArgValues, name: string): boolean {
  return values[name] === true;
}

/** Detect path-shaped authoring values so free-form descriptions stay intact. */
function isPathShapedSkillProject(value: string): boolean {
  const normalizedPath = value.replace(/\\/gu, "/");
  return (
    value === "." ||
    value === ".." ||
    normalizedPath.startsWith("./") ||
    normalizedPath.startsWith("../") ||
    normalizedPath.startsWith("/") ||
    /^[a-zA-Z]:[\\/]/u.test(value) ||
    value.startsWith("\\\\")
  );
}

/** Join the remaining authoring words into one user description, or null when absent. */
function parseSkillDescription(parts: string[]): string | null {
  const description = parts
    .filter(
      (part): part is string => typeof part === "string" && part.length > 0,
    )
    .join(" ");
  return description.length > 0 ? description : null;
}

/** Parse either supported project-path placement for `skill new`. */
function parseSkillNewPositionals(
  positionals: string[],
): SkillPositionals | null {
  const [first, second, ...rest] = positionals;

  // Subcommand-first authoring may put one path before its free-form description.
  if (first === "new") {
    const hasProjectPath =
      second !== undefined && isPathShapedSkillProject(second);
    return {
      skillSubcommand: "new",
      skillDescription: parseSkillDescription(
        hasProjectPath ? rest : positionals.slice(1),
      ),
      projectPath: hasProjectPath ? resolve(second) : resolve("."),
    };
  }

  // Project-first authoring keeps the historical `skill <path> new` form available.
  if (second === "new") {
    return {
      skillSubcommand: "new",
      skillDescription: parseSkillDescription(rest),
      projectPath: resolve(first ?? "."),
    };
  }
  return null;
}

/** Parse either supported project-path placement for read-only `skill doctor`. */
function parseSkillDoctorPositionals(
  positionals: string[],
): SkillPositionals | null {
  const [first, second, ...rest] = positionals;

  // Subcommand-first diagnosis accepts at most one target project path.
  if (first === "doctor") {
    // A second extra positional has no defined user meaning in doctor mode.
    if (rest.length > 0) {
      throw new CLIError(
        "skill doctor accepts at most one positional project path.",
        2,
      );
    }
    return {
      skillSubcommand: "doctor",
      skillDescription: null,
      projectPath: resolve(second ?? "."),
    };
  }

  // Project-first diagnosis mirrors the established skill namespace path form.
  if (second === "doctor") {
    // Project-first mode also permits no trailing positional after the subcommand.
    if (rest.length > 0) {
      throw new CLIError(
        "skill doctor accepts at most one positional project path.",
        2,
      );
    }
    return {
      skillSubcommand: "doctor",
      skillDescription: null,
      projectPath: resolve(first ?? "."),
    };
  }
  return null;
}

/**
 * Parse skill authoring or doctor positionals without loading either runtime.
 * Use from the shared CLI parser before command dispatch.
 *
 * @param positionals - skill arguments; empty means the user supplied only `skill`
 * @returns resolved subcommand, description, and target path for the selected user flow
 * @throws `CLIError` when the subcommand or positional count has no supported meaning
 */
export function parseSkillPositionals(positionals: string[]): SkillPositionals {
  const first = positionals[0];

  // A bare `skill` command reaches the handler, which prints the shared usage contract.
  if (first === undefined) {
    return {
      skillSubcommand: null,
      skillDescription: null,
      projectPath: resolve("."),
    };
  }
  const authoringPositionals = parseSkillNewPositionals(positionals);

  // A recognized authoring shape is complete and needs no doctor parsing.
  if (authoringPositionals !== null) return authoringPositionals;
  const doctorPositionals = parseSkillDoctorPositionals(positionals);

  // A recognized doctor shape is complete and stays read-only through dispatch.
  if (doctorPositionals !== null) return doctorPositionals;
  if (isPathShapedSkillProject(first)) {
    throw new CLIError(
      `skill project path "${first}" is missing a subcommand. Use: skill ${first} new <description> or skill ${first} doctor`,
      2,
    );
  }
  throw new CLIError(
    `unknown skill subcommand "${first}". Supported: new, doctor`,
    2,
  );
}

/** Validate draft input against candidacy and skill-new modes. */
function validateDraftFlag(
  command: Command,
  values: ParsedArgValues,
  qualitySubcommand: QualitySubcommand,
  isSkillNew: boolean,
): void {
  const isQualityCandidacy =
    command === "quality" && qualitySubcommand === "candidacy";

  // Draft input belongs to candidacy scoring or authoring, never diagnosis.
  if (
    parsedString(values, "draft") !== undefined &&
    !isQualityCandidacy &&
    !isSkillNew
  ) {
    throw new CLIError(
      "--draft is only valid for quality candidacy and skill new.",
      2,
    );
  }
}

/** Validate the three write-capable authoring flags through one rule table. */
function validateAuthoringOnlyFlags(
  values: ParsedArgValues,
  isSkillNew: boolean,
): void {
  const authoringFlags: Array<[string, boolean]> = [
    ["--interactive", parsedFlag(values, "interactive")],
    ["--name", parsedString(values, "name") !== undefined],
    ["--yes", parsedFlag(values, "yes")],
  ];

  // Each selected write-capable flag must stay inside the confirmed authoring mode.
  for (const [flagName, isSelected] of authoringFlags) {
    // Unselected flags and valid skill-new flags need no usage error.
    if (!isSelected || isSkillNew) continue;
    throw new CLIError(`${flagName} is only valid for skill new.`, 2);
  }
}

/** Validate the read-only canonical skill filter. */
function validateDoctorFilter(
  values: ParsedArgValues,
  isSkillDoctor: boolean,
): void {
  // A doctor-only filter on any other command would silently change user intent.
  if (parsedString(values, "skill") !== undefined && !isSkillDoctor) {
    throw new CLIError("--skill is only valid for skill doctor.", 2);
  }
}

/**
 * Keep authoring flags and the doctor filter on their intended skill modes.
 * Use after positional parsing so every flag has an explicit mode owner.
 *
 * @param command - selected top-level command; non-skill commands reject skill-only flags
 * @param values - parsed flags; empty means no mode-specific option was requested
 * @param qualitySubcommand - selected quality mode for the shared `--draft` exception
 * @param skillSubcommand - selected skill mode; null means no valid skill mode was supplied
 * @returns nothing when every supplied flag belongs to its selected user flow
 * @throws `CLIError` when authoring and diagnostic flags are mixed or misplaced
 */
export function validateSkillFlags(
  command: Command,
  values: ParsedArgValues,
  qualitySubcommand: QualitySubcommand,
  skillSubcommand: SkillSubcommand | null,
): void {
  const isSkillNew = command === "skill" && skillSubcommand === "new";
  const isSkillDoctor = command === "skill" && skillSubcommand === "doctor";
  validateDraftFlag(command, values, qualitySubcommand, isSkillNew);
  validateAuthoringOnlyFlags(values, isSkillNew);
  validateDoctorFilter(values, isSkillDoctor);
}

/**
 * Build the skill-only slice of parsed CLI options for command dispatch.
 * Use after strict parseArgs validates the raw flag shapes.
 *
 * @param command - selected command; non-skill commands receive null/false defaults
 * @param values - parsed flags; absent values remain null in the dispatched options
 * @param positionals - resolved skill mode and project path from positional parsing
 * @returns normalized skill fields consumed by authoring or doctor dispatch
 */
export function buildSkillCLIFields(
  command: Command,
  values: ParsedArgValues,
  positionals: SkillPositionals,
): SkillCLIFields {
  const isSkillCommand = command === "skill";
  const skillDraftValue = isSkillCommand
    ? parsedString(values, "draft")
    : undefined;
  return {
    skillSubcommand: positionals.skillSubcommand,
    skillDescription: positionals.skillDescription,
    skillDraftPath:
      skillDraftValue === undefined ? null : resolve(skillDraftValue),
    skillName: isSkillCommand ? (parsedString(values, "name") ?? null) : null,
    skillFilter: isSkillCommand
      ? (parsedString(values, "skill") ?? null)
      : null,
    skillInteractive: isSkillCommand && parsedFlag(values, "interactive"),
    skillSkipConfirm: isSkillCommand && parsedFlag(values, "yes"),
  };
}
