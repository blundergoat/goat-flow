/**
 * Canonical-template versus installed-artifact drift detection.
 * Use during setup audits so operators learn which skill, shared document,
 * hook, or agent mirror differs from the workflow package they intended to run.
 * Semantic Markdown comparison ignores harmless YAML order and trailing-space changes.
 */
import { posix as pathPosix } from "node:path";
import { load } from "js-yaml";
import { isDeepStrictEqual } from "node:util";
import type { ReadonlyFS } from "../types.js";
import { getSkillNames } from "../constants.js";
import { getTemplatePath } from "../paths.js";
import {
  getInstalledSkillRoots,
  getSkillFiles,
  loadManifest,
} from "../manifest/manifest.js";
import { listHookSpecs, type HookSpec } from "../server/hooks-registry.js";
import type { AgentId } from "../types.js";
import type { AgentProfile } from "../manifest/types.js";
import type { DriftFinding, DriftReport } from "./types.js";
import { checkArtifactIntegrity } from "./check-artifact-integrity.js";
import {
  readTemplateText,
  SHARED_ARTIFACT_MIRRORS,
} from "./artifact-templates.js";

const KNOWN_AGENT_IDS = new Set(["claude", "codex", "antigravity", "copilot"]);
const USER_OWNED_SKILL_MARKER = "user-owned";

/** Remove nullish values from nested data before comparing manifests. */
function stripNullish(frontmatterValue: unknown): unknown {
  if (frontmatterValue === null || frontmatterValue === undefined) {
    return undefined;
  }
  if (Array.isArray(frontmatterValue)) {
    return frontmatterValue.map(stripNullish).filter((v) => v !== undefined);
  }
  if (typeof frontmatterValue === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(
      frontmatterValue as Record<string, unknown>,
    )) {
      const cleaned = stripNullish(v);
      if (cleaned !== undefined) out[k] = cleaned;
    }
    return out;
  }
  return frontmatterValue;
}

/**
 * Parse YAML frontmatter and body text from a markdown file.
 * The parser swallows malformed YAML into a sentinel object and never throws so
 * drift checks can report content mismatch without aborting the whole audit.
 * @param raw - Full markdown file contents, including optional YAML frontmatter.
 * @returns Parsed frontmatter plus body text after the closing marker.
 */
export function parseMarkdownFrontmatter(raw: string): {
  frontmatter: unknown;
  body: string;
} {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: raw };
  const rawFrontmatter = match[1] ?? "";
  const body = match[2] ?? "";
  let parsedRaw: unknown;
  try {
    parsedRaw = load(rawFrontmatter) ?? {};
  } catch {
    return { frontmatter: { __parseError: rawFrontmatter }, body };
  }
  const cleaned = stripNullish(parsedRaw);
  return { frontmatter: cleaned ?? {}, body };
}

/** Normalize markdown body text before drift comparisons. */
function normalizeBody(body: string): string {
  return body.replace(/^\n+/, "").trimEnd() + "\n";
}

/**
 * Compare skill markdown using goat-flow's drift semantics.
 * Ignore harmless YAML order and trailing-space changes while preserving contract differences.
 * @param expected - Template markdown content from `workflow/skills`.
 * @param existing - Installed markdown content from an agent or skill-docs tree.
 * @returns True when normalized frontmatter and body content match.
 */
export function skillContentsEquivalent(
  expected: string,
  existing: string,
): boolean {
  const expectedMarkdown = parseMarkdownFrontmatter(expected);
  const existingMarkdown = parseMarkdownFrontmatter(existing);
  if (
    !isDeepStrictEqual(
      expectedMarkdown.frontmatter,
      existingMarkdown.frontmatter,
    )
  ) {
    return false;
  }
  return (
    normalizeBody(expectedMarkdown.body) ===
    normalizeBody(existingMarkdown.body)
  );
}

/**
 * Runtime sources for installed-project and canonical-package comparisons.
 * The separation prevents consumer audits from reading templates from the target.
 */
interface CheckDriftOptions {
  /** ReadonlyFS rooted at the project being audited (for installed-copy reads). */
  fs: ReadonlyFS;
  /** Audited project root retained for parity with other audit option contracts. */
  projectPath: string;
  /** Package/fixture root containing workflow sources; absent uses the shipped package. */
  templateRoot?: string;
  /** Selected agent whose installed mirrors should be compared; null or absent checks every installed agent. */
  agentFilter?: AgentId | null;
}

/** Narrow parsed YAML/JSON values before reading hook and manifest properties. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    Array.isArray(value) === false
  );
}

/** Keep dynamic manifest keys inside the known agent-id union for hook-specific logic. */
function isAgentId(value: string): value is AgentId {
  return KNOWN_AGENT_IDS.has(value);
}

