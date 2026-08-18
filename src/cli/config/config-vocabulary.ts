/**
 * The set of things a user is allowed to write in `.goat-flow/config.yaml`.
 *
 * Both halves of config handling read from here: the validator that tells a user when they mistyped something, and the merger that folds accepted
 * values into the running config.
 * Keeping the vocabulary in one place means a key can never be quietly accepted by one and rejected by the other.
 *
 * Everything arriving from a config file is `unknown` - it is a text file a person edited by hand - so the guards here are the boundary where
 * hand-written YAML becomes trusted data.
 *
 * A value that fails one of these is reported with its key name rather than silently dropped, because a typo the user never hears about looks to them
 * like the setting did nothing.
 */
import type { LearningLoopAutoCaptureTarget } from "./types.js";

/**
 * Recognized keys one level inside each named config block.
 *
 * Top-level typos were already reported, but a misspelling below the root was indistinguishable from leaving the setting out: the validator read the
 * fields it knew and never looked at the rest, so `learning-loop.auto-captrue` and an omitted block produced identical output.
 * Keyed by the config path of the owning block.
 *
 * Blocks whose keys are user-chosen names are deliberately absent.
 * `hooks` is keyed by hook id and `quality` is handed to `loadQualityConfig` unparsed, so neither has a closed key set to check against;
 * `HOOK_ROW_KEYS` covers the fixed fields inside one hook row instead.
 */
export const KNOWN_NESTED_KEYS = new Map<string, ReadonlySet<string>>([
  ["line-limits", new Set(["target", "limit"])],
  ["toolchain", new Set(["test", "lint", "build", "package", "format"])],
  ["skills", new Set(["install", "goat-review"])],
  ["harness", new Set(["acknowledge"])],
  ["terminal", new Set(["idle-timeout"])],
  ["learning-loop", new Set(["auto-capture"])],
  ["learning-loop.auto-capture", new Set(["enabled", "targets"])],
]);

/** Fixed fields inside one `hooks.<hook-id>` row; the row key itself is a hook id. */
export const HOOK_ROW_KEYS: ReadonlySet<string> = new Set([
  "enabled",
  "binaries",
  "scan-roots",
]);

/** Top-level config keys recognized by the validator (others trigger warnings). */
export const KNOWN_TOP_LEVEL_KEYS = new Set([
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

/** Valid userRole values accepted in the config file. */
export const KNOWN_USER_ROLES = new Set([
  "developer",
  "investigator",
  "tester",
]);

/** Valid durable learning-loop targets accepted for future auto-capture. */
export const LEARNING_LOOP_AUTO_CAPTURE_TARGETS: ReadonlySet<string> =
  new Set<LearningLoopAutoCaptureTarget>([
    "lessons",
    "footguns",
    "patterns",
    "decisions",
  ]);

/**
 * Check that a config value is a plain object before reading named fields from it.
 * Use on every nested config section, so a user who wrote a list where a block belongs gets a message naming that key instead of an error from
 * somewhere deeper in the load.
 *
 * @param candidate - value parsed from the user's YAML; null and arrays are not objects here
 * @returns true when named fields can be read; false means the section is malformed and the
 *   caller reports it rather than merging anything from it
 */
export function isRecord(
  candidate: unknown,
): candidate is Record<string, unknown> {
  return (
    candidate !== null &&
    typeof candidate === "object" &&
    Array.isArray(candidate) === false
  );
}

/**
 * Check whether a value names a supported learning-loop auto-capture target.
 * Use when filtering future auto-capture config so unknown targets do not create files in random buckets.
 *
 * @param candidate - raw target value; missing or non-string values are ignored
 * @returns whether the target can be shown and written as a durable learning-loop bucket
 */
export function isLearningLoopAutoCaptureTarget(
  candidate: unknown,
): candidate is LearningLoopAutoCaptureTarget {
  return (
    typeof candidate === "string" &&
    LEARNING_LOOP_AUTO_CAPTURE_TARGETS.has(candidate)
  );
}
