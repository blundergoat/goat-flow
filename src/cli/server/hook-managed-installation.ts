/**
 * Inspect and prepare the hook files behind CLI and dashboard status.
 *
 * Use when a user enables, disables, syncs or reviews a managed hook.
 * Keep file presence, version, trust and provider support distinct so repair guidance describes the actual gap.
 */
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { AUDIT_VERSION } from "../constants.js";
import {
  classifyManagedSetupFile,
  managedSetupChangeDirection,
  type ManagedSetupChangeDirection,
} from "../managed-setup-preview.js";
import { readManagedInstallStateFacade } from "../managed-setup-state.js";
import { hashFile } from "../managed-setup-write-set.js";
import { getTemplatePath } from "../paths.js";
import type { AgentId, AgentProfile } from "../types.js";
import { projectIsAheadOfCli } from "../version-compare.js";
import { listHookSpecs, type HookSpec } from "./hooks-registry.js";
import type { PreparedHookChange } from "./hook-operation.js";

const LEGACY_AGENT_HOOK_DIRECTORIES: Record<AgentId, string> = {
  claude: ".claude/hooks",
  codex: ".codex/hooks",
  antigravity: ".agents/hooks",
  copilot: ".github/hooks",
};
const LEGACY_DENY_DANGEROUS_SCRIPT_NAMES = [
  "guard-common.sh",
  "guard-destructive-shell.sh",
  "guard-secret-paths.sh",
  "guard-repository-writes.sh",
  "guardrails-self-test.sh",
  "deny-dangerous.self-test.sh",
];

/** File-level replacement evidence shown when Sync or Enable needs the user's decision. */
export interface HookReplacementConflict {
  path: string;
  hookIds: string[];
  reason: "diverged" | "unclassified";
}

/** Structured repair information shared by the Hooks page and CLI diagnostics. */
export interface HookChangeFailure {
  code:
    | "hook-replacement-required"
    | "hook-review-stale"
    | "hook-change-refused"
    | "hook-apply-failed"
    | "hook-claim-release-failed";
  paths: string[];
  hookIds: string[];
  replacementAvailable: boolean;
  confirmationIdentity?: string;
  conflicts?: HookReplacementConflict[];
  changedPaths?: string[];
  recovery?: string;
}

/**
 * Carries an HTTP-safe hook setup failure to CLI and dashboard callers.
 *
 * Use when user input or installed state makes a managed change unsafe.
 * The status code lets each UI preserve the same repair outcome.
 */
export class HookManagedInstallationError extends Error {
  /**
   * Create a setup error the active UI can translate without parsing text.
   *
   * @param message - user-facing failure; empty text would leave the repair unexplained
   *
   * @param statusCode - HTTP-style status; zero would not identify a usable response class
   * @param details - optional file-level repair evidence; omitted for existing validation errors
   */
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly details?: HookChangeFailure,
  ) {
    super(message);
    this.name = "HookManagedInstallationError";
  }
}

/** Managed file facts used to explain presence, version, and trust separately. */
export interface ManagedHookInstallationFacts {
  hasAllRequiredFiles: boolean;
  hasCurrentRequiredFiles: boolean;
  hasTrustedRequiredFiles: boolean;
  changeDirection: ManagedSetupChangeDirection;
  changedPaths: string[];
}

/** One installed hook file and the bundled source users expect it to match. */
interface ManagedHookFileContract {
  installedPath: string;
  templatePath: string;
}

/** Convert one managed destination into the portable path stored in install state. */
function managedHookRelativePath(
  projectPath: string,
  managedHookFile: ManagedHookFileContract,
): string {
  return relative(projectPath, managedHookFile.installedPath).replaceAll(
    "\\",
    "/",
  );
}

/**
 * Derive one hook file's repair direction from the canonical managed-file classifier.
 * Use after existence checks; unreadable evidence remains unclassified and never authorizes sync.
 *
 * @param projectPath - selected project used to derive the baseline's relative path
 * @param managedHookFile - installed/template pair whose exact bytes are compared
 *
 * @param expectedHashes - canonical path-keyed prior hashes; a missing row keeps differing bytes unclassified
 * @returns shared repair direction; unreadable files return unclassified
 *
 * @throws Never; filesystem read failures are converted into unclassified evidence
 */
