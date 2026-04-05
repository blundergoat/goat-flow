/**
 * Core shared types for goat-flow.
 * This file defines the scanner's domain model so detection, scoring, rendering, and tests all speak the same contracts.
 */
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

// === Detection (discriminated union - each variant carries only its required fields) ===

/**
 * Discriminated union describing how a rubric check detects pass/fail.
 * Each variant maps to a different detection strategy in the scan engine.
 */
export type Detection =
  | { type: 'file_exists'; path: string }
  | { type: 'dir_exists'; path: string }
  | { type: 'grep'; path: string; pattern: string; section?: string }
  | {
      type: 'grep_count';
      path: string;
      pattern: string;
      min: number;
      partial?: number;
      section?: string;
    }
  | {
      type: 'line_count';
      path: string;
      pass?: number;
      partial?: number;
      fail?: number;
    }
  | { type: 'json_valid'; path: string }
  | { type: 'json_contains'; path: string; field: string; pattern?: string }
  | {
      type: 'count_items';
      path: string;
      pattern: string;
      pass: number;
      partial?: number;
      section?: string;
    }
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
  // Grading priority: required checks gate the letter grade, recommended improve it, optional are bonus
  priority: 'required' | 'recommended' | 'optional';
  // If true, check runs and contributes to score but doesn't appear in scanner output
  hidden?: boolean;
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
  // If true, check ran but should not appear in scanner output
  hidden?: boolean;
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
  /** Approximate count of source files (excludes node_modules, vendor, dist, .git) */
  sourceFileCount: number;
  /** Extended project signals detected during setup-time analysis */
  signals: ProjectSignals;
}

/** Extended detection signals for richer setup prompts (M03.3) */
export interface ProjectSignals {
  /** Code generation tools found (sqlc, Hygen, protobuf, openapi-generator) */
  codeGenTools: string[];
  /** Deployment/infrastructure platforms found (amplify, terraform, docker, fly, vercel) */
  deployPlatforms: string[];
  /** LLM integration signals (model provider env vars, SDK imports) */
  llmIntegration: boolean;
  /** Static analysis tools with detected strictness level */
  staticAnalysis: Array<{ tool: string; level: string | null }>;
  /** PHI/compliance keywords detected in docs or instructions */
  complianceSignals: boolean;
  /** Formatter coverage: languages with detected formatters vs languages without */
  formatterGaps: string[];
}

