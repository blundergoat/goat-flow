/**
 * Explain Codex settings that keep the selected project's hooks or filesystem permissions from working as configured.
 *
 * After syntax validation, these checks identify retired hook flags, disabled hooks, invalid permission globs, and absent exact paths.
 * Each finding names the setting the user can repair before retrying the selected-agent audit.
 */
import type { AuditContext, AuditFailure, BuildCheck } from "./types.js";
import { collectCodexWorkspaceRootEntries } from "../facts/agent/settings.js";
import {
  checkSelectedInstructionAvailable,
  specProvenance,
  uniquePaths,
} from "./check-agent-common.js";

/**
 * Expose object-shaped parsed settings for the selected agent's key checks.
 * Missing or scalar settings return null; an empty object remains available but has no configured keys.
 *
 * @param parsed - parsed settings; null and scalar values provide no object for field inspection
 * @returns - object whose fields the caller must validate, or null when parsed settings are not object-shaped
 */
function settingsObject(parsed: unknown): Record<string, unknown> | null {
  // A hand-edited settings value may be a scalar or null; only an object supplies fields for the next setting check.
  return parsed && typeof parsed === "object"
    ? (parsed as Record<string, unknown>)
    : null;
}

/**
 * Check whether parsed settings include one exact key.
 * Use for flattened TOML facts where section keys appear as dotted strings.
 *
 * @param parsed - parsed settings value; `null` means the key is absent for audit purposes
 * @param key - exact flattened key selected by the check, including dotted TOML section names
 * @returns whether the key exists exactly
 */
function hasSettingsKey(parsed: unknown, key: string): boolean {
  const settings = settingsObject(parsed);
  // Without object-shaped settings, this check has no evidence that the requested key was configured.
  return settings ? Object.prototype.hasOwnProperty.call(settings, key) : false;
}

/**
 * Read an explicit boolean setting.
 * Use when missing and mistyped settings must not be treated as a safe `false`.
 *
 * @param parsed - parsed settings value; `null` means no boolean can be read
 * @param key - exact flattened setting name whose configured boolean the check needs
 * @returns boolean setting value, or `null` when missing/mistyped so audit can report it clearly
 */
function booleanSetting(parsed: unknown, key: string): boolean | null {
  const settings = settingsObject(parsed);
  // Missing settings mean the audit cannot prove the user enabled the feature.
  if (!settings) return null;
  const settingValue = settings[key];
  // Text such as "true" is not an enabled feature; the caller receives null until a real boolean is configured.
  return typeof settingValue === "boolean" ? settingValue : null;
}

/**
 * Report the old Codex hooks flag.
 * Use so users migrate from `[features].codex_hooks` to the current `[features].hooks`.
 *
 * @param ctx - audit context; non-Codex agents are ignored
 * @returns audit failure for deprecated Codex settings, or `null` when none are present
 */
function checkCodexDeprecatedHooksFlag(ctx: AuditContext): AuditFailure | null {
  // Every selected agent is inspected, but only Codex owns this setting.
  for (const agentFacts of ctx.agents) {
    // Other agents do not use `.codex/config.toml`.
    if (agentFacts.agent.id !== "codex") continue;
    // No deprecated key means the user is not carrying the old Codex hook flag.
    if (!hasSettingsKey(agentFacts.settings.parsed, "features.codex_hooks"))
      continue;
    return {
      check: "Agent settings",
      message:
        "Deprecated Codex feature flag in .codex/config.toml: [features].codex_hooks",
      evidence: agentFacts.agent.settingsFile ?? ".codex/config.toml",
      howToFix:
        "Replace `codex_hooks` with `hooks` under `[features]`, or run `goat-flow install . --agent codex` to migrate the setting.",
    };
  }
  return null;
}

/**
 * Report Codex hooks installed without the required feature flag.
 * Use so users know why an installed Codex guardrail will not execute.
 *
 * @param ctx - audit context; non-Codex agents and projects without hooks are ignored
 * @returns audit failure when hooks are installed but disabled, or `null` when runnable/not applicable
 */
