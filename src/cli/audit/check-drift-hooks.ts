/**
 * Detects when a project's installed safety hooks no longer match the ones goat-flow ships.
 * Hooks are the layer that actually blocks dangerous commands, so a stale copy, a disabled
 * toggle, or a timeout that drifted is the difference between a user being protected and
 * only believing they are. Every comparison here exists to surface that gap before they
 * rely on it.
 *
 * The comparison runs across three surfaces because any one of them can silently break
 * protection: the hook script itself, the agent configuration that registers it, and the
 * per-agent timeout. A user who explicitly disabled a hook in their own config is respected
 * rather than reported, so their deliberate choice is never mistaken for drift.
 */
import { posix as pathPosix } from "node:path";
import { load } from "js-yaml";
import type { ReadonlyFS } from "../types.js";
import { loadManifest } from "../manifest/manifest.js";
import { listHookSpecs, type HookSpec } from "../server/hooks-registry.js";
import { buildAgentHookCommand } from "../server/agent-hook-writer.js";
import type { AgentId } from "../types.js";
import type { AgentProfile } from "../manifest/types.js";
import type { DriftFinding } from "./types.js";
import { readTemplateText } from "./artifact-templates.js";
import { isAgentId, isRecord } from "./drift-values.js";

/** Compare installed hook scripts against their workflow templates. */
function hookTemplateRel(
  agentId: string,
  agent: AgentProfile,
  hookFile: string,
): string {
  const hookConfigName = agent.hook_config_file
    ? pathPosix.basename(agent.hook_config_file)
    : null;
  if (hookConfigName && hookFile === hookConfigName) {
    return pathPosix.join(
      "workflow/hooks/agent-config",
      `${agentId}-hooks.json`,
    );
  }
  return pathPosix.join("workflow/hooks", hookFile);
}

/** Compare installed hook scripts against their workflow templates. */
function hookEventKey(agentId: AgentId, spec: HookSpec): string {
  if (agentId === "copilot") {
    return spec.event === "PreToolUse" ? "preToolUse" : "postToolUse";
  }
  return spec.event;
}

/**
 * Build the Copilot hook entry audit expects when the user enables a toggle.
 * Use to compare the installed command with the same portable launcher setup writes.
 *
 * @param agent - Copilot profile; an empty hook folder uses the managed default.
 * @param spec - Hook being compared; missing timeout uses the agent's 30-second default.
 * @returns Expected Copilot command entry; never null for a registered hook.
 */
function copilotHookEntry(agent: AgentProfile, spec: HookSpec): object {
  // Older profiles may omit the hook folder, so audit uses setup's managed location.
  const hooksDirectory = agent.hooks_dir ?? ".goat-flow/hooks";
  const crossPlatformCommand = buildAgentHookCommand(
    "copilot",
    hooksDirectory,
    spec,
  );
  // A missing registry timeout means Copilot's documented default remains expected.
  const timeoutSeconds = spec.timeoutSec ?? 30;
  return {
    type: "command",
    bash: crossPlatformCommand,
    powershell: crossPlatformCommand,
    timeoutSec: timeoutSeconds,
  };
}

/**
 * Detect whether one agent command directly starts the selected managed hook.
 * Use during drift checks so unrelated user hooks remain untouched and unreported.
 *
 * @param entry - Parsed config value; null, arrays, and primitives cannot be commands.
 * @param spec - Managed hook to find; an empty script list cannot match.
 * @returns True for a direct managed command; false for unrelated or empty values.
 */
function commandEntryReferencesSpec(entry: unknown, spec: HookSpec): boolean {
  // Non-object JSON cannot represent a runnable hook command.
  if (!isRecord(entry)) return false;
  const commands = [
    typeof entry.command === "string" ? entry.command : "",
    typeof entry.bash === "string" ? entry.bash : "",
    typeof entry.powershell === "string" ? entry.powershell : "",
  ].join("\n");
  return spec.scriptFiles.some(
    (script) => script !== "run-with-bash.mjs" && commands.includes(script),
  );
}

/** Detect managed hook entries by script reference so drift repair preserves unrelated hooks. */
function entryReferencesSpec(entry: unknown, spec: HookSpec): boolean {
  // Non-object JSON cannot contain a managed hook command or nested hook list.
  if (!isRecord(entry)) return false;
  // A direct command match identifies an entry setup owns.
  if (commandEntryReferencesSpec(entry, spec)) return true;
  // Matcher groups nest runnable commands under their hooks array.
  if (Array.isArray(entry.hooks)) {
    return entry.hooks.some((hook) => entryReferencesSpec(hook, spec));
  }
  return false;
}

