/**
 * Loads and validates `.goat-flow/config.yaml`.
 * Owns defaults, schema-level validation, and the normalized `LoadedConfig` returned to scanners and prompt builders.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import type { ReadonlyFS } from '../types.js';
import { RUBRIC_VERSION } from '../rubric/version.js';
import type {
  GoatFlowConfig,
  LoadedConfig,
  ValidationIssue,
  ValidationResult,
} from './types.js';

/** Agent identifiers accepted in the config's `agents` field. */
const KNOWN_AGENTS = new Set(['claude', 'codex', 'gemini']);
/** Top-level config keys recognized by the validator (others trigger warnings). */
const KNOWN_TOP_LEVEL_KEYS = new Set([
  'version',
  'footguns',
  'lessons',
  'decisions',
  'evals',
  'coding-standards',
  'tasks',
  'logs',
  'agents',
  'skills',
  'line-limits',
  'userRole',
  'telemetry',
]);

/** Built-in default values used when config.yaml is missing or omits fields. */
export const CONFIG_DEFAULTS: GoatFlowConfig = {
  version: RUBRIC_VERSION,
  footguns: { committed: 'ai-docs/footguns/', local: '.goat-flow/footguns/' },
  lessons: { committed: 'ai-docs/lessons/', local: '.goat-flow/lessons/' },
  decisions: { path: 'ai-docs/decisions/' },
  evals: { path: 'ai-docs/evals/' },
  codingStandards: { path: 'ai-docs/coding-standards/' },
  tasks: { path: '.goat-flow/tasks/' },
  logs: { path: '.goat-flow/logs/' },
  agents: null,
  skills: { install: 'all' },
  lineLimits: { target: 120, limit: 150 },
  userRole: 'developer',
  telemetry: false,
};

/** Clone the default config object so callers can mutate it safely. */
function cloneDefaults(): GoatFlowConfig {
  return {
    version: CONFIG_DEFAULTS.version,
    footguns: { ...CONFIG_DEFAULTS.footguns },
    lessons: { ...CONFIG_DEFAULTS.lessons },
    decisions: { ...CONFIG_DEFAULTS.decisions },
    evals: { ...CONFIG_DEFAULTS.evals },
    codingStandards: { ...CONFIG_DEFAULTS.codingStandards },
    tasks: { ...CONFIG_DEFAULTS.tasks },
    logs: { ...CONFIG_DEFAULTS.logs },
    agents: CONFIG_DEFAULTS.agents,
    skills: { install: CONFIG_DEFAULTS.skills.install },
    lineLimits: { ...CONFIG_DEFAULTS.lineLimits },
    userRole: CONFIG_DEFAULTS.userRole,
    telemetry: CONFIG_DEFAULTS.telemetry,
  };
}

/** Narrow unknown config values to plain object records before field inspection. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    Array.isArray(value) === false
  );
}

/** Read raw config YAML from the project root or injected test filesystem. */
function readConfigText(projectRoot: string, fs?: ReadonlyFS): string | null {
  if (fs) return fs.readFile('.goat-flow/config.yaml');
  const path = join(projectRoot, '.goat-flow', 'config.yaml');
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf8');
}

/** Apply committed/local path overrides for a two-path config section. */
function mergePairPaths(
  value: unknown,
  target: { committed: string; local: string },
): void {
  if (!isRecord(value)) return;
  if (typeof value.committed === 'string') target.committed = value.committed;
  if (typeof value.local === 'string') target.local = value.local;
}

/** Apply a `path` override for a single-path config section. */
function mergeSinglePath(value: unknown, target: { path: string }): void {
  if (isRecord(value) && typeof value.path === 'string') {
    target.path = value.path;
  }
}

/** Apply a config version override when the raw value is valid. */
function mergeVersion(value: unknown, merged: GoatFlowConfig): void {
  if (typeof value === 'string') {
    merged.version = value;
  }
}

/** Apply an explicit agent allowlist or null auto-detect override. */
function mergeAgents(value: unknown, merged: GoatFlowConfig): void {
  if (value === null || Array.isArray(value)) {
    merged.agents = value as string[] | null;
  }
}

/** Apply the configured skill install policy. */
function mergeSkills(value: unknown, merged: GoatFlowConfig): void {
  if (!isRecord(value)) return;
  const { install } = value;
  if (install === 'all' || Array.isArray(install)) {
    merged.skills.install = install as string[] | 'all';
  }
}

