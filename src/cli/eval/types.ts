// === Eval Types ===

import type { AgentId } from '../types.js';

export type EvalOrigin = 'real-incident' | 'synthetic-seed';
export type EvalAgents = 'all' | AgentId;
export type EvalDifficulty = 'easy' | 'medium' | 'hard';
export type EvalSkill =
  | 'goat-debug'
  | 'goat-audit'
  | 'goat-review'
  | 'goat-investigate'
  | 'goat-plan'
  | 'goat-test'
  | 'goat-security'
  | 'goat-reflect'
  | 'goat-onboard'
  | 'goat-resume';

export type GateStatus = 'pass' | 'fail';

// === Parsed Eval ===

export interface EvalFrontmatter {
  name: string;
  description: string;
  origin: EvalOrigin;
  agents: EvalAgents;
  skill: EvalSkill | null;
  difficulty: EvalDifficulty;
}

export interface BehavioralGate {
  text: string;
  status: GateStatus;
}

export interface ParsedEval {
  file: string;
  frontmatter: EvalFrontmatter;
  scenario: string;
  expectedBehaviors: BehavioralGate[];
  antiPatterns: string[];
}

// === Eval Results ===

export interface EvalScore {
  passed: number;
  total: number;
  percentage: number;
}

export interface EvalResult {
  eval: ParsedEval;
  score: EvalScore;
}

export interface SkillBreakdown {
  skill: string;
  count: number;
  files: string[];
}

export interface AgentBreakdown {
  agents: EvalAgents;
  count: number;
  files: string[];
}

export interface EvalSummary {
  totalEvals: number;
  bySkill: SkillBreakdown[];
  byAgent: AgentBreakdown[];
  byDifficulty: Record<EvalDifficulty, number>;
  byOrigin: Record<EvalOrigin, number>;
  parseErrors: ParseError[];
}

export interface ParseError {
  file: string;
  message: string;
}
