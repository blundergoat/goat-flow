/**
 * Core shared types for goat-flow.
 */
// === Agent Types ===

/** Canonical supported AI coding agent identifiers in stable display order. */
export const KNOWN_AGENT_IDS = [
  "claude",
  "codex",
  "antigravity",
  "copilot",
] as const;

/** Supported AI coding agent identifiers derived from the canonical tuple. */
export type AgentId = (typeof KNOWN_AGENT_IDS)[number];

// === Agent Profile ===

/** Prompt invocation syntax an agent expects for goat-flow skills. */
type PromptInvocationStyle = "slash" | "dollar";

/** Skill mirror/source classification used by quality inventory. */
type SkillSource = "installed" | "agent-mirror" | "github-mirror";

/**
 * Describes an agent's file layout and enforcement mechanisms.
 * One profile per supported agent (Claude, Codex, Antigravity, Copilot).
 *
 * `denyMechanism` and `hookEvents` are nullable to model agents whose upstream
 * runtime has no project-local hook wiring for a given capability; consumers
 * MUST guard for the null case.
 */
export interface AgentProfile {
  id: AgentId;
  name: string;
  instructionFile: string;
  terminalBinary: string;
  setupSurfaces: string[];
  promptInvocationStyle: PromptInvocationStyle;
  skillSource: SkillSource;
  supportsPostTurnHook: boolean;
  // Null when the agent has no JSON settings mechanism (e.g., Codex)
  settingsFile: string | null;
  // File that stores hook registrations when it differs from settingsFile.
  hookConfigFile: string | null;
  skillsDir: string;
  // Null when the agent has no hook directory
  hooksDir: string | null;
  // Null when the agent has no documented project-local deny mechanism.
  denyMechanism: DenyMechanism | null;
  // Null when the agent has no on-disk deny hook script.
  denyHookFile: string | null;
  // Glob pattern for agent-specific local instruction files
  localPattern: string;
  // Null when the agent has no documented project-local hook-event names.
  hookEvents: HookEvents | null;
}

/**
 * Discriminated union for how an agent enforces command denials.
 * Agents may use settings-based deny, a deny script, or both.
 */
export type DenyMechanism =
  | { type: "settings-deny"; path: string }
  | { type: "deny-script"; path: string }
  | { type: "both"; settingsPath: string; scriptPath: string };

/** Hook event file names specific to each agent runtime */
interface HookEvents {
  preTool: string;
  // Null when goat-flow does not map a project-specific post-turn validation hook event.
  postTurn: string | null;
}

// === Facts ===

