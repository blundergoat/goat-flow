/**
 * Shared type contracts for the goat-flow config file.
 * These interfaces describe the normalized shape used after YAML parsing and validation.
 */
interface GoatFlowToolchain {
  test: string[];
  lint: string[];
  build: string[];
  package: string[];
  format: string[];
}

/** Optional goat-review skill configuration. */
interface GoatReviewConfig {
  /** Local branch/ref to use before remote default-branch discovery in local PR reviews. */
  localPrBase: string;
}

/** Skill installation and per-skill configuration. */
interface GoatFlowSkillsConfig {
  install: string[] | "all";
  "goat-review"?: GoatReviewConfig;
}

/** Durable learning-loop directories that future automatic capture may target. */
export type LearningLoopAutoCaptureTarget =
  | "lessons"
  | "footguns"
  | "patterns"
  | "decisions";

/** Programmatic learning-loop capture policy; disabled until explicitly opted in. */
interface LearningLoopConfig {
  autoCapture: {
    enabled: boolean;
    targets: LearningLoopAutoCaptureTarget[];
  };
}

/** One togglable goat-flow hook entry from `.goat-flow/config.yaml`. */
type GoatFlowHookConfig = Record<"enabled", boolean>;

/** Optional plan-checkbox guard configuration. */
interface PlanGuardConfig {
  enabled: boolean;
  searchPaths: string[];
  maxDepth: number;
  stalenessDays: number;
  planFile: string | null;
}

/** Stable boolean keys retained because they mirror `.goat-flow/config.yaml`. */
type GoatFlowConfigBooleanFields = Record<"telemetry", boolean>;

/** Normalized config shape after parsing and validating .goat-flow/config.yaml. */
export interface GoatFlowConfig extends GoatFlowConfigBooleanFields {
  version: string;
  footguns: { path: string };
  lessons: { path: string };
  decisions: { path: string };
  plans: { path: string };
  /** Legacy normalized field retained for old tests/fixtures; new code uses `plans.path`. */
  tasks?: { path: string };
  logs: { path: string };
  /** Legacy field retained for old config shape compatibility; command scoping uses --agent. */
  agents: string[] | null;
  /** Which skills to install: explicit list or 'all' for the full set */
  skills: GoatFlowSkillsConfig;
  /** Instruction-file line limits: target for setup, hard limit for CI gate */
  lineLimits: { target: number; limit: number };
  /** Project commands grouped by purpose so agents stop guessing tool names */
  toolchain: GoatFlowToolchain;
  /** User role that controls read-only vs read-write mode */
  userRole: "developer" | "investigator" | "tester";
  /** Opt-in policy for future automatic lesson/footgun/pattern/decision capture. */
  learningLoop: LearningLoopConfig;
  /** Declared gaps that persist across sessions (e.g., "zero Python tests"). Readable by skills during Step 0. */
  knownGaps: string[];
  /** Placeholder for per-project skill customisation. */
  skillOverrides: Record<string, unknown>;
  /** Terminal settings for the dashboard embedded terminal */
  terminal: { idleTimeoutMinutes: number };
  /** Harness (AI Harness audit) configuration. */
  harness: {
    /** Advisory check ids the project has opted out of. Silenced checks render as `acknowledged` and do not affect concern status. */
    acknowledge: string[];
  };
  /** Project-wide toggles for goat-flow-shipped hook scripts. */
  hooks: Record<string, GoatFlowHookConfig>;
  /** Workflow-reminder Stop hook settings for active plan checkbox drift. */
  planGuard: PlanGuardConfig;
  /**
   * Raw skill-quality configuration block (parsed but not normalized here).
   * Consumed by `loadQualityConfig` in `src/cli/quality/quality-config.ts`,
   * which merges it with the goat-flow defaults.
   */
  quality?: Record<string, unknown>;
}

/** A single validation warning or error found during config parsing. */
export interface ValidationIssue {
  level: "warning" | "error";
  /** Dot-separated config key path where the issue was found */
  path: string;
  message: string;
}

/** Aggregate validation result with separated warning and error lists. */
export interface ValidationResult extends Record<"valid", boolean> {
  warnings: ValidationIssue[];
  errors: ValidationIssue[];
}

/** Complete loaded config state including existence, validation, and parsed values. */
export interface LoadedConfig extends Record<"valid", boolean> {
  /** Whether .goat-flow/config.yaml was found on disk */
  exists: boolean;
  /** Parsed and defaulted config values (always populated, even if file is missing) */
  config: GoatFlowConfig;
  warnings: ValidationIssue[];
  errors: ValidationIssue[];
  /** Raw YAML parse error message, or null if parsing succeeded */
  parseError: string | null;
}
