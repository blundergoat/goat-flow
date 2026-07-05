/**
 * Load and validate `.goat-flow/config.yaml` for CLI and dashboard flows.
 * Use when audit, setup, hooks, quality, or prompt builders need one normalized config object.
 * Missing config gives users safe defaults; malformed config returns structured errors that audit can show.
 * Downstream callers never receive partially merged invalid YAML.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";
import type { ReadonlyFS } from "../types.js";
import { AUDIT_VERSION } from "../constants.js";
import type {
  GoatFlowConfig,
  LearningLoopAutoCaptureTarget,
  LoadedConfig,
  ValidationIssue,
  ValidationResult,
} from "./types.js";

/** Top-level config keys recognized by the validator (others trigger warnings). */
const KNOWN_TOP_LEVEL_KEYS = new Set([
  "version",
  "agents",
  "skills",
  "line-limits",
  "plans",
  "toolchain",
  "userRole",
  "telemetry",
  "learning-loop",
  "known-gaps",
  "skill-overrides",
  "harness",
  "hooks",
  "terminal",
  "quality",
]);

/** Built-in default values used when config.yaml is missing or omits fields. */
const CONFIG_DEFAULTS: GoatFlowConfig = {
  version: AUDIT_VERSION,
  footguns: { path: ".goat-flow/learning-loop/footguns/" },
  lessons: { path: ".goat-flow/learning-loop/lessons/" },
  decisions: { path: ".goat-flow/learning-loop/decisions/" },
  plans: { path: ".goat-flow/plans/" },
  logs: { path: ".goat-flow/logs/" },
  agents: null,
  skills: { install: "all" },
  lineLimits: { target: 125, limit: 150 },
  toolchain: {
    test: [],
    lint: [],
    build: [],
    package: [],
    format: [],
  },
  userRole: "developer",
  telemetry: false,
  learningLoop: {
    autoCapture: {
      enabled: false,
      targets: [],
    },
  },
  knownGaps: [],
  skillOverrides: {},
  terminal: { idleTimeoutMinutes: 480 },
  harness: { acknowledge: [] },
  hooks: {},
};

/**
 * Clone the default config object.
 * Use before merging project YAML so a missing or invalid config cannot mutate shared defaults.
 *
 * @returns fresh defaults; empty config means callers see the baseline goat-flow behavior
 */
function cloneDefaults(): GoatFlowConfig {
  return {
    version: CONFIG_DEFAULTS.version,
    footguns: { ...CONFIG_DEFAULTS.footguns },
    lessons: { ...CONFIG_DEFAULTS.lessons },
    decisions: { ...CONFIG_DEFAULTS.decisions },
    plans: { ...CONFIG_DEFAULTS.plans },
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
    learningLoop: {
      autoCapture: {
        enabled: CONFIG_DEFAULTS.learningLoop.autoCapture.enabled,
        targets: [...CONFIG_DEFAULTS.learningLoop.autoCapture.targets],
      },
    },
    knownGaps: [...CONFIG_DEFAULTS.knownGaps],
    skillOverrides: { ...CONFIG_DEFAULTS.skillOverrides },
    terminal: { ...CONFIG_DEFAULTS.terminal },
    harness: { acknowledge: [...CONFIG_DEFAULTS.harness.acknowledge] },
    hooks: { ...CONFIG_DEFAULTS.hooks },
  };
}

/**
 * Decide whether a raw YAML value can be inspected as a config object.
 * Use before reading nested fields so invalid YAML shapes become validation errors instead of crashes.
 *
 * @param value - raw YAML value; `null`, arrays, and primitives mean there are no named config keys
 * @returns whether the value is a named-field object
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    Array.isArray(value) === false
  );
}

/**
 * Read raw config YAML from a target project.
 * Use before parsing config so tests can inject a filesystem and real CLI runs read the project root.
 *
 * @param projectRoot - target project root; empty means only an injected filesystem can return config
 * @param fs - optional read-only filesystem; absent means read from disk
 * @returns config text, or `null` when the user has not created `.goat-flow/config.yaml`
 */
function readConfigText(projectRoot: string, fs?: ReadonlyFS): string | null {
  // Tests and audit facts read through the injected filesystem.
  if (fs) return fs.readFile(".goat-flow/config.yaml");
  const path = join(projectRoot, ".goat-flow", "config.yaml");
  // Missing config is valid: the CLI falls back to built-in defaults.
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8");
}

/**
 * Apply a valid config version override.
 * Use so audit output can reflect the version declared by the user's config.
 *
 * @param value - raw version field; missing or non-string values keep the default version
 * @param merged - config being built; empty defaults remain unchanged when the value is invalid
 * @returns nothing; the merged config is updated in place
 */