function managedHookFileDirection(
  projectPath: string,
  managedHookFile: ManagedHookFileContract,
  expectedHashes: ReadonlyMap<string, string>,
): ManagedSetupChangeDirection {
  const managedPath = managedHookRelativePath(projectPath, managedHookFile);
  try {
    const currentSha256 = hashFile(managedHookFile.installedPath);
    const newExpectedSha256 = hashFile(managedHookFile.templatePath);
    // One canonical row owns the comparison even when retained per-agent evidence disagrees.
    const oldExpectedSha256 = expectedHashes.get(managedPath) ?? null;
    const state = classifyManagedSetupFile({
      oldExpectedSha256,
      currentSha256,
      newExpectedSha256,
    });
    return managedSetupChangeDirection(state);
  } catch {
    // For example, permissions may change between the existence check and the byte read.
    return "unclassified";
  }
}

/** Collapse per-file direction without allowing one unknown or diverged path to look sync-safe. */
function managedHookChangeDirection(
  directions: readonly ManagedSetupChangeDirection[],
): ManagedSetupChangeDirection {
  // Any locally changed dependency makes the hook require replacement review.
  if (directions.includes("diverged")) return "diverged";
  // Unknown history cannot become safe overwrite permission because a sibling file is current.
  if (directions.includes("unclassified")) return "unclassified";
  // A pristine older dependency needs the bundled refresh even when other files already match.
  if (directions.includes("behind")) return "behind";
  return "current";
}

type AgentProfilePathKey =
  | "instructionFile"
  | "skillsDir"
  | "settingsFile"
  | "hookConfigFile"
  | "hooksDir";

/**
 * Detect a relative path that leaves the project the user selected.
 * Use for both lexical and physical containment checks.
 *
 * @param pathFromProject - relative path; empty means the project root itself
 * @returns true for parent traversal or an absolute path; false for descendants and root
 */
function relativePathLeavesSelectedProject(pathFromProject: string): boolean {
  // Parent traversal and absolute paths can resolve outside the user's selected project.
  return (
    pathFromProject === ".." ||
    pathFromProject.startsWith(`..${String.fromCharCode(47)}`) ||
    pathFromProject.startsWith(`..${String.fromCharCode(92)}`) ||
    isAbsolute(pathFromProject)
  );
}

/**
 * Refuse a managed write outside the project selected by the user.
 * Use before setup derives any destination from agent metadata.
 *
 * @param projectPath - selected project root used to check destination containment
 * @param targetPath - registry-derived destination checked against the selected project
 *
 * @returns nothing; a safe target continues, while an escape throws a 400 registrar error
 */
function assertWithinProject(projectPath: string, targetPath: string): void {
  const selectedProjectPath = resolve(projectPath);
  const managedTargetPath = resolve(targetPath);
  const targetPathFromProject = relative(
    selectedProjectPath,
    managedTargetPath,
  );

  // A descendant stays inside the project, so setup may continue for the user.
  if (
    targetPathFromProject === "" ||
    !relativePathLeavesSelectedProject(targetPathFromProject)
  ) {
    return;
  }

  throw new HookManagedInstallationError(
    "Refusing to write outside project path",
    400,
  );
}

/**
 * Resolve one managed hook file inside the agent folder shown in setup.
 * Use whenever status or sync needs the same installed path; it throws for an agent with no hook surface rather than inventing a location.
 *
 * @param projectPath - selected project used to locate the provider's managed files
 * @param agent - selected agent profile; a null hook directory means that agent has no hook surface
 *
 * @param hookScriptName - registry filename joined to the provider's managed hook directory
 * @returns absolute or project-relative target path; never empty for a hook-capable agent
 */
function installedHookTarget(
  projectPath: string,
  agent: AgentProfile,
  hookScriptName: string,
): string {
  // An agent without a hook folder cannot produce a runnable file for the user.
  if (!agent.hooksDir) throw new Error(`${agent.id} has no hooks dir`);

  const installedHookPath = join(projectPath, agent.hooksDir, hookScriptName);
  assertWithinProject(projectPath, installedHookPath);
  return installedHookPath;
}

