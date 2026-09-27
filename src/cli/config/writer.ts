/**
 * Read and prepare the selected project's saved hook choices for CLI and dashboard actions.
 *
 * Targeted changes preserve unrelated top-level settings and comments.
 * Guarded Sync prepares config in memory; direct writers persist their own changes atomically.
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
import {
  isPolicyHook,
  parsePolicyChoices,
  readPolicyChoices,
} from "../../../workflow/hooks/hook-policy-state.cjs";
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
  // A first toggle needs a config file before its choice can be saved.
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
 * Find a supported project-local analyzer when the user enables Gruff without configuring a binary.
 *
 * Only executable files inside the project qualify; missing or inaccessible candidates leave discovery unset as a safe fallback.
 *
 * @param projectPath - selected project whose existing Python environment may supply the analyzer
 * @returns project-relative analyzer paths, or null to leave discovery unset when no usable local analyzer exists
 */
function conventionalGruffBinaries(
  projectPath: string,
): Record<string, string> | null {
  let projectRealPath: string;
  try {
    projectRealPath = realpathSync(projectPath);
  } catch {
    // A project moved or became unreadable after selection; leave analyzer discovery unset.
    return null;
  }

  const binaries: Record<string, string> = {};
  // Check only supported project locations when the user enables Gruff without choosing a binary.
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
      // Do not save a launcher that points outside the selected project or cannot identify an executable file.
      if (escapesProject || !statSync(binaryRealPath).isFile()) continue;
      binaries[language] = relativeBinaryPath;
    } catch {
      // Ignore missing or unusable local analyzers; for example, the user may not have created this project's Python environment.
    }
  }
  // No usable local analyzer leaves the user's binary choice unset for normal discovery.
  return Object.keys(binaries).length > 0 ? binaries : null;
}

/** Map legacy hook ids to canonical ids so old config entries keep their state. */
function normalizeHookIdentifier(hookIdentifier: string): string {
  // Current IDs and unknown custom IDs keep their spelling; only known legacy IDs are migrated.
  return HOOK_IDENTIFIER_ALIASES.get(hookIdentifier) ?? hookIdentifier;
}

/**
 * Read one saved hook choice, returning null when its enabled value is not a boolean.
 * Guarded sync validates YAML separately; this reader only decides which explicit choices are usable.
 *
 * @param hookId - raw hook key as written in config.yaml (may be a legacy alias)
 *
 * @param hookEntry - raw YAML value under that key
 * @returns canonical id plus validated state, or null when the entry is malformed
 */
function readHookEntry(
  hookId: string,
  hookEntry: unknown,
): { id: string; state: HookConfigMap[string] } | null {
  // Ignore a malformed saved switch so status can use the hook's default; guarded writes validate policy choices separately.
  if (!isRecord(hookEntry) || typeof hookEntry.enabled !== "boolean")
    return null;
  // An explicit empty binary map preserves the user's choice to use discovery instead of saving a conventional launcher.
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

/**
 * Read explicit hook choices for status and config preparation.
 * Malformed YAML uses an empty-map fallback; guarded operations validate the same text before allowing writes.
 *
 * @param text - captured YAML; empty text has no saved choices
 * @returns valid explicit choices; an empty map means none could be read
 */
export function readConfiguredHookChoices(text: string): HookConfigMap {
  let parsed: unknown;
  try {
    // An empty config contains no saved switches, so status starts with registry defaults.
    parsed = load(text) ?? {};
  } catch {
    // A hand-edited YAML syntax error supplies no readable choices; guarded sync validates separately before writing.
    return {};
  }
  // Without a readable hooks section, status has no saved overrides and uses registry defaults.
  if (!isRecord(parsed) || !isRecord(parsed.hooks)) return {};
  const hooks: HookConfigMap = {};
  // Read each saved choice so valid overrides survive aliases and unrelated malformed entries.
  for (const [hookId, value] of Object.entries(parsed.hooks)) {
    const entry = readHookEntry(hookId, value);
    // An unusable switch contributes no override, leaving that hook on its registry default.
    if (!entry) continue;
    // An alias cannot replace a choice already read under its canonical ID; a later canonical entry can still replace an earlier alias.
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
    Object.entries(hooks).sort(([leftHookId], [rightHookId]) =>
      leftHookId.localeCompare(rightHookId),
    ),
  );
  const dumped = dump({ hooks: ordered }, { lineWidth: 100 }).trimEnd();
  return [
    "# Togglable goat-flow hook state. Missing entries use registry defaults.",
    "# Manage with the dashboard Hooks page or `goat-flow hooks <enable|disable|sync>`.",
    dumped,
  ].join("\n");
}

/**
 * Identify a saved top-level setting so hook edits stop before the next configuration section.
 *
 * @param line - one configuration line; blank lines, comments, and indented settings do not start a new section
 * @returns true for a plain or quoted top-level key, including whitespace before its colon
 */
function isTopLevelConfigKey(line: string): boolean {
  return /^(?:[A-Za-z0-9_-]+|"(?:[^"\\]|\\.)*"|'(?:[^']|'')*')[ \t]*:/u.test(
    line,
  );
}