/**
 * Collect direct managed commands so timeout drift is checked at the runner entry users execute.
 */
function collectManagedHookCommands(
  value: unknown,
  spec: HookSpec,
  matchingCommands: Record<string, unknown>[],
): void {
  // Arrays represent event groups or nested command lists in agent settings.
  if (Array.isArray(value)) {
    // Every entry can independently carry a managed command and timeout.
    for (const nestedValue of value) {
      collectManagedHookCommands(nestedValue, spec, matchingCommands);
    }
    return;
  }
  // Primitive or null values cannot contain a runnable command.
  if (!isRecord(value)) return;
  // Direct matches are the leaf registrations whose timeout affects the user.
  if (commandEntryReferencesSpec(value, spec)) matchingCommands.push(value);
  // Agent formats may add matcher or hook-id containers around the command.
  for (const nestedValue of Object.values(value)) {
    collectManagedHookCommands(nestedValue, spec, matchingCommands);
  }
}

function ensureHooksObject(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const hooks = config.hooks;
  if (isRecord(hooks)) return hooks;
  const next: Record<string, unknown> = {};
  config.hooks = next;
  return next;
}

function ensureHookEntries(
  config: Record<string, unknown>,
  event: string,
): unknown[] {
  const hooks = ensureHooksObject(config);
  const entries = hooks[event];
  if (Array.isArray(entries)) return entries;
  const next: unknown[] = [];
  hooks[event] = next;
  return next;
}

/** Read explicit hook toggles from project config, returning null as the fallback when config is absent or invalid. */
function readExplicitHooks(fs: ReadonlyFS): Record<string, unknown> | null {
  const config = fs.readFile(".goat-flow/config.yaml");
  if (config === null) return null;
  let parsed: unknown;
  try {
    parsed = load(config) ?? {};
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !isRecord(parsed.hooks)) return null;
  return parsed.hooks;
}

/** Extract an explicit enabled boolean without treating missing config as disabled. */
function enabledFromHookConfig(value: unknown): boolean | null {
  if (!isRecord(value) || typeof value.enabled !== "boolean") return null;
  return value.enabled;
}

/** Resolve a hook toggle, including the legacy gruff-on-change alias used by existing configs. */
function explicitHookEnabled(fs: ReadonlyFS, hookId: string): boolean | null {
  const hooks = readExplicitHooks(fs);
  if (hooks === null) return null;
  const explicit = enabledFromHookConfig(hooks[hookId]);
  if (explicit !== null) return explicit;
  if (hookId !== "gruff-code-quality") return null;
  return enabledFromHookConfig(hooks["gruff-on-change"]);
}

/** Remove an empty event so users do not see a registered hook with no commands. */
function deleteHookEventIfEmpty(
  config: Record<string, unknown>,
  event: string,
): void {
  const hooks = ensureHooksObject(config);
  if (Array.isArray(hooks[event]) && hooks[event].length === 0) {
    Reflect.deleteProperty(hooks, event);
  }
}

/** Remove one managed hook while preserving unrelated commands in the same event. */
function removeHookEntries(
  config: Record<string, unknown>,
  event: string,
  spec: HookSpec,
): void {
  const entries = ensureHookEntries(config, event);
  const next = entries.filter((entry) => !entryReferencesSpec(entry, spec));
  const hooks = ensureHooksObject(config);
  if (next.length === 0) {
    Reflect.deleteProperty(hooks, event);
    return;
  }
  hooks[event] = next;
}

/**
 * Parses hook JSON for template and installed-config comparisons; null leaves malformed input to setup validation.
 */
function parseHookConfigJson(
  hookConfigText: string,
): Record<string, unknown> | null {
  let config: unknown;
  try {
    config = JSON.parse(hookConfigText);
  } catch {
    // A user may stop editing settings mid-object; setup validation owns that malformed JSON.
    return null;
  }

  // Non-object JSON cannot hold hook events, so it is ignored for optional toggle comparison.
  return isRecord(config) ? config : null;
}

function applyExplicitHookToggle(
  fs: ReadonlyFS,
  config: Record<string, unknown>,
  agent: AgentProfile,
  spec: HookSpec,
): boolean {
  if (spec.unsupportedAgents?.copilot) return false;
  const enabled = explicitHookEnabled(fs, spec.id);
  if (enabled === null) return false;

  const event = hookEventKey("copilot", spec);
  removeHookEntries(config, event, spec);
  if (!enabled) {
    deleteHookEventIfEmpty(config, event);
    return true;
  }
  ensureHookEntries(config, event).push(copilotHookEntry(agent, spec));
  return true;
}