/**
 * List every installed/template pair required for one current hook.
 * Use when a Hooks screen checks completeness, version, and trust together.
 *
 * @param projectPath - selected project whose installed dependencies are compared with the bundle
 * @param agent - selected agent; an absent hook directory makes target resolution fail
 *
 * @param hookSpec - registry contract; an empty script list produces no current install
 * @returns managed file pairs; empty means the registry declared no runnable files
 */
function managedHookFileContracts(
  projectPath: string,
  agent: AgentProfile,
  hookSpec: HookSpec,
): ManagedHookFileContract[] {
  // Every registry script must match the bundled bytes before the UI reports current.
  const managedHookFiles = hookSpec.scriptFiles.map((hookScriptName) => ({
    installedPath: installedHookTarget(projectPath, agent, hookScriptName),
    templatePath: getTemplatePath(`workflow/hooks/${hookScriptName}`),
  }));

  return managedHookFiles;
}

/**
 * Check every path segment before the UI treats a managed file as safe to run.
 * Use after lexical containment so linked or non-directory parents remain untrusted.
 *
 * @param selectedProjectPath - physical project root used to validate each descendant
 * @param managedPathParts - descendant segments; empty input cannot identify a file
 *
 * @returns true only when parents are real directories and the final file is regular and unshared
 */
function managedPathEntriesAreTrusted(
  selectedProjectPath: string,
  managedPathParts: string[],
): boolean {
  let inspectedManagedPath = selectedProjectPath;
  // Every segment must remain real so the user's hook cannot escape through a link.
  for (const [pathPartIndex, managedPathPart] of managedPathParts.entries()) {
    inspectedManagedPath = join(inspectedManagedPath, managedPathPart);
    const inspectedManagedEntry = lstatSync(inspectedManagedPath);
    // A linked segment can redirect execution away from the selected project.
    if (inspectedManagedEntry.isSymbolicLink()) return false;
    const isFinalManagedPathPart =
      pathPartIndex === managedPathParts.length - 1;
    // The runnable file must be regular and unshared before the UI calls it trusted.
    if (isFinalManagedPathPart) {
      return (
        inspectedManagedEntry.isFile() && inspectedManagedEntry.nlink === 1
      );
    }
    // Parent segments remain directories until setup reaches the hook file.
    if (!inspectedManagedEntry.isDirectory()) return false;
  }
  return false;
}

/**
 * Verify one managed file and its parents use the launcher's trusted shape.
 * Use before a status screen presents installed bytes as safe to execute; it reports every doubtful case as untrusted rather than throwing.
 *
 * @param projectPath - selected project root; a symlink at that root is untrusted
 * @param managedFilePath - installed hook/config file; missing or empty paths are untrusted
 *
 * @returns true only for one regular file under real directories; false covers missing or redirected paths
 */
export function managedFileIsTrusted(
  projectPath: string,
  managedFilePath: string,
): boolean {
  const selectedProjectPath = resolve(projectPath);
  const installedManagedFilePath = resolve(managedFilePath);
  const managedPathFromProject = relative(
    selectedProjectPath,
    installedManagedFilePath,
  );

  // A path outside the selected project cannot become trusted user protection.
  if (
    managedPathFromProject === "" ||
    relativePathLeavesSelectedProject(managedPathFromProject)
  ) {
    return false;
  }

  try {
    const projectDirectoryEntry = lstatSync(selectedProjectPath);
    // A redirected or non-directory root cannot safely own the selected hook.
    if (
      projectDirectoryEntry.isSymbolicLink() ||
      !projectDirectoryEntry.isDirectory()
    ) {
      return false;
    }

    const managedPathParts = managedPathFromProject.split(/[\\/]+/u);
    // Every parent must be real so a later segment cannot escape through a link.
    if (!managedPathEntriesAreTrusted(selectedProjectPath, managedPathParts)) {
      return false;
    }

    const physicalManagedFilePath = realpathSync(installedManagedFilePath);
    const physicalPathFromProject = relative(
      realpathSync(selectedProjectPath),
      physicalManagedFilePath,
    );
    // Empty or escaping physical paths cannot represent a managed file below the selected root.
    return (
      physicalPathFromProject !== "" &&
      !relativePathLeavesSelectedProject(physicalPathFromProject)
    );
  } catch {
    // For example, the user removed a hook while the Hooks screen was loading.
    return false;
  }
}

