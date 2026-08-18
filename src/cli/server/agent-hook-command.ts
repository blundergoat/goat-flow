/**
 * Builds and recognizes exact commands registered in coding-agent hook config.
 *
 * Use when setup installs, syncs, or checks the command a user's provider runs.
 * It owns response modes, portable root discovery, matchers, and host timeouts, while the writer keeps responsibility for reading and changing config
 * files.
 */
import { PROFILES } from "../detect/agents.js";
import type { AgentId, AgentProfile } from "../types.js";
import type { HookSpec } from "./hooks-registry.js";

const HOOK_LAUNCH_MODE_PART_COUNT = 6; // Contract: host, response, result, event, adapter, deadline.
type HookResponseKind = "policy" | "gruff" | "post-turn";

/** Provider-neutral event names embedded in versioned launcher identities. */
const CANONICAL_HOOK_EVENTS: Record<HookSpec["event"], string> = {
  PreToolUse: "pre-tool",
  PostToolUse: "post-tool",
  Stop: "turn-stop",
};

/** Keyed JSON object safe for reading agent hook configuration fields. */
export type AgentHookJsonObject = Record<string, unknown>;

/** Retired deny script names setup still recognizes and removes by exact token. */
export const LEGACY_DENY_DANGEROUS_SCRIPT_NAMES = [
  "guard-common.sh",
  "guard-destructive-shell.sh",
  "guard-secret-paths.sh",
  "guard-repository-writes.sh",
  "guardrails-self-test.sh",
  "deny-dangerous.self-test.sh",
];

/** Retired Antigravity deny ids setup still removes during migration. */
export const LEGACY_DENY_DANGEROUS_HOOK_IDS = [
  "guard-destructive-shell",
  "guard-secret-paths",
  "guard-repository-writes",
];

/**
 * Recognize the keyed JSON shape used by user hook configuration.
 * Use before reading unknown parsed values; null, arrays, and primitives return false.
 *
 * @param candidate - parsed config value; null or empty primitives are not keyed objects
 * @returns true for a non-null, non-array object; false keeps unsafe values unread
 */
export function isAgentHookJsonObject(
  candidate: unknown,
): candidate is AgentHookJsonObject {
  return (
    candidate !== null &&
    typeof candidate === "object" &&
    Array.isArray(candidate) === false
  );
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
  const responseModeParts = hookResponseMode.split(":");
  const hasNamespacedResponseMode =
    responseModeParts.length === HOOK_LAUNCH_MODE_PART_COUNT;
  const providerIdentifier = hasNamespacedResponseMode
    ? responseModeParts[0]
    : hookResponseMode;
  const responseKind = hasNamespacedResponseMode
    ? responseModeParts[1]
    : hookResponseMode;
  // Optional Gruff feedback fails soft so a missing analyzer shell never blocks the user's edit.
  if (responseKind === "gruff") {
    return "const reportUnavailable=(reason)=>{process.stderr.write('gruff-code-quality: hook unavailable: '+reason+'; skipped.'+lineBreak);process.exit(0);};";
  }
  // Post-turn safety cannot claim a completed scan when its launcher never started.
  if (responseKind === "post-turn") {
    return "const reportUnavailable=(reason)=>{process.stderr.write('post-turn-safety: hook unavailable: '+reason+'.'+lineBreak);process.exit(2);};";
  }
  // Antigravity expects a deny decision on stdout and treats the host response as handled.
  if (providerIdentifier === "antigravity") {
    return "const reportUnavailable=(reason)=>{process.stdout.write(JSON.stringify({decision:'deny',reason:'Policy hook unavailable: '+reason+'.'})+lineBreak);process.exit(0);};";
  }
  // Copilot expects its own permission-decision fields when the policy hook cannot start.
  if (providerIdentifier === "copilot") {
    return "const reportUnavailable=(reason)=>{process.stdout.write(JSON.stringify({permissionDecision:'deny',permissionDecisionReason:'Policy hook unavailable: '+reason+'.'})+lineBreak);process.exit(0);};";
  }
  // Safety hooks default to a visible fail-closed response instead of allowing an unchecked command.
  return "const reportUnavailable=(reason)=>{process.stderr.write('BLOCKED: Policy hook unavailable: '+reason+'.'+lineBreak);process.exit(2);};";
}

