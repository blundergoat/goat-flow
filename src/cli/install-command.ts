/**
 * Runs installation or explicit state-only recovery for the selected project.
 *
 * Normal installation previews changes, checks authority, runs the bundled installer and verifies its result.
 * State-only recovery relocates legacy bookkeeping while preserving installed files and policy choices.
 */
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { inspectPolicyUpgrade } from "../../workflow/hooks/hook-policy-state.cjs";
import { migrateLegacyLocalState } from "./local-state-migration.js";
import { readManagedInstallStateFacade } from "./managed-setup-state.js";

import { getAgentProfile, getAgentProfiles } from "./agents/registry.js";
import { classifyProjectState } from "./classify-state.js";
import { CLIError } from "./cli-error.js";
import { pathWriteClaimInspectCommand } from "./claims-command.js";
import type { ParsedCLI } from "./cli-types.js";
import { createFS } from "./facts/fs.js";
import {
  buildInstallerInvocation,
  buildInstallerSpawnSpec,
} from "./install-invocation.js";
import {
  buildManagedSetupPreview,
  isBlockingManagedFile,
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
    // Refreshing an older installation also records the current config version unless the user already requested that flag.
    if (
      !options.updateConfigVersion &&
      (state.state === "outdated" || state.state === "v0.9")
    ) {
      flags.push("--update-config-version");
    }
    // The older layout needs retired-skill cleanup to complete the user's upgrade.
    if (!options.cleanDeprecated && state.state === "v0.9") {
      flags.push("--clean-deprecated");
    }
    return flags;
  } catch {
    // An unreadable adoption marker supplies no inferred upgrade flags; the user's explicit options still reach setup.
    return [];
  }
}

/**
 * Build the installer flag list from user choices plus the preview's own decisions.
 * The preview decides which managed paths remain preserved; Bash receives those choices rather than deciding them again.
 *
 * @param options - parsed user choices carrying the target and any explicit authority
 * @param agent - selected agent whose managed mirror is installed
 *
 * @param preview - the report already shown to the user; its preserved rows become skip flags
 * @returns the complete argument list appended after the installer's target and agent
 */
