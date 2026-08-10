/**
 * Reads and writes the hook registrations users run in supported coding agents.
 * Use when setup, hook toggles, or sync must show the same enabled state everywhere.
 * The registrar owns script files; this module owns the Claude, Codex,
 * Antigravity, and Copilot configuration shapes.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentProfile } from "../types.js";
import {
  LEGACY_DENY_DANGEROUS_HOOK_IDS,
  LEGACY_DENY_DANGEROUS_SCRIPT_NAMES,
  agentRegistersHostTimeout,
  commandEntryReferencesSpec,
  entryMatchesSpecCommand,
  entryMatchesSpecRegistration,
  entryMatchesSpecTimeout,
  entryReferencesSpec,
  isAgentHookJsonObject,
  managedAgentHookCommand,
  matcherForAgent,
  type AgentHookJsonObject,
} from "./agent-hook-command.js";
import { writeFileAtomic } from "./safe-exec.js";
import type { HookSpec } from "./hooks-registry.js";

export { buildAgentHookCommand } from "./agent-hook-command.js";

/** Result of reading an agent hook config without mutating it. */
export interface AgentHookReadState {
  installed: boolean;
  configMissing?: boolean;
  configInvalid?: boolean;
  registrationIssue?: AgentHookRegistrationIssue;
}

/** First registry-owned registration link a Hooks screen can ask the user to repair. */
export type AgentHookRegistrationIssue =
  | "registration-missing"
  | "retired-registration"
  | "event-mismatch"
  | "matcher-mismatch"
  | "command-or-response-mismatch"
  | "timeout-mismatch";

/**
 * Resolve the config file that stores one agent's user-visible hook state.
 * Use before status or sync reads and writes the selected project.
 *
 * @param projectPath - selected project; empty text cannot identify an owned config root
 * @param agent - selected agent; a null hook config means this provider cannot host managed hooks
 * @returns config path for the selected agent; never empty for a hook-capable profile
 * @throws when the agent has no hook configuration surface
 */
function configPath(projectPath: string, agent: AgentProfile): string {
  // A provider without a config surface cannot store the hook the user selected.
  if (!agent.hookConfigFile) {
    throw new Error(`${agent.id} has no hook config file`);
  }
  return join(projectPath, agent.hookConfigFile);
}

/**
 * Read hook config without mutating malformed or missing user files.
 * Use when status or sync needs a safe object plus repair flags.
 *
 * @param path - selected agent config path; empty text behaves like a missing file
 * @returns parsed config and flags; an empty object means the file is missing, invalid, or not an object
 * @throws Never; unreadable or malformed user files return an invalid repair state
 */
function readJsonFile(path: string): {
  value: AgentHookJsonObject;
  missing: boolean;
  invalid: boolean;
} {
  // A missing config tells the Hooks screen that this agent has not registered the hook.
  if (!existsSync(path)) return { value: {}, missing: true, invalid: false };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    return {
      value: isAgentHookJsonObject(parsed) ? parsed : {},
      missing: false,
      invalid: !isAgentHookJsonObject(parsed),
    };
  } catch {
    // For example, the user may have a half-written JSON file after an interrupted editor save.
    return { value: {}, missing: false, invalid: true };
  }
}

/**
 * Translate one registry event into the selected provider's config key.
 * Use so setup writes the lifecycle the user's agent actually reads.
 *
 * @param agent - selected provider; an empty id cannot pass profile validation
 * @param spec - managed hook; an empty event cannot produce a runnable registration
 * @returns provider event key; never empty for a valid registry hook
 */
function hookEventKey(agent: AgentProfile, spec: HookSpec): string {
  // Copilot uses camel-case event names while the other supported configs use registry spelling.
  if (agent.id === "copilot") {
    return spec.event === "PreToolUse" ? "preToolUse" : "postToolUse";
  }
  return spec.event;
}

/**
 * Return the writable hooks object, replacing an unsafe user value with an empty container.
 * Use immediately before setup changes provider event arrays.
 *
 * @param config - parsed config; empty means setup creates only the managed hooks container
 * @returns mutable hooks object; never null or an array
 */