/**
 * Shared opening source for both generated bootstraps: imports, operand reads, and failure responder.
 * Use so the legacy and structured launchers read identical registration operands.
 *
 * @param unavailableResponseProgram - provider failure responder source; never empty
 * @returns ordered source fragments; never empty because every bootstrap needs its operands
 */
function bootstrapPreludeFragments(
  unavailableResponseProgram: string,
): string[] {
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
  ];
}

// ADR-052 freezes deferred provider registrations, so this recognizer must keep
// emitting exactly the bytes those providers registered before ADR-053.
const LEGACY_REGISTRATION_RECOGNITION_FRAGMENT =
  "const registrationNamesOperands=(value)=>{if(Array.isArray(value))return value.some(registrationNamesOperands);if(!isPlainObject(value))return false;for(const [key,nested] of Object.entries(value)){if((key==='command'||key==='bash'||key==='powershell')&&typeof nested==='string'&&commandNamesOperands(nested))return true;if((Array.isArray(nested)||isPlainObject(nested))&&registrationNamesOperands(nested))return true;}return false;};";

// Structured registrations name their operands as argv elements, so root
// recognition must also accept an args tuple beside legacy command strings.
const STRUCTURED_REGISTRATION_RECOGNITION_FRAGMENTS = [
  "const argsNameOperands=(argumentValues)=>{const normalized=argumentValues.filter((argumentValue)=>typeof argumentValue==='string').map(normalizeOperand);return normalized.includes(normalizeOperand(hookScriptPath))&&normalized.includes(normalizeOperand(bashLauncherRelativePath));};",
  "const registrationNamesOperands=(value)=>{if(Array.isArray(value))return value.some(registrationNamesOperands);if(!isPlainObject(value))return false;for(const [key,nested] of Object.entries(value)){if((key==='command'||key==='bash'||key==='powershell')&&typeof nested==='string'&&commandNamesOperands(nested))return true;if(key==='args'&&Array.isArray(nested)&&argsNameOperands(nested))return true;if((Array.isArray(nested)||isPlainObject(nested))&&registrationNamesOperands(nested))return true;}return false;};",
];

/**
 * Shared root-selection source: Git root first, then real cwd ancestors, then the approved environment fallback, classifying absent, corrupt, and
 * complete managed roots.
 * Use after a registration recognizer is defined; both bootstraps must select identical roots.
 *
 * @returns ordered source fragments ending with the validated launcher path; never empty
 */
function rootDiscoveryFragments(): string[] {
  return [
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
  ];
}

// Deferred providers keep launching the validated hook through a second Node process.
const LEGACY_SPAWN_TAIL_FRAGMENTS = [
  "const hookResult=childProcess.spawnSync(process.execPath,[bashLauncherPath,hookScriptPath,responseMode],{cwd:projectRoot,stdio:'inherit'});",
  "/* A startup error or absent status means the user's hook never produced a trustworthy result. */",
  "if(hookResult.error||!Number.isInteger(hookResult.status))reportUnavailable('managed launcher could not start');",
  "process.exit(hookResult.status);",
];

// The structured bootstrap loads the shipped launcher in-process; missing, corrupt,
// or API-invalid downstream code becomes the provider's unavailable response.
const STRUCTURED_IMPORT_TAIL_FRAGMENTS = [
  "import(require('node:url').pathToFileURL(bashLauncherPath).href).then((launcherModule)=>{",
  "/* Downstream code without the launcher API cannot be trusted to guard the user's command. */",
  "if(typeof launcherModule.runHookWithBash!=='function')reportUnavailable('managed launcher API mismatch');",
  "return launcherModule.runHookWithBash(hookScriptPath,responseMode,{root:projectRoot});",
  "}).then((hookStatus)=>{",
  "/* A non-numeric result means the user's hook never produced a trustworthy decision. */",
  "if(!Number.isInteger(hookStatus))reportUnavailable('managed launcher returned no result');",
  "process.exit(hookStatus);",
  "}).catch(()=>reportUnavailable('managed launcher could not start'));",
];

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
    ...bootstrapPreludeFragments(unavailableResponseProgram),
    LEGACY_REGISTRATION_RECOGNITION_FRAGMENT,
    ...rootDiscoveryFragments(),
    ...LEGACY_SPAWN_TAIL_FRAGMENTS,
  ].join("");
}

