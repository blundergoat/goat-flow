import type { AgentId, Tier } from '../types.js';

export type PromptMode = 'fix' | 'setup' | 'audit';
export type FragmentPhase = Tier | 'anti-pattern';

export type FragmentKind = 'create' | 'fix';

export interface Fragment {
  /** Must match a CheckDef.recommendationKey or AntiPatternDef.recommendationKey */
  key: string;
  phase: FragmentPhase;
  category: string;
  /** 'create' = setup instruction, 'fix' = repair existing. Setup mode only emits 'create'. */
  kind: FragmentKind;
  /** Markdown instruction for the agent to execute */
  instruction: string;
  /** Agent-specific instruction overrides (replaces `instruction` for that agent) */
  agentOverrides?: Partial<Record<AgentId, string>>;
}

export interface PromptOptions {
  mode: PromptMode;
  agent: AgentId | null;
  selfContained: boolean;
}

export interface ComposedPrompt {
  mode: PromptMode;
  agent: AgentId;
  title: string;
  preamble: string;
  sections: PromptSection[];
  summary: string;
}

export interface PromptSection {
  phase: FragmentPhase;
  heading: string;
  fragments: ResolvedFragment[];
}

export interface ResolvedFragment {
  key: string;
  category: string;
  instruction: string;
}

/** Variables extracted from scan report for template substitution */
export interface PromptVariables {
  agentId: AgentId;
  agentName: string;
  instructionFile: string;
  settingsFile: string;
  skillsDir: string;
  hooksDir: string;
  languages: string;
  buildCommand: string;
  testCommand: string;
  lintCommand: string;
  formatCommand: string;
  grade: string;
  percentage: string;
  failedCount: string;
  passedCount: string;
  totalCount: string;
  date: string;
}