function mergeVersion(value: unknown, merged: GoatFlowConfig): void {
  // Only strings can be shown safely as the config version.
  if (typeof value === "string") {
    merged.version = value;
  }
}

/**
 * Apply the configured skill install policy.
 * Use when setup/install decides whether to install all skills or a user-chosen subset.
 *
 * @param value - raw `skills` block; missing or non-object values keep the default install-all policy
 * @param merged - config being built; invalid nested values are ignored after validation reports them
 * @returns nothing; valid skill settings update the merged config in place
 */
function mergeSkills(value: unknown, merged: GoatFlowConfig): void {
  // Missing skills config means users get the default "install all" behavior.
  if (!isRecord(value)) return;
  const { install } = value;
  // Valid install policy controls which skills setup places into agent mirrors.
  if (install === "all" || Array.isArray(install)) {
    merged.skills.install = install as string[] | "all";
  }
  const goatReview = value["goat-review"];
  // Missing goat-review config means review uses its built-in local PR base behavior.
  if (!isRecord(goatReview)) return;
  const localPrBase = goatReview.local_pr_base;
  // Blank local PR base is ignored so the review flow can fall back safely.
  if (typeof localPrBase === "string" && localPrBase.trim().length > 0) {
    merged.skills["goat-review"] = { localPrBase: localPrBase.trim() };
  }
}

/**
 * Normalize a raw toolchain command list.
 * Use so prompts and audit output only show executable-looking command strings from config.
 *
 * @param value - raw command list; missing or non-array values mean no commands were configured
 * @returns non-empty command strings; empty array means the user has no commands for that toolchain slot
 */
function normalizeCommandList(value: unknown): string[] {
  // Non-arrays mean the user did not provide a valid command list.
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is string =>
      typeof item === "string" && item.trim().length > 0,
  );
}

/**
 * Apply configured toolchain command arrays.
 * Use when setup and prompts need the user's test, lint, build, package, and format commands.
 *
 * @param value - raw `toolchain` block; missing or non-object values keep every command list empty
 * @param merged - config being built; command arrays update in place
 * @returns nothing; invalid command entries are filtered out after validation reports them
 */
function mergeToolchain(value: unknown, merged: GoatFlowConfig): void {
  // Missing toolchain config means generated prompts do not recommend project commands.
  if (!isRecord(value)) return;
  merged.toolchain.test = normalizeCommandList(value.test);
  merged.toolchain.lint = normalizeCommandList(value.lint);
  merged.toolchain.build = normalizeCommandList(value.build);
  merged.toolchain.package = normalizeCommandList(value.package);
  merged.toolchain.format = normalizeCommandList(value.format);
}

/** Valid userRole values accepted in the config file. */
const KNOWN_USER_ROLES = new Set(["developer", "investigator", "tester"]);

/** Valid durable learning-loop targets accepted for future auto-capture. */
const LEARNING_LOOP_AUTO_CAPTURE_TARGETS: ReadonlySet<string> =
  new Set<LearningLoopAutoCaptureTarget>([
    "lessons",
    "footguns",
    "patterns",
    "decisions",
  ]);

/**
 * Check whether a value names a supported learning-loop auto-capture target.
 * Use when filtering future auto-capture config so unknown targets do not create files in random buckets.
 *
 * @param value - raw target value; missing or non-string values are ignored
 * @returns whether the target can be shown and written as a durable learning-loop bucket
 */
function isLearningLoopAutoCaptureTarget(
  value: unknown,
): value is LearningLoopAutoCaptureTarget {
  return (
    typeof value === "string" && LEARNING_LOOP_AUTO_CAPTURE_TARGETS.has(value)
  );
}

/**
 * Apply a valid user role override.
 * Use so generated guidance can adapt to developer, investigator, or tester workflows.
 *
 * @param value - raw `userRole`; missing or unknown roles keep the default developer perspective
 * @param merged - config being built; role updates in place when valid
 * @returns nothing; invalid roles are ignored after validation reports them
 */
function mergeUserRole(value: unknown, merged: GoatFlowConfig): void {
  // Unknown roles are ignored so prompts keep a supported user perspective.
  if (typeof value === "string" && KNOWN_USER_ROLES.has(value)) {
    merged.userRole = value as GoatFlowConfig["userRole"];
  }
}

/**
 * Apply learning-loop auto-capture policy.
 * Use when future flows decide which durable learning buckets may be written automatically.
 *
 * @param value - raw `learning-loop` block; missing or non-object values keep auto-capture disabled
 * @param merged - config being built; valid policy updates in place
 * @returns nothing; invalid targets are filtered out after validation reports them
 */
