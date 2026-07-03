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

type HookConfigMap = Record<
  string,
  { enabled: boolean; binaries?: Record<string, string> }
>;

const HOOK_ID_ALIASES = new Map([
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
  return HOOK_ID_ALIASES.get(hookIdentifier) ?? hookIdentifier;
}

/**
 * Preserve a valid hook `binaries` override block through managed-block
 * rewrites; non-string or empty entries are dropped. Without this, a toggle
 * write would silently delete a user's repo-owned analyzer path overrides.
 *
 * @param value - raw `hooks.<id>.binaries` value from parsed YAML
 * @returns validated language-to-path map, or null when absent or empty
 */
function readHookBinaries(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) return null;
  const binaries: Record<string, string> = {};
  for (const [lang, binaryPath] of Object.entries(value)) {
    if (typeof binaryPath !== "string" || binaryPath.trim() === "") continue;
    binaries[lang] = binaryPath;
  }
  return Object.keys(binaries).length > 0 ? binaries : null;
}

/**
 * Parse one raw `hooks.<id>` YAML entry into its canonical id and state.
 * Returns null for malformed entries (no boolean `enabled`) so the caller
 * can skip them - a user's hand-edited config never crashes a toggle write.
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
  return {
    id: normalizeHookIdentifier(hookId),
    state: binaries
      ? { enabled: value.enabled, binaries }
      : { enabled: value.enabled },
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

function removeTopLevelBlockFromText(text: string, key: string): string {
  const lines = text.replace(/\s*$/u, "\n").split("\n");
  const range = topLevelBlockRange(lines, key);
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
 * Set one hook's desired enabled state in `.goat-flow/config.yaml`.
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

export function removeHookConfig(projectPath: string, hookId: string): void {
  const path = configPath(projectPath);
  if (!existsSync(path)) return;
  const text = readConfigText(projectPath);
  const hooks = readRawHooks(text);
  if (!Object.prototype.hasOwnProperty.call(hooks, hookId)) return;
  Reflect.deleteProperty(hooks, hookId);
  writeFileAtomic(
    path,
    replaceTopLevelHooksBlock(text, renderHooksBlock(hooks)),
    projectPath,
  );
}

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
