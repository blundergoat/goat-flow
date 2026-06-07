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

/** Result of reading an agent hook config without mutating it. */
export interface AgentHookReadState {
  installed: boolean;
  configMissing?: boolean;
  configInvalid?: boolean;
}

type JsonObject = Record<string, unknown>;

const LEGACY_DENY_DANGEROUS_SCRIPT_NAMES = [
  "guard-common.sh",
  "guard-destructive-shell.sh",
  "guard-secret-paths.sh",
  "guard-repository-writes.sh",
  "guardrails-self-test.sh",
  "deny-dangerous.self-test.sh",
];

const LEGACY_DENY_DANGEROUS_HOOK_IDS = [
  "guard-destructive-shell",
  "guard-secret-paths",
  "guard-repository-writes",
];

/**
 * Type guard for a JSON object - the only shape we can safely read keyed properties off. Excludes the two
 * `typeof x === "object"` footguns, `null` and arrays, so callers can treat untrusted `JSON.parse` output
 * as a record without crashing on `null.foo` or silently mis-reading an array as a map. Centralised because
 * the writer parses pre-existing agent config files that may legally contain any JSON value.
 *
 * @param value - parsed JSON of unknown shape (e.g. JSON.parse output) to test
 * @returns true - when value is a non-null, non-array object, narrowed to JsonObject
 */
function isObject(value: unknown): value is JsonObject {
  return (
    value !== null &&
    typeof value === "object" &&
    Array.isArray(value) === false
  );
}

/** Resolve the agent hook config file; throws when the profile does not support hook writes. */
function configPath(projectPath: string, agent: AgentProfile): string {
  if (!agent.hookConfigFile) {
    throw new Error(`${agent.id} has no hook config file`);
  }
  return join(projectPath, agent.hookConfigFile);
}

/** Read an existing agent hook config; malformed JSON uses an empty-object fallback with `invalid=true`. */
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

/** Map goat-flow hook events to the event-key spelling required by each agent config format. */
function hookEventKey(agent: AgentProfile, spec: HookSpec): string {
  if (agent.id === "copilot") {
    return spec.event === "PreToolUse" ? "preToolUse" : "postToolUse";
  }
  return spec.event;
}

/** Ensure the shared hooks container is an object before mutating event arrays inside it. */
function ensureHooksObject(config: JsonObject): JsonObject {
  if (!isObject(config.hooks)) config.hooks = {};
  return config.hooks as JsonObject;
}

/** Return the mutable event-entry array, creating it when an agent config lacks the event key. */
function eventEntries(config: JsonObject, event: string): unknown[] {
  const hooks = ensureHooksObject(config);
  if (!Array.isArray(hooks[event])) hooks[event] = [];
  return hooks[event] as unknown[];
}