/** One file snapshot reused by both policies and every provider during a single read. */
interface ManagedHookFileFacts {
  exists: boolean;
  direction: ManagedSetupChangeDirection;
  trusted: boolean;
}

/** Operation-local inspection state; never retain this across writes or status requests. */
export interface ManagedHookInspection {
  expectedHashes: ReadonlyMap<string, string>;
  files: Map<string, ManagedHookFileFacts>;
}

/**
 * Read the installed baseline once before inspecting shared dependencies for one request.
 *
 * @param projectPath - selected target whose prior install hashes seed the inspection
 * @returns empty file cache and prior hashes; discard this state after any write or request
 */
export function createManagedHookInspection(
  projectPath: string,
): ManagedHookInspection {
  return {
    expectedHashes: readManagedInstallStateFacade(projectPath).expectedHashes,
    files: new Map(),
  };
}

/**
 * Classify one hook using an operation-local snapshot of each required path.
 * Shared files are read once across sibling hooks and providers; a new operation gets fresh facts.
 *
 * @param projectPath - selected checkout whose installed paths are inspected
 * @param agent - provider supplying the managed hook directory
 *
 * @param hookSpec - registry contract declaring every file this hook requires
 * @param inspection - cache shared only within this read operation; omission starts a fresh inspection
 *
 * @returns separate presence, currency, trust and repair-direction facts for the complete dependency set
 */
export function managedHookInstallationFacts(
  projectPath: string,
  agent: AgentProfile,
  hookSpec: HookSpec,
  inspection: ManagedHookInspection = createManagedHookInspection(projectPath),
): ManagedHookInstallationFacts {
  const managedHookFiles = managedHookFileContracts(
    projectPath,
    agent,
    hookSpec,
  );
  const fileFacts = managedHookFiles.map((file) => {
    const cached = inspection.files.get(file.installedPath);
    // Reuse the same dependency evidence across hook rows in this status request.
    if (cached) return cached;
    const exists = existsSync(file.installedPath);
    const facts: ManagedHookFileFacts = {
      exists,
      direction: exists
        ? managedHookFileDirection(projectPath, file, inspection.expectedHashes)
        : "unclassified",
      trusted: exists && managedFileIsTrusted(projectPath, file.installedPath),
    };
    inspection.files.set(file.installedPath, facts);
    return facts;
  });
  return {
    hasAllRequiredFiles:
      fileFacts.length > 0 && fileFacts.every((file) => file.exists),
    hasCurrentRequiredFiles:
      fileFacts.length > 0 &&
      fileFacts.every((file) => file.direction === "current"),
    hasTrustedRequiredFiles:
      fileFacts.length > 0 && fileFacts.every((file) => file.trusted),
    changeDirection: managedHookChangeDirection(
      fileFacts.map((file) => file.direction),
    ),
    changedPaths: managedHookFiles.flatMap((file, index) =>
      fileFacts[index]?.direction === "current"
        ? []
        : [managedHookRelativePath(projectPath, file)],
    ),
  };
}

/**
 * Check whether one profile path identifies only the selected agent.
 * Use before shared instruction or skill paths count as an installed hook surface.
 *
 * @param agentProfiles - known agents; empty means no path can be unique
 * @param profilePathKey - profile field compared across agents
 *
 * @param profilePath - candidate marker; null or empty means no installed marker
 * @returns true when exactly one agent owns the path; false for absent or shared paths
 */
function profilePathIsUnique(
  agentProfiles: AgentProfile[],
  profilePathKey: AgentProfilePathKey,
  profilePath: string | null,
): boolean {
  // An absent marker tells users nothing about which agent is installed.
  if (!profilePath) return false;

  // Compare every profile so shared AGENTS.md-style paths do not scaffold agents.
  return (
    agentProfiles.filter(
      (agentProfile) => agentProfile[profilePathKey] === profilePath,
    ).length === 1
  );
}

