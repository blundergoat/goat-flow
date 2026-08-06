// goat-flow-hook-version: 1.15.0
/**
 * Cross-platform launcher for goat-flow's Bash hook scripts.
 *
 * Agent hook commands reach this file through Node so native Windows never
 * resolves the System32 WSL shim by accident. The launcher preserves stdin,
 * stdout, stderr, cwd, and the hook's exit status.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, dirname, relative, resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Find Windows executables the user can already launch from PATH.
 * Use during setup and hook startup before checking standard Git folders.
 * Side effect: starts `where.exe`; lookup errors return no matches for fallback discovery.
 *
 * @param {string} executableName - Name to locate; empty produces no usable matches.
 * @returns {string[]} Command paths; empty means PATH provided no match.
 */
function whereWindowsExecutable(executableName) {
  try {
    const windowsPathLookup = spawnSync("where", [executableName], {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
    });
    // A failed lookup means this source offers no Bash path to the user.
    if (
      windowsPathLookup.status !== 0 ||
      typeof windowsPathLookup.stdout !== "string"
    ) {
      return [];
    }
    // Blank output lines are not executable choices in the setup result.
    return windowsPathLookup.stdout
      .split(/\r?\n/u)
      .map((candidate) => candidate.trim())
      .filter(Boolean);
  } catch {
    // For example, a locked-down Windows host may block `where` from starting.
    return [];
  }
}

/**
 * Derive Git Bash from a Git for Windows executable the user can run.
 * Use when Git is on PATH but its sibling Bash directory is not.
 *
 * @param {string} gitExecutablePath - Located Git path; empty cannot identify its install.
 * @returns {string | null} Adjacent Bash path, or null when Git's layout is unfamiliar.
 */
function bashBesideWindowsGit(gitExecutablePath) {
  const gitDirectory = win32.dirname(gitExecutablePath.trim());
  const directoryName = win32.basename(gitDirectory).toLowerCase();
  // A user running Git from its bin folder already has Bash beside it.
  if (directoryName === "bin") {
    return win32.join(gitDirectory, "bash.exe");
  }
  // Git for Windows commonly exposes cmd/git.exe while Bash remains under bin.
  if (directoryName === "cmd") {
    return win32.join(win32.dirname(gitDirectory), "bin", "bash.exe");
  }
  // An unfamiliar Git layout cannot safely predict where the user's Bash lives.
  return null;
}

/**
 * List conventional Git Bash locations configured for this Windows user.
 * Use after PATH-derived choices so custom installs keep their intended priority.
 *
 * @param {NodeJS.ProcessEnv} environment - Windows folders; missing values omit that location.
 * @returns {string[]} Candidate Bash paths; always includes the default system install.
 */
function standardWindowsGitBashLocations(environment) {
  const standardInstallCandidates = [];
  // ProgramFiles points most users to the system-wide 64-bit Git install.
  if (environment.ProgramFiles) {
    standardInstallCandidates.push(
      win32.join(environment.ProgramFiles, "Git", "bin", "bash.exe"),
    );
  }
  // ProgramW6432 preserves the native program folder for a 32-bit Node process.
  if (environment.ProgramW6432) {
    standardInstallCandidates.push(
      win32.join(environment.ProgramW6432, "Git", "bin", "bash.exe"),
    );
  }
  // Some users install the 32-bit Git package under Program Files (x86).
  if (environment["ProgramFiles(x86)"]) {
    standardInstallCandidates.push(
      win32.join(environment["ProgramFiles(x86)"], "Git", "bin", "bash.exe"),
    );
  }
  // A per-user Git install lives under LocalAppData without administrator access.
  if (environment.LOCALAPPDATA) {
    standardInstallCandidates.push(
      win32.join(
        environment.LOCALAPPDATA,
        "Programs",
        "Git",
        "bin",
        "bash.exe",
      ),
    );
  }
  standardInstallCandidates.push("C:\\Program Files\\Git\\bin\\bash.exe");
  return standardInstallCandidates;
}

/**
 * Discover Windows Bash choices even when Git is absent from PATH.
 * Use before install admission and each managed hook launch.
 *
 * @param {object} options - Test seams; omitted values use the user's live Windows host.
 * @returns {string[]} Ordered Bash paths; empty means setup cannot run Bash hooks.
 */
