/**
 * Turns raw `process.argv` into the fully-resolved ParsedCLI object that command dispatch consumes.
 *
 * It owns the whole front door: positional command detection, per-flag validation, per-command positional grammars (quality/skill/events/hooks each
 * have their own arity rules), and cross-flag checks that strict parseArgs can't express.
 *
 * The deliberate contract is fail-fast for malformed commands, flags, values, or combinations, throwing CLIError with exit code 2 (usage error) and a
 * human-readable message, so the entry point can print it and exit without a stack trace.
 *
 * Path positionals are resolved to absolute paths here so downstream handlers never see relative input.
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
  type LearnEntryType,
  type LearnEvidenceKind,
  type LearnSubcommand,
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
  parseLearnPositionals,
  parsePlansPositionals,
  parseQualityModeArg,
  parseRecallPositionals,
  resolveOutputPath,
} from "./cli-parser-positionals.js";
import { buildReviewCLIFields } from "./review-command-parser.js";
import {
  buildSkillCLIFields,
  parseSkillPositionals,
  validateSkillFlags,
  type SkillPositionals,
} from "./skill-command-parser.js";

const GLOBAL_INFORMATIONAL_FLAGS = new Set(["--help", "-h", "--version", "-v"]);

/**
 * Flags a developer can use to describe one learning-loop scaffold.
 * Kept together so strict parsing and command-specific validation expose the same authoring vocabulary.
 * The parser loads this group only as option declarations; validation still prevents other commands from accepting them.
 */
const LEARN_ARG_OPTIONS = {
  type: { type: "string" },
  title: { type: "string" },
  evidence: { type: "string", multiple: true },
  search: { type: "string", multiple: true },
  "evidence-kind": { type: "string" },
} as const;

/** Parse the positional subcommand from raw CLI args; throws CLIError for removed or unknown commands. */
function parseCommand(argv: string[]): {
  command: Command;
  filteredArgs: string[];
} {
  const filteredArgs = [...argv];
  const first = filteredArgs[0];
  if (first === undefined) return { command: "menu", filteredArgs };
  if (Object.hasOwn(REMOVED_COMMANDS, first)) {
    const message = REMOVED_COMMANDS[first];
    if (message !== undefined) throw new CLIError(message, 2);
  }
  if (COMMANDS.includes(first as Command)) {
    return { command: filteredArgs.shift() as Command, filteredArgs };
  }
  if (GLOBAL_INFORMATIONAL_FLAGS.has(first)) {
    return { command: "menu", filteredArgs };
  }
  throw new CLIError(
    `Unknown command: "${first}". Run "goat-flow --help" to list commands.`,
    2,
  );
}

/** Parse the `--format` flag; throws CLIError for invalid values before command dispatch. */
function parseFormatArg(rawFormat: string | undefined): CLIOptions["format"] {
  const defaultFormat: CLIOptions["format"] = process.stdout.isTTY
    ? "text"
    : "json";
  if (!rawFormat) return defaultFormat;
  if (!VALID_FORMATS.includes(rawFormat as (typeof VALID_FORMATS)[number])) {
    throw new CLIError(
      `Invalid format: ${rawFormat}. Use: json, text, markdown, sarif`,
      2,
    );
  }
  return rawFormat as CLIOptions["format"];
}

/** Parse the `--agent` flag; throws CLIError for invalid or deprecated aggregate values. */
function parseAgentArg(rawAgent: string | undefined): AgentId | null {
  if (!rawAgent) return null;
  if (rawAgent === "all") {
    throw new CLIError(
      `--agent all is no longer supported. Run setup separately for each agent: ${validAgentFlags()}`,
      2,
    );
  }
  if (!validAgents().includes(rawAgent as AgentId)) {
    throw new CLIError(
      `Invalid agent: ${rawAgent}. Use: ${validAgentList()}`,
      2,
    );
  }
  return rawAgent as AgentId;
}

/**
 * Reject a flag the user placed on a command it does not belong to.
 * Error behavior: throws CLIError with exit code 2 naming the flag and its owning command.
 *
 * @param command - command the user actually invoked
 * @param expectedCommand - the only command this flag is valid for
 * @param flag - flag name as the user typed it, echoed verbatim in the message
 * @param isSet - whether the user supplied the flag; false always passes
 * @returns nothing; returning at all means the placement is valid
 */
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
  const parsedEntry = values[name];
  return typeof parsedEntry === "string" ? parsedEntry : undefined;
}

