/**
 * Agent-specific hook registration readers/writers.
 *
 * The registrar owns script files and desired state; this module owns the
 * four JSON shapes used by Claude, Codex, Antigravity, and Copilot hook config
 * files.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PROFILES } from "../detect/agents.js";
import type { AgentId, AgentProfile } from "../types.js";
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

/**
 * Build the hook path written into an agent's managed configuration.
 * Use when setup enables a hook; empty path parts would produce an unusable registration.
 *
 * @param hooksDirectory - project hook folder shown in config; empty means no valid managed location
 * @param hookScriptName - script the agent should run; empty means the registration cannot identify a hook
 * @returns normalized project-relative path; never empty when registry metadata is valid
 */
function commandPath(hooksDirectory: string, hookScriptName: string): string {
  return `${hooksDirectory}/${hookScriptName}`.replace(/\/+/gu, "/");
}

/**
 * Choose the unavailable-hook response understood by the active agent host.
 * Use when setup writes a launcher so startup failures remain visible without corrupting host protocol.
 *
 * @param hookResponseMode - host protocol for this hook; empty or unknown uses fail-closed policy text
 * @returns Node source for the host response; never empty because every hook needs a failure outcome
 */
function unavailableHookResponseProgram(hookResponseMode: string): string {
  // Antigravity expects a deny decision on stdout and treats the host response as handled.
  if (hookResponseMode === "antigravity") {
    return "const reportUnavailable=(reason)=>{process.stdout.write(JSON.stringify({decision:'deny',reason:'Policy hook unavailable: '+reason+'.'})+lineBreak);process.exit(0);};";
  }
  // Copilot expects its own permission-decision fields when the policy hook cannot start.
  if (hookResponseMode === "copilot") {
    return "const reportUnavailable=(reason)=>{process.stdout.write(JSON.stringify({permissionDecision:'deny',permissionDecisionReason:'Policy hook unavailable: '+reason+'.'})+lineBreak);process.exit(0);};";
  }
  // Optional Gruff feedback fails soft so a missing analyzer shell never blocks the user's edit.
  if (hookResponseMode === "gruff") {
    return "const reportUnavailable=(reason)=>{process.stderr.write('gruff-code-quality: hook unavailable: '+reason+'; skipped.'+lineBreak);process.exit(0);};";
  }
  // Post-turn safety cannot claim a completed scan when its launcher never started.
  if (hookResponseMode === "post-turn") {
    return "const reportUnavailable=(reason)=>{process.stderr.write('post-turn-safety: hook unavailable: '+reason+'.'+lineBreak);process.exit(2);};";
  }
  // Safety hooks default to a visible fail-closed response instead of allowing an unchecked command.
  return "const reportUnavailable=(reason)=>{process.stderr.write('BLOCKED: Policy hook unavailable: '+reason+'.'+lineBreak);process.exit(2);};";
}

/**
 * Build shell-neutral Node source that finds the user's project before starting its Bash hook.
 * Use in generated agent configs so PowerShell, cmd, and POSIX shells share one launch path.
 *
 * @param hookResponseMode - host response selected for this hook; empty uses fail-closed policy behavior
 * @returns portable `node -e` source; never empty because it becomes the registered hook command
 */
