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

function mergeConfig(raw: unknown): GoatFlowConfig {
  const merged = cloneDefaults();
  if (!isRecord(raw)) return merged;

  if (typeof raw.version === 'string') merged.version = raw.version;

  if (isRecord(raw.footguns)) {
    if (typeof raw.footguns.committed === 'string') merged.footguns.committed = raw.footguns.committed;
    if (typeof raw.footguns.local === 'string') merged.footguns.local = raw.footguns.local;
  }

  if (isRecord(raw.lessons)) {
    if (typeof raw.lessons.committed === 'string') merged.lessons.committed = raw.lessons.committed;
    if (typeof raw.lessons.local === 'string') merged.lessons.local = raw.lessons.local;
  }

  if (isRecord(raw.decisions) && typeof raw.decisions.path === 'string') {
    merged.decisions.path = raw.decisions.path;
  }

  if (isRecord(raw.evals) && typeof raw.evals.path === 'string') {
    merged.evals.path = raw.evals.path;
  }

  // YAML key is `coding-standards` (kebab-case), TypeScript field is `codingStandards` (camelCase)
  const csRaw = raw['coding-standards'];
  if (isRecord(csRaw) && typeof csRaw.path === 'string') {
    merged.codingStandards.path = csRaw.path;
  }

  if (isRecord(raw.tasks) && typeof raw.tasks.path === 'string') {
    merged.tasks.path = raw.tasks.path;
  }

  if (isRecord(raw.logs) && typeof raw.logs.path === 'string') {
    merged.logs.path = raw.logs.path;
  }

  if (raw.agents === null || Array.isArray(raw.agents)) {
    merged.agents = raw.agents as string[] | null;
  }

  if (isRecord(raw.skills)) {
    const install = raw.skills.install;
    if (install === 'all' || Array.isArray(install)) {
      merged.skills.install = install as string[] | 'all';
    }
  }

  // YAML key is `line-limits` (kebab-case), TypeScript field is `lineLimits` (camelCase)
  const llRaw = raw['line-limits'];
  if (isRecord(llRaw)) {
    if (typeof llRaw.target === 'number' && llRaw.target > 0) merged.lineLimits.target = llRaw.target;
    if (typeof llRaw.limit === 'number' && llRaw.limit > 0) merged.lineLimits.limit = llRaw.limit;
  }

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

export function validateConfig(raw: unknown): ValidationResult {
  const warnings: ValidationIssue[] = [];
  const errors: ValidationIssue[] = [];

  if (!isRecord(raw)) {
    pushError(errors, 'config', 'must be a YAML object');
    return { valid: false, warnings, errors };
  }

  for (const key of Object.keys(raw)) {
    if (!KNOWN_TOP_LEVEL_KEYS.has(key)) {
      pushWarning(warnings, key, 'unknown top-level key');
    }
  }

  if ('version' in raw && typeof raw.version !== 'string') {
    pushError(errors, 'version', 'must be a string');
  }

  if ('footguns' in raw) {
    if (!isRecord(raw.footguns)) {
      pushError(errors, 'footguns', 'must be an object');
    } else {
      if ('committed' in raw.footguns) validateStringPath(raw.footguns.committed, 'footguns.committed', errors);
      if ('local' in raw.footguns) validateStringPath(raw.footguns.local, 'footguns.local', errors);
    }
  }

  if ('lessons' in raw) {
    if (!isRecord(raw.lessons)) {
      pushError(errors, 'lessons', 'must be an object');
    } else {
      if ('committed' in raw.lessons) validateStringPath(raw.lessons.committed, 'lessons.committed', errors);
      if ('local' in raw.lessons) validateStringPath(raw.lessons.local, 'lessons.local', errors);
    }
  }

  if ('decisions' in raw) {
    if (!isRecord(raw.decisions)) {
      pushError(errors, 'decisions', 'must be an object');
    } else if ('path' in raw.decisions) {
      validateStringPath(raw.decisions.path, 'decisions.path', errors);
    }
  }

  if ('evals' in raw) {
    if (!isRecord(raw.evals)) {
      pushError(errors, 'evals', 'must be an object');
    } else if ('path' in raw.evals) {
      validateStringPath(raw.evals.path, 'evals.path', errors);
    }
  }

  if ('coding-standards' in raw) {
    const cs = raw['coding-standards'];
    if (!isRecord(cs)) {
      pushError(errors, 'coding-standards', 'must be an object');
    } else if ('path' in cs) {
      validateStringPath(cs.path, 'coding-standards.path', errors);
    }
  }

  if ('line-limits' in raw) {
    const ll = raw['line-limits'];
    if (!isRecord(ll)) {
      pushError(errors, 'line-limits', 'must be an object');
    } else {
      if ('target' in ll && (typeof ll.target !== 'number' || ll.target <= 0)) {
        pushError(errors, 'line-limits.target', 'must be a positive number');
      }
      if ('limit' in ll && (typeof ll.limit !== 'number' || ll.limit <= 0)) {
        pushError(errors, 'line-limits.limit', 'must be a positive number');
      }
      if (typeof ll.target === 'number' && typeof ll.limit === 'number' && ll.target >= ll.limit) {
        pushError(errors, 'line-limits', 'target must be less than limit');
      }
    }
  }

  if ('tasks' in raw) {
    if (!isRecord(raw.tasks)) {
      pushError(errors, 'tasks', 'must be an object');
    } else if ('path' in raw.tasks) {
      validateStringPath(raw.tasks.path, 'tasks.path', errors);
    }
  }

  if ('logs' in raw) {
    if (!isRecord(raw.logs)) {
      pushError(errors, 'logs', 'must be an object');
    } else if ('path' in raw.logs) {
      validateStringPath(raw.logs.path, 'logs.path', errors);
    }
  }

  if ('agents' in raw) {
    const { agents } = raw;
    if (agents !== null && !Array.isArray(agents)) {
      pushError(errors, 'agents', 'must be null or an array');
    } else if (Array.isArray(agents)) {
      if (agents.length === 0) {
        pushError(errors, 'agents', 'cannot be empty; omit the field to auto-detect');
      }
      for (let i = 0; i < agents.length; i++) {
        const value = agents[i];
        if (typeof value !== 'string') {
          pushError(errors, `agents[${i}]`, 'must be a string');
        } else if (!KNOWN_AGENTS.has(value)) {
          pushWarning(warnings, `agents[${i}]`, `unknown agent "${value}" — known agents: ${Array.from(KNOWN_AGENTS).join(', ')}`);
        }
      }
    }
  }

  if ('skills' in raw) {
    if (!isRecord(raw.skills)) {
      pushError(errors, 'skills', 'must be an object');
    } else if ('install' in raw.skills) {
      const { install } = raw.skills;
      if (install !== 'all' && !Array.isArray(install)) {
        pushError(errors, 'skills.install', 'must be "all" or an array');
      } else if (Array.isArray(install)) {
        if (install.length === 0) {
          pushError(errors, 'skills.install', 'cannot be empty');
        }
        for (let i = 0; i < install.length; i++) {
          if (typeof install[i] !== 'string') {
            pushError(errors, `skills.install[${i}]`, 'must be a string');
          }
        }
      }
    }
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
