import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import type { ReadonlyFS } from '../types.js';
import { RUBRIC_VERSION } from '../rubric/version.js';
import type { GoatFlowConfig, LoadedConfig, ValidationIssue, ValidationResult } from './types.js';

const KNOWN_AGENTS = new Set(['claude', 'codex', 'gemini']);
const KNOWN_TOP_LEVEL_KEYS = new Set(['version', 'footguns', 'lessons', 'decisions', 'evals', 'coding-standards', 'tasks', 'logs', 'agents', 'skills', 'line-limits']);

export const CONFIG_DEFAULTS: GoatFlowConfig = {
  version: RUBRIC_VERSION,
  footguns: { committed: 'docs/footguns/', local: '.goat-flow/footguns/' },
  lessons: { committed: 'ai/lessons/', local: '.goat-flow/lessons/' },
  decisions: { path: 'ai/decisions/' },
  evals: { path: 'ai/evals/' },
  codingStandards: { path: 'ai/coding-standards/' },
  tasks: { path: '.goat-flow/tasks/' },
  logs: { path: '.goat-flow/logs/' },
  agents: null,
  skills: { install: 'all' },
  lineLimits: { target: 120, limit: 150 },
};

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
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && Array.isArray(value) === false;
}

function readConfigText(projectRoot: string, fs?: ReadonlyFS): string | null {
  if (fs) return fs.readFile('.goat-flow/config.yaml');
  const path = join(projectRoot, '.goat-flow', 'config.yaml');
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf8');
}

function mergePairPaths(
  value: unknown,
  target: { committed: string; local: string },
): void {
  if (!isRecord(value)) return;
  if (typeof value.committed === 'string') target.committed = value.committed;
  if (typeof value.local === 'string') target.local = value.local;
}

function mergeSinglePath(
  value: unknown,
  target: { path: string },
): void {
  if (isRecord(value) && typeof value.path === 'string') {
    target.path = value.path;
  }
}

function mergeVersion(value: unknown, merged: GoatFlowConfig): void {
  if (typeof value === 'string') {
    merged.version = value;
  }
}

function mergeAgents(value: unknown, merged: GoatFlowConfig): void {
  if (value === null || Array.isArray(value)) {
    merged.agents = value as string[] | null;
  }
}

function mergeSkills(value: unknown, merged: GoatFlowConfig): void {
  if (!isRecord(value)) return;
  const { install } = value;
  if (install === 'all' || Array.isArray(install)) {
    merged.skills.install = install as string[] | 'all';
  }
}

function mergeLineLimits(value: unknown, merged: GoatFlowConfig): void {
  if (!isRecord(value)) return;
  if (typeof value.target === 'number' && value.target > 0) merged.lineLimits.target = value.target;
  if (typeof value.limit === 'number' && value.limit > 0) merged.lineLimits.limit = value.limit;
}

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

  return merged;
}

function pushError(errors: ValidationIssue[], path: string, message: string): void {
  errors.push({ level: 'error', path, message });
}

function pushWarning(warnings: ValidationIssue[], path: string, message: string): void {
  warnings.push({ level: 'warning', path, message });
}

function validateStringPath(
  value: unknown,
  path: string,
  errors: ValidationIssue[],
): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    pushError(errors, path, 'must be a non-empty string');
  }
}

type RawConfig = Record<string, unknown>;
type ConfigValidator = (
  raw: RawConfig,
  warnings: ValidationIssue[],
  errors: ValidationIssue[],
) => void;

function validateUnknownTopLevelKeys(raw: RawConfig, warnings: ValidationIssue[]): void {
  for (const key of Object.keys(raw)) {
    if (!KNOWN_TOP_LEVEL_KEYS.has(key)) {
      pushWarning(warnings, key, 'unknown top-level key');
    }
  }
}

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

function validatePairPathSection(
  raw: RawConfig,
  section: 'footguns' | 'lessons',
  errors: ValidationIssue[],
): void {
  validateObjectField(raw, section, errors, (value) => {
    validateOptionalStringField(value, 'committed', `${section}.committed`, errors);
    validateOptionalStringField(value, 'local', `${section}.local`, errors);
  });
}

