/**
 * Minimal `.goat-flow/config.yaml` writer for hook toggle state.
 *
 * The writer only replaces the top-level `hooks:` block so comments and
 * ordering in the rest of the config file survive normal dashboard toggles.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { dump, load } from "js-yaml";
import { writeFileAtomic } from "../server/safe-exec.js";

type HookConfigMap = Record<string, { enabled: boolean }>;

const HOOK_ID_ALIASES = new Map([["gruff-on-change", "gruff-code-quality"]]);
const HOOK_BLOCK_COMMENT_LINES = new Set([
  "# Togglable goat-flow hook state. Missing entries use registry defaults.",
  "# Manage with the dashboard Hooks page or `goat-flow hooks <enable|disable|sync>`.",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    Array.isArray(value) === false
  );
}

function configPath(projectPath: string): string {
  return join(projectPath, ".goat-flow", "config.yaml");
}

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

function normalizeHookId(hookId: string): string {
  return HOOK_ID_ALIASES.get(hookId) ?? hookId;
}

function readRawHooks(text: string): HookConfigMap {
  let parsed: unknown;
  try {
    parsed = load(text) ?? {};
  } catch {
    return {};
  }
  if (!isRecord(parsed) || !isRecord(parsed.hooks)) return {};
  const hooks: HookConfigMap = {};
  for (const [hookId, value] of Object.entries(parsed.hooks)) {
    if (!isRecord(value) || typeof value.enabled !== "boolean") continue;
    const normalizedHookId = normalizeHookId(hookId);
    if (
      normalizedHookId !== hookId &&
      Object.prototype.hasOwnProperty.call(hooks, normalizedHookId)
    ) {
      continue;
    }
    hooks[normalizedHookId] = { enabled: value.enabled };
  }
  return hooks;
}

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

function isTopLevelLine(line: string): boolean {
  return /^[A-Za-z0-9_-]+:/u.test(line);
}

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

/** Return the explicitly configured hook state, excluding registry defaults. */
function readHookConfig(projectPath: string): HookConfigMap {
  return readRawHooks(readConfigText(projectPath));
}

/** Return one hook's desired enabled state using the registry default on absence. */
export function readHookEnabled(
  projectPath: string,
  hookId: string,
  defaultEnabled: boolean,
): boolean {
  return readHookConfig(projectPath)[hookId]?.enabled ?? defaultEnabled;
}

/** Set one hook's desired enabled state in `.goat-flow/config.yaml`. */
export function setHookEnabled(
  projectPath: string,
  hookId: string,
  enabled: boolean,
): void {
  const path = configPath(projectPath);
  const text = readConfigText(projectPath);
  const hooks = readRawHooks(text);
  hooks[hookId] = { enabled };
  mkdirSync(dirname(path), { recursive: true });
  writeFileAtomic(
    path,
    replaceTopLevelHooksBlock(text, renderHooksBlock(hooks)),
    projectPath,
  );
}
