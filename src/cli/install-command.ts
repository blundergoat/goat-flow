/**
 * Runs the deterministic install command: preview, admission, Bash, then post-install writes.
 *
 * Kept apart from the command router because install is the only command that shows a user a decision, spawns the bundled installer, and then
 * verifies what that installer produced.
 * The preview built here is the single authority both admission and apply consume.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { getAgentProfile } from "./agents/registry.js";
import { classifyProjectState } from "./classify-state.js";
import { CLIError } from "./cli-error.js";
import type { ParsedCLI } from "./cli-types.js";
import { createFS } from "./facts/fs.js";
import {
  buildInstallerInvocation,
  buildInstallerSpawnSpec,
} from "./install-invocation.js";
import {
  buildManagedSetupPreview,
  managedSetupPreviewForInstallerLaunch,
  recordManagedInstallAfterVerification,
  type ManagedSetupPreview,
} from "./managed-setup-preview.js";
import { managedSetupAdmissionFailure } from "./managed-setup-admission.js";
import type { ManagedSetupAuthority } from "./managed-setup-authority.js";
import { readManagedTargetEvidence } from "./managed-setup-write-set.js";
import {
  emitManagedSetupDryRun,
  validateManagedSetupRequest,
} from "./managed-setup-command.js";
import { getTemplatePath } from "./paths.js";
import { emitIndexGenerationInstallResult } from "./learning-loop-index/command.js";
import { emitCommitGuidanceInstallResult } from "./prompt/commit-guidance.js";
import {
  readAgentHookState,
  type AgentHookReadState,
} from "./server/agent-hook-writer.js";
import { readAllHookStates, type HookState } from "./server/hook-registrar.js";
import { listHookSpecs, type HookSpec } from "./server/hooks-registry.js";
import type { AgentId, AgentProfile } from "./types.js";

/**
 * Derive installer flags from the project's adoption state.
 * It swallows an unreadable project into the default flag set rather than blocking the install.
 */
function deriveInstallFlags(
  projectPath: string,
  agentId: string,
  options: ParsedCLI,
): string[] {
  try {
    const projectFS = createFS(projectPath);
    const state = classifyProjectState(projectFS, agentId);
    const flags: string[] = [];
    if (
      !options.updateConfigVersion &&
      (state.state === "outdated" || state.state === "v0.9")
    ) {
      flags.push("--update-config-version");
    }
    if (!options.cleanDeprecated && state.state === "v0.9") {
      flags.push("--clean-deprecated");
    }
    return flags;
  } catch {
    return [];
  }
}

/**
 * Build the installer flag list from user choices plus the preview's own decisions.
 * The preview is the single authority on which managed paths this package leaves alone, so apply receives that decision instead of re-deriving it in
 * Bash.
 *
 * @param options - parsed user choices carrying the target and any explicit authority
 * @param agent - selected agent whose managed mirror is installed
 * @param preview - the report already shown to the user; its preserved rows become skip flags
 * @returns the complete argument list appended after the installer's target and agent
 */
function collectInstallerFlags(
  options: ParsedCLI,
  agent: AgentId,
  preview: ManagedSetupPreview,
): string[] {
  const flags: string[] = [];
  if (options.updateConfigVersion) flags.push("--update-config-version");
  if (options.cleanDeprecated) flags.push("--clean-deprecated");
  // Each row's own decision travels to Bash, so apply cannot re-derive a different one.
  for (const file of preview.files) {
    if (file.state === "local-preserved") {
      flags.push("--preserve-path", file.path);
    }
    // Only a named, twice-authorized user-owned path may lose its create-only protection.
    if (file.authority === "granted-user-owned") {
      flags.push("--replace-user-path", file.path);
    }
  }
  flags.push(...deriveInstallFlags(options.projectPath, agent, options));
  return flags;
}

