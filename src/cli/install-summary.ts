/**
 * Describe completed install changes using the admitted preview and observed registrations.
 * Build the closing text after verification while claims are held; the caller prints it only after successful claim release.
 */
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentProfile, getAgentProfiles } from "./agents/registry.js";
import { DECISIONS_README_PATH } from "./decisions-readme-transfer.js";
import { quoteManagedInstallProjectArgument } from "./managed-install-evidence.js";
import { retiredRuntimeReferences } from "./installer/retired-runtime.js";
import {
  isUserOwnedPlaybook,
  keptRetiredFileAdvice,
  RETIRED_PATHS,
  RETIRED_RUNTIME_PATHS,
} from "./retired-paths.js";
import type { ManagedSetupPreview } from "./managed-setup-preview.js";
import { readManagedTargetEvidence } from "./managed-setup-write-set.js";
import { getPackageVersion } from "./paths.js";
import {
  readAgentHookState,
  type AgentHookReadState,
} from "./server/agent-hook-writer.js";
import { readAllHookStates } from "./server/hook-registrar.js";
import { listHookSpecs, type HookSpec } from "./server/hooks-registry.js";
import type { AgentId } from "./types.js";
import { BATCH_HOOK_SCENARIOS } from "./cli-types.js";
import { HOOK_VERIFICATION_CONTRACTS } from "./hook-verification-contracts.js";
import { PINNED_GOAT_FLOW_INVOCATION } from "./advised-command.js";

/** Existing registration state for a hook in one admitted provider config. */
export interface InstallHookObservation {
  agent: AgentId;
  spec: HookSpec;
  state: AgentHookReadState;
}

/**
 * Classify the one config edit needed to reach desired registration state.
 * Missing or invalid configs stay outside migration because setup either seeds or preserves them.
 *
 * @param current - saved registration inspected before apply; missing or invalid configs have no migration row
 * @param shouldRegister - desired registration presence from the preview or observed result
 * @returns the required edit, or null when this existing registration needs no migration
 */
export function hookRegistrationEdit(
  current: AgentHookReadState,
  shouldRegister: boolean,
): "restore" | "repair" | "remove" | null {
  // Missing or invalid provider config cannot supply an existing registration to edit.
  if (current.configMissing || current.configInvalid) return null;
  // A matching current registration already has the desired presence, including an inert disabled policy.
  if (shouldRegister && current.installed) return null;
  // A desired registration needs restoration when absent, or repair when its existing row has drifted.
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

/**
 * Read registrations before apply, limited to configs already in the admitted write set.
 *
 * @param projectPath - target whose write claims are held before installation
 * @param preview - admitted file rows; providers outside these config paths are excluded
 * @returns prior registry readings for supported hooks; empty means no hook config is admitted
 */
export function observeInstallHookRegistrations(
  projectPath: string,
  preview: ManagedSetupPreview,
): InstallHookObservation[] {
  return getAgentProfiles().flatMap((profile) => {
    // Unselected providers without an admitted config path cannot contribute an install change.
    if (!preview.files.some((file) => file.path === profile.hookConfigFile))
      return [];
    return listHookSpecs()
      .filter((spec) => spec.unsupportedAgents?.[profile.id] === undefined)
      .map((spec) => ({
        agent: profile.id,
        spec,
        state: readAgentHookState(projectPath, profile, spec),
      }));
  });
}

/**
 * Read each previewed regular file's permission bits before apply, so the summary can name files whose mode changed while their bytes did not.
 *
 * @param projectPath - target whose write claims are held before installation
 * @param preview - admitted rows; only files that were regular before apply are read
 * @returns path to permission bits; a file that was missing or unsafe before apply has no entry
 */
export function observeInstallFileModes(
  projectPath: string,
  preview: ManagedSetupPreview,
): Map<string, number> {
  const modes = new Map<string, number>();
  for (const file of preview.files) {
    // Only a file that already existed can keep its bytes and change only its mode.
    if (file.currentStatus !== "regular") continue;
    const stats = lstatSync(join(projectPath, file.path), {
      throwIfNoEntry: false,
    });
    if (stats?.isFile()) modes.set(file.path, stats.mode & 0o777);
  }
  return modes;
}

/**
 * Name files whose permission bits changed while their bytes stayed the same, so a mode-only Git change is explained.
 *
 * @param projectPath - installed project root
 * @param unchanged - previewed paths whose bytes match their pre-install hash
 * @param modesBefore - permission bits read before apply
 * @returns a heading and one `path: old -> new` line per changed mode; empty when no mode changed
 */
function modeOnlyChangeLines(
  projectPath: string,
  unchanged: readonly string[],
  modesBefore: ReadonlyMap<string, number>,
): string[] {
  const changes = unchanged.flatMap((path) => {
    const before = modesBefore.get(path);
    if (before === undefined) return [];
    try {
      const stats = lstatSync(join(projectPath, path), {
        throwIfNoEntry: false,
      });
      if (!stats?.isFile()) return [];
      const after = stats.mode & 0o777;
      return before === after
        ? []
        : [`  ${path}: ${before.toString(8)} -> ${after.toString(8)}`];
    } catch {
      // A mode observation is advisory after the install receipt has been saved.
      return [];
    }
  });
  return changes.length > 0
    ? ["File modes changed (content unchanged):", ...changes]
    : [];
}

/**
 * List removed paths Git still tracks, so the user stages the deletions before a commit or a `git ls-files` check sees them.
 *
 * Error behavior: throws nothing; outside a repository, or when Git cannot run, nothing is reported as tracked.
 *
 * @param projectPath - installed project root
 * @param removedPaths - previewed paths install deleted
 * @returns a heading and one line per tracked path; empty when none is tracked
 */
function trackedRemovalLines(
  projectPath: string,
  removedPaths: readonly string[],
): string[] {
  // Nothing removed means there is nothing to ask Git about.
  if (removedPaths.length === 0) return [];
  let tracked: string[];
  try {
    // Literal pathspecs match only the named paths, and fsmonitor stays off so the target repository's configured command never runs.
    tracked = execFileSync(
      "git",
      [
        "--literal-pathspecs",
        "-c",
        "core.fsmonitor=false",
        "-C",
        projectPath,
        "ls-files",
        "-z",
        "--",
        ...removedPaths,
      ],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 },
    ).split("\0");
  } catch {
    // Outside a repository, or with Git unavailable, no deletion needs staging.
    return [];
  }
  const removedTracked = removedPaths.filter((path) => tracked.includes(path));
  return removedTracked.length > 0
    ? [
        "Tracked files removed (stage the deletions before you commit):",
        ...removedTracked.map((path) => `  ${path}`),
      ]
    : [];
}

