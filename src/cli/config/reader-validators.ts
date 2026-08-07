/**
 * Tells a user exactly what is wrong with their `.goat-flow/config.yaml` before anything runs.
 * Each validator owns one config section and reports problems by key name, so someone who
 * mistyped a value gets a message pointing at the line they wrote rather than a failure
 * surfacing later from a command that looks unrelated.
 *
 * The split between errors and warnings is the part that matters to a user. An error means
 * the config cannot be trusted and defaults are used instead; a warning means the setting was
 * understood but is unusual or unrecognised, and their project still runs as written. Unknown
 * top-level keys are warnings on purpose - a config written for a newer goat-flow should not
 * stop an older one from working.
 */
import { isReleaseVersion } from "../version-compare.js";
import type { ValidationIssue, ValidationResult } from "./types.js";
import {
  isLearningLoopAutoCaptureTarget,
  isRecord,
  KNOWN_TOP_LEVEL_KEYS,
  KNOWN_USER_ROLES,
  LEARNING_LOOP_AUTO_CAPTURE_TARGETS,
} from "./config-vocabulary.js";

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
  // Missing version is fine; a present value must name one published release shape.
  if ("version" in raw) {
    if (typeof raw.version !== "string") {
      pushError(errors, "version", "must be a string");
    } else if (!isReleaseVersion(raw.version)) {
      pushError(errors, "version", "must use numeric X.Y.Z release format");
    }
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
export function validateConfig(raw: unknown): ValidationResult {
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
