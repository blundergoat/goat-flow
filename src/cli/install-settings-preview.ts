/**
 * Predict the in-place settings edits install will make for one provider, from the settings text alone, so the preview can name them.
 * Every function here works from the settings text it is given and never writes; a Codex migration also reads the packaged template's comments.
 */
import { migrateClaudePermissions } from "./installer/claude-permissions.js";
import { migrateCodexPermissions } from "./installer/codex-permissions.js";
import type { AgentId } from "./types.js";

/**
 * Return whether supplied Codex TOML still declares the retired feature key.
 * Side effects: updates only local parser state and never changes the supplied text or filesystem.
 */
export function hasDeprecatedCodexHooksFlag(settingsText: string): boolean {
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
export function codexPermissionProfileNeedsMigration(
  settingsText: string,
): boolean {
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
export function claudePermissionsNeedMigration(settingsText: string): boolean {
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
  const rules = (permissions as Record<string, unknown>).deny;
  // Install preserves allow/ask spellings, including inert rules, until the owner reviews them.
  return (
    Array.isArray(rules) &&
    rules.some((rule) => installRewritesClaudeRule(rule, rules))
  );
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
 * Only deny rules are normalized, retired, expanded, or paired across credential locations.
 * The caller excludes allow/ask choices from this migration.
 *
 * @param rule - one raw list entry; a non-string entry is left untouched and reports false
 * @param savedRules - entries in the same saved list; a missing partner requires migration, while a complete pair stays unchanged
 * @returns true when the standalone installer would remove or rewrite this entry
 */
function installRewritesClaudeRule(
  rule: unknown,
  savedRules: readonly unknown[],
): boolean {
  // A non-string permission entry cannot identify a tool rule that setup rewrites.
  if (typeof rule !== "string") return false;
  // These retired tool spellings need repair before Claude can enforce the user's file rules.
  if (/^(?:MultiEdit|Write|NotebookEdit|Glob)\(.*\)$/u.test(rule)) return true;
  return (
    rule === "Read(**/.env*)" ||
    rule === "Edit(**/.env*)" ||
    CLAUDE_RETIRED_DENY_RULES.has(rule) ||
    CLAUDE_LEGACY_CREDENTIAL_FILE_RULES.has(rule) ||
    isIncompleteClaudeCredentialPair(rule, savedRules)
  );
}

/**
 * List the permission-rule changes install will make to one settings file, by running the same migration on a copy of its text.
 *
 * @param settingsText - current settings bytes
 * @param agent - provider that owns the settings file
 * @returns one line per added, removed or rewritten rule, as install prints it; empty when nothing changes or the provider has none
 */
export function permissionChangeLines(
  settingsText: string,
  agent: AgentId,
): string[] {
  const lines: string[] = [];
  const collect = (line: string): void => {
    lines.push(line.trim());
  };
  // Only Claude and Codex own permission migrations; the returned text is discarded, so nothing is written.
  if (agent === "claude") migrateClaudePermissions(settingsText, collect);
  else if (agent === "codex") migrateCodexPermissions(settingsText, collect);
  return lines;
}

/** Append the named rule changes to a preview edit, so the row says which rules change, not only that some do. */
export function withRuleNames(
  edit: string,
  changes: readonly string[],
): string {
  return changes.length === 0 ? edit : `${edit} (${changes.join("; ")})`;
}
