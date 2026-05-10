#!/usr/bin/env node

/**
 * Command-line entry point for goat-flow.
 * Handles argv parsing, command dispatch, exit codes, and on-disk output for audit, quality, setup, dashboard, and info workflows.
 */

import { parseArgs } from "node:util";
import { resolve, dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, mkdirSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import type { CLIOptions, AgentId, ProjectFacts } from "./types.js";
import type { AuditReport } from "./audit/types.js";
import { QUALITY_MODES, type QualityMode } from "./quality/schema.js";
import type { CandidacyResult } from "./quality/candidacy.js";

import { getPackageVersion, getTemplatePath } from "./paths.js";
import { getKnownAgentIds } from "./agents/registry.js";
import { classifyProjectState } from "./classify-state.js";
import { createFS } from "./facts/fs.js";

/** Current package version used in --version output */
const PACKAGE_VERSION = getPackageVersion();

/** Structured error with an exit code for CLI process termination */
class CLIError extends Error {
  constructor(
    message: string,
    public exitCode: number,
  ) {
    super(message);
  }
}

/** Print usage instructions and available commands to stdout */
function printHelp(): void {
  console.log(`
goat-flow - GOAT Flow CLI Auditor

Usage:
  goat-flow [command] [project-path] [flags]

Commands:
  menu              Interactive command picker (default when run with no args)
  audit             Deterministic pass/fail: GOAT Flow Setup + Agent Setup (add --harness for AI Harness Completeness)
  quality           Agent-driven quality prompt plus history/diff surfaces
  setup             Generate setup prompt (adapts to project state)
  install           Deterministically copy/update goat-flow system files
  status            Show project state (bare/partial/v0.9/outdated/current)
  dashboard         Launch browser dashboard with audit, setup, and terminal
  manifest          Print the resolved single-source-of-truth manifest (--check validates consistency)
  stats             Learning-loop health report (live entry counts, stale refs, freshness). Use --check for CI.
  skill new         Author a new skill or playbook from a description, draft, or interactive prompt.
Arguments:
  project-path    Target project directory (default: .)

Flags:
  --format <type>   Output format: json, text, markdown (omit for auto-detect: text in terminal, json otherwise)
  --agent <id>      Filter to one agent: ${validAgentList()}
  --mode <mode>     Quality prompt/history/diff mode: ${QUALITY_MODES.join(", ")}
  --all             Quality history: lift the default 20-run limit
  --harness         Audit: add AI Harness Completeness scope (pass/fail checks across 5 concerns)
  --check-drift     Audit: detect skill template-vs-installed drift and orphan directories
  --check-content   Audit: cold-path content lint (vague terms, generic instructions, factual drift)
  --check           Manifest: validate static-vs-observed consistency (exits non-zero on drift)
  --apply           Setup: copy/update deterministic system files instead of generating a prompt
  --force           Install/setup --apply: overwrite settings, config, and remove deprecated skills
  --update-config-version  Install: update only the version field in existing config.yaml
  --clean-deprecated       Install: remove deprecated skill directories
  --verbose         Show per-check details
  --output <file>   Write output to file instead of stdout
  --dev             Dashboard: live reload on file changes
  --help, -h        Show this help
  --version, -v     Show version

Examples:
  goat-flow                            Open the interactive menu
  goat-flow .                          Audit current directory
  goat-flow audit . --harness          Audit with AI harness completeness checks
  goat-flow audit . --agent claude     Audit scoped to Claude
  goat-flow audit . --format json      JSON output for CI
  goat-flow install . --agent claude   Copy/update goat-flow system files
  goat-flow setup . --agent claude --apply
  goat-flow setup --agent claude       Setup prompt for Claude
  goat-flow quality . --agent claude   Quality assessment prompt for Claude
  goat-flow quality . --agent claude --mode skills
  goat-flow quality history --agent claude
  goat-flow quality history --agent codex --mode skills
  goat-flow quality diff --agent claude --mode agent-setup
  goat-flow quality validate <path>    Schema-check a freshly written report (exit 2 on any error)
  goat-flow manifest                   Print the resolved manifest
  goat-flow manifest --check           Verify the manifest is consistent with code
  goat-flow stats                      Learning-loop health report
  goat-flow stats --check              Fail if any bucket is missing last_reviewed or has stale refs
  goat-flow skill new "<description>"  Scaffold a skill from a natural-language description
  goat-flow skill ./repo new "<description>"
  goat-flow skill new --draft <path>   Validate an existing draft against the candidacy check
  goat-flow skill new --interactive    Prompt for description and name, then scaffold
  goat-flow --format markdown          PR-comment friendly output
  goat-flow --output report.json       Write results to file
`);
}

/** Print the current package version to stdout */
function printVersion(): void {
  console.log(`goat-flow v${PACKAGE_VERSION}`);
}

/** Supported CLI subcommand names */
type Command =
  | "menu"
  | "setup"
  | "install"
  | "dashboard"
  | "info"
  | "status"
  | "audit"
  | "quality"
  | "skill"
  | "manifest"
  | "stats";

type SkillSubcommand = "new";

type QualitySubcommand =
  | "prompt"
  | "history"
  | "diff"
  | "validate"
  | "candidacy";

interface CandidacyInputArg {
  mode: "draft" | "description";
  value: string;
}

interface ParsedArgValues {
  format?: string;
  agent?: string;
  mode?: string;
  verbose?: boolean;
  output?: string;
  all?: boolean;
  harness?: boolean;
  "check-drift"?: boolean;
  "check-content"?: boolean;
  check?: boolean;
  apply?: boolean;
  force?: boolean;
  "update-config-version"?: boolean;
  "clean-deprecated"?: boolean;
  dev?: boolean;
  draft?: string;
  interactive?: boolean;
  name?: string;
  yes?: boolean;
  help?: boolean;
  version?: boolean;
}

/** List of recognized CLI subcommands */
const COMMANDS: Command[] = [
  "menu",
  "setup",
  "install",
  "dashboard",
  "info",
  "status",
  "audit",
  "quality",
  "skill",
  "manifest",
  "stats",
];
/** Previously valid commands that now produce a helpful removal error */
const REMOVED_COMMANDS: Record<string, string> = {
  fix: '"fix" was removed. Use "setup" instead - it adapts to your project\'s state.',
  eval: '"eval" was removed. Use "setup" instead - it adapts to your project\'s state.',
  scan: '"scan" was removed. Use "audit" for setup validation or "quality --agent <id>" for agent assessment.',
  critique:
    '"critique" was renamed to "quality". Use "goat-flow quality . --agent <id>".',
};
/** Accepted values for the --format flag */
const VALID_FORMATS = ["json", "text", "markdown"] as const;
/** Accepted values for the --agent flag. Resolved lazily so that manifest drift
 *  does not crash commands (like `--help` or `--version`) that do not need the
 *  agent list. Strict callers get the exception; help-text callers fall back. */
let cachedValidAgents: AgentId[] | null = null;
/** Return the cached list of valid agent IDs. */
function validAgents(): AgentId[] {
  return (cachedValidAgents ??= getKnownAgentIds());
}
/** Return the valid agent IDs as help text. */
function validAgentList(): string {
  try {
    return validAgents().join(", ");
  } catch {
    return "run `goat-flow manifest` for the current list";
  }
}
/** Return the valid `--agent` flag examples. */
function validAgentFlags(): string {
  try {
    return validAgents()
      .map((agent) => `--agent ${agent}`)
      .join(", ");
  } catch {
    return "--agent <id> (run `goat-flow manifest` for valid ids)";
  }
}
/** Banner text warning that multi-agent setup output must stay in sync */
const MULTI_AGENT_SYNC_BANNER = [
  "**Multi-agent sync:** This prompt generates setup for multiple agents. The execution loop",
  "(READ → SCOPE → ACT → VERIFY), autonomy tiers, and Definition of Done",
  "MUST be identical across all instruction files. Write these sections for the first agent,",
  "then COPY THEM VERBATIM to the other instruction files. Do not rephrase.",
];

/** Fully resolved CLI options including the dispatched command */
export interface ParsedCLI extends CLIOptions {
  command: Command;
  harness: boolean;
  checkDrift: boolean;
  checkContent: boolean;
  check: boolean;
  apply: boolean;
  force: boolean;
  updateConfigVersion: boolean;
  cleanDeprecated: boolean;
  qualitySubcommand: QualitySubcommand;
  qualityDiffPair: string | null;
  qualityValidatePath: string | null;
  qualityMode: QualityMode | null;
  candidacyInput: CandidacyInputArg | null;
  skillSubcommand: SkillSubcommand | null;
  skillDescription: string | null;
  skillDraftPath: string | null;
  skillName: string | null;
  skillInteractive: boolean;
  skillSkipConfirm: boolean;
  all: boolean;
}

/** Parse the positional subcommand from raw CLI args. Empty argv opens the menu. */
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

/** Parse the `--format` flag, defaulting to text on TTYs and JSON otherwise. */
function parseFormatArg(value: string | undefined): CLIOptions["format"] {
  const defaultFormat: CLIOptions["format"] = process.stdout.isTTY
    ? "text"
    : "json";
  if (!value) return defaultFormat;
  if (!VALID_FORMATS.includes(value as (typeof VALID_FORMATS)[number])) {
    throw new CLIError(
      `Invalid format: ${value}. Use: json, text, markdown`,
      2,
    );
  }
  return value as CLIOptions["format"];
}

/** Parse the `--agent` flag and reject deprecated aggregate agent modes. */
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

/** Parse the quality-history/diff mode filter. */
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

/** Parse quality subcommand positionals. */
// eslint-disable-next-line complexity -- quality subcommand dispatch is intentionally explicit: each branch has its own positional validation
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
  return {
    qualitySubcommand: "prompt",
    projectPath: resolve(positionals[0] ?? "."),
    qualityDiffPair: null,
    qualityValidatePath: null,
    candidacyInput: null,
  };
}

