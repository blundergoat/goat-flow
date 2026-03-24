// === Agent Types ===

/** Supported AI coding agent identifiers */
export type AgentId = 'claude' | 'codex' | 'gemini';

/** Rubric scoring tier, ordered from baseline to advanced */
export type Tier = 'foundation' | 'standard' | 'full';

/** Outcome status for a single rubric check */
export type CheckStatus = 'pass' | 'partial' | 'fail' | 'na';

/** Signal strength for how reliably a check can be evaluated */
export type Confidence = 'high' | 'medium' | 'low';

/** Letter grade derived from overall score percentage */
export type Grade = 'A' | 'B' | 'C' | 'D' | 'F' | 'insufficient-data';

// === Agent Profile ===

/**
 * Describes an agent's file layout and enforcement mechanisms.
 * One profile per supported agent (Claude, Codex, Gemini).
 */
export interface AgentProfile {
  id: AgentId;
  name: string;
  instructionFile: string;
  // Null when the agent has no JSON settings mechanism (e.g., Codex)
  settingsFile: string | null;
  skillsDir: string;
  // Null when the agent has no hook directory
  hooksDir: string | null;
  denyMechanism: DenyMechanism;
  // Glob pattern for agent-specific local instruction files
  localPattern: string;
  hookEvents: HookEvents;
}

/**
 * Discriminated union for how an agent enforces command denials.
 * Agents may use settings-based deny, a deny script, or both.
 */
export type DenyMechanism =
  | { type: 'settings-deny'; path: string }
  | { type: 'deny-script'; path: string }
  | { type: 'both'; settingsPath: string; scriptPath: string };

/** Hook event file names specific to each agent runtime */
export interface HookEvents {
  preTool: string;
  postTool: string;
  postTurn: string;
}

// === Detection (discriminated union — each variant carries only its required fields) ===

/**
 * Discriminated union describing how a rubric check detects pass/fail.
 * Each variant maps to a different detection strategy in the scan engine.
 */
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

/**
 * A single rubric check definition with scoring, detection, and recommendation.
 * Each check belongs to a tier and category for grouped reporting.
 */
export interface CheckDef {
  id: string;
  name: string;
  tier: Tier;
  category: string;
  // Points awarded on full pass
  pts: number;
  // Points awarded on partial pass (undefined means no partial credit)
  partialPts?: number;
  detect: Detection;
  // Returns true when the check does not apply to this project
  na?: (ctx: FactContext) => boolean;
  recommendation: string;
  // Stable key for deduplicating recommendations across checks
  recommendationKey: string;
  confidence: Confidence;
}

/**
 * An anti-pattern definition that applies point deductions.
 * Anti-patterns are evaluated after positive checks and reduce the total score.
 */
export interface AntiPatternDef {
  id: string;
  name: string;
  // Negative number representing the point penalty
  deduction: number;
  evaluate: (ctx: FactContext) => AntiPatternResult;
  // Returns true when the anti-pattern does not apply
  na?: (ctx: FactContext) => boolean;
  recommendation: string;
  recommendationKey: string;
  confidence: Confidence;
}

// === Check Results ===

/** Result of evaluating a single rubric check against a project */
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
  // File path or description pointing to what was found or missing
  evidence?: string;
  recommendationKey?: string;
}

/** Result of evaluating a single anti-pattern against a project */
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

/** Top-level fact container gathered by the scan engine before scoring */
export interface ProjectFacts {
  // Absolute path to the project root
  root: string;
  stack: StackInfo;
  // One entry per detected agent (Claude, Codex, Gemini)
  agents: AgentFacts[];
  shared: SharedFacts;
}

/** Detected build toolchain for the target project */
export interface StackInfo {
  languages: string[];
  buildCommand: string | null;
  testCommand: string | null;
  lintCommand: string | null;
  formatCommand: string | null;
}

/** Facts shared across all agents (project-wide files and directories) */
export interface SharedFacts {
  footguns: { exists: boolean; hasEvidence: boolean; dirMentions: Map<string, number>; staleRefs: string[]; totalRefs: number; validRefs: number };
  lessons: { exists: boolean; hasEntries: boolean; entryCount: number };
  decisions: { dirExists: boolean; fileCount: number };
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
    // Which directory convention is used: ai/ or .github/
    location: 'ai' | 'github' | null;
    fileCount: number;
    hasRouter: boolean;
    hasConventions: boolean;
    conventionsHasContent: boolean;
    hasFrontend: boolean;
    hasBackend: boolean;
    hasCodeReview: boolean;
    hasGitCommit: boolean;
    conventionsContent: string | null;
    localFileSizes: Array<{ path: string; lines: number }>;
  };
  gitCommitInstructions: { exists: boolean };
}

/** Per-agent facts gathered from instruction files, settings, skills, and hooks */
export interface AgentFacts {
  agent: AgentProfile;
  instruction: {
    exists: boolean;
    content: string | null;
    lineCount: number;
    // Map of lowercase heading text to section body content
    sections: Map<string, string>;
  };
  settings: {
    exists: boolean;
    valid: boolean;
    parsed: unknown;
    hasDenyPatterns: boolean;
  };
  settingsLocal: { exists: boolean; lineCount: number };
  askFirstEnforcement: { hasPathHook: boolean };
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
      // Total number of skill files evaluated
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
    // Files that should exist based on project stack
    warranted: string[];
    missing: string[];
  };
}

/** Binds project-wide facts with a specific agent's facts for check evaluation */
export interface FactContext {
  facts: ProjectFacts;
  agentFacts: AgentFacts;
}

// === Scoring ===

/** Score breakdown for a single rubric tier */
export interface TierScore {
  tier: Tier;
  earned: number;
  available: number;
  percentage: number;
}

/** Aggregate score summary across all tiers and anti-pattern deductions */
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

/** A prioritized action item generated from a failed or partial check */
export interface Recommendation {
  priority: 'critical' | 'high' | 'medium' | 'low';
  checkId: string;
  category: string;
  message: string;
  action: string;
  // Stable key for deduplication
  key: string;
}

// === Report ===

/** Scan results for a single agent within a project */
export interface AgentReport {
  agent: AgentId;
  agentName: string;
  score: ScoreSummary;
  checks: CheckResult[];
  antiPatterns: AntiPatternResult[];
  recommendations: Recommendation[];
}

/** Complete scan report covering all detected agents in a project */
export interface ScanReport {
  schemaVersion: string;
  packageVersion: string;
  rubricVersion: string;
  // Absolute path to the scanned project
  target: string;
  stack: StackInfo;
  agents: AgentReport[];
  meta: {
    checkCount: number;
    antiPatternCount: number;
    // ISO 8601 timestamp of when the scan completed
    timestamp: string;
  };
}

// === Filesystem Abstraction ===

/**
 * Read-only filesystem interface for the scan engine.
 * Allows swapping real FS for in-memory FS during testing.
 */
export interface ReadonlyFS {
  exists(path: string): boolean;
  readFile(path: string): string | null;
  lineCount(path: string): number;
  readJson(path: string): unknown;
  listDir(path: string): string[];
  isExecutable(path: string): boolean;
  glob(pattern: string): string[];
}

// === CLI Options ===

/** Parsed command-line arguments for the goat-flow scan command */
export interface CLIOptions {
  projectPath: string;
  format: 'json' | 'text';
  // Null means scan all detected agents; 'all' explicitly requests every agent
  agent: AgentId | 'all' | null;
  verbose: boolean;
  // Fail the process if score is below this threshold
  minScore: number | null;
  // Fail the process if grade is below this threshold
  minGrade: Grade | null;
  help: boolean;
  version: boolean;
}
