/**
 * Reads and writes the hook registrations users run in supported coding agents.
 *
 * Use when setup, hook toggles, or sync must show the same enabled state everywhere.
 * The registrar owns script files; this module owns the Claude, Codex, Antigravity, and Copilot configuration shapes.
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
  managedAgentHookDescriptor,
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
  | "duplicate-registration"
  | "retired-registration"
  | "event-mismatch"
  | "matcher-mismatch"
  | "command-or-response-mismatch"
  | "timeout-mismatch";

/** One provider event and matcher where the user expects one managed command. */
interface ManagedHookRegistrationTarget {
  event: string;
  matcher: string | null;
}

/** Current script files and provider registrations derived from one user toggle. */
export interface ManagedHookDesiredState {
  managedScriptFiles: string[];
  registrationTargets: ManagedHookRegistrationTarget[];
}

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
 * Derive the complete managed state for one supported agent and hook.
 * Use so sync, status, and config writes interpret the user's toggle identically.
 *
 * @param agent - supported provider; a missing hook surface is rejected before this derivation
 * @param spec - registry hook; an empty script list produces an empty managed-file target
 * @param isEnabled - true targets one command per provider event/matcher; false targets no registrations
 * @returns current script filenames plus exact provider registration targets; disabled keeps current files
 */
export function deriveManagedHookDesiredState(
  agent: AgentProfile,
  spec: HookSpec,
  isEnabled: boolean,
): ManagedHookDesiredState {
  const managedScriptFiles = [...spec.scriptFiles];
  // A disabled hook keeps current inert files but gives the user's agent nothing to run.
  if (!isEnabled) return { managedScriptFiles, registrationTargets: [] };

  const event = hookEventKey(agent, spec);
  // Stop and Copilot use one matcherless registration for the user's lifecycle event.
  if (spec.event === "Stop" || agent.id === "copilot") {
    return {
      managedScriptFiles,
      registrationTargets: [{ event, matcher: null }],
    };
  }

  const providerMatcher = matcherForAgent(agent, spec);
  // Antigravity keeps its provider matcher in one registration rather than one row per tool.
  if (agent.id === "antigravity") {
    return {
      managedScriptFiles,
      registrationTargets: [{ event, matcher: providerMatcher }],
    };
  }

  return {
    managedScriptFiles,
    registrationTargets: matcherParts(providerMatcher).map((matcher) => ({
      event,
      matcher,
    })),
  };
}

/**
 * Remove a managed command while retaining user commands in the same matcher group.
 * Use during toggle and sync repairs so a shared provider row keeps the user's other hooks.
 *
 * @param entry - provider row; null or primitive values remain untouched
 * @param spec - managed hook contract; empty script metadata removes nothing
 * @returns retained row, or undefined when the row contained only this managed hook
 */
function withoutManagedHookCommand(entry: unknown, spec: HookSpec): unknown {
  // A direct managed command is the exact registration setup owns and may replace.
  if (commandEntryReferencesSpec(entry, spec)) return undefined;
  // Null, primitive, and non-group objects cannot contain a nested managed command.
  if (!isAgentHookJsonObject(entry) || !Array.isArray(entry.hooks))
    return entry;

  const retainedHooks = entry.hooks
    .map((nestedHook) => withoutManagedHookCommand(nestedHook, spec))
    .filter((nestedHook) => nestedHook !== undefined);
  // An unchanged group stays semantically identical when the config is serialized again.
  if (retainedHooks.length === entry.hooks.length) return entry;
  // A group emptied by managed removal should not leave a dead row in the user's config.
  if (retainedHooks.length === 0) return undefined;
  return { ...entry, hooks: retainedHooks };
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
  const next = entries
    .map((entry) => withoutManagedHookCommand(entry, spec))
    .filter((entry) => entry !== undefined);
  const hooks = ensureHooksObject(config);
  // No retained rows means the user should not see an empty provider event group.
  if (next.length === 0) {
    hooks[event] = undefined;
    return;
  }
  hooks[event] = next;
}

