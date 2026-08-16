/**
 * Runs the deterministic install command: preview, admission, Bash, then post-install writes.
 * Kept apart from the command router because install is the only command that shows a user a
 * decision, spawns the bundled installer, and then verifies what that installer produced.
 * The preview built here is the single authority both admission and apply consume.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
import {
  emitManagedSetupDryRun,
  validateManagedSetupRequest,
} from "./managed-setup-command.js";
import { getTemplatePath } from "./paths.js";
import { emitIndexGenerationInstallResult } from "./learning-loop-index/command.js";
import { emitCommitGuidanceInstallResult } from "./prompt/commit-guidance.js";
import type { AgentId } from "./types.js";

/** Derive installer flags from the project's adoption state. */
function deriveInstallFlags(
  projectPath: string,
  agentId: string,
  options: ParsedCLI,
): string[] {
  if (options.shouldForce) return [];
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
 * The preview is the single authority on which managed paths this package leaves alone,
 * so apply receives that decision instead of re-deriving it in Bash.
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

/** Read one target's config text; it swallows any read error as null, so a first install simply has none yet. */
function readTargetConfigText(projectPath: string): string | null {
  try {
    return readFileSync(
      join(projectPath, ".goat-flow", "config.yaml"),
      "utf-8",
    );
  } catch {
    // A first install scaffolds the file instead of migrating it, so absence is not a migration.
    return null;
  }
}

/**
 * Name every in-place edit this run will make to the user's config, keyed by path.
 * Users cannot verify "this file may change" after the fact, so the row names each edit
 * install will perform: the requested version bump plus any retired block or missing toggle.
 *
 * @param options - parsed user choices carrying the target and any explicit migration flag
 * @param agent - selected agent whose adoption state can derive a version migration
 * @returns path-to-summary entries; empty when this run edits no user-owned file in place
 */
function pendingMigrations(
  options: ParsedCLI,
  agent: AgentId,
): ReadonlyMap<string, string> {
  const configText = readTargetConfigText(options.projectPath);
  // Without an existing config there is nothing to migrate; the seed row already covers creation.
  if (configText === null) return new Map();

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

  // No pending edit means the config row stays a preserved file, not a migration.
  if (edits.length === 0) return new Map();
  return new Map([
    [
      ".goat-flow/config.yaml",
      `Install edits this user-owned file in place to ${edits.join("; ")}. Every other line, comment, and hook choice stays byte-stable.`,
    ],
  ]);
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