function checkCodexHooksEnabled(ctx: AuditContext): AuditFailure | null {
  // Every selected agent is inspected, but only Codex owns this feature flag.
  for (const agentFacts of ctx.agents) {
    // Other agents do not need Codex hooks enabled.
    if (agentFacts.agent.id !== "codex") continue;
    // No installed/registered hook means there is nothing Codex needs to run yet.
    if (!agentFacts.hooks.denyExists && !agentFacts.hooks.denyIsRegistered)
      continue;
    // The current feature flag is present, so Codex can run registered hooks.
    if (booleanSetting(agentFacts.settings.parsed, "features.hooks") === true) {
      continue;
    }
    return {
      check: "Agent settings",
      message:
        "Codex hooks are installed but .codex/config.toml does not enable [features].hooks = true",
      evidence: agentFacts.agent.settingsFile ?? ".codex/config.toml",
      howToFix:
        "Add `hooks = true` under `[features]` in .codex/config.toml, or run `goat-flow install . --agent codex` to install the current Codex settings template.",
    };
  }
  return null;
}

/**
 * Detect exact Codex workspace-root deny paths that should exist on disk.
 * Use so audit can report absent exact paths separately from valid subtree globs.
 *
 * @param pattern - configured filesystem pattern; empty, glob, absolute, and parent-relative paths skip this exact-path check
 * @returns whether the pattern is exact and should exist in the checkout
 */
function isCodexExactWorkspaceRootPath(pattern: string): boolean {
  // Root-wide or glob entries describe a scope rather than one project file whose absence should be reported.
  if (
    pattern.length === 0 ||
    pattern === "." ||
    pattern.includes("*") ||
    pattern.endsWith("/**")
  ) {
    return false;
  }
  // Absolute paths belong outside this workspace-relative existence check and receive no missing-project-file finding.
  if (/^(?:[A-Za-z]:[\\/]|[\\/])/u.test(pattern)) return false;
  // Parent-traversal patterns are excluded because their target may sit outside the selected project.
  return !pattern.split(/[\\/]/u).includes("..");
}

/**
 * Detect Codex none-mode globs rejected by newer Codex config grammar.
 * Use so users can rewrite filename globs into trailing `/**` subtree denies.
 *
 * @param pattern - Codex filesystem pattern; empty/non-glob patterns are not invalid globs here
 * @returns whether the glob must be migrated before Codex accepts the profile
 */
function isCodexInvalidNoneGlob(pattern: string): boolean {
  // Exact paths are handled by the missing-path check, not the invalid-glob check.
  if (!pattern.includes("*")) return false;
  return !pattern.endsWith("/**");
}

/**
 * Collect invalid inline filesystem globs from a TOML inline table string.
 * Use when Codex settings store workspace-root permissions in one flattened value.
 *
 * @param rawValue - raw TOML inline table; empty or non-table text contributes no findings
 * @param invalidGlobs - mutable finding list; remains empty when every none-mode glob is valid
 * @returns nothing; invalid patterns are appended for the audit message
 */
function collectInvalidCodexInlineGlobs(
  rawValue: string,
  invalidGlobs: string[],
): void {
  // Each inline table entry can carry a pattern whose invalid shape affects Codex startup.
  for (const [pattern, mode] of parseTomlInlineStringTable(rawValue)) {
    // Only `none` access patterns block workspace reads/writes and need subtree syntax.
    if (mode === "none" && isCodexInvalidNoneGlob(pattern)) {
      invalidGlobs.push(pattern);
    }
  }
}

/**
 * Extract a Codex filesystem pattern from a flattened TOML key.
 * Use for current and legacy workspace-root anchors during migration checks.
 *
 * @param key - flattened settings key; empty means no filesystem pattern can be extracted
 * @param expandedRootPrefix - current workspace-root key prefix; empty would match too broadly
 * @param legacyExpandedRootPrefix - legacy project-root key prefix; empty would match too broadly
 * @returns extracted pattern, or `null` when the key is not a filesystem entry
 */
