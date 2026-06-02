/**
 * Registrar that reconciles `.goat-flow/config.yaml` hook truth to detected
 * hook-capable agent surfaces in the selected project.
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { getAgentProfiles } from "../agents/registry.js";
import { readHookEnabled, setHookEnabled } from "../config/writer.js";
import { getTemplatePath } from "../paths.js";
import type { AgentId, AgentProfile } from "../types.js";
import {
  getHookSpec,
  isValidHookIdShape,
  listHookSpecs,
  type HookSpec,
} from "./hooks-registry.js";
import {
  readAgentHookState,
  writeAgentHookState,
} from "./agent-hook-writer.js";
import { writeFileAtomic } from "./safe-exec.js";

const DENY_DANGEROUS_HOOK_LIB_FILES = [
  "patterns-shell.sh",
  "patterns-paths.sh",
  "patterns-writes.sh",
  "deny-dangerous-self-test.sh",
];
const LEGACY_DENY_DANGEROUS_SCRIPT_NAMES = [
  "guard-common.sh",
  "guard-destructive-shell.sh",
  "guard-secret-paths.sh",
  "guard-repository-writes.sh",
  "guardrails-self-test.sh",
  "deny-dangerous.self-test.sh",
];

type HookDrift = "desired-on-actual-off" | "desired-off-actual-on";

/** Per-agent hook installation/config state for one registry hook. */
interface HookAgentState extends Record<"supported", boolean> {
  installed: boolean;
  scriptPath: string | null;
  configPath: string | null;
  drift?: HookDrift;
  reason?: string;
}

/** Dashboard-facing hook state including defaults, drift, and per-agent registration status. */
export interface HookState extends Record<"togglable" | "enabled", boolean> {
  id: string;
  name: string;
  description: string;
  defaultEnabled: boolean;
  requiresConfirmDialog: boolean;
  agents: Record<AgentId, HookAgentState>;
}

/** HTTP-safe hook registrar failure with the status code routes should return. */
class HookRegistrarError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "HookRegistrarError";
  }
}

export { HookRegistrarError };

/** Validate and resolve a hook id into the registry spec; bad ids throw 400 and unknown ids throw 404. Throws on invalid input. */
function resolveSpec(hookId: string): HookSpec {
  if (!isValidHookIdShape(hookId)) {
    throw new HookRegistrarError("Invalid hook id", 400);
  }
  const spec = getHookSpec(hookId);
  if (!spec) throw new HookRegistrarError(`Unknown hook: ${hookId}`, 404);
  return spec;
}

/** Confirm an agent profile has all manifest paths needed for hook registration. */
function isSupportedAgent(agent: AgentProfile): boolean {
  return (
    agent.hooksDir !== null &&
    agent.hookConfigFile !== null &&
    agent.hookEvents !== null
  );
}

function unsupportedReasonForSpec(
  spec: HookSpec,
  agent: AgentProfile,
): string | null {
  return spec.unsupportedAgents?.[agent.id] ?? null;
}

/** Block hook script writes that would escape the selected project root; throws a 400 registrar error. */
function assertWithinProject(projectPath: string, targetPath: string): void {
  const root = resolve(projectPath);
  const target = resolve(targetPath);
  if (target === root || target.startsWith(`${root}/`)) return;
  throw new HookRegistrarError("Refusing to write outside project path", 400);
}

function scriptTarget(
  projectPath: string,
  agent: AgentProfile,
  script: string,
) {
  if (!agent.hooksDir) throw new Error(`${agent.id} has no hooks dir`);
  const target = join(projectPath, agent.hooksDir, script);
  assertWithinProject(projectPath, target);
  return target;
}

function scriptExists(
  projectPath: string,
  agent: AgentProfile,
  spec: HookSpec,
): boolean {
  const agentScriptsExist = spec.scriptFiles.every((script) =>
    existsSync(scriptTarget(projectPath, agent, script)),
  );
  if (!agentScriptsExist) return false;
  if (spec.id !== "deny-dangerous") return true;
  return DENY_DANGEROUS_HOOK_LIB_FILES.every((file) =>
    existsSync(join(projectPath, ".goat-flow", "hook-lib", file)),
  );
}

type AgentProfilePathKey =
  | "instructionFile"
  | "skillsDir"
  | "settingsFile"
  | "hookConfigFile"
  | "hooksDir";

function profilePathIsUnique(
  profiles: AgentProfile[],
  key: AgentProfilePathKey,
  path: string | null,
): boolean {
  if (!path) return false;
  return profiles.filter((profile) => profile[key] === path).length === 1;
}