/**
 * Drop every managed row this spec owns, whatever lifecycle event now holds it.
 * Use before appending the canonical row so a registration that drifted to another event cannot survive a sync or a disable and keep firing on user
 * actions it no longer covers.
 *
 * @param config - parsed agent config; a missing hooks container yields nothing to remove
 * @param spec - managed hook contract whose owned rows are removed from every event
 */
function removeOwnedHookEntriesEverywhere(
  config: AgentHookJsonObject,
  spec: HookSpec,
): void {
  const hooks = ensureHooksObject(config);
  // Snapshot the keys because removal clears emptied event groups while iterating.
  for (const event of Object.keys(hooks)) {
    if (!Array.isArray(hooks[event])) continue;
    removeHookEntries(config, event, spec);
  }
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
  registrationTargets: ManagedHookRegistrationTarget[],
): AgentHookJsonObject[] {
  return registrationTargets.map((registrationTarget) => {
    const handlerDescriptor = managedAgentHookDescriptor(agent, spec);
    const command: AgentHookJsonObject = {
      type: "command",
      command: handlerDescriptor.command,
    };
    // Approved argv handlers register exact operands the host passes without a shell.
    if (handlerDescriptor.form === "argv") {
      command.args = [...handlerDescriptor.args];
      command.bash = handlerDescriptor.bash;
      command.powershell = handlerDescriptor.powershell;
    } else if (handlerDescriptor.commandWindows !== undefined) {
      command.commandWindows = handlerDescriptor.commandWindows;
    }
    // An owned host deadline gives the migrated hook time to return model-visible Stop feedback.
    if (
      agentRegistersHostTimeout(agent, spec) &&
      spec.timeoutSec !== undefined
    ) {
      command.timeout = spec.timeoutSec;
    }
    // Codex displays this name while the user's hook is running.
    if (agent.id === "codex") command.statusMessage = spec.displayName;
    const registrationEntry: AgentHookJsonObject = { hooks: [command] };
    // A null matcher means the provider runs this once after the user's completed lifecycle.
    if (registrationTarget.matcher !== null) {
      registrationEntry.matcher = registrationTarget.matcher;
    }
    return registrationEntry;
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
  registrationTarget: ManagedHookRegistrationTarget,
): AgentHookJsonObject {
  const command = {
    type: "command",
    command: managedAgentHookCommand(agent, spec),
    timeout: spec.timeoutSec ?? 30,
  };
  // Matcherless definitions run after the user's complete lifecycle rather than one tool.
  if (registrationTarget.matcher === null) {
    return {
      enabled: true,
      [registrationTarget.event]: [
        {
          hooks: [command],
        },
      ],
    };
  }
  return {
    enabled: true,
    [registrationTarget.event]: [
      {
        matcher: registrationTarget.matcher,
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
  desiredState: ManagedHookDesiredState,
): void {
  const firstRegistrationTarget = desiredState.registrationTargets[0];
  // An empty target is the user's disabled state, so there is no provider row to append.
  if (!firstRegistrationTarget) return;
  // Antigravity stores each hook as a named top-level definition instead of a shared event array.
  if (agent.id === "antigravity") {
    config[spec.id] = antigravityHookDefinition(
      agent,
      spec,
      firstRegistrationTarget,
    );
    return;
  }
  const entries = eventEntries(config, firstRegistrationTarget.event);
  // Copilot stores one dual-shell row for the user's lifecycle event.
  if (agent.id === "copilot") {
    // A missing or non-numeric schema version is normalized before Copilot reads the new row.
    if (typeof config.version !== "number") config.version = 1;
    entries.push(copilotEntry(agent, spec));
    return;
  }
  entries.push(
    ...claudeCodexEntries(agent, spec, desiredState.registrationTargets),
  );
}

/**
 * Count direct managed commands across every provider config shape.
 * Use so duplicate or misplaced rows cannot look installed merely because one exact row exists.
 *
 * @param registrationNode - parsed config value; null, empty, or primitive values contain no commands
 * @param spec - managed hook contract; empty script metadata matches no command
 * @returns physical managed command count; zero means the user has no registration for this hook
 */
function managedRegistrationCommandCount(
  registrationNode: unknown,
  spec: HookSpec,
): number {
  // Every array item may contain one direct command or another provider wrapper.
  if (Array.isArray(registrationNode)) {
    return registrationNode.reduce<number>(
      (count, nestedValue) =>
        count + managedRegistrationCommandCount(nestedValue, spec),
      0,
    );
  }
  // Null and primitive values cannot contain a managed command.
  if (!isAgentHookJsonObject(registrationNode)) return 0;
  const directManagedCommandCount = commandEntryReferencesSpec(
    registrationNode,
    spec,
  )
    ? 1
    : 0;
  return (
    directManagedCommandCount +
    Object.values(registrationNode).reduce<number>(
      (count, nestedValue) =>
        count + managedRegistrationCommandCount(nestedValue, spec),
      0,
    )
  );
}

/**
 * Check whether one provider row belongs to an exact desired event/matcher slot.
 * Use before command and timeout checks so each user action has its own registration.
 *
 * @param entry - provider event row; null or primitive values cannot match
 * @param target - desired provider slot; a null matcher requires a matcherless row
 * @param spec - managed hook contract; empty script metadata matches no owned row
 * @returns true when the row contains this hook under the exact matcher shape
 */
function entryMatchesRegistrationTarget(
  entry: unknown,
  target: ManagedHookRegistrationTarget,
  spec: HookSpec,
): boolean {
  // A non-object or unrelated row belongs to the user, not this managed target.
  if (!isAgentHookJsonObject(entry) || !entryReferencesSpec(entry, spec)) {
    return false;
  }
  // A null matcher means the provider contract requires the matcher field to be absent.
  if (target.matcher === null) return entry.matcher === undefined;
  return entry.matcher === target.matcher;
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
  const desiredState = deriveManagedHookDesiredState(agent, spec, true);
  // Extra or missing managed commands mean at least one user action lacks exactly one row.
  if (
    managedRegistrationCommandCount(config, spec) !==
    desiredState.registrationTargets.length
  ) {
    return false;
  }
  const entries = expectedEventEntries(config, agent, spec);
  return desiredState.registrationTargets.every((registrationTarget) => {
    const exactTargetEntries = entries.filter((entry) =>
      entryMatchesRegistrationTarget(entry, registrationTarget, spec),
    );
    return (
      exactTargetEntries.length === 1 &&
      entryMatchesSpecRegistration(exactTargetEntries[0], agent, spec)
    );
  });
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
 * @param registrationTargets - provider slots; empty means the user requested no registrations
 * @param spec - expected hook; empty script metadata matches no owned row
 * @returns true when all required matchers are present; false means some user actions are uncovered
 */
function expectedMatchersArePresent(
  entries: unknown[],
  registrationTargets: ManagedHookRegistrationTarget[],
  spec: HookSpec,
): boolean {
  return registrationTargets.every((registrationTarget) =>
    entries.some((entry) =>
      entryMatchesRegistrationTarget(entry, registrationTarget, spec),
    ),
  );
}

/** Check every desired matcher slot for a current command or timeout link. */
function everyRegistrationTargetMatches(
  entries: unknown[],
  registrationTargets: ManagedHookRegistrationTarget[],
  spec: HookSpec,
  matchesEntry: (entry: unknown) => boolean,
): boolean {
  return registrationTargets.every((registrationTarget) =>
    entries.some(
      (entry) =>
        entryMatchesRegistrationTarget(entry, registrationTarget, spec) &&
        matchesEntry(entry),
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
  const desiredState = deriveManagedHookDesiredState(agent, spec, true);
  const managedCommandCount = managedRegistrationCommandCount(config, spec);
  // A complete exact registration has no repair issue.
  if (hasAllExpectedEntries(config, agent, spec)) return undefined;
  // Retired split policy entries need migration rather than a generic missing message.
  if (hasRetiredDenyRegistration(config, spec)) return "retired-registration";
  // No managed command anywhere means this hook was never registered or was removed.
  if (managedCommandCount === 0) return "registration-missing";
  // More physical commands than desired can run the same managed hook twice for one user action.
  if (managedCommandCount > desiredState.registrationTargets.length) {
    return "duplicate-registration";
  }
  const eventEntries = expectedEventEntries(config, agent, spec);
  // A command under another lifecycle event cannot protect the intended user action.
  if (!eventEntries.some((entry) => entryReferencesSpec(entry, spec))) {
    return "event-mismatch";
  }
  // Wrong or incomplete tool matchers leave some user actions outside the hook.
  if (
    !expectedMatchersArePresent(
      eventEntries,
      desiredState.registrationTargets,
      spec,
    )
  ) {
    return "matcher-mismatch";
  }
  // A stale generated command can carry the wrong response adapter or launcher contract.
  if (
    !everyRegistrationTargetMatches(
      eventEntries,
      desiredState.registrationTargets,
      spec,
      (entry) => entryMatchesSpecCommand(entry, agent, spec),
    )
  ) {
    return "command-or-response-mismatch";
  }
  // A stale host deadline can kill the hook before its own result reaches the user.
  if (
    !everyRegistrationTargetMatches(
      eventEntries,
      desiredState.registrationTargets,
      spec,
      (entry) => entryMatchesSpecTimeout(entry, agent, spec),
    )
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
 * @param isEnabled - true installs current rows; false removes only setup-owned rows
 * @returns nothing; successful completion leaves unrelated user hooks unchanged
 * @throws when existing config is invalid JSON or the agent lacks a writable surface
 */
export function writeAgentHookState(
  projectPath: string,
  agent: AgentProfile,
  spec: HookSpec,
  isEnabled: boolean,
): void {
  const path = configPath(projectPath, agent);
  const config = readJsonFile(path);
  const desiredState = deriveManagedHookDesiredState(agent, spec, isEnabled);
  // Invalid user JSON cannot be safely merged, so setup asks the user to repair it first.
  if (config.invalid) {
    throw new Error(
      `${agent.id} hook config is not valid JSON: ${agent.hookConfigFile}`,
    );
  }
  // Antigravity keeps managed hooks as top-level definitions with provider-specific migration ids.
  if (agent.id === "antigravity") {
    // Ownership follows the exact managed command, even when an older install used a different sibling id.
    for (const [definitionId, definition] of Object.entries(config.value)) {
      if (
        definitionId === spec.id ||
        managedRegistrationCommandCount(definition, spec) > 0
      ) {
        Reflect.deleteProperty(config.value, definitionId);
      }
    }
    // The current deny hook replaces every earlier split Antigravity policy id.
    if (spec.id === "deny-dangerous") {
      // Each exact retired id is Goat Flow-owned and safe to remove from the user's config.
      for (const legacyId of LEGACY_DENY_DANGEROUS_HOOK_IDS) {
        Reflect.deleteProperty(config.value, legacyId);
      }
    }
    // A non-empty target adds the current definition; disabled state leaves it absent.
    if (desiredState.registrationTargets.length > 0) {
      appendHookEntries(config.value, agent, spec, desiredState);
    }
    writeFileAtomic(
      path,
      `${JSON.stringify(config.value, null, 2)}\n`,
      projectPath,
    );
    return;
  }
  // A row moved to another lifecycle event still belongs to this spec and must not outlive
  // the sync that reinstates the canonical row, nor survive the user disabling the hook.
  removeOwnedHookEntriesEverywhere(config.value, spec);
  // Enabled state appends exact current rows after stale managed rows are removed.
  if (desiredState.registrationTargets.length > 0) {
    appendHookEntries(config.value, agent, spec, desiredState);
  }
  writeFileAtomic(
    path,
    `${JSON.stringify(config.value, null, 2)}\n`,
    projectPath,
  );
}
