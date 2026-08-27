/**
 * Installs, removes, and inspects the hook files behind CLI and dashboard status.
 *
 * Use when a user enables, disables, syncs, or reviews one managed hook.
 * It keeps filesystem trust and version checks separate from provider support, so local repair guidance reflects the files the selected agent can
 * run.
 */
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  unlinkSync,
} from "node:fs";
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
import type { AgentProfile } from "../types.js";
import { projectIsAheadOfCli } from "../version-compare.js";
import type { HookSpec } from "./hooks-registry.js";
import { writeFileAtomic } from "./safe-exec.js";

const DENY_DANGEROUS_POLICY_FILES = [
  "patterns-shell.sh",
  "patterns-paths.sh",
  "patterns-writes.sh",
  "deny-dangerous-self-test.sh",
];
const LEGACY_AGENT_HOOK_DIRECTORIES = [
  ".claude/hooks",
  ".codex/hooks",
  ".agents/hooks",
  ".github/hooks",
];
const LEGACY_DENY_DANGEROUS_SCRIPT_NAMES = [
  "guard-common.sh",
  "guard-destructive-shell.sh",
  "guard-secret-paths.sh",
  "guard-repository-writes.sh",
  "guardrails-self-test.sh",
  "deny-dangerous.self-test.sh",
];

/**
 * Carries an HTTP-safe hook setup failure to CLI and dashboard callers.
 * Use when user input or installed state makes a managed change unsafe.
 * The status code lets each UI preserve the same repair outcome.
 */
