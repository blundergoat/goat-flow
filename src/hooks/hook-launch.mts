/** Native hook launch retains selected-project paths, original stdin and bounded supervision. */
import { spawn } from "node:child_process";
import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, win32 } from "node:path";
import {
  captureHookProcessUntilDeadline,
  type CapturedHookProcessResult,
} from "./hook-supervisor.mjs";

/** Detect the existing parent-escape and absolute-path forms; callers decide whether empty paths are allowed. */
function isHookPathOutsideProject(relativeHookPath: string): boolean {
  return (
    relativeHookPath === ".." ||
    relativeHookPath.startsWith(`..${win32.sep}`) ||
    relativeHookPath.startsWith("../") ||
    relativeHookPath.startsWith("..\\") ||
    isAbsolute(relativeHookPath)
  );
}

/**
 * Reject an escaped script while accepting a symlinked spelling of the selected root.
 * Filesystem lookup failures recover through lexical containment; the caller still reports missing files.
 */
export function hookScriptContainmentFailure(
  projectRoot: string,
  hookScriptPath: string,
): string | null {
  let containmentProjectRoot;
  let containmentHookScriptPath;
  try {
    containmentProjectRoot = realpathSync(projectRoot);
    containmentHookScriptPath = realpathSync(hookScriptPath);
  } catch {
    // Sync can replace the file mid-check; unresolved paths still need the lexical escape check.
    containmentProjectRoot = resolve(projectRoot);
    containmentHookScriptPath = resolve(hookScriptPath);
  }
  const projectRelativeHookPath = relative(
    containmentProjectRoot,
    containmentHookScriptPath,
  );
  if (
    projectRelativeHookPath.length === 0 ||
    isHookPathOutsideProject(projectRelativeHookPath)
  ) {
    return "hook script path escaped the project root";
  }
  return null;
}

/**
 * Refuse linked or non-file scripts before the caller starts an evaluator.
 * Reports the existing repair reason on filesystem races instead of throwing.
 */
export function hookScriptShapeFailure(
  projectRoot: string,
  hookScriptPath: string,
): string | null {
  let stats;
  try {
    stats = lstatSync(hookScriptPath);
  } catch {
    // Reinstallation can remove the reviewed file between lookup and this check.
    return "hook script was not found";
  }
  if (stats.isSymbolicLink())
    return "hook script is a symlink; managed hooks must be regular files";
  if (!stats.isFile()) return "hook script is not a regular file";
  if (stats.nlink > 1) return "hook script has multiple hard links";
  let resolvedHookScriptPath;
  let resolvedProjectRoot;
  try {
    resolvedHookScriptPath = realpathSync(hookScriptPath);
    resolvedProjectRoot = realpathSync(projectRoot);
  } catch {
    // A replaced parent directory cannot establish the reviewed script's physical identity.
    return "hook script was not found";
  }
  const resolvedRelativeHookPath = relative(
    resolvedProjectRoot,
    resolvedHookScriptPath,
  );
  // A linked parent can redirect a contained-looking path outside the selected project.
  if (isHookPathOutsideProject(resolvedRelativeHookPath)) {
    return "hook script path escaped the project root";
  }
  return null;
}

/**
 * Start a verified evaluator with this Node executable and an explicit selected-root argument.
 * The caller must validate paths and saved policy choices first; this primitive only owns process I/O.
 * Resolves launch errors through supervision; throws unexpected synchronous spawn errors to the caller.
 */
export function runNativeHookProcessUntilDeadline(
  hookScriptPath: string,
  projectRoot: string,
  hookEnvironment: NodeJS.ProcessEnv,
  launchTimeout: number,
  hostPlatform: NodeJS.Platform,
  {
    shouldCaptureResult,
    acceptedStopInput = null,
  }: { shouldCaptureResult: boolean; acceptedStopInput?: Buffer | null },
): Promise<CapturedHookProcessResult> {
  const hookProcess = spawn(
    process.execPath,
    [hookScriptPath, "--root", projectRoot],
    {
      cwd: projectRoot,
      detached: hostPlatform !== "win32",
      env: hookEnvironment,
      shell: false,
      stdio: [acceptedStopInput === null ? "inherit" : "pipe", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  if (acceptedStopInput !== null && hookProcess.stdin !== null) {
    hookProcess.stdin.on("error", () => {
      // Ignore an evaluator closing stdin early; its real status and output determine the response.
    });
    hookProcess.stdin.end(acceptedStopInput);
  }
  if (!shouldCaptureResult && hookProcess.stdout && hookProcess.stderr) {
    hookProcess.stdout.pipe(process.stdout, { end: false });
    hookProcess.stderr.pipe(process.stderr, { end: false });
  }
  return captureHookProcessUntilDeadline(
    hookProcess,
    hookEnvironment,
    launchTimeout,
    hostPlatform,
    shouldCaptureResult,
  );
}
