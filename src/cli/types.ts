// === Agent Types ===

export type AgentId = 'claude' | 'codex' | 'gemini';
export type Tier = 'foundation' | 'standard' | 'full';
export type CheckStatus = 'pass' | 'partial' | 'fail' | 'na';
export type Confidence = 'high' | 'medium' | 'low';
export type Grade = 'A' | 'B' | 'C' | 'D' | 'F' | 'insufficient-data';

// === Agent Profile ===

export interface AgentProfile {
  id: AgentId;
  name: string;
  instructionFile: string;
  settingsFile: string | null;
  skillsDir: string;
  hooksDir: string | null;
  denyMechanism: DenyMechanism;
  localPattern: string;
  hookEvents: HookEvents;
}

export type DenyMechanism =
  | { type: 'settings-deny'; path: string }
  | { type: 'deny-script'; path: string }
  | { type: 'both'; settingsPath: string; scriptPath: string };

export interface HookEvents {
  preTool: string;
  postTool: string;
  postTurn: string;
}

// === Detection (discriminated union — each variant carries only its required fields) ===

export type Detection =
  | { type: 'file_exists'; path: string }
  | { type: 'dir_exists'; path: string }
  | { type: 'grep'; path: string; pattern: string; section?: string }
  | { type: 'grep_count'; path: string; pattern: string; min: number; section?: string }
  | { type: 'line_count'; path: string; pass?: number; partial?: number; fail?: number }
  | { type: 'json_valid'; path: string }
  | { type: 'json_contains'; path: string; field: string; pattern?: string }
  | { type: 'count_items'; path: string; pattern: string; pass: number; partial?: number; section?: string }
  | { type: 'composite'; checks: Detection[]; mode: 'all' | 'any' }
  | { type: 'custom'; fn: (ctx: FactContext) => CheckResult };

// === Check Definition ===

export interface CheckDef {
  id: string;
  name: string;
  tier: Tier;
  category: string;
  pts: number;
  partialPts?: number;
  detect: Detection;
  na?: (ctx: FactContext) => boolean;
  recommendation: string;
  recommendationKey: string;
  confidence: Confidence;
}

export interface AntiPatternDef {
  id: string;
  name: string;
  deduction: number;
  evaluate: (ctx: FactContext) => AntiPatternResult;
  na?: (ctx: FactContext) => boolean;
  recommendation: string;
  recommendationKey: string;
  confidence: Confidence;
}

// === Check Results ===

export interface CheckResult {
  id: string;
  name: string;
  tier: Tier;
  category: string;
  status: CheckStatus;
  points: number;
  maxPoints: number;
  confidence: Confidence;
  message: string;
  evidence?: string;
  recommendationKey?: string;
}

export interface AntiPatternResult {
  id: string;
  name: string;
  triggered: boolean;
  deduction: number;
  confidence: Confidence;
  message: string;
  evidence?: string;
  recommendationKey?: string;
}

// === Facts ===

export interface ProjectFacts {
  root: string;
  stack: StackInfo;
  agents: AgentFacts[];
  shared: SharedFacts;
}

export interface StackInfo {
  languages: string[];
  buildCommand: string | null;
  testCommand: string | null;
  lintCommand: string | null;
  formatCommand: string | null;
}

export interface SharedFacts {
  footguns: { exists: boolean; hasEvidence: boolean; dirMentions: Map<string, number> };
  lessons: { exists: boolean; hasEntries: boolean };
  architecture: { exists: boolean; lineCount: number };
  evals: { dirExists: boolean; count: number; hasReadme: boolean; hasOriginLabels: boolean; hasReplayPrompts: boolean; evalSkillCount: number };
  ci: { workflowExists: boolean; checksLineCount: boolean; checksRouter: boolean; checksSkills: boolean; ciTriggersOnPRs: boolean };
  handoffTemplate: { exists: boolean };
  ignoreFiles: { copilotignore: boolean; cursorignore: boolean; geminiignore: boolean };
  gitignore: { exists: boolean; hasRequiredEntries: boolean };
  guidelinesOwnership: { exists: boolean };
  domainReference: { exists: boolean };
  preflightScript: { exists: boolean };
  changelog: { exists: boolean };
  localInstructions: {
    dirExists: boolean;
    location: 'ai' | 'github' | null;
    fileCount: number;
    hasRouter: boolean;
    hasConventions: boolean;
    conventionsHasContent: boolean;
    hasFrontend: boolean;
    hasBackend: boolean;
    hasCodeReview: boolean;
    hasGitCommit: boolean;
  };
  gitCommitInstructions: { exists: boolean };
}

