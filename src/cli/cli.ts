#!/usr/bin/env node

/**
 * Command-line entry point for goat-flow.
 * Handles argv parsing, command dispatch, exit codes, and on-disk output for audit, quality, setup, dashboard, and info workflows.
 */

import { parseArgs } from "node:util";
import { resolve, dirname, join } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import type { CLIOptions, AgentId, ProjectFacts } from "./types.js";
import type { AuditReport } from "./audit/types.js";

import { getPackageVersion } from "./paths.js";

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
  audit             Deterministic pass/fail: GOAT Flow Setup + Agent Setup (add --harness for AI Harness Completeness)
  quality           Agent-driven quality assessment prompt (requires --agent)
  setup             Generate setup prompt (adapts to project state)
  status            Show project state (bare/partial/v0.9/outdated/current)
  dashboard         Launch browser dashboard with audit, setup, and terminal
  manifest          Print the resolved single-source-of-truth manifest (--check validates consistency)
Arguments:
  project-path    Target project directory (default: .)

Flags:
  --format <type>   Output format: json, text, markdown (omit for auto-detect: text in terminal, json otherwise)
  --agent <id>      Filter to one agent: claude, codex, gemini
  --harness         Audit: add AI Harness Completeness scope (pass/fail checks across 5 concerns)
  --check-drift     Audit: detect skill template-vs-installed drift and orphan directories
  --check-content   Audit: cold-path content lint (vague terms, generic instructions, factual drift)
  --check           Manifest: validate static-vs-observed consistency (exits non-zero on drift)
  --verbose         Show per-check details
  --output <file>   Write output to file instead of stdout
  --dev             Dashboard: live reload on file changes
  --help, -h        Show this help
  --version, -v     Show version

Examples:
  goat-flow .                          Audit current directory
  goat-flow audit . --harness          Audit with AI harness completeness checks
  goat-flow audit . --agent claude     Audit scoped to Claude
  goat-flow audit . --format json      JSON output for CI
  goat-flow setup --agent claude       Setup prompt for Claude
  goat-flow quality . --agent claude   Quality assessment prompt for Claude
  goat-flow manifest                   Print the resolved manifest
  goat-flow manifest --check           Verify the manifest is consistent with code
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
  | "setup"
  | "dashboard"
  | "info"
  | "status"
  | "audit"
  | "quality"
  | "manifest";

/** List of recognized CLI subcommands */
const COMMANDS: Command[] = [
  "setup",
  "dashboard",
  "info",
  "status",
  "audit",
  "quality",
  "manifest",
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
/** Accepted values for the --agent flag */
const VALID_AGENTS: AgentId[] = ["claude", "codex", "gemini"];
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
}

/** Parse the positional subcommand from raw CLI args, defaulting to `audit`. */
function parseCommand(argv: string[]): {
  command: Command;
  filteredArgs: string[];
} {
  const filteredArgs = [...argv];
  const first = filteredArgs[0];
  if (first !== undefined && Object.hasOwn(REMOVED_COMMANDS, first)) {
    throw new CLIError(REMOVED_COMMANDS[first]!, 2);
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
      `--agent all is no longer supported. Run setup separately for each agent: --agent claude, --agent codex, --agent gemini`,
      2,
    );
  }
  if (!VALID_AGENTS.includes(value as AgentId)) {
    throw new CLIError(
      `Invalid agent: ${value}. Use: claude, codex, gemini`,
      2,
    );
  }
  return value as AgentId;
}

/** Resolve `--output`, defaulting bare file names into `.goat-flow/` under the target repo. */
function resolveOutputPath(
  output: string | undefined,
  positionals: string[],
): string | null {
  if (!output) return null;
  const projectRoot = positionals[0] ?? ".";
  return resolve(
    output.includes("/") || output.includes("\\")
      ? output
      : join(projectRoot, ".goat-flow", output),
  );
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
      verbose: { type: "boolean", default: false },
      output: { type: "string", short: "o" },
      harness: { type: "boolean", default: false },
      "check-drift": { type: "boolean", default: false },
      "check-content": { type: "boolean", default: false },
      check: { type: "boolean", default: false },
      dev: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false },
    },
    allowPositionals: true,
    strict: true,
  });

  return {
    command,
    projectPath: resolve(positionals[0] ?? "."),
    format: parseFormatArg(values.format),
    agent: parseAgentArg(values.agent),
    verbose: values.verbose === true,
    output: resolveOutputPath(values.output, positionals),
    harness: values.harness === true,
    checkDrift: values["check-drift"] === true,
    checkContent: values["check-content"] === true,
    check: values.check === true,
    dev: values.dev === true,
    help: values.help === true,
    version: values.version === true,
  };
}

