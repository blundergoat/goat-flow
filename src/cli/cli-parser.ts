/**
 * Turns raw `process.argv` into the fully-resolved ParsedCLI object that command dispatch consumes.
 * It owns the whole front door: positional command detection, per-flag validation, per-command
 * positional grammars (quality/skill/events/hooks each have their own arity rules), and cross-flag
 * checks that strict parseArgs can't express. The deliberate contract is fail-fast for malformed
 * commands, flags, values, or combinations, throwing CLIError with exit code 2 (usage error) and a
 * human-readable message, so the entry point can print it and exit without a stack trace. Path
 * positionals are resolved to absolute paths here so downstream handlers never see relative input.
 */

import { parseArgs } from "node:util";
import { join, resolve } from "node:path";
import type { CLIOptions, AgentId } from "./types.js";
import { QUALITY_MODES, type QualityMode } from "./quality/schema.js";
import {
  validAgents,
  validAgentFlags,
  validAgentList,
} from "./cli-agent-options.js";
import { CLIError } from "./cli-error.js";
import {
  COMMANDS,
  HOOK_SUBCOMMANDS,
  REMOVED_COMMANDS,
  VALID_FORMATS,
  type CandidacyInputArg,
  type Command,
  type EventsSubcommand,
  type HookSubcommand,
  type ParsedArgValues,
  type ParsedCLI,
  type QualitySubcommand,
  type SkillCLIFields,
  type SkillSubcommand,
} from "./cli-types.js";

/** Parse the positional subcommand from raw CLI args; throws CLIError for removed commands with migration help. */
function parseCommand(argv: string[]): {
  command: Command;
  filteredArgs: string[];
} {
  const filteredArgs = [...argv];
  if (filteredArgs.length === 0) {
    return { command: "menu", filteredArgs };
  }
  const first = filteredArgs[0];
  if (first !== undefined && Object.hasOwn(REMOVED_COMMANDS, first)) {
    const message = REMOVED_COMMANDS[first];
    if (message !== undefined) throw new CLIError(message, 2);
  }
  if (
    filteredArgs.length > 0 &&
    COMMANDS.includes(filteredArgs[0] as Command)
  ) {
    return { command: filteredArgs.shift() as Command, filteredArgs };
  }
  return { command: "audit", filteredArgs };
}

/** Parse the `--format` flag; throws CLIError for invalid values before command dispatch. */
function parseFormatArg(value: string | undefined): CLIOptions["format"] {
  const defaultFormat: CLIOptions["format"] = process.stdout.isTTY
    ? "text"
    : "json";
  if (!value) return defaultFormat;
  if (!VALID_FORMATS.includes(value as (typeof VALID_FORMATS)[number])) {
    throw new CLIError(
      `Invalid format: ${value}. Use: json, text, markdown, sarif`,
      2,
    );
  }
  return value as CLIOptions["format"];
}

/** Parse the `--agent` flag; throws CLIError for invalid or deprecated aggregate values. */
function parseAgentArg(value: string | undefined): AgentId | null {
  if (!value) return null;
  if (value === "all") {
    throw new CLIError(
      `--agent all is no longer supported. Run setup separately for each agent: ${validAgentFlags()}`,
      2,
    );
  }
  if (!validAgents().includes(value as AgentId)) {
    throw new CLIError(`Invalid agent: ${value}. Use: ${validAgentList()}`, 2);
  }
  return value as AgentId;
}

/** Parse the quality-history/diff mode filter; throws CLIError for invalid modes. */
function parseQualityModeArg(value: string | undefined): QualityMode | null {
  if (!value) return null;
  if (!QUALITY_MODES.includes(value as QualityMode)) {
    throw new CLIError(
      `Invalid quality mode: ${value}. Use: ${QUALITY_MODES.join(", ")}`,
      2,
    );
  }
  return value as QualityMode;
}

/** Resolve `--output`, defaulting bare file names into `.goat-flow/` under the target repo. */
function resolveOutputPath(
  output: string | undefined,
  projectRoot: string,
): string | null {
  if (!output) return null;
  return resolve(
    output.includes("/") || output.includes("\\")
      ? output
      : join(projectRoot, ".goat-flow", output),
  );
}

