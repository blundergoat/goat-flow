#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import type { CLIOptions, Grade, AgentId, ScanReport } from './types.js';
import { PACKAGE_VERSION } from './rubric/version.js';

/** Structured error with an exit code for CLI process termination */
class CLIError extends Error {
  constructor(message: string, public exitCode: number) { super(message); }
}

/** Print usage instructions and available commands to stdout */
function printHelp(): void {
  console.log(`
goat-flow — GOAT Flow CLI Auditor + Scoring Engine

Usage:
  goat-flow [command] [project-path] [flags]

Commands:
  scan              Score a project (default)
  fix               Generate fix prompt for failed checks
  setup             Generate full setup prompt
  audit             Generate read-only audit prompt
  eval              Parse and summarize agent evals

Arguments:
  project-path    Target project directory (default: .)

Flags:
  --format <type>   Output format: json, text (default: auto)
  --agent <id>      Filter to one agent: claude, codex, gemini
  --verbose         Show per-check details in text mode
  --min-score <n>   CI gate: exit 1 if score below threshold (0-100)
  --min-grade <g>   CI gate: exit 1 if grade below threshold (A, B, C, D)
  --help, -h        Show this help
  --version, -v     Show version

Examples:
  goat-flow .                        Scan current directory
  goat-flow scan --format json       Force JSON output
  goat-flow fix --agent claude       Fix prompt for Claude only
  goat-flow setup --agent codex      Setup prompt for Codex
  goat-flow audit --agent gemini     Audit prompt for Gemini
  goat-flow --min-score 75           CI gate: fail if below 75%
  goat-flow eval                     Summarize agent evals
  goat-flow eval --format json       Eval summary as JSON
`);
}

/** Print the current package version to stdout */
function printVersion(): void {
  console.log(`goat-flow v${PACKAGE_VERSION}`);
}

type Command = 'scan' | 'fix' | 'setup' | 'audit' | 'eval';

/** List of recognized CLI subcommands */
const COMMANDS: Command[] = ['scan', 'fix', 'setup', 'audit', 'eval'];

export interface ParsedCLI extends CLIOptions {
  command: Command;
}

/** Parse raw CLI argv into a structured ParsedCLI options object */
export function parseCLIArgs(argv: string[]): ParsedCLI {
  // Extract command if first positional is a known command
  let command: Command = 'scan';
  /** Mutable copy of argv for shifting the command token */
  const filtered = [...argv];
  if (filtered.length > 0 && COMMANDS.includes(filtered[0] as Command)) {
    command = filtered.shift() as Command;
  }

  /** Destructured parseArgs result containing option values and positional arguments */
  const { values, positionals } = parseArgs({
    args: filtered,
    options: {
      format: { type: 'string' },
      agent: { type: 'string' },
      verbose: { type: 'boolean', default: false },
      'min-score': { type: 'string' },
      'min-grade': { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'v', default: false },
    },
    allowPositionals: true,
    strict: true,
  });

  // Auto-detect format: text if TTY, json if piped
  let format: CLIOptions['format'] = process.stdout.isTTY ? 'text' : 'json';
  if (values.format) {
    if (['json', 'text'].includes(values.format) === false) {
      throw new CLIError(`Invalid format: ${values.format}. Use: json, text`, 2);
    }
    format = values.format as CLIOptions['format'];
  }

  // Validate agent
  let agent: AgentId | null = null;
  if (values.agent) {
    if (['claude', 'codex', 'gemini'].includes(values.agent) === false) {
      throw new CLIError(`Invalid agent: ${values.agent}. Use: claude, codex, gemini`, 2);
    }
    agent = values.agent as AgentId;
  }

  // Parse min-score
  let minScore: number | null = null;
  if (values['min-score']) {
    minScore = parseInt(values['min-score'], 10);
    if (isNaN(minScore) || minScore < 0 || minScore > 100) {
      throw new CLIError(`Invalid min-score: ${values['min-score']}. Use: 0-100`, 2);
    }
  }

  // Parse min-grade
  let minGrade: Grade | null = null;
  if (values['min-grade']) {
    /** Allowed grade values for the CI gate threshold */
    const valid = ['A', 'B', 'C', 'D'];
    if (valid.includes(values['min-grade'].toUpperCase()) === false) {
      throw new CLIError(`Invalid min-grade: ${values['min-grade']}. Use: A, B, C, D`, 2);
    }
    minGrade = values['min-grade'].toUpperCase() as Grade;
  }

  return {
    command,
    projectPath: resolve(positionals[0] ?? '.'),
    format,
    agent,
    verbose: values.verbose === true,
    minScore,
    minGrade,
    help: values.help === true,
    version: values.version === true,
  };
}