function applyExplicitHookToggles(
  fs: ReadonlyFS,
  config: Record<string, unknown>,
  agent: AgentProfile,
): boolean {
  let hasHookToggleChanged = false;

  // Each registered hook may add or remove a user-visible Copilot toggle entry.
  for (const spec of listHookSpecs()) {
    hasHookToggleChanged =
      applyExplicitHookToggle(fs, config, agent, spec) || hasHookToggleChanged;
  }

  return hasHookToggleChanged;
}

/**
 * Build Copilot's expected hook registry from its template plus explicit toggles.
 * Use during drift checks so dashboard choices do not look like accidental edits.
 */
function expectedHookConfig(
  fs: ReadonlyFS,
  agentId: string,
  agent: AgentProfile,
  template: string,
): string {
  // Non-Copilot agents do not use the JSON hook registry, so users see the plain template comparison.
  if (agentId !== "copilot" || !isAgentId(agentId)) return template;

  const config = parseHookConfigJson(template);

  // If the template cannot be parsed, the safest user-facing result is the unmodified template.
  if (config === null) return template;

  const hasHookConfigChanged = applyExplicitHookToggles(fs, config, agent);

  // Without explicit toggles, the installed file should match the manifest template exactly.
  if (!hasHookConfigChanged) return template;
  return `${JSON.stringify(config, null, 2)}\n`;
}

function compareHookArtifact(
  fs: ReadonlyFS,
  templateRoot: string,
  findings: DriftFinding[],
  templateRel: string,
  installedRel: string,
  expectedFromTemplate: (template: string) => string,
): void {
  const template = readTemplateText(templateRoot, templateRel);
  if (template === null) {
    findings.push({
      kind: "missing",
      path: templateRel,
      message: `declared hook artifact ${installedRel} has no template at ${templateRel}`,
    });
    return;
  }
  const expected = expectedFromTemplate(template);
  if (!fs.exists(installedRel)) {
    findings.push({
      kind: "missing",
      path: installedRel,
      message: `hook template ${templateRel} has no installed copy at ${installedRel}`,
    });
    return;
  }
  const installed = fs.readFile(installedRel);
  if (installed === null) return;
  if (installed.trimEnd() !== expected.trimEnd()) {
    findings.push({
      kind: "content",
      path: installedRel,
      message: `hook template (${templateRel}) and installed copy (${installedRel}) differ`,
    });
  }
}

/**
 * Compare hook artifacts for the runtime scope the user selected.
 * A filter keeps one runtime from reporting another runtime's absent config.
 *
 * @param fs - the audited project's filesystem
 * @param templateRoot - package root holding the hooks goat-flow would install
 * @param findings - shared list this appends drift to; existing entries are left alone
 * @param checkedHookArtifacts - paths already compared, so one file is not reported twice
 * @param agentFilter - single agent the user asked about; null or omitted compares every
 *   agent they have installed
 * @returns how many hook artifacts were compared; zero means the user has no installed
 *   hooks in scope, which is reported by setup checks rather than as drift
 */
export function compareHooks(
  fs: ReadonlyFS,
  templateRoot: string,
  findings: DriftFinding[],
  checkedHookArtifacts: Set<string>,
  agentFilter: AgentId | null | undefined,
): number {
  let checked = 0;
  const manifest = loadManifest();

  // Every selected agent contributes its own hook launcher and runtime files.
  for (const [agentId, agent] of Object.entries(manifest.agents)) {
    // A selected-agent audit must not require hook artifacts owned by another runtime.
    if (agentFilter && agentId !== agentFilter) continue;

    // Hookless agents have no local artifacts for drift to compare.
    if (!agent.hooks_dir || !agent.hooks) continue;

    // An uninstalled hook root belongs to agent setup checks, not content drift.
    if (!fs.exists(agent.hooks_dir)) continue;

    // Each declared hook file must match what setup would install for this runtime.
    for (const hookFile of agent.hooks) {
      const templateRel = hookTemplateRel(agentId, agent, hookFile);
      const installedRel = pathPosix.join(agent.hooks_dir, hookFile);
      checked++;
      checkedHookArtifacts.add(installedRel);
      compareHookArtifact(
        fs,
        templateRoot,
        findings,
        templateRel,
        installedRel,
        (template) =>
          hookFile === agent.hook_config_file
            ? expectedHookConfig(fs, agentId, agent, template)
            : template,
      );
    }

    // Copilot's shared registry is compared once because it is not always listed with scripts.
    if (agentId === "copilot" && agent.hook_config_file) {
      const templateRel = "workflow/hooks/agent-config/copilot-hooks.json";
      const installedRel = agent.hook_config_file;
      checked++;
      compareHookArtifact(
        fs,
        templateRoot,
        findings,
        templateRel,
        installedRel,
        (template) => expectedHookConfig(fs, agentId, agent, template),
      );
    }
  }
  return checked;
}