/**
 * Recommend the hook verify runs that can pass on a correct install.
 *
 * One all-groups run passes only when every group has a registered hook; a group with none reports not-configured and fails it.
 *
 * @param projectPath - installed project whose registrations are read after apply
 * @param agent - agent just installed
 * @param command - pinned `hooks verify` prefix, without the scenario flag
 * @returns the trust reminder, a line naming the unregistered groups when per-group runs replace the all-groups run, and one command
 *   per run; empty when the agent has no hook config or no registered hook
 */
function runtimeVerifyLines(
  projectPath: string,
  agent: AgentId,
  command: string,
): string[] {
  // Only hook-capable providers receive a runtime command.
  if (getAgentProfile(agent).hookConfigFile === null) return [];
  const registered = new Set(
    readAllHookStates(projectPath)
      .filter((hook) => hook.agents[agent].installed)
      .map((hook) => hook.id),
  );
  const groups = BATCH_HOOK_SCENARIOS.filter((group) =>
    registered.has(HOOK_VERIFICATION_CONTRACTS[group].hookId),
  );
  // With no registered hook there is nothing a runtime check could pass.
  if (groups.length === 0) return [];
  const isComplete = groups.length === BATCH_HOOK_SCENARIOS.length;
  return [
    "Inspect and trust the hook configuration before runtime verification. Disabled hooks stay disabled.",
    // Name why the list replaces one all-groups run, so the user does not add back a run that cannot pass.
    ...(isComplete
      ? []
      : [
          `One run per registered hook: ${agent} has no registered hook for ${BATCH_HOOK_SCENARIOS.filter((group) => !groups.includes(group)).join(", ")}, so an all-groups run cannot pass.`,
        ]),
    ...(isComplete ? ["all"] : groups).map(
      (scenario) => `  ${command} --scenario ${scenario}`,
    ),
  ];
}

