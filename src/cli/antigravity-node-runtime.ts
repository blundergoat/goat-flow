/**
 * Warn before Antigravity on WSL blocks every tool call because its hook runner cannot find Node.
 *
 * The warning goes to stderr only, so audit and hook-verification reports stay identical on every machine.
 */
import { accessSync, constants, readFileSync, statSync } from "node:fs";
import { release } from "node:os";
import { join, posix } from "node:path";

/**
 * Directories on the PATH the Antigravity 2.34.0 agent server received on WSL, read from its process environment on 2026-11-24.
 *
 * WSL's init starts that server without a shell, so a `node` that nvm, fnm, volta, asdf or mise adds from a shell profile is absent.
 */
const ANTIGRAVITY_WSL_SERVER_PATH: readonly string[] = [
  "/usr/local/sbin",
  "/usr/local/bin",
  "/usr/sbin",
  "/usr/bin",
  "/sbin",
  "/bin",
  "/usr/games",
  "/usr/local/games",
  "/usr/lib/wsl/lib",
];

/** Every goat-flow Antigravity registration names this bootstrap, so hook files that goat-flow did not write stay silent. */
const ANTIGRAVITY_BOOTSTRAP_MARKER = "antigravity-hook-bootstrap.cjs";

/** Host facts the warning depends on; tests inject them instead of changing the machine. */
export interface AntigravityNodeHost {
  platform: NodeJS.Platform;
  kernelRelease: string;
  readHooksConfig: () => string | null;
  isExecutableFile: (filePath: string) => boolean;
}

/**
 * Explain why Antigravity hooks will fail before any policy code runs, when this host shows that condition.
 *
 * @param host - Platform, kernel release, a reader for `.agents/hooks.json`, and an executable-file test.
 * @returns The warning text, or null when the host is not WSL, the project has no goat-flow Antigravity hooks, or Node is reachable.
 */
export function antigravityNodeRuntimeWarning(
  host: AntigravityNodeHost,
): string | null {
  // Only WSL was observed starting the Antigravity server without a shell, so other hosts stay silent.
  if (host.platform !== "linux" || !/microsoft/iu.test(host.kernelRelease)) {
    return null;
  }
  const hooksConfig = host.readHooksConfig();
  // A project without goat-flow's Antigravity registrations has no hook that could block a tool call.
  if (
    hooksConfig === null ||
    !hooksConfig.includes(ANTIGRAVITY_BOOTSTRAP_MARKER)
  ) {
    return null;
  }
  // Any executable node on the server's PATH lets the hook start.
  if (
    ANTIGRAVITY_WSL_SERVER_PATH.some((directory) =>
      host.isExecutableFile(posix.join(directory, "node")),
    )
  ) {
    return null;
  }
  return [
    'warning: Antigravity on WSL cannot start this project\'s goat-flow hooks: no executable "node" exists in /usr/local/bin, /usr/bin, /bin or the other system directories on its PATH.',
    'Antigravity starts hooks without your shell profile, so it cannot see a node from nvm, fnm, volta, asdf or mise. Antigravity\'s command and file tools will all fail with "sh: 1: node: not found" or "node: Permission denied" (exit 127).',
    'Fix: install Node system-wide, for example the NodeSource "nodejs" package, so /usr/bin/node exists. See "Troubleshooting a blocked check" in goat-flow\'s docs/guardrails.md.',
  ].join("\n");
}

/**
 * Print the Antigravity Node warning to stderr when it applies; command output and exit status stay unchanged.
 *
 * @param projectPath - Absolute target project path whose `.agents/hooks.json` is read.
 * @param selectedAgent - Agent the command is scoped to, or null when the command covers every agent.
 * @returns Nothing; writes at most one warning to stderr.
 */
export function warnIfAntigravityCannotStartNode(
  projectPath: string,
  selectedAgent: string | null,
): void {
  // A command scoped to another agent should not report an Antigravity host problem.
  if (selectedAgent !== null && selectedAgent !== "antigravity") return;
  const warning = antigravityNodeRuntimeWarning({
    platform: process.platform,
    kernelRelease: release(),
    readHooksConfig: () =>
      readOptionalText(join(projectPath, ".agents", "hooks.json")),
    isExecutableFile,
  });
  // Silence is the common case: not WSL, no Antigravity hooks, or Node is reachable.
  if (warning !== null) process.stderr.write(`${warning}\n`);
}

/**
 * Read a file that may not exist; swallows read errors because a missing or unreadable file has no registration to warn about.
 *
 * @param filePath - Absolute path to read as UTF-8.
 * @returns The file text, or null when it is missing or unreadable.
 */
function readOptionalText(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

/**
 * Report whether a path is a file the current user may execute; swallows stat and access errors because each one means node cannot run from that path.
 *
 * @param filePath - Absolute candidate path for `node`.
 * @returns True for an executable regular file, including through a symlink; false for directories, missing paths and files without execute permission.
 */
export function isExecutableFile(filePath: string): boolean {
  try {
    // statSync follows symlinks, so a link to a version-manager binary counts when its target is executable.
    if (!statSync(filePath).isFile()) return false;
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