/** Handle the status command: classify and display project adoption state */
async function handleStatusCommand(options: ParsedCLI): Promise<void> {
  const { createFS } = await import("./facts/fs.js");
  const { classifyProjectState } = await import("./classify-state.js");

  const fs = createFS(options.projectPath);
  const result = classifyProjectState(fs);

  if (options.format === "json") {
    process.stdout.write(
      JSON.stringify({ path: options.projectPath, ...result }, null, 2) + "\n",
    );
    return;
  }

  const stateColors: Record<string, string> = {
    bare: "\x1b[90m", // gray
    partial: "\x1b[33m", // yellow
    "v0.9": "\x1b[31m", // red
    outdated: "\x1b[36m", // cyan
    current: "\x1b[32m", // green
    error: "\x1b[31m", // red
  };
  const reset = "\x1b[0m";
  const color = stateColors[result.state] || "";

  console.log(`  Path:    ${options.projectPath}`);
  console.log(`  State:   ${color}${result.state}${reset}`);
  console.log(`  Action:  ${result.action}`);
  console.log(`  Details: ${result.details}`);
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
      "No agents detected. Use --agent claude, --agent codex, or --agent gemini",
      1,
    );
  }

  if (agentIds.length > 1) {
    writeMultiAgentSyncBanner(true);
  }

  for (const agentId of agentIds) {
    const output = composeSetup(auditReport, facts, agentId);
    if (output) {
      process.stdout.write(output + "\n");
      if (agentIds.length > 1) process.stdout.write("\n---\n\n");
    }
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

/** Handle the quality command: generate a structured quality-assessment prompt for a selected agent. */
async function handleQualityCommand(options: ParsedCLI): Promise<void> {
  if (!options.agent) {
    throw new CLIError(
      "quality requires --agent. Usage: goat-flow quality . --agent claude",
      2,
    );
  }

  const { createFS } = await import("./facts/fs.js");
  const { runAudit } = await import("./audit/audit.js");
  const { composeQuality } = await import("./prompt/compose-quality.js");

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

  const result = composeQuality({
    agent: options.agent,
    projectPath: options.projectPath,
    auditReport,
  });

  if (options.format === "json") {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    process.stdout.write(result.prompt + "\n");
  }
}

/** Handle the manifest command: resolve + print the single-source-of-truth manifest. */
async function handleManifestCommand(options: ParsedCLI): Promise<void> {
  const { loadManifest, checkManifest, renderManifestMarkdown } =
    await import("./manifest/manifest.js");

  if (options.check) {
    const report = checkManifest();
    if (options.format === "json") {
      process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    } else {
      if (report.status === "pass") {
        console.log("Manifest check: PASS");
      } else {
        console.log("Manifest check: FAIL");
        for (const f of report.findings) {
          console.log(`  - [${f.rule}] ${f.message}`);
        }
      }
    }
    if (report.status === "fail") process.exitCode = 1;
    return;
  }

  const manifest = loadManifest();
  if (options.format === "json") {
    process.stdout.write(JSON.stringify(manifest, null, 2) + "\n");
    return;
  }
  process.stdout.write(renderManifestMarkdown(manifest) + "\n");
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

/** Dispatch one parsed command to its handler. Extracted to keep `main` below
 *  the complexity ceiling as new subcommands land. */
async function dispatchCommand(options: ParsedCLI): Promise<void> {
  if (options.command === "audit") return handleAuditCommand(options);
  if (options.command === "quality") return handleQualityCommand(options);
  if (options.command === "manifest") return handleManifestCommand(options);
  if (options.command === "status") return handleStatusCommand(options);
  if (options.command === "dashboard") {
    const { serveDashboard } = await import("./server/dashboard.js");
    await serveDashboard({
      projectPath: options.projectPath,
      dev: options.dev,
    });
    return;
  }
  if (options.command === "info") {
    handleInfoCommand(options);
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

  // Preserve the documented CLI contract: empty argv defaults to `audit`.
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
