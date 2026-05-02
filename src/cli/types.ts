/**
 * Core shared types for goat-flow.
 */
// === Agent Types ===

/** Canonical supported AI coding agent identifiers in stable display order. */
export const KNOWN_AGENT_IDS = [
  "claude",
  "codex",
  "gemini",
  "copilot",
] as const;

/** Supported AI coding agent identifiers derived from the canonical tuple. */
export type AgentId = (typeof KNOWN_AGENT_IDS)[number];

// === Agent Profile ===

/**
 * Describes an agent's file layout and enforcement mechanisms.
 * One profile per supported agent (Claude, Codex, Gemini, Copilot).
 */
export interface AgentProfile {
  id: AgentId;
  name: string;
  instructionFile: string;
  // Null when the agent has no JSON settings mechanism (e.g., Codex)
  settingsFile: string | null;
  // File that stores hook registrations when it differs from settingsFile.
  hookConfigFile: string | null;
  skillsDir: string;
  // Null when the agent has no hook directory
  hooksDir: string | null;
  denyMechanism: DenyMechanism;
  // Null when the agent has no on-disk deny hook script.
  denyHookFile: string | null;
  // Glob pattern for agent-specific local instruction files
  localPattern: string;
  hookEvents: HookEvents;
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
  // Null when the runtime exposes no post-turn hook event.
  postTurn: string | null;
}

// === Facts ===

/** Top-level fact container gathered by the fact extractors */
export interface ProjectFacts {
  // Absolute path to the project root
  root: string;
  stack: StackInfo;
  // One entry per detected agent (Claude, Codex, Gemini, Copilot)
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

/** Facts shared across all agents (project-wide files and directories) */
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
    geminiignore: boolean;
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
    /** True when the Bash deny hook script has pattern coverage for secret-bearing
     *  file reads (.env, /.ssh/, /.aws/, .pem/.key/.pfx). Settings.json Read()
     *  denies do not cover Bash commands, so this check is the only line of
     *  defence against shell-based secret exfil. */
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
  existsGlob(pattern: string): boolean;
}

// === CLI Options ===

/** Parsed command-line arguments for the goat-flow CLI */
export interface CLIOptions {
  projectPath: string;
  format: "json" | "text" | "markdown";
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