export function discoverWindowsBashCandidates(options = {}) {
  // Normal launches inspect the user's environment; tests can supply an isolated one.
  const windowsEnvironment = options.environment ?? process.env;
  // Normal launches verify derived paths on disk; tests can model installed files.
  const pathExists = options.pathExists ?? existsSync;
  // Normal launches use Windows `where`; tests can return deterministic PATH results.
  const runWhere = options.runWhere ?? whereWindowsExecutable;
  const pathBashCandidates = [...runWhere("bash")];
  // Unfamiliar Git layouts return null and cannot help the user locate Bash.
  const gitDerivedBashCandidates = runWhere("git")
    .map(bashBesideWindowsGit)
    .filter((candidate) => candidate !== null);
  const existingStandardInstallCandidates =
    standardWindowsGitBashLocations(windowsEnvironment).filter(pathExists);
  const discoveredBashCandidates = [
    ...pathBashCandidates,
    ...gitDerivedBashCandidates.filter(pathExists),
    ...existingStandardInstallCandidates,
  ];
  // The same install may appear through PATH and a standard folder; show it once.
  return Array.from(
    new Map(
      discoveredBashCandidates.map((candidate) => [
        candidate.toLowerCase(),
        candidate,
      ]),
    ).values(),
  );
}

/**
 * Identify Windows launchers that enter WSL instead of Git Bash.
 * Use before setup accepts a Bash candidate for native Windows hooks.
 *
 * @param {string} candidatePath - Discovered path; empty is treated as a non-WSL path.
 * @returns {boolean} True when choosing this path would leave native Windows.
 */
