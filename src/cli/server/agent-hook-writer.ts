/**
 * Agent-specific hook registration readers/writers.
 *
 * The registrar owns script files and desired state; this module owns the
 * four JSON shapes used by Claude, Codex, Antigravity, and Copilot hook config
 * files.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentProfile } from "../types.js";
import { writeFileAtomic } from "./safe-exec.js";
import type { HookSpec } from "./hooks-registry.js";

export interface AgentHookReadState {
  installed: boolean;
  configMissing?: boolean;
  configInvalid?: boolean;
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return (
    value !== null &&
    typeof value === "object" &&
    Array.isArray(value) === false
  );
}

function configPath(projectPath: string, agent: AgentProfile): string {
  if (!agent.hookConfigFile) {
    throw new Error(`${agent.id} has no hook config file`);
  }
  return join(projectPath, agent.hookConfigFile);
}

function readJsonFile(path: string): {
  value: JsonObject;
  missing: boolean;
  invalid: boolean;
} {
  if (!existsSync(path)) return { value: {}, missing: true, invalid: false };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    return {
      value: isObject(parsed) ? parsed : {},
      missing: false,
      invalid: !isObject(parsed),
    };
  } catch {
    return { value: {}, missing: false, invalid: true };
  }
}

function hookEventKey(agent: AgentProfile, spec: HookSpec): string {
  if (agent.id === "copilot") {
    return spec.event === "PreToolUse" ? "preToolUse" : "postToolUse";
  }
  return spec.event;
}

function ensureHooksObject(config: JsonObject): JsonObject {
  if (!isObject(config.hooks)) config.hooks = {};
  return config.hooks as JsonObject;
}

function eventEntries(config: JsonObject, event: string): unknown[] {
  const hooks = ensureHooksObject(config);
  if (!Array.isArray(hooks[event])) hooks[event] = [];
  return hooks[event] as unknown[];
}

function matcherParts(matcher: string): string[] {
  return matcher
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
}

function commandPath(agent: AgentProfile, script: string): string {
  if (!agent.hooksDir) throw new Error(`${agent.id} has no hooks dir`);
  return `${agent.hooksDir}/${script}`.replace(/\/+/gu, "/");
}

function shellCommand(agent: AgentProfile, spec: HookSpec): string {
  const path = commandPath(agent, spec.primaryScript);
  if (agent.id === "codex") return path;
  if (agent.id === "antigravity") {
    return `root="$(git rev-parse --show-toplevel 2>/dev/null)" || { printf '{"decision":"deny","reason":"Guard cannot start: git repository root unavailable."}\\n'; exit 0; }; bash "$root/${path}"`;
  }
  return `root="$(git rev-parse --show-toplevel 2>/dev/null)" || { printf 'BLOCKED: Guard cannot start: git repository root unavailable.\\n' >&2; exit 2; }; bash "$root/${path}"`;
}

function powershellCommand(agent: AgentProfile, spec: HookSpec): string {
  const path = commandPath(agent, spec.primaryScript);
  return `if (Get-Command bash -ErrorAction SilentlyContinue) { bash ${path} } else { Write-Output '{"permissionDecision":"deny","permissionDecisionReason":"Bash, Git Bash, or WSL is required to run ${path} on Windows."}' }`;
}

function entryReferencesSpec(entry: unknown, spec: HookSpec): boolean {
  if (!isObject(entry)) return false;
  const commands = [
    typeof entry.command === "string" ? entry.command : "",
    typeof entry.bash === "string" ? entry.bash : "",
    typeof entry.powershell === "string" ? entry.powershell : "",
  ].join("\n");
  if (spec.scriptFiles.some((script) => commands.includes(script))) return true;
  if (Array.isArray(entry.hooks)) {
    return entry.hooks.some((hook) => entryReferencesSpec(hook, spec));
  }
  return false;
}

function matcherForAgent(agent: AgentProfile, spec: HookSpec): string {
  if (agent.id !== "antigravity") return spec.matcher;
  if (spec.id === "gruff-code-quality") {
    return [
      "write_to_file",
      "replace_file_content",
      "multi_replace_file_content",
    ].join("|");
  }
  if (
    spec.id === "guard-destructive-shell" ||
    spec.id === "guard-repository-writes"
  ) {
    return "run_command";
  }
  if (spec.id === "guard-secret-paths") {
    return [
      "run_command",
      "view_file",
      "write_to_file",
      "replace_file_content",
      "multi_replace_file_content",
    ].join("|");
  }
  return spec.matcher;
}

function removeHookEntries(config: JsonObject, event: string, spec: HookSpec) {
  const entries = eventEntries(config, event);
  const next = entries.filter((entry) => !entryReferencesSpec(entry, spec));
  const hooks = ensureHooksObject(config);
  if (next.length === 0) {
    hooks[event] = undefined;
    return;
  }
  hooks[event] = next;
}

function claudeCodexEntries(agent: AgentProfile, spec: HookSpec): JsonObject[] {
  return matcherParts(spec.matcher).map((matcher) => {
    const command: JsonObject = {
      type: "command",
      command: shellCommand(agent, spec),
    };
    if (agent.id === "codex") command.statusMessage = spec.displayName;
    return {
      matcher,
      hooks: [command],
    };
  });
}

function copilotEntry(agent: AgentProfile, spec: HookSpec): JsonObject {
  return {
    type: "command",
    bash: commandPath(agent, spec.primaryScript),
    powershell: powershellCommand(agent, spec),
    timeoutSec: 30,
  };
}

function antigravityHookDefinition(
  agent: AgentProfile,
  spec: HookSpec,
): JsonObject {
  return {
    enabled: true,
    [hookEventKey(agent, spec)]: [
      {
        matcher: matcherForAgent(agent, spec),
        hooks: [
          {
            type: "command",
            command: shellCommand(agent, spec),
            timeout: 30,
          },
        ],
      },
    ],
  };
}

function appendHookEntries(
  config: JsonObject,
  agent: AgentProfile,
  spec: HookSpec,
): void {
  if (agent.id === "antigravity") {
    config[spec.id] = antigravityHookDefinition(agent, spec);
    return;
  }
  const event = hookEventKey(agent, spec);
  const entries = eventEntries(config, event);
  if (agent.id === "copilot") {
    if (typeof config.version !== "number") config.version = 1;
    entries.push(copilotEntry(agent, spec));
    return;
  }
  entries.push(...claudeCodexEntries(agent, spec));
}

function hasAllExpectedEntries(
  config: JsonObject,
  agent: AgentProfile,
  spec: HookSpec,
): boolean {
  if (agent.id === "antigravity") {
    const definition = config[spec.id];
    if (!isObject(definition) || definition.enabled === false) return false;
    const entries = definition[hookEventKey(agent, spec)];
    return (
      Array.isArray(entries) &&
      entries.some(
        (entry) =>
          isObject(entry) &&
          entry.matcher === matcherForAgent(agent, spec) &&
          entryReferencesSpec(entry, spec),
      )
    );
  }

  const hooks = isObject(config.hooks) ? config.hooks : {};
  const entries = hooks[hookEventKey(agent, spec)];
  if (!Array.isArray(entries)) return false;
  if (agent.id === "copilot") {
    return entries.some((entry) => entryReferencesSpec(entry, spec));
  }
  return matcherParts(spec.matcher).every((matcher) =>
    entries.some(
      (entry) =>
        isObject(entry) &&
        entry.matcher === matcher &&
        entryReferencesSpec(entry, spec),
    ),
  );
}

export function readAgentHookState(
  projectPath: string,
  agent: AgentProfile,
  spec: HookSpec,
): AgentHookReadState {
  const config = readJsonFile(configPath(projectPath, agent));
  if (config.missing) return { installed: false, configMissing: true };
  if (config.invalid) return { installed: false, configInvalid: true };
  return { installed: hasAllExpectedEntries(config.value, agent, spec) };
}

export function writeAgentHookState(
  projectPath: string,
  agent: AgentProfile,
  spec: HookSpec,
  enabled: boolean,
): void {
  const path = configPath(projectPath, agent);
  const config = readJsonFile(path);
  if (config.invalid) {
    throw new Error(
      `${agent.id} hook config is not valid JSON: ${agent.hookConfigFile}`,
    );
  }
  const event = hookEventKey(agent, spec);
  if (agent.id === "antigravity") {
    Reflect.deleteProperty(config.value, spec.id);
    if (enabled) appendHookEntries(config.value, agent, spec);
    writeFileAtomic(
      path,
      `${JSON.stringify(config.value, null, 2)}\n`,
      projectPath,
    );
    return;
  }
  removeHookEntries(config.value, event, spec);
  if (enabled) appendHookEntries(config.value, agent, spec);
  writeFileAtomic(
    path,
    `${JSON.stringify(config.value, null, 2)}\n`,
    projectPath,
  );
}
