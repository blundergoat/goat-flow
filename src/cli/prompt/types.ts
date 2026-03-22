import type { AgentId, Tier } from '../types.js';

/** The three modes a composed prompt can operate in */
export type PromptMode = 'fix' | 'setup' | 'audit';
/** Phase a fragment belongs to: one of the scoring tiers or anti-pattern */
export type FragmentPhase = Tier | 'anti-pattern';

/** Whether a fragment creates new content or fixes existing content */
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

/** Options controlling prompt composition mode and target agent */
export interface PromptOptions {
  mode: PromptMode;
  agent: AgentId | null;
  selfContained: boolean;
}

/** A fully assembled prompt ready for rendering */
export interface ComposedPrompt {
  mode: PromptMode;
  agent: AgentId;
  title: string;
  preamble: string;
  sections: PromptSection[];
  summary: string;
}

/** A phase-grouped section within a composed prompt */
export interface PromptSection {
  phase: FragmentPhase;
  heading: string;
  fragments: ResolvedFragment[];
}

/** A fragment after template variables have been substituted */
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