/**
 * Detect whether the selected project already contains one agent's own surface.
 * Use before sync writes hook files, so untouched agents are never scaffolded.
 *
 * @param projectPath - selected project inspected for provider-owned installation markers
 * @param agent - candidate agent profile
 *
 * @param agentProfiles - all profiles used to exclude shared markers; empty leaves only explicit config paths
 * @returns true when an agent-owned marker exists; false means setup leaves that agent untouched
 */
function agentInstalledSurfaceExists(
  projectPath: string,
  agent: AgentProfile,
  agentProfiles: AgentProfile[],
): boolean {
  const uniqueOptionalMarkers = [
    profilePathIsUnique(agentProfiles, "instructionFile", agent.instructionFile)
      ? agent.instructionFile
      : null,
    profilePathIsUnique(agentProfiles, "skillsDir", agent.skillsDir)
      ? agent.skillsDir
      : null,
  ];
  const installedSurfaceMarkers = [
    agent.settingsFile,
    agent.hookConfigFile,
    profilePathIsUnique(agentProfiles, "hooksDir", agent.hooksDir)
      ? agent.hooksDir
      : null,
    ...uniqueOptionalMarkers,
  ].filter(
    (installedSurfaceMarker): installedSurfaceMarker is string =>
      typeof installedSurfaceMarker === "string",
  );

  // Any agent-owned marker means sync may repair that user's existing surface.
  return installedSurfaceMarkers.some((installedSurfaceMarker) =>
    existsSync(join(projectPath, installedSurfaceMarker)),
  );
}

/**
 * Detect managed script residue even when the agent's config marker is gone.
 * Use during upgrades so stale Goat Flow files can be pruned without scaffolding.
 *
 * @param projectPath - selected project inspected for current or retired managed scripts
 * @param agent - candidate agent profile; a null hook directory skips its current path
 *
 * @param hookSpec - registry hook whose declared or retired filenames can identify managed residue
 * @param agentProfiles - all profiles used to avoid shared-directory false positives
 *
 * @returns true when this agent's current or legacy managed files exist; false means its scripts provide no installation evidence
 */
function hookScriptResidueExists(
  projectPath: string,
  agent: AgentProfile,
  hookSpec: HookSpec,
  agentProfiles: AgentProfile[],
): boolean {
  const managedScriptNames =
    hookSpec.id === "deny-dangerous"
      ? [...hookSpec.scriptFiles, ...LEGACY_DENY_DANGEROUS_SCRIPT_NAMES]
      : hookSpec.scriptFiles;

  // An agent-owned current hook folder with managed bytes is an upgrade surface.
  if (
    agent.hooksDir &&
    profilePathIsUnique(agentProfiles, "hooksDir", agent.hooksDir) &&
    managedScriptNames.some((hookScriptName) =>
      existsSync(installedHookTarget(projectPath, agent, hookScriptName)),
    )
  ) {
    return true;
  }

  const legacyHookDirectory = LEGACY_AGENT_HOOK_DIRECTORIES[agent.id];
  // Sync may migrate this provider's old scripts, but another provider's pending cleanup never opts this one in.
  return managedScriptNames.some((hookScriptName) =>
    existsSync(join(projectPath, legacyHookDirectory, hookScriptName)),
  );
}

/**
 * Decide whether sync should touch one agent in the selected project.
 * Use to preserve projects that never installed that agent or hook surface.
 *
 * @param projectPath - selected project whose existing provider files determine whether Sync acts
 * @param agent - candidate agent profile
 *
 * @param hookSpec - registry hook whose current and retired filenames determine whether Sync has work
 * @param agentProfiles - all profiles used to distinguish shared paths
 *
 * @returns true for an installed surface or managed residue; false leaves the agent unchanged
 */
export function shouldReconcileAgent(
  projectPath: string,
  agent: AgentProfile,
  hookSpec: HookSpec,
  agentProfiles: AgentProfile[],
): boolean {
  return (
    agentInstalledSurfaceExists(projectPath, agent, agentProfiles) ||
    hookScriptResidueExists(projectPath, agent, hookSpec, agentProfiles)
  );
}