export class HookManagedInstallationError extends Error {
  /**
   * Create a setup error the active UI can translate without parsing text.
   *
   * @param message - user-facing failure; empty text would leave the repair unexplained
   * @param statusCode - HTTP-style status; zero would not identify a usable response class
   */
  constructor(
    message: string,
    public readonly statusCode: number,
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
 * Derive one hook file's repair direction from M02's canonical classifier.
 * Use after existence checks; unreadable evidence remains unclassified and never authorizes sync.
 *
 * @param projectPath - selected project used to derive the baseline's relative path
 * @param managedHookFile - installed/template pair whose exact bytes are compared
 * @param expectedHashes - canonical path-keyed prior hashes; a missing row keeps differing bytes unclassified
 * @returns shared repair direction; unreadable files return unclassified
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
  if (directions.includes("diverged")) return "diverged";
  if (directions.includes("unclassified")) return "unclassified";
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
 * @param projectPath - selected project root; empty text resolves to the process directory and is rejected by callers
 * @param targetPath - proposed managed destination; empty text cannot remain inside a valid project root
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
 * @param projectPath - selected project; empty text cannot identify an owned destination
 * @param agent - selected agent profile; a null hook directory means that agent has no hook surface
 * @param hookScriptName - managed filename; empty text cannot identify an installable script
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
 * @param projectPath - selected project; empty text cannot locate installed files
 * @param agent - selected agent; an absent hook directory makes target resolution fail
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

  // The deny dispatcher also needs its policy store before protection is complete.
  if (hookSpec.id === "deny-dangerous") {
    // Each policy module must match the rules users receive from the same release.
    for (const policyFileName of DENY_DANGEROUS_POLICY_FILES) {
      managedHookFiles.push({
        installedPath: join(
          projectPath,
          ".goat-flow",
          "hooks",
          "deny-dangerous",
          policyFileName,
        ),
        templatePath: getTemplatePath(
          `workflow/hooks/deny-dangerous/${policyFileName}`,
        ),
      });
    }
  }

  return managedHookFiles;
}

/**
 * Check every path segment before the UI treats a managed file as safe to run.
 * Use after lexical containment so linked or non-directory parents remain untrusted.
 * @param selectedProjectPath - real project root; empty text cannot own a managed file
 * @param managedPathParts - descendant segments; empty input cannot identify a file
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
 * @param projectPath - selected project root; empty or redirected roots are untrusted
 * @param managedFilePath - installed hook/config file; missing or empty paths are untrusted
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

/**
 * Classify the files one installed hook needs before users rely on it.
 * Use when CLI, audit, or dashboard builds the local effective-state chain; it reports each gap as a false fact instead of throwing.
 * @param projectPath - selected project; empty text produces missing installation facts
 * @param agent - selected agent; an absent hook surface cannot produce complete facts
 * @param hookSpec - registry contract; an empty script set cannot establish runnable coverage
 * @returns existence, version, and trust facts; each false value names a visible repair state
 */
export function managedHookInstallationFacts(
  projectPath: string,
  agent: AgentProfile,
  hookSpec: HookSpec,
): ManagedHookInstallationFacts {
  const managedHookFiles = managedHookFileContracts(
    projectPath,
    agent,
    hookSpec,
  );
  // A missing file means the user does not yet have a complete runnable hook.
  const hasAllRequiredFiles = managedHookFiles.every((managedHookFile) =>
    existsSync(managedHookFile.installedPath),
  );
  const managedBaseline = readManagedInstallStateFacade(projectPath);
  const fileDirections = managedHookFiles.map((managedHookFile) =>
    existsSync(managedHookFile.installedPath)
      ? managedHookFileDirection(
          projectPath,
          managedHookFile,
          managedBaseline.expectedHashes,
        )
      : "unclassified",
  );
  const changedPaths = managedHookFiles.flatMap((managedHookFile, index) =>
    fileDirections[index] === "current"
      ? []
      : [managedHookRelativePath(projectPath, managedHookFile)],
  );
  // Current bytes matter only after every required file exists.
  const hasCurrentRequiredFiles =
    hasAllRequiredFiles &&
    managedHookFiles.every((managedHookFile) => {
      try {
        return (
          readFileSync(managedHookFile.installedPath, "utf-8") ===
          readFileSync(managedHookFile.templatePath, "utf-8")
        );
      } catch {
        // For example, permissions changed after the user opened the Hooks screen.
        return false;
      }
    });
  // Trust is checked independently so matching bytes behind a link never look safe.
  const hasTrustedRequiredFiles =
    hasAllRequiredFiles &&
    managedHookFiles.every((managedHookFile) =>
      managedFileIsTrusted(projectPath, managedHookFile.installedPath),
    );

  return {
    hasAllRequiredFiles,
    hasCurrentRequiredFiles,
    hasTrustedRequiredFiles,
    changeDirection: managedHookChangeDirection(fileDirections),
    changedPaths,
  };
}

/**
 * Check whether one profile path identifies only the selected agent.
 * Use before shared instruction or skill paths count as an installed hook surface.
 * @param agentProfiles - known agents; empty means no path can be unique
 * @param profilePathKey - profile field compared across agents
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
 * @param projectPath - selected project; empty text cannot contain a valid marker
 * @param agent - candidate agent profile
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
 * @param projectPath - selected project; empty text cannot contain meaningful residue
 * @param agent - candidate agent profile; a null hook directory skips its current path
 * @param hookSpec - managed scripts to find; an empty list produces no residue
 * @param agentProfiles - all profiles used to avoid shared-directory false positives
 * @returns true when current or legacy managed files exist; false means no cleanup is needed
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

  // Legacy per-agent folders may still hold files a normal upgrade must remove.
  return LEGACY_AGENT_HOOK_DIRECTORIES.some((legacyHookDirectory) =>
    managedScriptNames.some((hookScriptName) =>
      existsSync(join(projectPath, legacyHookDirectory, hookScriptName)),
    ),
  );
}

/**
 * Decide whether sync should touch one agent in the selected project.
 * Use to preserve projects that never installed that agent or hook surface.
 * @param projectPath - selected project; empty text has no reconciliable surface
 * @param agent - candidate agent profile
 * @param hookSpec - hook being reconciled; empty scripts leave no residue
 * @param agentProfiles - all profiles used to distinguish shared paths
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
 * Check whether the selected agent already has a hook config to preserve.
 * Use before writing disabled optional-hook state.
 * @param projectPath - selected project; empty text cannot locate config
 * @param agent - selected agent; a null hook config means no writable surface
 * @returns true when the agent config exists; false means disabling creates nothing
 */
export function hookConfigExists(
  projectPath: string,
  agent: AgentProfile,
): boolean {
  return (
    agent.hookConfigFile !== null &&
    existsSync(join(projectPath, agent.hookConfigFile))
  );
}

/**
 * Add one required managed path to the project-local ignore policy.
 * Use while enabling hooks so files needed after clone stay tracked; it writes the project ignore file only when the entry is not already there.
 * @param projectPath - selected project; empty text cannot own a safe ignore file
 * @param gitignoreEntry - exact negation shown in the ignore file; empty text adds no useful rule
 * @returns nothing; an existing entry leaves the file unchanged
 */
function ensureGoatFlowGitignoreEntry(
  projectPath: string,
  gitignoreEntry: string,
): void {
  const goatFlowGitignorePath = join(projectPath, ".goat-flow", ".gitignore");
  assertWithinProject(projectPath, goatFlowGitignorePath);
  mkdirSync(join(projectPath, ".goat-flow"), { recursive: true });

  // A first install starts from an empty policy instead of treating absence as an error.
  const originalGitignore = existsSync(goatFlowGitignorePath)
    ? readFileSync(goatFlowGitignorePath, "utf-8")
    : "";
  const hadFinalNewline =
    originalGitignore.length === 0 || originalGitignore.endsWith("\n");
  // Ignore the split artifact after a final newline so duplicate checks use real rules only.
  const gitignoreLines = originalGitignore
    .split(/\r?\n/u)
    .filter(
      (gitignoreLine, lineIndex, allLines) =>
        lineIndex < allLines.length - 1 || gitignoreLine.length > 0,
    );
  // The user already has the required rule, so setup does not rewrite their file.
  if (gitignoreLines.includes(gitignoreEntry)) return;

  const updatedGitignore = `${gitignoreLines.join("\n")}${gitignoreLines.length > 0 ? "\n" : ""}${gitignoreEntry}\n`;
  writeFileAtomic(
    goatFlowGitignorePath,
    hadFinalNewline ? updatedGitignore : updatedGitignore.trimEnd(),
    projectPath,
  );
}

/**
 * Keep the shared deny policy store tracked for fresh-clone protection.
 * Use after installing any managed hook files into `.goat-flow/hooks/`. The spelling must match the shipped template
 * (`workflow/setup/reference/goat-flow-gitignore` and `REQUIRED_GOAT_FLOW_GITIGNORE_PATTERNS`): the double-star-slash
 * prefixed form is what ignore-aware search tools honour, and the older anchored spelling would add an extra effective line
 * that fails the goat-flow-gitignore audit order check on every hook-enabled install.
 * @param projectPath - selected project; empty text cannot own the ignore policy
 * @returns nothing; both required negations are present when setup finishes
 */
function ensureHookGitignoreEntries(projectPath: string): void {
  ensureGoatFlowGitignoreEntry(projectPath, "!hooks/");
  ensureGoatFlowGitignoreEntry(projectPath, "!**/hooks/**");
}

/**
 * Remove one old per-agent script when an upgrade centralizes hook files.
 * Use during enable, disable, and sync migrations; it swallows a missing file, because an already-clean project is the expected outcome.
 * @param projectPath - selected project; empty text cannot own a safe removal
 * @param legacyHookDirectory - old agent hook folder; empty text resolves to the project root and is rejected
 * @param hookScriptName - managed filename; empty text cannot identify intended residue
 * @returns nothing; an already missing file is a successful idempotent cleanup
 */
function removeLegacyAgentScriptIfPresent(
  projectPath: string,
  legacyHookDirectory: string,
  hookScriptName: string,
): void {
  const legacyHookPath = join(projectPath, legacyHookDirectory, hookScriptName);
  assertWithinProject(projectPath, legacyHookPath);
  try {
    unlinkSync(legacyHookPath);
  } catch {
    // For example, a previous sync already removed the user's stale per-agent copy.
    return;
  }
}

/**
 * Remove every legacy per-agent copy owned by one current hook.
 * Use after central files are installed or when a hook is disabled.
 * @param projectPath - selected project; empty text cannot own safe cleanup paths
 * @param hookSpec - managed scripts to remove; an empty list removes no current files
 * @returns nothing; user-owned commands and files remain untouched
 */
function removeLegacyAgentHookScripts(
  projectPath: string,
  hookSpec: HookSpec,
): void {
  // Every historical agent folder may contain a stale Goat Flow-owned copy.
  for (const legacyHookDirectory of LEGACY_AGENT_HOOK_DIRECTORIES) {
    // Remove only script names declared by the current managed hook.
    for (const hookScriptName of hookSpec.scriptFiles) {
      removeLegacyAgentScriptIfPresent(
        projectPath,
        legacyHookDirectory,
        hookScriptName,
      );
    }
    // The deny dispatcher also retired earlier split guard filenames.
    if (hookSpec.id === "deny-dangerous") {
      // Each legacy deny script is Goat Flow-owned and safe to prune by exact name.
      for (const legacyDenyScriptName of LEGACY_DENY_DANGEROUS_SCRIPT_NAMES) {
        removeLegacyAgentScriptIfPresent(
          projectPath,
          legacyHookDirectory,
          legacyDenyScriptName,
        );
      }
    }
  }
}

/**
 * Read one managed hook from the bundled workflow source.
 * Use when sync writes the exact release bytes into a user's project.
 * @param hookScriptName - managed filename; empty text cannot resolve an installable source
 * @returns bundled script text; empty means the shipped source itself is empty
 */
function hookScriptContent(hookScriptName: string): string {
  return readFileSync(
    getTemplatePath(`workflow/hooks/${hookScriptName}`),
    "utf-8",
  );
}

/**
 * Protect a newer installed hook from an older CLI sync.
 * Use immediately before replacing managed bytes.
 * @param installedHookPath - hook about to be replaced; empty or missing paths are not newer
 * @returns true when the installed stamp is ahead; false includes missing, unreadable, or unstamped files
 * @throws Never; unreadable or unstamped user files return false so sync can continue
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
 * Remove one current managed script by exact name.
 * Use only when migration retires a hook while preserving user scripts; it swallows a missing file so repeated syncs stay quiet.
 * @param projectPath - selected project; empty text cannot own a safe removal
 * @param agent - selected agent; a null hook directory cannot resolve a script
 * @param hookScriptName - exact managed filename; empty text is rejected by target validation
 * @returns nothing; an already missing file is a successful idempotent cleanup
 */
function removeScriptIfPresent(
  projectPath: string,
  agent: AgentProfile,
  hookScriptName: string,
): void {
  const installedHookPath = installedHookTarget(
    projectPath,
    agent,
    hookScriptName,
  );
  try {
    unlinkSync(installedHookPath);
  } catch {
    // For example, the user already disabled the hook in another setup window.
    return;
  }
}

/**
 * Copy and chmod declared scripts while preserving inert files during disabled reconciliation.
 * @throws HookManagedInstallationError when an installed script comes from a newer Goat Flow release
 */
function copyDeclaredHookScripts(
  projectPath: string,
  agent: AgentProfile,
  hookSpec: HookSpec,
  shouldOverwriteExisting: boolean,
): void {
  for (const hookScriptName of hookSpec.scriptFiles) {
    const installedHookPath = installedHookTarget(
      projectPath,
      agent,
      hookScriptName,
    );
    if (!shouldOverwriteExisting && existsSync(installedHookPath)) continue;
    // A newer installed guard must not be silently downgraded by an older CLI.
    if (installedHookIsNewer(installedHookPath)) {
      throw new HookManagedInstallationError(
        `Refusing to overwrite ${hookScriptName}: the installed hook is newer than this CLI (${AUDIT_VERSION}). Re-run with a matching goat-flow release instead of downgrading the guardrail.`,
        409,
      );
    }
    writeFileAtomic(
      installedHookPath,
      hookScriptContent(hookScriptName),
      projectPath,
    );
    chmodSync(installedHookPath, 0o755);
  }
}

/**
 * Install and chmod current deny-policy modules, then remove their exact retired script names.
 * Side effects: creates the policy directory and mutates only Goat Flow-owned hook files.
 */
function copyDenyDangerousSupportFiles(
  projectPath: string,
  agent: AgentProfile,
  shouldOverwriteExisting: boolean,
): void {
  const installedPolicyDirectory = join(
    projectPath,
    ".goat-flow",
    "hooks",
    "deny-dangerous",
  );
  mkdirSync(installedPolicyDirectory, { recursive: true });
  for (const policyFileName of DENY_DANGEROUS_POLICY_FILES) {
    const policyTemplatePath = getTemplatePath(
      `workflow/hooks/deny-dangerous/${policyFileName}`,
    );
    const installedPolicyPath = join(installedPolicyDirectory, policyFileName);
    assertWithinProject(projectPath, installedPolicyPath);
    if (!shouldOverwriteExisting && existsSync(installedPolicyPath)) continue;
    writeFileAtomic(
      installedPolicyPath,
      readFileSync(policyTemplatePath, "utf-8"),
      projectPath,
    );
    chmodSync(installedPolicyPath, 0o755);
  }
  for (const legacyDenyScriptName of LEGACY_DENY_DANGEROUS_SCRIPT_NAMES) {
    removeScriptIfPresent(projectPath, agent, legacyDenyScriptName);
  }
}

/**
 * Install current managed bytes and prune obsolete per-agent copies.
 * Use whenever sync reconciles an installed agent, including intentionally disabled hooks.
 * @param projectPath - selected project; empty text cannot own safe destinations
 * @param agent - selected agent; a null hook directory leaves setup unchanged
 * @param hookSpec - hook files to install; an empty list writes no runnable hook
 * @param shouldOverwriteExisting - false fills missing inert files without refreshing existing bytes
 * @returns nothing; missing files are filled, while default mode also refreshes existing files
 */
export function copyHookScripts(
  projectPath: string,
  agent: AgentProfile,
  hookSpec: HookSpec,
  shouldOverwriteExisting = true,
): void {
  // An agent without a hook directory has no install destination for the user.
  if (!agent.hooksDir) return;

  mkdirSync(join(projectPath, agent.hooksDir), { recursive: true });
  // Every declared script receives the exact bytes from this Goat Flow release.
  copyDeclaredHookScripts(
    projectPath,
    agent,
    hookSpec,
    shouldOverwriteExisting,
  );

  ensureHookGitignoreEntries(projectPath);
  // The deny dispatcher needs its separately owned policy modules after a fresh clone.
  if (hookSpec.id === "deny-dangerous") {
    copyDenyDangerousSupportFiles(projectPath, agent, shouldOverwriteExisting);
  }

  removeLegacyAgentHookScripts(projectPath, hookSpec);
}

/**
 * Remove current and legacy managed files for one retired hook.
 * Use when an upgrade prunes a registry tombstone; active disabled hooks keep current inert bytes.
 * @param projectPath - selected project; empty text cannot own safe removals
 * @param agent - selected agent; a null hook directory cannot resolve current files
 * @param hookSpec - managed files to remove; empty scripts leave only the primary exact-name attempt
 * @returns nothing; user-owned hook commands and scripts remain untouched
 */
export function removeHookScripts(
  projectPath: string,
  agent: AgentProfile,
  hookSpec: HookSpec,
): void {
  removeScriptIfPresent(projectPath, agent, hookSpec.primaryScript);
  // The deny hook retired several exact managed filenames that upgrades must prune.
  if (hookSpec.id === "deny-dangerous") {
    // Remove only known Goat Flow-owned deny names from the selected agent folder.
    for (const legacyDenyScriptName of LEGACY_DENY_DANGEROUS_SCRIPT_NAMES) {
      removeScriptIfPresent(projectPath, agent, legacyDenyScriptName);
    }
  }

  removeLegacyAgentHookScripts(projectPath, hookSpec);
}
