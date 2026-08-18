/**
 * Works out exactly how to launch the agent a user picked in the dashboard terminal.
 *
 * Turning "run Claude here, in reporting mode" into a real command means resolving where that CLI actually lives on this machine, choosing a shell
 * that behaves the same on Windows and POSIX, and deciding which flags put the session into the restricted reporting profile.
 *
 * Anything that differs between platforms is settled here rather than inside session management, so a user on Windows and a user on macOS get the
 * same terminal behaviour from the same code path.
 *
 * A runner that cannot be found comes back as null so the caller can tell the user their CLI is not installed, instead of spawning a shell that fails
 * cryptically.
 */
import { execFileSync } from "node:child_process";
import { extname } from "node:path";
import type { WebSocket } from "ws";
import type { Runner, ServerMessage, TerminalAccessMode } from "./types.js";
import {
  buildClaudeReportingSettings,
  buildCodexReportingProfile,
  CODEX_REPORTING_PROFILE_NAME,
} from "./terminal-reporting-profile.js";

/** Validated access mode and environment passed from launch policy into PTY creation. */
interface TerminalSpawnContext {
  accessMode: TerminalAccessMode;
  env: NodeJS.ProcessEnv;
}

/** Maximum characters written to the PTY in one go when pasting a prompt. */
export const INITIAL_PROMPT_CHUNK_SIZE = 2048;

/** Shell, arguments, environment, and deferred input needed to launch one user-visible runner PTY. */
export interface TerminalSpawnSpec {
  shell: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  initialInput: string | null;
}

/** Extra access and workspace context needed for runner-specific launch policy. */
export interface TerminalSpawnOptions {
  accessMode?: TerminalAccessMode;
  projectPath?: string;
  targetPath?: string;
  qualityReportProjectPath?: string;
}

const WINDOWS_RUNNER_EXTENSION_PRIORITY = [
  ".exe",
  ".cmd",
  ".bat",
  ".com",
  ".ps1",
] as const;
const WINDOWS_TERMINAL_SHELL = "powershell.exe";
const POSIX_PROMPT_ENV_CLEANUP =
  "unset GOAT_RUNNER GOAT_CODEX_REPORTING_PROFILE GOAT_CLAUDE_REPORTING_SETTINGS";
const WINDOWS_PROMPT_ENV_CLEANUP =
  "Remove-Item Env:GOAT_RUNNER -ErrorAction SilentlyContinue; Remove-Item Env:GOAT_CODEX_REPORTING_PROFILE -ErrorAction SilentlyContinue; Remove-Item Env:GOAT_CLAUDE_REPORTING_SETTINGS -ErrorAction SilentlyContinue";
const CODEX_DASHBOARD_ARGS = "--sandbox danger-full-access";
const CODEX_REPORTING_DEFAULT_PERMISSION = `default_permissions="${CODEX_REPORTING_PROFILE_NAME}"`;
const CODEX_REPORTING_APPROVAL_ARGS = "--ask-for-approval never";
const CLAUDE_REPORTING_ARGS =
  '--setting-sources= --settings "$GOAT_CLAUDE_REPORTING_SETTINGS" --permission-mode dontAsk';
const WINDOWS_CLAUDE_REPORTING_ARGS =
  "--setting-sources= --settings $env:GOAT_CLAUDE_REPORTING_SETTINGS --permission-mode dontAsk";
/**
 * Wrap a launch prompt so the runner receives it as one paste, not as typing.
 * Use when the dashboard opens a terminal with a prompt already filled in, so the agent sees the whole instruction at once instead of reacting to it
 * line by line.
 *
 * @param prompt - full prompt text the user is launching with
 * @returns the bracketed-paste payload, ending in a return so the runner starts immediately
 */
function formatInitialPromptInput(prompt: string): string {
  return "\x1b[200~" + prompt + "\x1b[201~" + "\r";
}

/**
 * Split terminal input into bounded chunks for PTY write reliability.
 *
 * @param input Full terminal payload to write.
 * @param chunkSize Maximum characters per PTY write; must be a positive integer.
 * @returns Ordered chunks that concatenate back to the original input.
 * @throws Error when `chunkSize` is not a positive integer.
 */
export function chunkTerminalInput(
  input: string,
  chunkSize = INITIAL_PROMPT_CHUNK_SIZE,
): string[] {
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new Error("chunkSize must be a positive integer");
  }
  const chunks: string[] = [];
  for (let index = 0; index < input.length; index += chunkSize) {
    chunks.push(input.slice(index, index + chunkSize));
  }
  return chunks;
}