/**
 * Add one required ignore exception to the prepared Sync result.
 *
 * @param change - admitted snapshots for the selected project
 * @param gitignoreEntry - exact template rule that keeps installed hooks available after clone
 */
function ensureGoatFlowGitignoreEntry(
  change: PreparedHookChange,
  gitignoreEntry: string,
): void {
  const path = ".goat-flow/.gitignore";
  const original = change.readText(path) ?? "";
  const hadFinalNewline = original.length === 0 || original.endsWith("\n");
  const lines = original.split(/\r?\n/u);
  // A trailing newline is not a user rule and must not create a duplicate blank entry.
  if (lines.at(-1) === "") lines.pop();
  // Healthy projects retain their exact ignore-file bytes.
  if (lines.includes(gitignoreEntry)) return;
  const next = `${lines.join("\n")}${lines.length > 0 ? "\n" : ""}${gitignoreEntry}\n`;
  change.replaceText(path, hadFinalNewline ? next : next.trimEnd());
}

/** Preserve the template's exact ignore spelling so copied hooks remain available after the project is cloned. */
function ensureHookGitignoreEntries(change: PreparedHookChange): void {
  ensureGoatFlowGitignoreEntry(change, "!hooks/");
  ensureGoatFlowGitignoreEntry(change, "!**/hooks/**");
}

/** Queue exact legacy names so an upgrade removes old launchers only after current files are ready. */
function removeLegacyAgentHookScripts(
  change: PreparedHookChange,
  hookSpec: HookSpec,
): void {
  const legacyNames = [
    ...hookSpec.scriptFiles,
    ...(hookSpec.id === "deny-dangerous"
      ? LEGACY_DENY_DANGEROUS_SCRIPT_NAMES
      : []),
  ];
  // Every former provider folder can contain an owned copy, even when that provider is no longer installed.
  for (const legacyDirectory of Object.values(LEGACY_AGENT_HOOK_DIRECTORIES)) {
    // Cleanup never expands to a wildcard or a user-authored hook name.
    for (const scriptName of legacyNames)
      change.removeOwned(`${legacyDirectory}/${scriptName}`);
  }
}

/** Read the running CLI's bundled hook bytes; Sync never downloads or upgrades a package. */
function hookScriptContent(hookScriptName: string): string {
  return readFileSync(
    getTemplatePath(`workflow/hooks/${hookScriptName}`),
    "utf-8",
  );
}

/**
 * Check whether a hook stamp requires a newer CLI before Sync prepares replacement.
 * Read failures return false here; the guarded operation separately refuses unsafe or unreadable destination evidence.
 *
 * @param installedHookPath - hook about to be replaced; empty or missing paths are not newer
 *
 * @returns true when the installed stamp is ahead; false includes missing, unreadable, or unstamped files
 * @throws Never; unreadable or unstamped files return false, while guarded Sync separately validates readable destination evidence
 */
function installedHookIsNewer(installedHookPath: string): boolean {
  // Nothing is installed yet, so the user's first install has no newer bytes to protect.
  if (!existsSync(installedHookPath)) return false;

  let installedHookContent: string;
  try {
    installedHookContent = readFileSync(installedHookPath, "utf-8");
  } catch {
    // For example, the user selected a checkout whose hook file they cannot read.
    return false;
  }

  const installedVersionMatch = installedHookContent.match(
    /goat-flow-hook-version:\s*([0-9]+\.[0-9]+\.[0-9]+)/,
  );
  // A hand-written or pre-stamp hook cannot prove it is newer than this release.
  if (!installedVersionMatch?.[1]) return false;

  return projectIsAheadOfCli(installedVersionMatch[1], AUDIT_VERSION);
}

/**
 * Refuse newer runtime bytes before registration or config migration can write anything.
 *
 * @param projectPath - selected target whose installed version stamps are checked
 * @param agent - provider supplying the managed hook directory
 *
 * @param spec - registry contract supplying the files this change could replace
 * @throws HookManagedInstallationError when an installed runtime stamp is newer than this CLI
 */