/**
 * Read every authority the user supplied for this run.
 * Bare `--force` is kept as the alias for `--force-managed` so existing scripts keep working.
 *
 * @param options - parsed user choices; absent authority flags produce an authority that admits nothing
 * @returns the authority both the preview rows and the admission gate resolve against
 */
function readManagedSetupAuthority(options: ParsedCLI): ManagedSetupAuthority {
  return {
    shouldReplaceAllManagedConflicts:
      options.shouldForce || options.shouldForceManaged,
    namedPaths: options.forcePaths,
    shouldReplaceNamedUserOwned: options.shouldForceUserOwned,
  };
}

/** Config key or block whose presence means install will rewrite part of the file. */
const RETIRED_CONFIG_BLOCKS: ReadonlyArray<{ pattern: RegExp; edit: string }> =
  [
    { pattern: /^agents\s*:/mu, edit: "remove the legacy agents allowlist" },
    { pattern: /^tasks\s*:/mu, edit: "migrate the legacy tasks path to plans" },
    {
      pattern: /^plan-guard\s*:/mu,
      edit: "remove the retired plan-guard block",
    },
  ];

/** Hook toggles install adds when the user's config predates them. */
const SHIPPED_HOOK_TOGGLES = [
  "deny-dangerous",
  "post-turn-safety",
  "gruff-code-quality",
] as const;

/**
 * Read one safe regular target file without following an already-observed unsafe destination.
 * Side effects: none; read and metadata errors are converted to a null result.
 *
 * @param projectPath - selected target root containing the relative path
 * @param relativePath - repository-relative file to inspect and read
 * @returns file text, or null for absence, redirection, hard links, or read errors
 * @throws Never; filesystem failures are represented by null
 */
function readExistingTargetText(
  projectPath: string,
  relativePath: string,
): string | null {
  if (readManagedTargetEvidence(projectPath, relativePath).status !== "regular")
    return null;
  try {
    return readFileSync(join(projectPath, relativePath), "utf-8");
  } catch {
    // A disappearing or newly unreadable target is classified again by admission before any write.
    return null;
  }
}

/** Read one target's config text; a first install has no migration source. */
function readTargetConfigText(projectPath: string): string | null {
  return readExistingTargetText(projectPath, ".goat-flow/config.yaml");
}

type HookRegistrationEdit = "restore" | "repair" | "remove";

/** Return whether setup's root contract permits this desired provider registration. */
function hookRegistrationIsAllowed(hookState: HookState): boolean {
  return (
    hookState.enabled &&
    (hookState.scanRoots === null ||
      hookState.scanRoots.status === "implicit" ||
      hookState.scanRoots.status === "configured")
  );
}

/**
 * Classify the one config edit needed to reach desired registration state.
 * Missing or invalid configs stay outside migration because setup either seeds or preserves them.
 */
function hookRegistrationEdit(
  current: AgentHookReadState,
  shouldRegister: boolean,
): HookRegistrationEdit | null {
  if (current.configMissing || current.configInvalid) return null;
  if (shouldRegister && current.installed) return null;
  if (shouldRegister) {
    return current.registrationIssue === "registration-missing"
      ? "restore"
      : "repair";
  }
  const hasOwnedRegistration =
    current.installed ||
    (current.registrationIssue !== undefined &&
      current.registrationIssue !== "registration-missing");
  return hasOwnedRegistration ? "remove" : null;
}

/** User-facing verbs for the three registration changes install can perform. */
const HOOK_REGISTRATION_EDIT_PREFIX: Record<HookRegistrationEdit, string> = {
  restore: "restore managed hook registrations",
  repair: "repair managed hook registrations",
  remove: "remove inactive managed hook registrations",
};