/**
 * Pick the most runnable Windows runner path from a `where` result set.
 * Extension priority is a stable contract: the same candidate list always yields the same executable, so a user does not get a different runner
 * between launches.
 *
 * @param candidates - raw paths returned by `where`, including possible blank or duplicate lines
 * @returns the preferred executable-like path, or null when nothing usable remains and the caller must report the runner as missing
 */
export function pickWindowsRunnerPath(
  candidates: readonly string[],
): string | null {
  const cleaned = Array.from(
    new Set(
      candidates
        .map((candidate) => candidate.trim())
        .filter((candidate) => {
          return candidate.length > 0;
        }),
    ),
  );
  if (cleaned.length === 0) return null;

  // Lower rank wins: a real executable extension beats an unknown one, which is what stops a shim being launched instead of the runner.
  const rank = (candidate: string): number => {
    const ext = extname(candidate).toLowerCase();
    const index = WINDOWS_RUNNER_EXTENSION_PRIORITY.indexOf(
      ext as (typeof WINDOWS_RUNNER_EXTENSION_PRIORITY)[number],
    );
    return index === -1 ? WINDOWS_RUNNER_EXTENSION_PRIORITY.length : index;
  };

  cleaned.sort((left, right) => rank(left) - rank(right));
  return cleaned[0] ?? null;
}

/** Build the runner command embedded in the shell wrapper. */
function terminalRunnerCommand(
  runner: Runner,
  platform: NodeJS.Platform,
  accessMode: TerminalAccessMode,
): string {
  if (runner === "claude" && accessMode === "reporting") {
    return platform === "win32"
      ? `& $env:GOAT_RUNNER ${WINDOWS_CLAUDE_REPORTING_ARGS}`
      : `"$GOAT_RUNNER" ${CLAUDE_REPORTING_ARGS}`;
  }
  if (runner !== "codex") {
    return platform === "win32" ? "& $env:GOAT_RUNNER" : '"$GOAT_RUNNER"';
  }
  if (accessMode === "reporting") {
    return platform === "win32"
      ? `& $env:GOAT_RUNNER -c $env:GOAT_CODEX_REPORTING_PROFILE -c '${CODEX_REPORTING_DEFAULT_PERMISSION}' ${CODEX_REPORTING_APPROVAL_ARGS} --strict-config`
      : `"$GOAT_RUNNER" -c "$GOAT_CODEX_REPORTING_PROFILE" -c '${CODEX_REPORTING_DEFAULT_PERMISSION}' ${CODEX_REPORTING_APPROVAL_ARGS} --strict-config`;
  }
  return platform === "win32"
    ? `& $env:GOAT_RUNNER ${CODEX_DASHBOARD_ARGS}`
    : `"$GOAT_RUNNER" ${CODEX_DASHBOARD_ARGS}`;
}

/** Resolve access defaults and runner-specific environment for one PTY spawn. */
function terminalSpawnContext(
  runner: Runner,
  cliPath: string,
  environment: NodeJS.ProcessEnv,
  options: TerminalSpawnOptions,
): TerminalSpawnContext {
  const accessMode = options.accessMode ?? "workspace";
  const projectPath = options.projectPath ?? process.cwd();
  const targetPath = options.targetPath ?? projectPath;
  const env: NodeJS.ProcessEnv = {
    ...environment,
    GOAT_RUNNER: cliPath,
  };
  // Codex receives the quality mode's explicit owner so report writes reach the project shown in the UI.
  if (runner === "codex" && accessMode === "reporting") {
    env.GOAT_CODEX_REPORTING_PROFILE = buildCodexReportingProfile(
      projectPath,
      targetPath,
      options.qualityReportProjectPath ?? projectPath,
    );
  }
  // Claude reporting uses its separate settings overlay and dashboard-owned draft capture.
  if (runner === "claude" && accessMode === "reporting") {
    env.GOAT_CLAUDE_REPORTING_SETTINGS = buildClaudeReportingSettings(
      projectPath,
      targetPath,
      environment,
    );
  }
  return { accessMode, env };
}

/**
 * Build the PTY shell invocation for the selected dashboard mode.
 * Workspace runners return users to a shell; restricted reporting runners close when their task ends.
 *
 * @param runner Runner identity used for runner-specific launch flags.
 * @param cliPath Absolute runner binary path to launch inside the shell.
 * @param prompt Optional launch prompt delivered through PTY input after startup; empty means the user starts manually.
 * @param environment Environment snapshot merged into the spawned process; an empty object gives the runner no inherited variables.
 * @param platform Platform selector used by tests and cross-platform launch planning.
 * @param options Access mode plus validated controller/target roots; omitted values select a normal workspace session.
 * @returns Spawn details plus deferred input; `initialInput: null` means no prompt waits to be sent.
 */