export interface AgentFacts {
  agent: AgentProfile;
  instruction: {
    exists: boolean;
    content: string | null;
    lineCount: number;
    sections: Map<string, string>;
  };
  settings: {
    exists: boolean;
    valid: boolean;
    parsed: unknown | null;
    hasDenyPatterns: boolean;
  };
  skills: {
    found: string[];
    missing: string[];
    allPresent: boolean;
    quality: {
      withStep0: number;
      withHumanGate: number;
      withConstraints: number;
      withPhases: number;
      withConversational: number;
      withChaining: number;
      withChoices: number;
      withOutputFormat: number;
      total: number;
    };
  };
  hooks: {
    denyExists: boolean;
    denyHasBlocks: boolean;
    denyUsesJq: boolean;
    denyHandlesChaining: boolean;
    denyBlocksRmRf: boolean;
    denyBlocksForcePush: boolean;
    denyBlocksChmod: boolean;
    postTurnExists: boolean;
    postTurnExitsZero: boolean;
    postTurnHasValidation: boolean;
    postToolExists: boolean;
    compactionHookExists: boolean;
    readDenyCoversSecrets: boolean;
  };
  deny: {
    gitCommitBlocked: boolean;
    gitPushBlocked: boolean;
  };
  router: {
    exists: boolean;
    paths: string[];
    resolved: number;
    unresolved: string[];
  };
  askFirst: {
    exists: boolean;
    paths: string[];
    resolved: number;
    unresolved: string[];
  };
  localContext: {
    files: string[];
    warranted: string[];
    missing: string[];
  };
}

export interface FactContext {
  facts: ProjectFacts;
  agentFacts: AgentFacts;
}

// === Scoring ===

export interface TierScore {
  tier: Tier;
  earned: number;
  available: number;
  percentage: number;
}

export interface ScoreSummary {
  earned: number;
  available: number;
  deductions: number;
  percentage: number;
  grade: Grade;
  tiers: {
    foundation: TierScore;
    standard: TierScore;
    full: TierScore;
  };
}

export interface Recommendation {
  priority: 'critical' | 'high' | 'medium' | 'low';
  checkId: string;
  category: string;
  message: string;
  action: string;
  key: string;
}

// === Report ===

export interface AgentReport {
  agent: AgentId;
  agentName: string;
  score: ScoreSummary;
  checks: CheckResult[];
  antiPatterns: AntiPatternResult[];
  recommendations: Recommendation[];
}

export interface ScanReport {
  schemaVersion: string;
  packageVersion: string;
  rubricVersion: string;
  target: string;
  stack: StackInfo;
  agents: AgentReport[];
  meta: {
    checkCount: number;
    antiPatternCount: number;
    timestamp: string;
  };
}

// === Filesystem Abstraction ===

export interface ReadonlyFS {
  exists(path: string): boolean;
  readFile(path: string): string | null;
  lineCount(path: string): number;
  readJson(path: string): unknown | null;
  listDir(path: string): string[];
  isExecutable(path: string): boolean;
  glob(pattern: string): string[];
}

// === CLI Options ===

export interface CLIOptions {
  projectPath: string;
  format: 'json' | 'text';
  agent: AgentId | null;
  verbose: boolean;
  minScore: number | null;
  minGrade: Grade | null;
  help: boolean;
  version: boolean;
}
