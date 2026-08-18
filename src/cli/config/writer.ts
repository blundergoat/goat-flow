/**
 * Minimal `.goat-flow/config.yaml` writer for hook toggle state.
 *
 * The writer only replaces targeted top-level blocks so comments and ordering
 * in the rest of the config file survive normal dashboard toggles.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { dump, load } from "js-yaml";
import { writeFileAtomic } from "../server/safe-exec.js";
import { readHookBinaries, readHookScanRootList } from "./reader.js";

type HookConfigMap = Record<
  string,
  {
    enabled: boolean;
    binaries?: Record<string, string>;
    "scan-roots"?: string[];
  }
>;

const HOOK_IDENTIFIER_ALIASES = new Map([
  ["gruff-on-change", "gruff-code-quality"],
  ["guard-destructive-shell", "deny-dangerous"],
  ["guard-secret-paths", "deny-dangerous"],
  ["guard-repository-writes", "deny-dangerous"],
]);
const HOOK_BLOCK_COMMENT_LINES = new Set([
  "# Togglable goat-flow hook state. Missing entries use registry defaults.",
  "# Manage with the dashboard Hooks page or `goat-flow hooks <enable|disable|sync>`.",
]);
const REMOVED_TOP_LEVEL_BLOCK_COMMENTS = new Map([
  [
    "plan-guard",
    new Set(["# Workflow reminder settings for the plan checkbox guard."]),
  ],
]);

/** Narrow parsed YAML values before reading the hooks block. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    Array.isArray(value) === false
  );
}

/** Resolve the project-local goat-flow config path used by dashboard hook toggles. */
function configPath(projectPath: string): string {
  return join(projectPath, ".goat-flow", "config.yaml");
}

/** Read existing config text or synthesize the minimal config needed before the first toggle write. */
function readConfigText(projectPath: string): string {
  const path = configPath(projectPath);
  if (!existsSync(path)) {
    return [
      "# .goat-flow/config.yaml - project configuration",
      'version: "1.8.0"',
      "",
    ].join("\n");
  }
  return readFileSync(path, "utf-8");
}

/** Map legacy hook ids to canonical ids so old config entries keep their state. */
function normalizeHookIdentifier(hookIdentifier: string): string {
  return HOOK_IDENTIFIER_ALIASES.get(hookIdentifier) ?? hookIdentifier;
}

/**
 * Parse one raw `hooks.<id>` YAML entry into its canonical id and state.
 * Returns null for malformed entries (no boolean `enabled`) so the caller can skip them - a user's hand-edited config never crashes a toggle write.
 *
 * @param hookId - raw hook key as written in config.yaml (may be a legacy alias)
 * @param value - raw YAML value under that key
 * @returns canonical id plus validated state, or null when the entry is malformed
 */
function readHookEntry(
  hookId: string,
  value: unknown,
): { id: string; state: HookConfigMap[string] } | null {
  // Entry without a boolean `enabled` is malformed -> ignore it entirely.
  if (!isRecord(value) || typeof value.enabled !== "boolean") return null;
  const binaries = readHookBinaries(value.binaries);
  const scanRoots = readHookScanRootList(value["scan-roots"]);
  return {
    id: normalizeHookIdentifier(hookId),
    state: {
      enabled: value.enabled,
      ...(binaries ? { binaries } : {}),
      ...(scanRoots ? { "scan-roots": scanRoots } : {}),
    },
  };
}

/** Parse explicitly configured hook states; malformed YAML uses an empty-map fallback. */
function readRawHooks(text: string): HookConfigMap {
  let parsed: unknown;
  try {
    parsed = load(text) ?? {};
  } catch {
    return {};
  }
  // No parseable hooks section -> registry defaults apply for everything.
  if (!isRecord(parsed) || !isRecord(parsed.hooks)) return {};
  const hooks: HookConfigMap = {};
  for (const [hookId, value] of Object.entries(parsed.hooks)) {
    const entry = readHookEntry(hookId, value);
    // Malformed entry -> skip; the hook falls back to its registry default.
    if (!entry) continue;
    // A legacy alias normalizing onto an id that already appeared -> first
    // occurrence wins so canonical entries beat their aliases.
    if (
      entry.id !== hookId &&
      Object.prototype.hasOwnProperty.call(hooks, entry.id)
    ) {
      continue;
    }
    hooks[entry.id] = entry.state;
  }
  return hooks;
}

