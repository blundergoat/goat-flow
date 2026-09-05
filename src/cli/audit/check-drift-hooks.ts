/**
 * Reports when installed safety hooks differ from the Goat Flow version a user selected.
 *
 * Use during setup or audit before relying on command protection in an agent session.
 * It compares hook scripts, configured launchers, and supported host timeouts.
 * Explicitly disabled hooks remain the user's choice instead of appearing as drift.
 */
import { createHash } from "node:crypto";
import { posix as pathPosix } from "node:path";
import { load } from "js-yaml";
import {
  classifyManagedSetupFile,
  managedSetupChangeDirection,
} from "../managed-setup-preview.js";
import {
  readManagedInstallStateFacade,
  type ManagedInstallStateFacade,
  type ManagedInstallStateRow,
} from "../managed-setup-state.js";
import type { ReadonlyFS } from "../types.js";
import { loadManifest } from "../manifest/manifest.js";
import { listHookSpecs, type HookSpec } from "../server/hooks-registry.js";
import { buildAgentHookCommand } from "../server/agent-hook-writer.js";
import {
  buildAgentHookDescriptor,
  commandEntryReferencesSpec,
  entryCarriesHandlerDescriptor,
  entryReferencesSpec,
} from "../server/agent-hook-command.js";
import type { AgentId } from "../types.js";
import type { AgentProfile } from "../manifest/types.js";
import type { DriftFinding } from "./types.js";
import { readTemplateText } from "./artifact-templates.js";
import { isAgentId, isRecord } from "./drift-values.js";

// Find the shipped script or agent-config template to compare with the user's installed hook.
function hookTemplatePath(
  agentId: string,
  agent: AgentProfile,
  hookFile: string,
): string {
  // Agents without a settings file use script templates for every declared hook.
  const hookConfigName = agent.hook_config_file
    ? pathPosix.basename(agent.hook_config_file)
    : null;
  // A registered settings file has an agent-specific template rather than a shared hook script.
  if (hookConfigName && hookFile === hookConfigName) {
    return pathPosix.join(
      "workflow/hooks/agent-config",
      `${agentId}-hooks.json`,
    );
  }
  return pathPosix.join("workflow/hooks", hookFile);
}

// Choose the runner's event spelling so audit finds the hook registered for the user's tool action.
function hookEventKey(agentId: AgentId, spec: HookSpec): string {
  // Copilot uses lower-cased lifecycle keys, so audit must match the spelling in its settings.
  if (agentId === "copilot") {
    return spec.event === "PreToolUse" ? "preToolUse" : "postToolUse";
  }
  return spec.event;
}

/**
 * Build the command entry expected after a user enables a Copilot hook.
 * Compare against the same portable launcher that setup writes.
 *
 * @param agent - Copilot profile; an absent hook folder uses the managed default
 * @param spec - registered hook; an absent timeout uses 30 seconds
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

// Collect direct managed commands so timeout drift is checked at the runner entry users execute.
function collectManagedHookCommands(
  configNode: unknown,
  spec: HookSpec,
  matchingCommands: Record<string, unknown>[],
): void {
  // Arrays represent event groups or nested command lists in agent settings.
  if (Array.isArray(configNode)) {
    // Every entry can independently carry a managed command and timeout.
    for (const nestedValue of configNode) {
      collectManagedHookCommands(nestedValue, spec, matchingCommands);
    }
    return;
  }
  // Primitive or null values cannot contain a runnable command.
  if (!isRecord(configNode)) return;
  // Direct matches are the leaf registrations whose timeout affects the user.
  if (commandEntryReferencesSpec(configNode, spec)) {
    matchingCommands.push(configNode);
  }
  // Agent formats may add matcher or hook-id containers around the command.
  for (const nestedValue of Object.values(configNode)) {
    collectManagedHookCommands(nestedValue, spec, matchingCommands);
  }
}

/**
 * Prepare the hooks object in the expected config before applying the user's choices.
 * An absent or wrongly typed value becomes an empty object in this comparison copy.
 *
 * @param config - expected config being assembled in memory; no installed settings are written
 * @returns the hooks object callers can mutate; never null
 */
function ensureHooksObject(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const hooks = config.hooks;
  // Keep existing event groups in the expected config while adjusting only managed hooks.
  if (isRecord(hooks)) return hooks;
  const newHooks: Record<string, unknown> = {};
  config.hooks = newHooks;
  return newHooks;
}