/** Parse quality subcommand positionals; throws CLIError for invalid subcommand arity. */
// eslint-disable-next-line complexity -- intentional because each quality positional error reports in CLI order
function parseQualityPositionals(
  positionals: string[],
  draftFlag: string | null,
): {
  qualitySubcommand: QualitySubcommand;
  projectPath: string;
  qualityDiffPair: string | null;
  qualityValidatePath: string | null;
  candidacyInput: CandidacyInputArg | null;
} {
  const [first, second, ...rest] = positionals;

  if (first === "capture") {
    throw new CLIError(
      '"quality capture" was removed in v1.2.0. Agents now write reports directly to `.goat-flow/logs/quality/`; no capture step is needed.',
      2,
    );
  }

  if (first === "history") {
    if (rest.length > 0) {
      throw new CLIError(
        "quality history accepts at most one positional project path.",
        2,
      );
    }
    return {
      qualitySubcommand: "history",
      projectPath: second !== undefined ? resolve(second) : resolve("."),
      qualityDiffPair: null,
      qualityValidatePath: null,
      candidacyInput: null,
    };
  }

  if (first === "candidacy") {
    if (draftFlag !== null) {
      if (second !== undefined || rest.length > 0) {
        throw new CLIError(
          "quality candidacy: pass either --draft <path> OR a description, not both.",
          2,
        );
      }
      return {
        qualitySubcommand: "candidacy",
        projectPath: resolve("."),
        qualityDiffPair: null,
        qualityValidatePath: null,
        candidacyInput: { mode: "draft", value: resolve(draftFlag) },
      };
    }
    const description = [second, ...rest]
      .filter(
        (part): part is string => typeof part === "string" && part.length > 0,
      )
      .join(" ");
    if (description.length === 0) {
      throw new CLIError(
        "quality candidacy: pass --draft <path> or a description string.",
        2,
      );
    }
    return {
      qualitySubcommand: "candidacy",
      projectPath: resolve("."),
      qualityDiffPair: null,
      qualityValidatePath: null,
      candidacyInput: { mode: "description", value: description },
    };
  }

  if (first === "diff") {
    if (rest.length > 0) {
      throw new CLIError(
        "quality diff accepts at most one positional pair in the form <from-id>:<to-id>.",
        2,
      );
    }
    return {
      qualitySubcommand: "diff",
      projectPath: resolve("."),
      qualityDiffPair: second ?? null,
      qualityValidatePath: null,
      candidacyInput: null,
    };
  }

  if (first === "validate") {
    if (second === undefined || rest.length > 0) {
      throw new CLIError(
        "quality validate requires exactly one positional <path-to-report>.",
        2,
      );
    }
    return {
      qualitySubcommand: "validate",
      projectPath: resolve("."),
      qualityDiffPair: null,
      qualityValidatePath: resolve(second),
      candidacyInput: null,
    };
  }

  return {
    qualitySubcommand: "prompt",
    projectPath: resolve(first ?? "."),
    qualityDiffPair: null,
    qualityValidatePath: null,
    candidacyInput: null,
  };
}

/** Parse events subcommand positionals; throws CLIError for unsupported subcommands or arity. */
function parseEventsPositionals(positionals: string[]): {
  eventsSubcommand: EventsSubcommand;
  projectPath: string;
} {
  const [first, second, ...rest] = positionals;
  if (first !== "tail") {
    throw new CLIError('events requires subcommand "tail".', 2);
  }
  if (rest.length > 0) {
    throw new CLIError(
      "events tail accepts at most one positional project path.",
      2,
    );
  }
  return {
    eventsSubcommand: "tail",
    projectPath: resolve(second ?? "."),
  };
}

/** Parse hooks subcommand positionals; throws CLIError for unsupported subcommands or arity. */
function parseHooksPositionals(positionals: string[]): {
  hookSubcommand: HookSubcommand;
  hookId: string | null;
  projectPath: string;
} {
  const [first, second, third, ...rest] = positionals;
  if (!first || !HOOK_SUBCOMMANDS.has(first)) {
    throw new CLIError(
      'hooks requires subcommand "list", "enable", "disable", or "sync".',
      2,
    );
  }
  const subcommand = first as HookSubcommand;
  if (subcommand === "enable" || subcommand === "disable")
    return parseHookTogglePositionals(subcommand, second, third, rest);
  if (third !== undefined || rest.length > 0) {
    throw new CLIError(
      `hooks ${subcommand} accepts at most one project path.`,
      2,
    );
  }
  return {
    hookSubcommand: subcommand,
    hookId: null,
    projectPath: resolve(second ?? "."),
  };
}