/** Supply ignored, valid namespace positionals while help or version short-circuits dispatch. */
const INFORMATIONAL_POSITIONALS: Partial<Record<Command, string[]>> = {
  diagnostics: ["context"],
  events: ["tail"],
  hooks: ["list"],
  learn: ["new"],
  plans: ["export", "."],
  recall: ["."],
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
  if (command === "recall") {
    if (parsedString(values, "output") !== undefined) {
      throw new CLIError(
        "recall is read-only and does not support --output.",
        2,
      );
    }
    if (parsedString(values, "format") === "markdown") {
      throw new CLIError("recall supports only text or json output.", 2);
    }
  }
}

/**
 * Reject runtime scenario flags outside the explicit hooks verification route.
 * Error behavior: throws CLIError with exit code 2; a scenario name has no meaning for listing, toggling, or syncing, so accepting it silently would
 * imply a check that never ran.
 *
 * @param command - command the user invoked
 * @param values - parsed flag map; only `--scenario` is inspected here
 * @param hookSubcommand - hooks subcommand, or null when the command is not `hooks`
 * @returns nothing; returning means no misplaced scenario flag was supplied
 */
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

/**
 * Keep strict plan accounting on the read-only check route.
 * Error behavior: throws CLIError with exit code 2 when `--strict` appears anywhere else.
 *
 * @param command - command the user invoked
 * @param values - parsed flag map; only `--strict` is inspected here
 * @param plansSubcommand - plans subcommand, or null when the command is not `plans`
 * @returns nothing; returning means the flag is on its only valid route
 */
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

/**
 * Require a category on timing starts and reject it everywhere else.
 * Error behavior: throws CLIError with exit code 2 in both directions, because a start with no category would record time that no later report can
 * attribute.
 *
 * @param command - command the user invoked
 * @param values - parsed flag map; only `--category` is inspected here
 * @param plansSubcommand - plans subcommand, or null when the command is not `plans`
 * @param plansTimeAction - timing action, or null when the subcommand is not `time`
 * @returns nothing; returning means the category is present exactly where it is required
 */
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
  // A category describes either recorded plan time or a learning bucket; every other command rejects it instead of silently ignoring it.
  if (category !== undefined && !isTimingStart && command !== "learn") {
    throw new CLIError(
      "--category is only valid for plans time start or learn new.",
      2,
    );
  }
  // A timing start without a category would create unattributed time, so the developer must choose one before the receipt changes.
  if (isTimingStart && category === undefined) {
    throw new CLIError("plans time start requires --category.", 2);
  }
}

/**
 * Keep pause recovery and finalization flags on timing stops, and mutually exclusive.
 * Error behavior: throws CLIError with exit code 2 for a misplaced flag and again for the combined pair, because finalizing and discarding open
 * entries are opposite resolutions of the same state.
 *
 * @param command - command the user invoked
 * @param values - parsed flag map; `--finalize` and `--discard-open` are inspected here
 * @param plansSubcommand - plans subcommand, or null when the command is not `plans`
 * @param plansTimeAction - timing action, or null when the subcommand is not `time`
 * @returns nothing; returning means at most one stop flag is set, on the stop route
 */
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

/**
 * Keep plan-force semantics limited to generated export replacement.
 * Error behavior: throws CLIError with exit code 2 when `--force` is used on another plans route, so force can never mean "overwrite" for a command
 * that was not designed to replace a file.
 *
 * @param command - command the user invoked; non-plans commands are left to their own validators
 * @param values - parsed flag map; only `--force` is inspected here
 * @param plansSubcommand - plans subcommand, or null when the command is not `plans`
 * @returns nothing; returning means force is absent or on the export route
 */
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

/**
 * Parse a start category after route validation has rejected misplaced flags.
 * Error behavior: throws CLIError with exit code 2 for an unrecognised category name.
 *
 * @param rawCategory - flag text as typed; undefined is only valid on a non-start action
 * @param action - timing action; anything but `start` yields null without inspecting the text
 * @returns the category, or null when this action does not carry one
 */
function parsePlansTimeCategoryArg(
  rawCategory: string | undefined,
  action: PlansTimeAction | null,
): PlansTimeCategory | null {
  if (action !== "start" || rawCategory === undefined) return null;
  if (
    rawCategory !== "product" &&
    rawCategory !== "proof" &&
    rawCategory !== "other"
  ) {
    throw new CLIError("--category must be product, proof, or other.", 2);
  }
  return rawCategory;
}