/**
 * Prepare one event's command list while applying toggles to the expected config.
 * A missing or wrongly typed list becomes empty so enabled hooks can be added.
 *
 * @param config - expected config being assembled in memory; no installed settings are written
 * @param event - runner event key under which the expected command is registered
 * @returns the entry array callers can push onto; never null
 */
function ensureHookEntries(
  config: Record<string, unknown>,
  event: string,
): unknown[] {
  const hooks = ensureHooksObject(config);
  const entries = hooks[event];
  // Keep existing commands in this event while applying the user's saved hook toggle.
  if (Array.isArray(entries)) return entries;
  const newEntries: unknown[] = [];
  hooks[event] = newEntries;
  return newEntries;
}

// Read the user's saved hook choices for drift comparison; missing or invalid config uses a null fallback.
function readExplicitHooks(fs: ReadonlyFS): Record<string, unknown> | null {
  const config = fs.readFile(".goat-flow/config.yaml");
  // Without readable project config, audit has no explicit hook choices to apply.
  if (config === null) return null;
  let parsed: unknown;
  try {
    // An empty config carries no saved toggles and leaves template defaults in place.
    parsed = load(config) ?? {};
  } catch {
    // An unfinished YAML edit can make config invalid; setup validation owns that error, so drift ignores its toggles.
    return null;
  }
  // A config without a hooks object supplies no explicit choices for drift to honor.
  if (!isRecord(parsed) || !isRecord(parsed.hooks)) return null;
  return parsed.hooks;
}

// Extract an explicit enabled boolean without treating missing config as disabled.
function enabledFromHookConfig(hookEntry: unknown): boolean | null {
  // Only a saved true/false value is a user choice; missing or mistyped values must not disable a hook.
  if (!isRecord(hookEntry) || typeof hookEntry.enabled !== "boolean") {
    return null;
  }
  return hookEntry.enabled;
}

// Resolve a hook toggle, including the legacy gruff-on-change alias used by existing configs.
function explicitHookEnabled(fs: ReadonlyFS, hookId: string): boolean | null {
  const hooks = readExplicitHooks(fs);
  // No valid toggle section means the user's setup keeps its default expectation.
  if (hooks === null) return null;
  const explicit = enabledFromHookConfig(hooks[hookId]);
  // A choice saved under the current hook name takes precedence over compatibility aliases.
  if (explicit !== null) return explicit;
  // Only the renamed Gruff hook has an older setting to consult for an existing user's choice.
  if (hookId !== "gruff-code-quality") return null;
  return enabledFromHookConfig(hooks["gruff-on-change"]);
}

// Remove an empty event so users do not see a registered hook with no commands.
function deleteHookEventIfEmpty(
  config: Record<string, unknown>,
  event: string,
): void {
  const hooks = ensureHooksObject(config);
  // Disabling the last command should not leave an empty event in the expected settings.
  if (Array.isArray(hooks[event]) && hooks[event].length === 0) {
    Reflect.deleteProperty(hooks, event);
  }
}

// Remove one managed hook while preserving unrelated commands in the same event.
function removeHookEntries(
  config: Record<string, unknown>,
  event: string,
  spec: HookSpec,
): void {
  const entries = ensureHookEntries(config, event);
  const remainingEntries = entries.filter(
    (entry) => !entryReferencesSpec(entry, spec),
  );
  const hooks = ensureHooksObject(config);
  // No unrelated commands remain, so the event can disappear from the expected config.
  if (remainingEntries.length === 0) {
    Reflect.deleteProperty(hooks, event);
    return;
  }
  hooks[event] = remainingEntries;
}

/**
 * Parse settings for drift comparison; empty, malformed, or non-object JSON returns null.
 * It swallows JSON parse errors because setup validation owns reporting malformed settings.
 *
 * @param hookConfigText - template or installed settings; empty text has no hook registry to compare
 * @returns the settings object, or null to leave malformed settings to setup validation
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

/**
 * Apply one explicit enable/disable choice to the expected Copilot config.
 * Unsupported hooks and hooks without a saved choice leave this comparison copy unchanged.
 *
 * @param fs - the audited project's filesystem, read for the explicit toggle
 * @param config - expected Copilot config to adjust in memory
 * @param agent - agent profile supplying the command this entry would run
 * @param spec - hook whose toggle is applied
 * @returns true when a saved choice was applied; false means the hook was unsupported or had no explicit choice
 */