/** Installed settings plus the path users can pass to the repair command. */
interface InstalledHookTimeoutConfig {
  hookConfigPath: string;
  hookConfig: Record<string, unknown>;
}

/** Reads one installed hook config when it can provide trustworthy timeout evidence. */
function readInstalledHookTimeoutConfig(
  fs: ReadonlyFS,
  agentProfile: AgentProfile,
): InstalledHookTimeoutConfig | null {
  const hookConfigPath = agentProfile.hook_config_file;
  // Hookless or uninstalled profiles remain the responsibility of setup checks.
  if (!hookConfigPath || !fs.exists(hookConfigPath)) return null;
  const installedHookConfigText = fs.readFile(hookConfigPath);
  // An unreadable config has no trustworthy timeout evidence for the user.
  if (installedHookConfigText === null) return null;
  const hookConfig = parseHookConfigJson(installedHookConfigText);
  // Malformed settings are reported by setup validation without duplicate drift noise.
  if (hookConfig === null) return null;
  return { hookConfigPath, hookConfig };
}

/** Names the timeout field used by the selected runner's public hook schema. */
function hookTimeoutField(agentIdentifier: AgentId): "timeout" | "timeoutSec" {
  return agentIdentifier === "copilot" ? "timeoutSec" : "timeout";
}

/** Formats the stale timeout values users must replace, including an unset field. */
function staleTimeoutLabels(
  staleTimeoutCommands: Record<string, unknown>[],
  timeoutField: "timeout" | "timeoutSec",
): string {
  return [
    ...new Set(
      staleTimeoutCommands.map((commandEntry) => {
        const configuredTimeout = commandEntry[timeoutField];
        return typeof configuredTimeout === "number"
          ? `${configuredTimeout}s`
          : "unset";
      }),
    ),
  ].join(", ");
}

/** Compares one present managed command and reports the exact sync action on mismatch. */
function compareManagedHookTimeout(
  installedConfig: InstalledHookTimeoutConfig,
  agentIdentifier: AgentId,
  hookSpec: HookSpec,
  findings: DriftFinding[],
): number {
  // Agent defaults remain valid when the registry defines no timeout.
  if (hookSpec.timeoutSec === undefined) return 0;
  // Unsupported lifecycles must not make this agent's audit fail.
  if (hookSpec.unsupportedAgents?.[agentIdentifier]) return 0;
  const matchingCommands: Record<string, unknown>[] = [];
  collectManagedHookCommands(
    installedConfig.hookConfig,
    hookSpec,
    matchingCommands,
  );
  // A missing registration is setup state, not content drift.
  if (matchingCommands.length === 0) return 0;
  const expectedTimeoutSeconds = hookSpec.timeoutSec;
  const timeoutField = hookTimeoutField(agentIdentifier);
  const staleTimeoutCommands = matchingCommands.filter(
    (commandEntry) => commandEntry[timeoutField] !== expectedTimeoutSeconds,
  );
  // Matching registrations give the user the registry's full runtime window.
  if (staleTimeoutCommands.length === 0) return 1;
  findings.push({
    kind: "content",
    path: installedConfig.hookConfigPath,
    message: `${hookSpec.id}: registered runner timeout ${staleTimeoutLabels(staleTimeoutCommands, timeoutField)}; registry requires ${expectedTimeoutSeconds}s; run goat-flow hooks sync`,
  });
  return 1;
}

/** Compares every timeout-bearing managed command in one installed agent config. */
function compareAgentHookTimeouts(
  fs: ReadonlyFS,
  findings: DriftFinding[],
  agentIdentifier: AgentId,
  agentProfile: AgentProfile,
): number {
  const installedConfig = readInstalledHookTimeoutConfig(fs, agentProfile);
  // No installed readable config means setup checks own this user's next action.
  if (installedConfig === null) return 0;
  let checked = 0;
  // Each registry hook can carry an independent runner timeout.
  for (const hookSpec of listHookSpecs()) {
    checked += compareManagedHookTimeout(
      installedConfig,
      agentIdentifier,
      hookSpec,
      findings,
    );
  }
  return checked;
}