function mergeLearningLoop(value: unknown, merged: GoatFlowConfig): void {
  // Missing learning-loop config keeps auto-capture off.
  if (!isRecord(value)) return;
  const autoCapture = value["auto-capture"];
  // Missing auto-capture block keeps the default disabled policy.
  if (!isRecord(autoCapture)) return;
  // Explicit booleans are required so strings like "false" do not enable a writer accidentally.
  if (typeof autoCapture.enabled === "boolean") {
    merged.learningLoop.autoCapture.enabled = autoCapture.enabled;
  }
  // Targets are optional; absent targets mean there is nowhere auto-capture may write.
  if (Array.isArray(autoCapture.targets)) {
    merged.learningLoop.autoCapture.targets = autoCapture.targets.filter(
      isLearningLoopAutoCaptureTarget,
    );
  }
}

/**
 * Apply positive line-limit overrides.
 * Use so instruction-file audits can respect the user's configured target and hard limit.
 *
 * @param value - raw `line-limits` block; missing or non-object values keep default limits
 * @param merged - config being built; valid numeric limits update in place
 * @returns nothing; invalid limits are ignored after validation reports them
 */
function mergeLineLimits(value: unknown, merged: GoatFlowConfig): void {
  // Missing line-limit config keeps the default instruction budget.
  if (!isRecord(value)) return;
  // Positive target values set the warning threshold users see in audits.
  if (typeof value.target === "number" && value.target > 0)
    merged.lineLimits.target = value.target;
  // Positive limit values set the hard threshold users see in audits.
  if (typeof value.limit === "number" && value.limit > 0)
    merged.lineLimits.limit = value.limit;
}

/**
 * Merge a validated raw config object on top of defaults.
 * Use only after validation succeeds so downstream users get a complete, safe config shape.
 *
 * @param raw - parsed YAML config; non-object or empty values return defaults
 * @returns normalized config; defaults fill every omitted user setting
 */
function mergeConfig(raw: unknown): GoatFlowConfig {
  const merged = cloneDefaults();
  // Non-object config cannot carry settings, so users get defaults.
  if (!isRecord(raw)) return merged;

  mergeVersion(raw.version, merged);
  // Canonical `.goat-flow/*` paths are always used; old path overrides are ignored.
  mergeSkills(raw.skills, merged);

  // Kebab-case YAML maps to camelCase config used by audit.
  mergeLineLimits(raw["line-limits"], merged);
  mergeToolchain(raw.toolchain, merged);
  mergeUserRole(raw.userRole, merged);
  // Telemetry stays off unless the user explicitly sets a boolean.
  if (typeof raw.telemetry === "boolean") merged.telemetry = raw.telemetry;
  mergeLearningLoop(raw["learning-loop"], merged);

  // Known gaps are user-visible caveats, so keep only non-empty strings.
  if (Array.isArray(raw["known-gaps"])) {
    merged.knownGaps = (raw["known-gaps"] as unknown[]).filter(
      (item): item is string =>
        typeof item === "string" && item.trim().length > 0,
    );
  }

  // Skill overrides pass through as user-owned settings for downstream skill tooling.
  if (isRecord(raw["skill-overrides"])) {
    merged.skillOverrides = {
      ...raw["skill-overrides"],
    };
  }

  // Terminal settings are optional; missing block keeps the dashboard idle timeout default.
  if (isRecord(raw.terminal)) {
    const timeout = raw.terminal["idle-timeout"];
    // A zero timeout is valid and means the user intentionally disabled idle cleanup.
    if (
      typeof timeout === "number" &&
      Number.isInteger(timeout) &&
      timeout >= 0
    ) {
      merged.terminal.idleTimeoutMinutes = timeout;
    }
  }

  mergeHarness(raw.harness, merged);
  mergeHooks(raw.hooks, merged);
  mergeQuality(raw.quality, merged);

  return merged;
}

/**
 * Apply hook toggle state from raw config.
 * Use when the dashboard and hook CLI need the user's desired enabled/disabled guardrail state.
 *
 * @param value - raw `hooks` block; missing or non-object values mean no hook overrides are configured
 * @param merged - config being built; valid hook settings replace the default empty hook map
 * @returns nothing; invalid hook rows are ignored after validation reports them
 */
function mergeHooks(value: unknown, merged: GoatFlowConfig): void {
  // Missing hook config means the hook registry controls default state.
  if (!isRecord(value)) return;
  const hooks: GoatFlowConfig["hooks"] = {};
  // Unknown hook ids are preserved for the registry to interpret or ignore consistently.
  for (const [hookId, hookValue] of Object.entries(value)) {
    // Non-object hook rows cannot describe an enabled state.
    if (!isRecord(hookValue)) continue;
    // Enabled must be explicit so strings like "false" do not flip guardrails.
    if (typeof hookValue.enabled !== "boolean") continue;
    const binaries = readHookBinaries(hookValue.binaries);
    hooks[hookId] = binaries
      ? { enabled: hookValue.enabled, binaries }
      : { enabled: hookValue.enabled };
  }
  merged.hooks = hooks;
}