/** Returns true when the command resolves to a deterministic install or setup preview/apply path. */
function isInstallCommand(command: Command, values: ParsedArgValues): boolean {
  return (
    command === "install" ||
    (command === "setup" &&
      (parsedFlag(values, "apply") || parsedFlag(values, "dry-run")))
  );
}
/** Validate managed-preview combinations; throws CLIError before ignored write flags confuse users. */
function validateDryRunFlag(command: Command, values: ParsedArgValues): void {
  const shouldDryRun = parsedFlag(values, "dry-run");
  const commandSupportsDryRun =
    command === "install" || command === "setup" || command === "learn";
  // A dry run on another command would promise a preview that command cannot produce, so the CLI rejects it before dispatch.
  if (shouldDryRun && !commandSupportsDryRun) {
    throw new CLIError(
      "--dry-run is only valid for install, setup, or learn new.",
      2,
    );
  }
  // Authority and migration flags change what apply would do, so a preview that
  // rejected them could not answer the question the user is actually asking.
}

/**
 * Reject authority combinations that would widen a write past what the user named.
 *
 * Error behavior: throws CLIError with exit code 2 for a force flag outside install/setup, and again for `--force-user-owned` with no `--force-path`,
 * because replacing user-owned content is never a broad choice; every such file must be named explicitly.
 *
 * @param command - command the user invoked; only install and setup routes may carry force flags
 * @param values - parsed flag map; the three force flags are inspected here
 * @returns nothing; returning means no force flag widens the write beyond the named paths
 */
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
        `${flag} is only valid for install or setup --apply/--dry-run.`,
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
        `${flag} is only valid for install or setup --apply/--dry-run.`,
        2,
      );
    }
  }
}

/** Return the one target-trust choice supplied by the user, if any. */
function suppliedTargetTrustFlag(values: ParsedArgValues): string | null {
  if (parsedFlag(values, "trusted-target")) return "--trusted-target";
  if (parsedFlag(values, "untrusted-target")) return "--untrusted-target";
  return null;
}

/** Return whether this route can execute code from the selected target. */
function routeCanExecuteTarget(
  command: Command,
  values: ParsedArgValues,
  qualitySubcommand: QualitySubcommand,
  hookSubcommand: HookSubcommand | null,
): boolean {
  if (
    command === "audit" ||
    (command === "quality" && qualitySubcommand === "prompt") ||
    (command === "hooks" && hookSubcommand === "verify")
  ) {
    return true;
  }
  return (
    command === "setup" &&
    !parsedFlag(values, "apply") &&
    !parsedFlag(values, "dry-run")
  );
}

/** Restrict target-code trust choices to executing routes; throws CLIError for every inert route. */
function validateTargetTrustFlags(
  command: Command,
  values: ParsedArgValues,
  qualitySubcommand: QualitySubcommand,
  hookSubcommand: HookSubcommand | null,
): void {
  const suppliedFlag = suppliedTargetTrustFlag(values);
  if (suppliedFlag === null) return;

  if (
    !routeCanExecuteTarget(command, values, qualitySubcommand, hookSubcommand)
  ) {
    throw new CLIError(
      `${suppliedFlag} is only valid for audit, setup prompt, quality prompt, or hooks verify.`,
      2,
    );
  }

  // Trusted audit raises deny-mechanism evidence to `full`, but the runtime deny probe only runs
  // for a selected agent. Without one the report would claim runtime proof that nothing produced,
  // so the omission is refused here rather than allowed to reach the audit.
  if (
    command === "audit" &&
    suppliedFlag === "--trusted-target" &&
    typeof values["agent"] !== "string"
  ) {
    throw new CLIError(
      "audit --trusted-target requires --agent <id> so the runtime deny check has an agent to execute.",
      2,
    );
  }
}

/**
 * Validate quality mode flags against the selected quality subcommand.
 * Error behavior: throws CLIError with exit code 2 for `--mode` off its three routes, and for `--output` on save, which owns its report destination
 * and must not be redirected.
 *
 * @param command - command the user invoked; non-quality commands pass through untouched
 * @param values - parsed flag map; `--mode` and `--output` are inspected here
 * @param qualitySubcommand - selected quality subcommand
 * @returns nothing; returning means both flags are on routes that honour them
 */
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