/**
 * Compare installed managed-command timeouts with the registry value setup will write.
 * Missing registrations remain owned by setup checks; present stale values become actionable drift.
 *
 * @param fs - the audited project's filesystem
 * @param findings - shared list this appends stale timeouts to
 * @param agentFilter - single agent the user asked about; null or omitted checks every agent
 *   they have configured
 * @returns how many timeout values were compared; zero means nothing was registered yet
 */
export function compareManagedHookTimeouts(
  fs: ReadonlyFS,
  findings: DriftFinding[],
  agentFilter: AgentId | null | undefined,
): number {
  let checked = 0;
  const manifest = loadManifest();

  // Every installed agent config can carry a runner-specific timeout field.
  for (const [agentIdentifier, agentProfile] of Object.entries(
    manifest.agents,
  )) {
    // Unknown manifest keys cannot be matched safely to registry support metadata.
    if (!isAgentId(agentIdentifier)) continue;
    // A selected-agent audit reports only the runner the user asked about.
    if (agentFilter && agentIdentifier !== agentFilter) continue;
    checked += compareAgentHookTimeouts(
      fs,
      findings,
      agentIdentifier,
      agentProfile,
    );
  }
  return checked;
}

/**
 * Decide whether the registry safety-net should compare one optional hook script.
 * Setup owns missing defaults; drift checks only installed or explicitly enabled copies.
 * @param fs - ReadonlyFS rooted at the audited project.
 * @param spec - Registry hook spec whose script is a comparison candidate.
 * @param installedRel - Project-relative path of the installed hook script.
 * @returns True when the installed copy is present or the hook is explicitly enabled.
 */
function shouldCompareRegistryHookScript(
  fs: ReadonlyFS,
  spec: HookSpec,
  installedRel: string,
): boolean {
  if (fs.exists(installedRel)) return true;
  return explicitHookEnabled(fs, spec.id) === true;
}

/**
 * Compare optional registry hook scripts when present or explicitly enabled.
 * Use so a user who opted into an optional hook still learns when their copy went stale,
 * while someone who never enabled it is not nagged about a file they do not have.
 *
 * @param fs - the audited project's filesystem
 * @param templateRoot - package root holding the scripts goat-flow would install
 * @param findings - shared list this appends drift to
 * @param checkedHookArtifacts - paths already compared, so one file is not reported twice
 * @param agentFilter - single agent the user asked about; null or omitted covers all of them
 * @returns how many optional scripts were compared; zero means none are installed or enabled
 */
export function compareRegistryHookScripts(
  fs: ReadonlyFS,
  templateRoot: string,
  findings: DriftFinding[],
  checkedHookArtifacts: Set<string>,
  agentFilter: AgentId | null | undefined,
): number {
  let checked = 0;
  for (const spec of listHookSpecs()) {
    // Agent-scoped drift must not report scripts the selected runner cannot execute.
    if (agentFilter && spec.unsupportedAgents?.[agentFilter]) continue;
    for (const script of spec.scriptFiles) {
      if (script.includes("/")) continue;
      const installedRel = pathPosix.join(".goat-flow/hooks", script);
      if (checkedHookArtifacts.has(installedRel)) continue;
      if (!shouldCompareRegistryHookScript(fs, spec, installedRel)) continue;
      checked++;
      checkedHookArtifacts.add(installedRel);
      compareHookArtifact(
        fs,
        templateRoot,
        findings,
        `workflow/hooks/${script}`,
        installedRel,
        (template) => template,
      );
    }
  }
  return checked;
}

/**
 * Report retired central hook files without changing the user's project.
 * Use after an upgrade so operators get the supported sync command while audit stays read-only.
 *
 * @param fs - the audited project's filesystem; nothing here is ever written or deleted
 * @param findings - shared list this appends leftover files to; empty afterwards means the
 *   user's upgrade left nothing behind
 * @returns how many retired filenames were checked; this counts toward the audit's total
 *   rather than indicating how many leftovers the user actually has
 */
export function findDeprecatedHookFiles(
  fs: ReadonlyFS,
  findings: DriftFinding[],
): number {
  const deprecatedHookNames = loadManifest().hooks.stale_names;
  // Each historical filename is checked because an old install may still execute it.
  for (const deprecatedHookName of deprecatedHookNames) {
    const installedHookPath = pathPosix.join(
      ".goat-flow/hooks",
      deprecatedHookName,
    );
    // Missing retired hooks are the desired state and need no operator action.
    if (!fs.exists(installedHookPath)) continue;
    findings.push({
      kind: "deprecated",
      path: installedHookPath,
      message: `deprecated hook remains installed; run goat-flow hooks sync to remove ${installedHookPath}`,
    });
  }
  return deprecatedHookNames.length;
}