/** Compare observed registrations; a disabled choice alone never proves removal. */
function completedHookChanges(
  projectPath: string,
  observations: readonly InstallHookObservation[],
): string[] {
  const states = new Map(
    readAllHookStates(projectPath).map((state) => [state.id, state]),
  );
  return observations.flatMap(({ agent, spec, state: before }) => {
    const after = readAgentHookState(projectPath, getAgentProfile(agent), spec);
    const label = `${agent}/${spec.id}`;
    // New or repaired registrations must match the registry's exact expected form after apply.
    if (after.installed && !before.installed) {
      const edit = hookRegistrationEdit(before, true);
      return [`  ${label} ${edit === "repair" ? "repaired" : "registered"}`];
    }
    // Missing registrations count as removals only when an owned row existed before apply.
    if (
      after.registrationIssue === "registration-missing" &&
      !after.configMissing &&
      !after.configInvalid &&
      hookRegistrationEdit(before, false) === "remove"
    ) {
      const reason =
        states.get(spec.id)?.enabled === false ? "disabled" : "not eligible";
      return [`  ${label} removed (${reason})`];
    }
    return [];
  });
}

/**
 * Lead the summary with the permission changes install made, whenever a deny rule was removed or narrowed, because a weakened
 * protection is the change a user most needs to see.
 *
 * @param permissionChanges - lines of the form `<settings path>: <change>`, read before install ran
 * @returns the block's lines; empty when no rule was removed
 */
function permissionChangeBlock(permissionChanges: readonly string[]): string[] {
  // Only a removal weakens a protection (narrowing shows as removing the broad rule); additions and rewrites stay in the install log.
  if (!permissionChanges.some((line) => /: - /u.test(line))) return [];
  return [
    "Permission changes (deny rules removed or narrowed):",
    ...permissionChanges.map((line) => `  ${line}`),
  ];
}

/**
 * Describe old goat-flow files install left on disk: retired hook files other providers still run, and files kept as edited or unrecorded.
 *
 * @param projectPath - installed project root
 * @param installCommand - pinned install command for this project, without the agent flag
 * @param installedAgent - agent this install just verified; its own config cannot be fixed by rerunning
 * @returns summary lines; empty when cleanup is complete
 */
function retiredFileLines(
  projectPath: string,
  installCommand: string,
  installedAgent: AgentId,
): string[] {
  const lines: string[] = [];
  const pendingRuntime = retiredRuntimeReferences(projectPath);
  // Other provider configs still name the retired runtime, so list each with the install that moves it off. The agent just installed
  // is different: rerunning cannot help, so its line says to repair the config by hand.
  if (pendingRuntime.length > 0)
    lines.push(
      "Runtime cleanup pending: retired hook files stay until each provider below is installed with this release.",
      ...pendingRuntime.map((reference) =>
        reference.agent === installedAgent
          ? `  ${reference.path}: this install could not move it off the retired hooks. Check that it is valid JSON and names no old hook file, then rerun.`
          : `  ${reference.path}: ${installCommand} --agent ${reference.agent}`,
      ),
    );
  const keptOldFiles = keptRetiredFiles(projectPath, pendingRuntime.length > 0);
  // Install kept these because they are edited, unrecorded or linked; each line says what that means and how to finish.
  if (keptOldFiles.length > 0)
    lines.push(
      "Old goat-flow files kept:",
      ...keptOldFiles.map(
        (path) =>
          `  ${path}: ${keptRetiredFileAdvice(path, readManagedTargetEvidence(projectPath, path).status === "regular")}`,
      ),
    );
  return lines;
}

/**
 * List old goat-flow files still on disk after install, other than playbooks the user marked as their own.
 *
 * @param projectPath - installed project root
 * @param isRuntimePending - true while another provider still runs the retired hooks; those files are reported as pending instead
 * @returns retired paths install kept, in table order; empty when cleanup is complete
 */
function keptRetiredFiles(
  projectPath: string,
  isRuntimePending: boolean,
): string[] {
  return RETIRED_PATHS.filter((path) => {
    // Pending runtime files are already listed with the installs that will remove them.
    if (isRuntimePending && RETIRED_RUNTIME_PATHS.includes(path)) return false;
    const evidence = readManagedTargetEvidence(projectPath, path);
    // A removed file needs no review.
    if (evidence.status === "missing") return false;
    // A playbook marked user-owned is the user's by choice, not a leftover.
    return !(
      evidence.status === "regular" &&
      isUserOwnedPlaybook(readFileSync(join(projectPath, path), "utf8"))
    );
  });
}