/**
 * Keep other settings' references to shared hook choices valid after a toggle replaces the hooks block.
 *
 * @param header - saved hooks header; an empty header or one without an anchor has no shared name to retain
 *
 * @param block - prepared replacement block containing the user's new choices
 * @returns replacement text with the saved anchor, or the unchanged block when no anchor was saved
 */
function retainHooksAnchor(header: string, block: string): string {
  const anchor = /^(?:hooks|"hooks"|'hooks')[ \t]*:[ \t]*(&[^\s,[\]{}]+)/u.exec(
    header,
  )?.[1];
  // Another saved setting may reference the hooks block through a YAML alias; an unshared block needs no anchor.
  return anchor ? block.replace(/^hooks:/mu, () => `hooks: ${anchor}`) : block;
}

/**
 * Prepare the hook section after a toggle or cleanup without replacing following configuration sections.
 *
 * @param text - captured configuration; an empty document receives its first hook section
 *
 * @param block - rendered hook choices and their generated guidance, ready to replace the saved section
 * @returns configuration containing the prepared choices and the other saved settings
 */
function replaceTopLevelHooksBlock(text: string, block: string): string {
  const lines = text.replace(/\s*$/u, "\n").split("\n");
  const start = lines.findIndex((line) =>
    /^(?:hooks|"hooks"|'hooks')[ \t]*:/u.test(line),
  );
  // Append a hooks section when the user has not saved any hook settings yet.
  if (start === -1) return `${lines.join("\n").trimEnd()}\n\n${block}\n`;

  // Keep any shared YAML name while replacing this section; a missing header has no name to retain.
  const replacement = retainHooksAnchor(lines[start] ?? "", block);

  let prefixEnd = start;
  // Replace generated guidance with its hook section so repeated toggles do not accumulate duplicate instructions.
  while (
    prefixEnd > 0 &&
    HOOK_BLOCK_COMMENT_LINES.has(lines[prefixEnd - 1] ?? "")
  ) {
    prefixEnd -= 1;
  }

  let end = start + 1;
  // Walk only the saved hook section; the next top-level key belongs to another project setting.
  while (end < lines.length) {
    // A missing line is a blank separator, never a new setting that could end this section.
    const line = lines[end] ?? "";
    // Stop at the next setting so changing hooks preserves the rest of the project config.
    if (line.trim() !== "" && isTopLevelConfigKey(line)) break;
    end += 1;
  }
  return [...lines.slice(0, prefixEnd), replacement, ...lines.slice(end)]
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trimEnd()
    .concat("\n");
}

/**
 * Find the line range one top-level config block occupies, so a toggle can replace only that block and leave the user's comments alone.
 *
 * @param lines - config file split into lines
 *
 * @param key - top-level key to locate
 * @returns the block's start and end lines, or null when the key is not in the file yet
 */
