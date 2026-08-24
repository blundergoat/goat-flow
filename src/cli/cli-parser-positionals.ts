/**
 * Reads the words a user typed after a goat-flow command and turns them into a subcommand.
 * Everything here answers one question: given `goat-flow quality save draft`, which action did they mean, and did they supply the right number of
 * arguments for it?
 *
 * Mistakes are rejected loudly rather than guessed at.
 * An unknown subcommand or a missing argument raises a CLIError naming the accepted forms, because silently picking a default would run something the
 * user did not ask for - and for commands that write files, that is the difference between a helpful message and an unwanted change to their project.
 */
import { join, resolve } from "node:path";
import { CLIError } from "./cli-error.js";
import {
  HOOK_SUBCOMMANDS,
  type Command,
  type CandidacyInputArg,
  type EventsSubcommand,
  type HookScenario,
  type HookSubcommand,
  type PlansSubcommand,
  type PlansTimeAction,
  type QualitySubcommand,
} from "./cli-types.js";
import { QUALITY_MODES, type QualityMode } from "./quality/schema.js";

/**
 * Read the `--mode` filter used to narrow quality history and diff output.
 *
 * @param modeArg - the `--mode` value; omitted means the user wants every mode shown
 * @returns the mode to filter by, or null to leave results unfiltered
 * @throws CLIError when the mode is not one goat-flow records
 */
export function parseQualityModeArg(
  modeArg: string | undefined,
): QualityMode | null {
  // No `--mode` given, so history and diff show every mode rather than filtering.
  if (!modeArg) return null;
  if (!QUALITY_MODES.includes(modeArg as QualityMode)) {
    throw new CLIError(
      `Invalid quality mode: ${modeArg}. Use: ${QUALITY_MODES.join(", ")}`,
      2,
    );
  }
  return modeArg as QualityMode;
}

/**
 * Work out where `--output` should write, relative to the project the user is targeting.
 * A bare filename lands under `.goat-flow/` so a report does not clutter their repo root, while an explicit path is honoured exactly as typed.
 *
 * @param output - the `--output` value; omitted means the user wants terminal output only
 * @param projectRoot - project the command is running against, used as the base for bare names
 * @returns an absolute path to write to, or `null` when nothing should be written to disk
 */
export function resolveOutputPath(
  output: string | undefined,
  projectRoot: string,
): string | null {
  // No `--output`, so results are printed instead of written anywhere.
  if (!output) return null;
  return resolve(
    output.includes("/") || output.includes("\\")
      ? output
      : join(projectRoot, ".goat-flow", output),
  );
}

/**
 * Work out which quality action the user asked for and where it should run.
 * Covers everything after `goat-flow quality` - save, history, diff, validate, candidacy, or the default prompt - so each one gets the arguments it
 * needs before anything executes.
 *
 * @param positionals - words typed after `quality`; empty means the default prompt for the
 *   current directory
 * @param draftFlag - path from `--draft`; null means the user described their candidate
 *   inline instead of pointing at a file
 * @returns the chosen subcommand plus resolved paths for it
 * @throws CLIError when the subcommand is unknown or given the wrong number of arguments
 */

/**
 * Work out what the user asked `quality candidacy` to assess: a draft file, or a description they typed.
 *
 * The two are mutually exclusive on purpose, because supplying both leaves it ambiguous which one the verdict describes.
 *
 * Error behavior: throws CLIError with exit code 2 when both forms are supplied, or when neither is.
 *
 * @param second - first positional after the subcommand; the start of a typed description when no draft flag is set
 * @param rest - remaining positionals, joined into the description so an unquoted sentence still works
 * @param draftFlag - path from `--draft`; null means the user is describing the artifact instead
 * @returns the selected input, tagged with which form the user used
 */