function hookLaunchBootstrap(hookResponseMode: string): string {
  const unavailableResponseProgram =
    unavailableHookResponseProgram(hookResponseMode);
  return [
    "const childProcess=require('node:child_process');",
    "const filesystem=require('node:fs');",
    "const path=require('node:path');",
    "const hookScriptPath=process.argv[1];",
    "const responseMode=process.argv[2];",
    "const rootEnvironmentName=process.argv[3];",
    "const registrationPath=process.argv[4];",
    "const bashLauncherRelativePath=process.argv[5];",
    "const lineBreak=String.fromCharCode(10);",
    unavailableResponseProgram,
    "const isPlainObject=(value)=>value!==null&&typeof value==='object'&&!Array.isArray(value);",
    "const normalizeOperand=(value)=>path.normalize(value).replaceAll('\\\\','/').replace(/^\\.\\//u,'');",
    "const commandOperands=(command)=>{const tokens=command.match(/\"(?:\\\\.|[^\"\\\\])*\"|'[^']*'|\\S+/gu)||[];return tokens.map((token)=>{if(token.startsWith('\"')){try{return JSON.parse(token);}catch{return '';}}if(token.startsWith(\"'\"))return token.slice(1,-1);return token;});};",
    "const commandNamesOperands=(command)=>{const normalized=commandOperands(command).map(normalizeOperand);return normalized.includes(normalizeOperand(hookScriptPath))&&normalized.includes(normalizeOperand(bashLauncherRelativePath));};",
    "const registrationNamesOperands=(value)=>{if(Array.isArray(value))return value.some(registrationNamesOperands);if(!isPlainObject(value))return false;for(const [key,nested] of Object.entries(value)){if((key==='command'||key==='bash'||key==='powershell')&&typeof nested==='string'&&commandNamesOperands(nested))return true;if((Array.isArray(nested)||isPlainObject(nested))&&registrationNamesOperands(nested))return true;}return false;};",
    "const realDirectory=(candidate)=>{try{const absolute=path.resolve(candidate);const entry=filesystem.lstatSync(absolute);if(entry.isSymbolicLink()||!entry.isDirectory())return '';const real=filesystem.realpathSync(absolute);return filesystem.lstatSync(real).isDirectory()?real:'';}catch{return '';}};",
    "const containedRelativePath=(relativePath)=>{if(!relativePath||path.isAbsolute(relativePath))return '';const normalized=path.normalize(relativePath);return normalized==='..'||normalized.startsWith('..'+path.sep)?'':normalized;};",
    "const managedEntryExists=(root,relativePath)=>{const normalized=containedRelativePath(relativePath);if(!normalized)return false;try{filesystem.lstatSync(path.join(root,normalized));return true;}catch{return false;}};",
    "const managedRegularFile=(root,relativePath)=>{const normalized=containedRelativePath(relativePath);if(!normalized)return '';const parts=normalized.split(path.sep).filter(Boolean);let current=root;try{for(let index=0;index<parts.length;index+=1){current=path.join(current,parts[index]);const entry=filesystem.lstatSync(current);if(entry.isSymbolicLink())return '';if(index<parts.length-1&&!entry.isDirectory())return '';if(index===parts.length-1&&(!entry.isFile()||entry.nlink!==1))return '';}const real=filesystem.realpathSync(current);const relative=path.relative(root,real);if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))return '';return real;}catch{return '';}};",
    "const inspectCandidate=(candidate)=>{const root=realDirectory(candidate);if(!root)return {state:'none',root:''};const scriptSeen=managedEntryExists(root,hookScriptPath);const registration=managedRegularFile(root,registrationPath);let registered=false;if(registration){try{const parsed=JSON.parse(filesystem.readFileSync(registration,'utf8'));registered=isPlainObject(parsed)&&registrationNamesOperands(parsed);}catch{registered=false;}}const relevant=scriptSeen||registered;if(!relevant)return {state:'none',root};const launcher=managedRegularFile(root,bashLauncherRelativePath);const script=managedRegularFile(root,hookScriptPath);return registered&&launcher&&script?{state:'complete',root}:{state:'corrupt',root};};",
    "const visited=new Set();",
    "const inspectOnce=(candidate)=>{const root=realDirectory(candidate);if(!root||visited.has(root))return {state:'none',root};visited.add(root);return inspectCandidate(root);};",
    "const gitRootLookup=childProcess.spawnSync('git',['rev-parse','--show-toplevel'],{encoding:'utf8'});",
    "let selected={state:'none',root:''};",
    "if(gitRootLookup.status===0&&gitRootLookup.stdout.trim()){selected=inspectOnce(gitRootLookup.stdout.trim());if(selected.state==='corrupt')reportUnavailable('managed root incomplete');}",
    "let ancestor=realDirectory(process.cwd());",
    "while(selected.state!=='complete'&&ancestor){const inspected=inspectOnce(ancestor);if(inspected.state==='corrupt')reportUnavailable('managed root incomplete');if(inspected.state==='complete'){selected=inspected;break;}const parent=path.dirname(ancestor);if(parent===ancestor)break;ancestor=parent;}",
    "if(selected.state!=='complete'&&rootEnvironmentName!=='-'&&process.env[rootEnvironmentName]){const inspected=inspectOnce(process.env[rootEnvironmentName]);if(inspected.state==='corrupt')reportUnavailable('managed root incomplete');if(inspected.state==='complete')selected=inspected;}",
    "if(selected.state!=='complete')reportUnavailable('managed root unavailable');",
    "const projectRoot=selected.root;",
    "const bashLauncherPath=path.join(projectRoot,containedRelativePath(bashLauncherRelativePath));",
    "const hookResult=childProcess.spawnSync(process.execPath,[bashLauncherPath,hookScriptPath,responseMode],{cwd:projectRoot,stdio:'inherit'});",
    "/* A startup error or absent status means the user's hook never produced a trustworthy result. */",
    "if(hookResult.error||!Number.isInteger(hookResult.status))reportUnavailable('managed launcher could not start');",
    "process.exit(hookResult.status);",
  ].join("");
}

