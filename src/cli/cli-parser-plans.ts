/**
 * Parse plan-only flags before dispatch, keeping timing writes and read-only checks on their permitted routes.
 * Usage errors name the misplaced or malformed flag and exit with code 2.
 */
import { CLIError } from "./cli-error.js";
import type {
  Command,
  ParsedArgValues,
  PlansSubcommand,
  PlansTimeAction,
  PlansTimeCategory,
} from "./cli-types.js";

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

/**
 * Validate plan flags before dispatch so a check cannot acquire timing or export write semantics.
 *
 * @param command - selected namespace; misplaced plan flags are rejected in other namespaces
 * @param values - parsed option map; absent options retain their command's defaults
 * @param plansSubcommand - selected plan route, or null for another command
 * @param plansTimeAction - selected timing action, or null when no clock action was requested
 * @returns nothing when every supplied flag belongs to its selected route
 * @throws CLIError with exit 2 for misplaced or contradictory plan flags
 */
export function validatePlansFlags(
  command: Command,
  values: ParsedArgValues,
  plansSubcommand: PlansSubcommand | null,
  plansTimeAction: PlansTimeAction | null,
): void {
  validatePlansStrictFlag(command, values, plansSubcommand);
  if (
    parsedString(values, "max-active") !== undefined &&
    (command !== "plans" || plansSubcommand !== "check")
  ) {
    throw new CLIError("--max-active is only valid for plans check.", 2);
  }
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
 *
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
 *
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
 *
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
export function parsePlansTimeCategoryArg(
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

/**
 * Read a canonical decimal cap, or null when project policy should decide.
 *
 * @param rawCap - option text; undefined leaves config/default selection to the checker
 * @returns the positive safe integer override, or null when the flag is absent
 * @throws CLIError with exit 2 when the value is not a positive safe integer.
 */
export function parsePlansMaxActive(rawCap: string | undefined): number | null {
  if (rawCap === undefined) return null;
  const cap = Number(rawCap);
  if (!/^[1-9][0-9]*$/u.test(rawCap) || !Number.isSafeInteger(cap)) {
    throw new CLIError(
      "--max-active must be a positive safe integer in decimal notation.",
      2,
    );
  }
  return cap;
}
