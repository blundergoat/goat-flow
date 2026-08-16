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
import { resolve } from "node:path";
import type { CLIOptions, AgentId } from "./types.js";
import {
  validAgents,
  validAgentFlags,
  validAgentList,
} from "./cli-agent-options.js";
import { CLIError } from "./cli-error.js";
import {
  COMMANDS,
  REMOVED_COMMANDS,
  VALID_FORMATS,
  type Command,
  type DiagnosticsSubcommand,
  type HookSubcommand,
  type ParsedArgValues,
  type ParsedCLI,
  type PlansSubcommand,
  type PlansTimeAction,
  type PlansTimeCategory,
  type QualitySubcommand,
  type SkillSubcommand,
} from "./cli-types.js";
import { parseDiagnosticsPositionals } from "./diagnostics-command-parser.js";
import {
  parseCommandPositionals,
  parseEventsPositionals,
  parseHookScenarioArg,
  parseHooksPositionals,
  parsePlansPositionals,
  parseQualityModeArg,
  resolveOutputPath,
} from "./cli-parser-positionals.js";
import { buildReviewCLIFields } from "./review-command-parser.js";
import {
  buildSkillCLIFields,
  parseSkillPositionals,
  validateSkillFlags,
  type SkillPositionals,
} from "./skill-command-parser.js";

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