/**
 * Keep learning-entry details on `learn new`, where the developer can see what they affect.
 * Use during cross-flag validation before any command handler runs.
 *
 * @throws CLIError with exit code 2 for the first misplaced learn-only flag
 */
function validateLearnFlagPlacement(
  command: Command,
  values: ParsedArgValues,
): void {
  const learnOnlyFlags: Array<[string, boolean]> = [
    ["--type", parsedString(values, "type") !== undefined],
    ["--title", parsedString(values, "title") !== undefined],
    ["--evidence", parsedStringList(values, "evidence").length > 0],
    ["--search", parsedStringList(values, "search").length > 0],
    ["--evidence-kind", parsedString(values, "evidence-kind") !== undefined],
  ];
  // The learn command owns every listed flag, so its request proceeds to the content validators below.
  if (command === "learn") return;
  // Another command may have received a learn-only flag, so report the first misplaced option rather than ignore author intent.
  for (const [flag, isSupplied] of learnOnlyFlags) {
    // A supplied flag would otherwise have no user-visible effect on this command.
    if (isSupplied) {
      throw new CLIError(`${flag} is only valid for learn new.`, 2);
    }
  }
}

/**
 * Read the entry type after confirming the developer named a type, category, and title.
 * Use before validating type-specific citations or evidence taxonomy.
 *
 * @throws CLIError with exit code 2 when a required value is absent or the entry type is unknown
 */
function requireLearnEntryType(values: ParsedArgValues): LearnEntryType {
  const entryType = parsedString(values, "type");
  const category = parsedString(values, "category");
  const title = parsedString(values, "title");
  // A missing core value leaves either the bucket or heading unknown, so the CLI stops before resolving a destination.
  if (
    entryType === undefined ||
    category === undefined ||
    title === undefined
  ) {
    throw new CLIError(
      "learn new requires --type, --category, and --title.",
      2,
    );
  }
  // Decisions require human routing and are intentionally absent; any other unknown type gets the supported scaffold list.
  if (
    entryType !== "footgun" &&
    entryType !== "lesson" &&
    entryType !== "pattern"
  ) {
    throw new CLIError("--type must be footgun, lesson, or pattern.", 2);
  }
  return entryType;
}

/**
 * Pair each cited project file with the literal text the developer verified there.
 * Use before the writer asks the shared anchor checker to resolve those pairs.
 *
 * @throws CLIError with exit code 2 for unequal pairs or a footgun with no citation
 */
function validateLearnCitationFlags(
  entryType: LearnEntryType,
  values: ParsedArgValues,
): void {
  const evidencePaths = parsedStringList(values, "evidence");
  const searchLiterals = parsedStringList(values, "search");
  // Unequal lists cannot identify which literal belongs to which file, so no prospective entry is built.
  if (evidencePaths.length !== searchLiterals.length) {
    throw new CLIError(
      "Each --evidence <path> requires one paired --search <literal>, in the same order.",
      2,
    );
  }
  // A footgun without local file evidence would be an unsupported warning rather than a durable architectural trap.
  if (entryType === "footgun" && evidencePaths.length === 0) {
    throw new CLIError(
      "Footgun scaffolds require at least one --evidence/--search pair.",
      2,
    );
  }
}

/**
 * Validate the evidence label shown to readers of a footgun entry.
 * Use after the entry type is known, because lessons and patterns do not carry this taxonomy.
 *
 * @throws CLIError with exit code 2 for a missing, misplaced, or unknown taxonomy value
 */
function validateLearnEvidenceKindFlag(
  entryType: LearnEntryType,
  values: ParsedArgValues,
): void {
  const evidenceKind = parsedString(values, "evidence-kind");
  // A footgun reader needs to know whether its warning was measured, observed, or externally sourced.
  if (entryType === "footgun" && evidenceKind === undefined) {
    throw new CLIError("Footgun scaffolds require --evidence-kind.", 2);
  }
  // Lessons and patterns have no evidence-kind schema field, so accepting one would misrepresent their generated shape.
  if (entryType !== "footgun" && evidenceKind !== undefined) {
    throw new CLIError(
      "--evidence-kind is only valid for footgun scaffolds.",
      2,
    );
  }
  // Unknown taxonomy text cannot pass the same stats check that later verifies the written bucket.
  if (
    evidenceKind !== undefined &&
    evidenceKind !== "ACTUAL_MEASURED" &&
    evidenceKind !== "OBSERVED" &&
    evidenceKind !== "EXTERNAL_REFERENCE"
  ) {
    throw new CLIError(
      "--evidence-kind must be ACTUAL_MEASURED, OBSERVED, or EXTERNAL_REFERENCE.",
      2,
    );
  }
}