/** Valid userRole values accepted in the config file. */
const KNOWN_USER_ROLES = new Set(['developer', 'investigator', 'tester']);

/** Apply a valid userRole override from the raw config. */
function mergeUserRole(value: unknown, merged: GoatFlowConfig): void {
  if (typeof value === 'string' && KNOWN_USER_ROLES.has(value)) {
    merged.userRole = value as GoatFlowConfig['userRole'];
  }
}

/** Apply positive line-limit overrides from the raw config. */
function mergeLineLimits(value: unknown, merged: GoatFlowConfig): void {
  if (!isRecord(value)) return;
  if (typeof value.target === 'number' && value.target > 0)
    merged.lineLimits.target = value.target;
  if (typeof value.limit === 'number' && value.limit > 0)
    merged.lineLimits.limit = value.limit;
}

/** Merge a validated raw config object on top of the built-in defaults. */
function mergeConfig(raw: unknown): GoatFlowConfig {
  const merged = cloneDefaults();
  if (!isRecord(raw)) return merged;

  mergeVersion(raw.version, merged);
  mergePairPaths(raw.footguns, merged.footguns);
  mergePairPaths(raw.lessons, merged.lessons);
  mergeSinglePath(raw.decisions, merged.decisions);
  mergeSinglePath(raw.evals, merged.evals);

  // YAML key is `coding-standards` (kebab-case), TypeScript field is `codingStandards` (camelCase)
  mergeSinglePath(raw['coding-standards'], merged.codingStandards);
  mergeSinglePath(raw.tasks, merged.tasks);
  mergeSinglePath(raw.logs, merged.logs);
  mergeAgents(raw.agents, merged);
  mergeSkills(raw.skills, merged);

  // YAML key is `line-limits` (kebab-case), TypeScript field is `lineLimits` (camelCase)
  mergeLineLimits(raw['line-limits'], merged);
  mergeUserRole(raw.userRole, merged);
  if (typeof raw.telemetry === 'boolean') merged.telemetry = raw.telemetry;

  return merged;
}

/** Append a config validation error with its source path. */
function pushError(
  errors: ValidationIssue[],
  path: string,
  message: string,
): void {
  errors.push({ level: 'error', path, message });
}

/** Append a config validation warning with its source path. */
function pushWarning(
  warnings: ValidationIssue[],
  path: string,
  message: string,
): void {
  warnings.push({ level: 'warning', path, message });
}

/** Require a non-empty string wherever the schema expects a path value. */
function validateStringPath(
  value: unknown,
  path: string,
  errors: ValidationIssue[],
): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    pushError(errors, path, 'must be a non-empty string');
  }
}

/** Shorthand for a loosely-typed parsed YAML config object. */
type RawConfig = Record<string, unknown>;
/** Signature for a single config field validator function. */
type ConfigValidator = (
  raw: RawConfig,
  warnings: ValidationIssue[],
  errors: ValidationIssue[],
) => void;

/** Warn when the config contains top-level keys the scanner does not understand. */
function validateUnknownTopLevelKeys(
  raw: RawConfig,
  warnings: ValidationIssue[],
): void {
  for (const key of Object.keys(raw)) {
    if (!KNOWN_TOP_LEVEL_KEYS.has(key)) {
      pushWarning(warnings, key, 'unknown top-level key');
    }
  }
}

/** Validate that an optional top-level field is an object before inspecting nested keys. */
function validateObjectField(
  raw: RawConfig,
  key: string,
  errors: ValidationIssue[],
  onValid: (value: RawConfig) => void,
): void {
  if (!(key in raw)) return;
  const value = raw[key];
  if (!isRecord(value)) {
    pushError(errors, key, 'must be an object');
    return;
  }
  onValid(value);
}

/** Validate an optional nested path field when it is present. */
function validateOptionalStringField(
  value: RawConfig,
  key: string,
  path: string,
  errors: ValidationIssue[],
): void {
  if (key in value) {
    validateStringPath(value[key], path, errors);
  }
}

