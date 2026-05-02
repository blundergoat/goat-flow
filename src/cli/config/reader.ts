/**
 * Loads and validates `.goat-flow/config.yaml`.
 * Owns defaults, schema-level validation, and the normalized `LoadedConfig` returned to audit and prompt builders.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";
import type { AgentId, ReadonlyFS } from "../types.js";
import { AUDIT_VERSION } from "../constants.js";
import { getKnownAgentIds } from "../agents/registry.js";
import type {
  GoatFlowConfig,
  LoadedConfig,
  ValidationIssue,
  ValidationResult,
} from "./types.js";

/** Manifest-backed agent identifiers accepted in the config's `agents` field. */
const KNOWN_AGENTS = new Set(getKnownAgentIds());
const KNOWN_AGENT_LIST = Array.from(KNOWN_AGENTS).join(", ");
/** Top-level config keys recognized by the validator (others trigger warnings). */
const KNOWN_TOP_LEVEL_KEYS = new Set([
  "version",
  "agents",
  "skills",
  "line-limits",
  "toolchain",
  "userRole",
  "telemetry",
  "known-gaps",
  "skill-overrides",
  "harness",
  "terminal",
]);

/** Built-in default values used when config.yaml is missing or omits fields. */
const CONFIG_DEFAULTS: GoatFlowConfig = {
  version: AUDIT_VERSION,
  footguns: { path: ".goat-flow/footguns/" },
  lessons: { path: ".goat-flow/lessons/" },
  decisions: { path: ".goat-flow/decisions/" },
  tasks: { path: ".goat-flow/tasks/" },
  logs: { path: ".goat-flow/logs/" },
  agents: null,
  skills: { install: "all" },
  lineLimits: { target: 120, limit: 150 },
  toolchain: {
    test: [],
    lint: [],
    build: [],
    package: [],
    format: [],
  },
  userRole: "developer",
  telemetry: false,
  knownGaps: [],
  skillOverrides: {},
  terminal: { idleTimeoutMinutes: 480 },
  harness: { acknowledge: [] },
};

/** Clone the default config object so callers can mutate it safely. */
function cloneDefaults(): GoatFlowConfig {
  return {
    version: CONFIG_DEFAULTS.version,
    footguns: { ...CONFIG_DEFAULTS.footguns },
    lessons: { ...CONFIG_DEFAULTS.lessons },
    decisions: { ...CONFIG_DEFAULTS.decisions },
    tasks: { ...CONFIG_DEFAULTS.tasks },
    logs: { ...CONFIG_DEFAULTS.logs },
    agents: CONFIG_DEFAULTS.agents,
    skills: { install: CONFIG_DEFAULTS.skills.install },
    lineLimits: { ...CONFIG_DEFAULTS.lineLimits },
    toolchain: {
      test: [...CONFIG_DEFAULTS.toolchain.test],
      lint: [...CONFIG_DEFAULTS.toolchain.lint],
      build: [...CONFIG_DEFAULTS.toolchain.build],
      package: [...CONFIG_DEFAULTS.toolchain.package],
      format: [...CONFIG_DEFAULTS.toolchain.format],
    },
    userRole: CONFIG_DEFAULTS.userRole,
    telemetry: CONFIG_DEFAULTS.telemetry,
    knownGaps: [...CONFIG_DEFAULTS.knownGaps],
    skillOverrides: { ...CONFIG_DEFAULTS.skillOverrides },
    terminal: { ...CONFIG_DEFAULTS.terminal },
    harness: { acknowledge: [...CONFIG_DEFAULTS.harness.acknowledge] },
  };
}

/** Narrow unknown config values to plain object records before field inspection. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    Array.isArray(value) === false
  );
}

/** Read raw config YAML from the project root or injected test filesystem. */
function readConfigText(projectRoot: string, fs?: ReadonlyFS): string | null {
  if (fs) return fs.readFile(".goat-flow/config.yaml");
  const path = join(projectRoot, ".goat-flow", "config.yaml");
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8");
}

/** Apply a config version override when the raw value is valid. */
function mergeVersion(value: unknown, merged: GoatFlowConfig): void {
  if (typeof value === "string") {
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
  if (install === "all" || Array.isArray(install)) {
    merged.skills.install = install as string[] | "all";
  }
  const goatReview = value["goat-review"];
  if (!isRecord(goatReview)) return;
  const localPrBase = goatReview.local_pr_base;
  if (typeof localPrBase === "string" && localPrBase.trim().length > 0) {
    merged.skills["goat-review"] = { localPrBase: localPrBase.trim() };
  }
}

/** Normalize one raw command list into a filtered string array. */
function normalizeCommandList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is string =>
      typeof item === "string" && item.trim().length > 0,
  );
}