/**
 * Narrow a hook `binaries` override block to non-empty string values; entries of
 * any other shape are dropped. Returns null when nothing valid remains so
 * callers can omit the key entirely instead of carrying an empty object.
 *
 * @param value - raw `hooks.<id>.binaries` value; absent or non-object means no binary overrides exist
 * @returns validated language-to-path map, or `null` when the user has no valid binary overrides
 */
export function readHookBinaries(
  value: unknown,
): Record<string, string> | null {
  // Missing or non-object binaries mean the hook should use its default binary discovery.
  if (!isRecord(value)) return null;
  const binaries: Record<string, string> = {};
  // Keep only language entries with a non-empty binary path the user intentionally set.
  for (const [lang, binaryPath] of Object.entries(value)) {
    // Empty binary paths are ignored so they do not hide the hook's default discovery.
    if (typeof binaryPath !== "string" || binaryPath.trim() === "") continue;
    binaries[lang] = binaryPath;
  }
  return Object.keys(binaries).length > 0 ? binaries : null;
}

/**
 * Pass through the raw quality config block.
 * Use so quality-specific readers can validate and interpret their own settings.
 *
 * @param value - raw `quality` block; missing or non-object values mean no quality overrides are configured
 * @param merged - config being built; valid raw quality object is copied in place
 * @returns nothing; deep quality validation happens in the quality config reader
 */
function mergeQuality(value: unknown, merged: GoatFlowConfig): void {
  // Missing quality config means quality commands use their own defaults.
  if (!isRecord(value)) return;
  merged.quality = { ...value };
}

/**
 * Apply acknowledged harness gaps from raw config.
 * Use so audit can treat explicitly acknowledged non-gating gaps consistently.
 *
 * @param value - raw `harness` block; missing or non-object values keep an empty acknowledge list
 * @param merged - config being built; valid acknowledgements update in place
 * @returns nothing; invalid entries are filtered after validation reports them
 */
function mergeHarness(value: unknown, merged: GoatFlowConfig): void {
  // Missing harness config means the user has not acknowledged any gaps.
  if (!isRecord(value)) return;
  // Acknowledge entries are optional; absent list leaves the audit fully strict.
  if (Array.isArray(value.acknowledge)) {
    merged.harness.acknowledge = value.acknowledge.filter(
      (item): item is string =>
        typeof item === "string" && item.trim().length > 0,
    );
  }
}

/**
 * Append a config validation error.
 * Use when a field would make downstream CLI or dashboard behavior unsafe to trust.
 *
 * @param errors - error accumulator; empty means this is the first blocking config issue
 * @param path - config path shown to the user; empty would make the error hard to fix
 * @param message - plain error text; empty would produce an unhelpful validation row
 * @returns nothing; the issue list is mutated for the final validation result
 */
function pushError(
  errors: ValidationIssue[],
  path: string,
  message: string,
): void {
  errors.push({ level: "error", path, message });
}

/**
 * Append a config validation warning.
 * Use when a field is ignored but does not make the config unsafe to load.
 *
 * @param warnings - warning accumulator; empty means this is the first non-blocking config issue
 * @param path - config path shown to the user; empty would make the warning hard to fix
 * @param message - plain warning text; empty would produce an unhelpful validation row
 * @returns nothing; the warning list is mutated for the final validation result
 */
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

/**
 * Warn when config contains unknown top-level keys.
 * Use so typos are visible even though the CLI can safely ignore the field.
 *
 * @param raw - parsed config object; empty object produces no warnings
 * @param warnings - warning accumulator shown by config/audit callers
 * @returns nothing; unknown keys append warnings in place
 */
function validateUnknownTopLevelKeys(
  raw: RawConfig,
  warnings: ValidationIssue[],
): void {
  // Each unknown top-level key could be a misspelling the user expects to work.
  for (const key of Object.keys(raw)) {
    // Known keys are understood by merge or another validator.
    if (!KNOWN_TOP_LEVEL_KEYS.has(key)) {
      pushWarning(warnings, key, "unknown top-level key");
    }
  }
}

/**
 * Validate that an optional top-level field is an object before reading nested keys.
 * Use so nested validators can assume a named-field block.
 *
 * @param raw - parsed config object; missing key means the user omitted this optional block
 * @param key - top-level config key; empty would produce an unusable error path
 * @param errors - error accumulator shown to the user
 * @param onValid - nested validator to run when the block is an object
 * @returns nothing; errors or nested validation mutate accumulators
 */
function validateObjectField(
  raw: RawConfig,
  key: string,
  errors: ValidationIssue[],
  onValid: (value: RawConfig) => void,
): void {
  // Missing optional blocks keep defaults and need no validation error.
  if (!(key in raw)) return;
  const value = raw[key];
  // Non-object blocks cannot carry nested settings the user expects.
  if (!isRecord(value)) {
    pushError(errors, key, "must be an object");
    return;
  }
  onValid(value);
}