/** Render the managed hooks block with stable ordering and the operator-facing ownership comment. */
function renderHooksBlock(hooks: HookConfigMap): string {
  const ordered = Object.fromEntries(
    Object.entries(hooks).sort(([a], [b]) => a.localeCompare(b)),
  );
  const dumped = dump({ hooks: ordered }, { lineWidth: 100 }).trimEnd();
  return [
    "# Togglable goat-flow hook state. Missing entries use registry defaults.",
    "# Manage with the dashboard Hooks page or `goat-flow hooks <enable|disable|sync>`.",
    dumped,
  ].join("\n");
}

/** Detect top-level YAML keys so hook-block replacement preserves following config sections. */
function isTopLevelLine(line: string): boolean {
  return /^[A-Za-z0-9_-]+:/u.test(line);
}

/** Replace only the managed top-level hooks block, preserving all unrelated config text. */
function replaceTopLevelHooksBlock(text: string, block: string): string {
  const lines = text.replace(/\s*$/u, "\n").split("\n");
  const start = lines.findIndex((line) => /^hooks:\s*(?:#.*)?$/u.test(line));
  if (start === -1) return `${lines.join("\n").trimEnd()}\n\n${block}\n`;

  let prefixEnd = start;
  while (
    prefixEnd > 0 &&
    HOOK_BLOCK_COMMENT_LINES.has(lines[prefixEnd - 1] ?? "")
  ) {
    prefixEnd -= 1;
  }

  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end] ?? "";
    if (line.trim() !== "" && isTopLevelLine(line)) break;
    end += 1;
  }
  return [...lines.slice(0, prefixEnd), block, ...lines.slice(end)]
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trimEnd()
    .concat("\n");
}

/**
 * Find the line range one top-level config block occupies, so a toggle can replace only that block and leave the user's comments alone.
 *
 * @param lines - config file split into lines
 * @param key - top-level key to locate
 * @returns the block's start and end lines, or null when the key is not in the file yet
 */
function topLevelBlockRange(
  lines: string[],
  key: string,
): { start: number; end: number } | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(key)) return null;
  const start = lines.findIndex((line) =>
    new RegExp(`^${key}:\\s*(?:#.*)?$`, "u").test(line),
  );
  if (start === -1) return null;
  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end] ?? "";
    if (line.trim() !== "" && isTopLevelLine(line)) break;
    end += 1;
  }
  return { start, end };
}

/**
 * Work out how far above a block its own comment header reaches, so replacing the block takes its header with it.
 *
 * @param lines - config file split into lines
 * @param start - first line of the block itself
 * @param key - top-level key being replaced
 * @returns the first line to remove, which equals `start` when the block has no header of its own
 */
function removablePrefixStart(
  lines: string[],
  start: number,
  key: string,
): number {
  const comments = REMOVED_TOP_LEVEL_BLOCK_COMMENTS.get(key);
  if (!comments) return start;
  let prefixStart = start;
  while (prefixStart > 0 && comments.has(lines[prefixStart - 1] ?? "")) {
    prefixStart -= 1;
  }
  if (prefixStart > 0 && (lines[prefixStart - 1] ?? "").trim() === "") {
    prefixStart -= 1;
  }
  return prefixStart;
}

/**
 * Remove one top-level config block from YAML text while preserving the rest of the file.
 * Use when a deprecated dashboard or hook setting should disappear from the user's config.
 *
 * @param text - existing config file text; empty text means there is no visible block to remove
 * @param key - top-level config key to remove; empty cannot match a user-facing config block
 * @returns config text without the block, or the original text when the block is absent
 */
function removeTopLevelBlockFromText(text: string, key: string): string {
  const lines = text.replace(/\s*$/u, "\n").split("\n");
  const range = topLevelBlockRange(lines, key);

  // If the user never had this block, their config stays exactly as it was.
  if (!range) return text;

  const prefixStart = removablePrefixStart(lines, range.start, key);
  return [...lines.slice(0, prefixStart), ...lines.slice(range.end)]
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trimEnd()
    .concat("\n");
}