/**
 * Select the response protocol the user's agent understands for one hook.
 * Use while writing config; an unknown combination falls back to the safety-policy protocol.
 *
 * @param agentId - selected agent; empty is impossible after setup request validation
 * @param spec - hook being registered; missing metadata is rejected by the registry before this call
 * @returns response mode consumed by the launcher; never empty
 */
function hookLaunchMode(agentId: AgentId, spec: HookSpec): string {
  // Gruff is optional feedback, so unavailable execution is shown as a non-blocking skip.
  if (spec.id === "gruff-code-quality") return "gruff";
  // Post-turn safety must return a failing scan outcome rather than an agent permission payload.
  if (spec.id === "post-turn-safety") return "post-turn";
  // Antigravity requires its decision JSON shape for command admission.
  if (agentId === "antigravity") return "antigravity";
  // Copilot requires permission-decision fields in its pre-tool response.
  if (agentId === "copilot") return "copilot";
  // Claude and Codex consume the standard fail-closed policy exit.
  return "policy";
}

/**
 * Build the hook command written into the selected agent's configuration.
 * Use during install and sync so every host reaches the same managed Bash resolver.
 *
 * @param agentId - agent receiving the command; empty is impossible after setup validation
 * @param hooksDirectory - project hook folder; empty would produce an invalid managed path
 * @param spec - hook behavior and script; missing metadata is rejected before config generation
 * @returns shell-neutral Node command; never empty because enabled hooks must be runnable
 */
export function buildAgentHookCommand(
  agentId: AgentId,
  hooksDirectory: string,
  spec: HookSpec,
): string {
  const hookScriptPath = commandPath(hooksDirectory, spec.primaryScript);
  const bashLauncherPath = commandPath(hooksDirectory, "run-with-bash.mjs");
  const hookResponseMode = hookLaunchMode(agentId, spec);
  const registrationPath = PROFILES[agentId].hookConfigFile;
  if (!registrationPath) throw new Error(`${agentId} has no hook config file`);
  // Codex can use managed ancestors but has no supported final host-root environment fallback.
  const rootEnvironmentName = agentId === "codex" ? "-" : "CLAUDE_PROJECT_DIR";
  return [
    "node",
    "-e",
    JSON.stringify(hookLaunchBootstrap(hookResponseMode)),
    JSON.stringify(hookScriptPath),
    JSON.stringify(hookResponseMode),
    JSON.stringify(rootEnvironmentName),
    JSON.stringify(registrationPath),
    JSON.stringify(bashLauncherPath),
  ].join(" ");
}