/** Facts shared across all agents (project-wide files and directories) */
export interface SharedFacts {
  footguns: {
    exists: boolean;
    committedExists: boolean;
    localExists: boolean;
    hasEvidence: boolean;
    entryCount: number;
    committedCount: number;
    localCount: number;
    labelCount: number;
    hasEvidenceLabels: boolean;
    dirMentions: Map<string, number>;
    staleRefs: string[];
    invalidLineRefs: string[];
    duplicateSurfacePaths: string[];
    totalRefs: number;
    validRefs: number;
    formatDiagnostic: string | null;
    paths: { committed: string; local: string };
  };
  lessons: {
    exists: boolean;
    committedExists: boolean;
    localExists: boolean;
    hasEntries: boolean;
    entryCount: number;
    committedCount: number;
    localCount: number;
    staleRefs: string[];
    duplicateSurfacePaths: string[];
    formatDiagnostic: string | null;
    paths: { committed: string; local: string };
  };
  decisions: {
    dirExists: boolean;
    fileCount: number;
    path: string;
    hasRealContent: boolean;
  };
  config: {
    exists: boolean;
    valid: boolean;
    warningCount: number;
    errorCount: number;
    parseError: string | null;
    lineLimits: { target: number; limit: number };
    configLocalExists: boolean;
    userRole: 'developer' | 'investigator' | 'tester';
  };
  architecture: { exists: boolean; lineCount: number };
  evals: {
    dirExists: boolean;
    count: number;
    hasReadme: boolean;
    hasOriginLabels: boolean;
    hasAgentsLabels: boolean;
    hasReplayPrompts: boolean;
    hasRealContent: boolean;
    hasFrontmatter: boolean;
    evalSkillCount: number;
    missingSkills: string[];
    path: string;
  };
  ci: {
    workflowExists: boolean;
    checksLineCount: boolean;
    checksRouter: boolean;
    checksSkills: boolean;
    ciTriggersOnPRs: boolean;
  };
  handoffTemplate: {
    exists: boolean;
    sectionCount: number;
    hasRequiredSections: boolean;
  };
  ignoreFiles: {
    copilotignore: boolean;
    cursorignore: boolean;
    geminiignore: boolean;
  };
  gitignore: { exists: boolean; hasRequiredEntries: boolean };
  guidelinesOwnership: { exists: boolean };
  domainReference: { exists: boolean };
  preflightScript: { exists: boolean };
  // changelog removed - project-level concern, not AI workflow.
  localInstructions: {
    dirExists: boolean;
    // Which directory convention is used: ai/ or .github/
    location: 'ai' | 'github' | null;
    aiDirExists: boolean;
    githubDirExists: boolean;
    duplicateSurfacePaths: string[];
    fileCount: number;
    hasRouter: boolean;
    hasValidRouter: boolean;
    routerNeedsFix: string | null;
    hasConventions: boolean;
    conventionsHasContent: boolean;
    hasFrontend: boolean;
    hasBackend: boolean;
    hasCodeReview: boolean;
    hasGitCommit: boolean;
    conventionsContent: string | null;
    localFileSizes: Array<{ path: string; lines: number }>;
    path: string;
  };
  gitCommitInstructions: { exists: boolean };
  /** Total line count across ai-docs/coding-standards/ files (cold-path budget) */
  aiInstructionsLineCount: number;
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
  // settingsLocal removed - personal preference file, not a project quality signal.
  skills: {
    /** All skill directories present under the agent's skills dir that contain a SKILL.md file */
    installedDirs: string[];
    found: string[];
    missing: string[];
    allPresent: boolean;
    /** Map from skill name to its embedded goat-flow-skill-version (null if missing) */
    versions: Record<string, string | null>;
    /** Number of skills with a version older than the current SKILL_VERSION */
    outdatedCount: number;
    /** Whether the goat dispatcher skill is installed */
    hasDispatcher: boolean;
    /** Dangling file path references found in skill content */
    danglingRefs: string[];
    quality: {
      withStep0: number;
      withHumanGate: number;
      withConstraints: number;
      withPhases: number;
      withConversational: number;
      withChaining: number;
      withChoices: number;
      withOutputFormat: number;
      withSharedConventions: number;
      /** Number of malformed (unclosed) markdown fence blocks across all skill files */
      malformedFenceCount: number;
      /** Skills where Step 0 Jaccard similarity to template > 0.9 (unadapted) */
      unadaptedCount: number;
      /** Total remaining <!-- ADAPT: --> comments across all skill files */
      adaptCommentCount: number;
      // Total number of skill files evaluated
      total: number;
    };
  };
  hooks: {
    denyExists: boolean;
    denyHasBlocks: boolean;
    /** True when deny is via settings.json patterns or Codex execpolicy (not a shell script). jq/chaining checks are N/A for config-based deny. */
    denyIsConfigBased: boolean;
    denyUsesJq: boolean;
    denyHandlesChaining: boolean;
    denyBlocksRmRf: boolean;
    denyBlocksForcePush: boolean;
    denyBlocksChmod: boolean;
    denyBlocksPipeToShell: boolean;
    denyBlocksCloudDestructive: boolean;
    postTurnExists: boolean;
    postTurnRegistered: boolean;
    postTurnRegisteredPath: string | null;
    postTurnExitsZero: boolean;
    postTurnHasValidation: boolean;
    postTurnSwallowsFailures: boolean;
    postToolRegistered: boolean;
    postToolRegisteredPath: string | null;
    postToolExists: boolean;
    postToolUsesExpectedPathField: boolean;
    postToolSkipsAgentConfigPaths: boolean;
    compactionHookExists: boolean;
    /** Hook scripts containing hardcoded absolute paths (not wrapped in $(git rev-parse)) */
    absolutePathHooks: string[];
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
    hasMarkers: boolean;
    markerPaths: string[];
    staleMarkerPaths: string[];
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
  // Priority-based grading counters (excludes N/A checks)
  requiredPassed: number;
  requiredTotal: number;
  recommendedPassed: number;
  recommendedTotal: number;
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
    versions: {
      schema: string;
      package: string;
      rubric: string;
    };
    config: { exists: boolean; valid: boolean };
    learningLoop: {
      footguns: { committed: number; local: number };
      lessons: { committed: number; local: number };
    };
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
  format: 'json' | 'text' | 'html' | 'markdown';
  // Null means scan all detected agents
  agent: AgentId | null;
  verbose: boolean;
  // Fail the process if score is below this threshold
  minScore: number | null;
  // Fail the process if grade is below this threshold
  minGrade: Grade | null;
  // Write output to a file instead of stdout
  output: string | null;
  // Show prioritized setup guidance instead of scores
  guide: boolean;
  // Enable live reload for dashboard development
  dev: boolean;
  help: boolean;
  version: boolean;
}