function parseCandidacyInput(
  second: string | undefined,
  rest: string[],
  draftFlag: string | null,
): CandidacyInputArg {
  // A draft file was named, so any typed description alongside it would be a second, conflicting subject.
  if (draftFlag !== null) {
    if (second !== undefined || rest.length > 0) {
      throw new CLIError(
        "quality candidacy: pass either --draft <path> OR a description, not both.",
        2,
      );
    }
    return { mode: "draft", value: resolve(draftFlag) };
  }
  const description = [second, ...rest]
    .filter(
      (part): part is string => typeof part === "string" && part.length > 0,
    )
    .join(" ");
  // Neither form was supplied, so there is nothing for the candidacy check to assess.
  if (description.length === 0) {
    throw new CLIError(
      "quality candidacy: pass --draft <path> or a description string.",
      2,
    );
  }
  return { mode: "description", value: description };
}

/** What one `quality` subcommand's positionals resolve to, before the flag validators see them. */
interface QualityPositionals {
  qualitySubcommand: QualitySubcommand;
  projectPath: string;
  qualityDiffPair: string | null;
  qualityValidatePath: string | null;
  candidacyInput: CandidacyInputArg | null;
}

/** The positional arguments one subcommand parser is handed, after the subcommand word itself is consumed. */
interface QualityPositionalArgs {
  second: string | undefined;
  rest: string[];
  draftFlag: string | null;
}

/**
 * Build one subcommand result, defaulting every field the subcommand does not use.
 *
 * Defaulting here means each parser states only what makes it different, so a reader sees the subcommand's actual contract
 * rather than four repeated nulls.
 *
 * @param subcommand - the resolved subcommand
 * @param overrides - only the fields this subcommand populates
 * @returns the complete positional result
 */
function qualityPositionals(
  subcommand: QualitySubcommand,
  overrides: Partial<Omit<QualityPositionals, "qualitySubcommand">> = {},
): QualityPositionals {
  return {
    qualitySubcommand: subcommand,
    projectPath: resolve("."),
    qualityDiffPair: null,
    qualityValidatePath: null,
    candidacyInput: null,
    ...overrides,
  };
}

/**
 * One parser per `quality` subcommand, so each subcommand's argument rules and error text sit together.
 *
 * A subcommand absent from this table falls through to `prompt`, which is what lets `goat-flow quality <path>` work.
 */
const QUALITY_SUBCOMMAND_PARSERS: Record<
  string,
  (args: QualityPositionalArgs) => QualityPositionals
> = {
  /** History takes an optional project path and nothing else. */
  history: ({ second, rest }) => {
    if (rest.length > 0) {
      throw new CLIError(
        "quality history accepts at most one positional project path.",
        2,
      );
    }
    return qualityPositionals("history", {
      projectPath: second !== undefined ? resolve(second) : resolve("."),
    });
  },
  /** Candidacy takes either a draft path or a typed description, never both. */
  candidacy: ({ second, rest, draftFlag }) =>
    qualityPositionals("candidacy", {
      candidacyInput: parseCandidacyInput(second, rest, draftFlag),
    }),
  /** Diff takes one optional `<from-id>:<to-id>` pair; omitting it compares the two latest runs. */
  diff: ({ second, rest }) => {
    if (rest.length > 0) {
      throw new CLIError(
        "quality diff accepts at most one positional pair in the form <from-id>:<to-id>.",
        2,
      );
    }
    return qualityPositionals("diff", { qualityDiffPair: second ?? null });
  },
  /** Validate needs the report file to check, so an omitted path is an error rather than a default. */
  validate: ({ second, rest }) => {
    if (second === undefined || rest.length > 0) {
      throw new CLIError(
        "quality validate requires exactly one positional <path-to-report>.",
        2,
      );
    }
    return qualityPositionals("validate", {
      qualityValidatePath: resolve(second),
    });
  },
  /** Save names the project that will own the stored report, so it is never inferred. */
  save: ({ second, rest }) => {
    if (second === undefined || rest.length > 0) {
      throw new CLIError(
        "quality save requires exactly one positional project path.",
        2,
      );
    }
    return qualityPositionals("save", { projectPath: resolve(second) });
  },
};

/**
 * Resolve which `quality` subcommand the user invoked, and what its positional arguments mean.
 *
 * A first positional that names no subcommand is treated as a project path for `quality prompt`, which is what makes
 * `goat-flow quality .` work the way users expect.
 *
 * @param positionals - positional arguments after the `quality` command word
 * @param draftFlag - value of `--draft`, which only `candidacy` consumes; null means it was not supplied
 * @returns the resolved subcommand and its arguments. It throws CLIError with exit code 2 for the removed `capture` subcommand, or when a
 *   subcommand's own argument rules are broken.
 */
