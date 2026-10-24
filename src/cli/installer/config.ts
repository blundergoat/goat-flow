/** Narrow text migrations preserve user choices, comments and newline style. */
import { load } from "js-yaml";

/** Add one absent ignore entry; equivalent spellings keep the original bytes. */
export function ensureIgnoreEntry(content: string, entry: string): string {
  const equivalent = new Set([
    entry,
    entry.replace(/\/$/u, ""),
    `/${entry}`,
    `/${entry.replace(/\/$/u, "")}`,
    `**/${entry}`,
    `**/${entry.replace(/\/$/u, "")}`,
  ]);
  if (content.split(/\r?\n/u).some((line) => equivalent.has(line.trim())))
    return content;
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  return `${content}${content && !/\r?\n$/u.test(content) ? eol : ""}${entry}${eol}`;
}

/** Refresh only an admitted top-level numeric version, preserving its comment. */
export function updateConfigVersion(content: string, version: string): string {
  const entry =
    /^((?:version|"version"|'version')[ \t]*:[ \t]*(?:&[^\s#]+[ \t]+)?)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^#\r\n]*?)([ \t]*(?:#[^\r\n]*)?)(\r?)$/m;
  if (!entry.test(content))
    throw new Error("Config version cannot be safely refreshed.");
  return content.replace(
    entry,
    (_match, prefix: string, comment: string, newline: string) =>
      `${prefix}"${version}"${comment}${newline}`,
  );
}

/** The saved hook mapping controls which defaults remain absent. */
type HookMap = Record<string, { enabled?: boolean }>;

/** Invalid or non-mapping user YAML cannot provide saved toggle values. */
function readHookMap(content: string): HookMap | null {
  try {
    const config = load(content) as { hooks?: unknown } | null;
    const hooks = config?.hooks;
    return hooks !== null && typeof hooks === "object" && !Array.isArray(hooks)
      ? (hooks as HookMap)
      : null;
  } catch {
    return null;
  }
}

/** Defaults are inserted only when the corresponding saved key is absent. */
function hookDefaults(enabled: string) {
  return [
    ["deny-dangerous", enabled],
    ["deny-git-mutations", enabled],
    ["post-turn-safety", "true"],
    ["gruff-code-quality", "false"],
  ] as const;
}

/** Quoted YAML punctuation cannot open or close a flow mapping. */
function quotedFlowCharacter(
  character: string,
  state: { single: boolean; double: boolean; escaped: boolean },
): boolean {
  if (state.escaped) {
    state.escaped = false;
    return true;
  }
  if (state.double && character === "\\") {
    state.escaped = true;
    return true;
  }
  if (!state.double && character === "'") {
    state.single = !state.single;
    return true;
  }
  if (!state.single && character === '"') {
    state.double = !state.double;
    return true;
  }
  return state.single || state.double;
}

/** Locate the first mapping's closing brace without interpreting quoted braces. */
function flowMappingCloseIndex(line: string): number {
  let depth = 0;
  const quotes = { single: false, double: false, escaped: false };
  const start = line.indexOf("{");
  if (start === -1) return -1;
  for (let index = start; index < line.length; index += 1) {
    const character = line.charAt(index);
    if (quotedFlowCharacter(character, quotes)) continue;
    if (character === "{" || character === "[") {
      depth += 1;
      continue;
    }
    if (!"}]".includes(character)) continue;
    depth -= 1;
    if (depth === 0) return character === "}" ? index : -1;
    if (depth < 0) return -1;
  }
  return -1;
}

/** Preserve the indentation chosen by the first existing hook entry. */
function hookEntryIndent(lines: string[], hooksIndex: number): string {
  const firstChild = lines
    .slice(hooksIndex + 1)
    .find((line) => line.trim() !== "" && !line.trimStart().startsWith("#"));
  return (firstChild ?? "").match(/^( +)\S/u)?.[1] ?? "  ";
}

/** Carry an explicit legacy dangerous-hook choice to a missing Git-hook toggle. */
function legacyDangerousChoice(hooks: HookMap | null): string {
  const saved = hooks?.["deny-dangerous"]?.enabled;
  return typeof saved === "boolean" ? String(saved) : "true";
}

function insertHookEntry(
  lines: string[],
  hooksIndex: number,
  hookId: string,
  enabled: string,
  parsedHooks: HookMap | null,
) {
  const indent = hookEntryIndent(lines, hooksIndex);
  const hookRe = new RegExp(`^${indent}${hookId}:\\s*$`, "u");
  // An existing text or parsed hook entry is the user's choice and is not inserted again.
  if (
    lines.some((line) => hookRe.test(line)) ||
    Object.prototype.hasOwnProperty.call(parsedHooks ?? {}, hookId)
  ) {
    return false;
  }
  let insertAt = hooksIndex + 1;
  const siblingRe = new RegExp(`^${indent}[A-Za-z0-9_-]+:\\s*$`, "u");
  // Place a missing hook after its existing siblings instead of disturbing their order.
  while (insertAt < lines.length && siblingRe.test(lines[insertAt] ?? "")) {
    insertAt += 1;
    // Skip each sibling's nested settings so the new hook stays at the correct level.
    while (
      insertAt < lines.length &&
      (lines[insertAt] ?? "").startsWith(`${indent} `)
    )
      insertAt += 1;
  }
  lines.splice(
    insertAt,
    0,
    `${indent}${hookId}:`,
    `${indent.repeat(2)}enabled: ${enabled}`,
  );
  return true;
}

function insertFlowHookEntry(line: string, hookId: string, enabled: string) {
  const openIndex = line.indexOf("{");
  const closeIndex = flowMappingCloseIndex(line);
  // Without an opening mapping brace, leave the user's hook text unchanged.
  if (openIndex === -1) return null;
  const entry = `${hookId}: { enabled: ${enabled} }`;
  // A valid multiline flow mapping can accept a new first entry, including a trailing comma.
  if (closeIndex === -1)
    return `${line.slice(0, openIndex + 1)} ${entry},${line.slice(openIndex + 1)}`;
  const body = line.slice(openIndex + 1, closeIndex);
  const trimmedBody = body.replace(/\s+$/u, "");
  const mutatedBody =
    body.trim().length === 0
      ? ` ${entry} `
      : `${trimmedBody}${trimmedBody.endsWith(",") ? "" : ","} ${entry} `;
  return `${line.slice(0, openIndex + 1)}${mutatedBody}${line.slice(closeIndex)}`;
}

/** Splice missing entries into a valid flow mapping, leaving all existing keys intact. */
function mergeFlowHooks(
  lines: string[],
  index: number,
  hooks: HookMap | null,
  enabled: string,
): boolean {
  if (hooks === null) return false;
  let changed = false;
  for (const [id, setting] of hookDefaults(enabled)) {
    if (Object.hasOwn(hooks, id)) continue;
    const next = insertFlowHookEntry(lines[index] ?? "", id, setting);
    if (next === null) break;
    lines[index] = next;
    changed = true;
  }
  return changed;
}

/** Preserve aliases through a merge key and append absent block entries at the existing indentation. */
function mergeBlockHooks(
  lines: string[],
  index: number,
  hooks: HookMap | null,
  enabled: string,
  node: string,
): boolean {
  let changed = false;
  const missing = hookDefaults(enabled).some(
    ([id]) => !Object.hasOwn(hooks ?? {}, id),
  );
  if (hooks !== null && missing && /^\*[^\s]+(?:\s+#.*)?$/u.test(node)) {
    const line = lines[index] ?? "";
    lines[index] = line.slice(0, line.indexOf(":") + 1);
    lines.splice(index + 1, 0, `  <<: ${node}`);
    changed = true;
  }
  for (const [id, setting] of hookDefaults(enabled))
    changed = insertHookEntry(lines, index, id, setting, hooks) || changed;
  return changed;
}

/** Fill missing current hook toggles without changing saved choices or newline style. */
export function ensureConfigHooks(content: string): string {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const hadFinalNewline = /\r?\n$/u.test(content);
  const lines = content.split(/\r?\n/u);
  if (hadFinalNewline) lines.pop();
  const hooks = readHookMap(content);
  const index = lines.findIndex((line) =>
    /^(?:hooks|"hooks"|'hooks')\s*:/u.test(line),
  );
  if (index === -1) return appendHookDefaults(content, eol);
  const enabled = legacyDangerousChoice(hooks);
  const line = lines[index] ?? "";
  const node = line
    .slice(line.indexOf(":") + 1)
    .trim()
    .replace(/^&[^\s]+[ \t]+/u, "");
  const changed = mergeHooks(lines, index, hooks, enabled, node);
  if (!changed) return content;
  const migrated = `${lines.join(eol)}${hadFinalNewline ? eol : ""}`;
  if (hooks !== null) load(migrated);
  return migrated;
}

/** Keep flow and block YAML insertion rules separate from newline preservation. */
function mergeHooks(
  lines: string[],
  index: number,
  hooks: HookMap | null,
  enabled: string,
  node: string,
): boolean {
  return node.startsWith("{")
    ? mergeFlowHooks(lines, index, hooks, enabled)
    : mergeBlockHooks(lines, index, hooks, enabled, node);
}

/** Scaffold explicit controls after all existing project content. */
function appendHookDefaults(content: string, eol: string): string {
  let next = content;
  // Separate a newly appended hooks section from a final line that lacks a newline.
  if (next.length > 0 && !/\r?\n$/u.test(next)) next += eol;
  next += [
    "",
    "# Hook toggles for goat-flow-shipped hooks.",
    "hooks:",
    "  deny-dangerous:",
    "    enabled: true",
    "  deny-git-mutations:",
    "    enabled: true",
    "  post-turn-safety:",
    "    enabled: true",
    "  gruff-code-quality:",
    "    enabled: false",
    "",
  ].join(eol);
  return next;
}