/**
 * Build the structured `-e` source registered as one exec-form argv element.
 * Use for providers whose live capture approves argv handlers; it keeps the legacy root contract while importing the shipped launcher instead of
 * spawning Node again.
 *
 * @param hookResponseMode - host response selected for this hook; empty uses fail-closed policy behavior
 * @returns structured bootstrap source; never empty because it becomes args[1] of the handler
 */
function structuredHookLaunchBootstrap(hookResponseMode: string): string {
  const unavailableResponseProgram =
    unavailableHookResponseProgram(hookResponseMode);
  return [
    ...bootstrapPreludeFragments(unavailableResponseProgram),
    ...STRUCTURED_REGISTRATION_RECOGNITION_FRAGMENTS,
    ...rootDiscoveryFragments(),
    ...STRUCTURED_IMPORT_TAIL_FRAGMENTS,
  ].join("");
}

/**
 * Choose the user-facing failure category for one managed hook.
 * Use before provider protocol selection so optional feedback stays non-blocking.
 *
 * @param spec - hook being registered; an unknown id uses fail-closed policy behavior
 * @returns policy, Gruff, or post-turn category; never empty
 */
function hookResponseKind(spec: HookSpec): HookResponseKind {
  // Gruff is optional feedback, so unavailable execution is shown as a non-blocking skip.
  if (spec.id === "gruff-code-quality") return "gruff";
  // Post-turn safety must return a failing scan outcome instead of a permission payload.
  if (spec.id === "post-turn-safety") return "post-turn";
  return "policy";
}

/**
 * Select the response mode used by hooks that predate the versioned result envelope.
 * Use so existing users retain the exact host protocol their agent understands.
 *
 * @param agentId - selected provider; empty ids cannot pass setup validation
 * @param responseKind - user-facing hook category; never empty
 * @returns legacy response mode; never empty
 */
function legacyHookLaunchMode(
  agentId: AgentId,
  responseKind: HookResponseKind,
): string {
  // Feedback and Stop hooks keep their category-specific unavailable message on every host.
  if (responseKind !== "policy") return responseKind;
  // Antigravity requires its decision JSON shape for legacy command admission.
  if (agentId === "antigravity") return "antigravity";
  // Copilot requires permission-decision fields for legacy pre-tool output.
  if (agentId === "copilot") return "copilot";
  return "policy";
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
  const responseKind = hookResponseKind(spec);
  const deliveryContract =
    spec.providerDeliveryContracts?.[agentId] ?? spec.deliveryContract;
  // Legacy hooks keep installed command parity until their detector and installer migrate together.
  if (!deliveryContract || deliveryContract.resultProtocol === "legacy") {
    return legacyHookLaunchMode(agentId, responseKind);
  }

  return [
    agentId,
    responseKind,
    deliveryContract.resultProtocol,
    CANONICAL_HOOK_EVENTS[spec.event],
    deliveryContract.adapterVersion,
    deliveryContract.launcherDeadlineMs,
  ].join(":");
}

/**
 * Check whether this host owns the timeout field proven for one user-facing lifecycle.
 * Use while writing and inspecting config; false leaves that provider's default untouched.
 *
 * @param agent - selected provider profile; an empty id is impossible after setup validation
 * @param spec - hook being registered; missing timeout metadata means the host default remains
 * @returns true when setup owns this timeout field, including approved Codex feedback and Stop hooks
 */
export function agentRegistersHostTimeout(
  agent: AgentProfile,
  spec: HookSpec,
): boolean {
  // Codex timeout ownership is limited to the live-proven PostToolUse and Stop registrations.
  if (agent.id === "codex") {
    return spec.id === "gruff-code-quality" || spec.id === "post-turn-safety";
  }
  return true;
}

/**
 * Complete handler shape one provider registers for a managed hook.
 *
 * Shell descriptors carry one host-parsed command string; argv descriptors carry an exec-form executable plus ordered arguments that no shell
 * retokenizes.
 * Readers compare the complete selected descriptor, never a reconstructed string.
 */
export type AgentHookHandlerDescriptor =
  | { form: "shell"; command: string }
  | { form: "argv"; command: string; args: string[] };