/**
 * Validate the flags that define one explicit learning-loop scaffold request.
 * The checks stay separated by concern so placement, paired citations, and taxonomy failures each produce one stable usage error.
 *
 * @throws CLIError with exit code 2 when a learn-only flag is misplaced or the scaffold grammar is incomplete
 */
function validateLearnFlags(command: Command, values: ParsedArgValues): void {
  validateLearnFlagPlacement(command, values);
  // Non-learning commands have no scaffold content to validate after placement checks pass.
  if (command !== "learn") return;
  // Help and version stop before dispatch, so developers can discover required authoring flags without supplying a fake scaffold request.
  if (parsedFlag(values, "help") || parsedFlag(values, "version")) return;
  const entryType = requireLearnEntryType(values);
  validateLearnCitationFlags(entryType, values);
  validateLearnEvidenceKindFlag(entryType, values);
}

/**
 * Validate flag combinations after strict parseArgs has accepted their individual shapes.
 *
 * This is the single ordering point for every per-command validator, so a user with several misplaced flags always sees the same first complaint
 * rather than a parse-order accident.
 *
 * @param command - command the user invoked
 * @param values - parsed flag map handed to each validator in turn
 * @param qualitySubcommand - selected quality subcommand
 * @param skillSubcommand - skill subcommand, or null when the command is not `skill`
 * @param hookSubcommand - hooks subcommand, or null when the command is not `hooks`
 * @param plansSubcommand - plans subcommand, or null when the command is not `plans`
 * @param plansTimeAction - timing action, or null when the subcommand is not `time`
 * @returns nothing; returning means every combination check passed. It throws the first CLIError raised by any validator, all with exit code 2.
 */
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
  validateTargetTrustFlags(command, values, qualitySubcommand, hookSubcommand);
  validateCommonFlags(command, values);
  validateInstallFlags(command, values);
  validateQualityFlags(command, values, qualitySubcommand);
  validateLearnFlags(command, values);
  validateSkillFlags(command, values, qualitySubcommand, skillSubcommand);
  validateHookFlags(command, values, hookSubcommand);
  validatePlansFlags(command, values, plansSubcommand, plansTimeAction);
}

/** Parse the events tail limit; throws CLIError for invalid values before clamping to the display cap. */
function parseEventsLimitArg(rawLimit: string | undefined): number {
  if (rawLimit === undefined) return 20;
  const parsed = Number.parseInt(rawLimit, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || String(parsed) !== rawLimit) {
    throw new CLIError("--limit must be a positive integer.", 2);
  }
  return Math.min(parsed, 500);
}

/**
 * Project choices produced by each positional grammar before the active command selects one.
 * Every value is absolute, so dispatch never has to reinterpret what directory the developer named.
 * Keeping all namespaces visible here prevents a new command from accidentally using another command's path.
 */
interface CommandProjectPaths {
  quality: string;
  events: string;
  hooks: string;
  plans: string;
  diagnostics: string;
  skill: string;
  learn: string;
}

/** Select the absolute project path owned by the command the developer invoked. */
function selectCommandProjectPath(
  command: Command,
  paths: CommandProjectPaths,
): string {
  // An events path follows `tail`, so it differs from the default first-position path used by simple commands.
  if (command === "events") return paths.events;
  // Hook actions can carry a hook id before the project, so their parser owns the selected path.
  if (command === "hooks") return paths.hooks;
  // Plan commands point at plan artifacts rather than a normal project positional.
  if (command === "plans") return paths.plans;
  // Diagnostic subcommands parse their own optional project after the diagnostic name.
  if (command === "diagnostics") return paths.diagnostics;
  // Skill authoring and diagnosis accept different positional shapes, so they keep their resolved path.
  if (command === "skill") return paths.skill;
  // Learning authoring places the project after `new`, so its namespace supplies the write target.
  if (command === "learn") return paths.learn;
  // Simple commands and quality's default route use the first project positional, or the current directory when it is absent.
  return paths.quality;
}