function assertNoNewerManagedHookFiles(
  projectPath: string,
  agent: AgentProfile,
  spec: HookSpec,
): void {
  // Check every declared dependency before a newer file can follow an earlier config or script change.
  for (const file of managedHookFileContracts(projectPath, agent, spec)) {
    // The user needs a matching CLI version; replacement approval cannot authorize a downgrade.
    if (installedHookIsNewer(file.installedPath)) {
      throw new HookManagedInstallationError(
        `Refusing to overwrite ${file.installedPath}: the installed hook is newer than this CLI (${AUDIT_VERSION}). Re-run with a matching goat-flow release instead of downgrading the guardrail.`,
        409,
      );
    }
  }
}

/**
 * Queue bundled copies while keeping existing disabled-only files inert and unchanged.
 *
 * @param change - prepared operation that owns complete admission and eventual writes
 * @param agent - reconciled provider with a registry-owned hook directory
 *
 * @param hookSpec - selected hook's complete dependency set
 * @param shouldOverwriteExisting - false fills only missing files for a disabled hook
 */
function copyDeclaredHookScripts(
  change: PreparedHookChange,
  agent: AgentProfile,
  hookSpec: HookSpec,
  shouldOverwriteExisting: boolean,
): void {
  // Shared dependencies name every affected hook so confirmation and the refreshed dashboard rows agree.
  for (const scriptName of hookSpec.scriptFiles) {
    const installedPath = installedHookTarget(
      change.projectPath,
      agent,
      scriptName,
    );
    const path = relative(change.projectPath, installedPath)
      .split(String.fromCharCode(92))
      .join("/");
    const hookIds = listHookSpecs()
      .filter((spec) => spec.scriptFiles.includes(scriptName))
      .map((spec) => spec.id);
    change.copyOfficial(
      path,
      hookScriptContent(scriptName),
      hookIds,
      shouldOverwriteExisting,
    );
  }
}

/**
 * Prepare current files, ignore exceptions, and exact legacy cleanup for one supported provider.
 *
 * @param change - selected project's pending operation; no destinations change until admission completes
 * @param agent - provider profile; a missing hook directory leaves it untouched
 *
 * @param hookSpec - selected registry hook and its shared dependencies
 * @param shouldOverwriteExisting - false preserves existing disabled-only files
 *
 * @throws HookManagedInstallationError when an unsafe or newer target prevents replacement
 */
export function copyHookScripts(
  change: PreparedHookChange,
  agent: AgentProfile,
  hookSpec: HookSpec,
  shouldOverwriteExisting = true,
): void {
  // A provider with no hook surface cannot receive managed scripts.
  if (!agent.hooksDir) return;
  // Retain the version guard beside copy preparation; replacement confirmation never authorizes a downgrade.
  if (shouldOverwriteExisting)
    assertNoNewerManagedHookFiles(change.projectPath, agent, hookSpec);
  copyDeclaredHookScripts(change, agent, hookSpec, shouldOverwriteExisting);
  ensureHookGitignoreEntries(change);
  // The current deny hook also replaces exact names left by older split policies.
  if (hookSpec.id === "deny-dangerous") {
    // Only exact retired split-policy filenames are scheduled for removal.
    for (const legacyName of LEGACY_DENY_DANGEROUS_SCRIPT_NAMES)
      change.removeOwned(`${agent.hooksDir}/${legacyName}`);
  }
  removeLegacyAgentHookScripts(change, hookSpec);
}

/**
 * Prepare removal of a retired hook while preserving all user-owned commands and files.
 *
 * @param change - selected project operation that will claim each removal target
 *
 * @param agent - profile supplying the current hook directory
 * @param hookSpec - registry-owned tombstone; active disabled hooks do not use this removal path
 */
export function removeHookScripts(
  change: PreparedHookChange,
  agent: AgentProfile,
  hookSpec: HookSpec,
): void {
  // A provider without a current hook directory may still have legacy copies in the known former locations.
  if (agent.hooksDir)
    change.removeOwned(`${agent.hooksDir}/${hookSpec.primaryScript}`);
  removeLegacyAgentHookScripts(change, hookSpec);
}
