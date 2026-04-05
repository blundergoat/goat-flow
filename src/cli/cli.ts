#!/usr/bin/env node

/**
 * Command-line entry point for goat-flow.
 * Handles argv parsing, command dispatch, exit codes, and on-disk output for scan, eval, setup, dashboard, and migration workflows.
 */

import { parseArgs } from 'node:util';
import { resolve, dirname, join } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import type { CLIOptions, Grade, AgentId, ScanReport } from './types.js';

import { getPackageVersion } from './paths.js';

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
goat-flow - GOAT Flow CLI Auditor + Scoring Engine

Usage:
  goat-flow [command] [project-path] [flags]

Commands:
  scan              Score a project (default)
  setup             Generate setup prompt (adapts to project state)
  eval              Parse and summarize agent evals

Arguments:
  project-path    Target project directory (default: .)

Flags:
  --format <type>   Output format: json, text, markdown, html (default: auto)
  --agent <id>      Filter to one agent: claude, codex, gemini
  --verbose         Show per-check details in text mode
  --min-score <n>   CI gate: exit 1 if score below threshold (0-100)
  --min-grade <g>   CI gate: exit 1 if grade below threshold (A, B, C, D)
  --output <file>   Write output to file instead of stdout
  --guide           Show prioritized setup guidance instead of scores
  --dev             Dashboard: live reload on file changes
  --help, -h        Show this help
  --version, -v     Show version

Examples:
  goat-flow .                        Scan current directory
  goat-flow scan --format json       Force JSON output
  goat-flow scan --guide             Prioritized setup guidance
  goat-flow setup --agent claude     Setup prompt for Claude
  goat-flow setup --agent codex      Setup prompt for Codex
  goat-flow setup --agent gemini      Setup prompt for Gemini
  goat-flow --min-score 75           CI gate: fail if below 75%
  goat-flow --format markdown        PR-comment friendly output
  goat-flow --output report.json     Write results to file
  goat-flow eval                     Summarize agent evals
  goat-flow eval --format json       Eval summary as JSON
`);
}

/** Print the current package version to stdout */
function printVersion(): void {
  console.log(`goat-flow v${PACKAGE_VERSION}`);
}

/** Supported CLI subcommand names */
type Command = 'scan' | 'setup' | 'eval' | 'dashboard';

/** List of recognized CLI subcommands */
const COMMANDS: Command[] = ['scan', 'setup', 'eval', 'dashboard'];
/** Previously valid commands that now produce a helpful deprecation error */
const REMOVED_COMMANDS = ['fix', 'audit'];
/** Accepted values for the --format flag */
const VALID_FORMATS = ['json', 'text', 'html', 'markdown'] as const;
/** Accepted values for the --agent flag */
const VALID_AGENTS: AgentId[] = ['claude', 'codex', 'gemini'];
/** Banner text warning that multi-agent setup output must stay in sync */
const MULTI_AGENT_SYNC_BANNER = [
  '**Multi-agent sync:** This prompt generates setup for multiple agents. The execution loop',
  '(READ → CLASSIFY → SCOPE → ACT → VERIFY → LOG), autonomy tiers, and Definition of Done',
  'MUST be identical across all instruction files. Write these sections for the first agent,',
  'then COPY THEM VERBATIM to the other instruction files. Do not rephrase.',
];

/** Fully resolved CLI options including the dispatched command */
export interface ParsedCLI extends CLIOptions {
  command: Command;
}

/** Parse the positional subcommand from raw CLI args, defaulting to `scan`. */
function parseCommand(argv: string[]): {
  command: Command;
  filteredArgs: string[];
} {
  const filteredArgs = [...argv];
  const first = filteredArgs[0];
  if (first !== undefined && REMOVED_COMMANDS.includes(first)) {
    throw new CLIError(
      `"${first}" was removed. Use "setup" instead - it adapts to your project's state.`,
      2,
    );
  }
  if (
    filteredArgs.length > 0 &&
    COMMANDS.includes(filteredArgs[0] as Command)
  ) {
    return { command: filteredArgs.shift() as Command, filteredArgs };
  }
  return { command: 'scan', filteredArgs };
}

/** Parse the `--format` flag, defaulting to text on TTYs and JSON otherwise. */
function parseFormatArg(value: string | undefined): CLIOptions['format'] {
  const defaultFormat: CLIOptions['format'] = process.stdout.isTTY
    ? 'text'
    : 'json';
  if (!value) return defaultFormat;
  if (!VALID_FORMATS.includes(value as (typeof VALID_FORMATS)[number])) {
    throw new CLIError(
      `Invalid format: ${value}. Use: json, text, html, markdown`,
      2,
    );
  }
  return value as CLIOptions['format'];
}