/** Validate a `{ committed, local }` path section such as footguns or lessons. */
function validatePairPathSection(
  raw: RawConfig,
  section: 'footguns' | 'lessons',
  errors: ValidationIssue[],
): void {
  validateObjectField(raw, section, errors, (value) => {
    validateOptionalStringField(
      value,
      'committed',
      `${section}.committed`,
      errors,
    );
    validateOptionalStringField(value, 'local', `${section}.local`, errors);
  });
}

/** Validate a `{ path }` section such as decisions, evals, or logs. */
function validateSinglePathSection(
  raw: RawConfig,
  section: 'decisions' | 'evals' | 'coding-standards' | 'tasks' | 'logs',
  errors: ValidationIssue[],
): void {
  validateObjectField(raw, section, errors, (value) => {
    validateOptionalStringField(value, 'path', `${section}.path`, errors);
  });
}

/** Require a positive numeric value for a numeric config field. */
function validatePositiveNumber(
  value: unknown,
  path: string,
  errors: ValidationIssue[],
): void {
  if (typeof value !== 'number' || value <= 0) {
    pushError(errors, path, 'must be a positive number');
  }
}

/** Validate version field. */
function validateVersionField(
  raw: RawConfig,
  _warnings: ValidationIssue[],
  errors: ValidationIssue[],
): void {
  if ('version' in raw && typeof raw.version !== 'string') {
    pushError(errors, 'version', 'must be a string');
  }
}

/** Validate the footguns path section. */
function validateFootgunsField(
  raw: RawConfig,
  _warnings: ValidationIssue[],
  errors: ValidationIssue[],
): void {
  validatePairPathSection(raw, 'footguns', errors);
}

/** Validate the lessons path section. */
function validateLessonsField(
  raw: RawConfig,
  _warnings: ValidationIssue[],
  errors: ValidationIssue[],
): void {
  validatePairPathSection(raw, 'lessons', errors);
}

/** Validate the decisions path section. */
function validateDecisionsField(
  raw: RawConfig,
  _warnings: ValidationIssue[],
  errors: ValidationIssue[],
): void {
  validateSinglePathSection(raw, 'decisions', errors);
}

/** Validate the evals path section. */
function validateEvalsField(
  raw: RawConfig,
  _warnings: ValidationIssue[],
  errors: ValidationIssue[],
): void {
  validateSinglePathSection(raw, 'evals', errors);
}

/** Validate the coding-standards path section. */
function validateCodingStandardsField(
  raw: RawConfig,
  _warnings: ValidationIssue[],
  errors: ValidationIssue[],
): void {
  validateSinglePathSection(raw, 'coding-standards', errors);
}

/** Validate line-limit overrides and ensure target stays below limit. */
function validateLineLimitsField(
  raw: RawConfig,
  _warnings: ValidationIssue[],
  errors: ValidationIssue[],
): void {
  validateObjectField(raw, 'line-limits', errors, (value) => {
    if ('target' in value)
      validatePositiveNumber(value.target, 'line-limits.target', errors);
    if ('limit' in value)
      validatePositiveNumber(value.limit, 'line-limits.limit', errors);
    if (
      typeof value.target === 'number' &&
      typeof value.limit === 'number' &&
      value.target >= value.limit
    ) {
      pushError(errors, 'line-limits', 'target must be less than limit');
    }
  });
}

/** Validate the tasks path section. */
function validateTasksField(
  raw: RawConfig,
  _warnings: ValidationIssue[],
  errors: ValidationIssue[],
): void {
  validateSinglePathSection(raw, 'tasks', errors);
}

/** Validate the logs path section. */
function validateLogsField(
  raw: RawConfig,
  _warnings: ValidationIssue[],
  errors: ValidationIssue[],
): void {
  validateSinglePathSection(raw, 'logs', errors);
}

/** Validate an explicit list of enabled agents. */
function validateAgentList(
  agents: unknown[],
  warnings: ValidationIssue[],
  errors: ValidationIssue[],
): void {
  if (agents.length === 0) {
    pushError(
      errors,
      'agents',
      'cannot be empty; omit the field to auto-detect',
    );
  }
  for (const [index, value] of agents.entries()) {
    if (typeof value !== 'string') {
      pushError(errors, `agents[${index}]`, 'must be a string');
      continue;
    }
    if (!KNOWN_AGENTS.has(value)) {
      pushWarning(
        warnings,
        `agents[${index}]`,
        `unknown agent "${value}" - known agents: ${Array.from(KNOWN_AGENTS).join(', ')}`,
      );
    }
  }
}

