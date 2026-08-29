/**
 * Minimal `.goat-flow/config.yaml` writer for hook toggle state.
 *
 * The writer only replaces targeted top-level blocks so comments and ordering
 * in the rest of the config file survive normal dashboard toggles.
 */
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
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
const CONVENTIONAL_GRUFF_BINARIES = [
  ["py", "strands_agents/.venv/bin/gruff-py"],
] as const;
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
function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  return (
    candidate !== null &&
    typeof candidate === "object" &&
    Array.isArray(candidate) === false
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

/**
 * Return executable analyzers at exact project conventions without searching arbitrary subtrees.
 * A resolved path must remain a regular file inside the selected project; existing config overrides win when the caller merges this result.
 * Error behavior: swallows inaccessible roots or candidates into an omitted result instead of blocking hook configuration.
 */
function conventionalGruffBinaries(
  projectPath: string,
): Record<string, string> | null {
  let projectRealPath: string;
  try {
    projectRealPath = realpathSync(projectPath);
  } catch {
    return null;
  }

  const binaries: Record<string, string> = {};
  for (const [language, relativeBinaryPath] of CONVENTIONAL_GRUFF_BINARIES) {
    try {
      const candidatePath = join(projectPath, relativeBinaryPath);
      accessSync(candidatePath, constants.X_OK);
      const binaryRealPath = realpathSync(candidatePath);
      const relativeRealPath = relative(projectRealPath, binaryRealPath);
      const escapesProject =
        relativeRealPath === ".." ||
        relativeRealPath.startsWith(`..${sep}`) ||
        isAbsolute(relativeRealPath);
      if (escapesProject || !statSync(binaryRealPath).isFile()) continue;
      binaries[language] = relativeBinaryPath;
    } catch {
      // A missing, unreadable, or non-executable convention leaves discovery unchanged.
    }
  }
  return Object.keys(binaries).length > 0 ? binaries : null;
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
 * @param hookEntry - raw YAML value under that key
 * @returns canonical id plus validated state, or null when the entry is malformed
 */
function readHookEntry(
  hookId: string,
  hookEntry: unknown,
): { id: string; state: HookConfigMap[string] } | null {
  // Entry without a boolean `enabled` is malformed -> ignore it entirely.
  if (!isRecord(hookEntry) || typeof hookEntry.enabled !== "boolean")
    return null;
  const configuredBinaries =
    readHookBinaries(hookEntry.binaries) ??
    (isRecord(hookEntry.binaries) ? {} : null);
  const scanRoots = readHookScanRootList(hookEntry["scan-roots"]);
  return {
    id: normalizeHookIdentifier(hookId),
    state: {
      enabled: hookEntry.enabled,
      ...(configuredBinaries ? { binaries: configuredBinaries } : {}),
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
 * @param isEnabledByDefault - registry default to use when config omits the hook
 * @returns configured enabled state, or the registry default when absent
 */
export function readHookEnabled(
  projectPath: string,
  hookId: string,
  isEnabledByDefault: boolean,
): boolean {
  return readHookConfig(projectPath)[hookId]?.enabled ?? isEnabledByDefault;
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

/** Return a YAML value with any trailing comment removed; quotes are not tracked because scan roots never need a literal `#`. */
function yamlValueWithoutComment(rawValue: string): string {
  return rawValue.replace(/\s+#.*$/u, "").trim();
}

/** Return true for `*roots`, `&roots ...`, or a flow list such as `[*api_root, packages/web]` written on the `scan-roots:` line. */
function scanRootInlineValueUsesYamlAlias(inlineValue: string): boolean {
  if (/^[*&]/u.test(inlineValue)) return true;
  return inlineValue.startsWith("[") && /[[,]\s*[*&]/u.test(inlineValue);
}

/**
 * Return true when the block list under a `scan-roots:` key has an item written as `- *name` or `- &name`.
 * Every deeper `- item` line belongs to scan-roots until the indent returns to the key's level or above.
 *
 * @param lines - config text split into lines
 * @param keyLineIndex - index of the `scan-roots:` line; items are searched below it
 * @param keyIndent - indent of that key; a line at this indent or shallower ends the list
 * @returns true on the first alias or anchor item; false when the list ends without one
 */
function scanRootBlockListUsesYamlAlias(
  lines: string[],
  keyLineIndex: number,
  keyIndent: number,
): boolean {
  for (
    let itemIndex = keyLineIndex + 1;
    itemIndex < lines.length;
    itemIndex += 1
  ) {
    const itemLine = lines[itemIndex] ?? "";
    if (itemLine.trim().length === 0) continue;
    const itemIndent = itemLine.length - itemLine.trimStart().length;
    if (itemIndent <= keyIndent) break;
    if (/^\s*-\s*[*&]/u.test(itemLine)) return true;
  }
  return false;
}

/**
 * Tell whether the project's `scan-roots` entry is written with a YAML anchor or alias in any shape the hook runtime cannot read.
 * Use before registering post-turn scan roots: js-yaml resolves `*name` and `&name` for the CLI, but the hook's own parser inside
 * post-turn-safety.sh does not, so a registration that accepts them would fail closed at Stop time with a misleading message.
 *
 * @param projectPath - selected project whose `.goat-flow/config.yaml` is inspected as text; a missing file has no scan roots
 * @returns true when a `scan-roots` value, flow list item, or block list item starts with `*` or `&`
 */
export function hookScanRootsUseYamlAliases(projectPath: string): boolean {
  const lines = readConfigText(projectPath).split(/\r?\n/u);
  return lines.some((line, index) =>
    scanRootLineUsesYamlAlias(lines, line, index),
  );
}

/**
 * Tell whether one config line is a `scan-roots:` key whose value, inline or in the block list below it, uses a YAML alias or anchor.
 *
 * @param lines - whole config text split into lines, needed to read a block list beneath the key
 * @param line - the line being inspected
 * @param index - its position in `lines`
 * @returns true for an alias or anchor in this key's value; false for other lines, comments, and plain lists
 */
function scanRootLineUsesYamlAlias(
  lines: string[],
  line: string,
  index: number,
): boolean {
  // A commented-out example such as `# scan-roots: *roots` configures nothing.
  if (line.trimStart().startsWith("#")) return false;
  // The key may sit mid-line inside a flow mapping, `post-turn-safety: { scan-roots: *roots }`, so match it anywhere.
  const keyMatch = /scan-roots\s*:(.*)$/u.exec(line);
  if (!keyMatch) return false;
  const inlineValue = yamlValueWithoutComment(keyMatch[1] ?? "");
  if (scanRootInlineValueUsesYamlAlias(inlineValue)) return true;
  // Only a key that starts its line can own a block list beneath it.
  const blockKeyMatch = /^(\s*)scan-roots\s*:/u.exec(line);
  return (
    blockKeyMatch !== null &&
    scanRootBlockListUsesYamlAlias(lines, index, blockKeyMatch[1]?.length ?? 0)
  );
}

/**
 * Set one hook's desired enabled state in `.goat-flow/config.yaml`.
 * It writes the file in place, replacing only the hook block so the rest of the user's config, including their comments, survives the toggle.
 *
 * @param projectPath - project whose goat-flow config should be written
 * @param hookId - canonical hook id to update
 * @param isEnabled - desired enabled state to persist
 */
export function setHookEnabled(
  projectPath: string,
  hookId: string,
  isEnabled: boolean,
): void {
  const path = configPath(projectPath);
  const text = readConfigText(projectPath);
  const hooks = readRawHooks(text);
  const currentHook = hooks[hookId];
  const detectedBinaries =
    hookId === "gruff-code-quality" &&
    isEnabled &&
    currentHook?.binaries === undefined
      ? conventionalGruffBinaries(projectPath)
      : null;
  const binaries = currentHook?.binaries ?? detectedBinaries;
  hooks[hookId] = {
    ...currentHook,
    enabled: isEnabled,
    ...(binaries ? { binaries } : {}),
  };
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
