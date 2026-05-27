/**
 * Cross-platform invocation helpers for the bundled Bash installer.
 *
 * `handleInstallCommand` shells out to `workflow/install-goat-flow.sh` via
 * `spawnSync("bash", ...)`. On native Windows two things go wrong with the
 * naive call:
 *
 *   1. `getTemplatePath()` and `resolve(".")` return backslash paths. When
 *      Bash receives them as argv, the backslashes act as shell escapes and
 *      collapse the path (e.g. `C:\Users\...\install.sh` -> `CUsers...`).
 *   2. `bash` on a stock Windows host resolves to `System32\bash.exe` (WSL)
 *      or the `WindowsApps\bash.exe` proxy first, which does not accept
 *      Windows-shaped paths and is slow to boot from PowerShell.
 *
 * This module owns the platform-gated argument shape and the Bash selection
 * policy. POSIX behavior is intentionally byte-for-byte unchanged.
 */

import { execFileSync } from "node:child_process";

/** Successful invocation spec. */
export interface InstallerInvocation {
  ok: true;
  bashCommand: string;
  args: string[];
}

/** Failure with a CLI-ready error message. */
export interface InstallerInvocationError {
  ok: false;
  error: string;
}

/** Inputs needed to build the installer call. */
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
 * Build the (bash, argv) pair that `spawnSync` should use.
 *
 * Linux/macOS/WSL (`platform` other than `"win32"`): returns the raw inputs
 * with `bash` as the command. The shape matches the historical call so POSIX
 * users see no behavioural change.
 *
 * Native Windows (`platform === "win32"`): forward-slash-normalises the script
 * and project paths so Git Bash / MSYS2 receive a valid path, and picks a
 * non-WSL `bash.exe` from the supplied candidates.
 *
 * @param params Installer script, target project, agent, flags, and platform-specific Bash candidates.
 * @returns Spawn-ready Bash command and argv, or a CLI-ready error when Windows has no usable Bash.
 */
export function buildInstallerInvocation(
  params: InstallerInvocationParams,
): InstallerInvocation | InstallerInvocationError {
  const installerFlags = [...params.installerFlags];

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

  const candidates =
    params.windowsBashCandidates ?? discoverWindowsBashCandidates();
  const selected = pickWindowsBashPath(candidates);
  if (!selected) {
    return {
      ok: false,
      error: buildWindowsBashMissingMessage(candidates),
    };
  }

  return {
    ok: true,
    bashCommand: selected,
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
 * Convert a Windows path to a form Bash will not shell-escape.
 *
 * Drive-letter:  `C:\Users\me` -> `C:/Users/me`
 * UNC share:    `\\srv\share\x` -> `//srv/share/x`
 *
 * POSIX paths contain no backslashes so the operation is a no-op for them,
 * which matters because tests assert that POSIX inputs are byte-identical.
 *
 * @param shellPath Path argument that will be passed to Bash.
 * @returns The same path with Windows backslashes converted to forward slashes.
 */
export function toBashPath(shellPath: string): string {
  return shellPath.replace(/\\/g, "/");
}

/**
 * Pick the first Windows `bash.exe` that is not one of the known WSL shims.
 *
 * We reject by path rather than allowlist Git Bash because users may install
 * MSYS2, Cygwin, Scoop, or Chocolatey distributions whose paths are not
 * predictable. The two known-bad locations both belong to WSL:
 *
 *  - `C:\Windows\System32\bash.exe` (Windows Subsystem for Linux launcher)
 *  - `%LOCALAPPDATA%\Microsoft\WindowsApps\bash.exe` (Store-managed WSL proxy)
 *
 * @param candidates Raw `where bash` output lines or test-injected candidate paths.
 * @returns First non-WSL Bash path, or null when every candidate is unusable.
 */
export function pickWindowsBashPath(
  candidates: readonly string[],
): string | null {
  const cleaned = Array.from(
    new Set(
      candidates
        .map((candidate) => candidate.trim())
        .filter((candidate) => candidate.length > 0),
    ),
  );
  if (cleaned.length === 0) return null;
  const accepted = cleaned.filter((candidate) => !isWslBashPath(candidate));
  return accepted[0] ?? null;
}

/**
 * True if the candidate path matches a known WSL launcher location.
 *
 * @param candidate Bash executable path from discovery.
 * @returns Whether the candidate is a WSL launcher that rejects Windows-shaped installer paths.
 */
export function isWslBashPath(candidate: string): boolean {
  const normalised = candidate.replace(/\//g, "\\").toLowerCase();
  return (
    normalised.includes("\\system32\\bash.exe") ||
    normalised.includes("\\windowsapps\\bash.exe")
  );
}

/** Probe `where bash` for candidate paths; reads PATH and swallows command failures as no candidates. */
function discoverWindowsBashCandidates(): string[] {
  try {
    const output = execFileSync("where", ["bash"], {
      encoding: "utf-8",
      timeout: 5000,
    });
    return output
      .split(/\r?\n/)
      .map((candidate) => candidate.trim())
      .filter((candidate) => candidate.length > 0);
  } catch {
    return [];
  }
}

/**
 * Render the actionable error when no usable Bash is found on Windows.
 *
 * @param candidates Rejected Bash paths from discovery, if any.
 * @returns Multi-line CLI error that explains the Git Bash and WSL fallback options.
 */
export function buildWindowsBashMissingMessage(
  candidates: readonly string[],
): string {
  const rejected = candidates
    .map((candidate) => candidate.trim())
    .filter((candidate) => candidate.length > 0);
  const lines = [
    "Install requires a Windows-compatible Bash, but none was found.",
  ];
  if (rejected.length > 0) {
    lines.push("Detected candidates (all rejected as WSL launchers):");
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