function applyExplicitHookToggle(
  fs: ReadonlyFS,
  config: Record<string, unknown>,
  agent: AgentProfile,
  spec: HookSpec,
): boolean {
  // A hook Copilot cannot run must not create an expected registration for that user.
  if (spec.unsupportedAgents?.copilot) return false;
  const enabled = explicitHookEnabled(fs, spec.id);
  // For example, a user who never changed this toggle keeps the template's default registration.
  if (enabled === null) return false;

  const event = hookEventKey("copilot", spec);
  removeHookEntries(config, event, spec);
  // An explicit disable removes the managed command while retaining any unrelated event commands.
  if (!enabled) {
    deleteHookEventIfEmpty(config, event);
    return true;
  }
  ensureHookEntries(config, event).push(copilotHookEntry(agent, spec));
  return true;
}

/**
 * Apply saved hook choices to the expected Copilot config before comparing it with installed settings.
 *
 * @param fs - the audited project's filesystem, read for explicit toggles
 * @param config - expected Copilot config to adjust in memory
 * @param agent - agent profile supplying the commands these entries would run
 * @returns true when at least one explicit choice was applied, even if the expected entries were already identical
 */
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

// Adjust the expected Copilot registry for saved toggles so deliberate user choices do not appear as drift.
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

// Name the recorded install version in drift guidance so users know which earlier copy was compared.
function managedBaselineProvenance(row: ManagedInstallStateRow): string {
  // A recorded installation provides the exact version behind the user's previous managed copy.
  if (row.provenance.kind === "verified-install") {
    return `verified install ${row.provenance.goatFlowVersion}`;
  }
  const observations = row.provenance.observations
    .map((observation) => `${observation.agent} ${observation.goatFlowVersion}`)
    .join(", ");
  return `legacy bootstrap ${observations}`;
}

/**
 * Read the previous-install baseline used to distinguish an outdated hook from a local edit.
 *
 * Reports conflicting or malformed install state once, then returns null so drift cannot claim a proven change direction.
 * Every selected agent must use the same baseline rows and provenance.
 */
function managedBaselineRows(
  projectPath: string,
  findings: DriftFinding[],
): Map<string, ManagedInstallStateRow> | null {
  const baseline = readManagedInstallStateFacade(projectPath);
  // Conflicting or malformed state cannot prove whether a user's hook was locally edited.
  if (
    baseline.status === "malformed-blocking" ||
    baseline.status === "conflicting"
  ) {
    const finding: DriftFinding = {
      kind: "content",
      path: managedBaselineEvidencePath(baseline),
      message: `Install state is ${baseline.status}: ${baseline.error ?? "Managed install state is malformed."}`,
    };
    // Multiple agent checks can encounter the same state problem; users need only one global finding.
    if (
      !findings.some(
        (candidate) =>
          candidate.path === finding.path &&
          candidate.message === finding.message,
      )
    ) {
      findings.push(finding);
    }
    return null;
  }
  // Without a loaded baseline, later findings ask the user to compare files before syncing.
  if (baseline.status !== "loaded" || baseline.state === null) return null;
  return new Map(baseline.state.files.map((row) => [row.path, row]));
}

// Point the drift finding at the baseline file or legacy directory the user must inspect; preserve the facade's source choice.
function managedBaselineEvidencePath(
  baseline: ManagedInstallStateFacade,
): string {
  return baseline.source === "v2"
    ? ".goat-flow/install-state/managed.json"
    : ".goat-flow/install-state";
}

// Hash in-memory expected or installed text with the install baseline's exact-byte contract.
function managedContentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Explain whether the user's hook is outdated, locally edited, or missing comparison evidence.
 *
 * The same baseline and provenance apply regardless of the selected agent.
 * Only proven outdated copies recommend sync directly; local edits need preservation before replacement.
 */