/**
 * Build a managed command after setup has selected an agent profile.
 * A profile without a hook folder is rejected so users never receive a dead config entry.
 *
 * @param agent - selected agent profile; a missing hook folder means this host cannot register hooks
 * @param spec - enabled hook; missing metadata is rejected before this writer runs
 * @returns registered Node command; never empty for supported agents
 * @throws when the selected agent has no managed hook directory
 */
function shellCommand(agent: AgentProfile, spec: HookSpec): string {
  // An unsupported profile cannot offer a working hook, so setup fails before writing its config.
  if (!agent.hooksDir) throw new Error(`${agent.id} has no hooks dir`);
  return buildAgentHookCommand(agent.id, agent.hooksDir, spec);
}

/**
 * Decide whether a hook entry in the user's agent config is one goat-flow installed.
 * Use before setup adds, replaces, or removes a registration, so toggling a hook in the dashboard
 * never rewrites a hook the user wrote themselves. The name must appear as a whole path token: a
 * user hook called `custom-post-turn-safety.sh` merely contains a managed name, and claiming it
 * would delete the user's own guard when they switched the managed one off.
 *
 * @param commands - command strings from one config entry, joined by newlines; empty means the entry
 *   runs nothing and can never be a managed registration
 * @param script - managed script filename to look for, such as `post-turn-safety.sh`
 * @returns true when this entry launches the managed script, so setup owns it; false leaves the
 *   entry untouched as the user's own hook
 */
function commandsReferenceScriptToken(
  commands: string,
  script: string,
): boolean {
  const escapedScript = script.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // The name must start at a path or word boundary and end at one, so `custom-<name>` never matches.
  const scriptTokenPattern = new RegExp(
    `(?:^|[\\s"'\`=/\\\\])${escapedScript}(?=$|[\\s"'\`;|&),])`,
    "mu",
  );
  return scriptTokenPattern.test(commands);
}

/** Detect a command entry that directly launches one managed hook script. */
function commandEntryReferencesSpec(entry: unknown, spec: HookSpec): boolean {
  // Non-object JSON cannot represent a runnable hook command.
  if (!isObject(entry)) return false;
  const commands = [
    typeof entry.command === "string" ? entry.command : "",
    typeof entry.bash === "string" ? entry.bash : "",
    typeof entry.powershell === "string" ? entry.powershell : "",
  ].join("\n");
  // Current managed script names identify the registration setup owns.
  if (
    spec.scriptFiles.some(
      (script) =>
        script !== "run-with-bash.mjs" &&
        commandsReferenceScriptToken(commands, script),
    )
  ) {
    return true;
  }
  // Historical deny script names remain managed so upgrades can remove them.
  if (
    spec.id === "deny-dangerous" &&
    LEGACY_DENY_DANGEROUS_SCRIPT_NAMES.some((script) =>
      commandsReferenceScriptToken(commands, script),
    )
  ) {
    return true;
  }
  return false;
}

/** Detect any nested hook entry that points at one of the spec's managed scripts. */
function entryReferencesSpec(entry: unknown, spec: HookSpec): boolean {
  // Non-object JSON cannot contain a managed hook command or nested hook list.
  if (!isObject(entry)) return false;
  // A direct command match is enough for upgrade removal and replacement.
  if (commandEntryReferencesSpec(entry, spec)) return true;
  // Matcher groups nest the runnable command under their hooks array.
  if (Array.isArray(entry.hooks)) {
    return entry.hooks.some((hook) => entryReferencesSpec(hook, spec));
  }
  return false;
}

/**
 * Checks command and runner timeout so dashboard state matches what users will actually run.
 */
function entryMatchesSpecRegistration(
  entry: unknown,
  agent: AgentProfile,
  spec: HookSpec,
): boolean {
  // Non-object JSON cannot represent a valid managed registration.
  if (!isObject(entry)) return false;
  // A direct command must also carry the timeout supported by this runner.
  if (commandEntryReferencesSpec(entry, spec)) {
    // Codex has no timeout field, and hooks without a registry timeout use agent defaults.
    if (agent.id === "codex" || spec.timeoutSec === undefined) return true;
    const timeoutField = agent.id === "copilot" ? "timeoutSec" : "timeout";
    return entry[timeoutField] === spec.timeoutSec;
  }
  // Matcher groups are valid when one nested command has the complete registration.
  if (Array.isArray(entry.hooks)) {
    return entry.hooks.some((hook) =>
      entryMatchesSpecRegistration(hook, agent, spec),
    );
  }
  return false;
}