function codexFilesystemPatternFromKey(
  key: string,
  expandedRootPrefix: string,
  legacyExpandedRootPrefix: string,
): string | null {
  // Current workspace-root keys use Codex 0.131+ terminology.
  if (key.startsWith(expandedRootPrefix)) {
    return key.slice(expandedRootPrefix.length);
  }
  // Legacy project-root keys need migration but can still expose invalid patterns.
  if (key.startsWith(legacyExpandedRootPrefix)) {
    return key.slice(legacyExpandedRootPrefix.length);
  }
  return null;
}

/**
 * Collect invalid Codex filesystem settings from one flattened entry.
 * Use so audit can report both invalid globs and legacy anchors in one user-facing finding.
 *
 * @param key - flattened settings key; empty means this entry is ignored
 * @param entryValue - flattened setting value; non-string values cannot contain inline glob entries
 * @param filesystemPrefix - current permission-profile prefix; empty would match unrelated settings
 * @param legacyAnchor - legacy project-root anchor; empty would match unrelated settings
 * @param invalidGlobs - mutable list of invalid patterns; empty means no glob migration found yet
 * @param legacyAnchors - mutable list of legacy anchors; empty means no anchor migration found yet
 * @returns nothing; findings are appended for the audit message
 */
function collectCodexFilesystemEntryFindings(
  key: string,
  entryValue: unknown,
  filesystemPrefix: string,
  legacyAnchor: string,
  invalidGlobs: string[],
  legacyAnchors: string[],
): void {
  // Non-filesystem settings do not affect Codex workspace-root access.
  if (!key.startsWith(filesystemPrefix)) return;
  // Legacy project-root anchors need migration to the workspace-root name Codex now accepts.
  if (key === legacyAnchor || key.startsWith(`${legacyAnchor}.`)) {
    legacyAnchors.push(":project_roots");
  }
  // Non-string values cannot be parsed for inline permission patterns.
  if (typeof entryValue !== "string") return;

  const isInlineRoot =
    key === `${filesystemPrefix}:workspace_roots` || key === legacyAnchor;
  // Inline root tables may hold several user-denied patterns in one TOML value.
  if (isInlineRoot) {
    collectInvalidCodexInlineGlobs(entryValue, invalidGlobs);
    return;
  }

  const pattern = codexFilesystemPatternFromKey(
    key,
    `${filesystemPrefix}:workspace_roots.`,
    `${legacyAnchor}.`,
  );
  // Non-pattern entries or non-`none` modes do not produce invalid deny-glob findings.
  if (pattern === null || entryValue !== "none") return;
  // Invalid none-mode globs make Codex reject the permission profile.
  if (isCodexInvalidNoneGlob(pattern)) {
    invalidGlobs.push(pattern);
  }
}

/**
 * Collect Codex filesystem-profile findings for one permission profile.
 * Use when audit checks whether Codex config will load in current Codex versions.
 *
 * @param parsed - parsed Codex settings; `null` or non-object values produce no filesystem findings
 * @param profileName - active permissions profile; empty points at no useful profile
 * @returns invalid globs and legacy anchors; empty arrays mean no migration is needed
 */
function collectCodexFilesystemFindings(
  parsed: unknown,
  profileName: string,
): { invalidGlobs: string[]; legacyAnchors: string[] } {
  const invalidGlobs: string[] = [];
  const legacyAnchors: string[] = [];
  // Without a settings object, the audit cannot inspect Codex filesystem entries.
  if (!parsed || typeof parsed !== "object") {
    return { invalidGlobs, legacyAnchors };
  }
  const filesystemPrefix = `permissions.${profileName}.filesystem.`;
  const legacyAnchor = `${filesystemPrefix}:project_roots`;
  // Inspect each flattened TOML key because filesystem entries can be represented several ways.
  for (const [key, value] of Object.entries(
    parsed as Record<string, unknown>,
  )) {
    collectCodexFilesystemEntryFindings(
      key,
      value,
      filesystemPrefix,
      legacyAnchor,
      invalidGlobs,
      legacyAnchors,
    );
  }
  return { invalidGlobs, legacyAnchors };
}