function parseHookTogglePositionals(
  subcommand: "enable" | "disable",
  hookId: string | undefined,
  projectPath: string | undefined,
  rest: string[],
): { hookSubcommand: HookSubcommand; hookId: string; projectPath: string } {
  if (hookId === undefined || rest.length > 0) {
    throw new CLIError(
      `hooks ${subcommand} requires <hook-id> [project-path].`,
      2,
    );
  }
  return {
    hookSubcommand: subcommand,
    hookId,
    projectPath: resolve(projectPath ?? "."),
  };
}

/** Return the project path and quality-specific positionals for a command. */
function parseCommandPositionals(
  command: Command,
  positionals: string[],
  draftFlag: string | null,
): ReturnType<typeof parseQualityPositionals> {
  if (command === "quality")
    return parseQualityPositionals(positionals, draftFlag);
  if (command === "skill")
    return {
      qualitySubcommand: "prompt",
      projectPath: parseSkillPositionals(positionals).projectPath,
      qualityDiffPair: null,
      qualityValidatePath: null,
      candidacyInput: null,
    };
  if (command === "hooks")
    return {
      qualitySubcommand: "prompt",
      projectPath: parseHooksPositionals(positionals).projectPath,
      qualityDiffPair: null,
      qualityValidatePath: null,
      candidacyInput: null,
    };
  return {
    qualitySubcommand: "prompt",
    projectPath: resolve(positionals[0] ?? "."),
    qualityDiffPair: null,
    qualityValidatePath: null,
    candidacyInput: null,
  };
}

/** Parsed skill command positionals before flag-derived fields are merged. */
interface SkillPositionals {
  skillSubcommand: SkillSubcommand | null;
  skillDescription: string | null;
  projectPath: string;
}

/** Detect positional skill project paths so descriptions do not accidentally consume them. */
function isPathShapedSkillProject(value: string): boolean {
  const normalized = value.replace(/\\/gu, "/");
  return (
    value === "." ||
    value === ".." ||
    normalized.startsWith("./") ||
    normalized.startsWith("../") ||
    normalized.startsWith("/") ||
    /^[a-zA-Z]:[\\/]/u.test(value) ||
    value.startsWith("\\\\")
  );
}

/** Join free-form skill description parts after dropping absent argv values. */
function parseSkillDescription(parts: string[]): string | null {
  const description = parts
    .filter(
      (part): part is string => typeof part === "string" && part.length > 0,
    )
    .join(" ");
  return description.length > 0 ? description : null;
}

/** Parse `skill [project-path] new [project-path] [description...]`; throws CLIError for unknown subcommands. */
function parseSkillPositionals(positionals: string[]): SkillPositionals {
  const [first, second, ...rest] = positionals;
  if (first === undefined) {
    return {
      skillSubcommand: null,
      skillDescription: null,
      projectPath: resolve("."),
    };
  }
  if (first === "new") {
    const descriptionParts =
      second !== undefined && isPathShapedSkillProject(second)
        ? rest
        : positionals.slice(1);
    return {
      skillSubcommand: "new",
      skillDescription: parseSkillDescription(descriptionParts),
      projectPath:
        second !== undefined && isPathShapedSkillProject(second)
          ? resolve(second)
          : resolve("."),
    };
  }
  if (second === "new") {
    return {
      skillSubcommand: "new",
      skillDescription: parseSkillDescription(rest),
      projectPath: resolve(first),
    };
  }
  throw new CLIError(`unknown skill subcommand "${first}". Supported: new`, 2);
}

/** Validate flags shared across commands. */
function rejectFlagOutsideCommand(
  command: Command,
  expectedCommand: Command,
  flag: string,
  isSet: boolean,
): void {
  if (command === expectedCommand || !isSet) return;
  throw new CLIError(
    `${flag} is only valid for the ${expectedCommand} command.`,
    2,
  );
}

/** Return whether a raw `parseArgs` boolean flag was explicitly set. */
function parsedFlag(values: ParsedArgValues, name: string): boolean {
  return values[name] === true;
}

/** Return a raw `parseArgs` string value without trusting the option map shape. */
function parsedString(
  values: ParsedArgValues,
  name: string,
): string | undefined {
  const value = values[name];
  return typeof value === "string" ? value : undefined;
}