function agentInstalledSurfaceExists(
  projectPath: string,
  agent: AgentProfile,
  profiles: AgentProfile[],
): boolean {
  const uniqueOptionalMarkers = [
    profilePathIsUnique(profiles, "instructionFile", agent.instructionFile)
      ? agent.instructionFile
      : null,
    profilePathIsUnique(profiles, "skillsDir", agent.skillsDir)
      ? agent.skillsDir
      : null,
  ];
  const markers = [
    agent.settingsFile,
    agent.hookConfigFile,
    agent.hooksDir,
    ...uniqueOptionalMarkers,
  ].filter((marker): marker is string => typeof marker === "string");
  return markers.some((marker) => existsSync(join(projectPath, marker)));
}

function hookScriptResidueExists(
  projectPath: string,
  agent: AgentProfile,
  spec: HookSpec,
): boolean {
  if (!agent.hooksDir) return false;
  const scriptFiles =
    spec.id === "deny-dangerous"
      ? [...spec.scriptFiles, ...LEGACY_DENY_DANGEROUS_SCRIPT_NAMES]
      : spec.scriptFiles;
  return scriptFiles.some((script) =>
    existsSync(scriptTarget(projectPath, agent, script)),
  );
}

function shouldReconcileAgent(
  projectPath: string,
  agent: AgentProfile,
  spec: HookSpec,
  profiles: AgentProfile[],
): boolean {
  return (
    agentInstalledSurfaceExists(projectPath, agent, profiles) ||
    hookScriptResidueExists(projectPath, agent, spec)
  );
}

/** Check for an existing hook config before writing disabled state for optional hooks. */
function hookConfigExists(projectPath: string, agent: AgentProfile): boolean {
  return (
    agent.hookConfigFile !== null &&
    existsSync(join(projectPath, agent.hookConfigFile))
  );
}

function ensureGoatFlowGitignoreEntry(
  projectPath: string,
  entry: string,
): void {
  const gitignorePath = join(projectPath, ".goat-flow", ".gitignore");
  assertWithinProject(projectPath, gitignorePath);
  mkdirSync(join(projectPath, ".goat-flow"), { recursive: true });

  const original = existsSync(gitignorePath)
    ? readFileSync(gitignorePath, "utf-8")
    : "";
  const hasFinalNewline = original.length === 0 || original.endsWith("\n");
  const lines = original.split(/\r?\n/u).filter((line, index, all) => {
    return index < all.length - 1 || line.length > 0;
  });
  if (lines.includes(entry)) return;

  const next = `${lines.join("\n")}${lines.length > 0 ? "\n" : ""}${entry}\n`;
  writeFileAtomic(
    gitignorePath,
    hasFinalNewline ? next : next.trimEnd(),
    projectPath,
  );
}

/**
 * Keep the shared `.goat-flow/hook-lib/` policy store tracked by Git.
 *
 * Adds both `!hook-lib/` and `!hook-lib/**` negations to `.goat-flow/.gitignore` so the
 * deny-dangerous policy modules survive a fresh clone; without them a gitignored
 * `.goat-flow/` drops the store and the guard fails closed on checkout. Idempotent -
 * each entry is appended only when absent (writes `.goat-flow/.gitignore`).
 *
 * @param projectPath - target project root whose `.goat-flow/.gitignore` is updated
 */
function ensureHookLibGitignoreEntries(projectPath: string): void {
  ensureGoatFlowGitignoreEntry(projectPath, "!hook-lib/");
  ensureGoatFlowGitignoreEntry(projectPath, "!hook-lib/**");
}

function copyHookScripts(
  projectPath: string,
  agent: AgentProfile,
  spec: HookSpec,
): void {
  if (!agent.hooksDir) return;
  mkdirSync(join(projectPath, agent.hooksDir), { recursive: true });
  for (const script of spec.scriptFiles) {
    const source = getTemplatePath(`workflow/hooks/${script}`);
    const target = scriptTarget(projectPath, agent, script);
    writeFileAtomic(target, readFileSync(source, "utf-8"), projectPath);
    chmodSync(target, 0o755);
  }
  if (spec.id === "deny-dangerous") {
    ensureHookLibGitignoreEntries(projectPath);
    const targetDir = join(projectPath, ".goat-flow", "hook-lib");
    mkdirSync(targetDir, { recursive: true });
    for (const file of DENY_DANGEROUS_HOOK_LIB_FILES) {
      const source = getTemplatePath(`workflow/hooks/hook-lib/${file}`);
      const target = join(targetDir, file);
      assertWithinProject(projectPath, target);
      writeFileAtomic(target, readFileSync(source, "utf-8"), projectPath);
      chmodSync(target, 0o755);
    }
    for (const script of LEGACY_DENY_DANGEROUS_SCRIPT_NAMES) {
      removeScriptIfPresent(projectPath, agent, script);
    }
  }
}

function removeScriptIfPresent(
  projectPath: string,
  agent: AgentProfile,
  script: string,
): void {
  const target = scriptTarget(projectPath, agent, script);
  try {
    unlinkSync(target);
  } catch {
    /* target already gone - script removal is idempotent, missing file is fine */
  }
}