export function buildTerminalSpawnSpec(
  runner: Runner,
  cliPath: string,
  prompt: string,
  environment: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
  options: TerminalSpawnOptions = {},
): TerminalSpawnSpec {
  const hasPrompt = prompt.length > 0;
  const { accessMode, env } = terminalSpawnContext(
    runner,
    cliPath,
    environment,
    options,
  );
  const initialInput = hasPrompt ? formatInitialPromptInput(prompt) : null;

  // Windows reporting closes with its runner, while a normal workspace keeps PowerShell available.
  if (platform === "win32") {
    return {
      shell: WINDOWS_TERMINAL_SHELL,
      args: [
        "-NoLogo",
        ...(accessMode === "workspace" ? ["-NoExit"] : []),
        "-Command",
        `try { ${terminalRunnerCommand(runner, platform, accessMode)} } finally { ${WINDOWS_PROMPT_ENV_CLEANUP} }`,
      ],
      env,
      initialInput,
    };
  }

  const configuredShell = environment.SHELL;
  const shell = configuredShell?.length ? configuredShell : "/bin/bash";
  const runnerCommand = terminalRunnerCommand(runner, platform, accessMode);
  const shellCmd =
    accessMode === "reporting"
      ? `${runnerCommand}; ${POSIX_PROMPT_ENV_CLEANUP}`
      : `${runnerCommand}; ${POSIX_PROMPT_ENV_CLEANUP}; exec "$SHELL" -i`;

  return {
    shell,
    args: ["-c", shellCmd],
    env: {
      ...env,
      SHELL: shell,
    },
    initialInput,
  };
}

/**
 * Resolve a CLI binary by reading the process PATH through platform lookup tools.
 * Reads process state only; swallows lookup errors and reports them as null because missing runners are normal dashboard state.
 *
 * @param name - runner binary to find, such as `claude` or `codex`
 * @returns the resolved path, or null when the user does not have that CLI installed - which
 *   the dashboard shows as an unavailable runner rather than an error
 */
export function resolveCLIPath(name: string): string | null {
  if (process.platform === "win32") {
    try {
      const candidates = execFileSync("where", [name], {
        encoding: "utf-8",
        timeout: 5000,
      })
        .split(/\r?\n/)
        .map((candidate) => candidate.trim())
        .filter(Boolean);
      const preferred = pickWindowsRunnerPath(candidates);
      if (preferred) return preferred;
      return null;
    } catch {
      /* passive detection only; do not execute runner binaries at startup */
      return null;
    }
  }

  try {
    return execFileSync("which", [name], {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
  } catch {
    try {
      return (
        execFileSync("where", [name], { encoding: "utf-8", timeout: 5000 })
          .trim()
          .split("\n")[0]
          ?.trim() ?? null
      );
    } catch {
      return null;
    }
  }
}

/**
 * Clamp a terminal size the browser reported into a range the PTY can accept.
 * Use on every resize, so a hidden or mid-animation panel reporting zero columns cannot collapse the user's terminal or crash the session.
 *
 * @param dimensionValue - raw rows or columns from the browser; a missing or non-numeric
 *   value falls back to the default rather than propagating
 * @param max - upper bound for this dimension
 * @param fallback - value used when the reported dimension is unusable
 * @returns a whole number inside the accepted range, always safe to hand to the PTY
 */
export function clampDim(
  dimensionValue: unknown,
  max: number,
  fallback: number,
): number {
  return Number.isInteger(dimensionValue) &&
    (dimensionValue as number) > 0 &&
    (dimensionValue as number) <= max
    ? (dimensionValue as number)
    : fallback;
}

/**
 * Send a terminal message only while the user's browser socket is still open.
 * Writing to a closed socket throws, and a user closing a tab mid-session is completely normal, so a closed socket is silently skipped rather than
 * treated as an error.
 *
 * @param socket - the browser connection for this session
 * @param msg - message to deliver; dropped entirely if the user has already disconnected
 */
export function sendMessage(socket: WebSocket, msg: ServerMessage): void {
  if (socket.readyState === 1) {
    // WebSocket.OPEN
    socket.send(JSON.stringify(msg));
  }
}

/**
 * Tell a pasted launch prompt apart from something the user typed.
 * Used by tracing so the record shows whether input came from the dashboard's launch flow or from the person at the keyboard.
 *
 * @param input - raw text about to be written to the PTY
 * @returns true when this is a bracketed paste, meaning a launch prompt rather than typing
 */
export function looksLikePromptSend(input: string): boolean {
  return input.includes("\x1b[200~");
}
