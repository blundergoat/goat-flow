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

/**
 * A single actionable task in a setup prompt.
 * Bridges TemplateRef (what file to create from what template) with
 * Fragment (adaptation guidance and fix instructions).
 */
export interface SetupTask {
  /** Display number within the phase, e.g., "1", "2" */
  num: number;
  /** File to create or fix in the target project */
  outputPath: string;
  /** Absolute path to the goat-flow template to read */
  templatePath: string;
  /** Project-specific adaptation guidance */
  adapt: string;
  /** Concrete verification step */
  verify: string;
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
  /**
   * Scan evidence keyed by recommendation key — populated from check/AP results
   * so fragments can include specific details (stale refs, bloat patterns, etc.)
   */
  evidence: Record<string, string>;
}