function hookContentMismatchMessage(
  templateRel: string,
  installedRel: string,
  expected: string,
  installed: string,
  baselineRows: Map<string, ManagedInstallStateRow> | null,
): string {
  // A new or unrecorded file has no prior hash, so audit cannot infer its change direction from history.
  const baselineRow = baselineRows?.get(installedRel) ?? null;
  const state = classifyManagedSetupFile({
    oldExpectedSha256: baselineRow?.expectedSha256 ?? null,
    currentSha256: managedContentHash(installed),
    newExpectedSha256: managedContentHash(expected),
  });
  const direction = managedSetupChangeDirection(state);
  // The installed bytes still match the recorded copy, so sync can bring this hook up to the selected version.
  if (direction === "behind" && baselineRow !== null) {
    return `installed hook ${installedRel} is behind template ${templateRel}; its bytes still match the previous-install baseline (${managedBaselineProvenance(baselineRow)}), so run goat-flow hooks sync`;
  }
  // Local content differs from the baseline; users need to preserve it before a replacement.
  if (direction === "diverged") {
    // Without a recorded row, the warning cannot name the install version that established the baseline.
    const provenance =
      baselineRow === null
        ? ""
        : `; the previous-install baseline (${managedBaselineProvenance(baselineRow)}) confirms the drift direction`;
    return `installed hook ${installedRel} diverged from template ${templateRel}${provenance}; sync would overwrite local content at ${installedRel}, so preserve or port that content before any explicit replacement`;
  }
  return `hook template (${templateRel}) and installed copy (${installedRel}) differ, but no matching previous-install baseline proves the direction; compare them before you run goat-flow hooks sync, which replaces current managed bytes at ${installedRel}`;
}

/**
 * Compare one transformed template with its installed copy and append actionable drift evidence.
 *
 * @throws when the supplied filesystem or template reader cannot inspect its configured root
 */
function compareHookArtifact(
  fs: ReadonlyFS,
  templateRoot: string,
  findings: DriftFinding[],
  templateRel: string,
  installedRel: string,
  expectedFromTemplate: (template: string) => string,
  baselineRows: Map<string, ManagedInstallStateRow> | null,
): void {
  const template = readTemplateText(templateRoot, templateRel);
  // A missing shipped template prevents comparison and is reported as a missing package artifact.
  if (template === null) {
    findings.push({
      kind: "missing",
      path: templateRel,
      message: `declared hook artifact ${installedRel} has no template at ${templateRel}`,
    });
    return;
  }
  const expected = expectedFromTemplate(template);
  // The selected package provides this hook, but the user's installed copy is missing and needs sync.
  if (!fs.exists(installedRel)) {
    findings.push({
      kind: "missing",
      path: installedRel,
      message: `hook template ${templateRel} has no installed copy at ${installedRel}; run goat-flow hooks sync`,
    });
    return;
  }
  const installed = fs.readFile(installedRel);
  // An unreadable copy has no content evidence; setup validation owns the read problem.
  if (installed === null) return;
  // Ignore trailing whitespace so users see drift only when the hook content differs before that whitespace.
  if (installed.trimEnd() !== expected.trimEnd()) {
    findings.push({
      kind: "content",
      path: installedRel,
      message: hookContentMismatchMessage(
        templateRel,
        installedRel,
        expected,
        installed,
        baselineRows,
      ),
    });
  }
}

/**
 * Compare installed hook files for the agent scope the user selected.
 * A single-agent audit skips other agents' settings and hook directories.
 *
 * @param fs - the audited project's filesystem
 * @param projectPath - the audited project's root, used to resolve canonical baseline rows
 * @param templateRoot - package root holding the hooks goat-flow would install
 * @param findings - shared list this appends drift to; existing entries are left alone
 * @param checkedHookArtifacts - paths already compared, so one file is not reported twice
 * @param agentFilter - selected agent; null or omitted compares all installed agents
 * @returns the number of hook artifacts compared; zero leaves missing installation checks to setup
 */
export function compareHooks(
  fs: ReadonlyFS,
  projectPath: string,
  templateRoot: string,
  findings: DriftFinding[],
  checkedHookArtifacts: Set<string>,
  agentFilter: AgentId | null | undefined,
): number {
  let checked = 0;
  const manifest = loadManifest();
  const baselineRows = managedBaselineRows(projectPath, findings);

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
      const templateRel = hookTemplatePath(agentId, agent, hookFile);
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
        baselineRows,
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
        baselineRows,
      );
    }
  }
  return checked;
}

/**
 * Keep installed hook settings with the path a drift finding must identify.
 *
 * Launcher and timeout checks share this parsed config so both describe the same registration.
 * Missing or malformed settings produce no instance and remain the responsibility of setup validation.
 */
interface InstalledHookConfig {
  hookConfigPath: string;
  hookConfig: Record<string, unknown>;
}