interface SkillPositionals {
  skillSubcommand: SkillSubcommand | null;
  skillDescription: string | null;
  projectPath: string;
}

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

function parseSkillDescription(parts: string[]): string | null {
  const description = parts
    .filter(
      (part): part is string => typeof part === "string" && part.length > 0,
    )
    .join(" ");
  return description.length > 0 ? description : null;
}

/** Parse `skill [project-path] new [project-path] [description...]` positionals. */
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
function validateCommonFlags(command: Command, values: ParsedArgValues): void {
  if (command !== "quality" && values.all === true) {
    throw new CLIError("--all is only valid for the quality command.", 2);
  }
  if (command !== "quality" && values.mode !== undefined) {
    throw new CLIError("--mode is only valid for the quality command.", 2);
  }
}

/** Returns true when the command resolves to a deterministic install/apply path. */
function isInstallCommand(command: Command, values: ParsedArgValues): boolean {
  return (
    command === "install" || (command === "setup" && values.apply === true)
  );
}

/** Validate deterministic install/setup flags. */
function validateInstallFlags(command: Command, values: ParsedArgValues): void {
  if (command !== "setup" && values.apply === true) {
    throw new CLIError("--apply is only valid for the setup command.", 2);
  }
  const installOnly: Array<[string, boolean | undefined]> = [
    ["--force", values.force],
    ["--update-config-version", values["update-config-version"]],
    ["--clean-deprecated", values["clean-deprecated"]],
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
// eslint-disable-next-line complexity -- enumerates four cross-command flag/subcommand restrictions; splitting per-flag obscures the validation contract
function validateQualityFlags(
  command: Command,
  values: ParsedArgValues,
  qualitySubcommand: QualitySubcommand,
): void {
  if (
    command === "quality" &&
    values.mode !== undefined &&
    !["prompt", "history", "diff"].includes(qualitySubcommand)
  ) {
    throw new CLIError(
      "--mode is only valid for quality prompt, quality history, and quality diff.",
      2,
    );
  }
  if (
    values.draft !== undefined &&
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
  if (values.interactive === true && command !== "skill") {
    throw new CLIError("--interactive is only valid for skill new.", 2);
  }
  if (values.name !== undefined && command !== "skill") {
    throw new CLIError("--name is only valid for skill new.", 2);
  }
  if (values.yes === true && command !== "skill") {
    throw new CLIError("--yes is only valid for skill new.", 2);
  }
}

function formatCandidacyArtifact(
  recommendation: CandidacyResult["recommendedArtifact"],
): string {
  switch (recommendation.type) {
    case "skill":
      return `skill (${recommendation.subtype})`;
    case "reference":
      return `reference (${recommendation.subtype})`;
    case "instruction-file":
      return `instruction-file rule (${recommendation.reason})`;
    case "learning-loop":
      return `learning-loop (${recommendation.subtype})`;
    case "cli-command":
      return "cli-command";
    case "do-not-create":
      return `do-not-create (${recommendation.reason})`;
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

/** Parse raw CLI argv into a structured ParsedCLI options object */
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
      harness: { type: "boolean", default: false },
      "check-drift": { type: "boolean", default: false },
      "check-content": { type: "boolean", default: false },
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
    typeof parsedValues.draft === "string" ? parsedValues.draft : null,
  );
  const skillPositionals: SkillPositionals =
    command === "skill"
      ? parseSkillPositionals(positionals)
      : {
          skillSubcommand: null,
          skillDescription: null,
          projectPath: qualityPositionals.projectPath,
        };
  validateFlagCombinations(
    command,
    parsedValues,
    qualityPositionals.qualitySubcommand,
  );

  return {
    command,
    projectPath: qualityPositionals.projectPath,
    format: parseFormatArg(parsedValues.format),
    agent: parseAgentArg(parsedValues.agent),
    verbose: parsedValues.verbose === true,
    output: resolveOutputPath(
      parsedValues.output,
      qualityPositionals.projectPath,
    ),
    harness: parsedValues.harness === true,
    checkDrift: parsedValues["check-drift"] === true,
    checkContent: parsedValues["check-content"] === true,
    check: parsedValues.check === true,
    apply: parsedValues.apply === true,
    force: parsedValues.force === true,
    updateConfigVersion: parsedValues["update-config-version"] === true,
    cleanDeprecated: parsedValues["clean-deprecated"] === true,
    qualitySubcommand: qualityPositionals.qualitySubcommand,
    qualityDiffPair: qualityPositionals.qualityDiffPair,
    qualityValidatePath: qualityPositionals.qualityValidatePath,
    qualityMode: parseQualityModeArg(parsedValues.mode),
    candidacyInput: qualityPositionals.candidacyInput,
    skillSubcommand: skillPositionals.skillSubcommand,
    skillDescription: skillPositionals.skillDescription,
    skillDraftPath:
      command === "skill" && typeof parsedValues.draft === "string"
        ? resolve(parsedValues.draft)
        : null,
    skillName:
      command === "skill" && typeof parsedValues.name === "string"
        ? parsedValues.name
        : null,
    skillInteractive: command === "skill" && parsedValues.interactive === true,
    skillSkipConfirm: command === "skill" && parsedValues.yes === true,
    all: parsedValues.all === true,
    dev: parsedValues.dev === true,
    help: parsedValues.help === true,
    version: parsedValues.version === true,
  };
}

interface MenuAction {
  key: string;
  label: string;
  command: "dashboard" | "install" | "setup" | "audit" | "status";
  needsAgent: boolean;
}

const MENU_ACTIONS: MenuAction[] = [
  {
    key: "1",
    label: "Start dashboard",
    command: "dashboard",
    needsAgent: false,
  },
  {
    key: "2",
    label: "Install/update goat-flow files",
    command: "install",
    needsAgent: true,
  },
  {
    key: "3",
    label: "Generate setup prompt",
    command: "setup",
    needsAgent: true,
  },
  {
    key: "4",
    label: "Audit current project",
    command: "audit",
    needsAgent: false,
  },
  {
    key: "5",
    label: "Show project status",
    command: "status",
    needsAgent: false,
  },
];

/** Render the no-args command picker. */
function renderMenuText(): string {
  const lines = [
    "goat-flow",
    "",
    "What do you want to do?",
    ...MENU_ACTIONS.map((action) => `  ${action.key}. ${action.label}`),
    "",
    "Run a command directly any time, for example:",
    "  goat-flow dashboard .",
    "  goat-flow install . --agent codex",
    "  goat-flow audit . --harness",
  ];
  return lines.join("\n");
}

/** Return true when the process can safely ask questions. */
function canPrompt(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

/** Find a menu action by number or case-insensitive label prefix. */
function findMenuAction(input: string): MenuAction | null {
  const normalized = input.trim().toLowerCase();
  if (!normalized) return null;
  return (
    MENU_ACTIONS.find(
      (action) =>
        action.key === normalized ||
        action.label.toLowerCase().startsWith(normalized),
    ) ?? null
  );
}

/** Ask for a project path, defaulting to the current working directory. */
async function promptProjectPath(
  rl: ReturnType<typeof createInterface>,
): Promise<string> {
  const answer = await rl.question("Project path [.] ");
  return resolve(answer.trim() || ".");
}

/** Ask for one supported agent id. */
async function promptAgent(
  rl: ReturnType<typeof createInterface>,
): Promise<AgentId> {
  const agents = validAgents();
  for (;;) {
    const answer = await rl.question(`Agent (${agents.join("/")}) `);
    const selected = answer.trim();
    if (agents.includes(selected as AgentId)) return selected as AgentId;
    console.log(`Use one of: ${agents.join(", ")}`);
  }
}

/** Ask whether install should overwrite settings/config. */
async function promptForce(
  rl: ReturnType<typeof createInterface>,
): Promise<boolean> {
  const answer = await rl.question(
    "Overwrite existing settings/config? [y/N] ",
  );
  return /^y(?:es)?$/iu.test(answer.trim());
}

/** Read all menu answers and build the command options to run. */
async function promptMenuCommand(
  options: ParsedCLI,
  rl: ReturnType<typeof createInterface>,
): Promise<ParsedCLI> {
  console.log(renderMenuText());
  const choice = await rl.question("\nChoice [1] ");
  const action = findMenuAction(choice || "1");
  if (!action) {
    throw new CLIError("Unknown menu choice.", 2);
  }

  const projectPath = await promptProjectPath(rl);
  const agent = action.needsAgent ? await promptAgent(rl) : options.agent;
  const force = action.command === "install" ? await promptForce(rl) : false;

  return {
    ...options,
    command: action.command,
    projectPath,
    agent,
    force,
    apply: false,
  };
}

/** Handle the interactive no-args command picker. */
async function handleMenuCommand(options: ParsedCLI): Promise<void> {
  if (!canPrompt() || options.output !== null) {
    writeOutput(options, renderMenuText());
    return;
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  let nextOptions: ParsedCLI;
  try {
    nextOptions = await promptMenuCommand(options, rl);
  } finally {
    rl.close();
  }
  await dispatchCommand(nextOptions);
}

/** Handle the status command: classify and display project adoption state */
async function handleStatusCommand(options: ParsedCLI): Promise<void> {
  const { createFS } = await import("./facts/fs.js");
  const { classifyProjectState } = await import("./classify-state.js");

  const fs = createFS(options.projectPath);
  const result = classifyProjectState(fs, options.agent ?? undefined);

  if (options.format === "json") {
    writeOutput(
      options,
      JSON.stringify(
        { path: options.projectPath, ...result, version: PACKAGE_VERSION },
        null,
        2,
      ),
    );
    return;
  }

  if (options.format === "markdown") {
    const lines = [
      `**Path:** ${options.projectPath}`,
      `**State:** ${result.state}`,
      `**Action:** ${result.action}`,
      `**Details:** ${result.details}`,
    ];
    writeOutput(options, lines.join("\n"));
    return;
  }

  const stateColors: Record<string, string> = {
    bare: "\x1b[90m",
    partial: "\x1b[33m",
    "v0.9": "\x1b[31m",
    outdated: "\x1b[36m",
    current: "\x1b[32m",
    error: "\x1b[31m",
  };
  const reset = "\x1b[0m";
  const color = stateColors[result.state] || "";

  const rendered = [
    `  Path:    ${options.projectPath}`,
    `  State:   ${color}${result.state}${reset}`,
    `  Action:  ${result.action}`,
    `  Details: ${result.details}`,
  ].join("\n");
  writeOutput(options, rendered);
}

/** Pick the agent list for setup output from the CLI override or extracted facts. */
function getSetupAgentIds(options: ParsedCLI, facts: ProjectFacts): AgentId[] {
  return options.agent
    ? [options.agent]
    : facts.agents.map((af) => af.agent.id);
}

/** Print the banner that warns multi-agent setup output must stay in sync. */
function writeMultiAgentSyncBanner(withDivider: boolean): void {
  const lines = withDivider
    ? [...MULTI_AGENT_SYNC_BANNER, "", "---", ""]
    : [...MULTI_AGENT_SYNC_BANNER, "", ""];
  process.stdout.write(lines.join("\n"));
}

/** Handle the setup command: compose and render setup prompts per agent */
async function handleSetupCommand(
  options: ParsedCLI,
  auditReport: AuditReport,
  facts: ProjectFacts,
): Promise<void> {
  const { composeSetup } = await import("./prompt/compose-setup.js");

  const agentIds = getSetupAgentIds(options, facts);
  if (agentIds.length === 0) {
    throw new CLIError(
      `No agents detected. Use one of: ${validAgentFlags()}`,
      1,
    );
  }

  if (agentIds.length > 1) {
    writeMultiAgentSyncBanner(true);
  }

  const parts: string[] = [];
  for (const agentId of agentIds) {
    const output = composeSetup(auditReport, facts, agentId);
    if (output) parts.push(output);
  }
  if (parts.length > 0) {
    writeOutput(options, parts.join("\n\n---\n\n"));
  }
}

/** Derive installer flags from the project's adoption state. */
function deriveInstallFlags(
  projectPath: string,
  agentId: string,
  options: ParsedCLI,
): string[] {
  if (options.force) return [];
  try {
    const projectFS = createFS(projectPath);
    const state = classifyProjectState(projectFS, agentId);
    const flags: string[] = [];
    if (
      !options.updateConfigVersion &&
      (state.state === "outdated" || state.state === "v0.9")
    ) {
      flags.push("--update-config-version");
    }
    if (!options.cleanDeprecated && state.state === "v0.9") {
      flags.push("--clean-deprecated");
    }
    return flags;
  } catch {
    return [];
  }
}

/** Handle deterministic install/update by delegating to the packaged installer. */
function handleInstallCommand(options: ParsedCLI): void {
  if (!options.agent) {
    throw new CLIError(
      `install requires --agent. Use one of: ${validAgentFlags()}\n  (--apply installs per-agent surfaces; each agent needs a separate run)`,
      2,
    );
  }
  if (options.output !== null) {
    throw new CLIError("--output is not supported for install.", 2);
  }

  const scriptPath = getTemplatePath("workflow/install-goat-flow.sh");
  const args = [scriptPath, options.projectPath, "--agent", options.agent];
  if (options.force) args.push("--force");
  if (options.updateConfigVersion) args.push("--update-config-version");
  if (options.cleanDeprecated) args.push("--clean-deprecated");
  args.push(...deriveInstallFlags(options.projectPath, options.agent, options));

  const result = spawnSync("bash", args, { stdio: "inherit" });
  if (result.error) {
    throw new CLIError(
      `Could not run installer with bash: ${result.error.message}`,
      1,
    );
  }
  if (result.signal) {
    throw new CLIError(`Installer terminated by signal ${result.signal}`, 1);
  }
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
  }
}

/** Write rendered output to file or stdout. */
function writeOutput(options: ParsedCLI, rendered: string): void {
  if (options.output) {
    mkdirSync(dirname(options.output), { recursive: true });
    writeFileSync(options.output, rendered + "\n", "utf-8");
    console.error(`Written to ${options.output}`);
    return;
  }

  process.stdout.write(rendered + "\n");
}

/** Handle the info command: rubrics and anti-patterns were removed in v1.1.0. */
function handleInfoCommand(options: ParsedCLI): void {
  // The subcommand is the first positional arg after 'info'.
  // parseCLIArgs resolves projectPath to an absolute path, so extract the basename.
  const sub = options.projectPath.split(/[/\\]/).pop() ?? "";

  if (sub === "rubrics" || sub === "anti-patterns") {
    throw new CLIError(
      `"info ${sub}" was removed. Use "audit" for setup validation or "audit --harness" for advisory scoring.`,
      2,
    );
  }

  throw new CLIError(
    'Usage: goat-flow info <rubrics|anti-patterns>\n  Both subcommands were removed in v1.1.0. Use "audit" instead.',
    2,
  );
}

/** Run the audit command: validate setup correctness and optionally check harness completeness. */
async function handleAuditCommand(options: ParsedCLI): Promise<void> {
  const { createFS } = await import("./facts/fs.js");
  const { runAudit } = await import("./audit/audit.js");
  const { renderAuditText, renderAuditJson, renderAuditMarkdown } =
    await import("./audit/render.js");

  const fs = createFS(options.projectPath);
  const report = runAudit(fs, options.projectPath, {
    agentFilter: options.agent ?? null,
    harness: options.harness,
    checkDrift: options.checkDrift,
    checkContent: options.checkContent,
  });

  let rendered: string;
  if (options.format === "json") {
    rendered = renderAuditJson(report);
  } else if (options.format === "markdown") {
    rendered = renderAuditMarkdown(report);
  } else {
    rendered = renderAuditText(report);
  }

  writeOutput(options, rendered);

  if (report.status === "fail") {
    process.exitCode = 1;
  }
}

/** Dispatch the quality subcommands. */
// eslint-disable-next-line complexity -- quality prompt, history, and diff intentionally share one command dispatcher
async function handleQualityCommand(options: ParsedCLI): Promise<void> {
  if (options.qualitySubcommand === "history") {
    const {
      buildQualityHistoryRows,
      loadQualityHistory,
      renderQualityHistoryText,
      selectQualityHistoryEntries,
    } = await import("./quality/history.js");

    const history = loadQualityHistory(options.projectPath);
    for (const warning of history.warnings) {
      console.error(warning);
    }

    const selectedEntries = selectQualityHistoryEntries(history.entries, {
      agent: options.agent,
      limit: options.all ? null : 20,
      qualityMode: options.qualityMode,
    });
    const rows = buildQualityHistoryRows(history.entries, {
      agent: options.agent,
      limit: options.all ? null : 20,
      qualityMode: options.qualityMode,
    });
    if (options.format === "json") {
      writeOutput(
        options,
        JSON.stringify(
          {
            reports: selectedEntries.map((entry) => ({
              id: entry.id,
              path: entry.path,
              report: entry.report,
            })),
            deltas: rows.map((row) => ({
              id: row.id,
              setup_delta: row.setupDelta,
            })),
          },
          null,
          2,
        ),
      );
      return;
    }

    writeOutput(
      options,
      renderQualityHistoryText(rows, {
        agent: options.agent,
        qualityMode: options.qualityMode,
        all: options.all,
      }),
    );
    return;
  }

  if (options.qualitySubcommand === "diff") {
    const { buildQualityDiff, loadQualityHistory, renderQualityDiffText } =
      await import("./quality/history.js");

    const history = loadQualityHistory(options.projectPath);
    for (const warning of history.warnings) {
      console.error(warning);
    }

    const diff = buildQualityDiff(history.entries, {
      agent: options.agent,
      pair: options.qualityDiffPair,
      qualityMode: options.qualityMode,
    });
    if (!diff.ok) throw new CLIError(diff.error, 2);

    if (options.format === "json") {
      writeOutput(options, JSON.stringify(diff.diff, null, 2));
      return;
    }

    writeOutput(options, renderQualityDiffText(diff.diff));
    return;
  }

  if (options.qualitySubcommand === "candidacy") {
    if (!options.candidacyInput) {
      throw new CLIError(
        "quality candidacy: pass --draft <path> or a description string.",
        2,
      );
    }
    const { runCandidacyCheck } = await import("./quality/candidacy.js");
    const { readFileSync, existsSync } = await import("node:fs");
    let result;
    if (options.candidacyInput.mode === "draft") {
      const path = options.candidacyInput.value;
      if (!existsSync(path)) {
        throw new CLIError(`quality candidacy: file not found: ${path}`, 2);
      }
      result = runCandidacyCheck({
        kind: "draft",
        content: readFileSync(path, "utf-8"),
        suggestedName: basename(path).replace(/\.md$/, ""),
      });
    } else {
      result = runCandidacyCheck({
        kind: "description",
        text: options.candidacyInput.value,
      });
    }
    if (options.format === "json") {
      writeOutput(options, JSON.stringify(result, null, 2));
      return;
    }
    const lines: string[] = [];
    lines.push(
      `Recommended artifact: ${formatCandidacyArtifact(result.recommendedArtifact)}`,
    );
    lines.push(`Confidence: ${Math.round(result.confidence * 100)}%`);
    if (result.reasoning.length > 0) {
      lines.push("");
      lines.push("Reasoning:");
      for (const reason of result.reasoning) lines.push(`  - ${reason}`);
    }
    if (result.nextSteps.length > 0) {
      lines.push("");
      lines.push("Next steps:");
      for (const step of result.nextSteps) {
        lines.push(
          `  - ${step.action}${step.template ? ` (template: ${step.template})` : ""}`,
        );
      }
    }
    writeOutput(options, lines.join("\n"));
    return;
  }

  if (options.qualitySubcommand === "validate") {
    if (!options.qualityValidatePath) {
      throw new CLIError(
        "quality validate requires a path to the report file.",
        2,
      );
    }
    const { readFileSync, existsSync } = await import("node:fs");
    const { parseQualityReport } = await import("./quality/schema.js");
    const path = options.qualityValidatePath;
    if (!existsSync(path)) {
      throw new CLIError(`quality validate: file not found: ${path}`, 2);
    }
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, "utf-8"));
    } catch (error) {
      throw new CLIError(
        `quality validate: invalid JSON in ${path}: ${error instanceof Error ? error.message : String(error)}`,
        2,
      );
    }
    const parsed = parseQualityReport(raw);
    if (!parsed.ok) {
      throw new CLIError(
        `quality validate: schema error in ${path}: ${parsed.error}`,
        2,
      );
    }
    writeOutput(options, `OK ${path}`);
    return;
  }

  if (!options.agent) {
    throw new CLIError(
      `quality requires --agent. Usage: goat-flow quality . --agent ${validAgents()[0] ?? "claude"}`,
      2,
    );
  }

  const { createFS } = await import("./facts/fs.js");
  const { runAudit } = await import("./audit/audit.js");
  const { composeQuality } = await import("./prompt/compose-quality.js");
  const { findLatestQualityReport } = await import("./quality/history.js");

  const fs = createFS(options.projectPath);

  // Run audit but don't fail if it errors - quality prompt works even when audit is failing
  let auditReport: AuditReport | null = null;
  try {
    auditReport = runAudit(fs, options.projectPath, {
      agentFilter: options.agent,
      harness: true,
    });
  } catch {
    // Audit failure is fine - quality prompt generates with degraded context
  }

  const qualityMode = options.qualityMode ?? "agent-setup";
  const { entry: priorReport, warnings: historyWarnings } =
    findLatestQualityReport(options.projectPath, options.agent, qualityMode);
  for (const warning of historyWarnings) {
    console.error(warning);
  }

  const result = composeQuality({
    agent: options.agent,
    projectPath: options.projectPath,
    auditReport,
    priorReport,
    qualityMode,
  });

  if (options.format === "json") {
    writeOutput(options, JSON.stringify(result, null, 2));
  } else {
    writeOutput(options, result.prompt);
  }
}

/** Handle the stats command: report learning-loop health (live counts, stale refs, freshness). */
async function handleStatsCommand(options: ParsedCLI): Promise<void> {
  const { createFS } = await import("./facts/fs.js");
  const { loadConfig } = await import("./config/reader.js");
  const { extractFootgunFacts, extractLessonsFacts } =
    await import("./facts/shared/learning-loop.js");
  const { buildStatsReport, checkStats, buildDecisionsSection } =
    await import("./stats/stats.js");
  const {
    renderStatsText,
    renderStatsJson,
    renderStatsMarkdown,
    renderStatsCheckText,
  } = await import("./stats/render.js");

  const fs = createFS(options.projectPath);
  const configState = loadConfig(options.projectPath, fs);
  const report = buildStatsReport({
    footguns: extractFootgunFacts(fs, configState),
    lessons: extractLessonsFacts(fs, configState),
    decisions: buildDecisionsSection(fs, configState.config.decisions.path),
  });

  if (options.check) {
    const verdict = checkStats(report);
    if (options.format === "json") {
      writeOutput(options, JSON.stringify(verdict, null, 2));
    } else {
      writeOutput(options, renderStatsCheckText(verdict).trimEnd());
    }
    if (verdict.status === "fail") process.exitCode = 1;
    return;
  }

  let rendered: string;
  if (options.format === "json") {
    rendered = renderStatsJson(report);
  } else if (options.format === "markdown") {
    rendered = renderStatsMarkdown(report);
  } else {
    rendered = renderStatsText(report);
  }
  writeOutput(options, rendered.trimEnd());
}

/** Handle the manifest command: resolve + print the single-source-of-truth manifest. */
async function handleManifestCommand(options: ParsedCLI): Promise<void> {
  const { loadManifest, checkManifest, renderManifestMarkdown } =
    await import("./manifest/manifest.js");

  if (options.check) {
    const report = checkManifest();
    let rendered: string;
    if (options.format === "json") {
      rendered = JSON.stringify(report, null, 2);
    } else {
      const lines: string[] = [];
      if (report.status === "pass") {
        lines.push("Manifest check: PASS");
      } else {
        lines.push("Manifest check: FAIL");
        for (const f of report.findings) {
          lines.push(`  - [${f.rule}] ${f.message}`);
        }
      }
      rendered = lines.join("\n");
    }
    writeOutput(options, rendered);
    if (report.status === "fail") process.exitCode = 1;
    return;
  }

  const manifest = loadManifest();
  if (options.format === "json") {
    writeOutput(options, JSON.stringify(manifest, null, 2));
    return;
  }
  writeOutput(options, renderManifestMarkdown(manifest));
}

/** Run the default `setup` command pipeline: facts + audit + compose. */
async function runSetupPipeline(options: ParsedCLI): Promise<void> {
  const { createFS } = await import("./facts/fs.js");
  const { runAudit } = await import("./audit/audit.js");
  const { extractProjectFacts } = await import("./facts/orchestrator.js");
  const { loadConfig } = await import("./config/reader.js");
  const fs = createFS(options.projectPath);
  const configState = loadConfig(options.projectPath, fs);
  const facts = extractProjectFacts(fs, {
    agentFilter: options.agent ?? null,
    projectPath: options.projectPath,
    configState,
  });
  const auditReport = runAudit(fs, options.projectPath, {
    agentFilter: options.agent ?? null,
    harness: false,
  });
  await handleSetupCommand(options, auditReport, facts);
}

/** Launch the web dashboard. */
async function runDashboardCommand(options: ParsedCLI): Promise<void> {
  const { serveDashboard } = await import("./server/dashboard.js");
  await serveDashboard({
    projectPath: options.projectPath,
    dev: options.dev,
  });
}

const COMMAND_HANDLERS: Partial<
  Record<Command, (options: ParsedCLI) => Promise<void> | void>
> = {
  menu: handleMenuCommand,
  install: handleInstallCommand,
  audit: handleAuditCommand,
  quality: handleQualityCommand,
  skill: handleSkillCommand,
  manifest: handleManifestCommand,
  stats: handleStatsCommand,
  status: handleStatusCommand,
  dashboard: runDashboardCommand,
  info: handleInfoCommand,
};

async function handleSkillCommand(options: ParsedCLI): Promise<void> {
  if (options.skillSubcommand !== "new") {
    throw new CLIError(
      'Usage: goat-flow skill new ["<description>" | --draft <path> | --interactive]',
      2,
    );
  }
  const { runSkillNew, SkillNewInputError } = await import("./skill-author.js");
  let result: Awaited<ReturnType<typeof runSkillNew>>;
  try {
    result = await runSkillNew({
      description: options.skillDescription ?? undefined,
      draftPath: options.skillDraftPath ?? undefined,
      interactive: options.skillInteractive,
      name: options.skillName ?? undefined,
      skipConfirm: options.skillSkipConfirm,
      projectRoot: options.projectPath,
    });
  } catch (err) {
    if (err instanceof SkillNewInputError) {
      throw new CLIError(err.message, 2);
    }
    throw err;
  }
  if (options.format === "json") {
    writeOutput(
      options,
      JSON.stringify(
        {
          candidacy: result.candidacy,
          proposedPath: result.proposedPath,
          written: result.written,
          postScaffoldScore: result.postScaffoldScore ?? null,
        },
        null,
        2,
      ),
    );
    return;
  }
  writeOutput(options, result.output.join("\n"));
}

/** Dispatch one parsed CLI command to its handler. */
export async function dispatchCommand(options: ParsedCLI): Promise<void> {
  const handler = COMMAND_HANDLERS[options.command];
  if (handler) {
    await handler(options);
    return;
  }
  if (options.apply) {
    handleInstallCommand(options);
    return;
  }
  // Remaining command: setup (uses audit + facts to compose setup guidance).
  await runSetupPipeline(options);
}

/** Entry point that dispatches to the appropriate command handler */
async function main(): Promise<void> {
  // Gracefully handle EPIPE (e.g., output piped to `head`)
  process.stdout.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EPIPE") process.exit(0);
    throw err;
  });

  const rawArgs = process.argv.slice(2);

  // Empty argv opens the menu; path-only argv still uses the audit shorthand.
  const options = parseCLIArgs(rawArgs);

  if (options.help) {
    printHelp();
    return;
  }
  if (options.version) {
    printVersion();
    return;
  }

  await dispatchCommand(options);
}

/** True when this module is the CLI entry point, including when launched
 *  through a symlink like `node_modules/.bin/goat-flow`. */
function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return (
      realpathSync(resolve(entry)) ===
      realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
}

if (isMainModule()) {
  main().catch((err: unknown) => {
    if (err instanceof CLIError) {
      console.error(err.message);
      process.exit(err.exitCode);
    }
    console.error(
      `Fatal error: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  });
}