export function isWslBashPath(candidatePath) {
  const normalisedPath = candidatePath.replace(/\//gu, "\\").toLowerCase();
  return (
    normalisedPath.includes("\\system32\\bash.exe") ||
    normalisedPath.includes("\\windowsapps\\bash.exe")
  );
}

/**
 * Select the first native Windows Bash candidate in discovery order.
 * Use for install admission and hook execution so both paths agree.
 *
 * @param {string[]} candidatePaths - Discovered paths; blanks do not represent an install.
 * @returns {string | null} Usable Bash path, or null when the user must install Git Bash.
 */
export function pickWindowsBashPath(candidatePaths) {
  // Blank `where` lines cannot launch a hook and should not win selection.
  const usableCandidatePaths = candidatePaths
    .map((candidatePath) => candidatePath.trim())
    .filter(Boolean);
  // No compatible candidate tells setup to show the actionable Git Bash blocker.
  return (
    usableCandidatePaths.find(
      (candidatePath) => !isWslBashPath(candidatePath),
    ) ?? null
  );
}

/**
 * Report a launcher failure in the response format the user's agent expects.
 * Use when a hook cannot run, preserving fail-open or fail-closed policy.
 * The branches exist because each supported host parses a different failure contract.
 *
 * @param {string} hookResponseMode - Agent protocol; empty or unknown fails closed.
 * @param {string} userFacingReason - Practical failure detail; empty gives a generic message.
 * @returns {number} Exit status the host should treat as handled or blocked.
 */
function reportUnavailable(hookResponseMode, userFacingReason) {
  const lineBreak = String.fromCharCode(10);
  // Antigravity reads deny JSON from stdout and considers that response handled.
  if (hookResponseMode === "antigravity") {
    process.stdout.write(
      `${JSON.stringify({
        decision: "deny",
        reason: `Policy hook unavailable: ${userFacingReason}.`,
      })}${lineBreak}`,
    );
    return 0;
  }
  // Copilot requires permission-decision fields instead of a shell exit alone.
  if (hookResponseMode === "copilot") {
    process.stdout.write(
      `${JSON.stringify({
        permissionDecision: "deny",
        permissionDecisionReason: `Policy hook unavailable: ${userFacingReason}.`,
      })}${lineBreak}`,
    );
    return 0;
  }
  // Gruff feedback is optional, so an unavailable analyzer is a visible skip.
  if (hookResponseMode === "gruff") {
    process.stderr.write(
      `gruff-code-quality: hook unavailable: ${userFacingReason}; skipped.${lineBreak}`,
    );
    return 0;
  }
  // Post-turn safety cannot report success when its scan never ran.
  if (hookResponseMode === "post-turn") {
    process.stderr.write(
      `post-turn-safety: hook unavailable: ${userFacingReason}.${lineBreak}`,
    );
    return 2;
  }
  process.stderr.write(
    `BLOCKED: Policy hook unavailable: ${userFacingReason}.${lineBreak}`,
  );
  return 2;
}

/**
 * Run one project hook through Bash while preserving its host-facing result.
 * Use when an agent invokes a managed `.sh` hook on Windows, macOS, or Linux.
 *
 * @param {string} hookScriptArgument - Project-relative hook path; empty is rejected.
 * @param {string} hookResponseMode - Agent response protocol; empty uses policy behavior.
 * @param {object} launchOptions - Test/platform overrides; omitted values use the live project.
 * @returns {number} Hook exit status, or the protocol-specific unavailable result.
 */
export function runHookWithBash(
  hookScriptArgument,
  hookResponseMode = "policy",
  launchOptions = {},
) {
  // A normal hook starts in the selected project; tests can provide a fixture root.
  const projectRoot = launchOptions.root ?? process.cwd();
  const hookScriptPath = resolve(projectRoot, hookScriptArgument);
  const projectRelativeHookPath = relative(projectRoot, hookScriptPath);
  // An empty or escaping path could make an agent execute outside the user's project.
  if (
    projectRelativeHookPath.length === 0 ||
    projectRelativeHookPath === ".." ||
    projectRelativeHookPath.startsWith(`..${win32.sep}`) ||
    projectRelativeHookPath.startsWith("../") ||
    projectRelativeHookPath.startsWith("..\\")
  ) {
    return reportUnavailable(
      hookResponseMode,
      "hook script path escaped the project root",
    );
  }
  // For example, a partial install may register a hook whose script was never copied.
  if (!existsSync(hookScriptPath)) {
    return reportUnavailable(hookResponseMode, "hook script was not found");
  }

  // Normal launches follow the host platform; tests can model native Windows.
  const hostPlatform = launchOptions.platform ?? process.platform;
  let bashExecutable = "bash";
  // Native Windows must avoid the WSL shim and use a discovered Git Bash path.
  if (hostPlatform === "win32") {
    // Tests can provide candidates; normal hooks repeat the install-time discovery.
    const windowsBashCandidates =
      launchOptions.windowsBashCandidates ??
      discoverWindowsBashCandidates(launchOptions.discoveryOptions);
    bashExecutable = pickWindowsBashPath(windowsBashCandidates);
  }
  // No native candidate means the user needs Git for Windows before hooks can run.
  if (bashExecutable === null) {
    return reportUnavailable(
      hookResponseMode,
      "Windows-compatible Bash was not found; install Git for Windows",
    );
  }

  let hookEnvironment = process.env;
  // A discovered Git Bash needs its own bin folder first so child tools resolve consistently.
  if (bashExecutable !== "bash") {
    // A missing PATH is valid in a restricted agent host and starts as an empty suffix.
    const existingPath = process.env.PATH ?? "";
    hookEnvironment = {
      ...process.env,
      PATH: `${dirname(bashExecutable)}${delimiter}${existingPath}`,
    };
  }
  const hookExecution = spawnSync(
    bashExecutable,
    [hookScriptPath.replace(/\\/gu, "/")],
    {
      cwd: projectRoot,
      env: hookEnvironment,
      stdio: "inherit",
      windowsHide: true,
    },
  );
  // For example, endpoint protection may stop Git Bash before the user's hook starts.
  if (hookExecution.error) {
    return reportUnavailable(
      hookResponseMode,
      `Bash could not start: ${hookExecution.error.message}`,
    );
  }
  // A numeric status is the hook's real allow, deny, or advisory result for the user.
  if (Number.isInteger(hookExecution.status)) {
    return hookExecution.status;
  }
  return reportUnavailable(
    hookResponseMode,
    "Bash ended without an exit status",
  );
}

const launchedModuleArgument = process.argv[1];
let launchedModulePath = "";
// Import-only tests omit an invoked path; direct hook execution supplies one.
if (launchedModuleArgument) {
  launchedModulePath = resolve(launchedModuleArgument);
}
const currentModulePath = fileURLToPath(import.meta.url);
let launchedAsProgram = launchedModulePath === currentModulePath;
// Windows paths are case-insensitive from the user's shell even when strings differ.
if (process.platform === "win32") {
  launchedAsProgram =
    launchedModulePath.toLowerCase() === currentModulePath.toLowerCase();
}
// Importers use the helpers without launching a hook; direct execution runs one.
if (launchedAsProgram) {
  // A missing script argument becomes an explicit invalid path, not an arbitrary hook.
  const hookScriptArgument = process.argv[2] ?? "";
  // A missing response mode uses the normal fail-closed policy response.
  const hookResponseMode = process.argv[3] ?? "policy";
  process.exitCode = runHookWithBash(hookScriptArgument, hookResponseMode);
}