/** Reject shared flags when they are attached to commands that do not support them. */
function validateCommonFlags(command: Command, values: ParsedArgValues): void {
  rejectFlagOutsideCommand(
    command,
    "audit",
    "--format sarif",
    parsedString(values, "format") === "sarif",
  );
  rejectFlagOutsideCommand(
    command,
    "quality",
    "--all",
    parsedFlag(values, "all"),
  );
  rejectFlagOutsideCommand(
    command,
    "quality",
    "--mode",
    parsedString(values, "mode") !== undefined,
  );
  rejectFlagOutsideCommand(
    command,
    "events",
    "--limit",
    parsedString(values, "limit") !== undefined,
  );
  rejectFlagOutsideCommand(
    command,
    "audit",
    "--no-audit-details",
    parsedFlag(values, "no-audit-details"),
  );
}

/** Returns true when the command resolves to a deterministic install/apply path. */
function isInstallCommand(command: Command, values: ParsedArgValues): boolean {
  return (
    command === "install" ||
    (command === "setup" && parsedFlag(values, "apply"))
  );
}

/** Validate deterministic install/setup flags; throws CLIError when flags target the wrong command. */
function validateInstallFlags(command: Command, values: ParsedArgValues): void {
  if (command !== "setup" && parsedFlag(values, "apply")) {
    throw new CLIError("--apply is only valid for the setup command.", 2);
  }
  const installOnly: Array<[string, boolean | undefined]> = [
    ["--force", parsedFlag(values, "force")],
    ["--update-config-version", parsedFlag(values, "update-config-version")],
    ["--clean-deprecated", parsedFlag(values, "clean-deprecated")],
  ];
  for (const [flag, set] of installOnly) {
    if (set === true && !isInstallCommand(command, values)) {
      throw new CLIError(
        `${flag} is only valid for install or setup --apply.`,
        2,
      );
    }
  }
}

/** Validate quality mode flags against the selected quality subcommand. */
// eslint-disable-next-line complexity -- intentional because one validator preserves the cross-command error contract
function validateQualityFlags(
  command: Command,
  values: ParsedArgValues,
  qualitySubcommand: QualitySubcommand,
): void {
  if (
    command === "quality" &&
    parsedString(values, "mode") !== undefined &&
    !["prompt", "history", "diff"].includes(qualitySubcommand)
  ) {
    throw new CLIError(
      "--mode is only valid for quality prompt, quality history, and quality diff.",
      2,
    );
  }
  if (
    parsedString(values, "draft") !== undefined &&
    !(
      (command === "quality" && qualitySubcommand === "candidacy") ||
      command === "skill"
    )
  ) {
    throw new CLIError(
      "--draft is only valid for quality candidacy and skill new.",
      2,
    );
  }
  if (parsedFlag(values, "interactive") && command !== "skill") {
    throw new CLIError("--interactive is only valid for skill new.", 2);
  }
  if (parsedString(values, "name") !== undefined && command !== "skill") {
    throw new CLIError("--name is only valid for skill new.", 2);
  }
  if (parsedFlag(values, "yes") && command !== "skill") {
    throw new CLIError("--yes is only valid for skill new.", 2);
  }
}

/** Validate flag combinations after strict parseArgs accepts their shapes. */
function validateFlagCombinations(
  command: Command,
  values: ParsedArgValues,
  qualitySubcommand: QualitySubcommand,
): void {
  validateCommonFlags(command, values);
  validateInstallFlags(command, values);
  validateQualityFlags(command, values, qualitySubcommand);
}

/** Parse the events tail limit; throws CLIError for invalid values before clamping to the display cap. */
function parseEventsLimitArg(value: string | undefined): number {
  if (value === undefined) return 20;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || String(parsed) !== value) {
    throw new CLIError("--limit must be a positive integer.", 2);
  }
  return Math.min(parsed, 500);
}

function buildSkillCLIFields(
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
    skillInteractive: isSkillCommand && parsedFlag(values, "interactive"),
    skillSkipConfirm: isSkillCommand && parsedFlag(values, "yes"),
  };
}

/**
 * Parse raw CLI argv into structured command options.
 * Throws CLIError when a command, flag, positional, or value combination is invalid.
 *
 * @param argv - raw CLI arguments after the executable and script path
 * @returns normalized options consumed by command dispatch
 */