function ensureHooksObject(config: AgentHookJsonObject): AgentHookJsonObject {
  // A missing, null, or non-object hooks value cannot safely contain event rows.
  if (!isAgentHookJsonObject(config.hooks)) config.hooks = {};
  return config.hooks as AgentHookJsonObject;
}

/**
 * Return the mutable rows for one provider lifecycle event.
 * Use when setup adds or removes the user's managed registration.
 *
 * @param config - parsed agent config; empty means the event array is created
 * @param event - provider event key; empty text would create an unusable property
 * @returns event rows; empty means the user has no registrations for this lifecycle
 */
function eventEntries(config: AgentHookJsonObject, event: string): unknown[] {
  const hooks = ensureHooksObject(config);
  // A missing or malformed event value becomes an empty list ready for managed entries.
  if (!Array.isArray(hooks[event])) hooks[event] = [];
  return hooks[event] as unknown[];
}

/**
 * Split a shared matcher into the individual rows Claude and Codex display.
 * Use while writing or checking tool-triggered hook registrations.
 *
 * @param matcher - pipe-delimited registry matcher; empty text yields no event rows
 * @returns trimmed non-empty matcher parts; empty means no tool-specific registration
 */
function matcherParts(matcher: string): string[] {
  return matcher
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Remove only rows that launch the selected managed hook.
 * Use before disable or replacement so user-authored hooks remain untouched.
 *
 * @param config - parsed agent config; empty means there are no rows to remove
 * @param event - provider lifecycle key; empty text cannot name a valid managed event
 * @param spec - managed hook contract; empty script metadata matches no user command
 * @returns nothing; an empty result removes the event value from the config
 */
function removeHookEntries(
  config: AgentHookJsonObject,
  event: string,
  spec: HookSpec,
) {
  const entries = eventEntries(config, event);
  const next = entries.filter((entry) => !entryReferencesSpec(entry, spec));
  const hooks = ensureHooksObject(config);
  // No retained rows means the user should not see an empty provider event group.
  if (next.length === 0) {
    hooks[event] = undefined;
    return;
  }
  hooks[event] = next;
}

/**
 * Build the exact Claude or Codex rows setup shows in agent config.
 * Use when enabling Stop or tool-triggered coverage for either provider.
 *
 * @param agent - selected Claude/Codex profile; a null hook directory makes command creation throw
 * @param spec - managed hook contract; empty matchers create no tool-triggered rows
 * @returns provider rows; empty only when a non-Stop hook has no matcher parts
 */
function claudeCodexEntries(
  agent: AgentProfile,
  spec: HookSpec,
): AgentHookJsonObject[] {
  // Stop runs after the user's turn and therefore has no tool matcher row.
  if (spec.event === "Stop") {
    const command: AgentHookJsonObject = {
      type: "command",
      command: managedAgentHookCommand(agent, spec),
    };
    // An owned host deadline gives the migrated hook time to return model-visible Stop feedback.
    if (
      agentRegistersHostTimeout(agent, spec) &&
      spec.timeoutSec !== undefined
    ) {
      command.timeout = spec.timeoutSec;
    }
    // Codex displays this name while the user's hook is running.
    if (agent.id === "codex") command.statusMessage = spec.displayName;
    return [{ hooks: [command] }];
  }
  return matcherParts(matcherForAgent(agent, spec)).map((matcher) => {
    const command: AgentHookJsonObject = {
      type: "command",
      command: managedAgentHookCommand(agent, spec),
    };
    // An owned host deadline stays above the launcher's internal response ceiling.
    if (
      agentRegistersHostTimeout(agent, spec) &&
      spec.timeoutSec !== undefined
    ) {
      command.timeout = spec.timeoutSec;
    }
    // Codex displays the same hook name for each matched user edit tool.
    if (agent.id === "codex") command.statusMessage = spec.displayName;
    return {
      matcher,
      hooks: [command],
    };
  });
}

/**
 * Build Copilot's one cross-platform command row.
 * Use when enabling a managed hook for users on either supported shell.
 *
 * @param agent - selected Copilot profile; a null hook directory makes command creation throw
 * @param spec - managed hook; an absent timeout uses the provider's 30-second default
 * @returns command row with Bash and PowerShell parity; never empty
 */
function copilotEntry(
  agent: AgentProfile,
  spec: HookSpec,
): AgentHookJsonObject {
  const crossPlatformCommand = managedAgentHookCommand(agent, spec);
  return {
    type: "command",
    bash: crossPlatformCommand,
    powershell: crossPlatformCommand,
    timeoutSec: spec.timeoutSec ?? 30,
  };
}

/**
 * Build Antigravity's top-level definition for one managed hook.
 * Use when setup enables protection in the provider's project policy file.
 *
 * @param agent - selected Antigravity profile; a null hook directory makes command creation throw
 * @param spec - managed hook; an absent timeout uses the provider's 30-second default
 * @returns enabled provider definition; never empty for a valid registry hook
 */
function antigravityHookDefinition(
  agent: AgentProfile,
  spec: HookSpec,
): AgentHookJsonObject {
  const command = {
    type: "command",
    command: managedAgentHookCommand(agent, spec),
    timeout: spec.timeoutSec ?? 30,
  };
  // Stop definitions omit matchers because they run after the user's complete turn.
  if (spec.event === "Stop") {
    return {
      enabled: true,
      [hookEventKey(agent, spec)]: [
        {
          hooks: [command],
        },
      ],
    };
  }
  return {
    enabled: true,
    [hookEventKey(agent, spec)]: [
      {
        matcher: matcherForAgent(agent, spec),
        hooks: [command],
      },
    ],
  };
}

/**
 * Append the selected provider's exact managed registration shape.
 * Use after stale managed rows are removed during enable or sync.
 *
 * @param config - parsed provider config; empty means setup creates the first managed row
 * @param agent - selected provider profile; unsupported surfaces cannot reach this writer
 * @param spec - enabled hook contract; empty script metadata cannot produce a command
 * @returns nothing; the config object is updated in place for later atomic persistence
 */
function appendHookEntries(
  config: AgentHookJsonObject,
  agent: AgentProfile,
  spec: HookSpec,
): void {
  // Antigravity stores each hook as a named top-level definition instead of a shared event array.
  if (agent.id === "antigravity") {
    config[spec.id] = antigravityHookDefinition(agent, spec);
    return;
  }
  const event = hookEventKey(agent, spec);
  const entries = eventEntries(config, event);
  // Copilot stores one dual-shell row for the user's lifecycle event.
  if (agent.id === "copilot") {
    // A missing or non-numeric schema version is normalized before Copilot reads the new row.
    if (typeof config.version !== "number") config.version = 1;
    entries.push(copilotEntry(agent, spec));
    return;
  }
  entries.push(...claudeCodexEntries(agent, spec));
}

/**
 * Check whether Antigravity has the exact active row setup owns.
 * Use when the Hooks screen decides whether local registration is current.
 *
 * @param config - parsed provider config; empty means the hook is unregistered
 * @param agent - selected Antigravity profile
 * @param spec - expected managed hook; empty script metadata cannot match a command
 * @returns true for the exact event, matcher, command, and timeout; false names repairable drift
 */
function hasAntigravityExpectedEntries(
  config: AgentHookJsonObject,
  agent: AgentProfile,
  spec: HookSpec,
): boolean {
  const definition = config[spec.id];
  // Missing, malformed, or disabled definitions cannot protect the user's action.
  if (!isAgentHookJsonObject(definition) || definition.enabled === false)
    return false;
  const entries = definition[hookEventKey(agent, spec)];
  // A non-array lifecycle value contains no runnable managed rows.
  if (!Array.isArray(entries)) return false;
  // Stop rows match only the exact managed command because they carry no tool matcher.
  if (spec.event === "Stop") {
    return entries.some(
      (entry) =>
        isAgentHookJsonObject(entry) &&
        entryMatchesSpecRegistration(entry, agent, spec),
    );
  }
  return entries.some(
    (entry) =>
      isAgentHookJsonObject(entry) &&
      entry.matcher === matcherForAgent(agent, spec) &&
      entryMatchesSpecRegistration(entry, agent, spec),
  );
}

/**
 * Check a shared provider event for every exact managed row users need.
 * Use for Claude, Codex, and Copilot status reporting.
 *
 * @param config - parsed provider config; empty means no managed event rows
 * @param agent - selected provider profile
 * @param spec - expected hook contract; empty matchers cannot satisfy tool-triggered coverage
 * @returns true when all provider-specific rows match; false exposes registration drift
 */
function hasEventExpectedEntries(
  config: AgentHookJsonObject,
  agent: AgentProfile,
  spec: HookSpec,
): boolean {
  const hooks = isAgentHookJsonObject(config.hooks) ? config.hooks : {};
  const entries = hooks[hookEventKey(agent, spec)];
  // A missing or malformed event array means the user's hook is not registered.
  if (!Array.isArray(entries)) return false;
  // Stop needs one exact command and no matcher expansion.
  if (spec.event === "Stop") {
    return entries.some((entry) =>
      entryMatchesSpecRegistration(entry, agent, spec),
    );
  }
  // Copilot also stores one direct dual-shell row for each event.
  if (agent.id === "copilot") {
    return entries.some((entry) =>
      entryMatchesSpecRegistration(entry, agent, spec),
    );
  }
  return matcherParts(matcherForAgent(agent, spec)).every((matcher) =>
    entries.some(
      (entry) =>
        isAgentHookJsonObject(entry) &&
        entry.matcher === matcher &&
        entryMatchesSpecRegistration(entry, agent, spec),
    ),
  );
}

/**
 * Route exact-registration checks to the selected provider shape.
 * Use as the final local installed-state decision shown to users.
 *
 * @param config - parsed provider config; empty means no registration is current
 * @param agent - selected provider profile
 * @param spec - expected hook contract; empty metadata cannot produce a match
 * @returns true only when every required provider row is exact; false requests repair
 */
function hasAllExpectedEntries(
  config: AgentHookJsonObject,
  agent: AgentProfile,
  spec: HookSpec,
): boolean {
  // Antigravity uses a named definition rather than the shared hooks object.
  if (agent.id === "antigravity") {
    return hasAntigravityExpectedEntries(config, agent, spec);
  }
  return hasEventExpectedEntries(config, agent, spec);
}

/**
 * Search parsed config recursively for one current or retired managed command.
 * Use to distinguish missing registration from event or command drift.
 *
 * @param value - parsed config value; null, empty, or primitive values contain no command
 * @param spec - managed hook contract; empty script metadata matches nothing
 * @returns true when setup owns a nested command; false preserves unrelated user config
 */
function configurationReferencesSpec(value: unknown, spec: HookSpec): boolean {
  // Each array member may hold an event group or direct managed command.
  if (Array.isArray(value)) {
    return value.some((nestedValue) =>
      configurationReferencesSpec(nestedValue, spec),
    );
  }
  // Primitive or null JSON cannot contain a managed command entry.
  if (!isAgentHookJsonObject(value)) return false;
  // A direct command match identifies setup-owned registration bytes.
  if (commandEntryReferencesSpec(value, spec)) return true;
  return Object.values(value).some((nestedValue) =>
    configurationReferencesSpec(nestedValue, spec),
  );
}

/**
 * Return rows only from the lifecycle event the registry owns.
 * Use so a command under the wrong event remains visible as drift.
 *
 * @param config - parsed provider config; empty means there are no event rows
 * @param agent - selected provider profile
 * @param spec - expected hook contract; an empty event cannot identify rows
 * @returns event rows; empty means missing, disabled, malformed, or absent state
 */
function expectedEventEntries(
  config: AgentHookJsonObject,
  agent: AgentProfile,
  spec: HookSpec,
): unknown[] {
  // Antigravity stores each managed hook in its own top-level definition.
  if (agent.id === "antigravity") {
    const definition = config[spec.id];
    // A missing or disabled definition has no active event rows for the user.
    if (!isAgentHookJsonObject(definition) || definition.enabled === false)
      return [];
    const entries = definition[hookEventKey(agent, spec)];
    return Array.isArray(entries) ? entries : [];
  }
  const hooks = isAgentHookJsonObject(config.hooks) ? config.hooks : {};
  const entries = hooks[hookEventKey(agent, spec)];
  return Array.isArray(entries) ? entries : [];
}

/**
 * Check provider matchers separately from command and timeout bytes.
 * Use so the Hooks screen can name matcher drift as the user's first repair.
 *
 * @param entries - expected lifecycle rows; empty cannot cover a tool matcher
 * @param agent - selected provider profile
 * @param spec - expected hook; empty matchers are valid only for Stop or Copilot rows
 * @returns true when all required matchers are present; false means some user actions are uncovered
 */
function expectedMatchersArePresent(
  entries: unknown[],
  agent: AgentProfile,
  spec: HookSpec,
): boolean {
  // Stop and Copilot event rows do not carry registry matchers.
  if (spec.event === "Stop" || agent.id === "copilot") return true;
  // Antigravity translates generic tool names into its one provider matcher.
  if (agent.id === "antigravity") {
    return entries.some(
      (entry) =>
        isAgentHookJsonObject(entry) &&
        entry.matcher === matcherForAgent(agent, spec) &&
        entryReferencesSpec(entry, spec),
    );
  }
  return matcherParts(matcherForAgent(agent, spec)).every((expectedMatcher) =>
    entries.some(
      (entry) =>
        isAgentHookJsonObject(entry) &&
        entry.matcher === expectedMatcher &&
        entryReferencesSpec(entry, spec),
    ),
  );
}

/**
 * Detect retired split-deny ids or commands in the user's config.
 * Use so upgrade guidance says migration instead of missing registration.
 *
 * @param config - parsed provider config; empty contains no retired registration
 * @param spec - current hook; any non-deny hook has no split-deny history
 * @returns true when exact retired identifiers remain; false means another repair owns the state
 */
function hasRetiredDenyRegistration(
  config: AgentHookJsonObject,
  spec: HookSpec,
): boolean {
  // Other hooks have no retired split identifiers in this migration.
  if (spec.id !== "deny-dangerous") return false;
  const serializedConfig = JSON.stringify(config);
  return [
    ...LEGACY_DENY_DANGEROUS_HOOK_IDS,
    ...LEGACY_DENY_DANGEROUS_SCRIPT_NAMES,
  ].some((retiredIdentifier) => serializedConfig.includes(retiredIdentifier));
}

/**
 * Name the first exact registration link users need to repair.
 * Use after parsing succeeds but installed state is not yet known.
 *
 * @param config - parsed provider config; empty produces a missing-registration issue
 * @param agent - selected provider profile
 * @param spec - expected hook contract; empty metadata cannot form a complete registration
 * @returns first issue, or undefined when the user's registration is exact and current
 */
function registrationIssue(
  config: AgentHookJsonObject,
  agent: AgentProfile,
  spec: HookSpec,
): AgentHookRegistrationIssue | undefined {
  // A complete exact registration has no repair issue.
  if (hasAllExpectedEntries(config, agent, spec)) return undefined;
  // Retired split policy entries need migration rather than a generic missing message.
  if (hasRetiredDenyRegistration(config, spec)) return "retired-registration";
  // No managed command anywhere means this hook was never registered or was removed.
  if (!configurationReferencesSpec(config, spec)) {
    return "registration-missing";
  }
  const eventEntries = expectedEventEntries(config, agent, spec);
  // A command under another lifecycle event cannot protect the intended user action.
  if (!eventEntries.some((entry) => entryReferencesSpec(entry, spec))) {
    return "event-mismatch";
  }
  // Wrong or incomplete tool matchers leave some user actions outside the hook.
  if (!expectedMatchersArePresent(eventEntries, agent, spec)) {
    return "matcher-mismatch";
  }
  // A stale generated command can carry the wrong response adapter or launcher contract.
  if (
    !eventEntries.some((entry) => entryMatchesSpecCommand(entry, agent, spec))
  ) {
    return "command-or-response-mismatch";
  }
  // A stale host deadline can kill the hook before its own result reaches the user.
  if (
    !eventEntries.some((entry) => entryMatchesSpecTimeout(entry, agent, spec))
  ) {
    return "timeout-mismatch";
  }
  return "command-or-response-mismatch";
}

/**
 * Read one agent's managed registration without changing user config.
 * Use for setup, audit, CLI, and dashboard installed-state reporting.
 *
 * @param projectPath - selected project; empty text cannot locate an owned config
 * @param agent - selected provider; a null config path throws before reading
 * @param spec - expected hook contract; empty metadata cannot be reported installed
 * @returns installed state plus one missing, invalid, or repair issue; absent issue means current
 */
export function readAgentHookState(
  projectPath: string,
  agent: AgentProfile,
  spec: HookSpec,
): AgentHookReadState {
  const config = readJsonFile(configPath(projectPath, agent));
  // A missing config is distinct from an existing file whose registration needs repair.
  if (config.missing) return { installed: false, configMissing: true };
  // Invalid JSON cannot be inspected for a safe event, matcher, command, or timeout.
  if (config.invalid) return { installed: false, configInvalid: true };
  const issue = registrationIssue(config.value, agent, spec);
  return {
    installed: issue === undefined,
    // A complete registration omits the issue so existing consumers keep a compact shape.
    ...(issue === undefined ? {} : { registrationIssue: issue }),
  };
}

/**
 * Persist one enabled or disabled managed registration atomically.
 * Use after a user toggles a hook or sync repairs local config drift.
 *
 * @param projectPath - selected project; empty text cannot own a safe config write
 * @param agent - selected provider; a null config path throws before writing
 * @param spec - managed hook contract; empty metadata cannot produce a useful command
 * @param enabled - true installs current rows; false removes only setup-owned rows
 * @returns nothing; successful completion leaves unrelated user hooks unchanged
 * @throws when existing config is invalid JSON or the agent lacks a writable surface
 */
export function writeAgentHookState(
  projectPath: string,
  agent: AgentProfile,
  spec: HookSpec,
  enabled: boolean,
): void {
  const path = configPath(projectPath, agent);
  const config = readJsonFile(path);
  // Invalid user JSON cannot be safely merged, so setup asks the user to repair it first.
  if (config.invalid) {
    throw new Error(
      `${agent.id} hook config is not valid JSON: ${agent.hookConfigFile}`,
    );
  }
  const event = hookEventKey(agent, spec);
  // Antigravity keeps managed hooks as top-level definitions with provider-specific migration ids.
  if (agent.id === "antigravity") {
    Reflect.deleteProperty(config.value, spec.id);
    // The current deny hook replaces every earlier split Antigravity policy id.
    if (spec.id === "deny-dangerous") {
      // Each exact retired id is Goat Flow-owned and safe to remove from the user's config.
      for (const legacyId of LEGACY_DENY_DANGEROUS_HOOK_IDS) {
        Reflect.deleteProperty(config.value, legacyId);
      }
    }
    // Enabling adds the current definition; disabling leaves the owned definition absent.
    if (enabled) appendHookEntries(config.value, agent, spec);
    writeFileAtomic(
      path,
      `${JSON.stringify(config.value, null, 2)}\n`,
      projectPath,
    );
    return;
  }
  removeHookEntries(config.value, event, spec);
  // Enabling appends exact current rows after stale managed rows are removed.
  if (enabled) appendHookEntries(config.value, agent, spec);
  writeFileAtomic(
    path,
    `${JSON.stringify(config.value, null, 2)}\n`,
    projectPath,
  );
}
