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

/** Normalized config shape after parsing and validating .goat-flow/config.yaml. */
export interface GoatFlowConfig {
  version: string;
  footguns: { path: string };
  lessons: { path: string };
  decisions: { path: string };
  tasks: { path: string };
  logs: { path: string };
  /** Detected agent IDs, or null if auto-detection should be used */
  agents: string[] | null;
  /** Which skills to install: explicit list or 'all' for the full set */
  skills: GoatFlowSkillsConfig;
  /** Instruction-file line limits: target for setup, hard limit for CI gate */
  lineLimits: { target: number; limit: number };
  /** Project commands grouped by purpose so agents stop guessing tool names */
  toolchain: GoatFlowToolchain;
  /** User role that controls read-only vs read-write mode */
  userRole: "developer" | "investigator" | "tester";
  /** Opt-in skill usage telemetry (logs invocations to .goat-flow/logs/skill-usage.jsonl) */
  telemetry: boolean;
  /** Declared gaps that persist across sessions (e.g., "zero Python tests"). Readable by skills during Step 0. */
  knownGaps: string[];
  /** Placeholder for per-project skill customisation (M18). */
  skillOverrides: Record<string, unknown>;
  /** Terminal settings for the dashboard embedded terminal */
  terminal: { idleTimeoutMinutes: number };
  /** Harness (AI Harness audit) configuration. */
  harness: {
    /** Advisory check ids the project has opted out of. Silenced checks render as `acknowledged` and do not affect concern status. */
    acknowledge: string[];
  };
}

/** A single validation warning or error found during config parsing. */
export interface ValidationIssue {
  level: "warning" | "error";
  /** Dot-separated config key path where the issue was found */
  path: string;
  message: string;
}

/** Aggregate validation result with separated warning and error lists. */
export interface ValidationResult {
  valid: boolean;
  warnings: ValidationIssue[];
  errors: ValidationIssue[];
}

/** Complete loaded config state including existence, validation, and parsed values. */
export interface LoadedConfig {
  /** Whether .goat-flow/config.yaml was found on disk */
  exists: boolean;
  /** Whether the config passed all validation rules */
  valid: boolean;
  /** Parsed and defaulted config values (always populated, even if file is missing) */
  config: GoatFlowConfig;
  warnings: ValidationIssue[];
  errors: ValidationIssue[];
  /** Raw YAML parse error message, or null if parsing succeeded */
  parseError: string | null;
}