/** Read the configured list of deprecated skill names from the validated manifest. */
function getStaleSkillNames(): Set<string> {
  return new Set(loadManifest().facts.skills.stale_names);
}

/**
 * Return installed skill roots in the scope the user selected for audit.
 * Use an agent filter for one runtime; an empty result leaves missing-install reporting to agent checks.
 */
function selectedInstalledSkillRoots(
  fs: ReadonlyFS,
  agentFilter: AgentId | null | undefined,
): string[] {
  // A selected runtime should not make the user repair mirrors for agents they did not audit.
  const candidateSkillRoots = agentFilter
    ? [loadManifest().agents[agentFilter]?.skills_dir]
    : getInstalledSkillRoots();

  // Absent roots belong to setup checks; drift compares only copies the user actually installed.
  return candidateSkillRoots.filter(
    (skillRoot): skillRoot is string =>
      skillRoot !== undefined && fs.exists(skillRoot),
  );
}

/**
 * Compare installed skill copies with the templates users receive on setup or upgrade.
 * Use an agent filter to keep a selected-runtime audit from reporting another runtime's drift.
 */
function compareSkills(
  fs: ReadonlyFS,
  templateRoot: string,
  findings: DriftFinding[],
  agentFilter: AgentId | null | undefined,
): number {
  let checked = 0;
  const skillRoots = selectedInstalledSkillRoots(fs, agentFilter);

  // Compare each canonical skill's template against every installed copy so
  // drift shows up no matter which agent's folder went stale.
  for (const name of getSkillNames()) {
    // Every manifest-listed reference belongs to the same skill users invoke.
    for (const relativeFile of getSkillFiles(name)) {
      const templateRel = `workflow/skills/${name}/${relativeFile}`;
      const template = readTemplateText(templateRoot, templateRel);

      // A missing source template means every future consumer install would be incomplete.
      if (template === null) {
        findings.push({
          kind: "missing",
          path: templateRel,
          message: `${name}: manifest declares ${templateRel} but the workflow template is missing`,
        });
        continue;
      }

      // Each selected mirror must carry the same user-facing skill contract.
      for (const agentDir of skillRoots) {
        const installedRel = `${agentDir}/${name}/${relativeFile}`;
        checked++;

        // Missing installed content tells the user exactly which selected mirror needs repair.
        if (!fs.exists(installedRel)) {
          findings.push({
            kind: "missing",
            path: installedRel,
            message: `${name}: template at ${templateRel} has no installed copy at ${installedRel}`,
          });
          continue;
        }
        const installed = fs.readFile(installedRel);

        // An unreadable copy is handled by filesystem/setup evidence instead of inventing a content diff.
        if (installed === null) continue;

        // Different skill text means the selected agent would follow a stale workflow.
        if (!skillContentsEquivalent(template, installed)) {
          findings.push({
            kind: "content",
            path: installedRel,
            message: `${name}: template (${templateRel}) and installed copy (${installedRel}) differ`,
          });
        }
      }
    }
  }
  return checked;
}

/** Compare shared setup files against their workflow templates for drift. */
function compareSharedFiles(
  fs: ReadonlyFS,
  templateRoot: string,
  findings: DriftFinding[],
): number {
  let checked = 0;
  for (const spec of SHARED_ARTIFACT_MIRRORS) {
    const template = readTemplateText(templateRoot, spec.template);
    if (template === null) {
      findings.push({
        kind: "missing",
        path: spec.template,
        message: `shared template missing: ${spec.template}`,
      });
      continue;
    }
    checked++;
    if (!fs.exists(spec.installed)) {
      findings.push({
        kind: "missing",
        path: spec.installed,
        message: `${spec.template} has no installed copy at ${spec.installed}`,
      });
      continue;
    }
    const installed = fs.readFile(spec.installed);
    if (installed === null) continue;
    if (!skillContentsEquivalent(template, installed)) {
      findings.push({
        kind: "content",
        path: spec.installed,
        message: `${spec.template} and ${spec.installed} differ`,
      });
    }
  }
  return checked;
}

/**
 * Find non-canonical skills in the mirrors selected for audit.
 * Use the SKILL.md marker to ignore editor files while keeping cleanup guidance actionable.
 */