/** Top-level fact container gathered by the fact extractors */
export interface ProjectFacts {
  // Absolute path to the project root
  root: string;
  stack: StackInfo;
  // One entry per detected agent (Claude, Codex, Antigravity, Copilot)
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

/** Per-bucket learning-loop freshness + health record used by `goat-flow stats`. */
export interface BucketFreshness {
  /** Relative path of the bucket file */
  path: string;
  /** `last_reviewed` date from frontmatter in YYYY-MM-DD form, or null if missing/invalid */
  lastReviewed: string | null;
  /** Whole days between last_reviewed and "now"; null when lastReviewed is unknown */
  freshnessDays: number | null;
  /** Freshness band: <=30d fresh, 31-90d aging, >90d stale, unknown if no valid date */
  freshnessBand: "fresh" | "aging" | "stale" | "unknown";
  /** Entries counted live in this bucket (## Footgun/Lesson/Pattern headings) */
  entryCount: number;
  /** Stale file refs found in this bucket */
  staleRefs: string[];
  /** Invalid line refs (line out of bounds or missing semantic anchor) found in this bucket */
  invalidLineRefs: string[];
  /** Most recent `**Created:**` or `**Updated:**` date in the body, YYYY-MM-DD or null.
   *  Used to detect frontmatter `last_reviewed` that is stale relative to entry dates. */
  maxEntryDate: string | null;
  /** File content size in bytes. Used by `goat-flow stats --check` for bucket-size warnings. */
  sizeBytes: number;
  /** Total line count of the bucket file. */
  lineCount: number;
}

/** Learning-loop artifact kinds in the order the retrieval and stats pipelines understand. */
export type LearningLoopEntryKind =
  | "footgun"
  | "lesson"
  | "pattern"
  | "decision";

/** Compact parsed learning-loop entry used by bounded prompt retrieval. */
export interface LearningLoopEntryFact {
  sourcePath: string;
  kind: LearningLoopEntryKind;
  title: string;
  status: "active" | "resolved" | null;
  created: string | null;
  updated: string | null;
  resolved: string | null;
  excerpt: string;
  staleRefs: string[];
  invalidLineRefs: string[];
  hasValidAnchor: boolean;
  bucketSizeBytes: number;
  order: number;
}

/** Stable project-wide fact schema shared by audits, stats, setup prompts, and dashboard APIs. */
export interface SharedFacts {
  footguns: {
    exists: boolean;
    hasEvidence: boolean;
    entryCount: number;
    labelCount: number;
    hasEvidenceLabels: boolean;
    dirMentions: Map<string, number>;
    staleRefs: string[];
    invalidLineRefs: string[];
    duplicateSurfacePaths: string[];
    totalRefs: number;
    validRefs: number;
    formatDiagnostic: string | null;
    path: string;
    /** Per-bucket freshness records; empty when the directory is missing. */
    buckets: BucketFreshness[];
  };
  lessons: {
    exists: boolean;
    hasEntries: boolean;
    entryCount: number;
    staleRefs: string[];
    invalidLineRefs: string[];
    duplicateSurfacePaths: string[];
    formatDiagnostic: string | null;
    path: string;
    /** Per-bucket freshness records; empty when the directory is missing. */
    buckets: BucketFreshness[];
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
    userRole: "developer" | "investigator" | "tester";
  };
  architecture: { exists: boolean; lineCount: number };
  // evals removed - evals system removed in v1.1.0 (M09).
  // ci removed - CI workflow is a project-level concern.
  ignoreFiles: {
    copilotignore: boolean;
    cursorignore: boolean;
  };
  gitignore: { exists: boolean; hasRequiredEntries: boolean };
  preflightScript: { exists: boolean };
  skillConventions: { exists: boolean };
  // changelog removed - project-level concern, not AI workflow.
  localInstructions: {
    dirExists: boolean;
    // Which directory convention is used: ai/ or .github/
    location: "ai" | "github" | null;
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
  gitCommitInstructions: {
    exists: boolean;
    path: string | null;
    requiredPath: string;
    misplacedPaths: string[];
  };
  /** Total line count across canonical local-instruction files. */
  localInstructionsLineCount: number;
  /** Parsed entries for deterministic, bounded prompt retrieval. */
  learningLoopEntries: LearningLoopEntryFact[];
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
    quality: {
      withStep0: number;
      withHumanGate: number;
      withConstraints: number;
      withPhases: number;
      withConversational: number;
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
    /** True when deny is via settings.json patterns (not a shell script). jq/chaining checks are N/A for config-based deny. */
    denyIsConfigBased: boolean;
    denyUsesJq: boolean;
    denyHandlesChaining: boolean;
    denyBlocksRmRf: boolean;
    denyBlocksGitPush: boolean;
    denyBlocksChmod: boolean;
    denyBlocksPipeToShell: boolean;
    denyBlocksCloudDestructive: boolean;
    /** True when the deny hook is registered as a pre-tool-use hook in agent settings */
    denyIsRegistered: boolean;
    denyRegisteredPath: string | null;
    postTurnExists: boolean;
    postTurnRegistered: boolean;
    postTurnRegisteredPath: string | null;
    postTurnExecutable: boolean;
    postTurnExitsZero: boolean;
    postTurnHasValidation: boolean;
    postTurnSwallowsFailures: boolean;
    /** Hook scripts containing hardcoded absolute paths (not wrapped in $(git rev-parse)) */
    absolutePathHooks: string[];
    readDenyCoversSecrets: boolean;
    /** True when the Bash deny hook blocks direct literal secret-bearing paths
     *  (.env, /.ssh/, /.aws/, .pem/.key/.pfx). Settings/Codex permission
     *  file-read denies do not cover Bash commands, so this is direct-path
     *  defence in depth. */
    bashDenyCoversSecrets: boolean;
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
  localContext: {
    files: string[];
    // Files that should exist based on project stack
    warranted: string[];
    missing: string[];
  };
}

// === Filesystem Abstraction ===

/**
 * Stable read-only filesystem schema for the scan engine.
 * Allows swapping real FS for in-memory FS during testing while preserving non-throwing read semantics.
 */
export interface ReadonlyFS {
  /** Return path existence; implementations should report inaccessible paths as false. */
  exists(path: string): boolean;
  /** Read UTF-8 text or return null when the file is missing or unreadable. */
  readFile(path: string): string | null;
  /** Count text lines, returning 0 when the file cannot be read. */
  lineCount(path: string): number;
  /** Parse JSON defensively, returning null for missing, unreadable, or malformed files. */
  readJson(path: string): unknown;
  /** List child names; missing and unreadable directories intentionally return an empty list. */
  listDir(path: string): string[];
  /** Report whether a file can be executed by the current platform. */
  isExecutable(path: string): boolean;
  /** Expand goat-flow's small relative glob syntax into matching POSIX-shaped paths. */
  glob(pattern: string): string[];
  /** Check whether a glob has any match without requiring callers to materialize every path. */
  existsGlob(pattern: string): boolean;
}

// === CLI Options ===

/** Parsed command-line arguments for the goat-flow CLI */
export interface CLIOptions {
  projectPath: string;
  format: "json" | "text" | "markdown" | "sarif";
  // Null means scan all detected agents
  agent: AgentId | null;
  verbose: boolean;
  // Write output to a file instead of stdout
  output: string | null;
  // Enable live reload for dashboard development
  dev: boolean;
  help: boolean;
  version: boolean;
}