/** Parse the `--agent` flag and reject deprecated aggregate agent modes. */
function parseAgentArg(value: string | undefined): AgentId | null {
  if (!value) return null;
  if (value === 'all') {
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

/** Parse the `--min-score` threshold and keep it within the 0-100 range. */
function parseMinScoreArg(value: string | undefined): number | null {
  if (!value) return null;
  const minScore = parseInt(value, 10);
  if (isNaN(minScore) || minScore < 0 || minScore > 100) {
    throw new CLIError(`Invalid min-score: ${value}. Use: 0-100`, 2);
  }
  return minScore;
}

/** Parse the `--min-grade` threshold using the supported letter grades. */
function parseMinGradeArg(value: string | undefined): Grade | null {
  if (!value) return null;
  const normalized = value.toUpperCase();
  const valid: Grade[] = ['A', 'B', 'C', 'D'];
  if (!valid.includes(normalized as Grade)) {
    throw new CLIError(`Invalid min-grade: ${value}. Use: A, B, C, D`, 2);
  }
  return normalized as Grade;
}

/** Resolve `--output`, defaulting bare file names into `.goat-flow/` under the target repo. */
function resolveOutputPath(
  output: string | undefined,
  positionals: string[],
): string | null {
  if (!output) return null;
  const projectRoot = positionals[0] ?? '.';
  return resolve(
    output.includes('/') || output.includes('\\')
      ? output
      : join(projectRoot, '.goat-flow', output),
  );
}

/** Parse raw CLI argv into a structured ParsedCLI options object */
export function parseCLIArgs(argv: string[]): ParsedCLI {
  const { command, filteredArgs } = parseCommand(argv);

  /** Destructured parseArgs result containing option values and positional arguments */
  const { values, positionals } = parseArgs({
    args: filteredArgs,
    options: {
      format: { type: 'string' },
      agent: { type: 'string' },
      verbose: { type: 'boolean', default: false },
      'min-score': { type: 'string' },
      'min-grade': { type: 'string' },
      output: { type: 'string', short: 'o' },
      guide: { type: 'boolean', default: false },
      dev: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'v', default: false },
    },
    allowPositionals: true,
    strict: true,
  });

  return {
    command,
    projectPath: resolve(positionals[0] ?? '.'),
    format: parseFormatArg(values.format),
    agent: parseAgentArg(values.agent),
    verbose: values.verbose === true,
    minScore: parseMinScoreArg(values['min-score']),
    minGrade: parseMinGradeArg(values['min-grade']),
    output: resolveOutputPath(values.output, positionals),
    guide: values.guide === true,
    dev: values.dev === true,
    help: values.help === true,
    version: values.version === true,
  };
}

/** Handle the eval command: load, summarize, and output agent eval results */
async function handleEvalCommand(options: ParsedCLI): Promise<void> {
  const { loadEvals, summarize, formatSummaryText, formatSummaryJson } =
    await import('./evals/loader.js');
  const { createFS } = await import('./facts/fs.js');
  /** Virtual filesystem scoped to the target project path */
  const fs = createFS(options.projectPath);
  const { loadConfig } = await import('./config/reader.js');
  /** Resolved evals path from config (defaults to ai-docs/evals/) */
  const evalsDir = resolve(
    options.projectPath,
    loadConfig(options.projectPath, fs).config.evals.path,
  );
  const { evals, errors } = loadEvals(fs, evalsDir);
  /** Aggregated eval summary grouped by skill, agent, difficulty, and origin */
  const summary = summarize(evals, errors);
  /** Formatted output string in the requested format */
  const output =
    options.format === 'json'
      ? formatSummaryJson(summary)
      : formatSummaryText(summary);
  process.stdout.write(output + '\n');
  if (errors.length > 0) {
    throw new CLIError('Eval completed with errors', 1);
  }
}

/** Pick the agent list for setup output from the CLI override or scan report. */
function getSetupAgentIds(options: ParsedCLI, report: ScanReport): AgentId[] {
  return options.agent ? [options.agent] : report.agents.map((a) => a.agent);
}

/** Print the banner that warns multi-agent setup output must stay in sync. */
function writeMultiAgentSyncBanner(withDivider: boolean): void {
  const lines = withDivider
    ? [...MULTI_AGENT_SYNC_BANNER, '', '---', '']
    : [...MULTI_AGENT_SYNC_BANNER, '', ''];
  process.stdout.write(lines.join('\n'));
}

/** Decide whether setup output should be merged across multiple detected agents. */
function shouldUseMultiAgentSetup(
  agentIds: AgentId[],
  report: ScanReport,
): boolean {
  return (
    agentIds.length > 1 &&
    agentIds.every((id) => {
      const agentReport = report.agents.find((a) => a.agent === id);
      return !agentReport || agentReport.score.percentage === 0;
    })
  );
}

/** Compose setup output for one agent. */
function renderSetupOutput(
  report: ScanReport,
  agentId: AgentId,
  composeSetup: (report: ScanReport, agent: AgentId) => string | null,
): string | null {
  return composeSetup(report, agentId);
}

/** Handle the setup command: compose and render setup prompts per agent */
async function handleSetupCommand(
  options: ParsedCLI,
  report: ScanReport,
): Promise<void> {
  const { composeSetup, composeMultiAgentSetup } =
    await import('./prompt/compose-setup.js');

  const agentIds = getSetupAgentIds(options, report);
  if (agentIds.length === 0) {
    throw new CLIError(
      'No agents detected. Use --agent claude, --agent codex, or --agent gemini',
      1,
    );
  }

  if (shouldUseMultiAgentSetup(agentIds, report)) {
    writeMultiAgentSyncBanner(false);
    const output = composeMultiAgentSetup(report, agentIds);
    process.stdout.write(output + '\n');
    return;
  }

  if (agentIds.length > 1) {
    writeMultiAgentSyncBanner(true);
  }

  for (const agentId of agentIds) {
    const output = renderSetupOutput(report, agentId, composeSetup);
    if (output) {
      process.stdout.write(output + '\n');
      if (agentIds.length > 1) process.stdout.write('\n---\n\n');
    }
  }
}

/** Check CI gate thresholds and throw if any agent fails to meet them */
function handleCIGate(options: ParsedCLI, report: ScanReport): void {
  if (options.minScore === null && options.minGrade === null) return;

  /** Numeric ordering of grades for comparison (higher is better) */
  const gradeOrder: Record<string, number> = {
    A: 5,
    B: 4,
    C: 3,
    D: 2,
    F: 1,
    'insufficient-data': 0,
  };

  // Iterate over each agent report to check against CI gate thresholds
  for (const agent of report.agents) {
    if (
      options.minScore !== null &&
      agent.score.percentage < options.minScore
    ) {
      throw new CLIError(
        `CI gate failed: ${agent.agent} score ${agent.score.percentage}% below threshold ${options.minScore}%`,
        1,
      );
    }
    if (options.minGrade !== null) {
      /** Numeric value of the agent's grade for threshold comparison */
      const agentGradeValue = gradeOrder[agent.score.grade] ?? 0;
      /** Numeric value of the minimum required grade */
      const minGradeValue = gradeOrder[options.minGrade] ?? 0;
      if (agentGradeValue < minGradeValue) {
        throw new CLIError(
          `CI gate failed: ${agent.agent} grade ${agent.score.grade} below threshold ${options.minGrade}`,
          1,
        );
      }
    }
  }
}

/** Render scan output. */
async function renderScanOutput(
  options: ParsedCLI,
  report: ScanReport,
): Promise<string> {
  const { renderJson } = await import('./render/json.js');
  const { renderText } = await import('./render/text.js');

  if (options.guide) {
    const { renderGuide } = await import('./render/guide.js');
    return renderGuide(report);
  }

  if (options.format === 'html') {
    const { renderHtml } = await import('./render/html.js');
    return renderHtml(report);
  }
  if (options.format === 'markdown') {
    const { renderMarkdown } = await import('./render/markdown.js');
    return renderMarkdown(report);
  }
  if (options.format === 'text') {
    return renderText(report, options.verbose);
  }
  return renderJson(report);
}

/** Write scan output. */
function writeScanOutput(options: ParsedCLI, rendered: string): void {
  if (options.output) {
    mkdirSync(dirname(options.output), { recursive: true });
    writeFileSync(options.output, rendered + '\n', 'utf-8');
    console.error(`Written to ${options.output}`);
    return;
  }

  process.stdout.write(rendered + '\n');
}

/** Run the main scan flow, render the report, and append scan history. */
async function handleScanCommand(
  options: ParsedCLI,
  report: ScanReport,
): Promise<void> {
  const rendered = await renderScanOutput(options, report);
  writeScanOutput(options, rendered);

  const { appendScanHistory } = await import('./telemetry/scan-logger.js');
  appendScanHistory(report, options.projectPath);
}

/** Entry point that dispatches to the appropriate command handler */
async function main(): Promise<void> {
  // Gracefully handle EPIPE (e.g., output piped to `head`)
  process.stdout.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE') process.exit(0);
    throw err;
  });

  /** Parsed CLI options derived from process.argv */
  const options = parseCLIArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }
  if (options.version) {
    printVersion();
    return;
  }
  if (options.command === 'eval') {
    await handleEvalCommand(options);
    return;
  }
  if (options.command === 'dashboard') {
    const { serveDashboard } = await import('./server/dashboard.js');
    await serveDashboard({
      projectPath: options.projectPath,
      dev: options.dev,
    });
    return;
  }

  const { createFS } = await import('./facts/fs.js');
  const { scanProject } = await import('./scanner/scan.js');
  const fs = createFS(options.projectPath);
  const report = scanProject(fs, options.projectPath, {
    agentFilter: options.agent ?? null,
  });

  if (options.command === 'scan') {
    await handleScanCommand(options, report);
  } else {
    await handleSetupCommand(options, report);
  }

  handleCIGate(options, report);
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
