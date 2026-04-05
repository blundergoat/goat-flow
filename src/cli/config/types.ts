/**
 * Shared type contracts for the goat-flow config file.
 * These interfaces describe the normalized shape used after YAML parsing and validation.
 */
/** Normalized config shape after parsing and validating .goat-flow/config.yaml. */
export interface GoatFlowConfig {
  version: string;
  footguns: { committed: string; local: string };
  lessons: { committed: string; local: string };
  decisions: { path: string };
  evals: { path: string };
  codingStandards: { path: string };
  tasks: { path: string };
  logs: { path: string };
  /** Detected agent IDs, or null if auto-detection should be used */
  agents: string[] | null;
  /** Which skills to install: explicit list or 'all' for the full set */
  skills: { install: string[] | 'all' };
  /** Instruction-file line limits: target for setup, hard limit for CI gate */
  lineLimits: { target: number; limit: number };
  /** User role that controls read-only vs read-write mode */
  userRole: 'developer' | 'investigator' | 'tester';
  /** Opt-in skill usage telemetry (logs invocations to .goat-flow/logs/skill-usage.jsonl) */
  telemetry: boolean;
}

/** A single validation warning or error found during config parsing. */
export interface ValidationIssue {
  level: 'warning' | 'error';
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
