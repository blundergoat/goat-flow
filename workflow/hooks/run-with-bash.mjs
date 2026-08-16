// goat-flow-hook-version: 1.15.1
/**
 * Cross-platform launcher for goat-flow's Bash hook scripts.
 * Agent hook commands use Node so native Windows avoids the System32 WSL shim.
 * The launcher preserves the user's stdin, output, cwd, deadline, and hook status.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import {
  delimiter,
  dirname,
  isAbsolute,
  relative,
  resolve,
  win32,
} from "node:path";
import { fileURLToPath } from "node:url";
import {
  captureHookProcessUntilDeadline,
  prepareProviderLauncherUnavailableDelivery,
  resolveHookLaunchTimeoutMs,
} from "./hook-launch-runtime.mjs";

const LEGACY_POLICY_DEADLINE_MS = 25_000; // Ceiling: leaves five seconds for host failure output.
const LEGACY_FEEDBACK_DEADLINE_MS = 75_000; // Ceiling: leaves fifteen seconds for host feedback.
const LEGACY_HOOK_DEADLINES_MS = new Map([
  ["policy", LEGACY_POLICY_DEADLINE_MS],
  ["antigravity", LEGACY_POLICY_DEADLINE_MS],
  ["copilot", LEGACY_POLICY_DEADLINE_MS],
  ["gruff", LEGACY_FEEDBACK_DEADLINE_MS],
  ["post-turn", LEGACY_FEEDBACK_DEADLINE_MS],
]);

/**
 * Resolve a fixed hook-owned Windows utility without searching the project or PATH.
 *
 * @param {NodeJS.ProcessEnv} environment - Host folders; missing or empty roots disable the utility.
 * @param {string} utilityFileName - Fixed basename; empty or path-shaped input is rejected.
 * @returns {string | null} Absolute System32 path, or null when either trusted component is missing.
 */
function windowsSystemUtilityPath(environment, utilityFileName) {
  // An empty SystemRoot falls back to WINDIR; neither value may resolve from the project.
  const windowsSystemRoot = environment.SystemRoot || environment.WINDIR || "";
  // A missing root or path-shaped filename could escape the trusted System32 directory.
  if (
    !win32.isAbsolute(windowsSystemRoot) ||
    utilityFileName.length === 0 ||
    win32.basename(utilityFileName) !== utilityFileName
  ) {
    return null;
  }
  return win32.join(windowsSystemRoot, "System32", utilityFileName);
}

/**
 * Find Windows executables the user can launch before checking standard Git folders.
 * Side effect: starts `where.exe`; lookup errors return no matches for fallback discovery.
 *
 * @param {string} executableName - Name to locate; empty produces no usable matches.
 * @param {NodeJS.ProcessEnv} environment - Host folders; missing system roots skip PATH lookup.
 * @returns {string[]} Command paths; empty means PATH provided no match.
 */
