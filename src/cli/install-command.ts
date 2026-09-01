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
  ManagedInstallStateRecordError,
  managedSetupPreviewForInstallerLaunch,
  prepareManagedInstallStateForApply,
  recordManagedInstallAfterVerification,
  type ManagedSetupPreview,
} from "./managed-setup-preview.js";
import { managedSetupAdmissionFailure } from "./managed-setup-admission.js";
import { quoteManagedInstallProjectArgument } from "./managed-install-evidence.js";
import type { ManagedSetupAuthority } from "./managed-setup-authority.js";
import { readManagedTargetEvidence } from "./managed-setup-write-set.js";
import {
  emitManagedSetupDryRun,
  validateManagedSetupRequest,
} from "./managed-setup-command.js";
import { getTemplatePath } from "./paths.js";
import {
  acquirePathWriteClaims,
  PathWriteClaimError,
  readPathWriteTargetIdentity,
  releasePathWriteClaims,
  type PathWriteClaimBatch,
  type PathWriteClaimReleaseResult,
} from "./path-write-claim.js";
import { emitIndexGenerationInstallResult } from "./learning-loop-index/command.js";
import {
  emitCommitGuidanceInstallResult,
  pendingCommitGuidanceMigrationInstructionPath,
} from "./prompt/commit-guidance.js";
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
  "**/.ssh/**",
  "**/.aws/**",
  "**/.gnupg/**",
  "**/.config/gcloud/**",
  "**/.docker/**",
  "**/.kube/**",
  "**/.npmrc",
  "**/.pypirc",
  "**/*.pem",
  "**/*.key",
  "**/*.pfx",
] as const;

/**
 * Codex deny patterns goat-flow used to ship and now removes on upgrade because a plain folder or file name blocks ordinary
 * application code (a secrets route, a credentials.ts provider). A profile still carrying one is refreshed; the same pattern
 * added by hand cannot be told apart, so the install output names each removal.
 */
const CODEX_RETIRED_DENY_PATTERNS = [
  "**/secrets/**",
  "**/credentials*",
] as const;

/** Claude deny rules goat-flow used to ship and now removes on upgrade; the Bash deny hook owns shell command policy. */
const CLAUDE_RETIRED_DENY_RULES = new Set([
  "Bash(*sudo *)",
  "Bash(*mkfs*)",
  "Bash(*dd if=*)",
  "Bash(*git reset --hard*)",
  "Read(**/secrets/**)",
  "Edit(**/secrets/**)",
  "Read(**/credentials*)",
  "Edit(**/credentials*)",
]);

/**
 * In-project credential-store rules rewritten to their home-directory form on upgrade.
 * A bare `**` pattern resolves under the working directory, so the old rules never protected the real `~/.ssh` or `~/.aws`.
 */
const CLAUDE_HOME_ANCHOR_REWRITE_SOURCES = new Set([
  "Read(**/.ssh/**)",
  "Read(**/.aws/**)",
  "Read(**/.gnupg/**)",
  "Read(**/.docker/config.json)",
  "Read(**/.kube/config)",
  "Read(**/.npmrc)",
  "Read(**/.pypirc)",
  "Edit(**/.ssh/**)",
  "Edit(**/.aws/**)",
  "Edit(**/.gnupg/**)",
  "Edit(**/.docker/config.json)",
  "Edit(**/.kube/config)",
  "Edit(**/.npmrc)",
  "Edit(**/.pypirc)",
]);

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

/**
 * Build the line matcher for one workspace-root deny entry as the profile file writes it.
 *
 * @param pattern - exact glob key, quoted either way in the TOML line
 * @returns multiline regex that matches `"<pattern>" = "deny"` on its own line
 */
function codexDenyLinePattern(pattern: string): RegExp {
  return new RegExp(
    `^[ \\t]*["']${escapeRegularExpression(pattern)}["'][ \\t]*=[ \\t]*["']deny["']`,
    "mu",
  );
}

/** Return whether any canonical Codex deny rule is absent from the selected profile. */
function isCanonicalCodexDenyMissing(settingsText: string): boolean {
  return CODEX_CANONICAL_DENY_PATTERNS.some(
    (pattern) => settingsText.match(codexDenyLinePattern(pattern)) === null,
  );
}

/**
 * Return whether the selected profile still carries a deny pattern goat-flow retired.
 * A user upgrading from an older template sees "refresh the Codex permission profile" in the preview and the pattern named in the output.
 *
 * @param settingsText - filesystem region of the active profile; an empty region reports false
 * @returns true when at least one retired pattern is still denied
 */