/**
 * Validate a positive numeric config field.
 * Use for limits where zero or negative values would remove meaningful audit thresholds.
 *
 * @param value - raw field value; missing/non-number values fail when caller chose to validate the field
 * @param path - config path shown to the user; empty would make the error hard to fix
 * @param errors - error accumulator shown to the user
 * @returns nothing; invalid values append an error
 */
function validatePositiveNumber(
  value: unknown,
  path: string,
  errors: ValidationIssue[],
): void {
  // Non-positive values would make configured thresholds unusable.
  if (typeof value !== "number" || value <= 0) {
    pushError(errors, path, "must be a positive number");
  }
}

/**
 * Validate a command-list field as an array of non-empty strings.
 * Use for toolchain and acknowledge lists that are displayed or executed by user-visible flows.
 *
 * @param value - raw list value; non-arrays mean the user did not provide a usable list
 * @param path - config path shown to the user; empty would make the error hard to fix
 * @param errors - error accumulator shown to the user
 * @returns nothing; invalid entries append errors with item indexes
 */
function validateStringArray(
  value: unknown,
  path: string,
  errors: ValidationIssue[],
): void {
  // Non-array lists cannot be rendered or iterated as user commands/items.
  if (!Array.isArray(value)) {
    pushError(errors, path, "must be an array");
    return;
  }
  // Each configured item must be visible and actionable.
  for (const [index, item] of value.entries()) {
    // Blank strings would show as empty commands or acknowledgements.
    if (typeof item !== "string" || item.trim().length === 0) {
      pushError(errors, `${path}[${index}]`, "must be a non-empty string");
    }
  }
}

/**
 * Validate the optional config version field.
 * Use so version labels shown by audit remain plain strings.
 *
 * @param raw - parsed config object; missing version keeps the default version
 * @param _warnings - unused warning accumulator kept for validator signature consistency
 * @param errors - error accumulator shown to the user
 * @returns nothing; invalid version appends an error
 */
function validateVersionField(
  raw: RawConfig,
  _warnings: ValidationIssue[],
  errors: ValidationIssue[],
): void {
  // Missing version is fine; a present value must be printable.
  if ("version" in raw && typeof raw.version !== "string") {
    pushError(errors, "version", "must be a string");
  }
}

/**
 * Warn when the removed legacy agent allowlist appears in config.
 * Use so users know `agents:` no longer scopes commands or dashboard behavior.
 *
 * @param raw - parsed config object; missing agents key means there is no legacy warning
 * @param warnings - warning accumulator shown to the user
 * @param _errors - unused error accumulator kept for validator signature consistency
 * @returns nothing; legacy key appends a warning
 */
function validateLegacyAgentsField(
  raw: RawConfig,
  warnings: ValidationIssue[],
  _errors: ValidationIssue[],
): void {
  // Any non-null agents value is ignored, so warn the user to use `--agent`.
  if (raw.agents != null) {
    pushWarning(
      warnings,
      "agents",
      "ignored; use --agent <id> to scope commands",
    );
  }
}

/**
 * Validate line-limit overrides and the target/limit relationship.
 * Use so instruction-file budget checks show meaningful warning and failure thresholds.
 *
 * @param raw - parsed config object; missing line-limits uses defaults
 * @param _warnings - unused warning accumulator kept for validator signature consistency
 * @param errors - error accumulator shown to the user
 * @returns nothing; invalid fields append errors
 */
function validateLineLimitsField(
  raw: RawConfig,
  _warnings: ValidationIssue[],
  errors: ValidationIssue[],
): void {
  validateObjectField(raw, "line-limits", errors, (value) => {
    // Target controls the soft budget the user sees in instruction audits.
    if ("target" in value)
      validatePositiveNumber(value.target, "line-limits.target", errors);
    // Limit controls the hard budget the user sees in instruction audits.
    if ("limit" in value)
      validatePositiveNumber(value.limit, "line-limits.limit", errors);
    // Target must stay below limit so warning and failure states are distinct.
    if (
      typeof value.target === "number" &&
      typeof value.limit === "number" &&
      value.target >= value.limit
    ) {
      pushError(errors, "line-limits", "target must be less than limit");
    }
  });
}

/**
 * Validate toolchain command arrays.
 * Use so generated prompts and setup guidance do not show malformed command entries.
 *
 * @param raw - parsed config object; missing toolchain leaves command lists empty
 * @param _warnings - unused warning accumulator kept for validator signature consistency
 * @param errors - error accumulator shown to the user
 * @returns nothing; invalid command lists append errors
 */