function topLevelBlockRange(
  lines: string[],
  key: string,
): { start: number; end: number } | null {
  // Only a literal supported setting name can select a block for removal.
  if (!/^[A-Za-z0-9_-]+$/u.test(key)) return null;
  const start = lines.findIndex((line) =>
    new RegExp(`^${key}:\\s*(?:#.*)?$`, "u").test(line),
  );
  // An absent setting needs no replacement or cleanup.
  if (start === -1) return null;
  let end = start + 1;
  // Find this setting's full section before cleanup so neighboring feature settings survive.
  while (end < lines.length) {
    // Blank or unavailable lines remain inside this section until the next top-level setting.
    const line = lines[end] ?? "";
    // The next top-level setting belongs to another feature and must survive this edit.
    if (line.trim() !== "" && isTopLevelConfigKey(line)) break;
    end += 1;
  }
  return { start, end };
}

/**
 * Work out how far above a block its own comment header reaches, so replacing the block takes its header with it.
 *
 * @param lines - config file split into lines
 * @param start - first line of the block itself
 *
 * @param key - top-level key being replaced
 * @returns the first line to remove, which equals `start` when the block has no header of its own
 */
function removablePrefixStart(
  lines: string[],
  start: number,
  key: string,
): number {
  const comments = REMOVED_TOP_LEVEL_BLOCK_COMMENTS.get(key);
  // Without a known generated header, preserve the user's preceding comments.
  if (!comments) return start;
  let prefixStart = start;
  // Take only this setting's known generated header; a missing line cannot claim the user's preceding notes.
  while (prefixStart > 0 && comments.has(lines[prefixStart - 1] ?? "")) {
    prefixStart -= 1;
  }
  // Remove the header's separating blank line so cleanup does not leave an empty section.
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
 *
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
  return readConfiguredHookChoices(readConfigText(projectPath));
}

/**
 * Return one saved choice; policies validate strict config and default on when absent.
 *
 * @param projectPath - project whose goat-flow config stores hook overrides
 * @param hookId - canonical hook id to read
 *
 * @param isEnabledByDefault - registry default for non-policy hooks when config omits the hook
 *
 * @returns configured enabled state, or the applicable default when absent
 * @throws when policy config is malformed, ambiguous, unreadable or unsafe
 */
export function readHookEnabled(
  projectPath: string,
  hookId: string,
  isEnabledByDefault: boolean,
): boolean {
  // Safety policies require strict validation and stay on when the user has not saved a choice.
  if (isPolicyHook(hookId))
    // A missing policy entry retains protection until the user explicitly turns it off.
    return readPolicyChoices(projectPath)[hookId] ?? true;
  // Other hook rows use the registry default when the user has not saved an override.
  return readHookConfig(projectPath)[hookId]?.enabled ?? isEnabledByDefault;
}

/**
 * Return one hook's explicit project-relative post-turn roots.
 *
 * @param projectPath - selected project whose goat-flow config owns the hook row
 *
 * @param hookId - canonical hook id; hooks without `scan-roots` return no list
 * @returns copied configured roots, or `null` when the hook has no valid explicit list
 */
export function readHookScanRoots(
  projectPath: string,
  hookId: string,
): string[] | null {
  const scanRoots = readHookConfig(projectPath)[hookId]?.["scan-roots"];
  // No valid saved root list means explicit scan coverage is unconfigured; callers decide whether the project root is sufficient.
  return scanRoots ? [...scanRoots] : null;
}

