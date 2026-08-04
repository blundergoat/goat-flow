/**
 * Reads the words a user typed after a goat-flow command and turns them into a subcommand.
 * Everything here answers one question: given `goat-flow quality save draft`, which action did
 * they mean, and did they supply the right number of arguments for it?
 *
 * Mistakes are rejected loudly rather than guessed at. An unknown subcommand or a missing
 * argument raises a CLIError naming the accepted forms, because silently picking a default
 * would run something the user did not ask for - and for commands that write files, that is
 * the difference between a helpful message and an unwanted change to their project.
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
 * @param value - the `--mode` value; omitted means the user wants every mode shown
 * @returns the mode to filter by, or null to leave results unfiltered
 * @throws CLIError when the mode is not one goat-flow records
 */
export function parseQualityModeArg(
  value: string | undefined,
): QualityMode | null {
  // No `--mode` given, so history and diff show every mode rather than filtering.
  if (!value) return null;
  if (!QUALITY_MODES.includes(value as QualityMode)) {
    throw new CLIError(
      `Invalid quality mode: ${value}. Use: ${QUALITY_MODES.join(", ")}`,
      2,
    );
  }
  return value as QualityMode;
}

/**
 * Work out where `--output` should write, relative to the project the user is targeting.
 * A bare filename lands under `.goat-flow/` so a report does not clutter their repo root,
 * while an explicit path is honoured exactly as typed.
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
 * Covers everything after `goat-flow quality` - save, history, diff, validate, candidacy, or
 * the default prompt - so each one gets the arguments it needs before anything executes.
 *
 * @param positionals - words typed after `quality`; empty means the default prompt for the
 *   current directory
 * @param draftFlag - path from `--draft`; null means the user described their candidate
 *   inline instead of pointing at a file
 * @returns the chosen subcommand plus resolved paths for it
 * @throws CLIError when the subcommand is unknown or given the wrong number of arguments
 */
// eslint-disable-next-line complexity -- intentional because each quality positional error reports in CLI order
export function parseQualityPositionals(
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

  if (first === "save") {
    if (second === undefined || rest.length > 0) {
      throw new CLIError(
        "quality save requires exactly one positional project path.",
        2,
      );
    }
    return {
      qualitySubcommand: "save",
      projectPath: resolve(second),
      qualityDiffPair: null,
      qualityValidatePath: null,
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
 * @param value - the `--scenario` value; omitted means the user did not request one
 * @returns the scenario to run, or null when this command takes no scenario at all
 * @throws CLIError when the named scenario is not one goat-flow can run
 */
export function parseHookScenarioArg(
  subcommand: HookSubcommand | null,
  value: string | undefined,
): HookScenario | null {
  // Other hooks operations do not run runtime scenarios or receive a default group.
  if (subcommand !== "verify") return null;
  // Verification must not choose a proof group the user did not explicitly request.
  if (value === undefined) {
    throw new CLIError('hooks verify requires --scenario "deny-hook".', 2);
  }
  // Unknown groups must fail before the CLI can imply an unimplemented proof ran.
  if (value !== "deny-hook") {
    throw new CLIError('--scenario must be "deny-hook".', 2);
  }
  return "deny-hook";
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

/** Parse the single plan directory consumed by export and check. */
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