/**
 * Read one installed agent config for launcher and timeout comparison.
 * A null result means setup owns the user's missing, unreadable, or malformed config.
 */
function readInstalledHookConfig(
  fs: ReadonlyFS,
  agentProfile: AgentProfile,
): InstalledHookConfig | null {
  const hookConfigPath = agentProfile.hook_config_file;
  // Hookless or uninstalled profiles remain the responsibility of setup checks.
  if (!hookConfigPath || !fs.exists(hookConfigPath)) return null;
  const installedHookConfigText = fs.readFile(hookConfigPath);
  // An unreadable config has no trustworthy launcher or timeout evidence for the user.
  if (installedHookConfigText === null) return null;
  const hookConfig = parseHookConfigJson(installedHookConfigText);
  // Malformed settings are reported by setup validation without duplicate drift noise.
  if (hookConfig === null) return null;
  return { hookConfigPath, hookConfig };
}

// Names the timeout field used by the selected runner's public hook schema.
function hookTimeoutField(agentIdentifier: AgentId): "timeout" | "timeoutSec" {
  return agentIdentifier === "copilot" ? "timeoutSec" : "timeout";
}

// Formats the stale timeout values users must replace, including an unset field.
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

/**
 * Compare the installed launcher with the command setup would give the user today.
 * Reports a sync repair for stale commands; unsupported or absent registrations add no drift finding.
 *
 * @param installedConfig - the registration found in the user's config
 * @param agentIdentifier - agent whose config is being compared
 * @param agentProfile - profile supplying the command setup would install today
 * @param hookSpec - hook being compared
 * @param findings - shared list this appends drift to
 * @returns 1 for a compared registration; 0 means unsupported lifecycle, missing hook folder, or no matching command
 */
function compareManagedHookCommand(
  installedConfig: InstalledHookConfig,
  agentIdentifier: AgentId,
  agentProfile: AgentProfile,
  hookSpec: HookSpec,
  findings: DriftFinding[],
): number {
  // Unsupported lifecycles must not make this agent's audit fail.
  if (hookSpec.unsupportedAgents?.[agentIdentifier]) return 0;
  const hooksDirectory = agentProfile.hooks_dir;
  // A profile without a hook folder has no managed launcher for the user to sync.
  if (!hooksDirectory) return 0;
  const matchingCommands: Record<string, unknown>[] = [];
  collectManagedHookCommands(
    installedConfig.hookConfig,
    hookSpec,
    matchingCommands,
  );
  // A missing registration is setup state, not content drift.
  if (matchingCommands.length === 0) return 0;
  const expectedDescriptor = buildAgentHookDescriptor(
    agentIdentifier,
    hooksDirectory,
    hookSpec,
  );
  // Any alternate launcher shape could send the user's command to stale or unsafe code.
  const staleCommands = matchingCommands.filter(
    (commandEntry) =>
      !entryCarriesHandlerDescriptor(
        commandEntry,
        agentIdentifier,
        expectedDescriptor,
      ),
  );
  // Exact launcher identity means this part of the user's registration is current.
  if (staleCommands.length === 0) return 1;
  findings.push({
    kind: "content",
    path: installedConfig.hookConfigPath,
    message: `${hookSpec.id}: registered launcher command differs from the managed command; run goat-flow hooks sync`,
  });
  return 1;
}

/**
 * Compare registered timeouts with the duration setup gives each supported hook.
 * Reports stale values with a sync repair; agent defaults remain valid when the registry sets no timeout.
 *
 * @param installedConfig - the registration found in the user's config
 * @param agentIdentifier - agent whose config is being compared
 * @param hookSpec - hook being compared; no declared timeout skips the check
 * @param findings - shared list this appends drift to
 * @returns 1 for a compared timeout; 0 means no matching command, declared timeout, or supported timeout field
 */