/** Handle the eval command: load, summarize, and output agent eval results */
async function handleEvalCommand(options: ParsedCLI): Promise<void> {
  const { loadEvals, summarize, formatSummaryText, formatSummaryJson } =
    await import('./eval/runner.js');
  const { createFS } = await import('./facts/fs.js');
  /** Virtual filesystem scoped to the target project path */
  const fs = createFS(options.projectPath);
  /** Resolved path to the agent-evals directory */
  const evalsDir = resolve(options.projectPath, 'agent-evals');
  const { evals, errors } = loadEvals(fs, evalsDir);
  /** Aggregated eval summary grouped by skill, agent, difficulty, and origin */
  const summary = summarize(evals, errors);
  /** Formatted output string in the requested format */
  const output = options.format === 'json'
    ? formatSummaryJson(summary)
    : formatSummaryText(summary);
  process.stdout.write(output + '\n');
  if (errors.length > 0) {
    throw new CLIError('Eval completed with errors', 1);
  }
}

/** Handle prompt commands (fix, setup, audit): compose and render prompts per agent */
async function handlePromptCommand(options: ParsedCLI, report: ScanReport): Promise<void> {
  const { composeFix } = await import('./prompt/compose-fix.js');
  const { composeSetup } = await import('./prompt/compose-setup.js');
  const { composeAudit } = await import('./prompt/compose-audit.js');
  const { renderPrompt } = await import('./prompt/render.js');

  // Determine which agents to generate prompts for
  /** List of agent IDs to generate prompts for (filtered or all detected) */
  const agentIds = options.agent
    ? [options.agent]
    : report.agents.map(a => a.agent);

  if (agentIds.length === 0) {
    throw new CLIError('No agents detected. Use --agent to specify one.', 1);
  }

  // Iterate over each agent ID to compose and render the appropriate prompt
  for (const agentId of agentIds) {
    let prompt;
    switch (options.command) {
      case 'fix': prompt = composeFix(report, agentId); break;
      case 'setup': prompt = composeSetup(report, agentId); break;
      case 'audit': prompt = composeAudit(report, agentId); break;
    }

    if (prompt) {
      process.stdout.write(renderPrompt(prompt) + '\n');
      if (agentIds.length > 1) process.stdout.write('\n---\n\n');
    }
  }
}

/** Check CI gate thresholds and throw if any agent fails to meet them */
function handleCIGate(options: ParsedCLI, report: ScanReport): void {
  if (options.minScore === null && options.minGrade === null) return;

  /** Numeric ordering of grades for comparison (higher is better) */
  const gradeOrder: Record<string, number> = { 'A': 5, 'B': 4, 'C': 3, 'D': 2, 'F': 1, 'insufficient-data': 0 };

  // Iterate over each agent report to check against CI gate thresholds
  for (const agent of report.agents) {
    if (options.minScore !== null && agent.score.percentage < options.minScore) {
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

/** Entry point that dispatches to the appropriate command handler */
async function main(): Promise<void> {
  /** Parsed CLI options derived from process.argv */
  const options = parseCLIArgs(process.argv.slice(2));

  if (options.help) { printHelp(); return; }
  if (options.version) { printVersion(); return; }

  // Handle eval command separately (does not need project scanning)
  if (options.command === 'eval') {
    await handleEvalCommand(options);
    return;
  }

  // Import dynamically to keep --help fast
  const { createFS } = await import('./facts/fs.js');
  const { scan } = await import('./evaluate/runner.js');
  const { renderJson } = await import('./render/json.js');
  const { renderText } = await import('./render/text.js');

  /** Virtual filesystem scoped to the target project path */
  const fs = createFS(options.projectPath);
  /** Full scan report containing per-agent scores and check results */
  const report = scan(fs, options.projectPath, {
    agentFilter: options.agent,
  });

  if (options.command === 'scan') {
    /** Formatted scan output string in the requested format */
    const output = options.format === 'text'
      ? renderText(report, options.verbose)
      : renderJson(report);
    process.stdout.write(output + '\n');
  } else {
    await handlePromptCommand(options, report);
  }

  handleCIGate(options, report);
}

main().catch((err: unknown) => {
  if (err instanceof CLIError) {
    console.error(err.message);
    process.exit(err.exitCode);
  }
  console.error(`Fatal error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