/** Classify one hook's pending registration edit for the selected provider. */
function pendingHookRegistrationEdit(
  projectPath: string,
  agent: AgentId,
  profile: AgentProfile,
  hookStates: ReadonlyMap<string, HookState>,
  spec: HookSpec,
): HookRegistrationEdit | null {
  if (spec.unsupportedAgents?.[agent] !== undefined) return null;
  const hookState = hookStates.get(spec.id);
  const agentState = hookState?.agents[agent];
  if (!hookState || !agentState?.supported) return null;
  const current = readAgentHookState(projectPath, profile, spec);
  // Root eligibility matters because standalone apply removes an ineligible Stop row instead of restoring it.
  return hookRegistrationEdit(current, hookRegistrationIsAllowed(hookState));
}

/**
 * Name managed registration edits the standalone installer will make to an existing agent config.
 * Missing configs are covered by the preview's create action, while invalid JSON stays preserved.
 *
 * @param projectPath - selected target whose current config and root contract are inspected
 * @param agent - selected provider whose one hook-config row receives the summary
 * @returns concise edit phrases; empty means hook reconciliation leaves the config unchanged
 */
function pendingHookConfigEdits(projectPath: string, agent: AgentId): string[] {
  const profile = getAgentProfile(agent);
  if (
    profile.hookConfigFile === null ||
    readExistingTargetText(projectPath, profile.hookConfigFile) === null
  ) {
    return [];
  }

  const hookStates = new Map(
    readAllHookStates(projectPath).map((hookState) => [
      hookState.id,
      hookState,
    ]),
  );
  const edits: Record<HookRegistrationEdit, string[]> = {
    restore: [],
    repair: [],
    remove: [],
  };

  const removalReasons: string[] = [];

  for (const spec of listHookSpecs()) {
    const edit = pendingHookRegistrationEdit(
      projectPath,
      agent,
      profile,
      hookStates,
      spec,
    );
    if (edit === null) continue;
    edits[edit].push(spec.id);

    // Losing a hook is the one edit a user cannot infer, so it carries the registrar's own reason and fix.
    if (edit === "remove") {
      removalReasons.push(
        ...hookRemovalExplanation(hookStates.get(spec.id), agent, spec.id),
      );
    }
  }

  return [
    ...(Object.keys(edits) as HookRegistrationEdit[]).flatMap((edit) =>
      edits[edit].length > 0
        ? [`${HOOK_REGISTRATION_EDIT_PREFIX[edit]}: ${edits[edit].join(", ")}`]
        : [],
    ),
    ...removalReasons,
  ];
}

/**
 * Explain one removal using the registrar's own wording instead of re-deciding why it applies.
 * Use for a `remove` edit; other edits are self-explanatory from their verb and hook id.
 *
 * @param hookState - registrar state for the hook; undefined means the registry never reported it
 * @param agent - provider whose per-agent reason and repair summary apply
 * @param hookId - hook the removal names, echoed so grouped output stays attributable
 * @returns reason and fix lines, or an empty array when the registrar published no reason
 */
function hookRemovalExplanation(
  hookState: HookState | undefined,
  agent: AgentId,
  hookId: string,
): string[] {
  const agentState = hookState?.agents[agent];
  // Without a published reason there is nothing truthful to add beyond the verb line already shown.
  if (!agentState?.reason) return [];
  return [
    `  ${hookId}: ${agentState.reason}`,
    `  fix: ${agentState.repairSummary}`,
  ];
}

/** Add one path-specific edit sentence without discarding an earlier migration summary. */
function addPendingMigration(
  migrations: Map<string, string>,
  path: string,
  summary: string,
): void {
  const existing = migrations.get(path);
  migrations.set(path, existing ? `${existing} ${summary}` : summary);
}

/**
 * Return whether supplied Codex TOML still declares the retired feature key.
 * Side effects: updates only local parser state and never changes the supplied text or filesystem.
 */