/** Return a YAML value with any trailing comment removed; quotes are not tracked because scan roots never need a literal `#`. */
function yamlValueWithoutComment(rawValue: string): string {
  return rawValue.replace(/\s+#.*$/u, "").trim();
}

/** Return true for `*roots`, `&roots ...`, or a flow list such as `[*api_root, packages/web]` written on the `scan-roots:` line. */
function scanRootInlineValueUsesYamlAlias(inlineValue: string): boolean {
  // An anchor or alias here cannot be read by the post-turn hook's simpler config parser.
  if (/^[*&]/u.test(inlineValue)) return true;
  return inlineValue.startsWith("[") && /[[,]\s*[*&]/u.test(inlineValue);
}

/**
 * Return true when the block list under a `scan-roots:` key has an item written as `- *name` or `- &name`.
 * Every deeper `- item` line belongs to scan-roots until the indent returns to the key's level or above.
 *
 * @param lines - config text split into lines
 * @param keyLineIndex - index of the `scan-roots:` line; items are searched below it
 *
 * @param keyIndent - indent of that key; a line at this indent or shallower ends the list
 * @returns true on the first alias or anchor item; false when the list ends without one
 */
function scanRootBlockListUsesYamlAlias(
  lines: string[],
  keyLineIndex: number,
  keyIndent: number,
): boolean {
  // Inspect the user's scan-root list until the next setting begins.
  for (
    let itemIndex = keyLineIndex + 1;
    itemIndex < lines.length;
    itemIndex += 1
  ) {
    // An unavailable list line acts as a blank separator and adds no scan folder.
    const itemLine = lines[itemIndex] ?? "";
    // Blank lines between selected scan folders do not end the list.
    if (itemLine.trim().length === 0) continue;
    const itemIndent = itemLine.length - itemLine.trimStart().length;
    // A setting at the same or shallower indentation belongs outside this scan-root list.
    if (itemIndent <= keyIndent) break;
    // An aliased folder cannot safely become a post-turn scan target.
    if (/^\s*-\s*[*&]/u.test(itemLine)) return true;
  }
  return false;
}

/**
 * Check for YAML aliases before registering the user's post-turn scan folders.
 * The CLI resolves aliases, but post-turn-safety.sh cannot; accepting them would fail at the end of the agent's turn.
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
 *
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
  // Other settings do not affect whether post-turn scan roots can be registered.
  if (!keyMatch) return false;
  // An empty value may introduce a block list below; it does not itself name an aliased scan folder.
  const inlineValue = yamlValueWithoutComment(keyMatch[1] ?? "");
  // An unsupported inline alias is enough to refuse registration before a turn ends.
  if (scanRootInlineValueUsesYamlAlias(inlineValue)) return true;
  // Only a key that starts its line can own a block list beneath it.
  const blockKeyMatch = /^(\s*)scan-roots\s*:/u.exec(line);
  // A missing block key owns no list; zero indentation means its list is checked from the top-level boundary.
  return (
    blockKeyMatch !== null &&
    scanRootBlockListUsesYamlAlias(lines, index, blockKeyMatch[1]?.length ?? 0)
  );
}

/** Resolve the first Git choice from the legacy policy or the fresh-install default. */
function initialGitHookChoice(hooks: HookConfigMap): { enabled: boolean } {
  // Explicit upgrade migration inherits the old combined switch; a fresh project starts with Git protection on.
  return { enabled: hooks["deny-dangerous"]?.enabled ?? true };
}

/** Preserve the existing hook sibling indentation; an empty block uses two spaces. */
function hookChildIndent(text: string, headerEnd: number): string {
  const firstChild = text
    .slice(headerEnd)
    .split(/\r?\n/u)
    .find((line) => line.trim() !== "" && !line.trimStart().startsWith("#"));
  // A new or empty hook section gets two-space indentation; existing siblings keep their saved style.
  return firstChild?.match(/^( +)\S/u)?.[1] ?? "  ";
}

/** Insert the selected Git choice without rewriting another hook's YAML. Side effects: mutates the supplied hook map only on fallback. */
function insertGitHookChoice(
  text: string,
  hooks: HookConfigMap,
  isGitEnabled: boolean,
): string {
  const header =
    /^(?:hooks|"hooks"|'hooks')[ \t]*:[ \t]*((?:&[\w-]+[ \t]*)?)([^\r\n]*)/mu.exec(
      text,
    );
  const entry = `  deny-git-mutations:\n    enabled: ${isGitEnabled}`;
  // Keep the user's existing YAML style when adding the separate Git protection choice.
  if (header) {
    // A missing header value means this section has no inline choices and can accept an indented entry.
    const headerValue = (header[2] ?? "").trim();
    // An empty or comment-only header uses a normal indented hook entry.
    if (headerValue === "" || headerValue.startsWith("#")) {
      // Insert one child without resolving aliases or rewriting another hook's grammar.
      const end = header.index + header[0].length;
      const indent = hookChildIndent(text, end);
      const blockEntry = `${indent}deny-git-mutations:\n${indent.repeat(2)}enabled: ${isGitEnabled}`;
      return `${text.slice(0, end)}\n${blockEntry}${text.slice(end)}`;
    }
    // Keep an inline hooks mapping inline when adding the explicit choice.
    if (headerValue.startsWith("{")) {
      const open = header.index + header[0].indexOf("{") + 1;
      const separator = text.slice(open).trimStart().startsWith("}") ? "" : ",";
      return `${text.slice(0, open)} deny-git-mutations: { enabled: ${isGitEnabled} }${separator}${text.slice(open)}`;
    }
    // Preserve the user's shared YAML settings through a merge while adding this explicit choice.
    if (/^\*[\w-]+(?:\s+#.*)?$/u.test(headerValue)) {
      return text.replace(header[0], `hooks:\n  <<: ${header[2]}\n${entry}`);
    }
  }
  hooks["deny-git-mutations"] = { enabled: isGitEnabled };
  return replaceTopLevelHooksBlock(text, renderHooksBlock(hooks));
}

/**
 * Save the inherited Git protection choice before an older combined toggle can change it.
 * Writes config atomically while preserving existing choices and unrelated settings.
 *
 * @param projectPath - selected target whose hook choices are migrated in place
 * @returns nothing; an existing Git choice leaves the config untouched
 */
export function migrateGitHookChoice(projectPath: string): void {
  readPolicyChoices(projectPath);
  const text = readConfigText(projectPath);
  parsePolicyChoices(text);
  const hooks = readConfiguredHookChoices(text);
  // A saved Git protection choice takes precedence over migration from the older combined toggle.
  if (hooks["deny-git-mutations"] !== undefined) return;
  const next = insertGitHookChoice(
    text,
    hooks,
    initialGitHookChoice(hooks).enabled,
  );
  const path = configPath(projectPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileAtomic(path, next, projectPath);
}

/**
 * Set one hook's desired enabled state in `.goat-flow/config.yaml`.
 * It writes the file in place, replacing only the hook block so the rest of the user's config, including their comments, survives the toggle.
 *
 * @param projectPath - project whose goat-flow config should be written
 *
 * @param hookId - canonical hook id to update
 * @param isEnabled - desired enabled state to persist
 */
export function setHookEnabled(
  projectPath: string,
  hookId: string,
  isEnabled: boolean,
): void {
  readPolicyChoices(projectPath);
  const path = configPath(projectPath);
  const text = readConfigText(projectPath);
  parsePolicyChoices(text);
  const hooks = readConfiguredHookChoices(text);
  // Ordinary writes save the on default; legacy inheritance belongs to explicit migration.
  hooks["deny-git-mutations"] ??= { enabled: true };
  const currentHook = hooks[hookId];
  // Enabling Gruff may save a supported local analyzer; other toggles and explicit binary choices need no discovery.
  const detectedBinaries =
    hookId === "gruff-code-quality" &&
    isEnabled &&
    currentHook?.binaries === undefined
      ? conventionalGruffBinaries(projectPath)
      : null;
  // Keep the user's saved binary map, including an empty map; use discovery only when that choice is absent.
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
 * Remove a retired top-level setting while preserving the rest of the user's config.
 * Writes atomically only when the section exists; missing config or an absent section causes no write.
 *
 * @param projectPath - selected project whose config is edited
 *
 * @param key - top-level key to remove; a key that is not present is a no-op rather than an error
 * @returns nothing; an unchanged file is left alone entirely, so no needless write or mtime change occurs
 */
export function removeTopLevelConfigBlock(
  projectPath: string,
  key: string,
): void {
  const path = configPath(projectPath);
  // A project without config has no retired section to remove.
  if (!existsSync(path)) return;
  const text = readConfigText(projectPath);
  const next = removeTopLevelBlockFromText(text, key);
  // Avoid touching the file when the requested section is already absent.
  if (next === text) return;
  writeFileAtomic(path, next, projectPath);
}

/** Remove only retired overrides so Sync cannot leave a choice whose managed registration no longer exists. */
function removeRetiredHookChoices(
  choices: HookConfigMap,
  removedHookIds: readonly string[],
): boolean {
  let hasRemovedChoice = false;
  // Each retired id is owned by the registry; unrelated user configuration remains outside this cleanup.
  for (const hookId of removedHookIds) {
    // Remove only a saved retired choice; current hook choices stay available to the user.
    if (Object.prototype.hasOwnProperty.call(choices, hookId)) {
      Reflect.deleteProperty(choices, hookId);
      hasRemovedChoice = true;
    }
  }
  return hasRemovedChoice;
}

/** Apply the user's explicit choice, discovering a conventional analyzer only when enabling Gruff without a configured binary. */
function applyPreparedHookChoice(
  choices: HookConfigMap,
  toggle: { hookId: string; enabled: boolean },
  projectPath: string,
): void {
  const current = choices[toggle.hookId];
  // Preserve an explicit binary choice; enabling Gruff without one can discover a usable project-local analyzer.
  const binaries =
    current?.binaries ??
    (toggle.hookId === "gruff-code-quality" && toggle.enabled
      ? conventionalGruffBinaries(projectPath)
      : null);
  choices[toggle.hookId] = {
    ...current,
    enabled: toggle.enabled,
    ...(binaries ? { binaries } : {}),
  };
}

/**
 * Prepare the selected project's hook choices for Sync or a toggle using captured config bytes.
 * Invalid YAML refuses the operation before it can erase saved choices.
 *
 * @param text - captured config; null creates a first config, while empty text supplies no saved choices
 * @param projectPath - selected project used to discover an existing local analyzer
 *
 * @param toggle - explicit requested choice; omitted for Sync, which preserves enabled choices
 * @param removedHookIds - retired registry IDs to remove; an empty list preserves every current choice
 *
 * @returns complete config preserving saved and default-on choices, with retired settings reconciled
 * @throws when the source or prepared YAML is invalid
 */
export function prepareHookConfig(
  text: string | null,
  projectPath: string,
  toggle?: { hookId: string; enabled: boolean },
  removedHookIds: readonly string[] = [],
): string {
  // Sync on a project without config prepares its first document; an existing empty document keeps its own identity.
  const original =
    text ??
    '# .goat-flow/config.yaml - project configuration\nversion: "1.8.0"\n';
  parsePolicyChoices(original);
  // An empty YAML document has no saved sections and can receive the user's first hook choices.
  const parsed = load(original) ?? {};
  // A list or scalar cannot safely hold hook choices; refuse before Sync changes the project.
  if (
    !isRecord(parsed) ||
    (parsed.hooks !== undefined && !isRecord(parsed.hooks))
  ) {
    throw new Error(
      "Hook config must contain a YAML mapping: .goat-flow/config.yaml",
    );
  }
  const hooks = readConfiguredHookChoices(original);
  // Ordinary Sync saves the default-on Git choice only when the user has no explicit Git setting.
  let next =
    hooks["deny-git-mutations"] === undefined
      ? insertGitHookChoice(original, hooks, true)
      : original;
  load(next);
  const desired = readConfiguredHookChoices(next);
  let hasHookChange = removeRetiredHookChoices(desired, removedHookIds);
  // Sync preserves configured choices; a toggle replaces only its explicitly selected choice.
  if (toggle) {
    applyPreparedHookChoice(desired, toggle, projectPath);
    hasHookChange = true;
  }
  // Rewrite the hooks section only when a toggle or retired choice changed it.
  if (hasHookChange)
    next = replaceTopLevelHooksBlock(next, renderHooksBlock(desired));
  next = removeTopLevelBlockFromText(next, "plan-guard");
  load(next);
  return next;
}