function removeHookScripts(
  projectPath: string,
  agent: AgentProfile,
  spec: HookSpec,
): void {
  removeScriptIfPresent(projectPath, agent, spec.primaryScript);
  if (spec.id === "deny-dangerous") {
    for (const script of LEGACY_DENY_DANGEROUS_SCRIPT_NAMES) {
      removeScriptIfPresent(projectPath, agent, script);
    }
  }
}

/** Build the state payload for an agent that cannot host the requested hook. */
function unsupportedAgentHookState(reason: string): HookAgentState {
  return {
    supported: false,
    installed: false,
    scriptPath: null,
    configPath: null,
    reason,
  };
}

function hookDrift(
  desired: boolean,
  installed: boolean,
): HookDrift | undefined {
  if (desired && !installed) return "desired-on-actual-off";
  if (!desired && installed) return "desired-off-actual-on";
  return undefined;
}

function supportedAgentHookState(
  projectPath: string,
  agent: AgentProfile,
  spec: HookSpec,
  desired: boolean,
): HookAgentState {
  const read = readAgentHookState(projectPath, agent, spec);
  const installed = read.installed && scriptExists(projectPath, agent, spec);
  const drift = hookDrift(desired, installed);
  return {
    supported: true,
    installed,
    scriptPath: agent.hooksDir
      ? `${agent.hooksDir}/${spec.primaryScript}`.replace(/\/+/gu, "/")
      : null,
    configPath: agent.hookConfigFile,
    ...(drift ? { drift } : {}),
    ...(read.configMissing ? { reason: "Hook config file is missing." } : {}),
    ...(read.configInvalid
      ? { reason: "Hook config file is invalid JSON." }
      : {}),
  };
}

function agentHookState(
  projectPath: string,
  agent: AgentProfile,
  spec: HookSpec,
  desired: boolean,
): HookAgentState {
  const unsupportedReason = unsupportedReasonForSpec(spec, agent);
  if (unsupportedReason) return unsupportedAgentHookState(unsupportedReason);
  if (!isSupportedAgent(agent)) {
    return unsupportedAgentHookState(
      "Agent manifest has no hook directory or hook config file.",
    );
  }
  return supportedAgentHookState(projectPath, agent, spec, desired);
}

/** Read persisted desired hook state, falling back to the registry default. */
function readDesired(projectPath: string, spec: HookSpec): boolean {
  return readHookEnabled(projectPath, spec.id, spec.defaultEnabled);
}

function reconcileHook(
  projectPath: string,
  spec: HookSpec,
  enabled: boolean,
): void {
  const profiles = getAgentProfiles();
  for (const agent of profiles) {
    if (unsupportedReasonForSpec(spec, agent)) continue;
    if (!isSupportedAgent(agent)) continue;
    if (!shouldReconcileAgent(projectPath, agent, spec, profiles)) continue;
    if (enabled) copyHookScripts(projectPath, agent, spec);
    else removeHookScripts(projectPath, agent, spec);
    if (enabled || hookConfigExists(projectPath, agent)) {
      writeAgentHookState(projectPath, agent, spec, enabled);
    }
  }
}

/** Snapshot one hook across all known agents for dashboard and CLI consumers. */
function readHookState(hookId: string, projectPath: string): HookState {
  const spec = resolveSpec(hookId);
  const enabled = readDesired(projectPath, spec);
  const agents = Object.fromEntries(
    getAgentProfiles().map((agent) => [
      agent.id,
      agentHookState(projectPath, agent, spec, enabled),
    ]),
  ) as Record<AgentId, HookAgentState>;
  return {
    id: spec.id,
    name: spec.displayName,
    description: spec.description,
    togglable: spec.togglable,
    enabled,
    defaultEnabled: spec.defaultEnabled,
    requiresConfirmDialog: spec.requiresConfirmDialog,
    agents,
  };
}

// Snapshots the current enabled/installed state of every known hook for one
// project; reads settings + script presence, so the result reflects on-disk
// reality, not the in-memory registry defaults.
export function readAllHookStates(projectPath: string): HookState[] {
  return listHookSpecs().map((spec) => readHookState(spec.id, projectPath));
}

export function applyHookState(
  hookId: string,
  enabled: boolean,
  projectPath: string,
): HookState {
  const spec = resolveSpec(hookId);
  if (!spec.togglable) {
    throw new HookRegistrarError(`Hook is not togglable: ${hookId}`, 400);
  }
  setHookEnabled(projectPath, spec.id, enabled);
  reconcileHook(projectPath, spec, enabled);
  return readHookState(spec.id, projectPath);
}

// Side-effecting: rewrites each togglable hook's installed files to match its
// persisted desired state, repairing drift (e.g. after a manual settings edit),
// then returns the refreshed snapshot. Non-togglable hooks are left untouched.
export function syncHookStates(projectPath: string): HookState[] {
  for (const spec of listHookSpecs()) {
    if (!spec.togglable) continue;
    reconcileHook(projectPath, spec, readDesired(projectPath, spec));
  }
  return readAllHookStates(projectPath);
}