/**
 * Build the handler descriptor written into the selected agent's configuration.
 *
 * Use during install, sync, and audit so every consumer derives one launch contract.
 * Claude uses the ADR-053 argv form; providers without fresh live captures keep their deferred shell command byte-for-byte.
 *
 * @param agentId - agent receiving the handler; empty is impossible after setup validation
 * @param hooksDirectory - project hook folder; empty would produce an invalid managed path
 * @param spec - hook behavior and script; missing metadata is rejected before config generation
 * @returns complete provider handler descriptor; never empty because enabled hooks must be runnable
 * @throws when the selected provider has no hook config path
 */
export function buildAgentHookDescriptor(
  agentId: AgentId,
  hooksDirectory: string,
  spec: HookSpec,
): AgentHookHandlerDescriptor {
  const hookScriptPath = commandPath(hooksDirectory, spec.primaryScript);
  const bashLauncherPath = commandPath(hooksDirectory, "run-with-bash.mjs");
  const hookResponseMode = hookLaunchMode(agentId, spec);
  const registrationPath = PROFILES[agentId].hookConfigFile;
  // A provider without a config surface cannot receive the handler the user enabled.
  if (!registrationPath) throw new Error(`${agentId} has no hook config file`);
  // Codex can use managed ancestors but has no supported final host-root environment fallback.
  const rootEnvironmentName = agentId === "codex" ? "-" : "CLAUDE_PROJECT_DIR";
  // Claude's live capture approves exec form, so its operands bypass host shells entirely.
  if (agentId === "claude") {
    return {
      form: "argv",
      command: "node",
      args: [
        "-e",
        structuredHookLaunchBootstrap(hookResponseMode),
        hookScriptPath,
        hookResponseMode,
        rootEnvironmentName,
        registrationPath,
        bashLauncherPath,
      ],
    };
  }
  return {
    form: "shell",
    command: [
      "node",
      "-e",
      JSON.stringify(hookLaunchBootstrap(hookResponseMode)),
      JSON.stringify(hookScriptPath),
      JSON.stringify(hookResponseMode),
      JSON.stringify(rootEnvironmentName),
      JSON.stringify(registrationPath),
      JSON.stringify(bashLauncherPath),
    ].join(" "),
  };
}

/**
 * Build a handler descriptor after setup has selected an agent profile.
 * A profile without a hook folder is rejected so users never receive a dead config entry.
 *
 * @param agent - selected agent profile; a missing hook folder means this host cannot register hooks
 * @param spec - enabled hook; missing metadata is rejected before this writer runs
 * @returns complete provider handler descriptor; never empty for supported agents
 * @throws when the selected agent has no managed hook directory
 */
export function managedAgentHookDescriptor(
  agent: AgentProfile,
  spec: HookSpec,
): AgentHookHandlerDescriptor {
  // An unsupported profile cannot offer a working hook, so setup fails before writing its config.
  if (!agent.hooksDir) throw new Error(`${agent.id} has no hooks dir`);
  return buildAgentHookDescriptor(agent.id, agent.hooksDir, spec);
}

/**
 * Build the single-string hook command for providers still on the deferred shell form.
 * Use only where a provider config field stores one command string.
 *
 * @param agentId - agent receiving the command; empty is impossible after setup validation
 * @param hooksDirectory - project hook folder; empty would produce an invalid managed path
 * @param spec - hook behavior and script; missing metadata is rejected before config generation
 * @returns shell-neutral Node command; never empty for shell-form providers
 * @throws when the provider uses a structured argv descriptor instead of one command string
 */
export function buildAgentHookCommand(
  agentId: AgentId,
  hooksDirectory: string,
  spec: HookSpec,
): string {
  const descriptor = buildAgentHookDescriptor(agentId, hooksDirectory, spec);
  // An argv handler has no faithful single-string form; callers must read the descriptor.
  if (descriptor.form !== "shell") {
    throw new Error(
      `${agentId} registers a structured argv handler; read buildAgentHookDescriptor`,
    );
  }
  return descriptor.command;
}

/**
 * Build the single-string managed command for a shell-form provider profile.
 * A profile without a hook folder is rejected so users never receive a dead config entry.
 *
 * @param agent - selected agent profile; a missing hook folder means this host cannot register hooks
 * @param spec - enabled hook; missing metadata is rejected before this writer runs
 * @returns registered Node command; never empty for shell-form providers
 * @throws when the agent has no hook directory or registers a structured argv handler
 */
