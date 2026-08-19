/**
 * Builds the Bash command used after a user previews or starts installation.
 *
 * Use this boundary so native Windows selects Git Bash instead of the WSL shim while macOS, Linux, and WSL keep their existing installer command.
 * Failed discovery becomes actionable admission feedback before files change.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, dirname, win32 } from "node:path";

/** Successful Bash choice and arguments used to start the user's install. */
export interface InstallerInvocation {
  ok: true;
  bashCommand: string;
  args: string[];
}

/** Spawn-ready process details used after setup admission succeeds. */
export interface InstallerSpawnSpec {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

/** Actionable blocker shown when setup cannot start on the user's host. */
export interface InstallerInvocationError {
  ok: false;
  error: string;
}

/** User choices and host details needed to prepare one installer launch. */
export interface InstallerInvocationParams {
  scriptPath: string;
  projectPath: string;
  agent: string;
  installerFlags: readonly string[];
  platform: NodeJS.Platform;
  /**
   * Bash candidates to consider on Windows. Tests inject this list; production
   * code reads it from `where bash` via `discoverWindowsBashCandidates`.
   */
  windowsBashCandidates?: readonly string[];
}

/**
 * Supplies Windows discovery inputs without depending on a test machine's PATH.
 * Use in platform-independent tests; omitted fields use the user's real machine.
 */
export interface WindowsBashDiscoveryOptions {
  environment?: NodeJS.ProcessEnv;
  pathExists?: (candidate: string) => boolean;
  runWhere?: (executable: "bash" | "git") => readonly string[];
}

/**
 * Build the Bash command used after the user approves an install preview.
 * Use for both dry-run admission and real execution so they report the same blockers.
 *
 * @param params - Install choices; empty paths or agent values become installer validation errors.
 * @returns Runnable command, or an actionable Windows blocker; never null.
 */
export function buildInstallerInvocation(
  params: InstallerInvocationParams,
): InstallerInvocation | InstallerInvocationError {
  const installerFlags = [...params.installerFlags];

  // macOS, Linux, and WSL users keep the Bash command already selected by their shell.
  if (params.platform !== "win32") {
    return {
      ok: true,
      bashCommand: "bash",
      args: [
        params.scriptPath,
        params.projectPath,
        "--agent",
        params.agent,
        ...installerFlags,
      ],
    };
  }

  // Tests may provide candidates; normal Windows setup discovers the user's installed Bash options.
  const windowsBashCandidates =
    params.windowsBashCandidates ?? discoverWindowsBashCandidates();
  const selectedBashPath = pickWindowsBashPath(windowsBashCandidates);
  // No native Bash means both preview and install must stop with the same remediation.
  if (!selectedBashPath) {
    return {
      ok: false,
      error: buildWindowsBashMissingMessage(windowsBashCandidates),
    };
  }

  return {
    ok: true,
    bashCommand: selectedBashPath,
    args: [
      toBashPath(params.scriptPath),
      toBashPath(params.projectPath),
      "--agent",
      params.agent,
      ...installerFlags,
    ],
  };
}

/**
 * Build the process details used to start an admitted installer.
 * Use immediately before execution so Git Bash also wins child PATH lookup.
 *
 * @param invocation - Selected Bash and arguments; never empty after admission.
 * @param baseEnv - Environment to inherit; empty PATH is valid for restricted hosts.
 * @returns Command, arguments, and PATH-adjusted environment; never null.
 */
export function buildInstallerSpawnSpec(
  invocation: InstallerInvocation,
  baseEnv: NodeJS.ProcessEnv = process.env,
): InstallerSpawnSpec {
  return {
    command: invocation.bashCommand,
    args: invocation.args,
    env: installerSpawnEnv(invocation.bashCommand, baseEnv),
  };
}

/**
 * Convert a path to the slash form Bash accepts on every supported host.
 * Use for installer arguments; POSIX paths stay byte-identical for users.
 *
 * @param shellPath - Path passed to Bash; empty remains empty for downstream validation.
 * @returns Same path with Windows separators normalized; never null.
 */
export function toBashPath(shellPath: string): string {
  return shellPath.replace(/\\/g, "/");
}

/**
 * Build the environment for the selected installer Bash.
 * Use so Git Bash child commands resolve from the same installation the user previewed.
 *
 * @param bashCommand - Selected executable; empty is invalid before this method runs.
 * @param baseEnv - User environment; missing PATH is treated as an empty suffix.
 * @returns Environment passed to the installer; never null.
 */
function installerSpawnEnv(
  bashCommand: string,
  baseEnv: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  // POSIX shells already resolve the intended Bash and need no PATH rewrite.
  if (bashCommand === "bash") return baseEnv;
  // A restricted host may omit PATH; Git Bash's own folder still becomes usable.
  const existingPath = baseEnv.PATH ?? "";
  return {
    ...baseEnv,
    PATH: `${bashCommandDir(bashCommand)}${delimiter}${existingPath}`,
  };
}

/**
 * Find the folder containing the selected Bash executable.
 * Use Windows path rules only when the user's selected command is Windows-shaped.
 *
 * @param bashCommand - Selected Bash path; empty produces the current-directory dirname.
 * @returns Containing directory used for PATH precedence; never null.
 */
function bashCommandDir(bashCommand: string): string {
  // Drive-letter and backslash paths need Windows semantics even on a test host.
  if (/^[A-Za-z]:[\\/]/.test(bashCommand) || bashCommand.includes("\\")) {
    return win32.dirname(bashCommand);
  }
  return dirname(bashCommand);
}

/**
 * Pick the first native Windows Bash path in the user's discovery order.
 * Use a WSL denylist so Git Bash, MSYS2, Cygwin, Scoop, and Chocolatey remain valid.
 *
 * @param candidates - Discovered paths; blank entries do not represent an installation.
 * @returns First non-WSL path, or null when setup must show a Bash blocker.
 */
export function pickWindowsBashPath(
  candidates: readonly string[],
): string | null {
  // Trim and deduplicate results so one install is not presented repeatedly.
  const cleanedCandidatePaths = Array.from(
    new Set(
      candidates
        .map((candidate) => candidate.trim())
        .filter((candidate) => candidate.length > 0),
    ),
  );
  // No non-empty choices means the user has no Bash executable setup can inspect.
  if (cleanedCandidatePaths.length === 0) return null;
  const nativeBashPaths = cleanedCandidatePaths.filter(
    (candidate) => !isWslBashPath(candidate),
  );
  // An empty native list means every discovered executable would enter WSL.
  return nativeBashPaths[0] ?? null;
}

/**
 * Identify a Windows Bash path that would enter WSL instead of native Git Bash.
 * Use before admitting an install that passes Windows-shaped paths.
 *
 * @param candidate - Discovered Bash path; empty is treated as non-WSL and filtered elsewhere.
 * @returns True when the path is a known WSL launcher; never null.
 */
export function isWslBashPath(candidate: string): boolean {
  const normalised = candidate.replace(/\//g, "\\").toLowerCase();
  return (
    normalised.includes("\\system32\\bash.exe") ||
    normalised.includes("\\windowsapps\\bash.exe")
  );
}

/**
 * Resolve Windows' built-in PATH lookup without searching the user's selected project.
 * Use before setup asks Windows where Bash or Git is installed.
 *
 * @param environment - Host folders; missing or empty roots disable PATH lookup.
 * @returns Absolute System32 `where.exe`, or `null` when the host root is unavailable or relative.
 */
export function windowsWhereExecutablePath(
  environment: NodeJS.ProcessEnv,
): string | null {
  // An empty SystemRoot falls back to WINDIR; neither value may resolve from the project.
  const windowsSystemRoot = environment.SystemRoot || environment.WINDIR || "";
  // A missing or relative root cannot identify the operating system's trusted utility.
  if (!win32.isAbsolute(windowsSystemRoot)) {
    return null;
  }
  return win32.join(windowsSystemRoot, "System32", "where.exe");
}

/**
 * Ask Windows PATH for one executable while preparing an install or hook launch.
 * A missing command, timeout, or lookup error returns no choices instead of crashing the UI flow.
 * Side effect: starts `where.exe`; all process errors recover to standard-location discovery.
 *
 * @param executable - Bash or Git requested by setup; an empty value is impossible by type
 * @param environment - Host folders; missing system roots skip PATH lookup
 * @returns matching executable paths in PATH order; empty means setup must try standard locations
 */
function whereWindowsExecutable(
  executable: "bash" | "git",
  environment: NodeJS.ProcessEnv = process.env,
): string[] {
  try {
    const whereExecutablePath = windowsWhereExecutablePath(environment);
    // Without a trusted absolute utility path, known Git locations are safer than project lookup.
    if (whereExecutablePath === null) {
      return [];
    }
    const windowsPathOutput = execFileSync(whereExecutablePath, [executable], {
      encoding: "utf-8",
      timeout: 5000,
    });
    // Empty output means PATH offered no usable choice, so standard install locations are tried next.
    return windowsPathOutput
      .split(/\r?\n/)
      .map((executablePath) => executablePath.trim())
      .filter((executablePath) => executablePath.length > 0);
  } catch {
    // For example, a restricted PowerShell session may hide `where`; setup continues with known Git paths.
    return [];
  }
}

/**
 * Find Git Bash beside a Git executable already visible to the user.
 * Use when `bash` itself is hidden from PATH; `null` sends discovery to other install locations.
 *
 * @param gitExecutablePath - Git path reported by Windows; empty input produces no adjacent Bash path
 * @returns adjacent Bash executable, or `null` when Git is not in a recognized `cmd` or `bin` folder
 */
function bashBesideWindowsGit(gitExecutablePath: string): string | null {
  const gitExecutableDirectory = win32.dirname(gitExecutablePath.trim());
  const gitDirectoryName = win32.basename(gitExecutableDirectory).toLowerCase();
  // Git already lives in `bin`, so Bash is available beside the executable the user runs.
  if (gitDirectoryName === "bin") {
    return win32.join(gitExecutableDirectory, "bash.exe");
  }
  // Git for Windows exposes `cmd/git.exe`, while its compatible Bash lives in the sibling `bin` folder.
  if (gitDirectoryName === "cmd") {
    return win32.join(win32.dirname(gitExecutableDirectory), "bin", "bash.exe");
  }
  // An unfamiliar Git layout cannot safely identify Bash, so discovery keeps looking.
  return null;
}

/**
 * List standard Git Bash locations the installer can offer when PATH is incomplete.
 * Missing environment folders are normal and simply contribute no candidate for that install scope.
 *
 * @param environment - Windows folders visible to setup; empty means only the machine-wide default is tried
 * @returns possible Git Bash paths; entries may not exist and are checked before users rely on them
 */
function standardWindowsGitBashLocations(
  environment: NodeJS.ProcessEnv,
): string[] {
  const standardInstallLocations: string[] = [];
  // A machine-wide Git install is the normal choice offered to all Windows users.
  if (environment.ProgramFiles) {
    standardInstallLocations.push(
      win32.join(environment.ProgramFiles, "Git", "bin", "bash.exe"),
    );
  }
  // Some 64-bit shells expose ProgramW6432 instead of ProgramFiles.
  if (environment.ProgramW6432) {
    standardInstallLocations.push(
      win32.join(environment.ProgramW6432, "Git", "bin", "bash.exe"),
    );
  }
  // A 32-bit Git installation remains valid when that is what the user installed.
  if (environment["ProgramFiles(x86)"]) {
    standardInstallLocations.push(
      win32.join(environment["ProgramFiles(x86)"], "Git", "bin", "bash.exe"),
    );
  }
  // Per-user Git installs work without administrator access and live under LocalAppData.
  if (environment.LOCALAPPDATA) {
    standardInstallLocations.push(
      win32.join(
        environment.LOCALAPPDATA,
        "Programs",
        "Git",
        "bin",
        "bash.exe",
      ),
    );
  }
  // A stripped environment can still use Git for Windows at its documented machine-wide default.
  standardInstallLocations.push("C:\\Program Files\\Git\\bin\\bash.exe");
  return standardInstallLocations;
}

/**
 * Find Windows-compatible Bash choices before setup reports whether installation can run.
 * PATH choices keep user preference; adjacent and standard Git installs rescue machines where Windows exposes only the WSL shim.
 *
 * @param options - optional test inputs; empty uses the user's environment, filesystem, and PATH
 * @returns Bash paths in preference order; empty means setup must show a blocked admission result
 */
export function discoverWindowsBashCandidates(
  options: WindowsBashDiscoveryOptions = {},
): string[] {
  // No test environment was supplied, so discovery reflects the Windows session the user launched.
  const environment = options.environment ?? process.env;
  // Production checks the real filesystem; tests may describe a Windows layout on another host.
  const pathExists = options.pathExists ?? existsSync;
  // Production asks System32 `where.exe`; tests can provide deterministic Bash and Git results.
  const runWhere =
    options.runWhere ??
    ((executable) => whereWindowsExecutable(executable, environment));
  const pathBashCandidates = [...runWhere("bash")];
  // Only recognized Git layouts can offer a trustworthy adjacent Bash executable.
  const gitDerivedBashCandidates = runWhere("git")
    .map(bashBesideWindowsGit)
    .filter((bashPath): bashPath is string => bashPath !== null);
  // Standard paths are offered only when the corresponding executable exists for this user.
  const existingStandardInstallCandidates =
    standardWindowsGitBashLocations(environment).filter(pathExists);
  const discoveredBashCandidates = [
    ...pathBashCandidates,
    ...gitDerivedBashCandidates.filter(pathExists),
    ...existingStandardInstallCandidates,
  ];
  // Case-insensitive deduplication keeps the preview stable when Windows reports the same install twice.
  return Array.from(
    new Map(
      discoveredBashCandidates.map((bashPath) => [
        bashPath.toLowerCase(),
        bashPath,
      ]),
    ).values(),
  );
}

/**
 * Render the blocker shown when Windows setup cannot find native Bash.
 * Use in dry-run and real install output so both give identical remediation.
 *
 * @param candidates - Rejected paths; empty means discovery found nothing to list.
 * @returns Multi-line Git Bash and WSL remediation message; never empty.
 */
export function buildWindowsBashMissingMessage(
  candidates: readonly string[],
): string {
  // Blank discovery output is omitted because it gives the user no path to diagnose.
  const rejected = candidates
    .map((candidate) => candidate.trim())
    .filter((candidate) => candidate.length > 0);
  const lines = [
    "Install requires a Windows-compatible Bash, but none was found.",
  ];
  // Rejected paths explain when Windows found only launchers that enter WSL.
  if (rejected.length > 0) {
    lines.push("Detected candidates (all rejected as WSL launchers):");
    // Each path gives the user one concrete PATH entry to remove or reprioritize.
    for (const candidate of rejected) {
      lines.push(`  - ${candidate}`);
    }
  } else {
    lines.push("`where bash` returned no candidates.");
  }
  lines.push(
    "Install Git for Windows (https://git-scm.com/download/win) and re-run from",
    "PowerShell or CMD, or run the command from inside WSL using /mnt/c/... paths.",
  );
  return lines.join("\n");
}
