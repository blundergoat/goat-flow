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

type HookDrift = "desired-on-actual-off" | "desired-off-actual-on";

interface HookAgentState {
  supported: boolean;
  installed: boolean;
  scriptPath: string | null;
  configPath: string | null;
  drift?: HookDrift;
  reason?: string;
}

export interface HookState {
  id: string;
  name: string;
  description: string;
  togglable: boolean;
  enabled: boolean;
  defaultEnabled: boolean;
  requiresConfirmDialog: boolean;
  agents: Record<AgentId, HookAgentState>;
}

export class HookRegistrarError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "HookRegistrarError";
  }
}

function resolveSpec(hookId: string): HookSpec {
  if (!isValidHookIdShape(hookId)) {
    throw new HookRegistrarError("Invalid hook id", 400);
  }
  const spec = getHookSpec(hookId);
  if (!spec) throw new HookRegistrarError(`Unknown hook: ${hookId}`, 404);
  return spec;
}

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
  return spec.scriptFiles.every((script) =>
    existsSync(scriptTarget(projectPath, agent, script)),
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
  return spec.scriptFiles.some((script) =>
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

function hookConfigExists(projectPath: string, agent: AgentProfile): boolean {
  return (
    agent.hookConfigFile !== null &&
    existsSync(join(projectPath, agent.hookConfigFile))
  );
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
}

function removeHookScripts(
  projectPath: string,
  agent: AgentProfile,
  spec: HookSpec,
): void {
  const target = scriptTarget(projectPath, agent, spec.primaryScript);
  try {
    unlinkSync(target);
  } catch {
    /* already absent */
  }
}

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

export function syncHookStates(projectPath: string): HookState[] {
  for (const spec of listHookSpecs()) {
    if (!spec.togglable) continue;
    reconcileHook(projectPath, spec, readDesired(projectPath, spec));
  }
  return readAllHookStates(projectPath);
}