export function managedAgentHookCommand(
  agent: AgentProfile,
  spec: HookSpec,
): string {
  // An unsupported profile cannot offer a working hook, so setup fails before writing its config.
  if (!agent.hooksDir) throw new Error(`${agent.id} has no hooks dir`);
  return buildAgentHookCommand(agent.id, agent.hooksDir, spec);
}

/**
 * Identify an exact managed script token without claiming similar user hook names.
 * Use before setup adds, replaces, or removes a registration.
 * For example, `custom-post-turn-safety.sh` remains user-owned.
 *
 * @param commands - runnable text from one config entry, joined by newlines; empty means the entry
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

/**
 * Flatten every runnable text field one config entry exposes for token scanning.
 * Use so string commands and structured argv operands share one recognition path.
 *
 * @param entry - keyed config row; missing command, shell, and args fields yield empty text
 * @returns newline-joined command strings and string argv elements; empty means nothing runnable
 */
function entryCommandSearchText(entry: AgentHookJsonObject): string {
  // Structured handlers carry their operands as argv elements rather than one shell string.
  const argumentOperands = Array.isArray(entry.args)
    ? entry.args.filter(
        (argumentValue): argumentValue is string =>
          typeof argumentValue === "string",
      )
    : [];
  return [
    typeof entry.command === "string" ? entry.command : "",
    typeof entry.bash === "string" ? entry.bash : "",
    typeof entry.powershell === "string" ? entry.powershell : "",
    ...argumentOperands,
  ].join("\n");
}

/**
 * Detect a direct command that launches one current or retired managed script.
 * Use before setup claims ownership of a user's config row.
 *
 * @param entry - unknown parsed row; null, empty, or primitive values cannot launch a hook
 * @param spec - managed hook contract; empty script metadata matches no command
 * @returns true for an exact managed script token; false preserves user-authored commands
 */