function whereWindowsExecutable(executableName, environment = process.env) {
  try {
    const whereExecutablePath = windowsSystemUtilityPath(
      environment,
      "where.exe",
    );
    // Without a trusted absolute utility path, fallback locations remain safer than project lookup.
    if (whereExecutablePath === null) return [];
    const windowsPathLookup = spawnSync(whereExecutablePath, [executableName], {
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
 * Derive Git Bash when the user's Git is on PATH but its sibling Bash is not.
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
 * List conventional Git Bash locations after the user's PATH-derived choices.
 *
 * @param {NodeJS.ProcessEnv} environment - Windows folders; missing values omit that location.
 * @returns {string[]} Candidate Bash paths; always includes the default system install.
 */
function standardWindowsGitBashLocations(environment) {
  const systemInstallRoots = [
    environment.ProgramFiles,
    environment.ProgramW6432,
    environment["ProgramFiles(x86)"],
  ];
  // Empty host variables omit Git locations the user has not configured.
  const standardInstallCandidates = systemInstallRoots
    .filter(Boolean)
    .map((installRoot) => win32.join(installRoot, "Git", "bin", "bash.exe"));
  const localInstallRoot = environment.LOCALAPPDATA;
  // A per-user Git install lives under LocalAppData without administrator access.
  if (localInstallRoot) {
    standardInstallCandidates.push(
      win32.join(localInstallRoot, "Programs", "Git", "bin", "bash.exe"),
    );
  }
  standardInstallCandidates.push("C:\\Program Files\\Git\\bin\\bash.exe");
  return standardInstallCandidates;
}

/**
 * Resolve Windows' tree terminator when a timed-out hook must stop every child tool.
 *
 * @param {NodeJS.ProcessEnv} environment - Host folders; missing or empty roots disable tree kill.
 * @returns {string | null} Absolute taskkill path, or null when the host root is unavailable or relative.
 */
export function windowsTaskkillExecutablePath(environment) {
  return windowsSystemUtilityPath(environment, "taskkill.exe");
}

/**
 * Discover Windows Bash choices before setup or a managed hook launch.
 *
 * @param {object} options - Test seams; omitted values use the user's live Windows host.
 * @returns {string[]} Ordered Bash paths; empty means setup cannot run Bash hooks.
 */
export function discoverWindowsBashCandidates(options = {}) {
  // Normal launches inspect the user's environment; tests can supply an isolated one.
  const windowsEnvironment = options.environment ?? process.env;
  // Normal launches verify derived paths on disk; tests can model installed files.
  const pathExists = options.pathExists ?? existsSync;
  // Normal launches use System32 `where.exe`; tests can return deterministic PATH results.
  const runWhere =
    options.runWhere ??
    ((executableName) =>
      whereWindowsExecutable(executableName, windowsEnvironment));
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
 * Identify WSL launchers before setup accepts a native Windows Bash choice.
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
 * Select the first native Windows Bash for consistent setup and hook execution.
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
 * Write a policy startup failure before a proposed tool runs; null leaves category output.
 *
 * @param {string} providerIdentifier - active host; empty or unknown text has no JSON policy shape
 * @param {string} unavailableReason - non-empty explanation shown with the deny decision
 * @param {string} lineBreak - host line separator; empty keeps valid JSON but hurts terminal display
 * @returns {number | null} handled exit code, or null when standard fail-closed output must be used
 */
function reportProviderPolicyUnavailable(
  providerIdentifier,
  unavailableReason,
  lineBreak,
) {
  // Antigravity reads deny JSON from stdout and considers that response handled.
  if (providerIdentifier === "antigravity") {
    process.stdout.write(
      `${JSON.stringify({
        decision: "deny",
        reason: unavailableReason,
      })}${lineBreak}`,
    );
    return 0;
  }
  // Copilot requires permission-decision fields instead of a shell exit alone.
  if (providerIdentifier === "copilot") {
    process.stdout.write(
      `${JSON.stringify({
        permissionDecision: "deny",
        permissionDecisionReason: unavailableReason,
      })}${lineBreak}`,
    );
    return 0;
  }
  return null;
}

/**
 * Report a failed hook launch while preserving the user's host response policy.
 *
 * @param {string} hookResponseMode - Agent protocol; empty or unknown fails closed.
 * @param {string} userFacingReason - Practical failure detail; empty gives a generic message.
 * @returns {number} Exit status the host should treat as handled or blocked.
 */
function reportUnavailable(hookResponseMode, userFacingReason) {
  const lineBreak = String.fromCharCode(10);
  const namespacedModeParts = hookResponseMode.split(":");
  // Invalid or empty fields fall back to fail-closed policy output without loading an adapter.
  const providerIdentifier =
    hookResponseMode === "antigravity" || hookResponseMode === "copilot"
      ? hookResponseMode
      : namespacedModeParts[0] || "unknown";
  const responseKind =
    hookResponseMode === "gruff" || hookResponseMode === "post-turn"
      ? hookResponseMode
      : namespacedModeParts[1] || "policy";
  // Concatenate because a template literal nested in another can confuse block scanners.
  const unavailableReason =
    "Policy hook unavailable: " + userFacingReason + ".";
  // Feedback and stop failures bypass permission JSON and keep their own category.
  const providerPolicyExitCode =
    responseKind === "policy"
      ? reportProviderPolicyUnavailable(
          providerIdentifier,
          unavailableReason,
          lineBreak,
        )
      : null;
  // A provider-shaped deny is already complete and must not print a second failure.
  if (providerPolicyExitCode !== null) return providerPolicyExitCode;
  // Gruff feedback is optional, so an unavailable analyzer is a visible skip.
  if (responseKind === "gruff") {
    process.stderr.write(
      `gruff-code-quality: hook unavailable: ${userFacingReason}; skipped.${lineBreak}`,
    );
    return 0;
  }
  // Post-turn safety cannot report success when its scan never ran.
  if (responseKind === "post-turn") {
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
 * Return one launcher-owned failure through a migrated adapter or the legacy response path.
 * Use when no trustworthy child envelope exists but the active user still needs visible context.
 *
 * @param {string} hookResponseMode - registered mode; empty text falls back to policy failure
 * @param {object | null} providerAdapterRuntime - loaded adapter, or null for legacy hooks
 * @param {object | null} launchContract - decoded managed contract, or null for legacy hooks
 * @param {string} unavailableReasonCode - stable failure code; empty text cannot explain the outcome
 * @param {string} userFacingReason - practical detail; empty text would leave the user without recovery context
 * @param {string} childStandardError - bounded child diagnostics; empty means the child produced none
 * @param {number} launcherDurationMs - measured wait; zero means no meaningful duration completed
 * @returns {number} Exit status the registered host treats as handled or blocked.
 */
function reportLauncherUnavailable(
  hookResponseMode,
  providerAdapterRuntime,
  launchContract,
  unavailableReasonCode,
  userFacingReason,
  childStandardError = "",
  launcherDurationMs = 0,
) {
  // A migrated hook can translate launcher failure into the active provider's model response.
  if (providerAdapterRuntime !== null && launchContract !== null) {
    const providerUnavailableDelivery =
      prepareProviderLauncherUnavailableDelivery(
        providerAdapterRuntime,
        launchContract,
        unavailableReasonCode,
        userFacingReason,
        childStandardError,
        launcherDurationMs,
      );
    // A valid provider response reaches the model instead of becoming plain terminal text.
    if (providerUnavailableDelivery.state === "delivered") {
      // Empty stderr means neither the child nor adapter has a human-only diagnostic.
      if (providerUnavailableDelivery.stderr.length > 0) {
        process.stderr.write(providerUnavailableDelivery.stderr);
      }
      // Empty stdout is valid only when the selected provider needs no model-facing object.
      if (providerUnavailableDelivery.stdout.length > 0) {
        process.stdout.write(providerUnavailableDelivery.stdout);
      }
      return providerUnavailableDelivery.exitCode;
    }
    // For example, an unsupported provider event may retain bounded child diagnostics for the user.
    if (providerUnavailableDelivery.stderr.length > 0) {
      process.stderr.write(providerUnavailableDelivery.stderr);
    }
    return reportUnavailable(
      hookResponseMode,
      providerUnavailableDelivery.reason,
    );
  }
  return reportUnavailable(hookResponseMode, userFacingReason);
}

/**
 * Refuse a managed hook whose file shape could redirect the user's execution.
 * Use before Bash starts so rejected shapes become a visible unavailable result.
 * Error behavior: never throws; path races return "hook script was not found".
 *
 * @param {string} projectRoot - Project the user selected; the hook must resolve inside it.
 * @param {string} hookScriptPath - Absolute path to the hook file, already known to exist.
 * @returns {string | null} Failure reason, or null when the reviewed project script may run.
 */
function hookScriptShapeFailure(projectRoot, hookScriptPath) {
  let hookScriptStats;
  try {
    hookScriptStats = lstatSync(hookScriptPath);
  } catch {
    // The file vanished between the existence check and now - for example the
    // user reinstalled hooks in another window while an agent was working.
    return "hook script was not found";
  }
  // A symlink means the file the user reviewed is not the file that would run.
  if (hookScriptStats.isSymbolicLink()) {
    return "hook script is a symlink; managed hooks must be regular files";
  }
  // A directory or device in the hook's place cannot be the reviewed script.
  if (!hookScriptStats.isFile()) {
    return "hook script is not a regular file";
  }
  // Extra hard links mean the same content is reachable under another name that
  // can be swapped independently of the path the user installed.
  if (hookScriptStats.nlink > 1) {
    return "hook script has multiple hard links";
  }
  let resolvedHookScriptPath;
  let resolvedProjectRoot;
  try {
    resolvedHookScriptPath = realpathSync(hookScriptPath);
    resolvedProjectRoot = realpathSync(projectRoot);
  } catch {
    // The path stopped resolving mid-check - for example a synced folder the
    // user's file-sync tool replaced while the hook was starting.
    return "hook script was not found";
  }
  const resolvedRelativeHookPath = relative(
    resolvedProjectRoot,
    resolvedHookScriptPath,
  );
  // A symlinked parent directory can leave the project even when the plain path
  // text looks contained, so the fully resolved location is checked as well.
  if (
    resolvedRelativeHookPath === ".." ||
    resolvedRelativeHookPath.startsWith(`..${win32.sep}`) ||
    resolvedRelativeHookPath.startsWith("../") ||
    resolvedRelativeHookPath.startsWith("..\\") ||
    isAbsolute(resolvedRelativeHookPath)
  ) {
    return "hook script path escaped the project root";
  }
  return null;
}

/**
 * Stop a timed-out hook so child tools cannot keep the user's agent waiting.
 * Side effects: mutates process state by force-stopping the tree; errors recover after work ends.
 *
 * @param {import("node:child_process").ChildProcess} hookProcess - Started Bash process; a missing PID means launch failed before user work began.
 * @param {NodeJS.Platform} hostPlatform - Active host; an empty value cannot select a safe platform-specific tree kill.
 * @param {NodeJS.ProcessEnv} hookEnvironment - Host folders; missing Windows roots use direct-process cleanup only.
 * @returns {void} No result; an already-finished process means the user's cleanup is complete.
 */
function stopHookProcessTree(hookProcess, hostPlatform, hookEnvironment) {
  // A failed launch has no process tree to keep the user's agent waiting.
  if (!hookProcess.pid) {
    return;
  }
  try {
    // Windows needs its built-in tree-kill command because Node kills only the direct process.
    if (hostPlatform === "win32") {
      const taskkillExecutablePath =
        windowsTaskkillExecutablePath(hookEnvironment);
      // Without a trusted absolute system path, only the known Bash process is safe to stop.
      if (taskkillExecutablePath === null) {
        hookProcess.kill("SIGKILL");
        return;
      }
      const windowsTreeKillResult = spawnSync(
        taskkillExecutablePath,
        ["/pid", String(hookProcess.pid), "/T", "/F"],
        {
          stdio: "ignore",
          timeout: 1_000,
          windowsHide: true,
        },
      );
      // A missing or failed taskkill still lets the user escape the direct Bash process.
      if (windowsTreeKillResult.status !== 0) {
        hookProcess.kill("SIGKILL");
      }
      return;
    }
    // POSIX descendants share the detached Bash group, so one signal ends the whole hook tree.
    process.kill(-hookProcess.pid, "SIGKILL");
  } catch {
    // For example, the hook may finish between the UI deadline and the cleanup signal.
  }
}

/**
 * Run a verified hook until it exits, fails, or reaches the user's deadline.
 *
 * @param {string} bashExecutable - Resolved Bash command; empty would fail through the launch-error result.
 * @param {string} hookScriptPath - Non-empty verified script path inside the user's project.
 * @param {string} projectRoot - Non-empty selected project used as the hook's working directory.
 * @param {NodeJS.ProcessEnv} hookEnvironment - Hook environment; missing values remain unavailable to the script.
 * @param {number} launchTimeout - Positive deadline in milliseconds; zero would time out immediately.
 * @param {NodeJS.Platform} hostPlatform - Active host used for process-tree cleanup.
 * @param {Function | null} appendCapturedHookOutput - adapter writer; null preserves direct legacy streams.
 * @returns {Promise<{status: number | null, timedOut: boolean, launchError: Error | null, stdout: string, stderr: string, hasExceededOutputLimit: boolean}>} Result for the user; empty streams mean legacy passthrough or no child output.
 */
function runHookProcessUntilDeadline(
  bashExecutable,
  hookScriptPath,
  projectRoot,
  hookEnvironment,
  launchTimeout,
  hostPlatform,
  appendCapturedHookOutput,
) {
  // A null adapter keeps the user's legacy hook output attached directly to the host.
  const shouldCaptureResult = appendCapturedHookOutput !== null;
  const validatedBashExecutable =
    bashExecutable === "bash" ? "bash" : bashExecutable;
  const hookProcess = spawn(
    validatedBashExecutable,
    [hookScriptPath.replace(/\\/gu, "/")],
    {
      cwd: projectRoot,
      detached: hostPlatform !== "win32",
      env: hookEnvironment,
      shell: false,
      stdio: shouldCaptureResult ? ["inherit", "pipe", "pipe"] : "inherit",
      windowsHide: true,
    },
  );
  return captureHookProcessUntilDeadline(
    hookProcess,
    hookEnvironment,
    launchTimeout,
    hostPlatform,
    appendCapturedHookOutput,
    stopHookProcessTree,
  );
}

/**
 * Resolve one legacy deadline or load the migrated provider launch contract.
 * Side effect: dynamically loads the provider adapter only for namespaced modes.
 * Error behavior: never throws for contract or adapter failures; returns a failure reason instead.
 *
 * @param {string} hookResponseMode - Registered response mode; empty text is invalid policy input.
 * @param {NodeJS.ProcessEnv} initialHookEnvironment - Host environment passed to the managed hook.
 * @returns {Promise<object>} Prepared runtime fields, or a failure reason with no runnable contract.
 */
async function prepareHookLaunchRuntime(
  hookResponseMode,
  initialHookEnvironment,
) {
  const legacyHookDeadline =
    LEGACY_HOOK_DEADLINES_MS.get(hookResponseMode) ?? null;
  // Legacy hooks keep direct streams and do not load the migrated provider adapter.
  if (legacyHookDeadline !== null) {
    const launchTimeout = resolveHookLaunchTimeoutMs(
      legacyHookDeadline,
      initialHookEnvironment,
    );
    // Invalid or empty timeout configuration cannot safely bound the user's wait.
    if (launchTimeout === null) {
      return { failureReason: "hook timeout configuration is invalid" };
    }
    return {
      failureReason: null,
      hookEnvironment: initialHookEnvironment,
      launchContract: null,
      providerAdapterRuntime: null,
      launchTimeout,
    };
  }
  // A non-empty namespaced mode distinguishes a migrated contract from an unknown legacy value.
  if (!hookResponseMode.includes(":")) {
    return { failureReason: "hook launch contract is invalid" };
  }
  let providerAdapterRuntime;
  let launchContract;
  try {
    providerAdapterRuntime = await import("./hook-provider-adapters.mjs");
    launchContract =
      providerAdapterRuntime.decodeHookLaunchContract(hookResponseMode);
  } catch {
    // For example, setup may register a migrated hook before its adapter file finishes syncing.
    return { failureReason: "hook provider adapter could not load" };
  }
  // Missing or malformed fields cannot identify a safe provider response or deadline.
  if (launchContract === null) {
    return { failureReason: "hook launch contract is invalid" };
  }
  // Migrated hooks receive the decoded identity they must echo in their neutral result.
  const hookEnvironment = {
    ...initialHookEnvironment,
    GOAT_FLOW_HOOK_PROVIDER: launchContract.providerIdentifier,
    GOAT_FLOW_HOOK_EVENT: launchContract.hookEvent,
    GOAT_FLOW_HOOK_PROVIDER_MODE: "managed",
    GOAT_FLOW_HOOK_ADAPTER_VERSION: launchContract.adapterVersion,
    GOAT_FLOW_HOOK_RESULT_PROTOCOL: launchContract.resultProtocol,
  };
  const launchTimeout = resolveHookLaunchTimeoutMs(
    launchContract.launcherDeadlineMs,
    hookEnvironment,
  );
  // Invalid or empty timeout configuration cannot safely bound the user's wait.
  if (launchTimeout === null) {
    return { failureReason: "hook timeout configuration is invalid" };
  }
  return {
    failureReason: null,
    hookEnvironment,
    launchContract,
    providerAdapterRuntime,
    launchTimeout,
  };
}

/**
 * Render one completed hook execution through its legacy or migrated host contract.
 * Side effects: writes bounded provider output to stdout/stderr when delivery succeeds or fails.
 *
 * @param {string} hookResponseMode - Registered host response mode for unavailable fallbacks.
 * @param {object | null} providerAdapterRuntime - Loaded adapter, or null for legacy hooks.
 * @param {object | null} launchContract - Decoded provider contract, or null for legacy hooks.
 * @param {object} hookExecution - Completed process result with bounded output and status.
 * @param {number} launchTimeout - Applied deadline in milliseconds for timeout evidence.
 * @returns {number} Exit status the registered host treats as handled, blocked, or advisory.
 */
function renderHookExecutionResult(
  hookResponseMode,
  providerAdapterRuntime,
  launchContract,
  hookExecution,
  launchTimeout,
) {
  // A deadline means the hook tree was stopped before the user-facing response is rendered.
  if (hookExecution.timedOut) {
    return reportLauncherUnavailable(
      hookResponseMode,
      providerAdapterRuntime,
      launchContract,
      "execution-timeout",
      "hook exceeded its deadline and was killed",
      hookExecution.stderr,
      launchTimeout,
    );
  }
  // For example, endpoint protection may stop Git Bash before the user's hook starts.
  if (hookExecution.launchError) {
    return reportLauncherUnavailable(
      hookResponseMode,
      providerAdapterRuntime,
      launchContract,
      "hook-unavailable",
      "Bash could not start",
      hookExecution.stderr,
    );
  }
  // Migrated hooks use the bounded neutral result and final provider adapter path.
  if (providerAdapterRuntime !== null) {
    const providerHookDelivery =
      providerAdapterRuntime.prepareProviderHookResultDelivery(
        hookExecution,
        launchContract,
      );
    // An unavailable translation uses the registered fail-open or fail-closed policy.
    if (providerHookDelivery.state !== "delivered") {
      return reportLauncherUnavailable(
        hookResponseMode,
        providerAdapterRuntime,
        launchContract,
        "adapter-delivery-failed",
        providerHookDelivery.reason,
        providerHookDelivery.stderr,
      );
    }
    // Empty stderr means neither the child nor adapter has a human-only diagnostic.
    if (providerHookDelivery.stderr.length > 0) {
      process.stderr.write(providerHookDelivery.stderr);
    }
    // Empty stdout is the documented clean response for several host/event combinations.
    if (providerHookDelivery.stdout.length > 0) {
      process.stdout.write(providerHookDelivery.stdout);
    }
    return providerHookDelivery.exitCode;
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

/**
 * Run a managed project hook through Bash while preserving its host-facing result.
 * Error behavior: expected validation, adapter, launch, and delivery failures return host-specific status.
 *
 * @param {string} hookScriptArgument - Project-relative hook path; empty is rejected.
 * @param {string} hookResponseMode - Agent response protocol; empty uses policy behavior.
 * @param {object} launchOptions - Test/platform overrides; omitted values use the live project.
 * @returns {Promise<number>} Hook exit status, or the protocol-specific unavailable result.
 */
export async function runHookWithBash(
  hookScriptArgument,
  hookResponseMode = "policy",
  launchOptions = {},
) {
  // A normal hook starts in the selected project; tests can provide a fixture root.
  const projectRoot = launchOptions.root ?? process.cwd();
  const hookScriptPath = resolve(projectRoot, hookScriptArgument);
  let containmentProjectRoot = projectRoot;
  let containmentHookScriptPath = hookScriptPath;
  // Existing paths are compared by physical identity so a symlinked spelling of the selected
  // project stays inside it. A path that cannot resolve retains the lexical fail-closed check.
  try {
    containmentProjectRoot = realpathSync(projectRoot);
    containmentHookScriptPath = realpathSync(hookScriptPath);
  } catch {
    // The existence and shape checks below retain their more specific unavailable reason.
    containmentProjectRoot = resolve(projectRoot);
    containmentHookScriptPath = resolve(hookScriptPath);
  }
  const projectRelativeHookPath = relative(
    containmentProjectRoot,
    containmentHookScriptPath,
  );
  // An empty or escaping path could make an agent execute outside the user's project.
  if (
    projectRelativeHookPath.length === 0 ||
    projectRelativeHookPath === ".." ||
    projectRelativeHookPath.startsWith(`..${win32.sep}`) ||
    projectRelativeHookPath.startsWith("../") ||
    projectRelativeHookPath.startsWith("..\\") ||
    isAbsolute(projectRelativeHookPath)
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
  const hookScriptShapeReason = hookScriptShapeFailure(
    projectRoot,
    hookScriptPath,
  );
  if (hookScriptShapeReason !== null) {
    return reportUnavailable(hookResponseMode, hookScriptShapeReason);
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

  let hookEnvironment = launchOptions.environment ?? process.env;
  // A discovered Git Bash needs its own bin folder first so child tools resolve consistently.
  if (bashExecutable !== "bash") {
    // A missing PATH is valid in a restricted agent host and starts as an empty suffix.
    const existingPath = hookEnvironment.PATH ?? "";
    hookEnvironment = {
      ...process.env,
      ...hookEnvironment,
      PATH: `${dirname(bashExecutable)}${delimiter}${existingPath}`,
    };
  }
  const launchRuntime = await prepareHookLaunchRuntime(
    hookResponseMode,
    hookEnvironment,
  );
  if (launchRuntime.failureReason !== null) {
    return reportUnavailable(hookResponseMode, launchRuntime.failureReason);
  }
  hookEnvironment = launchRuntime.hookEnvironment;
  const { launchContract, providerAdapterRuntime, launchTimeout } =
    launchRuntime;
  // A null writer preserves direct legacy streams; migrated hooks capture bounded output.
  const appendCapturedHookOutput =
    providerAdapterRuntime?.appendBoundedHookOutput ?? null;
  const hookExecution = await runHookProcessUntilDeadline(
    bashExecutable,
    hookScriptPath,
    projectRoot,
    hookEnvironment,
    launchTimeout,
    hostPlatform,
    appendCapturedHookOutput,
  );
  return renderHookExecutionResult(
    hookResponseMode,
    providerAdapterRuntime,
    launchContract,
    hookExecution,
    launchTimeout,
  );
}

const launchedModuleArgument = process.argv[1];
let launchedModulePath = "";
// Import-only tests omit an invoked path; direct hook execution supplies one.
if (launchedModuleArgument) {
  const resolvedLaunchPath = resolve(launchedModuleArgument);
  try {
    launchedModulePath = realpathSync(resolvedLaunchPath);
  } catch {
    launchedModulePath = resolvedLaunchPath;
  }
}
const currentModulePath = realpathSync(fileURLToPath(import.meta.url));
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
  process.exitCode = await runHookWithBash(
    hookScriptArgument,
    hookResponseMode,
  );
}