/** Translate generic hook matchers into Antigravity's tool names while leaving other agents unchanged. */
function matcherForAgent(agent: AgentProfile, spec: HookSpec): string {
  if (spec.event === "Stop") return "";
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
  if (spec.event === "Stop") {
    const command: JsonObject = {
      type: "command",
      command: shellCommand(agent, spec),
    };
    if (agent.id === "claude" && spec.timeoutSec !== undefined) {
      command.timeout = spec.timeoutSec;
    }
    if (agent.id === "codex") command.statusMessage = spec.displayName;
    return [{ hooks: [command] }];
  }
  return matcherParts(spec.matcher).map((matcher) => {
    const command: JsonObject = {
      type: "command",
      command: shellCommand(agent, spec),
    };
    // Codex's hook schema carries no timeout field, so only Claude gets the override.
    if (agent.id === "claude" && spec.timeoutSec !== undefined) {
      command.timeout = spec.timeoutSec;
    }
    if (agent.id === "codex") command.statusMessage = spec.displayName;
    return {
      matcher,
      hooks: [command],
    };
  });
}

/** Create Copilot's single hook entry shape with both bash and PowerShell commands. */
function copilotEntry(agent: AgentProfile, spec: HookSpec): JsonObject {
  const crossPlatformCommand = shellCommand(agent, spec);
  return {
    type: "command",
    bash: crossPlatformCommand,
    powershell: crossPlatformCommand,
    timeoutSec: spec.timeoutSec ?? 30,
  };
}

function antigravityHookDefinition(
  agent: AgentProfile,
  spec: HookSpec,
): JsonObject {
  const command = {
    type: "command",
    command: shellCommand(agent, spec),
    timeout: spec.timeoutSec ?? 30,
  };
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

function hasAntigravityExpectedEntries(
  config: JsonObject,
  agent: AgentProfile,
  spec: HookSpec,
): boolean {
  const definition = config[spec.id];
  if (!isObject(definition) || definition.enabled === false) return false;
  const entries = definition[hookEventKey(agent, spec)];
  if (!Array.isArray(entries)) return false;
  if (spec.event === "Stop") {
    return entries.some(
      (entry) =>
        isObject(entry) && entryMatchesSpecRegistration(entry, agent, spec),
    );
  }
  return entries.some(
    (entry) =>
      isObject(entry) &&
      entry.matcher === matcherForAgent(agent, spec) &&
      entryMatchesSpecRegistration(entry, agent, spec),
  );
}

function hasEventExpectedEntries(
  config: JsonObject,
  agent: AgentProfile,
  spec: HookSpec,
): boolean {
  const hooks = isObject(config.hooks) ? config.hooks : {};
  const entries = hooks[hookEventKey(agent, spec)];
  if (!Array.isArray(entries)) return false;
  if (spec.event === "Stop") {
    return entries.some((entry) =>
      entryMatchesSpecRegistration(entry, agent, spec),
    );
  }
  if (agent.id === "copilot") {
    return entries.some((entry) =>
      entryMatchesSpecRegistration(entry, agent, spec),
    );
  }
  return matcherParts(spec.matcher).every((matcher) =>
    entries.some(
      (entry) =>
        isObject(entry) &&
        entry.matcher === matcher &&
        entryMatchesSpecRegistration(entry, agent, spec),
    ),
  );
}

function hasAllExpectedEntries(
  config: JsonObject,
  agent: AgentProfile,
  spec: HookSpec,
): boolean {
  if (agent.id === "antigravity") {
    return hasAntigravityExpectedEntries(config, agent, spec);
  }
  return hasEventExpectedEntries(config, agent, spec);
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