/** Read one repeatable string option as a list; an absent option yields an empty list. */
function parsedStringList(
  values: ParsedArgValues,
  name: string,
): readonly string[] {
  const raw = values[name];
  // `parseArgs` omits the key entirely until the user supplies the option at least once.
  return Array.isArray(raw)
    ? raw.filter((entry): entry is string => typeof entry === "string")
    : [];
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

/** Supply ignored, valid namespace positionals while help or version short-circuits dispatch. */
const INFORMATIONAL_POSITIONALS: Partial<Record<Command, string[]>> = {
  diagnostics: ["context"],
  events: ["tail"],
  hooks: ["list"],
  plans: ["export", "."],
  review: ["validate"],
};
/** Choose real positionals unless the CLI will stop after rendering information. */
function selectCommandPositionals(
  command: Command,
  positionals: string[],
  values: ParsedArgValues,
): string[] {
  const isInformational =
    parsedFlag(values, "help") || parsedFlag(values, "version");
  return isInformational
    ? (INFORMATIONAL_POSITIONALS[command] ?? [])
    : positionals;
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

/** Reject runtime scenario flags outside the explicit hooks verification route. */
function validateHookFlags(
  command: Command,
  values: ParsedArgValues,
  hookSubcommand: HookSubcommand | null,
): void {
  const scenario = parsedString(values, "scenario");
  // A scenario name has no meaning for listing, toggling, syncing, or another command.
  if (
    scenario !== undefined &&
    (command !== "hooks" || hookSubcommand !== "verify")
  ) {
    throw new CLIError(
      "--scenario is only valid for the hooks verify command.",
      2,
    );
  }
}

/** Reject strict plan accounting anywhere except the read-only plans check route. */
function validatePlansFlags(
  command: Command,
  values: ParsedArgValues,
  plansSubcommand: PlansSubcommand | null,
  plansTimeAction: PlansTimeAction | null,
): void {
  validatePlansStrictFlag(command, values, plansSubcommand);
  validatePlansCategoryFlag(command, values, plansSubcommand, plansTimeAction);
  validatePlansStopFlags(command, values, plansSubcommand, plansTimeAction);
  validatePlansForceFlag(command, values, plansSubcommand);
}

/** Keep strict accounting on the read-only check route. */
function validatePlansStrictFlag(
  command: Command,
  values: ParsedArgValues,
  plansSubcommand: PlansSubcommand | null,
): void {
  if (
    parsedFlag(values, "strict") &&
    (command !== "plans" || plansSubcommand !== "check")
  ) {
    throw new CLIError("--strict is only valid for plans check.", 2);
  }
}

/** Require a valid category only on timing starts. */
function validatePlansCategoryFlag(
  command: Command,
  values: ParsedArgValues,
  plansSubcommand: PlansSubcommand | null,
  plansTimeAction: PlansTimeAction | null,
): void {
  const category = parsedString(values, "category");
  const isTimingStart =
    command === "plans" &&
    plansSubcommand === "time" &&
    plansTimeAction === "start";
  if (category !== undefined && !isTimingStart) {
    throw new CLIError("--category is only valid for plans time start.", 2);
  }
  if (isTimingStart && category === undefined) {
    throw new CLIError("plans time start requires --category.", 2);
  }
}

/** Keep pause recovery/finalization flags on timing stops and mutually exclusive. */
function validatePlansStopFlags(
  command: Command,
  values: ParsedArgValues,
  plansSubcommand: PlansSubcommand | null,
  plansTimeAction: PlansTimeAction | null,
): void {
  const shouldFinalize = parsedFlag(values, "finalize");
  const shouldDiscardOpen = parsedFlag(values, "discard-open");
  const hasStopFlag = shouldFinalize || shouldDiscardOpen;
  const isTimingStop =
    command === "plans" &&
    plansSubcommand === "time" &&
    plansTimeAction === "stop";
  if (hasStopFlag && !isTimingStop) {
    throw new CLIError(
      "--finalize and --discard-open are only valid for plans time stop.",
      2,
    );
  }
  if (shouldFinalize && shouldDiscardOpen) {
    throw new CLIError("--finalize and --discard-open cannot be combined.", 2);
  }
}

/** Keep plan-force semantics limited to generated export replacement. */
function validatePlansForceFlag(
  command: Command,
  values: ParsedArgValues,
  plansSubcommand: PlansSubcommand | null,
): void {
  if (
    parsedFlag(values, "force") &&
    command === "plans" &&
    plansSubcommand !== "export"
  ) {
    throw new CLIError("--force is only valid for plans export.", 2);
  }
}

/** Parse a start category after route validation has rejected misplaced flags. */
function parsePlansTimeCategoryArg(
  value: string | undefined,
  action: PlansTimeAction | null,
): PlansTimeCategory | null {
  if (action !== "start" || value === undefined) return null;
  if (value !== "product" && value !== "proof" && value !== "other") {
    throw new CLIError("--category must be product, proof, or other.", 2);
  }
  return value;
}

/** Returns true when the command resolves to a deterministic install/apply path. */
function isInstallCommand(command: Command, values: ParsedArgValues): boolean {
  return (
    command === "install" ||
    (command === "setup" && parsedFlag(values, "apply"))
  );
}
/** Validate managed-preview combinations; throws CLIError before ignored write flags confuse users. */
function validateDryRunFlag(command: Command, values: ParsedArgValues): void {
  const shouldDryRun = parsedFlag(values, "dry-run");
  const commandSupportsDryRun = command === "install" || command === "setup";
  // Preview is meaningful only where users can otherwise run deterministic setup writes.
  if (shouldDryRun && !commandSupportsDryRun) {
    throw new CLIError("--dry-run is only valid for install or setup.", 2);
  }
  // Authority and migration flags change what apply would do, so a preview that
  // rejected them could not answer the question the user is actually asking.
}

/** Reject authority combinations that would widen a write past what the user named. */
function validateAuthorityFlags(
  command: Command,
  values: ParsedArgValues,
): void {
  const authorityFlags: Array<[string, boolean]> = [
    ["--force-managed", parsedFlag(values, "force-managed")],
    ["--force-user-owned", parsedFlag(values, "force-user-owned")],
    ["--force-path", parsedStringList(values, "force-path").length > 0],
  ];
  for (const [flag, isSupplied] of authorityFlags) {
    if (isSupplied && !isInstallCommand(command, values)) {
      throw new CLIError(
        `${flag} is only valid for install or setup --apply.`,
        2,
      );
    }
  }
  // Replacing user-owned content is never a broad choice; it names each path it touches.
  if (
    parsedFlag(values, "force-user-owned") &&
    parsedStringList(values, "force-path").length === 0
  ) {
    throw new CLIError(
      "--force-user-owned requires at least one --force-path <path>. Name each user-owned file to replace; there is no broad user-owned override.",
      2,
    );
  }
}

/** Validate deterministic install/setup flags; throws CLIError when flags target the wrong command. */
function validateInstallFlags(command: Command, values: ParsedArgValues): void {
  validateDryRunFlag(command, values);
  validateAuthorityFlags(command, values);
  if (command !== "setup" && parsedFlag(values, "apply")) {
    throw new CLIError("--apply is only valid for the setup command.", 2);
  }
  // Plan exports may also use force, but only to regenerate an explicit local output path.
  if (
    parsedFlag(values, "force") &&
    !isInstallCommand(command, values) &&
    command !== "plans"
  ) {
    throw new CLIError(
      "--force is only valid for install, setup --apply, or plans export.",
      2,
    );
  }
  const installOnly: Array<[string, boolean | undefined]> = [
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
    command === "quality" &&
    qualitySubcommand === "save" &&
    parsedString(values, "output") !== undefined
  ) {
    throw new CLIError(
      "--output is not valid for quality save; the command owns its report destination.",
      2,
    );
  }
}

/** Validate flag combinations after strict parseArgs accepts their shapes. */
function validateFlagCombinations(
  command: Command,
  values: ParsedArgValues,
  qualitySubcommand: QualitySubcommand,
  skillSubcommand: SkillSubcommand | null,
  hookSubcommand: HookSubcommand | null,
  plansSubcommand: PlansSubcommand | null,
  plansTimeAction: PlansTimeAction | null,
): void {
  if (
    parsedFlag(values, "trusted-target") &&
    parsedFlag(values, "untrusted-target")
  ) {
    throw new CLIError(
      "--trusted-target and --untrusted-target cannot be used together.",
      2,
    );
  }
  validateCommonFlags(command, values);
  validateInstallFlags(command, values);
  validateQualityFlags(command, values, qualitySubcommand);
  validateSkillFlags(command, values, qualitySubcommand, skillSubcommand);
  validateHookFlags(command, values, hookSubcommand);
  validatePlansFlags(command, values, plansSubcommand, plansTimeAction);
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

/** Select the path consumed by the chosen command after each positional grammar is parsed. */
function selectCommandProjectPath(
  command: Command,
  qualityProjectPath: string,
  eventsProjectPath: string,
  hooksProjectPath: string,
  plansProjectPath: string,
  diagnosticsProjectPath: string,
  skillProjectPath: string,
): string {
  // Each namespaced command owns the path position its users supplied.
  if (command === "events") return eventsProjectPath;
  if (command === "hooks") return hooksProjectPath;
  if (command === "plans") return plansProjectPath;
  if (command === "diagnostics") return diagnosticsProjectPath;
  if (command === "skill") return skillProjectPath;
  return qualityProjectPath;
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
      "trusted-target": { type: "boolean", default: false },
      "untrusted-target": { type: "boolean", default: false },
      "no-audit-details": { type: "boolean", default: false },
      check: { type: "boolean", default: false },
      apply: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      force: { type: "boolean", default: false },
      "force-managed": { type: "boolean", default: false },
      "force-user-owned": { type: "boolean", default: false },
      "force-path": { type: "string", multiple: true },
      "update-config-version": { type: "boolean", default: false },
      "clean-deprecated": { type: "boolean", default: false },
      dev: { type: "boolean", default: false },
      draft: { type: "string" },
      "red-log": { type: "string" },
      interactive: { type: "boolean", default: false },
      name: { type: "string" },
      skill: { type: "string" },
      scenario: { type: "string" },
      strict: { type: "boolean", default: false },
      category: { type: "string" },
      finalize: { type: "boolean", default: false },
      "discard-open": { type: "boolean", default: false },
      yes: { type: "boolean", short: "y", default: false },
      json: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false },
    },
    allowPositionals: true,
    strict: true,
  });

  const parsedValues = values as ParsedArgValues;
  const commandPositionals = selectCommandPositionals(
    command,
    positionals,
    parsedValues,
  );
  const qualityPositionals = parseCommandPositionals(
    command,
    command === "review" ? [] : commandPositionals,
    parsedString(parsedValues, "draft") ?? null,
  );
  const eventsPositionals =
    command === "events"
      ? parseEventsPositionals(commandPositionals)
      : { eventsSubcommand: null, projectPath: qualityPositionals.projectPath };
  const hooksPositionals =
    command === "hooks"
      ? parseHooksPositionals(commandPositionals)
      : {
          hookSubcommand: null,
          hookId: null,
          projectPath: qualityPositionals.projectPath,
        };
  const plansPositionals =
    command === "plans"
      ? parsePlansPositionals(commandPositionals)
      : {
          plansSubcommand: null,
          plansTimeAction: null,
          projectPath: qualityPositionals.projectPath,
        };
  const reviewFields = buildReviewCLIFields(command, commandPositionals);
  const diagnosticsPositionals: {
    diagnosticsSubcommand: DiagnosticsSubcommand | null;
    projectPath: string;
  } =
    command === "diagnostics"
      ? parseDiagnosticsPositionals(commandPositionals)
      : {
          diagnosticsSubcommand: null,
          projectPath: qualityPositionals.projectPath,
        };
  const skillPositionals: SkillPositionals =
    command === "skill"
      ? parseSkillPositionals(commandPositionals)
      : {
          skillSubcommand: null,
          skillDescription: null,
          projectPath: qualityPositionals.projectPath,
        };
  const projectPath = selectCommandProjectPath(
    command,
    qualityPositionals.projectPath,
    eventsPositionals.projectPath,
    hooksPositionals.projectPath,
    plansPositionals.projectPath,
    diagnosticsPositionals.projectPath,
    skillPositionals.projectPath,
  );
  const skillFields = buildSkillCLIFields(
    command,
    parsedValues,
    skillPositionals,
  );
  validateFlagCombinations(
    command,
    parsedValues,
    qualityPositionals.qualitySubcommand,
    skillPositionals.skillSubcommand,
    hooksPositionals.hookSubcommand,
    plansPositionals.plansSubcommand,
    plansPositionals.plansTimeAction,
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
      command === "plans" ? resolve(".") : projectPath,
    ),
    includeHarness: parsedFlag(parsedValues, "harness"),
    checkDrift: parsedFlag(parsedValues, "check-drift"),
    checkContent: parsedFlag(parsedValues, "check-content"),
    isTargetTrusted: parsedFlag(parsedValues, "trusted-target"),
    isTargetUntrusted: parsedFlag(parsedValues, "untrusted-target"),
    auditDetails: !parsedFlag(parsedValues, "no-audit-details"),
    shouldCheck: parsedFlag(parsedValues, "check"),
    shouldApply: parsedFlag(parsedValues, "apply"),
    shouldDryRun: parsedFlag(parsedValues, "dry-run"),
    shouldForce: parsedFlag(parsedValues, "force"),
    shouldForceManaged: parsedFlag(parsedValues, "force-managed"),
    shouldForceUserOwned: parsedFlag(parsedValues, "force-user-owned"),
    forcePaths: parsedStringList(parsedValues, "force-path"),
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
    hookScenario: parseHookScenarioArg(
      hooksPositionals.hookSubcommand,
      parsedString(parsedValues, "scenario"),
    ),
    ...reviewFields,
    plansSubcommand: plansPositionals.plansSubcommand,
    plansStrict: parsedFlag(parsedValues, "strict"),
    plansTimeAction: plansPositionals.plansTimeAction,
    plansTimeCategory: parsePlansTimeCategoryArg(
      parsedString(parsedValues, "category"),
      plansPositionals.plansTimeAction,
    ),
    plansTimeFinalize: parsedFlag(parsedValues, "finalize"),
    plansTimeDiscardOpen: parsedFlag(parsedValues, "discard-open"),
    diagnosticsSubcommand: diagnosticsPositionals.diagnosticsSubcommand,
    includeAll: parsedFlag(parsedValues, "all"),
    isDevMode: parsedFlag(parsedValues, "dev"),
    showHelp: parsedFlag(parsedValues, "help"),
    showVersion: parsedFlag(parsedValues, "version"),
  };
}

/** Remove heavy per-check detail payloads from compact JSON audit output. */
