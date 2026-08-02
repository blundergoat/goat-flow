/**
 * PTY-backed terminal session manager used by the dashboard.
 * It validates runner and project inputs, spawns CLI sessions, and brokers WebSocket traffic.
 */
import { randomUUID } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { extname, isAbsolute, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import type { WebSocket } from "ws";
import type {
  SessionInfo,
  SessionStatus,
  CreateResponse,
  HealthResponse,
  ServerMessage,
  Runner,
  TerminalAccessMode,
} from "./types.js";
import { decodeClientMessage } from "./decoders.js";
import { getAgentProfiles } from "../agents/registry.js";
import { isPathWithin, validateProjectPath } from "./local-paths.js";
import {
  ensureQualityDraftStagingDirectory,
  startQualityDraftCapture,
  type QualityDraftCapture,
} from "./quality-draft-capture.js";

/** Shape of the optional node-pty module without making startup resolve the native package. */
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- because node-pty may be absent until a user opens a terminal
type NodePtyModule = typeof import("node-pty");
/** PTY process handle shape; kept lazy for the same optional native dependency boundary. */
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- because static type imports still require node-pty to resolve
type IPty = ReturnType<typeof import("node-pty").spawn>;

/** Maximum number of concurrent terminal sessions allowed.
 *  Single source of truth consumed by the dashboard API, client guards, and docs. */
export const MAX_SESSIONS = 10;
const DEFAULT_IDLE_TIMEOUT_MINUTES = 480; // Default limit: one workday keeps abandoned PTYs from surviving overnight.

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
const CODEX_REPORTING_PROFILE_NAME = "goat_flow_reporting";
const CODEX_REPORTING_DEFAULT_PERMISSION = `default_permissions="${CODEX_REPORTING_PROFILE_NAME}"`;
const CODEX_REPORTING_APPROVAL_ARGS = "--ask-for-approval never";
const CLAUDE_REPORTING_ARGS =
  '--setting-sources= --settings "$GOAT_CLAUDE_REPORTING_SETTINGS" --permission-mode dontAsk';
const WINDOWS_CLAUDE_REPORTING_ARGS =
  "--setting-sources= --settings $env:GOAT_CLAUDE_REPORTING_SETTINGS --permission-mode dontAsk";
const REPORTING_LOCAL_STATE_PATHS = [
  ".goat-flow/logs",
  ".goat-flow/scratchpad",
  ".goat-flow/plans",
] as const;
const REPORTING_IGNORED_PATH_CANDIDATES = [
  ".claude/worktrees",
  "dist",
  "node_modules",
  "out",
  "_temp",
  "logs",
  "coverage",
  ".nyc_output",
  "build",
  ".tools",
] as const;
const REPORTING_COMMITTED_ANCHOR_FALLBACKS = [
  ".goat-flow/logs/critiques/README.md",
  ".goat-flow/logs/events/README.md",
  ".goat-flow/logs/quality/README.md",
  ".goat-flow/logs/review/README.md",
  ".goat-flow/logs/security/README.md",
  ".goat-flow/logs/sessions/.gitkeep",
  ".goat-flow/logs/sessions/README.md",
  ".goat-flow/plans/.gitignore",
  ".goat-flow/plans/README.md",
  ".goat-flow/scratchpad/.gitignore",
  ".goat-flow/scratchpad/README.md",
] as const;
const REPORTING_SECRET_DENIES = [
  "**/.env",
  "**/.env.local",
  "**/.env.development",
  "**/.env.production",
  "**/.env.staging",
  "**/.env.test",
  "**/.envrc",
  "**/.env.*.local",
  "**/secrets/**",
  "**/.ssh/**",
  "**/.aws/**",
  "**/.docker/**",
  "**/.gnupg/**",
  "**/.kube/**",
  "**/credentials*",
  "**/.npmrc",
  "**/.pypirc",
  "**/*.pem",
  "**/*.key",
  "**/*.pfx",
] as const;
const CLAUDE_REPORTING_HOME_SECRET_DENIES = [
  "~/.env",
  "~/.env.*",
  "~/.claude/.credentials.json",
  "~/.ssh/**",
  "~/.aws/**",
  "~/.docker/**",
  "~/.gnupg/**",
  "~/.kube/**",
  "~/.npmrc",
  "~/.pypirc",
  "~/credentials*",
  "~/**/*.pem",
  "~/**/*.key",
  "~/**/*.pfx",
] as const;
const INITIAL_PROMPT_AFTER_OUTPUT_DELAY_MS = 150;
const INITIAL_PROMPT_FALLBACK_DELAY_MS = 5000;
export const INITIAL_PROMPT_CHUNK_SIZE = 2048;

const DETACH_BUFFER_LIMIT = 512 * 1024; // Buffer limit: 512KB preserves reconnect scrollback without unbounded server memory.

/** Internal state for a single PTY terminal session */
interface TerminalSession {
  id: string;
  status: SessionStatus;
  createdAt: string;
  /** Selected target project for code evidence and dashboard grouping. */
  projectPath: string;
  /** Actual PTY working directory where the runner was spawned. */
  cwd: string;
  /** Explicit target project path passed to the launched agent. */
  targetPath: string;
  runner: Runner;
  accessMode: TerminalAccessMode;
  lastInputAt: number;
  pty: IPty | null;
  ws: WebSocket | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
  /** Buffered PTY output accumulated while no WebSocket is attached. */
  detachBuffer: string[];
  /** Total character count in detachBuffer (for limit enforcement). */
  detachBufferSize: number;
  /** Staged-draft persistence pollers for enforced Claude reporting sessions (ADR-044). */
  qualityCaptures: QualityDraftCapture[];
}

/** Shell, arguments, environment, and deferred input needed to launch a runner in a durable PTY. */
interface TerminalSpawnSpec {
  shell: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  initialInput: string | null;
}

/** Extra access and workspace context needed for runner-specific launch policy. */
interface TerminalSpawnOptions {
  accessMode?: TerminalAccessMode;
  projectPath?: string;
  targetPath?: string;
}

/** Validated access mode and environment passed from launch policy into PTY creation. */
interface TerminalSpawnContext {
  accessMode: TerminalAccessMode;
  env: NodeJS.ProcessEnv;
}

type TerminalTraceEventKind = "terminal.send" | "prompt.send";

/** Redaction-ready input metadata emitted for terminal auditing without changing PTY delivery. */
export interface TerminalTraceEvent {
  eventKind: TerminalTraceEventKind;
  sessionId: string;
  projectPath: string;
  cwd: string;
  targetPath: string;
  runner: Runner;
  input: string;
  bytes: number;
}

/** Observer hook for terminal input traces; sink failures are isolated from session writes. */
export type TerminalTraceSink = (event: TerminalTraceEvent) => void;

/** Format a full prompt as one terminal paste submitted once to the runner. */
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
 *
 * @param candidates Raw paths returned by `where`, including possible blank or duplicate lines.
 * @returns The preferred executable-like path, or null when nothing usable remains.
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

/** Encode one TOML basic string for a CLI inline-table override. */
function tomlString(value: string): string {
  return JSON.stringify(value);
}

/** Encode string-keyed TOML inline-table entries in stable insertion order. */
function tomlInlineTable(
  entries: ReadonlyArray<readonly [string, string | boolean]>,
): string {
  const encodedEntries = entries.map(([key, value]) => {
    const encodedValue = typeof value === "string" ? tomlString(value) : value;
    const encodedKey = tomlString(key);
    return `${encodedKey}=${encodedValue}`;
  });
  return `{${encodedEntries.join(",")}}`;
}

/** Run Git to prove a local/build path is ignored; command errors recover to false and grant no writes. */
function isGitIgnoredPath(projectPath: string, relativePath: string): boolean {
  try {
    execFileSync(
      "git",
      ["-C", projectPath, "check-ignore", "--quiet", "--", relativePath],
      { stdio: "ignore", timeout: 5000 },
    );
    return true;
  } catch {
    // A non-repository root or unavailable Git cannot safely authorize writes.
    return false;
  }
}

/** Read tracked files beneath candidate writable paths so exact files stay read-only. */
function trackedReportingAnchors(
  projectPath: string,
  candidatePaths: readonly string[],
): string[] {
  try {
    return execFileSync(
      "git",
      ["-C", projectPath, "ls-files", "-z", "--", ...candidatePaths],
      {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 5000,
      },
    )
      .split("\0")
      .filter((path) => path.length > 0);
  } catch {
    // Canonical committed anchors below remain the conservative fallback.
    return [];
  }
}

/** Confirm a candidate write root exists as a real directory in every workspace. */
function isSharedDirectory(
  rootPaths: readonly string[],
  relativePath: string,
): boolean {
  return rootPaths.every((rootPath) => {
    try {
      const candidatePath = join(rootPath, relativePath);
      const stat = lstatSync(candidatePath);
      const realRootPath = realpathSync(rootPath);
      const realCandidatePath = realpathSync(candidatePath);
      return (
        stat.isDirectory() &&
        !stat.isSymbolicLink() &&
        isPathWithin(realRootPath, realCandidatePath)
      );
    } catch {
      return false;
    }
  });
}

/** List tracked and canonical protected paths beneath one candidate in one root. */
function protectedPathsForCandidate(
  rootPath: string,
  candidatePath: string,
): string[] {
  const canonicalAnchors = REPORTING_COMMITTED_ANCHOR_FALLBACKS.filter(
    (anchorPath) => {
      if (!anchorPath.startsWith(`${candidatePath}/`)) return false;
      try {
        lstatSync(join(rootPath, anchorPath));
        return true;
      } catch {
        return false;
      }
    },
  );
  return Array.from(
    new Set([
      ...canonicalAnchors,
      ...trackedReportingAnchors(rootPath, [candidatePath]),
    ]),
  ).sort();
}

/**
 * Return the protected paths when every workspace has an identical layout.
 * Shared profile rules apply to every root, so asymmetric layouts cannot safely
 * receive the same write rule without either a missing-path startup failure or
 * an unprotected tracked file.
 */
function sharedProtectedPaths(
  rootPaths: readonly string[],
  candidatePath: string,
): string[] | null {
  const perRootPaths = rootPaths.map((rootPath) =>
    protectedPathsForCandidate(rootPath, candidatePath),
  );
  const first = perRootPaths[0] ?? [];
  return perRootPaths.every(
    (paths) => JSON.stringify(paths) === JSON.stringify(first),
  )
    ? first
    : null;
}

/** Escape one absolute path for Claude Code's gitignore-style permission rules. */
function claudePermissionPath(filePath: string): string {
  let normalized = filePath.replaceAll("\\", "/");
  if (/^[A-Za-z]:\//.test(normalized)) {
    normalized = `/${normalized[0]?.toLowerCase()}${normalized.slice(2)}`;
  }
  const metaCharacters = new Set(["\\", "*", "?", "[", "]", "!", "#"]);
  const escaped = Array.from(normalized.replace(/^\/+/, ""))
    .map((character) =>
      metaCharacters.has(character) ? `\\${character}` : character,
    )
    .join("");
  return `//${escaped}`;
}

/** Resolve the active Claude config directory without reading its contents. */
function configuredClaudeCredentialPaths(
  projectPath: string,
  environment: NodeJS.ProcessEnv,
): string[] {
  const configuredDirectory = environment.CLAUDE_CONFIG_DIR?.trim();
  if (!configuredDirectory) return [];

  let expandedDirectory = configuredDirectory;
  if (expandedDirectory === "~") {
    expandedDirectory = homedir();
  } else if (
    expandedDirectory.startsWith("~/") ||
    expandedDirectory.startsWith("~\\")
  ) {
    expandedDirectory = join(homedir(), expandedDirectory.slice(2));
  }
  const absoluteDirectory = isAbsolute(expandedDirectory)
    ? expandedDirectory
    : resolve(projectPath, expandedDirectory);
  const directoryPaths = [absoluteDirectory];
  try {
    directoryPaths.push(realpathSync(absoluteDirectory));
  } catch {
    // Resolving is optional here because Claude may create the configured
    // directory after launch; the unresolved path stays in the list.
  }

  return Array.from(
    new Set(
      directoryPaths.flatMap((directoryPath) => {
        const credentialPath = join(directoryPath, ".credentials.json");
        try {
          return [credentialPath, realpathSync(credentialPath)];
        } catch {
          return [credentialPath];
        }
      }),
    ),
  );
}

/** Return the sorted permission-overlay contract containing only shared local/report directories. */
function claudeWritablePaths(rootPath: string): string[] {
  return REPORTING_LOCAL_STATE_PATHS.filter((relativePath) =>
    isSharedDirectory([rootPath], relativePath),
  ).sort();
}

/**
 * Build a one-invocation Claude permission overlay for reporting sessions.
 * Inherited user/project settings are disabled by the launch command, so
 * dontAsk permits reads plus these explicit report paths and denies everything
 * else that would require approval. Tracked anchors inside writable roots keep
 * an explicit deny because deny rules take precedence over the directory allow.
 */
function buildClaudeReportingSettings(
  projectPath: string,
  targetPath: string,
  environment: NodeJS.ProcessEnv,
): string {
  const rootPaths = Array.from(
    new Set([projectPath, targetPath].filter((path) => path.length > 0)),
  );
  const writablePathsByRoot = rootPaths.flatMap((rootPath) =>
    claudeWritablePaths(rootPath).map((relativePath) => ({
      rootPath,
      relativePath,
    })),
  );
  const allow = [
    ...rootPaths.map(
      (rootPath) => `Read(${claudePermissionPath(rootPath)}/**)`,
    ),
    ...writablePathsByRoot.map(
      ({ rootPath, relativePath }) =>
        `Edit(${claudePermissionPath(join(rootPath, relativePath))}/**)`,
    ),
  ];
  const protectedWriteDenies = writablePathsByRoot.flatMap(
    ({ rootPath, relativePath }) =>
      protectedPathsForCandidate(rootPath, relativePath).map(
        (protectedPath) =>
          `Edit(${claudePermissionPath(join(rootPath, protectedPath))})`,
      ),
  );
  // Finalized reports are server-written (ADR-044); the agent may read them but
  // never edit them. `*.json` stays one level deep so the staging/ subdirectory
  // remains writable for drafts.
  const finalizedReportDenies = rootPaths.map(
    (rootPath) =>
      `Edit(${claudePermissionPath(join(rootPath, ".goat-flow/logs/quality"))}/*.json)`,
  );
  const projectSecretDenies = rootPaths.flatMap((rootPath) =>
    REPORTING_SECRET_DENIES.flatMap((pattern) => {
      const absolutePattern = `${claudePermissionPath(rootPath)}/${pattern}`;
      return [`Read(${absolutePattern})`, `Edit(${absolutePattern})`];
    }),
  );
  const homeSecretDenies = CLAUDE_REPORTING_HOME_SECRET_DENIES.flatMap(
    (pattern) => [`Read(${pattern})`, `Edit(${pattern})`],
  );
  const configuredCredentialDenies = configuredClaudeCredentialPaths(
    projectPath,
    environment,
  ).flatMap((credentialPath) => {
    const permissionPath = claudePermissionPath(credentialPath);
    return [`Read(${permissionPath})`, `Edit(${permissionPath})`];
  });
  const deny = [
    ...protectedWriteDenies,
    ...finalizedReportDenies,
    ...projectSecretDenies,
    ...homeSecretDenies,
    ...configuredCredentialDenies,
  ];
  return JSON.stringify({
    permissions: {
      defaultMode: "dontAsk",
      disableBypassPermissionsMode: "disable",
      additionalDirectories: rootPaths.filter(
        (rootPath) => rootPath !== projectPath,
      ),
      allow: Array.from(new Set(allow)),
      deny: Array.from(new Set(deny)),
    },
  });
}

/**
 * Build the one-invocation Codex permission profile used by reporting sessions.
 * The project roots stay readable, known goat-flow local state plus Git-proven
 * ignored build paths become writable, tracked files inside those paths are
 * carved back to read, and secret paths retain the installed profile's denies.
 */
function buildCodexReportingProfile(
  projectPath: string,
  targetPath: string,
): string {
  const rootPaths = Array.from(
    new Set([projectPath, targetPath].filter((path) => path.length > 0)),
  );
  const workspaceRoots = rootPaths.map((path) => [path, true] as const);
  const ignoredWritableCandidates = REPORTING_IGNORED_PATH_CANDIDATES.filter(
    (relativePath) =>
      isSharedDirectory(rootPaths, relativePath) &&
      rootPaths.every((rootPath) => isGitIgnoredPath(rootPath, relativePath)),
  );
  const candidateWritablePaths = [
    ...REPORTING_LOCAL_STATE_PATHS.filter((relativePath) =>
      isSharedDirectory(rootPaths, relativePath),
    ),
    ...ignoredWritableCandidates,
  ];
  const protectedPathsByCandidate = candidateWritablePaths.map(
    (relativePath) => ({
      relativePath,
      protectedPaths: sharedProtectedPaths(rootPaths, relativePath),
    }),
  );
  const writablePaths = protectedPathsByCandidate.flatMap((candidate) =>
    candidate.protectedPaths === null ? [] : [candidate.relativePath],
  );
  const committedAnchors = Array.from(
    new Set(
      protectedPathsByCandidate.flatMap((candidate) =>
        candidate.protectedPaths === null ? [] : candidate.protectedPaths,
      ),
    ),
  );
  const filesystemRules: Array<readonly [string, string]> = [
    [".", "read"],
    ...writablePaths.map((path) => [path, "write"] as const),
    ...committedAnchors.map((path) => [path, "read"] as const),
    ...REPORTING_SECRET_DENIES.map((path) => [path, "deny"] as const),
  ];
  const profile = [
    `description=${tomlString("Reporting-only project access with local artifact writes.")}`,
    `extends=${tomlString(":read-only")}`,
    `workspace_roots=${tomlInlineTable(workspaceRoots)}`,
    `filesystem={${tomlString(":workspace_roots")}=${tomlInlineTable(filesystemRules)},${tomlString(":tmpdir")}="write",${tomlString(":slash_tmp")}="write"}`,
    "network={enabled=true}",
  ].join(",");
  return `permissions.${CODEX_REPORTING_PROFILE_NAME}={${profile}}`;
}

/**
 * Roots whose staging directory this launch owns for the session's lifetime.
 *
 * Empty unless the launch explicitly asked for capture: reporting access alone
 * is not the signal. Every preset without write permission - and every custom
 * prompt, which matches no preset - opens as reporting, so keying off access
 * mode would create a `.goat-flow` staging tree inside any selected target and
 * let an unrelated `.goat-flow` component block a read-only launch (ADR-044).
 *
 * @param runner - launching runner; only Claude uses dashboard-owned persistence
 * @param accessMode - session access mode; capture belongs to enforced reporting runs
 * @param captureRequested - whether the launch asked for staged-draft capture
 * @param reportOwnerRoot - the mode-selected owner root, or null when omitted
 * @returns roots to stage and watch, or an empty list when capture does not apply
 */
function stagedQualityCaptureRoots(
  runner: Runner,
  accessMode: TerminalAccessMode,
  captureRequested: boolean,
  reportOwnerRoot: string | null,
): string[] {
  if (!captureRequested) return [];
  if (runner !== "claude" || accessMode !== "reporting") {
    throw new Error(
      "Quality draft capture is supported only for Claude reporting sessions.",
    );
  }
  if (reportOwnerRoot === null) {
    throw new Error(
      "Quality draft capture requires one explicit report-owner project.",
    );
  }
  return [reportOwnerRoot];
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
  if (runner === "codex" && accessMode === "reporting") {
    env.GOAT_CODEX_REPORTING_PROFILE = buildCodexReportingProfile(
      projectPath,
      targetPath,
    );
  }
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
 * Build the PTY shell invocation that keeps a usable terminal open per OS.
 *
 * @param runner Runner identity used for runner-specific launch flags.
 * @param cliPath Absolute runner binary path to launch inside the shell.
 * @param prompt Optional launch prompt delivered through PTY input after startup.
 * @param environment Environment snapshot merged into the spawned process.
 * @param platform Platform selector used by tests and cross-platform launch planning.
 * @param options Access mode plus validated controller/target roots for reporting profiles.
 * @returns Spawn details plus deferred initial input; callers own the actual PTY spawn.
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

  if (platform === "win32") {
    return {
      shell: WINDOWS_TERMINAL_SHELL,
      args: [
        "-NoLogo",
        "-NoExit",
        "-Command",
        `try { ${terminalRunnerCommand(runner, platform, accessMode)} } finally { ${WINDOWS_PROMPT_ENV_CLEANUP} }`,
      ],
      env,
      initialInput,
    };
  }

  const configuredShell = environment.SHELL;
  const shell = configuredShell?.length ? configuredShell : "/bin/bash";
  const shellCmd = `${terminalRunnerCommand(runner, platform, accessMode)}; ${POSIX_PROMPT_ENV_CLEANUP}; exec "$SHELL" -i`;

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
 */
function resolveCLIPath(name: string): string | null {
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

/** Clamp a terminal dimension to a safe integer range. */
function clampDim(
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

/** Send a terminal message when the browser socket is still open. */
function sendMessage(socket: WebSocket, msg: ServerMessage): void {
  if (socket.readyState === 1) {
    // WebSocket.OPEN
    socket.send(JSON.stringify(msg));
  }
}

/** Detect bracketed paste sends so trace output can distinguish launch prompts from typing. */
function looksLikePromptSend(input: string): boolean {
  return input.includes("\x1b[200~");
}

/** Manages PTY-backed terminal sessions for the dashboard */
class TerminalManager {
  private sessions = new Map<string, TerminalSession>();
  private runnerPaths = new Map<Runner, string>();
  private nodePtyModule: NodePtyModule | null = null;
  private nodePtyAvailable: boolean | null = null;
  private startedAt = Date.now();
  private readonly idleTimeoutMs: number | null;
  private readonly traceSink: TerminalTraceSink | null;

  /** Resolve available runner binaries once and convert idle-timeout minutes into timer state. */
  constructor(idleTimeoutMinutes?: number, traceSink?: TerminalTraceSink) {
    const minutes = idleTimeoutMinutes ?? DEFAULT_IDLE_TIMEOUT_MINUTES;
    this.idleTimeoutMs = minutes === 0 ? null : minutes * 60 * 1000;
    this.traceSink = traceSink ?? null;
    // Resolve all runner CLI paths at startup
    for (const profile of getAgentProfiles()) {
      const path = resolveCLIPath(profile.terminalBinary);
      if (path) this.runnerPaths.set(profile.id, path);
    }
  }

  /** Lazy-load node-pty on first use; throws a rebuild diagnostic when the native module is missing. */
  private async loadNodePty(): Promise<NodePtyModule> {
    if (this.nodePtyModule) return this.nodePtyModule;
    try {
      this.nodePtyModule = await import("node-pty");
      this.nodePtyAvailable = true;
      return this.nodePtyModule;
    } catch {
      this.nodePtyAvailable = false;
      throw new Error(
        "node-pty failed to load. Run: npm rebuild node-pty (requires C++ build tools)",
      );
    }
  }

  /**
   * Create a terminal session for the requested runner and project.
   *
   * A slot is reserved synchronously - a `starting` placeholder lands in the
   * session map before any async work - so the MAX_SESSIONS cap holds even when
   * the dashboard fires several launches at once (a user double-clicking "Run",
   * or opening two runner tabs together). The reservation becomes a live
   * session once the PTY spawns, or is released if any startup step fails.
   */
  async create(
    prompt: string,
    projectPath: string,
    runner: Runner = "claude",
    options: {
      targetPath?: string;
      accessMode?: TerminalAccessMode;
      captureQualityDrafts?: boolean;
      qualityDraftProjectPath?: string;
    } = {},
  ): Promise<CreateResponse> {
    const activeSessions = Array.from(this.sessions.values()).filter(
      (s) => s.status !== "terminated",
    ).length;
    // Cap is a hard ceiling: refuse once every slot is occupied.
    if (activeSessions >= MAX_SESSIONS) {
      throw new Error(
        `Maximum ${MAX_SESSIONS} concurrent sessions. Kill an existing session first.`,
      );
    }

    // Reserve the slot synchronously, before any await. This placeholder counts
    // toward the cap immediately (its status is not "terminated"), so a burst of
    // concurrent creates that all clear the check above can't each slip a
    // session in while one of them is parked on the loadNodePty() await.
    const id = randomUUID();
    const session: TerminalSession = {
      id,
      status: "starting",
      createdAt: new Date().toISOString(),
      projectPath,
      cwd: projectPath,
      targetPath: projectPath,
      runner,
      accessMode: options.accessMode ?? "workspace",
      lastInputAt: Date.now(),
      pty: null,
      ws: null,
      idleTimer: null,
      detachBuffer: [],
      detachBufferSize: 0,
      qualityCaptures: [],
    };
    this.sessions.set(id, session);

    try {
      return await this.startReservedSession(
        session,
        prompt,
        projectPath,
        options,
      );
    } catch (err) {
      // Any failure between reservation and activation frees the slot, so a
      // failed launch never permanently holds one of the MAX_SESSIONS slots.
      this.releaseReservedSession(session);
      throw err;
    }
  }

  /**
   * Launch the runner into an already-reserved session and promote it to
   * `active`. Runs after `create` has parked a `starting` placeholder in the
   * session map; anything thrown here is cleaned up by `create`'s catch. Kept
   * separate from `create` so slot reservation stays synchronous while the
   * spawn - which awaits node-pty - happens under the concurrency guard.
   *
   * @param session - the reserved session to launch and mutate to active
   * @param prompt - launch prompt delivered to the runner once it is ready
   * @param projectPath - requested working directory, validated here before spawn
   * @param options - optional explicit target path for the launched agent
   * @returns the create response describing the now-active session
   */
  // eslint-disable-next-line complexity -- Intentional because owner validation must precede staging, permissions, and spawn.
  private async startReservedSession(
    session: TerminalSession,
    prompt: string,
    projectPath: string,
    options: {
      targetPath?: string;
      accessMode?: TerminalAccessMode;
      captureQualityDrafts?: boolean;
      qualityDraftProjectPath?: string;
    },
  ): Promise<CreateResponse> {
    const { id, runner } = session;
    const cliPath = this.runnerPaths.get(runner);
    // Runner binary missing: bail so create() releases the reserved slot.
    if (!cliPath) {
      console.warn(
        `[terminal] Runner "${runner}" not found. Available: ${[...this.runnerPaths.keys()].join(", ")}`,
      );
      throw new Error(`${runner} CLI not found. Install it first.`);
    }

    const validatedCwd = validateProjectPath(projectPath);
    const validatedTarget = validateProjectPath(
      options.targetPath || validatedCwd,
    );
    const validatedQualityDraftProject = options.qualityDraftProjectPath
      ? validateProjectPath(options.qualityDraftProjectPath)
      : null;
    if (validatedQualityDraftProject !== null) {
      const canonicalOwner = realpathSync(validatedQualityDraftProject);
      const allowedOwners = new Set(
        [validatedCwd, validatedTarget].map((rootPath) =>
          realpathSync(rootPath),
        ),
      );
      if (!allowedOwners.has(canonicalOwner)) {
        throw new Error(
          "Quality draft report owner must match the terminal workspace or selected target.",
        );
      }
    }
    // Staging must exist BEFORE the permission overlay is built below so a
    // fresh target still receives its `.goat-flow/logs` write allow. Failure
    // here fails the launch closed: a staged-draft session must never start
    // without a working persistence path.
    const reportingCaptureRoots = stagedQualityCaptureRoots(
      runner,
      session.accessMode,
      options.captureQualityDrafts === true,
      validatedQualityDraftProject === null
        ? null
        : realpathSync(validatedQualityDraftProject),
    );
    for (const captureRoot of reportingCaptureRoots) {
      ensureQualityDraftStagingDirectory(captureRoot);
    }
    const nodePty = await this.loadNodePty();

    const spawnSpec = buildTerminalSpawnSpec(
      runner,
      cliPath,
      prompt,
      process.env,
      process.platform,
      {
        accessMode: session.accessMode,
        projectPath: validatedCwd,
        targetPath: validatedTarget,
      },
    );

    console.log(
      `[terminal] Starting ${runner} session in ${validatedCwd} for target ${validatedTarget}`,
    );
    const pty = nodePty.spawn(spawnSpec.shell, spawnSpec.args, {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd: validatedCwd,
      env: spawnSpec.env,
    });

    // A concurrent kill()/DELETE may have cancelled this reservation while we
    // were awaiting loadNodePty() - e.g. the user closed the launching tab. If
    // the session was dropped from the map or marked terminated, kill the PTY we
    // just spawned so it can't outlive its session, and abort instead of
    // resurrecting a deleted session (which would leak an untracked runner).
    if (this.sessions.get(id) !== session || session.status === "terminated") {
      try {
        pty.kill();
      } catch {
        /* already dead */
      }
      this.sessions.delete(id);
      throw new Error("Terminal session was cancelled during startup");
    }

    // PTY is live: promote the reservation to a real session and swap the
    // placeholder paths for the validated ones.
    session.status = "active";
    session.projectPath = validatedTarget;
    session.cwd = validatedCwd;
    session.targetPath = validatedTarget;
    session.pty = pty;
    session.lastInputAt = Date.now();
    for (const captureRoot of reportingCaptureRoots) {
      session.qualityCaptures.push(
        startQualityDraftCapture({ projectRoot: captureRoot }),
      );
    }

    let hasInitialInputSent = false;
    let initialInputTimer: ReturnType<typeof setTimeout> | null = null;
    const initialInputLatestDueAt =
      Date.now() + INITIAL_PROMPT_FALLBACK_DELAY_MS;
    let initialInputDueAt = 0;

    /** Send the launch prompt through the PTY, avoiding shell/native argv limits. */
    const sendInitialInput = (): void => {
      if (!spawnSpec.initialInput || hasInitialInputSent) return;
      const pty = session.pty;
      // Session already gone or PTY missing: nothing to type the prompt into.
      if (session.status === "terminated" || !pty) return;
      hasInitialInputSent = true;
      if (initialInputTimer) {
        clearTimeout(initialInputTimer);
        initialInputTimer = null;
        initialInputDueAt = 0;
      }
      for (const chunk of chunkTerminalInput(spawnSpec.initialInput)) {
        pty.write(chunk);
      }
      session.lastInputAt = Date.now();
    };

    /** Schedule initial prompt delivery after the runner has had time to draw. */
    const scheduleInitialInput = (
      delayMs: number,
      { reset = false }: { reset?: boolean } = {},
    ): void => {
      if (!spawnSpec.initialInput || hasInitialInputSent) return;
      const now = Date.now();
      const boundedDelayMs = Math.max(
        0,
        Math.min(delayMs, initialInputLatestDueAt - now),
      );
      const nextDueAt = now + boundedDelayMs;
      if (initialInputTimer) {
        // A later or equal reschedule is redundant unless a reset is forced.
        if (!reset && initialInputDueAt <= nextDueAt) return;
        clearTimeout(initialInputTimer);
      }
      initialInputDueAt = nextDueAt;
      initialInputTimer = setTimeout(sendInitialInput, boundedDelayMs);
    };

    // Wire PTY output at creation - routes to WebSocket if attached, buffer if detached
    pty.onData((data: string) => {
      scheduleInitialInput(INITIAL_PROMPT_AFTER_OUTPUT_DELAY_MS, {
        reset: true,
      });
      // Browser attached: stream live; otherwise buffer for the next reconnect.
      if (session.ws) {
        this.resetIdleTimer(session);
        sendMessage(session.ws, { type: "output", data });
      } else if (session.detachBufferSize < DETACH_BUFFER_LIMIT) {
        session.detachBuffer.push(data);
        session.detachBufferSize += data.length;
      }
    });

    pty.onExit(({ exitCode, signal }) => {
      session.status = "terminated";
      this.disposeQualityCaptures(session);
      if (initialInputTimer) {
        clearTimeout(initialInputTimer);
        initialInputTimer = null;
        initialInputDueAt = 0;
      }
      // Tell the attached browser the runner exited so the UI can reflect it.
      if (session.ws) {
        sendMessage(session.ws, {
          type: "exit",
          code: exitCode,
          signal: signal?.toString() ?? null,
        });
      }
      this.clearIdleTimer(session);
    });

    this.resetIdleTimer(session);
    scheduleInitialInput(INITIAL_PROMPT_FALLBACK_DELAY_MS);

    return {
      id,
      status: session.status,
      wsUrl: `/ws/terminal/${id}`,
    };
  }

  /**
   * Release a reserved session after a failed launch: clear any idle timer,
   * kill the PTY if one was spawned before the failure, and drop the
   * placeholder from the session map so the freed slot is reusable at once.
   * Reports PTY cleanup errors as process warnings because the launch failure was already shown to the user.
   *
   * @param session - the reserved session whose slot is being freed; missing PTY means no terminal reached the UI
   * @returns nothing; the reserved slot disappears so the user can start another terminal
   */
  private releaseReservedSession(session: TerminalSession): void {
    this.clearIdleTimer(session);
    this.disposeQualityCaptures(session);
    // A PTY exists only if spawn succeeded but a later step failed; kill it.
    if (session.pty) {
      try {
        session.pty.kill();
      } catch (error) {
        // Cleanup warnings go to the operator while the UI still gets its freed terminal slot.
        process.emitWarning(
          error instanceof Error ? error : new Error(String(error)),
          "GoatFlowTerminalCleanupWarning",
        );
      }
    }
    this.sessions.delete(session.id);
  }

  /**
   * Attach a browser WebSocket to an existing terminal session.
   * Reports an error on the socket when the session is gone; the branching preserves detach semantics
   * because a browser disconnect must not be treated as a PTY exit.
   */
  attachWebSocket(id: string, socket: WebSocket): void {
    const session = this.sessions.get(id);
    if (!session || session.status === "terminated") {
      sendMessage(socket, {
        type: "error",
        message: "Session not found or already terminated",
      });
      socket.close();
      return;
    }

    // Only one browser owns live output at a time; reconnects replace stale sockets while the PTY keeps running.
    if (session.ws) {
      try {
        session.ws.close();
      } catch {
        /* already closed */
      }
    }

    session.ws = socket;
    this.replayDetachBuffer(session, socket);

    socket.on("message", (raw: Buffer | string) => {
      this.handleClientMessage(session, socket, raw);
    });

    // WebSocket close means browser detach, not process exit; only the active socket may detach itself.
    socket.on("close", () => {
      if (session.ws === socket) {
        session.ws = null;
      }
    });
  }

  /**
   * Replay buffered PTY output to a newly attached socket so reconnects do not
   * lose terminal context gathered while detached, then drop the buffer.
   *
   * @param session - terminal session holding the detach buffer
   * @param socket - freshly attached browser WebSocket to replay into
   */
  private replayDetachBuffer(
    session: TerminalSession,
    socket: WebSocket,
  ): void {
    if (session.detachBuffer.length === 0) return;
    for (const chunk of session.detachBuffer) {
      sendMessage(socket, { type: "output", data: chunk });
    }
    session.detachBuffer = [];
    session.detachBufferSize = 0;
  }

  /**
   * Handle one client WebSocket payload: input keystrokes feed the PTY (with
   * idle-timer reset and prompt tracing), resize messages clamp and apply
   * terminal dimensions, and undecodable payloads report an error to the socket.
   *
   * @param session - terminal session that owns the PTY the message targets
   * @param socket - browser WebSocket the payload arrived on
   * @param raw - wire payload as received (Buffer or string)
   */
  private handleClientMessage(
    session: TerminalSession,
    socket: WebSocket,
    raw: Buffer | string,
  ): void {
    const text = typeof raw === "string" ? raw : raw.toString("utf-8");
    const decoded = decodeClientMessage(text);
    if (!decoded.ok) {
      sendMessage(socket, {
        type: "error",
        message: `${decoded.path}: ${decoded.error}`,
      });
      return;
    }
    const msg = decoded.value;

    if (msg.type === "input") {
      session.lastInputAt = Date.now();
      this.resetIdleTimer(session);
      this.traceTerminalInput(session, "terminal.send", msg.data);
      if (looksLikePromptSend(msg.data)) {
        this.traceTerminalInput(session, "prompt.send", msg.data);
      }
      session.pty?.write(msg.data);
      return;
    }
    session.pty?.resize(
      clampDim(msg.cols, 500, 80),
      clampDim(msg.rows, 200, 24),
    );
  }

  /** Return the public session snapshot for one terminal session ID. */
  get(id: string): SessionInfo | null {
    const session = this.sessions.get(id);
    if (!session) return null;
    return this.toInfo(session);
  }

  /** Terminate a terminal session by ID. */
  kill(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    this.killSession(session);
    return true;
  }

  /** List every terminal session that is still considered live. */
  list(): SessionInfo[] {
    return Array.from(this.sessions.values())
      .filter((s) => s.status !== "terminated")
      .map((s) => this.toInfo(s));
  }

  /** Report terminal backend health; node-pty probe errors recover into an unavailable status. */
  async health(): Promise<HealthResponse> {
    // Probe node-pty availability on first health check
    if (this.nodePtyAvailable === null) {
      try {
        await this.loadNodePty();
      } catch {
        /* sets nodePtyAvailable = false */
      }
    }
    const platform = process.platform;
    const platformHint =
      platform === "linux" || platform === "darwin" || platform === "win32"
        ? platform
        : undefined;
    return {
      uptime: Math.floor((Date.now() - this.startedAt) / 1000),
      activeSessions: Array.from(this.sessions.values()).filter(
        (s) => s.status === "active",
      ).length,
      nodePtyAvailable: this.nodePtyAvailable ?? false,
      availableRunners: Array.from(this.runnerPaths.keys()),
      platformHint,
      idleTimeoutMinutes:
        this.idleTimeoutMs === null
          ? 0
          : Math.round(this.idleTimeoutMs / 60000),
    };
  }

  /** Shut down every tracked session and notify attached clients. */
  shutdown(): void {
    for (const session of this.sessions.values()) {
      if (session.ws) {
        sendMessage(session.ws, { type: "shutdown" });
      }
      this.killSession(session);
    }
  }

  /** Tear down a terminal session; swallows kill/close races because either side may already be gone. */
  private killSession(session: TerminalSession): void {
    this.clearIdleTimer(session);
    // Mark the session dead even if its PTY hasn't spawned yet - a "starting"
    // reservation cancelled mid-launch has no PTY to kill, but flagging it
    // terminated lets the in-flight startReservedSession see the cancellation
    // and tear down whatever it spawns instead of leaking an untracked runner.
    if (session.status !== "terminated") {
      session.status = "terminated";
      if (session.pty) {
        try {
          session.pty.kill();
        } catch {
          /* already dead */
        }
      } else {
        // No runner exists, so no process can create another staged draft.
        this.disposeQualityCaptures(session);
      }
    }
    if (session.ws) {
      try {
        session.ws.close();
      } catch {
        /* already closed */
      }
      session.ws = null;
    }
    this.sessions.delete(session.id);
  }

  /** Emit redaction-ready input metadata; tracing errors never affect PTY writes. */
  private traceTerminalInput(
    session: TerminalSession,
    eventKind: TerminalTraceEventKind,
    input: string,
  ): void {
    try {
      this.traceSink?.({
        eventKind,
        sessionId: session.id,
        projectPath: session.projectPath,
        cwd: session.cwd,
        targetPath: session.targetPath,
        runner: session.runner,
        input,
        bytes: Buffer.byteLength(input, "utf-8"),
      });
    } catch {
      /* trace sink failures must not affect terminal input */
    }
  }

  /** Reset the idle-timeout timer after activity because each session must have at most one expiry path. */
  private resetIdleTimer(session: TerminalSession): void {
    this.clearIdleTimer(session);
    if (this.idleTimeoutMs === null) return;
    const timeoutMs = this.idleTimeoutMs;
    const totalMins = Math.round(timeoutMs / 60000);
    const hours = Math.floor(totalMins / 60);
    const minutes = totalMins % 60;
    const label =
      hours > 0 && minutes > 0
        ? `${hours}h ${minutes} min`
        : hours > 0
          ? `${hours}h`
          : `${totalMins} min`;
    session.idleTimer = setTimeout(() => {
      if (session.ws) {
        sendMessage(session.ws, {
          type: "error",
          message: `Session killed: idle timeout (${label})`,
        });
      }
      this.killSession(session);
    }, timeoutMs);
  }

  /** Swallows one staged-draft teardown error so every sibling capture still releases. */
  private disposeQualityCaptures(session: TerminalSession): void {
    for (const capture of session.qualityCaptures) {
      try {
        capture.dispose();
      } catch {
        // One capture failure cannot block sibling release or terminal teardown.
        continue;
      }
    }
    session.qualityCaptures = [];
  }

  /** Clear the idle-timeout timer for a session. */
  private clearIdleTimer(session: TerminalSession): void {
    if (session.idleTimer) {
      clearTimeout(session.idleTimer);
      session.idleTimer = null;
    }
  }

  /** Convert an internal session record into its public response shape. */
  private toInfo(session: TerminalSession): SessionInfo {
    return {
      id: session.id,
      status: session.status,
      createdAt: session.createdAt,
      projectPath: session.projectPath,
      cwd: session.cwd,
      targetPath: session.targetPath,
      runner: session.runner,
      accessMode: session.accessMode,
      lastInputAt: session.lastInputAt,
    };
  }
}

export { TerminalManager, resolveCLIPath, validateProjectPath };