/** Validate the optional top-level agents selector. */
function validateAgentsField(
  raw: RawConfig,
  warnings: ValidationIssue[],
  errors: ValidationIssue[],
): void {
  if (!('agents' in raw)) return;
  const { agents } = raw;
  if (agents !== null && !Array.isArray(agents)) {
    pushError(errors, 'agents', 'must be null or an array');
    return;
  }
  if (Array.isArray(agents)) {
    validateAgentList(agents, warnings, errors);
  }
}

/** Validate an explicit `skills.install` allowlist. */
function validateSkillInstallList(
  install: unknown[],
  errors: ValidationIssue[],
): void {
  if (install.length === 0) {
    pushError(errors, 'skills.install', 'cannot be empty');
  }
  for (const [index, value] of install.entries()) {
    if (typeof value !== 'string') {
      pushError(errors, `skills.install[${index}]`, 'must be a string');
    }
  }
}

/** Validate the userRole field when present. */
function validateUserRoleField(
  raw: RawConfig,
  _warnings: ValidationIssue[],
  errors: ValidationIssue[],
): void {
  if (!('userRole' in raw)) return;
  const { userRole } = raw;
  if (typeof userRole !== 'string' || !KNOWN_USER_ROLES.has(userRole)) {
    pushError(
      errors,
      'userRole',
      `must be one of: ${Array.from(KNOWN_USER_ROLES).join(', ')}`,
    );
  }
}

/** Validate the skills installation policy block. */
function validateSkillsField(
  raw: RawConfig,
  _warnings: ValidationIssue[],
  errors: ValidationIssue[],
): void {
  validateObjectField(raw, 'skills', errors, (value) => {
    if (!('install' in value)) return;
    const { install } = value;
    if (install !== 'all' && !Array.isArray(install)) {
      pushError(errors, 'skills.install', 'must be "all" or an array');
      return;
    }
    if (Array.isArray(install)) {
      validateSkillInstallList(install, errors);
    }
  });
}

/** Ordered list of field-level validators applied during config validation. */
const CONFIG_VALIDATORS: ConfigValidator[] = [
  validateVersionField,
  validateFootgunsField,
  validateLessonsField,
  validateDecisionsField,
  validateEvalsField,
  validateCodingStandardsField,
  validateLineLimitsField,
  validateTasksField,
  validateLogsField,
  validateAgentsField,
  validateSkillsField,
  validateUserRoleField,
];

/** Validate a parsed config object and return structured warnings and errors. */
export function validateConfig(raw: unknown): ValidationResult {
  const warnings: ValidationIssue[] = [];
  const errors: ValidationIssue[] = [];

  if (!isRecord(raw)) {
    pushError(errors, 'config', 'must be a YAML object');
    return { valid: false, warnings, errors };
  }

  validateUnknownTopLevelKeys(raw, warnings);
  for (const validator of CONFIG_VALIDATORS) {
    validator(raw, warnings, errors);
  }

  return { valid: errors.length === 0, warnings, errors };
}

/** Load, parse, validate, and normalize `.goat-flow/config.yaml`. */
export function loadConfig(projectRoot: string, fs?: ReadonlyFS): LoadedConfig {
  const content = readConfigText(projectRoot, fs);
  if (content === null) {
    return {
      exists: false,
      valid: true,
      config: cloneDefaults(),
      warnings: [],
      errors: [],
      parseError: null,
    };
  }

  let parsed: unknown;
  try {
    parsed = load(content) ?? {};
  } catch (error) {
    return {
      exists: true,
      valid: false,
      config: cloneDefaults(),
      warnings: [],
      errors: [
        {
          level: 'error',
          path: '.goat-flow/config.yaml',
          message: error instanceof Error ? error.message : String(error),
        },
      ],
      parseError: error instanceof Error ? error.message : String(error),
    };
  }

  const validation = validateConfig(parsed);
  return {
    exists: true,
    valid: validation.valid,
    config: mergeConfig(parsed),
    warnings: validation.warnings,
    errors: validation.errors,
    parseError: null,
  };
}

/** Return the normalized config object, falling back to defaults on failure. */
export function readConfig(
  projectRoot: string,
  fs?: ReadonlyFS,
): GoatFlowConfig {
  return loadConfig(projectRoot, fs).config;
}