function validateToolchainField(
  raw: RawConfig,
  _warnings: ValidationIssue[],
  errors: ValidationIssue[],
): void {
  validateObjectField(raw, "toolchain", errors, (value) => {
    // Each optional command family must be a list of commands the user can run.
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

/**
 * Validate an explicit `skills.install` allowlist.
 * Use so setup never installs an empty or malformed skill selection.
 *
 * @param install - raw install allowlist; empty list means the user selected no skills
 * @param errors - error accumulator shown to the user
 * @returns nothing; invalid entries append errors
 */
function validateSkillInstallList(
  install: unknown[],
  errors: ValidationIssue[],
): void {
  // Empty allowlists would make setup install no skills while looking successful.
  if (install.length === 0) {
    pushError(errors, "skills.install", "cannot be empty");
  }
  // Each selected skill must be a string id that installers can compare.
  for (const [index, value] of install.entries()) {
    // Non-string skill ids cannot map to a shipped skill.
    if (typeof value !== "string") {
      pushError(errors, `skills.install[${index}]`, "must be a string");
    }
  }
}

/**
 * Validate the user role field when present.
 * Use so prompts can safely choose a supported user perspective.
 *
 * @param raw - parsed config object; missing userRole keeps the developer default
 * @param _warnings - unused warning accumulator kept for validator signature consistency
 * @param errors - error accumulator shown to the user
 * @returns nothing; invalid role appends an error
 */
function validateUserRoleField(
  raw: RawConfig,
  _warnings: ValidationIssue[],
  errors: ValidationIssue[],
): void {
  // Missing userRole means prompts use the default developer perspective.
  if (!("userRole" in raw)) return;
  const { userRole } = raw;
  // Unknown roles would produce prompt variants the UI/docs do not define.
  if (typeof userRole !== "string" || !KNOWN_USER_ROLES.has(userRole)) {
    pushError(
      errors,
      "userRole",
      `must be one of: ${Array.from(KNOWN_USER_ROLES).join(", ")}`,
    );
  }
}

/**
 * Validate the skills installation policy block.
 * Use so setup/install can trust the user's skill selection and review defaults.
 *
 * @param raw - parsed config object; missing skills block keeps install-all defaults
 * @param _warnings - unused warning accumulator kept for validator signature consistency
 * @param errors - error accumulator shown to the user
 * @returns nothing; invalid fields append errors
 */
function validateSkillsField(
  raw: RawConfig,
  _warnings: ValidationIssue[],
  errors: ValidationIssue[],
): void {
  validateObjectField(raw, "skills", errors, (value) => {
    // Install policy controls which skills the user gets during setup.
    if ("install" in value) {
      const { install } = value;
      // Install must be "all" or a list so setup has a clear selection.
      if (install !== "all" && !Array.isArray(install)) {
        pushError(errors, "skills.install", 'must be "all" or an array');
      // Explicit lists need item-level validation for actionable errors.
      } else if (Array.isArray(install)) {
        validateSkillInstallList(install, errors);
      }
    }

    // Goat-review options are nested because they tune one skill's behavior.
    if ("goat-review" in value) {
      const goatReview = value["goat-review"];
      // Non-object review config cannot carry named options.
      if (!isRecord(goatReview)) {
        pushError(errors, "skills.goat-review", "must be an object");
        return;
      }
      // Local PR base, when present, becomes visible review context.
      if ("local_pr_base" in goatReview) {
        const localPrBase = goatReview.local_pr_base;
        // Blank local PR base would produce unhelpful review comparisons.
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

/**
 * Validate the harness acknowledge list when present.
 * Use so acknowledged audit gaps are explicit strings users can review.
 *
 * @param raw - parsed config object; missing harness block keeps no acknowledgements
 * @param _warnings - unused warning accumulator kept for validator signature consistency
 * @param errors - error accumulator shown to the user
 * @returns nothing; invalid acknowledge entries append errors
 */
function validateHarnessField(
  raw: RawConfig,
  _warnings: ValidationIssue[],
  errors: ValidationIssue[],
): void {
  validateObjectField(raw, "harness", errors, (value) => {
    // Missing acknowledge list means the user has not muted any known harness caveats.
    if (!("acknowledge" in value)) return;
    validateStringArray(value.acknowledge, "harness.acknowledge", errors);
  });
}

/**
 * Validate the hook toggle block when present.
 * Use so dashboard hook switches and hook scripts read explicit, well-shaped config.
 *
 * @param raw - parsed config object; missing hooks block keeps registry defaults
 * @param _warnings - unused warning accumulator kept for validator signature consistency
 * @param errors - error accumulator shown to the user
 * @returns nothing; invalid hook rows append errors
 */
function validateHooksField(
  raw: RawConfig,
  _warnings: ValidationIssue[],
  errors: ValidationIssue[],
): void {
  validateObjectField(raw, "hooks", errors, (value) => {
    // Each hook row configures one dashboard-visible guardrail.
    for (const [hookId, hookValue] of Object.entries(value)) {
      // Hook ids must match registry-style names so dashboard rows can find them.
      if (!/^[a-z0-9][a-z0-9-]*$/u.test(hookId)) {
        pushError(errors, `hooks.${hookId}`, "hook id must be kebab-case");
        continue;
      }
      // Hook rows need named fields such as `enabled`.
      if (!isRecord(hookValue)) {
        pushError(errors, `hooks.${hookId}`, "must be an object");
        continue;
      }
      // Enabled must be explicit so ambiguous strings do not flip a guardrail.
      if (typeof hookValue.enabled !== "boolean") {
        pushError(errors, `hooks.${hookId}.enabled`, "must be a boolean");
      }
      // Binary overrides are optional and validated separately by language key.
      if ("binaries" in hookValue) {
        validateHookBinaries(
          hookValue.binaries,
          `hooks.${hookId}.binaries`,
          errors,
        );
      }
    }
  });
}

/**
 * Validate a hook `binaries` override block: an object mapping language
 * suffixes to non-empty string paths. The hook script enforces the
 * repo-relative and executability rules at runtime; config validation only
 * guards the YAML shape so typos surface in `config-parses`.
 *
 * @param value - raw `hooks.<id>.binaries` value; missing/non-object values cannot configure binaries
 * @param path - dot-separated config path used in emitted issues; empty would hide the bad block
 * @param errors - error accumulator shown to the user; empty means this may be the first binary error
 * @returns nothing; invalid binary entries append errors
 */
function validateHookBinaries(
  value: unknown,
  path: string,
  errors: ValidationIssue[],
): void {
  // Binary overrides must be a map so each language can name one executable.
  if (!isRecord(value)) {
    pushError(errors, path, "must be an object");
    return;
  }
  // Each configured language override must point at a non-empty path.
  for (const [lang, binaryPath] of Object.entries(value)) {
    // Empty binary paths would hide default discovery without providing a replacement.
    if (typeof binaryPath !== "string" || binaryPath.trim() === "") {
      pushError(errors, `${path}.${lang}`, "must be a non-empty string path");
    }
  }
}

/**
 * Validate the telemetry field when present.
 * Use so telemetry can only be explicitly on or off.
 *
 * @param raw - parsed config object; missing telemetry keeps the default disabled state
 * @param _warnings - unused warning accumulator kept for validator signature consistency
 * @param errors - error accumulator shown to the user
 * @returns nothing; invalid telemetry appends an error
 */
function validateTelemetryField(
  raw: RawConfig,
  _warnings: ValidationIssue[],
  errors: ValidationIssue[],
): void {
  // Missing telemetry means the default disabled setting remains in force.
  if (!("telemetry" in raw)) return;
  // Telemetry must be boolean so strings like "false" do not opt users in accidentally.
  if (typeof raw.telemetry !== "boolean") {
    pushError(errors, "telemetry", "must be a boolean");
  }
}

/**
 * Validate learning-loop auto-capture policy when present.
 * Use so future automatic writes only target known durable learning buckets.
 *
 * @param raw - parsed config object; missing learning-loop block keeps auto-capture disabled
 * @param _warnings - unused warning accumulator kept for validator signature consistency
 * @param errors - error accumulator shown to the user
 * @returns nothing; invalid auto-capture fields append errors
 */
function validateLearningLoopField(
  raw: RawConfig,
  _warnings: ValidationIssue[],
  errors: ValidationIssue[],
): void {
  validateObjectField(raw, "learning-loop", errors, (value) => {
    // Missing auto-capture block keeps the writer disabled.
    if (!("auto-capture" in value)) return;
    const autoCapture = value["auto-capture"];
    // Auto-capture settings need named fields for enabled/targets.
    if (!isRecord(autoCapture)) {
      pushError(errors, "learning-loop.auto-capture", "must be an object");
      return;
    }

    // Enabled must be boolean so text values do not accidentally enable writes.
    if ("enabled" in autoCapture && typeof autoCapture.enabled !== "boolean") {
      pushError(
        errors,
        "learning-loop.auto-capture.enabled",
        "must be a boolean",
      );
    }

    // Missing targets mean no learning-loop bucket is selected.
    if (!("targets" in autoCapture)) return;
    // Targets must be an array so users can select multiple durable buckets.
    if (!Array.isArray(autoCapture.targets)) {
      pushError(
        errors,
        "learning-loop.auto-capture.targets",
        "must be an array",
      );
      return;
    }

    // Each target must be one of the durable buckets the learning loop supports.
    for (const [index, target] of autoCapture.targets.entries()) {
      // Unknown targets would route writes to undefined artifact locations.
      if (!isLearningLoopAutoCaptureTarget(target)) {
        pushError(
          errors,
          `learning-loop.auto-capture.targets[${index}]`,
          `must be one of: ${Array.from(LEARNING_LOOP_AUTO_CAPTURE_TARGETS).join(", ")}`,
        );
      }
    }
  });
}

/**
 * Validate the known-gaps field when present.
 * Use so audit caveats remain explicit, readable strings.
 *
 * @param raw - parsed config object; missing known-gaps means no user-declared caveats
 * @param _warnings - unused warning accumulator kept for validator signature consistency
 * @param errors - error accumulator shown to the user
 * @returns nothing; invalid entries append errors
 */
function validateKnownGapsField(
  raw: RawConfig,
  _warnings: ValidationIssue[],
  errors: ValidationIssue[],
): void {
  // Missing known gaps means the user has not declared any caveats.
  if (!("known-gaps" in raw)) return;
  validateStringArray(raw["known-gaps"], "known-gaps", errors);
}

/**
 * Validate the skill-overrides field when present.
 * Use so downstream skill tooling receives a named-field override map.
 *
 * @param raw - parsed config object; missing skill-overrides means no override behavior
 * @param _warnings - unused warning accumulator kept for validator signature consistency
 * @param errors - error accumulator shown to the user
 * @returns nothing; invalid override block appends an error
 */
function validateSkillOverridesField(
  raw: RawConfig,
  _warnings: ValidationIssue[],
  errors: ValidationIssue[],
): void {
  // Missing skill overrides means skills use their built-in behavior.
  if (!("skill-overrides" in raw)) return;
  // Overrides must be a map so each skill can read its own settings.
  if (!isRecord(raw["skill-overrides"])) {
    pushError(errors, "skill-overrides", "must be an object");
  }
}

/**
 * Validate the terminal config block when present.
 * Use so the dashboard terminal idle timeout is explicit and safe.
 *
 * @param raw - parsed config object; missing terminal block keeps the default idle timeout
 * @param _warnings - unused warning accumulator kept for validator signature consistency
 * @param errors - error accumulator shown to the user
 * @returns nothing; invalid terminal fields append errors
 */
function validateTerminalField(
  raw: RawConfig,
  _warnings: ValidationIssue[],
  errors: ValidationIssue[],
): void {
  validateObjectField(raw, "terminal", errors, (value) => {
    // Missing timeout means the dashboard uses the default session cleanup window.
    if (!("idle-timeout" in value)) return;
    const timeout = value["idle-timeout"];
    // Timeout must be a non-negative integer; zero means the user disables idle cleanup.
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
  validateLegacyAgentsField,
  validateLineLimitsField,
  validateSkillsField,
  validateToolchainField,
  validateUserRoleField,
  validateTelemetryField,
  validateLearningLoopField,
  validateKnownGapsField,
  validateSkillOverridesField,
  validateHarnessField,
  validateHooksField,
  validateTerminalField,
];

/**
 * Validate a parsed config object and return structured warnings and errors.
 * Use before merging so invalid YAML never reaches audit, setup, or dashboard consumers.
 *
 * @param raw - parsed YAML value; non-object values mean the user did not provide a config map
 * @returns validation result; invalid configs keep defaults and expose errors to the user
 */
function validateConfig(raw: unknown): ValidationResult {
  const warnings: ValidationIssue[] = [];
  const errors: ValidationIssue[] = [];

  // The root must be an object so every top-level config key can be named.
  if (!isRecord(raw)) {
    pushError(errors, "config", "must be a YAML object");
    return { valid: false, warnings, errors };
  }

  validateUnknownTopLevelKeys(raw, warnings);
  // Validators run in display order so users see stable issue paths.
  for (const validator of CONFIG_VALIDATORS) {
    validator(raw, warnings, errors);
  }

  return { valid: errors.length === 0, warnings, errors };
}

/**
 * Load, parse, validate, and normalize `.goat-flow/config.yaml`; malformed YAML never throws and
 * instead returns a structured invalid config.
 *
 * @param projectRoot - repository root whose config should be loaded; empty uses defaults unless `fs` supplies text
 * @param fs - optional filesystem adapter; absent means read from disk
 * @returns loaded config state; missing or invalid files return defaults plus user-visible status/errors
 */
export function loadConfig(projectRoot: string, fs?: ReadonlyFS): LoadedConfig {
  const content = readConfigText(projectRoot, fs);
  // No config file is valid: the user gets built-in defaults and no warnings.
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
  // Invalid config falls back to defaults while preserving exact errors for the user.
  return {
    exists: true,
    valid: validation.valid,
    config: validation.valid ? mergeConfig(parsed) : cloneDefaults(),
    warnings: validation.warnings,
    errors: validation.errors,
    parseError: null,
  };
}