export function parseCLIArgs(argv: string[]): ParsedCLI {
  const { command, filteredArgs } = parseCommand(argv);

  /** Destructured parseArgs result containing option values and positional arguments */
  const { values, positionals } = parseArgs({
    args: filteredArgs,
    options: {
      format: { type: "string" },
      agent: { type: "string" },
      mode: { type: "string" },
      verbose: { type: "boolean", default: false },
      output: { type: "string", short: "o" },
      all: { type: "boolean", default: false },
      limit: { type: "string" },
      harness: { type: "boolean", default: false },
      "check-drift": { type: "boolean", default: false },
      "check-content": { type: "boolean", default: false },
      "untrusted-target": { type: "boolean", default: false },
      "no-audit-details": { type: "boolean", default: false },
      check: { type: "boolean", default: false },
      apply: { type: "boolean", default: false },
      force: { type: "boolean", default: false },
      "update-config-version": { type: "boolean", default: false },
      "clean-deprecated": { type: "boolean", default: false },
      dev: { type: "boolean", default: false },
      draft: { type: "string" },
      interactive: { type: "boolean", default: false },
      name: { type: "string" },
      yes: { type: "boolean", short: "y", default: false },
      json: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false },
    },
    allowPositionals: true,
    strict: true,
  });

  const parsedValues = values as ParsedArgValues;
  const qualityPositionals = parseCommandPositionals(
    command,
    positionals,
    parsedString(parsedValues, "draft") ?? null,
  );
  const eventsPositionals =
    command === "events"
      ? parseEventsPositionals(positionals)
      : { eventsSubcommand: null, projectPath: qualityPositionals.projectPath };
  const hooksPositionals =
    command === "hooks"
      ? parseHooksPositionals(positionals)
      : {
          hookSubcommand: null,
          hookId: null,
          projectPath: qualityPositionals.projectPath,
        };
  const projectPath =
    command === "events"
      ? eventsPositionals.projectPath
      : command === "hooks"
        ? hooksPositionals.projectPath
        : qualityPositionals.projectPath;
  const skillPositionals: SkillPositionals =
    command === "skill"
      ? parseSkillPositionals(positionals)
      : {
          skillSubcommand: null,
          skillDescription: null,
          projectPath,
        };
  const skillFields = buildSkillCLIFields(
    command,
    parsedValues,
    skillPositionals,
  );
  validateFlagCombinations(
    command,
    parsedValues,
    qualityPositionals.qualitySubcommand,
  );

  return {
    command,
    projectPath,
    format: parseFormatArg(
      parsedFlag(parsedValues, "json")
        ? "json"
        : parsedString(parsedValues, "format"),
    ),
    agent: parseAgentArg(parsedString(parsedValues, "agent")),
    isVerbose: parsedFlag(parsedValues, "verbose"),
    output: resolveOutputPath(
      parsedString(parsedValues, "output"),
      projectPath,
    ),
    includeHarness: parsedFlag(parsedValues, "harness"),
    checkDrift: parsedFlag(parsedValues, "check-drift"),
    checkContent: parsedFlag(parsedValues, "check-content"),
    untrustedTarget: parsedFlag(parsedValues, "untrusted-target"),
    auditDetails: !parsedFlag(parsedValues, "no-audit-details"),
    shouldCheck: parsedFlag(parsedValues, "check"),
    shouldApply: parsedFlag(parsedValues, "apply"),
    shouldForce: parsedFlag(parsedValues, "force"),
    updateConfigVersion: parsedFlag(parsedValues, "update-config-version"),
    cleanDeprecated: parsedFlag(parsedValues, "clean-deprecated"),
    qualitySubcommand: qualityPositionals.qualitySubcommand,
    qualityDiffPair: qualityPositionals.qualityDiffPair,
    qualityValidatePath: qualityPositionals.qualityValidatePath,
    qualityMode: parseQualityModeArg(parsedString(parsedValues, "mode")),
    candidacyInput: qualityPositionals.candidacyInput,
    ...skillFields,
    eventsSubcommand: eventsPositionals.eventsSubcommand,
    eventsLimit: parseEventsLimitArg(parsedString(parsedValues, "limit")),
    hookSubcommand: hooksPositionals.hookSubcommand,
    hookId: hooksPositionals.hookId,
    includeAll: parsedFlag(parsedValues, "all"),
    isDevMode: parsedFlag(parsedValues, "dev"),
    showHelp: parsedFlag(parsedValues, "help"),
    showVersion: parsedFlag(parsedValues, "version"),
  };
}

/** Remove heavy per-check detail payloads from compact JSON audit output. */