function hasDeprecatedCodexHooksFlag(settingsText: string): boolean {
  let section = "";
  for (const line of settingsText.split(/\r?\n/u)) {
    const sectionMatch = /^\s*\[([^\]]+)\]\s*(?:#.*)?$/u.exec(line);
    if (sectionMatch) {
      section = sectionMatch[1]?.trim() ?? "";
      continue;
    }
    const assignment =
      /^\s*([A-Za-z0-9_.-]+)\s*=\s*(?:true|false)\s*(?:#.*)?$/u.exec(line);
    if (!assignment) continue;
    const rawKey = assignment[1] ?? "";
    const normalizedKey =
      section === "features" && !rawKey.includes(".")
        ? `features.${rawKey}`
        : rawKey;
    if (normalizedKey === "features.codex_hooks") return true;
  }
  return false;
}

/** Canonical Codex deny patterns whose absence makes the active permission profile migratable. */
const CODEX_CANONICAL_DENY_PATTERNS = [
  "**/.env",
  "**/.env.local",
  "**/.env.development",
  "**/.env.production",
  "**/.env.staging",
  "**/.env.test",
  "**/.envrc",
  "**/.env.*.local",
  "**/secrets/**",
  "**/.ssh/**",
  "**/.aws/**",
  "**/.docker/**",
  "**/.gnupg/**",
  "**/.kube/**",
  "**/credentials*",
  "**/.npmrc",
  "**/.pypirc",
  "**/*.pem",
  "**/*.key",
  "**/*.pfx",
] as const;

/** Escape literal text before matching one TOML key. */
function escapeRegularExpression(literalText: string): string {
  return literalText.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/** Return whether the selected Codex permission profile has any configured surface. */
function hasCodexPermissionSurface(
  settingsText: string,
  defaultProfile: string,
  hasDefaultProfile: boolean,
): boolean {
  const escapedProfile = escapeRegularExpression(defaultProfile);
  const profileSections = [
    new RegExp(`^\\s*\\[\\s*permissions\\.${escapedProfile}\\s*\\]\\s*$`, "mu"),
    new RegExp(
      `^\\s*\\[\\s*permissions\\.${escapedProfile}\\.filesystem(?:\\..+)?\\s*\\]\\s*$`,
      "mu",
    ),
  ];
  return (
    hasDefaultProfile ||
    profileSections.some((section) => section.test(settingsText))
  );
}

/** Active Codex permission-profile tables separated by the policy they carry. */
interface CodexPermissionProfileText {
  profile: string;
  filesystem: string;
}

/**
 * Read only the selected Codex permission profile's TOML regions.
 * The standalone installer rewrites these regions and preserves every other profile, so preview
 * must not let an inactive profile satisfy or trigger an active-profile migration check.
 */
function selectedCodexPermissionProfileText(
  settingsText: string,
  defaultProfile: string,
): CodexPermissionProfileText {
  const escapedProfile = escapeRegularExpression(defaultProfile);
  const profileSection = new RegExp(
    `^\\s*\\[\\s*permissions\\.${escapedProfile}\\s*\\]\\s*$`,
    "u",
  );
  const filesystemSection = new RegExp(
    `^\\s*\\[\\s*permissions\\.${escapedProfile}\\.filesystem(?:\\..+)?\\s*\\]\\s*$`,
    "u",
  );
  const anySection = /^\s*\[[^\]]+\]\s*$/u;
  const selectedLines: Record<keyof CodexPermissionProfileText, string[]> = {
    profile: [],
    filesystem: [],
  };
  let selectedSection: keyof CodexPermissionProfileText | null = null;

  for (const line of settingsText.split(/\r?\n/u)) {
    if (profileSection.test(line)) {
      selectedSection = "profile";
    } else if (filesystemSection.test(line)) {
      selectedSection = "filesystem";
    } else if (anySection.test(line)) {
      selectedSection = null;
    }
    if (selectedSection !== null) selectedLines[selectedSection].push(line);
  }

  return {
    profile: selectedLines.profile.join("\n"),
    filesystem: selectedLines.filesystem.join("\n"),
  };
}

/** Return whether any canonical Codex deny rule is absent from the selected profile. */
function isCanonicalCodexDenyMissing(settingsText: string): boolean {
  return CODEX_CANONICAL_DENY_PATTERNS.some(
    (pattern) =>
      settingsText.match(
        new RegExp(
          `^[ \\t]*["']${escapeRegularExpression(pattern)}["'][ \\t]*=[ \\t]*["']deny["']`,
          "mu",
        ),
      ) === null,
  );
}

/**
 * Return whether supplied Codex permission text triggers canonical migration.
 * Side effects: none; all matching reads only the supplied string.
 */
function codexPermissionProfileNeedsMigration(settingsText: string): boolean {
  const defaultProfile =
    /^\s*default_permissions\s*=\s*["']([^"']+)["']/mu.exec(
      settingsText,
    )?.[1] ?? "goat-flow";
  const hasDefaultProfile = /^\s*default_permissions\s*=/mu.test(settingsText);
  if (
    !hasCodexPermissionSurface(settingsText, defaultProfile, hasDefaultProfile)
  )
    return false;

  const selectedProfile = selectedCodexPermissionProfileText(
    settingsText,
    defaultProfile,
  );
  const hasLegacyAccess = /=\s*["']none["']/u.test(selectedProfile.filesystem);
  const hasLegacyAnchor = /["']:project_roots["']/u.test(
    selectedProfile.filesystem,
  );
  const missingWorkspaceExtension =
    defaultProfile === "goat-flow" &&
    hasDefaultProfile &&
    !/^\s*extends\s*=\s*["']:workspace["']/mu.test(selectedProfile.profile);
  return [
    hasLegacyAccess,
    hasLegacyAnchor,
    missingWorkspaceExtension,
    isCanonicalCodexDenyMissing(selectedProfile.filesystem),
  ].some(Boolean);
}

/**
 * Return whether supplied Claude permissions contain a rule install rewrites or removes.
 * Side effects: none; malformed JSON is treated as preserved, matching standalone apply.
 *
 * @param settingsText - current JSON bytes from a safe regular settings file
 * @returns true only when a recognized stale rule would be changed
 * @throws Never; parse failures return false
 */
function claudePermissionsNeedMigration(settingsText: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(settingsText) as unknown;
  } catch {
    return false;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
    return false;
  const permissions = (parsed as Record<string, unknown>).permissions;
  if (
    permissions === null ||
    typeof permissions !== "object" ||
    Array.isArray(permissions)
  )
    return false;
  const permissionRecord = permissions as Record<string, unknown>;
  return ["deny", "allow", "ask"].some((arrayName) => {
    const rules = permissionRecord[arrayName];
    if (!Array.isArray(rules)) return false;
    return rules.some(
      (rule) =>
        typeof rule === "string" &&
        (/^(?:MultiEdit|Write|NotebookEdit|Glob)\(/u.test(rule) ||
          (arrayName === "deny" &&
            (rule === "Read(**/.env*)" || rule === "Edit(**/.env*)"))),
    );
  });
}

/** Name the selected provider's existing settings files that install may migrate. */
function agentSettingsPaths(settingsFile: string, agent: AgentId): string[] {
  return agent === "claude"
    ? [settingsFile, ".claude/settings.local.json"]
    : [settingsFile];
}

/** Describe every recognized in-place migration for one existing settings file. */
function pendingAgentSettingsEdits(
  settingsText: string,
  agent: AgentId,
): string[] {
  const edits: string[] = [];
  if (agent === "codex") {
    if (hasDeprecatedCodexHooksFlag(settingsText)) {
      edits.push("migrate the deprecated codex_hooks feature flag");
    }
    if (codexPermissionProfileNeedsMigration(settingsText)) {
      edits.push("refresh the Codex permission profile");
    }
  }
  if (agent === "claude" && claudePermissionsNeedMigration(settingsText)) {
    edits.push("repair stale or unmatched Claude permission rules");
  }
  return edits;
}

/** Name in-place settings migrations for the selected provider and optional local override. */
function pendingAgentSettingsMigrations(
  projectPath: string,
  agent: AgentId,
): Map<string, string[]> {
  const profile = getAgentProfile(agent);
  const settingsMigrations = new Map<string, string[]>();
  if (profile.settingsFile === null) return settingsMigrations;

  for (const settingsPath of agentSettingsPaths(profile.settingsFile, agent)) {
    const settingsText = readExistingTargetText(projectPath, settingsPath);
    if (settingsText === null) continue;
    const edits = pendingAgentSettingsEdits(settingsText, agent);
    if (edits.length > 0) settingsMigrations.set(settingsPath, edits);
  }
  return settingsMigrations;
}

/** Return whether install will append its dependency ignore to an existing root policy. */
function rootGitignoreNeedsMigration(projectPath: string): boolean {
  const gitignoreText = readExistingTargetText(projectPath, ".gitignore");
  if (gitignoreText === null) return false;
  const equivalentEntries = new Set([
    "node_modules/",
    "node_modules",
    "/node_modules/",
    "/node_modules",
    "**/node_modules/",
    "**/node_modules",
  ]);
  return !gitignoreText
    .split(/\r?\n/u)
    .some((line) => equivalentEntries.has(line.trim()));
}

/** Describe every in-place migration the existing Goat Flow config requires. */
function pendingConfigMigrationEdits(
  options: ParsedCLI,
  agent: AgentId,
): string[] {
  const configText = readTargetConfigText(options.projectPath);
  if (configText === null) return [];

  const edits: string[] = [];
  const migratesConfigVersion =
    options.updateConfigVersion ||
    deriveInstallFlags(options.projectPath, agent, options).includes(
      "--update-config-version",
    );
  if (migratesConfigVersion) edits.push("update the version field");
  for (const retired of RETIRED_CONFIG_BLOCKS) {
    if (retired.pattern.test(configText)) edits.push(retired.edit);
  }
  const absentToggles = SHIPPED_HOOK_TOGGLES.filter(
    (hookId) => !new RegExp(`^\\s{2}${hookId}\\s*:`, "mu").test(configText),
  );
  if (absentToggles.length > 0) {
    edits.push(`add hook toggles: ${absentToggles.join(", ")}`);
  }
  return edits;
}

/**
 * Name every in-place edit this run will make to the user's config, keyed by path.
 * Users cannot verify "this file may change" after the fact, so the row names each edit install will perform: the requested version bump plus any
 * retired block or missing toggle.
 *
 * @param options - parsed user choices carrying the target and any explicit migration flag
 * @param agent - selected agent whose adoption state can derive a version migration
 * @returns path-to-summary entries; empty when this run edits no user-owned file in place
 */
function pendingMigrations(
  options: ParsedCLI,
  agent: AgentId,
): ReadonlyMap<string, string> {
  const migrations = new Map<string, string>();
  const configEdits = pendingConfigMigrationEdits(options, agent);
  if (configEdits.length > 0) {
    addPendingMigration(
      migrations,
      ".goat-flow/config.yaml",
      `Install edits this user-owned file in place to ${configEdits.join("; ")}. Every other line, comment, and hook choice stays byte-stable.`,
    );
  }

  const profile = getAgentProfile(agent);
  const hookConfigEdits = pendingHookConfigEdits(options.projectPath, agent);
  if (profile.hookConfigFile !== null && hookConfigEdits.length > 0) {
    addPendingMigration(
      migrations,
      profile.hookConfigFile,
      `Install edits this user-owned hook config in place to ${hookConfigEdits.join("; ")}. Unrelated hook rows and top-level fields retain their semantic values, but JSON formatting may be normalized.`,
    );
  }
  for (const [settingsPath, edits] of pendingAgentSettingsMigrations(
    options.projectPath,
    agent,
  )) {
    const preservationClaim = settingsPath.endsWith(".json")
      ? "Unrelated settings retain their semantic values, but JSON formatting may be normalized."
      : "Every other line and unrelated setting stays byte-stable.";
    addPendingMigration(
      migrations,
      settingsPath,
      `Install edits this user-owned settings file in place to ${edits.join("; ")}. ${preservationClaim}`,
    );
  }
  if (rootGitignoreNeedsMigration(options.projectPath)) {
    addPendingMigration(
      migrations,
      ".gitignore",
      "Install appends the node_modules/ dependency ignore and preserves every existing line.",
    );
  }
  return migrations;
}

/**
 * Run a managed preview or deterministic install after the user chooses an agent.
 * Use for install or setup dry-run/apply; it throws CLI errors or preserves a non-zero child exit.
 *
 * @param options - parsed user choices; a missing agent is rejected before preview or installation
 * @returns completion after preview or install; no value means output and exit state already describe the result
 */
export async function handleInstallCommand(options: ParsedCLI): Promise<void> {
  const selectedAgent = validateManagedSetupRequest(options);
  const authority = readManagedSetupAuthority(options);
  const installPreview = buildManagedSetupPreview(
    options.projectPath,
    selectedAgent,
    authority,
    pendingMigrations(options, selectedAgent),
  );
  const installerLaunch = buildInstallerInvocation({
    scriptPath: getTemplatePath("workflow/install-goat-flow.sh"),
    projectPath: options.projectPath,
    agent: selectedAgent,
    installerFlags: collectInstallerFlags(
      options,
      selectedAgent,
      installPreview,
    ),
    platform: process.platform,
  });
  // A dry-run reports the exact managed-template result and exits before installer side effects.
  if (options.shouldDryRun) {
    emitManagedSetupDryRun(
      options,
      managedSetupPreviewForInstallerLaunch(installPreview, installerLaunch),
    );
    return;
  }

  const overwriteBlocker = managedSetupAdmissionFailure(
    installPreview,
    authority,
  );
  // A conflict report is returned before Bash starts, so the user's target remains unchanged.
  if (overwriteBlocker !== null) throw new CLIError(overwriteBlocker, 1);

  // Invalid launch arguments stop before Bash can change the selected target.
  if (!installerLaunch.ok) {
    throw new CLIError(installerLaunch.error, 1);
  }

  const { spawnInheritedSync } = await import("./server/safe-exec.js");
  const installerProcess = buildInstallerSpawnSpec(installerLaunch);
  const installResult = spawnInheritedSync({
    command: installerProcess.command,
    args: installerProcess.args,
    allowedBasenames: ["bash", "bash.exe"],
    env: installerProcess.env,
  });
  // A spawn failure means the installer never started, so users receive the operating-system error.
  if (installResult.error) {
    throw new CLIError(
      `Could not run installer with ${installerProcess.command}: ${installResult.error.message}`,
      1,
    );
  }
  // A signal means installation ended mid-flow and cannot be recorded as a verified baseline.
  if (installResult.signal) {
    throw new CLIError(
      `Installer terminated by signal ${installResult.signal}`,
      1,
    );
  }
  // A non-zero or missing child status is preserved as failure instead of running post-install writes.
  if (installResult.status !== 0) {
    // Missing numeric status still maps to exit 1 so scripts never mistake it for success.
    process.exitCode = installResult.status ?? 1;
    return;
  }

  const installationMismatches = recordManagedInstallAfterVerification(
    options.projectPath,
    selectedAgent,
  );
  // A successful process exit is insufficient when managed bytes still differ from their templates.
  if (installationMismatches.length > 0) {
    throw new CLIError(
      `Installer exited successfully, but ${installationMismatches.length} managed file(s) do not match their templates. Install state was not recorded.`,
      1,
    );
  }
  emitCommitGuidanceInstallResult(options.projectPath);
  emitIndexGenerationInstallResult(options.projectPath);
}
