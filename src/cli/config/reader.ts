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
import {
  isLearningLoopAutoCaptureTarget,
  isRecord,
  KNOWN_USER_ROLES,
} from "./config-vocabulary.js";
import { validateConfig } from "./reader-validators.js";
import type { GoatFlowConfig, LoadedConfig } from "./types.js";

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
    const scanRoots = readHookScanRootList(hookValue["scan-roots"]);
    hooks[hookId] = {
      enabled: hookValue.enabled,
      ...(binaries ? { binaries } : {}),
      ...(scanRoots ? { scanRoots } : {}),
    };
  }
  merged.hooks = hooks;
}

/**
 * Narrow a raw post-turn `scan-roots` field to one non-empty string list.
 * Use in both config normalization and toggle writes so the YAML key round-trips unchanged.
 *
 * @param rawScanRoots - raw `hooks.post-turn-safety.scan-roots` value; absent or malformed input has no usable roots
 * @returns copied path list, or `null` when the field cannot define a complete root contract
 */
export function readHookScanRootList(rawScanRoots: unknown): string[] | null {
  // An empty or partial list cannot safely opt a non-Git workspace into post-turn scanning.
  if (
    !Array.isArray(rawScanRoots) ||
    rawScanRoots.length === 0 ||
    rawScanRoots.some(
      (scanRoot) =>
        typeof scanRoot !== "string" || scanRoot.trim().length === 0,
    )
  ) {
    return null;
  }
  return [...rawScanRoots] as string[];
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
