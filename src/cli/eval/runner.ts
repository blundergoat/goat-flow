/**
 * Eval runner: reads eval files from agent-evals/, parses them,
 * and outputs a structured summary.
 *
 * This is v1 scaffolding -- it parses and reports.
 * Actual agent execution against scenarios comes later.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseEvalFile } from './parser.js';
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

/** Discover all markdown eval files in the given directory, excluding skip-listed names */
export function discoverEvalFiles(evalsDir: string): string[] {
  if (existsSync(evalsDir) === false) return [];

  return readdirSync(evalsDir)
    .filter(f => f.endsWith('.md') && SKIP_FILES.has(f) === false)
    .sort();
}

/** Load and parse all eval files from a directory, returning parsed evals and any parse errors */
export function loadEvals(evalsDir: string): {
  evals: ParsedEval[];
  errors: ParseError[];
} {
  /** List of discovered eval markdown filenames */
  const files = discoverEvalFiles(evalsDir);
  /** Accumulator for successfully parsed eval objects */
  const evals: ParsedEval[] = [];
  /** Accumulator for files that failed to parse */
  const errors: ParseError[] = [];

  // Iterate over each discovered eval file to parse it
  for (const file of files) {
    try {
      /** Raw markdown content of the eval file */
      const raw = readFileSync(join(evalsDir, file), 'utf-8');
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

/** Format an eval summary as human-readable plain text */
export function formatSummaryText(summary: EvalSummary): string {
  /** Accumulator for output lines */
  const lines: string[] = [];

  lines.push(`Eval Summary`);
  lines.push(`============`);
  lines.push(`Total evals: ${summary.totalEvals}`);
  lines.push('');

  // By skill
  lines.push('By Skill:');
  if (summary.bySkill.length === 0) {
    lines.push('  (none)');
  } else {
    // Iterate over each skill breakdown entry to format its line
    for (const s of summary.bySkill) {
      lines.push(`  ${s.skill}: ${s.count} eval${s.count !== 1 ? 's' : ''}`);
    }
  }
  lines.push('');

  // By agent
  lines.push('By Agent:');
  // Iterate over each agent breakdown entry to format its line
  for (const a of summary.byAgent) {
    lines.push(`  ${a.agents}: ${a.count} eval${a.count !== 1 ? 's' : ''}`);
  }
  lines.push('');

  // By difficulty
  lines.push('By Difficulty:');
  // Iterate over each difficulty level to output non-zero counts
  for (const d of ['easy', 'medium', 'hard'] as const) {
    if (summary.byDifficulty[d] > 0) {
      lines.push(`  ${d}: ${summary.byDifficulty[d]}`);
    }
  }
  lines.push('');

  // By origin
  lines.push('By Origin:');
  // Iterate over each origin type to output non-zero counts
  for (const o of ['real-incident', 'synthetic-seed'] as const) {
    if (summary.byOrigin[o] > 0) {
      lines.push(`  ${o}: ${summary.byOrigin[o]}`);
    }
  }

  // Parse errors
  if (summary.parseErrors.length > 0) {
    lines.push('');
    lines.push('Parse Errors:');
    // Iterate over each parse error to format its file and message
    for (const e of summary.parseErrors) {
      lines.push(`  ${e.file}: ${e.message}`);
    }
  }

  return lines.join('\n');
}

/** Format an eval summary as a JSON string with 2-space indentation */
export function formatSummaryJson(summary: EvalSummary): string {
  return JSON.stringify(summary, null, 2);
}