/** Split pipe-delimited matcher strings because Claude and Codex store one matcher per entry. */
function matcherParts(matcher: string): string[] {
  return matcher
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Build the repo-relative hook script path stored in agent config files; throws for unsupported agents. */
function commandPath(agent: AgentProfile, script: string): string {
  if (!agent.hooksDir) throw new Error(`${agent.id} has no hooks dir`);
  return `${agent.hooksDir}/${script}`.replace(/\/+/gu, "/");
}

/** Quote one script for `bash -c` without leaving shell metacharacters active. */
function shellSingleQuote(value: string): string {
  return `'${value.split("'").join("'\\''")}'`;
}

/** Build the shell command variant that matches each agent's hook response protocol. */
function shellCommand(agent: AgentProfile, spec: HookSpec): string {
  const path = commandPath(agent, spec.primaryScript);
  if (agent.id === "codex") return path;
  const failClosed =
    agent.id === "antigravity"
      ? `{ printf '{"decision":"deny","reason":"Policy hook unavailable: git repository root unavailable."}\\n'; exit 0; }`
      : `{ printf 'BLOCKED: Policy hook unavailable: git repository root unavailable.\\n' >&2; exit 2; }`;
  // dirname(--git-common-dir) is the main repo root in linked worktrees; absorbed submodule gitdirs live under .git/modules and must use their own worktree root.
  // Git resolution yields no root at all when the shell cwd is outside any repo
  // (e.g. an agent that cd'd into /tmp for scratch work). Failing closed there
  // blocked EVERY later command - including the cd back into the repo - so the
  // session was permanently wedged. Fall back to the cwd-independent
  // $CLAUDE_PROJECT_DIR before failing closed; the guard still runs, so
  // enforcement is unchanged. The guard re-resolves its OWN root from cwd
  // (deny-dangerous.sh runs `git rev-parse` to find .goat-flow/hooks/deny-dangerous), so the
  // launcher must cd into $root before invoking it - resolving only the script
  // path still leaves the guard failing closed from /tmp. cd failure fails closed.
  const resolveRoot = `gcd="$(git rev-parse --git-common-dir 2>/dev/null)"; root=""`;
  const selectRoot = `case "$gcd" in */.git/modules/*|.git/modules/*) root="$(git rev-parse --show-toplevel 2>/dev/null || true)" ;; /*|[A-Za-z]:/*|[A-Za-z]:\\\\*) gcd="\${gcd//\\\\//}"; root="$(dirname "$gcd")" ;; *) root="$(git rev-parse --show-toplevel 2>/dev/null || true)" ;; esac`;
  const ensureRoot = `[ -f "$root/${path}" ] || root="\${CLAUDE_PROJECT_DIR:-}"; [ -f "$root/${path}" ] || ${failClosed}`;
  const script = `${resolveRoot}; ${selectRoot}; ${ensureRoot}; cd "$root" || ${failClosed}; bash "$root/${path}"`;
  return `bash -c ${shellSingleQuote(script)}`;
}

/** Build Copilot's Windows hook command with a denial response when bash is unavailable. */
function powershellCommand(agent: AgentProfile, spec: HookSpec): string {
  const path = commandPath(agent, spec.primaryScript);
  return `if (Get-Command bash -ErrorAction SilentlyContinue) { bash ${path} } else { Write-Output '{"permissionDecision":"deny","permissionDecisionReason":"Bash, Git Bash, or WSL is required to run ${path} on Windows."}' }`;
}

/** Detect any existing hook entry that already points at one of the spec's managed scripts. */
function entryReferencesSpec(entry: unknown, spec: HookSpec): boolean {
  if (!isObject(entry)) return false;
  const commands = [
    typeof entry.command === "string" ? entry.command : "",
    typeof entry.bash === "string" ? entry.bash : "",
    typeof entry.powershell === "string" ? entry.powershell : "",
  ].join("\n");
  if (spec.scriptFiles.some((script) => commands.includes(script))) return true;
  if (
    spec.id === "deny-dangerous" &&
    LEGACY_DENY_DANGEROUS_SCRIPT_NAMES.some((script) =>
      commands.includes(script),
    )
  ) {
    return true;
  }
  if (Array.isArray(entry.hooks)) {
    return entry.hooks.some((hook) => entryReferencesSpec(hook, spec));
  }
  return false;
}

/** Translate generic hook matchers into Antigravity's tool names while leaving other agents unchanged. */
function matcherForAgent(agent: AgentProfile, spec: HookSpec): string {
  if (agent.id !== "antigravity") return spec.matcher;
  if (spec.id === "gruff-code-quality") {
    return [
      "write_to_file",
      "replace_file_content",
      "multi_replace_file_content",
    ].join("|");
  }
  if (spec.id === "deny-dangerous") {
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

/** Remove only goat-flow-managed hook entries so unrelated user hook config is preserved. */
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

/** Create the Claude/Codex hook entries for each matcher segment in the managed spec. */
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

/** Create Copilot's single hook entry shape with both bash and PowerShell commands. */
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
    if (spec.id === "deny-dangerous") {
      for (const legacyId of LEGACY_DENY_DANGEROUS_HOOK_IDS) {
        Reflect.deleteProperty(config.value, legacyId);
      }
    }
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