/** Read skill positionals only when the developer invoked `skill`; other commands receive inert fields and their existing project path. */
function parseOptionalSkillPositionals(
  command: Command,
  commandPositionals: string[],
  fallbackProjectPath: string,
): SkillPositionals {
  return command === "skill"
    ? parseSkillPositionals(commandPositionals)
    : {
        skillSubcommand: null,
        skillDescription: null,
        projectPath: fallbackProjectPath,
      };
}

/** Read `learn new` positionals only for that authoring route; other commands keep their existing project path and no learn action. */
function parseOptionalLearnPositionals(
  command: Command,
  commandPositionals: string[],
  fallbackProjectPath: string,
) {
  return command === "learn"
    ? parseLearnPositionals(commandPositionals)
    : { learnSubcommand: null, projectPath: fallbackProjectPath };
}

/**
 * Build the learning fields consumed by the scaffold handler after flag validation succeeds.
 * Use inert null and empty values on other commands so dispatch sees one stable `ParsedCLI` shape.
 */
function buildLearnCLIFields(
  command: Command,
  values: ParsedArgValues,
  learnSubcommand: LearnSubcommand | null,
): Pick<
  ParsedCLI,
  | "learnSubcommand"
  | "learnEntryType"
  | "learnCategory"
  | "learnTitle"
  | "learnEvidencePaths"
  | "learnSearchLiterals"
  | "learnEvidenceKind"
> {
  // Another command must not receive stale learning values that could imply it will write a bucket.
  if (command !== "learn") {
    return {
      learnSubcommand: null,
      learnEntryType: null,
      learnCategory: null,
      learnTitle: null,
      learnEvidencePaths: [],
      learnSearchLiterals: [],
      learnEvidenceKind: null,
    };
  }
  return {
    learnSubcommand,
    learnEntryType: (parsedString(values, "type") ??
      null) as LearnEntryType | null,
    learnCategory: parsedString(values, "category") ?? null,
    learnTitle: parsedString(values, "title") ?? null,
    learnEvidencePaths: parsedStringList(values, "evidence"),
    learnSearchLiterals: parsedStringList(values, "search"),
    learnEvidenceKind: (parsedString(values, "evidence-kind") ??
      null) as LearnEvidenceKind | null,
  };
}

/** Route top-level quality/review/recall operands without adding command branches to the main parser. */
function parsePrimaryPositionals(
  command: Command,
  commandPositionals: string[],
  draftFlag: string | null,
): {
  qualityPositionals: ReturnType<typeof parseCommandPositionals>;
  recallPaths: readonly string[];
} {
  const isRecall = command === "recall";
  return {
    qualityPositionals: parseCommandPositionals(
      command,
      command === "review" || isRecall ? [] : commandPositionals,
      draftFlag,
    ),
    recallPaths: isRecall ? parseRecallPositionals(commandPositionals) : [],
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
      ...LEARN_ARG_OPTIONS,
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
  const { qualityPositionals, recallPaths } = parsePrimaryPositionals(
    command,
    commandPositionals,
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
  const skillPositionals = parseOptionalSkillPositionals(
    command,
    commandPositionals,
    qualityPositionals.projectPath,
  );
  const learnPositionals = parseOptionalLearnPositionals(
    command,
    commandPositionals,
    qualityPositionals.projectPath,
  );
  const projectPath = selectCommandProjectPath(command, {
    quality: qualityPositionals.projectPath,
    events: eventsPositionals.projectPath,
    hooks: hooksPositionals.projectPath,
    plans: plansPositionals.projectPath,
    diagnostics: diagnosticsPositionals.projectPath,
    skill: skillPositionals.projectPath,
    learn: learnPositionals.projectPath,
  });
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
  const learnFields = buildLearnCLIFields(
    command,
    parsedValues,
    learnPositionals.learnSubcommand,
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
    ...learnFields,
    recallPaths,
    diagnosticsSubcommand: diagnosticsPositionals.diagnosticsSubcommand,
    includeAll: parsedFlag(parsedValues, "all"),
    isDevMode: parsedFlag(parsedValues, "dev"),
    showHelp: parsedFlag(parsedValues, "help"),
    showVersion: parsedFlag(parsedValues, "version"),
  };
}

/** Remove heavy per-check detail payloads from compact JSON audit output. */
