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

const SKIP_FILES = new Set(['README.md', 'FORMAT.md']);

export function discoverEvalFiles(evalsDir: string): string[] {
  if (!existsSync(evalsDir)) return [];

  return readdirSync(evalsDir)
    .filter(f => f.endsWith('.md') && !SKIP_FILES.has(f))
    .sort();
}

export function loadEvals(evalsDir: string): {
  evals: ParsedEval[];
  errors: ParseError[];
} {
  const files = discoverEvalFiles(evalsDir);
  const evals: ParsedEval[] = [];
  const errors: ParseError[] = [];

  for (const file of files) {
    try {
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

export function summarize(evals: ParsedEval[], errors: ParseError[]): EvalSummary {
  const bySkillMap = new Map<string, { count: number; files: string[] }>();
  const byAgentMap = new Map<EvalAgents, { count: number; files: string[] }>();
  const byDifficulty: Record<EvalDifficulty, number> = {
    easy: 0,
    medium: 0,
    hard: 0,
  };
  const byOrigin: Record<EvalOrigin, number> = {
    'real-incident': 0,
    'synthetic-seed': 0,
  };

  for (const ev of evals) {
    const fm = ev.frontmatter;

    // Skill breakdown
    const skillKey = fm.skill ?? 'unassigned';
    const skillEntry = bySkillMap.get(skillKey) ?? { count: 0, files: [] };
    skillEntry.count++;
    skillEntry.files.push(ev.file);
    bySkillMap.set(skillKey, skillEntry);

    // Agent breakdown
    const agentEntry = byAgentMap.get(fm.agents) ?? { count: 0, files: [] };
    agentEntry.count++;
    agentEntry.files.push(ev.file);
    byAgentMap.set(fm.agents, agentEntry);

    // Difficulty
    byDifficulty[fm.difficulty]++;

    // Origin
    byOrigin[fm.origin]++;
  }

  const bySkill: SkillBreakdown[] = Array.from(bySkillMap.entries())
    .map(([skill, data]) => ({ skill, ...data }))
    .sort((a, b) => a.skill.localeCompare(b.skill));

  const byAgent: AgentBreakdown[] = Array.from(byAgentMap.entries())
    .map(([agents, data]) => ({ agents, ...data }))
    .sort((a, b) => String(a.agents).localeCompare(String(b.agents)));

  return {
    totalEvals: evals.length,
    bySkill,
    byAgent,
    byDifficulty,
    byOrigin,
    parseErrors: errors,
  };
}

export function formatSummaryText(summary: EvalSummary): string {
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
    for (const s of summary.bySkill) {
      lines.push(`  ${s.skill}: ${s.count} eval${s.count !== 1 ? 's' : ''}`);
    }
  }
  lines.push('');

  // By agent
  lines.push('By Agent:');
  for (const a of summary.byAgent) {
    lines.push(`  ${a.agents}: ${a.count} eval${a.count !== 1 ? 's' : ''}`);
  }
  lines.push('');

  // By difficulty
  lines.push('By Difficulty:');
  for (const d of ['easy', 'medium', 'hard'] as const) {
    if (summary.byDifficulty[d] > 0) {
      lines.push(`  ${d}: ${summary.byDifficulty[d]}`);
    }
  }
  lines.push('');

  // By origin
  lines.push('By Origin:');
  for (const o of ['real-incident', 'synthetic-seed'] as const) {
    if (summary.byOrigin[o] > 0) {
      lines.push(`  ${o}: ${summary.byOrigin[o]}`);
    }
  }

  // Parse errors
  if (summary.parseErrors.length > 0) {
    lines.push('');
    lines.push('Parse Errors:');
    for (const e of summary.parseErrors) {
      lines.push(`  ${e.file}: ${e.message}`);
    }
  }

  return lines.join('\n');
}

export function formatSummaryJson(summary: EvalSummary): string {
  return JSON.stringify(summary, null, 2);
}