/** Apply toolchain command arrays from the raw config. */
function mergeToolchain(value: unknown, merged: GoatFlowConfig): void {
  if (!isRecord(value)) return;
  merged.toolchain.test = normalizeCommandList(value.test);
  merged.toolchain.lint = normalizeCommandList(value.lint);
  merged.toolchain.build = normalizeCommandList(value.build);
  merged.toolchain.package = normalizeCommandList(value.package);
  merged.toolchain.format = normalizeCommandList(value.format);
}

/** Valid userRole values accepted in the config file. */
const KNOWN_USER_ROLES = new Set(["developer", "investigator", "tester"]);

/** Apply a valid userRole override from the raw config. */
function mergeUserRole(value: unknown, merged: GoatFlowConfig): void {
  if (typeof value === "string" && KNOWN_USER_ROLES.has(value)) {
    merged.userRole = value as GoatFlowConfig["userRole"];
  }
}

/** Apply positive line-limit overrides from the raw config. */
function mergeLineLimits(value: unknown, merged: GoatFlowConfig): void {
  if (!isRecord(value)) return;
  if (typeof value.target === "number" && value.target > 0)
    merged.lineLimits.target = value.target;
  if (typeof value.limit === "number" && value.limit > 0)
    merged.lineLimits.limit = value.limit;
}

/** Merge a validated raw config object on top of the built-in defaults. */
function mergeConfig(raw: unknown): GoatFlowConfig {
  const merged = cloneDefaults();
  if (!isRecord(raw)) return merged;

  mergeVersion(raw.version, merged);
  // Path overrides for footguns/lessons/decisions/tasks/logs removed in v1.1.0.
  // Canonical paths (.goat-flow/*) are always used.
  mergeAgents(raw.agents, merged);
  mergeSkills(raw.skills, merged);

  // YAML key is `line-limits` (kebab-case), TypeScript field is `lineLimits` (camelCase)
  mergeLineLimits(raw["line-limits"], merged);
  mergeToolchain(raw.toolchain, merged);
  mergeUserRole(raw.userRole, merged);
  if (typeof raw.telemetry === "boolean") merged.telemetry = raw.telemetry;

  // YAML key is `known-gaps` (kebab-case), TypeScript field is `knownGaps` (camelCase)
  if (Array.isArray(raw["known-gaps"])) {
    merged.knownGaps = (raw["known-gaps"] as unknown[]).filter(
      (item): item is string =>
        typeof item === "string" && item.trim().length > 0,
    );
  }

  // YAML key is `skill-overrides` (kebab-case), TypeScript field is `skillOverrides` (camelCase)
  if (isRecord(raw["skill-overrides"])) {
    merged.skillOverrides = {
      ...raw["skill-overrides"],
    };
  }

  if (isRecord(raw.terminal)) {
    const timeout = raw.terminal["idle-timeout"];
    if (
      typeof timeout === "number" &&
      Number.isInteger(timeout) &&
      timeout >= 0
    ) {
      merged.terminal.idleTimeoutMinutes = timeout;
    }
  }

  mergeHarness(raw.harness, merged);

  return merged;
}

/** Apply harness acknowledge list from the raw config. */
function mergeHarness(value: unknown, merged: GoatFlowConfig): void {
  if (!isRecord(value)) return;
  if (Array.isArray(value.acknowledge)) {
    merged.harness.acknowledge = value.acknowledge.filter(
      (item): item is string =>
        typeof item === "string" && item.trim().length > 0,
    );
  }
}

/** Append a config validation error with its source path. */
function pushError(
  errors: ValidationIssue[],
  path: string,
  message: string,
): void {
  errors.push({ level: "error", path, message });
}

/** Append a config validation warning with its source path. */
function pushWarning(
  warnings: ValidationIssue[],
  path: string,
  message: string,
): void {
  warnings.push({ level: "warning", path, message });
}

/** Shorthand for a loosely-typed parsed YAML config object. */
type RawConfig = Record<string, unknown>;
/** Signature for a single config field validator function. */
type ConfigValidator = (
  raw: RawConfig,
  warnings: ValidationIssue[],
  errors: ValidationIssue[],
) => void;