function findOrphans(
  fs: ReadonlyFS,
  findings: DriftFinding[],
  agentFilter: AgentId | null | undefined,
): void {
  const canonical = new Set<string>(getSkillNames());
  const stale = getStaleSkillNames();

  // Only the runtime mirrors in this audit can produce user-visible orphan findings.
  for (const agentDir of selectedInstalledSkillRoots(fs, agentFilter)) {
    // Each directory entry may be a skill, documentation file, or editor artifact.
    for (const entry of fs.listDir(agentDir)) {
      // Canonical skills are expected and need no cleanup guidance.
      if (canonical.has(entry)) continue;
      const fullPath = `${agentDir}/${entry}`;

      // Only flag real skill directories. listDir returns files too
      // (.DS_Store, README.md, etc.); a skill is identified by SKILL.md.
      if (!fs.exists(`${fullPath}/SKILL.md`)) continue;

      // Known retired skills get the migration-specific message users can act on.
      if (stale.has(entry)) {
        findings.push({
          kind: "deprecated",
          path: fullPath,
          message: `deprecated skill still installed: ${entry} at ${fullPath}`,
        });
        continue;
      }

      const skillMarkdown = fs.readFile(`${fullPath}/SKILL.md`);
      const skillFrontmatter =
        skillMarkdown === null
          ? null
          : parseMarkdownFrontmatter(skillMarkdown).frontmatter;
      if (
        isRecord(skillFrontmatter) &&
        skillFrontmatter["goat-flow-ownership"] === USER_OWNED_SKILL_MARKER
      ) {
        continue;
      }

      // Unknown skill directories are kept separate from named deprecations.
      findings.push({
        kind: "orphan",
        path: fullPath,
        message: `orphan directory in ${agentDir}: ${entry} (not a canonical goat-flow skill)`,
      });
    }
  }
}

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

/** Resolve a hook command path the same way installed agent configs store it. */
function hookCommandPath(agent: AgentProfile, script: string): string {
  if (!agent.hooks_dir) return script;
  return pathPosix.join(agent.hooks_dir, script);
}

/** Build the optional Copilot hook entry that drift comparison expects when a toggle is enabled. */
function copilotHookEntry(agent: AgentProfile, spec: HookSpec): object {
  const path = hookCommandPath(agent, spec.primaryScript);
  return {
    type: "command",
    bash: path,
    powershell: `if (Get-Command bash -ErrorAction SilentlyContinue) { bash ${path} } else { Write-Output '{"permissionDecision":"deny","permissionDecisionReason":"Bash, Git Bash, or WSL is required to run ${path} on Windows."}' }`,
    timeoutSec: spec.timeoutSec ?? 30,
  };
}

/** Detect a command entry that directly launches one managed hook script. */
function commandEntryReferencesSpec(entry: unknown, spec: HookSpec): boolean {
  // Non-object JSON cannot represent a runnable hook command.
  if (!isRecord(entry)) return false;
  const commands = [
    typeof entry.command === "string" ? entry.command : "",
    typeof entry.bash === "string" ? entry.bash : "",
    typeof entry.powershell === "string" ? entry.powershell : "",
  ].join("\n");
  return spec.scriptFiles.some((script) => commands.includes(script));
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
 */
function compareHooks(
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
 */
function compareManagedHookTimeouts(
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

/** Compare optional registry hook scripts when present or explicitly enabled. */
function compareRegistryHookScripts(
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
 */
function findDeprecatedHookFiles(
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

/**
 * Run all drift comparisons and return a consolidated report.
 *
 * @param options - Project filesystem plus optional goat-flow template root.
 * @returns Drift status, findings, and count of compared template/install pairs.
 * @throws when the canonical manifest or hook registry cannot be loaded
 */
export function checkDrift(options: CheckDriftOptions): DriftReport {
  const { fs, agentFilter } = options;

  // Consumer runs use the package templates when the caller does not supply a test fixture root.
  const templateRoot = options.templateRoot ?? getTemplatePath("");
  const findings: DriftFinding[] = [];
  let checked = 0;
  const checkedHookArtifacts = new Set<string>();
  checked += compareSkills(fs, templateRoot, findings, agentFilter);
  checked += compareSharedFiles(fs, templateRoot, findings);
  checked += compareHooks(
    fs,
    templateRoot,
    findings,
    checkedHookArtifacts,
    agentFilter,
  );
  checked += compareManagedHookTimeouts(fs, findings, agentFilter);
  checked += compareRegistryHookScripts(
    fs,
    templateRoot,
    findings,
    checkedHookArtifacts,
    agentFilter,
  );
  checked += findDeprecatedHookFiles(fs, findings);
  findOrphans(fs, findings, agentFilter);

  // Identity, resource, and complete-set checks catch packaging failures that byte parity cannot see.
  findings.push(
    ...checkArtifactIntegrity({
      fs,
      templateRoot,
      installedSkillRoots: selectedInstalledSkillRoots(fs, agentFilter),
    }),
  );

  // Any mismatch means setup or upgrade would give the user a different workflow than this checkout.
  return {
    status: findings.length === 0 ? "pass" : "fail",
    findings,
    checked,
  };
}