export function parseQualityPositionals(
  positionals: string[],
  draftFlag: string | null,
): QualityPositionals {
  const [first, second, ...rest] = positionals;

  if (first === "capture") {
    throw new CLIError(
      '"quality capture" was removed in v1.2.0. Agents now write reports directly to `.goat-flow/logs/quality/`; no capture step is needed.',
      2,
    );
  }

  // Bracket lookup on an object literal resolves inherited names like __proto__, so only own keys may dispatch.
  const parseSubcommand =
    first !== undefined &&
    Object.prototype.hasOwnProperty.call(QUALITY_SUBCOMMAND_PARSERS, first)
      ? QUALITY_SUBCOMMAND_PARSERS[first]
      : undefined;
  if (parseSubcommand) return parseSubcommand({ second, rest, draftFlag });

  // No subcommand matched, so the first positional is the project path for a prompt run.
  return qualityPositionals("prompt", { projectPath: resolve(first ?? ".") });
}

/**
 * Work out which project the user wants to tail events for.
 *
 * @param positionals - words typed after `events`; the path may be omitted to use the
 *   current directory
 * @returns the subcommand and the resolved project path
 * @throws CLIError when the subcommand is not `tail` or extra arguments were given
 */
export function parseEventsPositionals(positionals: string[]): {
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

/**
 * Work out which hooks action the user asked for and which project it applies to.
 *
 * @param positionals - words typed after `hooks`; the path may be omitted to use the
 *   current directory
 * @returns the subcommand, the hook id when one applies (null otherwise), and the project path
 * @throws CLIError when the subcommand is unknown or given the wrong number of arguments
 */
export function parseHooksPositionals(positionals: string[]): {
  hookSubcommand: HookSubcommand;
  hookId: string | null;
  projectPath: string;
} {
  const [first, second, third, ...rest] = positionals;
  if (!first || !HOOK_SUBCOMMANDS.has(first)) {
    throw new CLIError(
      'hooks requires subcommand "list", "enable", "disable", "sync", or "verify".',
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

/**
 * Read the scenario name for `hooks verify`, the only command that accepts one.
 *
 * @param subcommand - hooks action being run; anything other than verify takes no scenario
 * @param scenarioArg - the `--scenario` value; omitted means the user did not request one
 * @returns the scenario to run, or null when this command takes no scenario at all
 * @throws CLIError when the named scenario is not one goat-flow can run
 */
export function parseHookScenarioArg(
  subcommand: HookSubcommand | null,
  scenarioArg: string | undefined,
): HookScenario | null {
  // Other hooks operations do not run runtime scenarios or receive a default group.
  if (subcommand !== "verify") return null;
  // Verification must not choose a proof group the user did not explicitly request.
  if (scenarioArg === undefined) {
    throw new CLIError(
      'hooks verify requires --scenario "deny-hook", "post-turn-hook", or "gruff-hook".',
      2,
    );
  }
  // Unknown groups must fail before the CLI can imply an unimplemented proof ran.
  if (
    scenarioArg !== "deny-hook" &&
    scenarioArg !== "post-turn-hook" &&
    scenarioArg !== "gruff-hook"
  ) {
    throw new CLIError(
      '--scenario must be "deny-hook", "post-turn-hook", or "gruff-hook".',
      2,
    );
  }
  return scenarioArg;
}

/**
 * Parse read-only plan paths or `plans time <action> <milestone-file>`.
 *
 * @param positionals - words typed after `plans`; an omitted path means the current directory
 * @returns the plans subcommand plus any timing action and milestone path it carries
 * @throws CLIError when the operation is unknown or the plan-path arity is wrong
 */
export function parsePlansPositionals(positionals: string[]): {
  plansSubcommand: PlansSubcommand;
  plansTimeAction: PlansTimeAction | null;
  projectPath: string;
} {
  const [subcommand, second, third, ...extraPositionals] = positionals;

  if (subcommand === "time") {
    return parsePlansTimePositionals(second, third, extraPositionals);
  }

  return parsePlansReadPositionals(subcommand, second, third, extraPositionals);
}

/**
 * Read the timing action and milestone file the user wants to record against.
 *
 * @param action - timing verb such as start or stop; omitted means none was typed
 * @param milestonePath - milestone file to record against; omitted means none was given
 * @param extraPositionals - anything typed beyond those two, which is always a mistake
 * @returns the parsed timing action and resolved milestone path
 * @throws CLIError when the action is unknown or extra arguments were supplied
 */
function parsePlansTimePositionals(
  action: string | undefined,
  milestonePath: string | undefined,
  extraPositionals: string[],
): {
  plansSubcommand: "time";
  plansTimeAction: PlansTimeAction;
  projectPath: string;
} {
  if (action !== "start" && action !== "stop" && action !== "status") {
    throw new CLIError(
      'plans time requires action "start", "stop", or "status".',
      2,
    );
  }
  if (!milestonePath || extraPositionals.length > 0) {
    throw new CLIError(
      `plans time ${action} requires one <milestone-file>.`,
      2,
    );
  }
  return {
    plansSubcommand: "time",
    plansTimeAction: action,
    projectPath: resolve(milestonePath),
  };
}

/** Parse the single plan directory consumed by export and check; it throws a usage error naming the accepted subcommands rather than guessing one. */
function parsePlansReadPositionals(
  subcommand: string | undefined,
  planPath: string | undefined,
  third: string | undefined,
  extraPositionals: string[],
): {
  plansSubcommand: "export" | "check";
  plansTimeAction: null;
  projectPath: string;
} {
  if (subcommand !== "export" && subcommand !== "check") {
    throw new CLIError(
      'plans requires subcommand "export", "check", or "time".',
      2,
    );
  }
  // Read-only consumers accept exactly one plan directory after their subcommand.
  if (!planPath || third !== undefined || extraPositionals.length > 0) {
    throw new CLIError(`plans ${subcommand} requires one <plan-path>.`, 2);
  }
  return {
    plansSubcommand: subcommand,
    plansTimeAction: null,
    projectPath: resolve(planPath),
  };
}

/**
 * Read the hook id and project path for `hooks enable` and `hooks disable`, so a toggle names exactly one hook in one project.
 * It throws a usage error rather than toggling something the user did not name.
 *
 * @param subcommand - whether the user is enabling or disabling
 * @param hookId - hook the user named; missing raises a usage error rather than toggling something unnamed
 * @param projectPath - project the user named; missing defaults to the current directory
 * @param rest - any further words typed, which have no meaning here and are rejected
 * @returns the resolved toggle request
 */
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

/**
 * Route a command's positionals to the grammar that owns them.
 * Single entry point used by the parser, so each command's argument rules stay in one place.
 *
 * @param command - command the user typed
 * @param positionals - words that followed it; empty means defaults apply
 * @param draftFlag - `--draft` path when quality candidacy was used; null otherwise
 * @returns resolved project path plus any quality-specific fields for this command
 * @throws CLIError when the command's positional grammar is not satisfied
 */
export function parseCommandPositionals(
  command: Command,
  positionals: string[],
  draftFlag: string | null,
): ReturnType<typeof parseQualityPositionals> {
  if (command === "quality")
    return parseQualityPositionals(positionals, draftFlag);
  return {
    qualitySubcommand: "prompt",
    projectPath: resolve(positionals[0] ?? "."),
    qualityDiffPair: null,
    qualityValidatePath: null,
    candidacyInput: null,
  };
}

/**
 * Preserve every file/directory operand supplied to the recall command.
 * Error behavior: throws CLIError with exit code 2 when no recall subject was named.
 *
 * @param positionals - project-relative files or directories typed after `recall`
 * @returns the operands in caller order; path safety and canonicalization happen against the selected filesystem
 */
export function parseRecallPositionals(
  positionals: string[],
): readonly string[] {
  if (positionals.length === 0) {
    throw new CLIError(
      "recall requires at least one file or directory path.",
      2,
    );
  }
  return positionals;
}