/**
 * Render actual changed preview paths and remaining checks after managed verification and post-install writes.
 * The caller holds claims while reading these outcomes and must suppress this text if later cleanup fails.
 *
 * @param projectPath - verified target whose file outcomes are read under write claims
 * @param preview - admitted paths and pre-write hashes reused to identify actual changes
 * @param hookObservations - registration readings before apply; empty omits hook-change reporting
 * @param permissionChanges - permission-rule changes read before apply; empty omits the permission block
 * @param modesBefore - permission bits read before apply; empty omits the mode-change block
 * @returns closing text with pinned commands, without running the remaining checks
 */
export function renderInstallSummary(
  projectPath: string,
  preview: ManagedSetupPreview,
  hookObservations: readonly InstallHookObservation[],
  permissionChanges: readonly string[] = [],
  modesBefore: ReadonlyMap<string, number> = new Map(),
): string {
  const outcomes = preview.files.map((file) => ({
    file,
    target: readManagedTargetEvidence(projectPath, file.path),
  }));
  const changed = outcomes.filter(
    ({ file, target }) =>
      target.status === "regular" && target.sha256 !== file.currentSha256,
  );
  const created = changed.filter(
    ({ file }) => file.currentStatus === "missing",
  ).length;
  const removedPaths = outcomes
    .filter(
      ({ file, target }) =>
        file.currentStatus === "regular" && target.status === "missing",
    )
    .map(({ file }) => file.path);
  const preserved = outcomes.filter(
    ({ file, target }) =>
      file.state === "local-preserved" && target.sha256 === file.currentSha256,
  ).length;
  const replaced = changed.filter(
    ({ file }) =>
      file.currentStatus === "regular" &&
      (file.state === "both-changed" ||
        file.state === "unmanaged" ||
        file.authority === "granted-user-owned" ||
        file.authority === "granted-path"),
  );
  const lines = [
    "",
    `Install verified for ${preview.agent} (${getPackageVersion()}).`,
    ...permissionChangeBlock(permissionChanges),
    `Files changed: ${created} created, ${changed.length - created} updated, ${removedPaths.length} removed; ${preserved} local change(s) preserved.`,
    "File counts cover previewed paths; other installer cleanup is reported separately.",
    ...replaced.map(({ file }) => `Replaced local content: ${file.path}`),
    ...trackedRemovalLines(projectPath, removedPaths),
    ...modeOnlyChangeLines(
      projectPath,
      outcomes
        .filter(
          ({ file, target }) =>
            target.status === "regular" && target.sha256 === file.currentSha256,
        )
        .map(({ file }) => file.path),
      modesBefore,
    ),
  ];
  const hookChanges = completedHookChanges(projectPath, hookObservations);
  // The upgrade guide asks for a restart after registrations change, so the summary repeats it where the change happened.
  if (hookChanges.length > 0)
    lines.push(
      "Hook registrations:",
      ...hookChanges,
      "Restart open agent sessions so they load the changed hook registrations.",
    );
  const invocation = PINNED_GOAT_FLOW_INVOCATION;
  const target = quoteManagedInstallProjectArgument(projectPath);
  lines.push(
    ...retiredFileLines(
      projectPath,
      `${invocation} install ${target}`,
      preview.agent,
    ),
  );
  // An inherited guide kept outside the package baseline prevents a fresh full-install receipt.
  if (
    outcomes.some(
      ({ file }) =>
        file.path === DECISIONS_README_PATH &&
        file.state === "local-preserved" &&
        file.oldExpectedSha256 === null,
    )
  ) {
    lines.push(
      `Preserved inherited guide: ${DECISIONS_README_PATH}. No new full-install receipt was recorded.`,
      `To adopt the package guide: ${invocation} install ${target} --agent ${preview.agent} --force-path ${DECISIONS_README_PATH}`,
    );
  }
  lines.push(
    "Remaining review: reconcile preserved local changes, settings and project-specific instructions; audit and runtime checks have not run.",
    `  ${invocation} audit ${target} --agent ${preview.agent}`,
    `  ${invocation} stats ${target} --check`,
  );
  lines.push(
    ...runtimeVerifyLines(
      projectPath,
      preview.agent,
      `${invocation} hooks verify ${target} --agent ${preview.agent} --trusted-target`,
    ),
  );
  return lines.join("\n");
}

/**
 * Print prepared completion only after its caller successfully releases write claims.
 *
 * @param summary - verified closing text; null keeps a failed installer silent here
 */
export function emitInstallSummary(summary: string | null): void {
  if (summary !== null) console.log(summary);
}