function collectInstallerFlags(
  options: ParsedCLI,
  agent: AgentId,
  preview: ManagedSetupPreview,
): string[] {
  const flags: string[] = [];
  // Pass the user's explicit version-refresh choice to the bundled installer.
  if (options.updateConfigVersion) flags.push("--update-config-version");
  // Pass the user's explicit retired-skill cleanup choice to the bundled installer.
  if (options.cleanDeprecated) flags.push("--clean-deprecated");
  // Each row's own decision travels to Bash, so apply cannot re-derive a different one.
  for (const file of preview.files) {
    // Locally preserved files stay in the user's project during the installer run.
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
  "deny-git-mutations",
  "post-turn-safety",
  "gruff-code-quality",
] as const;

/**
 * Read one safe regular target file without following an already-observed unsafe destination.
 * Side effects: none; read and metadata errors are converted to a null result.
 *
 * @param projectPath - selected target root containing the relative path
 * @param relativePath - repository-relative file to inspect and read
 *
 * @returns file text, or null for absence, redirection, hard links, or read errors
 * @throws Never; filesystem failures are represented by null
 */
function readExistingTargetText(
  projectPath: string,
  relativePath: string,
): string | null {
  // An absent or unsafe target supplies no readable text for a proposed migration.
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
  // Missing or invalid provider config cannot supply an existing registration to edit.
  if (current.configMissing || current.configInvalid) return null;
  // An enabled current registration already matches the user's desired state.
  if (shouldRegister && current.installed) return null;
  // An enabled hook needs restoration when absent, or repair when its existing row has drifted.
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

/** Keep another provider outside the upgrade preview unless its saved hooks show that the developer enrolled it. */
function hasManagedProviderRegistration(
  projectPath: string,
  agent: AgentId,
): boolean {
  const profile = getAgentProfile(agent);
  // Any supported managed hook establishes enrollment, including a stale registration that setup will repair.
  return listHookSpecs().some((spec) => {
    // Unsupported hooks have no expected entries and cannot prove that this provider was installed.
    if (spec.unsupportedAgents?.[agent] !== undefined) return false;
    const current = readAgentHookState(projectPath, profile, spec);
    return (
      current.installed ||
      (current.registrationIssue !== undefined &&
        current.registrationIssue !== "registration-missing")
    );
  });
}

/** Classify one hook's pending registration edit for the selected provider. */
function pendingHookRegistrationEdit(
  projectPath: string,
  agent: AgentId,
  profile: AgentProfile,
  hookStates: ReadonlyMap<string, HookState>,
  spec: HookSpec,
): HookRegistrationEdit | null {
  // An unsupported provider cannot receive this hook's registration.
  if (spec.unsupportedAgents?.[agent] !== undefined) return null;
  const hookState = hookStates.get(spec.id);
  const agentState = hookState?.agents[agent];
  // An unreported or unsupported hook has no provider registration to include in the user's preview.
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
 *
 * @param agent - selected provider whose one hook-config row receives the summary
 * @returns concise edit phrases; empty means hook reconciliation leaves the config unchanged
 */
function pendingHookConfigEdits(
  projectPath: string,
  agent: AgentId,
  selectedHookId?: string,
): string[] {
  const profile = getAgentProfile(agent);
  // Without an existing hook-config file, the preview's create action covers setup instead of a migration edit.
  if (
    profile.hookConfigFile === null ||
    readExistingTargetText(projectPath, profile.hookConfigFile) === null
  ) {
    return [];
  }

  // A targeted sibling repair must match the installer's enrollment check; unrelated settings do not authorize hook restoration.
  if (
    selectedHookId !== undefined &&
    !hasManagedProviderRegistration(projectPath, agent)
  )
    return [];

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

  // Inspect registry hooks to name the registration changes the user will see before install.
  for (const spec of listHookSpecs()) {
    // A targeted repair previews only the requested hook's registration changes.
    if (selectedHookId !== undefined && spec.id !== selectedHookId) continue;
    const edit = pendingHookRegistrationEdit(
      projectPath,
      agent,
      profile,
      hookStates,
      spec,
    );
    // A hook needing no registration edit contributes no migration sentence.
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
 *
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
  // Inspect saved feature assignments to decide whether the user's Codex settings need the retired flag migration.
  for (const line of settingsText.split(/\r?\n/u)) {
    const sectionMatch = /^\s*\[([^\]]+)\]\s*(?:#.*)?$/u.exec(line);
    // Track the TOML section so a hook flag is read in its actual settings table.
    if (sectionMatch) {
      section = sectionMatch[1]?.trim() ?? "";
      continue;
    }
    const assignment =
      /^\s*([A-Za-z0-9_.-]+)\s*=\s*(?:true|false)\s*(?:#.*)?$/u.exec(line);
    // Unrelated or non-boolean assignments cannot establish the retired hook feature choice.
    if (!assignment) continue;
    const rawKey = assignment[1] ?? "";
    const normalizedKey =
      section === "features" && !rawKey.includes(".")
        ? `features.${rawKey}`
        : rawKey;
    // A retired hook flag makes these settings eligible for the install preview's migration notice.
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
  "**/.netrc",
  "**/.git-credentials",
  "**/.config/gh/hosts.yml",
  "**/.pgpass",
  "**/.pypirc",
  "**/*.pem",
  "**/*.key",
  "**/*.pfx",
] as const;

/**
 * Retire earlier Codex denies that also blocked application names such as secrets routes and credentials.ts providers.
 *
 * A profile retaining one needs refresh; identical user-added patterns cannot be distinguished, so install reports each removal.
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
 * Legacy file-only rules expand to paired home/project directory protection during upgrade.
 * Current credential-store rules are inspected separately so a complete pair keeps its saved order.
 */
const CLAUDE_LEGACY_CREDENTIAL_FILE_RULES = new Set([
  "Read(**/.docker/config.json)",
  "Read(**/.kube/config)",
  "Edit(**/.docker/config.json)",
  "Edit(**/.kube/config)",
]);

/** Credential stores whose existing Claude deny receives a missing home or project partner during setup. */
const CLAUDE_PAIRED_CREDENTIAL_STORES = new Set([
  ".ssh/**",
  ".aws/**",
  ".gnupg/**",
  ".config/gcloud/**",
  ".docker/**",
  ".kube/**",
  ".npmrc",
  ".pypirc",
  ".netrc",
  ".git-credentials",
  ".config/gh/hosts.yml",
  ".pgpass",
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
 *
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

  // Collect only the active Codex profile's settings before deciding what the install will refresh.
  for (const line of settingsText.split(/\r?\n/u)) {
    // The active profile table supplies its base permission metadata.
    if (profileSection.test(line)) {
      selectedSection = "profile";
      // The active filesystem table supplies the user's current path restrictions.
    } else if (filesystemSection.test(line)) {
      selectedSection = "filesystem";
      // Another table ends the active profile region and remains outside this migration check.
    } else if (anySection.test(line)) {
      selectedSection = null;
    }
    // Only active profile lines contribute to the user's permission migration decision.
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
  // Without an active permission surface, this project has no existing Codex profile to refresh.
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
 *
 * @returns true only when a recognized stale rule would be changed
 * @throws Never; parse failures return false
 */
function claudePermissionsNeedMigration(settingsText: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(settingsText) as unknown;
  } catch {
    // Hand-edited invalid JSON stays preserved during setup, so this preview names no permission-rule migration.
    return false;
  }
  // Malformed settings cannot supply a Claude permission migration preview.
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
    return false;
  const permissions = (parsed as Record<string, unknown>).permissions;
  // A missing or malformed permissions object has no rule lists for this migration to inspect.
  if (
    permissions === null ||
    typeof permissions !== "object" ||
    Array.isArray(permissions)
  )
    return false;
  const permissionRecord = permissions as Record<string, unknown>;
  return ["deny", "allow", "ask"].some((arrayName) => {
    const rules = permissionRecord[arrayName];
    // A missing or malformed rule list has no saved permission entries to preview.
    if (!Array.isArray(rules)) return false;
    return rules.some((rule) =>
      installRewritesClaudeRule(arrayName, rule, rules),
    );
  });
}

/** Check whether the preview needs a missing home or project deny for a credential store the developer already protects. */
function isIncompleteClaudeCredentialPair(
  rule: string,
  savedRules: readonly unknown[],
): boolean {
  const credentialRule = /^(Read|Edit)\((~\/|\*\*\/)(.+)\)$/u.exec(rule);
  const credentialStore = credentialRule?.[3];
  // An ordinary application path is outside the credential-store policy and receives no additional deny.
  if (
    !credentialRule ||
    credentialStore === undefined ||
    !CLAUDE_PAIRED_CREDENTIAL_STORES.has(credentialStore)
  )
    return false;
  const otherLocation = credentialRule[2] === "~/" ? "**/" : "~/";
  return !savedRules.includes(
    `${credentialRule[1]}(${otherLocation}${credentialStore})`,
  );
}

/**
 * Decide whether install would change one Claude permission rule during an upgrade.
 *
 * Unmatched tool forms are repaired in every list; only deny rules are retired, expanded, or paired across credential locations.
 * An allow or ask rule with the same text remains the user's own choice.
 *
 * @param arrayName - permission list the rule came from: `deny`, `allow`, or `ask`
 *
 * @param rule - one raw list entry; a non-string entry is left untouched and reports false
 * @param savedRules - entries in the same saved list; a missing partner requires migration, while a complete pair stays unchanged
 * @returns true when the standalone installer would remove or rewrite this entry
 */
function installRewritesClaudeRule(
  arrayName: string,
  rule: unknown,
  savedRules: readonly unknown[],
): boolean {
  // A non-string permission entry cannot identify a tool rule that setup rewrites.
  if (typeof rule !== "string") return false;
  // These retired tool spellings need repair before Claude can enforce the user's file rules.
  if (/^(?:MultiEdit|Write|NotebookEdit|Glob)\(/u.test(rule)) return true;
  // Only deny lists receive environment expansion and retired-path cleanup; allow and ask choices retain their meaning.
  if (arrayName !== "deny") return false;
  return (
    rule === "Read(**/.env*)" ||
    rule === "Edit(**/.env*)" ||
    CLAUDE_RETIRED_DENY_RULES.has(rule) ||
    CLAUDE_LEGACY_CREDENTIAL_FILE_RULES.has(rule) ||
    isIncompleteClaudeCredentialPair(rule, savedRules)
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
  // Codex settings receive the feature-flag and permission-profile migrations owned by this installer.
  if (agent === "codex") {
    // A saved retired feature flag adds a specific migration notice to the user's preview.
    if (hasDeprecatedCodexHooksFlag(settingsText)) {
      edits.push("migrate the deprecated codex_hooks feature flag");
    }
    // An outdated permission profile adds its refresh notice to the user's preview.
    if (codexPermissionProfileNeedsMigration(settingsText)) {
      edits.push("refresh the Codex permission profile");
    }
  }
  // Claude's stale permission rules add their repair notice to the user's preview.
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
  // A provider without settings has no settings file to include in the migration preview.
  if (profile.settingsFile === null) return settingsMigrations;

  // Inspect the provider's shared and applicable local settings before listing migration edits.
  for (const settingsPath of agentSettingsPaths(profile.settingsFile, agent)) {
    const settingsText = readExistingTargetText(projectPath, settingsPath);
    // Missing or unsafe settings cannot supply an existing migration target.
    if (settingsText === null) continue;
    const edits = pendingAgentSettingsEdits(settingsText, agent);
    // Only files needing edits appear in the user's settings migration summary.
    if (edits.length > 0) settingsMigrations.set(settingsPath, edits);
  }
  return settingsMigrations;
}

/** Return whether install will append its dependency ignore to an existing root policy. */
function rootGitignoreNeedsMigration(projectPath: string): boolean {
  const gitignoreText = readExistingTargetText(projectPath, ".gitignore");
  // An absent or unsafe root ignore file has no existing content to migrate.
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
  // An absent or unsafe config supplies no existing top-level settings to migrate.
  if (configText === null) return [];

  const edits: string[] = [];
  const migratesConfigVersion =
    options.updateConfigVersion ||
    deriveInstallFlags(options.projectPath, agent, options).includes(
      "--update-config-version",
    );
  // A requested version change appears as a config edit in the install preview.
  if (migratesConfigVersion) edits.push("update the version field");
  // Inspect each retired config section before naming its removal in the preview.
  for (const retired of RETIRED_CONFIG_BLOCKS) {
    // A present retired section adds only its own removal notice.
    if (retired.pattern.test(configText)) edits.push(retired.edit);
  }
  const absentToggles = SHIPPED_HOOK_TOGGLES.filter(
    (hookId) => !new RegExp(`^\\s{2}${hookId}\\s*:`, "mu").test(configText),
  );
  // Missing hook choices are listed so the user can see which defaults setup will add.
  if (absentToggles.length > 0) {
    edits.push(`add hook toggles: ${absentToggles.join(", ")}`);
  }
  return edits;
}

/**
 * Name every in-place edit this run will make to the user's config, keyed by path.
 *
 * Users cannot verify "this file may change" after the fact, so the row names each edit install will perform: the requested version bump plus any
 * retired block or missing toggle.
 *
 * @param options - parsed user choices carrying the target and any explicit migration flag
 *
 * @param agent - selected agent whose adoption state can derive a version migration
 * @returns path-to-summary entries; empty when this run edits no user-owned file in place
 */
function pendingMigrations(
  options: ParsedCLI,
  agent: AgentId,
): ReadonlyMap<string, string> {
  const migrations = new Map<string, string>();
  const configEdits = pendingConfigMigrationEdits(options, agent);
  // Only changed project config receives a migration row in the install preview.
  if (configEdits.length > 0) {
    addPendingMigration(
      migrations,
      ".goat-flow/config.yaml",
      `Install edits this user-owned file in place to ${configEdits.join("; ")}. Every other line, comment, and hook choice stays byte-stable.`,
    );
  }

  const profile = getAgentProfile(agent);
  const hookConfigEdits = pendingHookConfigEdits(options.projectPath, agent);
  // An existing provider hook file receives a migration row when its registrations need reconciliation.
  if (profile.hookConfigFile !== null && hookConfigEdits.length > 0) {
    addPendingMigration(
      migrations,
      profile.hookConfigFile,
      `Install edits this user-owned hook config in place to ${hookConfigEdits.join("; ")}. Unrelated hook rows and top-level fields retain their semantic values, but JSON formatting may be normalized.`,
    );
  }
  // Add each existing settings file with its own concrete migration summary.
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
  // An outdated root ignore entry adds its own migration notice to the user's preview.
  if (rootGitignoreNeedsMigration(options.projectPath)) {
    addPendingMigration(
      migrations,
      ".gitignore",
      "Install appends the node_modules/ dependency ignore and preserves every existing line.",
    );
  }
  const commitGuidanceBridgePath =
    pendingCommitGuidanceMigrationInstructionPath(options.projectPath, agent);
  // An existing commit-guidance bridge receives a notice when its installed guidance needs refresh.
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
  // Successful claim cleanup needs no recovery diagnostic for the user.
  if (failures.length === 0) return null;
  const details = failures
    .map((failure) => `${failure.targetPath} (${failure.status})`)
    .join(", ");
  return `Managed install could not confirm owner-safe claim release for ${details}. Inspect the listed write claim before retrying; do not remove it while a writer may be active.`;
}

/** Translate reusable claim admission into the install command's no-mutation contract. */
function managedInstallClaimError(
  error: PathWriteClaimError,
  projectPath: string,
): CLIError {
  const baseMessage =
    error.reason === "busy"
      ? `Managed install is busy: another process owns ${error.targetPath}. No target files were changed. Inspect the claim before retrying: ${pathWriteClaimInspectCommand(projectPath, error.targetPath)}.`
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
    // A write-claim refusal becomes an install-specific recovery error before the project can be changed.
    if (error instanceof PathWriteClaimError) {
      throw managedInstallClaimError(error, projectPath);
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
    // A replaced or unreadable claim marker prevents confirmed cleanup; tell the user to inspect claims before retrying.
    diagnostic =
      "Managed install could not confirm owner-safe claim release. Inspect the write claims before retrying; do not remove them while a writer may be active.";
  }
  // Successful cleanup needs no additional completion message.
  if (diagnostic === null) return;
  // After an earlier install failure, report cleanup trouble without hiding the original failure.
  if (didTransactionFail) {
    console.error(diagnostic);
    return;
  }
  throw new CLIError(diagnostic, 1);
}

/**
 * Include existing sibling-provider Git registrations in the install write set.
 *
 * Shared policy bytes affect those providers too, so their exact config rows receive
 * the same existing preview/admission contract before the standalone upgrade writes them.
 */
function buildInstallPreview(
  options: ParsedCLI,
  agent: AgentId,
  authority: ManagedSetupAuthority,
): ManagedSetupPreview {
  const preview = buildManagedSetupPreview(
    options.projectPath,
    agent,
    authority,
    pendingMigrations(options, agent),
  );
  // Check installed sibling providers because shared Git protection may require changes beyond the selected agent.
  for (const sibling of getAgentProfiles()) {
    // The selected provider is already covered, and a provider without a hook file has no sibling migration row.
    if (sibling.id === agent || sibling.hookConfigFile === null) continue;
    const edits = pendingHookConfigEdits(
      options.projectPath,
      sibling.id,
      "deny-git-mutations",
    );
    // A sibling needing no hook edits does not enlarge the user's install preview.
    if (edits.length === 0) continue;
    const migrations = new Map([
      [
        sibling.hookConfigFile,
        `Install edits this existing provider config to ${edits.join("; ")} before replacing shared policy files. Unrelated registrations and settings retain their values.`,
      ],
    ]);
    const siblingPreview = buildManagedSetupPreview(
      options.projectPath,
      sibling.id,
      authority,
      migrations,
    );
    const row = siblingPreview.files.find(
      (file) => file.path === sibling.hookConfigFile,
    );
    // Add a sibling destination only once so the user sees one row per affected file.
    if (row && !preview.files.some((file) => file.path === row.path))
      preview.files.push(row);
    // A blocked or unmanaged sibling file makes the shared install require review before replacement.
    if (row && (isBlockingManagedFile(row) || row.state === "unmanaged"))
      preview.verdict = "blocked";
  }
  preview.files.sort((left, right) => left.path.localeCompare(right.path));
  return preview;
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
  const revalidatedPreview = buildInstallPreview(options, agent, authority);
  const overwriteBlocker = managedSetupAdmissionFailure(
    revalidatedPreview,
    authority,
  );
  // A new overwrite blocker stops installation before the user's files can change.
  if (overwriteBlocker !== null) throw new CLIError(overwriteBlocker, 1);
  // Changed preview inputs invalidate admission so setup cannot replace files the user did not review.
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
    `Managed files were verified, but install state was not recorded. The previous managed baseline is intact and no confirmed receipt was written. Repair write access to .goat-flow/state/install/, then rerun: goat-flow install ${quoteManagedInstallProjectArgument(projectPath)} --agent ${agent}`,
    1,
  );
}

/** Whether the claimed installer reached post-write verification or preserved a child failure. */
type ClaimedManagedInstallOutcome = "completed" | "installer-failed";

/**
 * Explain pending GitHub ownership review before installation can change the selected project.
 *
 * @returns guidance for the newer dashboard Hooks page, or null when existing policy choices need no review
 * @throws CLIError when config or ownership files cannot be inspected safely; installation stops before writes
 */
function policyUpgradeBlocker(projectPath: string): string | null {
  try {
    const review = inspectPolicyUpgrade(
      projectPath,
      getTemplatePath("workflow/hooks"),
    );
    // Fresh installs, identical ownership files and matching switch choices need no migration consent.
    if (!review) return null;
    return `GitHub policy review is required before installation. Use the newer dashboard Hooks page to review the original and requested choices and affected files, then retry. If legacy local state blocks review, stop and upgrade all writers, then run install with --agent <id> --migrate-state-only first. Force options cannot approve this policy change. Files: ${review.paths.join(", ")}`;
  } catch (error) {
    // A malformed config or linked ownership file prevents the installer from identifying the protection the user would change.
    // The reader's first line names the key or path to repair, such as conflicting choices for one policy.
    const reason = (error instanceof Error ? error.message : String(error))
      .split("\n")[0]
      ?.slice(0, 200);
    throw new CLIError(
      `Policy choices or ownership files could not be read safely (${reason}). Repair the selected project's hook configuration before installation.`,
      1,
    );
  }
}

/** Add pending policy review to dry-run diagnostics without granting authority or changing any project files. */
function policyReviewPreview(
  preview: ManagedSetupPreview,
  policyBlocker: string | null,
): ManagedSetupPreview {
  // No policy decision is pending, so the user sees the original managed-file verdict.
  if (!policyBlocker) return preview;
  return {
    ...preview,
    verdict: "blocked",
    limits: [...preview.limits, policyBlocker],
  };
}

/**
 * Apply, verify, and record one install while its caller retains every write claim.
 *
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
  const policyBlocker = policyUpgradeBlocker(options.projectPath);
  // Another writer may have changed policy choices after preview; stop before publishing any install-state markers.
  if (policyBlocker) throw new CLIError(policyBlocker, 1);
  // V2 state and every old-reader marker become visible while the complete claim batch is held, before Bash receives permission to mutate targets.
  prepareManagedInstallStateForApply(options.projectPath);
  const installerLaunch = buildInstallerInvocation({
    scriptPath: getTemplatePath("workflow/install-goat-flow.sh"),
    projectPath: options.projectPath,
    agent,
    installerFlags: collectInstallerFlags(options, agent, installPreview),
    platform: process.platform,
  });
  // An unavailable safe installer launcher stops this install before its subprocess starts.
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
  // A missing executable or launch failure is reported as an installer error to the caller.
  if (installResult.error) {
    throw new CLIError(
      `Could not run installer with ${installerProcess.command}: ${installResult.error.message}`,
      1,
    );
  }
  // A terminated installer cannot be reported as a completed setup.
  if (installResult.signal) {
    throw new CLIError(
      `Installer terminated by signal ${installResult.signal}`,
      1,
    );
  }
  // A failed installer preserves its exit status and skips recording successful install state.
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
    // Unrecordable managed state gives the user explicit recovery guidance instead of claiming verified completion.
    if (error instanceof ManagedInstallStateRecordError) {
      throw managedInstallStateRecovery(options.projectPath, agent);
    }
    throw error;
  }
  // Template mismatches prevent a success receipt even when the installer process exited successfully.
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
 * Move legacy bookkeeping when install and dashboard review are waiting on each other.
 * Preserves record bytes, hooks and policy choices; a repeated request reports that no migration is needed.
 *
 * @param projectPath - existing selected project; a missing, linked or non-directory root is refused before migration
 * @throws CLIError when the project or saved evidence is unsafe, claims remain, or relocation fails
 */
function migrateInstallStateOnly(projectPath: string): void {
  try {
    const projectDirectory = lstatSync(projectPath);
    // A recovery action must stay inside the real project the operator selected.
    if (!projectDirectory.isDirectory() || projectDirectory.isSymbolicLink()) {
      throw new CLIError(
        "State migration requires a real project directory.",
        1,
      );
    }
    const installEvidence = readManagedInstallStateFacade(projectPath);
    // Invalid or competing receipts require repair; moving their directory must not appear to validate them.
    if (
      installEvidence.status === "malformed-blocking" ||
      installEvidence.status === "conflicting"
    ) {
      // Missing diagnostic text still gives the operator a repair step instead of treating invalid evidence as safe.
      throw new CLIError(
        installEvidence.error ??
          "Repair the project's install evidence before migrating local state.",
        1,
      );
    }
    const stateWasMigrated = migrateLegacyLocalState(projectPath);
    console.log(
      stateWasMigrated
        ? "Local state migrated. Hooks and policy choices are unchanged; complete dashboard review, then retry install."
        : "No legacy local state requires migration. Hooks and policy choices are unchanged.",
    );
  } catch (error) {
    // A linked state folder, an outstanding Sync claim, or lost rename permission can stop the user's recovery request.
    throw new CLIError(
      error instanceof Error ? error.message : "Local-state migration failed.",
      1,
    );
  }
}

/**
 * Run preview, installation or explicit state-only recovery after the user chooses an agent.
 * Use for install or setup dry-run/apply; it throws CLI errors or preserves a non-zero child exit.
 *
 * @param options - parsed user choices; a missing agent is rejected before preview or installation
 * @returns completion after preview, migration or install; no value means output and exit state already describe the result
 */
export async function handleInstallCommand(options: ParsedCLI): Promise<void> {
  const selectedAgent = validateManagedSetupRequest(options);
  // The user explicitly chose bookkeeping recovery before returning to dashboard consent and ordinary installation.
  if (options.shouldMigrateStateOnly) {
    migrateInstallStateOnly(options.projectPath);
    return;
  }
  await installManagedFiles(options, selectedAgent);
}

/**
 * Complete ordinary installation after the user selects an agent and any required policy review is resolved.
 * Preview, file authority and write claims still govern every installed file and its verified receipt.
 *
 * @param options - parsed install choices; missing replacement authority preserves conflicting local files
 * @param selectedAgent - validated profile whose managed installation the user requested
 *
 * @returns no value; output and process exit describe completion or a failed installer
 * @throws CLIError when preview, admission, migration or verification cannot safely finish
 */
async function installManagedFiles(
  options: ParsedCLI,
  selectedAgent: AgentId,
): Promise<void> {
  const authority = readManagedSetupAuthority(options);
  const policyBlocker = policyUpgradeBlocker(options.projectPath);
  let installPreview = buildInstallPreview(options, selectedAgent, authority);
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
      managedSetupPreviewForInstallerLaunch(
        policyReviewPreview(installPreview, policyBlocker),
        installerLaunch,
      ),
    );
    return;
  }
  // Generic install or force authority cannot replace the separate policy decision shown on the Hooks page.
  if (policyBlocker) throw new CLIError(policyBlocker, 1);

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

  // Relocation is an apply-only upgrade step, after preview and launch admission.
  try {
    // Relocated legacy state requires a new preview before the admitted install can continue.
    if (migrateLegacyLocalState(options.projectPath)) {
      installPreview = buildInstallPreview(options, selectedAgent, authority);
      const migrationBlocker = managedSetupAdmissionFailure(
        installPreview,
        authority,
      );
      // A blocker discovered after state migration stops the file installation and reports the required recovery.
      if (migrationBlocker !== null) throw new CLIError(migrationBlocker, 1);
    }
  } catch (error) {
    // An unreadable legacy state path or a newly discovered blocker stops file installation and retains its recovery error.
    throw new CLIError(
      error instanceof Error ? error.message : "Local-state migration failed.",
      1,
    );
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
    // A failed installer or verification keeps its original error; later claim cleanup must not hide it from the user.
    didTransactionFail = true;
    throw error;
  } finally {
    releaseManagedInstallClaims(claims, didTransactionFail);
  }
}