export function commandEntryReferencesSpec(
  entry: unknown,
  spec: HookSpec,
): boolean {
  // Non-object JSON cannot represent a runnable hook command.
  if (!isAgentHookJsonObject(entry)) return false;
  const commands = entryCommandSearchText(entry);
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

/**
 * Detect one managed command inside a direct row or nested matcher group.
 * Use for safe replacement, removal, and registration diagnostics.
 *
 * @param entry - unknown parsed row; null or empty values contain no managed command
 * @param spec - managed hook contract; empty script metadata cannot match
 * @returns true when any nested command is setup-owned; false keeps user rows untouched
 */
export function entryReferencesSpec(entry: unknown, spec: HookSpec): boolean {
  // Non-object JSON cannot contain a managed hook command or nested hook list.
  if (!isAgentHookJsonObject(entry)) return false;
  // A direct command match is enough for upgrade removal and replacement.
  if (commandEntryReferencesSpec(entry, spec)) return true;
  // Matcher groups nest the runnable command under their hooks array.
  if (Array.isArray(entry.hooks)) {
    return entry.hooks.some((hook) => entryReferencesSpec(hook, spec));
  }
  return false;
}

/**
 * Compare one config row with a complete provider handler descriptor.
 * Use for exact installed-state and drift decisions; partial argv matches stay stale.
 *
 * @param entry - keyed config row; missing handler fields cannot equal a descriptor
 * @param agentId - selected provider; Copilot compares both of its shell fields
 * @param descriptor - expected complete handler; never empty for supported providers
 * @returns true only when every selected descriptor field is byte-identical
 */
export function entryCarriesHandlerDescriptor(
  entry: AgentHookJsonObject,
  agentId: AgentId,
  descriptor: AgentHookHandlerDescriptor,
): boolean {
  // Copilot stores the same shell command in both of its platform fields.
  if (agentId === "copilot") {
    return (
      entry.bash === descriptor.command &&
      entry.powershell === descriptor.command
    );
  }
  // Argv handlers must match the executable plus every ordered argument exactly.
  if (descriptor.form === "argv") {
    if (entry.command !== descriptor.command || !Array.isArray(entry.args)) {
      return false;
    }
    const registeredArguments = entry.args;
    return (
      registeredArguments.length === descriptor.args.length &&
      descriptor.args.every(
        (argumentValue, argumentIndex) =>
          registeredArguments[argumentIndex] === argumentValue,
      )
    );
  }
  return entry.command === descriptor.command;
}

/**
 * Check one managed row against the current launcher and response contract.
 * Use so status can distinguish stale commands from other registration drift.
 *
 * @param entry - unknown parsed row; null or empty values cannot match a command
 * @param agent - selected provider; a null hook directory makes expected-descriptor creation throw
 * @param spec - expected hook contract; empty metadata cannot produce an exact descriptor
 * @returns true for byte-identical direct or nested handlers; false means command repair is needed
 */
export function entryMatchesSpecCommand(
  entry: unknown,
  agent: AgentProfile,
  spec: HookSpec,
): boolean {
  // Non-object JSON cannot represent a valid managed registration.
  if (!isAgentHookJsonObject(entry)) return false;
  // A direct handler must equal the registry-generated descriptor field for field.
  if (commandEntryReferencesSpec(entry, spec)) {
    const expectedDescriptor = managedAgentHookDescriptor(agent, spec);
    return entryCarriesHandlerDescriptor(entry, agent.id, expectedDescriptor);
  }
  // Matcher groups can carry the exact managed handler one level below the event row.
  if (Array.isArray(entry.hooks)) {
    return entry.hooks.some((hook) =>
      entryMatchesSpecCommand(hook, agent, spec),
    );
  }
  return false;
}

/**
 * Check the provider timeout separately from managed command bytes.
 * Use so users receive precise timeout-drift repair guidance.
 *
 * @param entry - unknown parsed row; null or empty values cannot carry a timeout
 * @param agent - selected provider profile
 * @param spec - expected hook; an absent timeout keeps an unowned provider default valid
 * @returns true when timeout is exact or unowned; false means the host may end the hook too early
 */
export function entryMatchesSpecTimeout(
  entry: unknown,
  agent: AgentProfile,
  spec: HookSpec,
): boolean {
  // Non-object JSON cannot carry a valid host timeout.
  if (!isAgentHookJsonObject(entry)) return false;
  // A direct managed command owns the timeout field at the same object level.
  if (commandEntryReferencesSpec(entry, spec)) {
    // Unowned or absent timeout metadata leaves the provider's current default valid.
    if (
      !agentRegistersHostTimeout(agent, spec) ||
      spec.timeoutSec === undefined
    )
      return true;
    const timeoutField = agent.id === "copilot" ? "timeoutSec" : "timeout";
    return entry[timeoutField] === spec.timeoutSec;
  }
  // Matcher groups carry timeout beside the nested runnable command.
  if (Array.isArray(entry.hooks)) {
    return entry.hooks.some((hook) =>
      entryMatchesSpecTimeout(hook, agent, spec),
    );
  }
  return false;
}

/**
 * Check command and timeout together for the installed state shown to users.
 * Use as the exact-registration decision after event and matcher selection.
 *
 * @param entry - unknown parsed row; null or empty values cannot be installed
 * @param agent - selected provider profile
 * @param spec - expected managed hook contract
 * @returns true only when command and timeout are current; false exposes repairable drift
 */
export function entryMatchesSpecRegistration(
  entry: unknown,
  agent: AgentProfile,
  spec: HookSpec,
): boolean {
  // Both links must match; a stale response mode or timeout keeps the registration non-current.
  if (!entryMatchesSpecCommand(entry, agent, spec)) return false;
  return entryMatchesSpecTimeout(entry, agent, spec);
}

/**
 * Translate registry matchers into the exact tool names one provider emits.
 * Use when setup writes and later verifies a tool-triggered registration.
 *
 * @param agent - selected provider profile
 * @param spec - managed hook; an empty matcher yields no tool-triggered coverage
 * @returns provider matcher; empty only for matcherless Stop events
 */
export function matcherForAgent(agent: AgentProfile, spec: HookSpec): string {
  // Stop events are matcherless because they follow the completed user turn rather than a tool.
  if (spec.event === "Stop") return "";
  // Codex reports source edits through the canonical apply_patch tool observed in live delivery.
  if (agent.id === "codex" && spec.id === "gruff-code-quality") {
    return "^apply_patch$";
  }
  // Other provider matchers retain their shared registry vocabulary.
  if (agent.id !== "antigravity") return spec.matcher;
  // Antigravity uses its file-edit tool names for the same user action.
  if (spec.id === "gruff-code-quality") {
    return [
      "write_to_file",
      "replace_file_content",
      "multi_replace_file_content",
    ].join("|");
  }
  // Antigravity policy coverage includes both shell and direct file actions users can request.
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