/**
 * Parse a TOML inline string table into key/value pairs.
 * Use for Codex filesystem permission tables flattened into a single settings value.
 *
 * @param rawValue - raw inline table text; empty or non-table text produces no entries
 * @returns parsed key/value pairs; empty array means no inline permissions were readable
 */
function parseTomlInlineStringTable(rawValue: string): Array<[string, string]> {
  const trimmedTable = rawValue.trim();
  // Only inline table text can carry the compact workspace-root permission shape.
  if (!trimmedTable.startsWith("{") || !trimmedTable.endsWith("}")) return [];
  const entries: Array<[string, string]> = [];
  const entryPattern = /"((?:\\.|[^"\\])*)"\s*=\s*"((?:\\.|[^"\\])*)"/gu;
  // Each quoted key/value pair maps a workspace pattern to an access mode.
  for (const match of trimmedTable.matchAll(entryPattern)) {
    const [, key, mode] = match;
    // Empty keys or modes cannot produce an actionable Codex migration finding.
    if (key && mode) entries.push([key, mode]);
  }
  return entries;
}

/**
 * Build the Codex invalid-workspace-root audit message.
 * Use so invalid globs and legacy anchors appear in one remediation paragraph.
 *
 * @param invalidGlobs - invalid none-mode patterns; empty omits the glob sentence
 * @param legacyAnchors - legacy anchors found in config; empty omits the anchor sentence
 * @returns user-facing audit message; empty inputs still return the shared Codex grammar reminder
 */
function formatCodexWorkspaceRootInvalidGlobMessage(
  invalidGlobs: string[],
  legacyAnchors: string[],
): string {
  const messageParts: string[] = [];
  // Invalid globs are listed so the user knows exactly which patterns to rewrite.
  if (invalidGlobs.length > 0) {
    messageParts.push(
      `Codex permission profile uses filename-glob patterns with "none" access that Codex 0.131+ rejects: ${uniquePaths(invalidGlobs).join(", ")}`,
    );
  }
  // Legacy anchors are called out separately because the fix is a key-name migration.
  if (legacyAnchors.length > 0) {
    messageParts.push(
      `Codex permission profile uses the legacy ":project_roots" anchor (Codex 0.131+ uses ":workspace_roots")`,
    );
  }
  return `${messageParts.join("; ")}. Codex requires exact paths or trailing "/**" subtree patterns for "none" access.`;
}

/**
 * Check Codex workspace-root permission entries for current grammar compatibility.
 * Use so users can fix config that would make dashboard-launched Codex fail before startup.
 *
 * @param ctx - audit context; non-Codex agents or missing profile names are ignored
 * @returns audit failure for invalid globs/anchors, or `null` when no migration is needed
 */
function checkCodexWorkspaceRootInvalidGlobs(
  ctx: AuditContext,
): AuditFailure | null {
  // Every selected agent is inspected, but only Codex owns workspace-root profiles.
  for (const agentFacts of ctx.agents) {
    // Other agents do not use Codex filesystem permission grammar.
    if (agentFacts.agent.id !== "codex") continue;
    const settings = settingsObject(agentFacts.settings.parsed);
    const defaultPermissions = settings?.default_permissions;
    // Without a default profile, there is no active Codex filesystem profile to validate.
    if (typeof defaultPermissions !== "string" || defaultPermissions === "") {
      continue;
    }
    const { invalidGlobs, legacyAnchors } = collectCodexFilesystemFindings(
      agentFacts.settings.parsed,
      defaultPermissions,
    );
    // No invalid globs or legacy anchors means the active profile is grammar-compatible.
    if (invalidGlobs.length === 0 && legacyAnchors.length === 0) continue;
    return {
      check: "Agent settings",
      message: formatCodexWorkspaceRootInvalidGlobMessage(
        invalidGlobs,
        legacyAnchors,
      ),
      evidence: agentFacts.agent.settingsFile ?? ".codex/config.toml",
      howToFix:
        "Run `goat-flow install . --agent codex` (without --force) to migrate the .codex/config.toml filesystem block in place. The installer rewrites filename globs to canonical subtree denies (e.g. `.ssh/**`, `.aws/**`) and drops retired folder-name patterns. Filename-level protections are covered by .goat-flow/hooks/deny-dangerous.sh.",
    };
  }
  return null;
}

/**
 * Check Codex exact workspace-root paths that do not exist.
 * Use so users remove stale exact entries while keeping valid subtree deny patterns.
 *
 * @param ctx - audit context; non-Codex agents or missing profile names are ignored
 * @returns audit failure listing absent exact paths, or `null` when exact entries are valid
 */
function checkCodexWorkspaceRootExactPaths(
  ctx: AuditContext,
): AuditFailure | null {
  // Every selected agent is inspected, but only Codex owns workspace-root profiles.
  for (const agentFacts of ctx.agents) {
    // Other agents do not use Codex filesystem permission grammar.
    if (agentFacts.agent.id !== "codex") continue;
    const settings = settingsObject(agentFacts.settings.parsed);
    const defaultPermissions = settings?.default_permissions;
    // Without a default profile, there is no active Codex filesystem profile to validate.
    if (typeof defaultPermissions !== "string" || defaultPermissions === "") {
      continue;
    }
    const missingWorkspacePaths = collectCodexWorkspaceRootEntries(
      agentFacts.settings.parsed,
      defaultPermissions,
    )
      .filter((entry) => isCodexExactWorkspaceRootPath(entry.pattern))
      .map((entry) => entry.pattern)
      .filter((pattern) => !ctx.fs.exists(pattern));
    // All exact paths exist, so the user does not need to edit this profile.
    if (missingWorkspacePaths.length === 0) continue;
    return {
      check: "Agent settings",
      message: `Codex permission profile lists exact workspace-root paths that do not exist: ${uniquePaths(missingWorkspacePaths).join(", ")}`,
      evidence: agentFacts.agent.settingsFile ?? ".codex/config.toml",
      howToFix:
        "Remove absent exact entries from .codex/config.toml. Keep trailing `/**` subtree denies, and add exact `none`/`read` entries only for files that exist in this checkout.",
    };
  }
  return null;
}

export const agentSettings: BuildCheck = {
  id: "agent-settings",
  name: "Agent settings",
  scope: "agent",
  provenance: specProvenance([
    "workflow/manifest.json",
    ".goat-flow/architecture.md",
  ]),
  // Validate the selected agent's settings syntax, then report the first Codex migration or hook-enablement issue.
  run: (ctx) => {
    // Aggregate mode stops at instruction coverage; settings are checked per selected agent.
    if (!ctx.agentFilter) return null;
    const instructionFailure = checkSelectedInstructionAvailable(
      ctx,
      "Agent settings",
    );
    // Missing instruction files block settings checks because setup must recreate the agent surface first.
    if (instructionFailure) return instructionFailure;
    const invalidSettingsAgents: string[] = [];
    // Invalid settings syntax is reported before semantic Codex migration checks.
    for (const agentFacts of ctx.agents) {
      // Settings that exist but failed parsing need syntax repair from the user.
      if (agentFacts.settings.exists && !agentFacts.settings.valid) {
        invalidSettingsAgents.push(agentFacts.agent.id);
      }
    }
    // Syntax errors prevent reliable semantic checks, so report them first.
    if (invalidSettingsAgents.length > 0) {
      return {
        check: "Agent settings",
        message: `Invalid settings for: ${invalidSettingsAgents.join(", ")}`,
        howToFix: `Fix the JSON syntax in the settings file for ${invalidSettingsAgents.join(", ")}.`,
      };
    }
    // Stop at the first repair the user can make; later semantic checks run after that setting is corrected.
    return (
      checkCodexDeprecatedHooksFlag(ctx) ??
      checkCodexHooksEnabled(ctx) ??
      checkCodexWorkspaceRootInvalidGlobs(ctx) ??
      checkCodexWorkspaceRootExactPaths(ctx)
    );
  },
};
