/**
 * Reads each agent's hook config and reports which goat-flow guard hooks are
 * registered, normalizing the many per-agent settings shapes (Claude, Antigravity,
 * and others) into simple registered/path facts the audit can compare.
 *
 * Parsing is deliberately defensive: unknown agents, missing hook objects, and
 * malformed entries resolve to "not registered" rather than throwing, because a
 * fact extractor must survive any settings file a user hands it. Antigravity is
 * special-cased - its deny hook lives in a top-level keyed definition with its own
 * enabled flag, not under the shared `hooks` object.
 */
import type { AgentProfile, ReadonlyFS } from "../../types.js";
import { pushUniquePath } from "./routing.js";

/** Result of resolving one hook event to its registered script path. */
interface HookRegistrationMatch {
  isRegistered: boolean;
  path: string | null;
}

/** Normalize hook command arguments into a repo-relative shell-script path. */
function normalizeHookPath(candidate: string): string | null {
  if (!candidate) return null;
  let path = candidate.trim();
  if (!path) return null;
  path = path.replace(/^['"`]|['"`]$/g, "");
  // Hook launchers prefix the script path with a resolved repo root, either as
  // an inline substitution ($(git rev-parse --show-toplevel)/...sh) or a shell
  // variable ($root/...sh, $REPO/...sh) populated earlier in the command. Strip
  // either prefix so callers see a repo-relative script path.
  const substitutionMatch = path.match(/\$(?:\([^)]*\)|\{?\w+\}?)\/(.*\.sh)$/);
  if (substitutionMatch && substitutionMatch[1]) {
    path = substitutionMatch[1];
  }
  if (!path.endsWith(".sh")) return null;
  return path;
}

/** Extract normalized shell-script paths from one hook command string. */
function extractHookPathsFromCommand(command: string): string[] {
  const pathCandidates: string[] = [];
  const quotedMatches = command.matchAll(/["']([^"']+\.sh)["']/g);
  for (const match of quotedMatches) {
    const path = match[1];
    if (path === undefined) continue;
    const normalized = normalizeHookPath(path);
    if (normalized) pushUniquePath(pathCandidates, normalized);
  }

  const unquotedMatches = command.matchAll(/([^\s"'`]+\.sh)/g);
  for (const match of unquotedMatches) {
    const path = match[1];
    if (path === undefined) continue;
    const normalized = normalizeHookPath(path);
    if (normalized) pushUniquePath(pathCandidates, normalized);
  }

  return pathCandidates;
}

/** Return the preferred shell-script path referenced by a list of hook commands. */
function preferredHookPathFromCommands(commands: string[]): string | null {
  const paths: string[] = [];
  for (const command of commands) {
    const candidates = extractHookPathsFromCommand(command);
    for (const candidate of candidates) pushUniquePath(paths, candidate);
  }
  const preferred =
    paths.find((path) => path.endsWith("/post-turn-safety.sh")) ??
    paths.find((path) => path.endsWith("/deny-dangerous.sh")) ??
    paths.find((path) => path.endsWith("/guard-repository-writes.sh")) ??
    paths.find((path) => !path.endsWith("/plan-checkbox-guard.sh")) ??
    null;
  return preferred;
}

/** Return the parsed `hooks` object from settings when it exists. */
function readHooksObject(
  settingsParsed: unknown,
): Record<string, unknown> | null {
  if (!settingsParsed || typeof settingsParsed !== "object") return null;
  const hooks = (settingsParsed as Record<string, unknown>).hooks;
  if (!hooks || typeof hooks !== "object") return null;
  return hooks as Record<string, unknown>;
}

/** Return one Antigravity top-level hook definition by goat-flow hook id. */
function readAntigravityHookDefinition(
  hookConfigParsed: unknown,
  hookId: string,
): Record<string, unknown> | null {
  if (!hookConfigParsed || typeof hookConfigParsed !== "object") return null;
  const definition = (hookConfigParsed as Record<string, unknown>)[hookId];
  if (!definition || typeof definition !== "object") return null;
  return definition as Record<string, unknown>;
}

/** Return the first Antigravity top-level hook definition registered for the post-turn event. */
function readAntigravityPostTurnRegistration(
  agent: AgentProfile,
  hookConfigParsed: unknown,
): HookRegistrationMatch | null {
  if (agent.id !== "antigravity" || !agent.hookEvents?.postTurn) return null;
  if (!hookConfigParsed || typeof hookConfigParsed !== "object") return null;

  const commands: string[] = [];
  for (const definition of Object.values(
    hookConfigParsed as Record<string, unknown>,
  )) {
    if (!definition || typeof definition !== "object") continue;
    const hookDefinition = definition as Record<string, unknown>;
    if (hookDefinition.enabled === false) continue;
    commands.push(
      ...extractCommandsFromEventConfig(
        hookDefinition,
        agent.hookEvents.postTurn,
      ),
    );
  }
  const path = preferredHookPathFromCommands(commands);
  return { isRegistered: path !== null, path };
}

/** Extract the shell command from one hook entry when it uses command mode. */
function hasSupportedHookType(hookObj: Record<string, unknown>): boolean {
  return (
    hookObj.type === undefined ||
    hookObj.type === "command" ||
    hookObj.type === "Command"
  );
}

/** Read one shell command field from a normalized hook object. */
function readHookCommand(hookObj: Record<string, unknown>): string | null {
  if (typeof hookObj.bash === "string") return hookObj.bash;
  if (typeof hookObj.command === "string") return hookObj.command;
  const nestedCommand = hookObj.command;
  if (!nestedCommand || typeof nestedCommand !== "object") return null;
  return typeof (nestedCommand as Record<string, unknown>).bash === "string"
    ? ((nestedCommand as Record<string, unknown>).bash as string)
    : null;
}

/** Extract the shell command from supported hook payload shapes. */
function extractCommandFromHook(hook: unknown): string | null {
  if (!hook || typeof hook !== "object") return null;
  const hookObj = hook as Record<string, unknown>;
  if (!hasSupportedHookType(hookObj)) return null;
  return readHookCommand(hookObj);
}

/** Extract all shell commands declared inside one event registration entry. */
function extractCommandsFromEventEntry(entry: unknown): string[] {
  if (!entry || typeof entry !== "object") return [];
  const directCommand = extractCommandFromHook(entry);
  if (directCommand !== null) return [directCommand];
  const eventHooks = (entry as Record<string, unknown>).hooks;
  if (!Array.isArray(eventHooks)) return [];

  const commands: string[] = [];
  for (const hook of eventHooks) {
    const command = extractCommandFromHook(hook);
    if (command !== null) commands.push(command);
  }
  return commands;
}

/** Extract all shell commands from one normalized event config. */
function extractCommandsFromEventConfig(
  hooks: Record<string, unknown>,
  event: string | null,
): string[] {
  if (!event) return [];
  const rawEvent = hooks[event];
  if (!Array.isArray(rawEvent)) return [];

  const commands: string[] = [];
  for (const entry of rawEvent) {
    commands.push(...extractCommandsFromEventEntry(entry));
  }
  return commands;
}

/** Normalize one event's hook registration into a simple registered/path pair. */
function normalizeEventConfig(
  hooks: Record<string, unknown>,
  event: string | null,
): HookRegistrationMatch {
  const commands = extractCommandsFromEventConfig(hooks, event);
  const path = preferredHookPathFromCommands(commands);
  return { isRegistered: path !== null, path };
}

/**
 * Resolve the parsed hook config for one agent, reusing the already-parsed
 * settings file when the agent stores hooks there and only reading a separate
 * file otherwise - this avoids parsing the same file twice.
 *
 * @param fs - read-only filesystem adapter used only when hooks live in a separate file
 * @param agent - agent profile naming its settings and hook-config files
 * @param settingsParsed - already-parsed settings content, reused when it doubles as the hook config
 * @param settingsValid - whether that pre-parsed settings content parsed successfully
 * @returns the parsed hook config and its validity; both default to null/false when the agent declares no hook file
 */
export function readHookConfig(
  fs: ReadonlyFS,
  agent: AgentProfile,
  settingsParsed: unknown,
  settingsValid: boolean,
): { parsed: unknown; valid: boolean } {
  if (!agent.hookConfigFile) {
    return { parsed: null, valid: false };
  }
  if (agent.hookConfigFile === agent.settingsFile) {
    return { parsed: settingsParsed, valid: settingsValid };
  }
  const parsed = fs.readJson(agent.hookConfigFile);
  return { parsed, valid: parsed !== null };
}

/**
 * Report whether the agent's post-turn (learning-loop) hook is registered and
 * which script it points at. Returns the not-registered shape for agents that
 * declare no hook events or whose config has no usable `hooks` object.
 *
 * @param agent - agent profile naming its post-turn hook event, if any
 * @param hookConfigParsed - parsed hook config from readHookConfig, or null/invalid content
 * @returns post-turn registration flag and resolved script path; path is null when not registered
 */
export function buildHookRegistration(
  agent: AgentProfile,
  hookConfigParsed: unknown,
): {
  postTurnRegistered: boolean;
  postTurnRegisteredPath: string | null;
} {
  const antigravityPostTurn = readAntigravityPostTurnRegistration(
    agent,
    hookConfigParsed,
  );
  if (antigravityPostTurn !== null) {
    return {
      postTurnRegistered: antigravityPostTurn.isRegistered,
      postTurnRegisteredPath: antigravityPostTurn.path,
    };
  }

  const hooks = readHooksObject(hookConfigParsed);
  if (!hooks) {
    return {
      postTurnRegistered: false,
      postTurnRegisteredPath: null,
    };
  }

  if (!agent.hookEvents) {
    return { postTurnRegistered: false, postTurnRegisteredPath: null };
  }
  const postTurn = normalizeEventConfig(hooks, agent.hookEvents.postTurn);
  return {
    postTurnRegistered: postTurn.isRegistered,
    postTurnRegisteredPath: postTurn.path,
  };
}

/**
 * Report whether the dangerous-command deny guard is registered as a pre-tool
 * hook, and its script path. Antigravity is handled separately because its deny
 * hook is a top-level keyed definition with its own `enabled` flag, so an
 * explicit `enabled: false` there counts as not registered.
 *
 * @param agent - agent profile naming its pre-tool hook event and identifying Antigravity
 * @param hookConfigParsed - parsed hook config from readHookConfig, or null/invalid content
 * @returns deny registration flag and resolved script path; path is null when not registered or disabled
 */
export function buildDenyRegistration(
  agent: AgentProfile,
  hookConfigParsed: unknown,
): { denyIsRegistered: boolean; denyRegisteredPath: string | null } {
  if (agent.id === "antigravity") {
    if (!agent.hookEvents) {
      return { denyIsRegistered: false, denyRegisteredPath: null };
    }
    const denyDefinition =
      readAntigravityHookDefinition(hookConfigParsed, "deny-dangerous") ??
      readAntigravityHookDefinition(
        hookConfigParsed,
        "guard-repository-writes",
      );
    if (!denyDefinition || denyDefinition.enabled === false) {
      return { denyIsRegistered: false, denyRegisteredPath: null };
    }
    const preTool = normalizeEventConfig(
      denyDefinition,
      agent.hookEvents.preTool,
    );
    return {
      denyIsRegistered: preTool.isRegistered,
      denyRegisteredPath: preTool.path,
    };
  }

  const hooks = readHooksObject(hookConfigParsed);
  if (!hooks) {
    return { denyIsRegistered: false, denyRegisteredPath: null };
  }

  if (!agent.hookEvents) {
    return { denyIsRegistered: false, denyRegisteredPath: null };
  }
  const preTool = normalizeEventConfig(hooks, agent.hookEvents.preTool);
  return {
    denyIsRegistered: preTool.isRegistered,
    denyRegisteredPath: preTool.path,
  };
}