function validateSinglePathSection(
  raw: RawConfig,
  section: 'decisions' | 'evals' | 'coding-standards' | 'tasks' | 'logs',
  errors: ValidationIssue[],
): void {
  validateObjectField(raw, section, errors, (value) => {
    validateOptionalStringField(value, 'path', `${section}.path`, errors);
  });
}

function validatePositiveNumber(
  value: unknown,
  path: string,
  errors: ValidationIssue[],
): void {
  if (typeof value !== 'number' || value <= 0) {
    pushError(errors, path, 'must be a positive number');
  }
}

function validateVersionField(
  raw: RawConfig,
  _warnings: ValidationIssue[],
  errors: ValidationIssue[],
): void {
  if ('version' in raw && typeof raw.version !== 'string') {
    pushError(errors, 'version', 'must be a string');
  }
}

function validateFootgunsField(
  raw: RawConfig,
  _warnings: ValidationIssue[],
  errors: ValidationIssue[],
): void {
  validatePairPathSection(raw, 'footguns', errors);
}

function validateLessonsField(
  raw: RawConfig,
  _warnings: ValidationIssue[],
  errors: ValidationIssue[],
): void {
  validatePairPathSection(raw, 'lessons', errors);
}

function validateDecisionsField(
  raw: RawConfig,
  _warnings: ValidationIssue[],
  errors: ValidationIssue[],
): void {
  validateSinglePathSection(raw, 'decisions', errors);
}

function validateEvalsField(
  raw: RawConfig,
  _warnings: ValidationIssue[],
  errors: ValidationIssue[],
): void {
  validateSinglePathSection(raw, 'evals', errors);
}

function validateCodingStandardsField(
  raw: RawConfig,
  _warnings: ValidationIssue[],
  errors: ValidationIssue[],
): void {
  validateSinglePathSection(raw, 'coding-standards', errors);
}

function validateLineLimitsField(
  raw: RawConfig,
  _warnings: ValidationIssue[],
  errors: ValidationIssue[],
): void {
  validateObjectField(raw, 'line-limits', errors, (value) => {
    if ('target' in value) validatePositiveNumber(value.target, 'line-limits.target', errors);
    if ('limit' in value) validatePositiveNumber(value.limit, 'line-limits.limit', errors);
    if (
      typeof value.target === 'number'
      && typeof value.limit === 'number'
      && value.target >= value.limit
    ) {
      pushError(errors, 'line-limits', 'target must be less than limit');
    }
  });
}

function validateTasksField(
  raw: RawConfig,
  _warnings: ValidationIssue[],
  errors: ValidationIssue[],
): void {
  validateSinglePathSection(raw, 'tasks', errors);
}

function validateLogsField(
  raw: RawConfig,
  _warnings: ValidationIssue[],
  errors: ValidationIssue[],
): void {
  validateSinglePathSection(raw, 'logs', errors);
}

function validateAgentList(agents: unknown[], warnings: ValidationIssue[], errors: ValidationIssue[]): void {
  if (agents.length === 0) {
    pushError(errors, 'agents', 'cannot be empty; omit the field to auto-detect');
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
        `unknown agent "${value}" — known agents: ${Array.from(KNOWN_AGENTS).join(', ')}`,
      );
    }
  }
}

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

function validateSkillInstallList(install: unknown[], errors: ValidationIssue[]): void {
  if (install.length === 0) {
    pushError(errors, 'skills.install', 'cannot be empty');
  }
  for (const [index, value] of install.entries()) {
    if (typeof value !== 'string') {
      pushError(errors, `skills.install[${index}]`, 'must be a string');
    }
  }
}

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
];

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
      errors: [{ level: 'error', path: '.goat-flow/config.yaml', message: error instanceof Error ? error.message : String(error) }],
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

export function readConfig(projectRoot: string, fs?: ReadonlyFS): GoatFlowConfig {
  return loadConfig(projectRoot, fs).config;
}