function compareManagedHookTimeout(
  installedConfig: InstalledHookConfig,
  agentIdentifier: AgentId,
  hookSpec: HookSpec,
  findings: DriftFinding[],
): number {
  // Agent defaults remain valid when the registry defines no timeout.
  if (hookSpec.timeoutSec === undefined) return 0;
  // Codex exposes no project hook timeout field; the shared launcher remains its bound.
  if (agentIdentifier === "codex") return 0;
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

/**
 * Compare every managed launcher and supported host timeout for one installed agent.
 * Use per profile so the drift report names only settings that user can repair.
 */
function compareAgentHookRegistrations(
  fs: ReadonlyFS,
  findings: DriftFinding[],
  agentIdentifier: AgentId,
  agentProfile: AgentProfile,
): number {
  const installedConfig = readInstalledHookConfig(fs, agentProfile);
  // No installed readable config means setup checks own this user's next action.
  if (installedConfig === null) return 0;
  let checked = 0;
  // Each registry hook carries one managed command and, where supported, a host timeout.
  for (const hookSpec of listHookSpecs()) {
    checked += compareManagedHookCommand(
      installedConfig,
      agentIdentifier,
      agentProfile,
      hookSpec,
      findings,
    );
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
 * Compare installed managed commands and host timeouts with the values setup will write.
 * Missing registrations remain owned by setup checks; present stale values become actionable drift.
 *
 * @param fs - audited project files; an empty project yields no registration checks
 * @param findings - user-visible drift list; empty means no earlier issue has been found
 * @param agentFilter - selected agent; null or omitted checks every configured agent
 * @returns command and timeout comparisons; zero means no managed registration exists yet
 */
export function compareManagedHookRegistrations(
  fs: ReadonlyFS,
  findings: DriftFinding[],
  agentFilter: AgentId | null | undefined,
): number {
  let checked = 0;
  const manifest = loadManifest();

  // Every installed agent config can carry a user-visible launcher and host timeout.
  for (const [agentIdentifier, agentProfile] of Object.entries(
    manifest.agents,
  )) {
    // Unknown manifest keys cannot be matched safely to registry support metadata.
    if (!isAgentId(agentIdentifier)) continue;
    // A selected-agent audit reports only the runner the user asked about.
    if (agentFilter && agentIdentifier !== agentFilter) continue;
    checked += compareAgentHookRegistrations(
      fs,
      findings,
      agentIdentifier,
      agentProfile,
    );
  }
  return checked;
}

/**
 * Include optional scripts when installed or explicitly enabled, so users are not warned about hooks they never chose.
 *
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
  // An installed optional hook can become outdated even when the user has no saved toggle.
  if (fs.exists(installedRel)) return true;
  return explicitHookEnabled(fs, spec.id) === true;
}

/**
 * Check optional registry scripts that the user installed or enabled, and report outdated copies with repair guidance.
 *
 * @param fs - the audited project's filesystem
 * @param projectPath - the audited project's root, used to resolve canonical baseline rows
 * @param templateRoot - package root holding the scripts goat-flow would install
 * @param findings - shared list this appends drift to
 * @param checkedHookArtifacts - paths already compared, so one file is not reported twice
 * @param agentFilter - single agent the user asked about; null or omitted covers all of them
 * @returns how many optional scripts were compared; zero means none are installed or enabled
 */
export function compareRegistryHookScripts(
  fs: ReadonlyFS,
  projectPath: string,
  templateRoot: string,
  findings: DriftFinding[],
  checkedHookArtifacts: Set<string>,
  agentFilter: AgentId | null | undefined,
): number {
  let checked = 0;
  const baselineRows = managedBaselineRows(projectPath, findings);
  // Registry-only hooks still need drift checks when the user opts into them.
  for (const spec of listHookSpecs()) {
    // Agent-scoped drift must not report scripts the selected runner cannot execute.
    if (agentFilter && spec.unsupportedAgents?.[agentFilter]) continue;
    // Shared top-level scripts can be compared once even when several agents use them.
    for (const script of spec.scriptFiles) {
      // Nested helper files are outside this top-level script check.
      if (script.includes("/")) continue;
      const installedRel = pathPosix.join(".goat-flow/hooks", script);
      // A script already checked through an agent profile must not produce duplicate findings.
      if (checkedHookArtifacts.has(installedRel)) continue;
      // A user who neither installed nor enabled this optional hook has no missing copy to repair.
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
        baselineRows,
      );
    }
  }
  return checked;
}

/**
 * Reports retired hook files left after an upgrade so users can remove them with the supported sync command.
 * Audit checks existence only and leaves the user's files unchanged.
 *
 * @param fs - the audited project's filesystem; nothing here is ever written or deleted
 * @param findings - shared drift list; this adds an entry for each retired file still present
 * @returns retired filenames checked, including absent files; this contributes to the audit's comparison count
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
