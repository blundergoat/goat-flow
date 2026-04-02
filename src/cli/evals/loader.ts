/**
 * Eval runner: reads eval files from ai/evals/, parses them,
 * and outputs a structured summary.
 *
 * This is v1 scaffolding -- it parses and reports.
 * Actual agent execution against scenarios comes later.
 */

import { join } from 'node:path';
import { parseEvalFile } from './parser.js';
import type { ReadonlyFS } from '../types.js';
import type {
  ParsedEval,
  EvalSummary,
  SkillBreakdown,
  AgentBreakdown,
  EvalAgents,
  EvalDifficulty,
  EvalOrigin,
  ParseError,
} from './types.js';

/** Set of filenames to skip when discovering eval files */
const SKIP_FILES = new Set(['README.md', 'FORMAT.md']);
const DIFFICULTY_ORDER = ['easy', 'medium', 'hard'] as const;
const ORIGIN_ORDER = ['real-incident', 'synthetic-seed'] as const;

/** Discover all markdown eval files in the given directory, excluding skip-listed names */
function discoverEvalFiles(fs: ReadonlyFS, evalsDir: string): string[] {
  if (fs.exists(evalsDir) === false) return [];

  return fs.listDir(evalsDir)
    .filter(f => f.endsWith('.md') && SKIP_FILES.has(f) === false)
    .sort();
}

/** Load and parse all eval files from a directory, returning parsed evals and any parse errors */
export function loadEvals(fs: ReadonlyFS, evalsDir: string): {
  evals: ParsedEval[];
  errors: ParseError[];
} {
  /** List of discovered eval markdown filenames */
  const files = discoverEvalFiles(fs, evalsDir);
  /** Accumulator for successfully parsed eval objects */
  const evals: ParsedEval[] = [];
  /** Accumulator for files that failed to parse */
  const errors: ParseError[] = [];

  // Iterate over each discovered eval file to parse it
  for (const file of files) {
    try {
      /** Raw markdown content of the eval file */
      const raw = fs.readFile(join(evalsDir, file));
      if (raw === null) {
        errors.push({ file, message: 'File could not be read' });
        continue;
      }
      evals.push(parseEvalFile(raw, file));
    } catch (err) {
      errors.push({
        file,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { evals, errors };
}

/** Aggregate parsed evals into a summary grouped by skill, agent, difficulty, and origin */
export function summarize(evals: ParsedEval[], errors: ParseError[]): EvalSummary {
  /** Map of skill name to count and file list for skill breakdown */
  const bySkillMap = new Map<string, { count: number; files: string[] }>();
  /** Map of agent target to count and file list for agent breakdown */
  const byAgentMap = new Map<EvalAgents, { count: number; files: string[] }>();
  /** Count of evals at each difficulty level */
  const byDifficulty: Record<EvalDifficulty, number> = {
    easy: 0,
    medium: 0,
    hard: 0,
  };
  /** Count of evals by origin type */
  const byOrigin: Record<EvalOrigin, number> = {
    'real-incident': 0,
    'synthetic-seed': 0,
  };

  // Iterate over each parsed eval to accumulate summary statistics
  for (const ev of evals) {
    /** Frontmatter metadata for the current eval */
    const fm = ev.frontmatter;

    // Skill breakdown
    /** Skill key for grouping, using 'unassigned' if no skill is set */
    const skillKey = fm.skill ?? 'unassigned';
    /** Current or new skill entry in the breakdown map */
    const skillEntry = bySkillMap.get(skillKey) ?? { count: 0, files: [] };
    skillEntry.count++;
    skillEntry.files.push(ev.file);
    bySkillMap.set(skillKey, skillEntry);

    // Agent breakdown
    /** Current or new agent entry in the breakdown map */
    const agentEntry = byAgentMap.get(fm.agents) ?? { count: 0, files: [] };
    agentEntry.count++;
    agentEntry.files.push(ev.file);
    byAgentMap.set(fm.agents, agentEntry);

    // Difficulty
    byDifficulty[fm.difficulty]++;

    // Origin
    byOrigin[fm.origin]++;
  }

  /** Sorted skill breakdown array derived from the skill map */
  const bySkill: SkillBreakdown[] = Array.from(bySkillMap.entries())
    .map(([skill, data]) => ({ skill, ...data }))
    .sort((a, b) => a.skill.localeCompare(b.skill));

  /** Sorted agent breakdown array derived from the agent map */
  const byAgent: AgentBreakdown[] = Array.from(byAgentMap.entries())
    .map(([agents, data]) => ({ agents, ...data }))
    .sort((a, b) => a.agents.localeCompare(b.agents));

  return {
    totalEvals: evals.length,
    bySkill,
    byAgent,
    byDifficulty,
    byOrigin,
    parseErrors: errors,
  };
}

function formatEvalCount(count: number): string {
  return `${count} eval${count !== 1 ? 's' : ''}`;
}

function appendSkillSummary(lines: string[], skills: SkillBreakdown[]): void {
  lines.push('By Skill:');
  if (skills.length === 0) {
    lines.push('  (none)');
    lines.push('');
    return;
  }

  for (const skill of skills) {
    lines.push(`  ${skill.skill}: ${formatEvalCount(skill.count)}`);
  }
  lines.push('');
}

function appendAgentSummary(lines: string[], agents: AgentBreakdown[]): void {
  lines.push('By Agent:');
  for (const agent of agents) {
    lines.push(`  ${agent.agents}: ${formatEvalCount(agent.count)}`);
  }
  lines.push('');
}

function appendNonZeroSection<T extends string>(
  lines: string[],
  title: string,
  order: readonly T[],
  counts: Record<T, number>,
): void {
  lines.push(title);
  for (const key of order) {
    if (counts[key] > 0) lines.push(`  ${key}: ${counts[key]}`);
  }
  lines.push('');
}

function appendParseErrorSummary(lines: string[], errors: ParseError[]): void {
  if (errors.length === 0) return;

  lines.push('Parse Errors:');
  for (const error of errors) {
    lines.push(`  ${error.file}: ${error.message}`);
  }
}

/** Format an eval summary as human-readable plain text */
export function formatSummaryText(summary: EvalSummary): string {
  /** Accumulator for output lines */
  const lines: string[] = [];

  lines.push(`Eval Summary`);
  lines.push(`============`);
  lines.push(`Total evals: ${summary.totalEvals}`);
  lines.push('');
  appendSkillSummary(lines, summary.bySkill);
  appendAgentSummary(lines, summary.byAgent);
  appendNonZeroSection(lines, 'By Difficulty:', DIFFICULTY_ORDER, summary.byDifficulty);
  appendNonZeroSection(lines, 'By Origin:', ORIGIN_ORDER, summary.byOrigin);
  appendParseErrorSummary(lines, summary.parseErrors);

  return lines.join('\n');
}

/** Format an eval summary as a JSON string with 2-space indentation */
export function formatSummaryJson(summary: EvalSummary): string {
  return JSON.stringify(summary, null, 2);
}
