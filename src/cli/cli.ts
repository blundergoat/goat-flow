#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { resolve, dirname, join } from 'node:path';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CLIOptions, Grade, AgentId, ScanReport } from './types.js';

/** Find package.json by walking up from the current file's directory */
function findPackageVersion(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, 'package.json');
    if (existsSync(candidate)) {
      return (JSON.parse(readFileSync(candidate, 'utf-8')) as { version: string }).version;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return '0.0.0';
}

/** Package version from package.json — single source of truth */
const PACKAGE_VERSION = findPackageVersion();

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
  --help, -h        Show this help
  --version, -v     Show version

Examples:
  goat-flow .                        Scan current directory
  goat-flow scan --format json       Force JSON output
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

type Command = 'scan' | 'setup' | 'eval' | 'dashboard';

/** List of recognized CLI subcommands */
const COMMANDS: Command[] = ['scan', 'setup', 'eval', 'dashboard'];

export interface ParsedCLI extends CLIOptions {
  command: Command;
}

/** Parse raw CLI argv into a structured ParsedCLI options object */
export function parseCLIArgs(argv: string[]): ParsedCLI {
  // Extract command if first positional is a known command
  let command: Command = 'scan';
  /** Mutable copy of argv for shifting the command token */
  const filtered = [...argv];
  const REMOVED_COMMANDS = ['fix', 'audit'];
  const first = filtered[0];
  if (first !== undefined && REMOVED_COMMANDS.includes(first)) {
    throw new CLIError(`"${first}" was removed. Use "setup" instead — it adapts to your project's state.`, 2);
  }
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
      output: { type: 'string', short: 'o' },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'v', default: false },
    },
    allowPositionals: true,
    strict: true,
  });

  // Auto-detect format: text if TTY, json if piped
  let format: CLIOptions['format'] = process.stdout.isTTY ? 'text' : 'json';
  if (values.format) {
    if (['json', 'text', 'html', 'markdown'].includes(values.format) === false) {
      throw new CLIError(`Invalid format: ${values.format}. Use: json, text, html, markdown`, 2);
    }
    format = values.format as CLIOptions['format'];
  }

  // Validate agent
  let agent: AgentId | null = null;
  if (values.agent) {
    if (values.agent === 'all') {
      throw new CLIError(`--agent all is no longer supported. Run setup separately for each agent: --agent claude, --agent codex, --agent gemini`, 2);
    }
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
    output: values.output ? resolve(values.output) : null,
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

/** Handle the setup command: compose and render setup prompts per agent */
async function handleSetupCommand(options: ParsedCLI, report: ScanReport): Promise<void> {
  const { composeSetup, composeInlineSetup, composeMultiAgentSetup } = await import('./prompt/compose-setup.js');
  const { renderPrompt } = await import('./prompt/render.js');

  // Determine which agent to generate prompt for
  /** List of agent IDs to generate prompts for */
  const agentIds: AgentId[] = options.agent
    ? [options.agent]
    : report.agents.map(a => a.agent);

  if (agentIds.length === 0) {
    throw new CLIError('No agents detected. Use --agent claude, --agent codex, or --agent gemini', 1);
  }

  // Multi-agent: deduplicated output with shared files once + per-agent sections
  if (agentIds.length > 1 && process.env.GOAT_FLOW_INLINE_SETUP !== '1') {
    // Check if any agent needs full setup (no agents detected or 0%)
    const allFresh = agentIds.every(id => {
      const agentReport = report.agents.find(a => a.agent === id);
      return !agentReport || agentReport.score.percentage === 0;
    });

    if (allFresh) {
      // All agents need full setup — use deduplicated multi-agent output
      process.stdout.write([
        '**Multi-agent sync:** This prompt generates setup for multiple agents. The execution loop',
        '(READ → CLASSIFY → SCOPE → ACT → VERIFY → LOG), autonomy tiers, and Definition of Done',
        'MUST be identical across all instruction files. Write these sections for the first agent,',
        'then COPY THEM VERBATIM to the other instruction files. Do not rephrase.',
        '',
        '',
      ].join('\n'));
      const output = composeMultiAgentSetup(report, agentIds);
      process.stdout.write(output + '\n');
      return;
    }
  }

  // Single-agent or mixed-mode: render each agent separately
  if (agentIds.length > 1) {
    process.stdout.write([
      '**Multi-agent sync:** This prompt generates setup for multiple agents. The execution loop',
      '(READ → CLASSIFY → SCOPE → ACT → VERIFY → LOG), autonomy tiers, and Definition of Done',
      'MUST be identical across all instruction files. Write these sections for the first agent,',
      'then COPY THEM VERBATIM to the other instruction files. Do not rephrase.',
      '',
      '---',
      '',
    ].join('\n'));
  }

  // Iterate over each agent ID to compose and render the setup prompt
  for (const agentId of agentIds) {
    let output: string | null = null;

    // Setup returns a markdown string directly (reference-based)
    // Rollback: GOAT_FLOW_INLINE_SETUP=1 uses the old fragment-based renderer
    if (process.env.GOAT_FLOW_INLINE_SETUP === '1') {
      const prompt = composeInlineSetup(report, agentId);
      output = prompt ? renderPrompt(prompt) : null;
    } else {
      output = composeSetup(report, agentId);
    }

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
  // Gracefully handle EPIPE (e.g., output piped to `head`)
  process.stdout.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE') process.exit(0);
    throw err;
  });

  /** Parsed CLI options derived from process.argv */
  const options = parseCLIArgs(process.argv.slice(2));

  if (options.help) { printHelp(); return; }
  if (options.version) { printVersion(); return; }

  // Handle eval command separately (does not need project scanning)
  if (options.command === 'eval') {
    await handleEvalCommand(options);
    return;
  }

  // Dashboard: start local server (handles scan/setup via API)
  if (options.command === 'dashboard') {
    const { serveDashboard } = await import('./serve-dashboard.js');
    serveDashboard(options.projectPath);
    return;
  }

  // Import dynamically to keep --help fast
  const { createFS } = await import('./facts/fs.js');
  const { scanProject } = await import('./scanner/scan.js');
  const { renderJson } = await import('./render/json.js');
  const { renderText } = await import('./render/text.js');

  /** Virtual filesystem scoped to the target project path */
  const fs = createFS(options.projectPath);
  /** Full scan report containing per-agent scores and check results */
  const report = scanProject(fs, options.projectPath, {
    agentFilter: options.agent ?? null,
  });

  if (options.command === 'scan') {
    /** Formatted scan output string in the requested format */
    let rendered: string;
    if (options.format === 'html') {
      const { renderHtml } = await import('./render/html.js');
      rendered = renderHtml(report);
    } else if (options.format === 'markdown') {
      const { renderMarkdown } = await import('./render/markdown.js');
      rendered = renderMarkdown(report);
    } else if (options.format === 'text') {
      rendered = renderText(report, options.verbose);
    } else {
      rendered = renderJson(report);
    }

    if (options.output) {
      writeFileSync(options.output, rendered + '\n', 'utf-8');
      console.error(`Written to ${options.output}`);
    } else {
      process.stdout.write(rendered + '\n');
    }

    // Append to local telemetry log (silent on failure)
    const { appendScanHistory } = await import('./telemetry/scan-logger.js');
    appendScanHistory(report, options.projectPath);
  } else {
    // setup command — generates prompts that adapt to project state
    await handleSetupCommand(options, report);
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
