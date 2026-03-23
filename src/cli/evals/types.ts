// === Eval Types ===

import type { AgentId } from '../types.js';
import type { SkillName } from '../constants.js';

/** Origin of the eval scenario: real incident or synthetically generated */
export type EvalOrigin = 'real-incident' | 'synthetic-seed';

/** Target agent scope for the eval: all agents or a specific agent */
export type EvalAgents = 'all' | AgentId;

/** Difficulty level of the eval scenario */
export type EvalDifficulty = 'easy' | 'medium' | 'hard';

/** Recognized GOAT Flow skill identifiers that evals can target */
export type EvalSkill = SkillName;

/** Pass or fail status for a single behavioral gate check */
export type GateStatus = 'pass' | 'fail';

// === Parsed Eval ===

/** Structured metadata extracted from the eval file's frontmatter block */
export interface EvalFrontmatter {
  name: string;
  description: string;
  origin: EvalOrigin;
  agents: EvalAgents;
  skill: EvalSkill | null;
  difficulty: EvalDifficulty;
}

/** A single expected-behavior checkpoint with its pass/fail status */
export interface BehavioralGate {
  text: string;
  status: GateStatus;
}

/** Fully parsed eval file with frontmatter, scenario, gates, and anti-patterns */
export interface ParsedEval {
  file: string;
  frontmatter: EvalFrontmatter;
  scenario: string;
  expectedBehaviors: BehavioralGate[];
  antiPatterns: string[];
}

// === Eval Results ===

/** Numeric score for an eval run (passed count, total, and percentage) */
export interface EvalScore {
  passed: number;
  total: number;
  percentage: number;
}

/** Result of running a single eval, pairing the parsed eval with its score */
export interface EvalResult {
  eval: ParsedEval;
  score: EvalScore;
}

/** Summary of evals grouped by a single skill */
export interface SkillBreakdown {
  skill: string;
  count: number;
  files: string[];
}

/** Summary of evals grouped by a single agent target */
export interface AgentBreakdown {
  agents: EvalAgents;
  count: number;
  files: string[];
}

/** Aggregated eval summary with breakdowns by skill, agent, difficulty, and origin */
export interface EvalSummary {
  totalEvals: number;
  bySkill: SkillBreakdown[];
  byAgent: AgentBreakdown[];
  byDifficulty: Record<EvalDifficulty, number>;
  byOrigin: Record<EvalOrigin, number>;
  parseErrors: ParseError[];
}

/** Record of a file that failed to parse, with the error message */
export interface ParseError {
  file: string;
  message: string;
}