/** Return the explicitly configured hook state, excluding registry defaults. */
function readHookConfig(projectPath: string): HookConfigMap {
  return readRawHooks(readConfigText(projectPath));
}

/**
 * Return one hook's desired enabled state using the registry default on absence.
 *
 * @param projectPath - project whose goat-flow config stores hook overrides
 * @param hookId - canonical hook id to read
 * @param defaultEnabled - registry default to use when config omits the hook
 * @returns configured enabled state, or the registry default when absent
 */
export function readHookEnabled(
  projectPath: string,
  hookId: string,
  defaultEnabled: boolean,
): boolean {
  return readHookConfig(projectPath)[hookId]?.enabled ?? defaultEnabled;
}

/**
 * Return one hook's explicit project-relative post-turn roots.
 *
 * @param projectPath - selected project whose goat-flow config owns the hook row
 * @param hookId - canonical hook id; hooks without `scan-roots` return no list
 * @returns copied configured roots, or `null` when the hook has no valid explicit list
 */
export function readHookScanRoots(
  projectPath: string,
  hookId: string,
): string[] | null {
  const scanRoots = readHookConfig(projectPath)[hookId]?.["scan-roots"];
  return scanRoots ? [...scanRoots] : null;
}

/**
 * Set one hook's desired enabled state in `.goat-flow/config.yaml`.
 * It writes the file in place, replacing only the hook block so the rest of the user's config, including their comments, survives the toggle.
 *
 * @param projectPath - project whose goat-flow config should be written
 * @param hookId - canonical hook id to update
 * @param enabled - desired enabled state to persist
 */
export function setHookEnabled(
  projectPath: string,
  hookId: string,
  enabled: boolean,
): void {
  const path = configPath(projectPath);
  const text = readConfigText(projectPath);
  const hooks = readRawHooks(text);
  hooks[hookId] = { ...hooks[hookId], enabled };
  mkdirSync(dirname(path), { recursive: true });
  writeFileAtomic(
    path,
    replaceTopLevelHooksBlock(text, renderHooksBlock(hooks)),
    projectPath,
  );
}

/**
 * Remove one hook override from `.goat-flow/config.yaml`.
 * Use when the user clears a hook toggle and should return to the registry default.
 *
 * @param projectPath - project whose config is edited; empty means no project config can be found
 * @param hookId - canonical hook id to remove; empty cannot match a visible hook toggle
 * @returns nothing; absent config or absent hook entries leave the user's config unchanged
 */
export function removeHookConfig(projectPath: string, hookId: string): void {
  const path = configPath(projectPath);

  // No config file means there is no saved user override to remove.
  if (!existsSync(path)) return;

  const text = readConfigText(projectPath);
  const hooks = readRawHooks(text);

  // If this hook was never overridden, the registry default already controls the UI.
  if (!Object.prototype.hasOwnProperty.call(hooks, hookId)) return;

  Reflect.deleteProperty(hooks, hookId);
  writeFileAtomic(
    path,
    replaceTopLevelHooksBlock(text, renderHooksBlock(hooks)),
    projectPath,
  );
}

/**
 * Remove one top-level block from the project's `.goat-flow/config.yaml`, leaving the rest of the user's config untouched.
 *
 * Used when a feature is switched off in the dashboard and its settings should disappear rather than linger as dead configuration.
 *
 * Side effect: rewrites the config file atomically, and does nothing when the file or the block is already absent.
 *
 * @param projectPath - selected project whose config is edited
 * @param key - top-level key to remove; a key that is not present is a no-op rather than an error
 * @returns nothing; an unchanged file is left alone entirely, so no needless write or mtime change occurs
 */
export function removeTopLevelConfigBlock(
  projectPath: string,
  key: string,
): void {
  const path = configPath(projectPath);
  if (!existsSync(path)) return;
  const text = readConfigText(projectPath);
  const next = removeTopLevelBlockFromText(text, key);
  if (next === text) return;
  writeFileAtomic(path, next, projectPath);
}
