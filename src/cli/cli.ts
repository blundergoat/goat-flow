#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import type { CLIOptions, Grade, AgentId } from './types.js';
import { PACKAGE_VERSION } from './rubric/version.js';

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

Arguments:
  project-path    Target project directory (default: .)

Flags:
  --format <type>   Output format: json, text, markdown (default: auto)
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
`);
}

function printVersion(): void {
  console.log(`goat-flow v${PACKAGE_VERSION}`);
}

type Command = 'scan' | 'fix' | 'setup' | 'audit';
const COMMANDS: Command[] = ['scan', 'fix', 'setup', 'audit'];

export interface ParsedCLI extends CLIOptions {
  command: Command;
}

export function parseCLIArgs(argv: string[]): ParsedCLI {
  // Extract command if first positional is a known command
  let command: Command = 'scan';
  const filtered = [...argv];
  if (filtered.length > 0 && COMMANDS.includes(filtered[0] as Command)) {
    command = filtered.shift() as Command;
  }

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
    if (!['json', 'text', 'markdown'].includes(values.format)) {
      console.error(`Invalid format: ${values.format}. Use: json, text, markdown`);
      process.exit(2);
    }
    format = values.format as CLIOptions['format'];
  }

  // Validate agent
  let agent: AgentId | null = null;
  if (values.agent) {
    if (!['claude', 'codex', 'gemini'].includes(values.agent)) {
      console.error(`Invalid agent: ${values.agent}. Use: claude, codex, gemini`);
      process.exit(2);
    }
    agent = values.agent as AgentId;
  }

  // Parse min-score
  let minScore: number | null = null;
  if (values['min-score']) {
    minScore = parseInt(values['min-score'], 10);
    if (isNaN(minScore) || minScore < 0 || minScore > 100) {
      console.error(`Invalid min-score: ${values['min-score']}. Use: 0-100`);
      process.exit(2);
    }
  }

  // Parse min-grade
  let minGrade: Grade | null = null;
  if (values['min-grade']) {
    const valid = ['A', 'B', 'C', 'D'];
    if (!valid.includes(values['min-grade'].toUpperCase())) {
      console.error(`Invalid min-grade: ${values['min-grade']}. Use: A, B, C, D`);
      process.exit(2);
    }
    minGrade = values['min-grade'].toUpperCase() as Grade;
  }

  return {
    command,
    projectPath: resolve(positionals[0] ?? '.'),
    format,
    agent,
    verbose: values.verbose ?? false,
    minScore,
    minGrade,
    help: values.help ?? false,
    version: values.version ?? false,
  };
}

async function main(): Promise<void> {
  const options = parseCLIArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  if (options.version) {
    printVersion();
    process.exit(0);
  }

  // Import dynamically to keep --help fast
  const { createFS } = await import('./facts/fs.js');
  const { scan } = await import('./evaluate/runner.js');
  const { renderJson } = await import('./render/json.js');
  const { renderText } = await import('./render/text.js');

  const fs = createFS(options.projectPath);
  const report = scan(fs, options.projectPath, {
    agentFilter: options.agent,
  });

  // Handle prompt commands (fix, setup, audit)
  if (options.command !== 'scan') {
    const { composeFix } = await import('./prompt/compose-fix.js');
    const { composeSetup } = await import('./prompt/compose-setup.js');
    const { composeAudit } = await import('./prompt/compose-audit.js');
    const { renderPrompt } = await import('./prompt/render.js');

    // Determine which agents to generate prompts for
    const agentIds = options.agent
      ? [options.agent]
      : report.agents.map(a => a.agent);

    if (agentIds.length === 0) {
      console.error('No agents detected. Use --agent to specify one.');
      process.exit(1);
    }

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
    return;
  }

  // Render scan output
  let output: string;
  switch (options.format) {
    case 'json':
      output = renderJson(report);
      break;
    case 'text':
      output = renderText(report, options.verbose);
      break;
    case 'markdown':
      // TODO: M4 — markdown renderer
      output = renderJson(report);
      break;
    default:
      output = renderJson(report);
  }

  process.stdout.write(output + '\n');

  // CI gate
  if (options.minScore !== null || options.minGrade !== null) {
    const gradeOrder: Record<string, number> = { 'A': 5, 'B': 4, 'C': 3, 'D': 2, 'F': 1, 'insufficient-data': 0 };

    for (const agent of report.agents) {
      if (options.minScore !== null && agent.score.percentage < options.minScore) {
        process.exit(1);
      }
      if (options.minGrade !== null) {
        const agentGradeValue = gradeOrder[agent.score.grade] ?? 0;
        const minGradeValue = gradeOrder[options.minGrade] ?? 0;
        if (agentGradeValue < minGradeValue) {
          process.exit(1);
        }
      }
    }
  }
}

main().catch((err) => {
  console.error('Fatal error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