function hasRetiredCodexDenyPattern(settingsText: string): boolean {
  return CODEX_RETIRED_DENY_PATTERNS.some(
    (pattern) => settingsText.match(codexDenyLinePattern(pattern)) !== null,
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
    hasRetiredCodexDenyPattern(selectedProfile.filesystem),
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
    return rules.some((rule) => installRewritesClaudeRule(arrayName, rule));
  });
}

/**
 * Decide whether install would change one Claude permission rule during an upgrade.
 * Unmatched tool forms are repaired in every list; only deny rules are retired, expanded, or re-anchored,
 * because an allow or ask rule with the same text is the user's own choice.
 *
 * @param arrayName - permission list the rule came from: `deny`, `allow`, or `ask`
 * @param rule - one raw list entry; a non-string entry is left untouched and reports false
 * @returns true when the standalone installer would remove or rewrite this entry
 */
function installRewritesClaudeRule(arrayName: string, rule: unknown): boolean {
  if (typeof rule !== "string") return false;
  if (/^(?:MultiEdit|Write|NotebookEdit|Glob)\(/u.test(rule)) return true;
  if (arrayName !== "deny") return false;
  return (
    rule === "Read(**/.env*)" ||
    rule === "Edit(**/.env*)" ||
    CLAUDE_RETIRED_DENY_RULES.has(rule) ||
    CLAUDE_HOME_ANCHOR_REWRITE_SOURCES.has(rule)
  );
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
    edits.push("repair stale, unmatched, or retired Claude permission rules");
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
  const commitGuidanceBridgePath =
    pendingCommitGuidanceMigrationInstructionPath(options.projectPath, agent);
  if (commitGuidanceBridgePath !== null) {
    addPendingMigration(
      migrations,
      commitGuidanceBridgePath,
      "Install edits only the selected Commit Messages section to reference docs/coding-standards/git-commit-message.md before renaming the former guide; every other instruction byte and its file mode stay unchanged.",
    );
  }
  return migrations;
}

/** Return only owner releases that need operator-visible recovery. */
function failedClaimReleases(
  results: readonly PathWriteClaimReleaseResult[],
): PathWriteClaimReleaseResult[] {
  return results.filter((result) => result.status !== "released");
}

/** Render bounded release evidence without guessing that an abandoned owner is dead. */
function claimReleaseDiagnostic(
  results: readonly PathWriteClaimReleaseResult[],
): string | null {
  const failures = failedClaimReleases(results);
  if (failures.length === 0) return null;
  const details = failures
    .map((failure) => `${failure.targetPath} (${failure.status})`)
    .join(", ");
  return `Managed install could not confirm owner-safe claim release for ${details}. Inspect the listed write claim before retrying; do not remove it while a writer may be active.`;
}

/** Translate reusable claim admission into the install command's no-mutation contract. */
function managedInstallClaimError(error: PathWriteClaimError): CLIError {
  const baseMessage =
    error.reason === "busy"
      ? `Managed install is busy: another process owns ${error.targetPath}. No target files were changed.`
      : `Managed install could not claim ${error.targetPath}: ${error.message} No target files were changed.`;
  const cleanupDiagnostic = claimReleaseDiagnostic(error.cleanupResults);
  return new CLIError(
    cleanupDiagnostic === null
      ? baseMessage
      : `${baseMessage} ${cleanupDiagnostic}`,
    1,
  );
}

/**
 * Capture and acquire the complete previewed target-and-state write set.
 * Error behavior: throws an install-specific CLI error for reusable claim refusals; unexpected failures propagate.
 */
function acquireManagedInstallClaims(
  projectPath: string,
  preview: ManagedSetupPreview,
): PathWriteClaimBatch {
  try {
    const requests = preview.files.map((file) => ({
      targetPath: file.path,
      expectedIdentity: readPathWriteTargetIdentity(projectPath, file.path),
    }));
    return acquirePathWriteClaims(projectPath, requests);
  } catch (error) {
    if (error instanceof PathWriteClaimError) {
      throw managedInstallClaimError(error);
    }
    throw error;
  }
}

/**
 * Release one completed batch without masking a transaction failure already in flight.
 * Error behavior: throws a CLI error for an unconfirmed release unless another error is already propagating, in which case it prints the recovery.
 */
function releaseManagedInstallClaims(
  claims: PathWriteClaimBatch,
  didTransactionFail: boolean,
): void {
  let diagnostic: string | null;
  try {
    diagnostic = claimReleaseDiagnostic(releasePathWriteClaims(claims));
  } catch {
    diagnostic =
      "Managed install could not confirm owner-safe claim release. Inspect the write claims before retrying; do not remove them while a writer may be active.";
  }
  if (diagnostic === null) return;
  if (didTransactionFail) {
    console.error(diagnostic);
    return;
  }
  throw new CLIError(diagnostic, 1);
}

/**
 * Rebuild and repeat admission while every previewed destination is claimed.
 * Error behavior: throws a CLI error when admission or any preview input changed before mutation.
 */
function revalidateManagedInstallPreview(
  options: ParsedCLI,
  agent: AgentId,
  authority: ManagedSetupAuthority,
  initialPreview: ManagedSetupPreview,
): ManagedSetupPreview {
  const revalidatedPreview = buildManagedSetupPreview(
    options.projectPath,
    agent,
    authority,
    pendingMigrations(options, agent),
  );
  const overwriteBlocker = managedSetupAdmissionFailure(
    revalidatedPreview,
    authority,
  );
  if (overwriteBlocker !== null) throw new CLIError(overwriteBlocker, 1);
  if (JSON.stringify(revalidatedPreview) !== JSON.stringify(initialPreview)) {
    throw new CLIError(
      "Managed install inputs changed after claim admission. No target files were changed.",
      1,
    );
  }
  return revalidatedPreview;
}

/** Build the accepted installed-bytes-unrecorded recovery command. */
function managedInstallStateRecovery(
  projectPath: string,
  agent: AgentId,
): CLIError {
  return new CLIError(
    `Managed files were verified, but install state was not recorded. The previous managed baseline is intact and no confirmed receipt was written. Repair write access to .goat-flow/install-state/, then rerun: goat-flow install ${quoteManagedInstallProjectArgument(projectPath)} --agent ${agent}`,
    1,
  );
}

/** Whether the claimed installer reached post-write verification or preserved a child failure. */
type ClaimedManagedInstallOutcome = "completed" | "installer-failed";

/**
 * Apply, verify, and record one install while its caller retains every write claim.
 * Error behavior: preserves installer exits and translates verified-but-unrecorded state into the accepted recovery error.
 * @returns completed after verified state and post-install writes, or installer-failed after preserving a non-zero child status
 */
async function runClaimedManagedInstall(
  options: ParsedCLI,
  agent: AgentId,
  authority: ManagedSetupAuthority,
  initialPreview: ManagedSetupPreview,
): Promise<ClaimedManagedInstallOutcome> {
  const installPreview = revalidateManagedInstallPreview(
    options,
    agent,
    authority,
    initialPreview,
  );
  // V2 state and every old-reader marker become visible while the complete claim batch is held, before Bash receives permission to mutate targets.
  prepareManagedInstallStateForApply(options.projectPath);
  const installerLaunch = buildInstallerInvocation({
    scriptPath: getTemplatePath("workflow/install-goat-flow.sh"),
    projectPath: options.projectPath,
    agent,
    installerFlags: collectInstallerFlags(options, agent, installPreview),
    platform: process.platform,
  });
  if (!installerLaunch.ok) throw new CLIError(installerLaunch.error, 1);

  const { spawnInheritedSync } = await import("./server/safe-exec.js");
  const installerProcess = buildInstallerSpawnSpec(installerLaunch);
  const installResult = spawnInheritedSync({
    command: installerProcess.command,
    args: installerProcess.args,
    allowedBasenames: ["bash", "bash.exe"],
    env: {
      ...installerProcess.env,
      GOAT_FLOW_INSTALL_ADMISSION: "v2",
    },
  });
  if (installResult.error) {
    throw new CLIError(
      `Could not run installer with ${installerProcess.command}: ${installResult.error.message}`,
      1,
    );
  }
  if (installResult.signal) {
    throw new CLIError(
      `Installer terminated by signal ${installResult.signal}`,
      1,
    );
  }
  if (installResult.status !== 0) {
    process.exitCode = installResult.status ?? 1;
    return "installer-failed";
  }

  let installationMismatches: string[];
  try {
    installationMismatches = recordManagedInstallAfterVerification(
      options.projectPath,
      agent,
    );
  } catch (error) {
    if (error instanceof ManagedInstallStateRecordError) {
      throw managedInstallStateRecovery(options.projectPath, agent);
    }
    throw error;
  }
  if (installationMismatches.length > 0) {
    throw new CLIError(
      `Installer exited successfully, but ${installationMismatches.length} managed file(s) do not match their templates. Install state was not recorded.`,
      1,
    );
  }
  emitCommitGuidanceInstallResult(options.projectPath, agent);
  emitIndexGenerationInstallResult(options.projectPath);
  return "completed";
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

  const claims = acquireManagedInstallClaims(
    options.projectPath,
    installPreview,
  );
  let didTransactionFail = false;
  try {
    const installOutcome = await runClaimedManagedInstall(
      options,
      selectedAgent,
      authority,
      installPreview,
    );
    didTransactionFail = installOutcome === "installer-failed";
  } catch (error) {
    didTransactionFail = true;
    throw error;
  } finally {
    releaseManagedInstallClaims(claims, didTransactionFail);
  }
}