/** Warn when the config contains top-level keys that are not understood. */
function validateUnknownTopLevelKeys(
  raw: RawConfig,
  warnings: ValidationIssue[],
): void {
  for (const key of Object.keys(raw)) {
    if (!KNOWN_TOP_LEVEL_KEYS.has(key)) {
      pushWarning(warnings, key, "unknown top-level key");
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
    pushError(errors, key, "must be an object");
    return;
  }
  onValid(value);
}

/** Require a positive numeric value for a numeric config field. */
function validatePositiveNumber(
  value: unknown,
  path: string,
  errors: ValidationIssue[],
): void {
  if (typeof value !== "number" || value <= 0) {
    pushError(errors, path, "must be a positive number");
  }
}

/** Require a string array for command-list config fields. */
function validateStringArray(
  value: unknown,
  path: string,
  errors: ValidationIssue[],
): void {
  if (!Array.isArray(value)) {
    pushError(errors, path, "must be an array");
    return;
  }
  for (const [index, item] of value.entries()) {
    if (typeof item !== "string" || item.trim().length === 0) {
      pushError(errors, `${path}[${index}]`, "must be a non-empty string");
    }
  }
}

/** Validate version field. */
function validateVersionField(
  raw: RawConfig,
  _warnings: ValidationIssue[],
  errors: ValidationIssue[],
): void {
  if ("version" in raw && typeof raw.version !== "string") {
    pushError(errors, "version", "must be a string");
  }
}

/** Validate line-limit overrides and ensure target stays below limit. */
function validateLineLimitsField(
  raw: RawConfig,
  _warnings: ValidationIssue[],
  errors: ValidationIssue[],
): void {
  validateObjectField(raw, "line-limits", errors, (value) => {
    if ("target" in value)
      validatePositiveNumber(value.target, "line-limits.target", errors);
    if ("limit" in value)
      validatePositiveNumber(value.limit, "line-limits.limit", errors);
    if (
      typeof value.target === "number" &&
      typeof value.limit === "number" &&
      value.target >= value.limit
    ) {
      pushError(errors, "line-limits", "target must be less than limit");
    }
  });
}

/** Validate the toolchain command arrays. */
function validateToolchainField(
  raw: RawConfig,
  _warnings: ValidationIssue[],
  errors: ValidationIssue[],
): void {
  validateObjectField(raw, "toolchain", errors, (value) => {
    if ("test" in value)
      validateStringArray(value.test, "toolchain.test", errors);
    if ("lint" in value)
      validateStringArray(value.lint, "toolchain.lint", errors);
    if ("build" in value)
      validateStringArray(value.build, "toolchain.build", errors);
    if ("package" in value)
      validateStringArray(value.package, "toolchain.package", errors);
    if ("format" in value)
      validateStringArray(value.format, "toolchain.format", errors);
  });
}

/** Validate an explicit list of enabled agents. */
function validateAgentList(
  agents: unknown[],
  _warnings: ValidationIssue[],
  errors: ValidationIssue[],
): void {
  if (agents.length === 0) {
    pushError(
      errors,
      "agents",
      "cannot be empty; omit the field to auto-detect",
    );
  }
  for (const [index, value] of agents.entries()) {
    if (typeof value !== "string") {
      pushError(errors, `agents[${index}]`, "must be a string");
      continue;
    }
    if (!KNOWN_AGENTS.has(value as AgentId)) {
      pushError(
        errors,
        `agents[${index}]`,
        `unknown agent "${value}" - known agents: ${KNOWN_AGENT_LIST}`,
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
  if (!("agents" in raw)) return;
  const { agents } = raw;
  if (agents !== null && !Array.isArray(agents)) {
    pushError(errors, "agents", "must be null or an array");
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
    pushError(errors, "skills.install", "cannot be empty");
  }
  for (const [index, value] of install.entries()) {
    if (typeof value !== "string") {
      pushError(errors, `skills.install[${index}]`, "must be a string");
    }
  }
}

/** Validate the userRole field when present. */
function validateUserRoleField(
  raw: RawConfig,
  _warnings: ValidationIssue[],
  errors: ValidationIssue[],
): void {
  if (!("userRole" in raw)) return;
  const { userRole } = raw;
  if (typeof userRole !== "string" || !KNOWN_USER_ROLES.has(userRole)) {
    pushError(
      errors,
      "userRole",
      `must be one of: ${Array.from(KNOWN_USER_ROLES).join(", ")}`,
    );
  }
}

/** Validate the skills installation policy block. */
function validateSkillsField(
  raw: RawConfig,
  _warnings: ValidationIssue[],
  errors: ValidationIssue[],
): void {
  validateObjectField(raw, "skills", errors, (value) => {
    if ("install" in value) {
      const { install } = value;
      if (install !== "all" && !Array.isArray(install)) {
        pushError(errors, "skills.install", 'must be "all" or an array');
      } else if (Array.isArray(install)) {
        validateSkillInstallList(install, errors);
      }
    }

    if ("goat-review" in value) {
      const goatReview = value["goat-review"];
      if (!isRecord(goatReview)) {
        pushError(errors, "skills.goat-review", "must be an object");
        return;
      }
      if ("local_pr_base" in goatReview) {
        const localPrBase = goatReview.local_pr_base;
        if (
          typeof localPrBase !== "string" ||
          localPrBase.trim().length === 0
        ) {
          pushError(
            errors,
            "skills.goat-review.local_pr_base",
            "must be a non-empty string",
          );
        }
      }
    }
  });
}

/** Validate the harness acknowledge list when present. */
function validateHarnessField(
  raw: RawConfig,
  _warnings: ValidationIssue[],
  errors: ValidationIssue[],
): void {
  validateObjectField(raw, "harness", errors, (value) => {
    if (!("acknowledge" in value)) return;
    validateStringArray(value.acknowledge, "harness.acknowledge", errors);
  });
}

/** Validate the telemetry field when present. */
function validateTelemetryField(
  raw: RawConfig,
  _warnings: ValidationIssue[],
  errors: ValidationIssue[],
): void {
  if (!("telemetry" in raw)) return;
  if (typeof raw.telemetry !== "boolean") {
    pushError(errors, "telemetry", "must be a boolean");
  }
}

/** Validate the known-gaps field when present. */
function validateKnownGapsField(
  raw: RawConfig,
  _warnings: ValidationIssue[],
  errors: ValidationIssue[],
): void {
  if (!("known-gaps" in raw)) return;
  validateStringArray(raw["known-gaps"], "known-gaps", errors);
}

/** Validate the skill-overrides field when present. */
function validateSkillOverridesField(
  raw: RawConfig,
  _warnings: ValidationIssue[],
  errors: ValidationIssue[],
): void {
  if (!("skill-overrides" in raw)) return;
  if (!isRecord(raw["skill-overrides"])) {
    pushError(errors, "skill-overrides", "must be an object");
  }
}

/** Validate the terminal config block when present. */
function validateTerminalField(
  raw: RawConfig,
  _warnings: ValidationIssue[],
  errors: ValidationIssue[],
): void {
  validateObjectField(raw, "terminal", errors, (value) => {
    if (!("idle-timeout" in value)) return;
    const timeout = value["idle-timeout"];
    if (
      typeof timeout !== "number" ||
      !Number.isInteger(timeout) ||
      timeout < 0
    ) {
      pushError(
        errors,
        "terminal.idle-timeout",
        "must be a non-negative integer",
      );
    }
  });
}

/** Ordered list of field-level validators applied during config validation. */
const CONFIG_VALIDATORS: ConfigValidator[] = [
  validateVersionField,
  validateLineLimitsField,
  validateAgentsField,
  validateSkillsField,
  validateToolchainField,
  validateUserRoleField,
  validateTelemetryField,
  validateKnownGapsField,
  validateSkillOverridesField,
  validateHarnessField,
  validateTerminalField,
];

/** Validate a parsed config object and return structured warnings and errors. */
function validateConfig(raw: unknown): ValidationResult {
  const warnings: ValidationIssue[] = [];
  const errors: ValidationIssue[] = [];

  if (!isRecord(raw)) {
    pushError(errors, "config", "must be a YAML object");
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
          level: "error",
          path: ".goat-flow/config.yaml",
          message: error instanceof Error ? error.message : String(error),
        },
      ],
      parseError: error instanceof Error ? error.message : String(error),
    };
  }

  const validation = validateConfig(parsed);
  // Fail closed: if validation failed, downstream consumers must NOT see the
  // partially-merged malformed config. Return defaults instead so consumers
  // see a known-safe shape. The errors array still carries the specific paths
  // that failed so callers can surface them to the user.
  return {
    exists: true,
    valid: validation.valid,
    config: validation.valid ? mergeConfig(parsed) : cloneDefaults(),
    warnings: validation.warnings,
    errors: validation.errors,
    parseError: null,
  };
}
