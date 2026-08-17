/**
 * Builds the restricted permission profile an agent runs under in a dashboard terminal.
 * When a user launches Claude or Codex from the dashboard to write a report, that session gets
 * a purpose-built sandbox rather than their normal permissions: it may write the report and the
 * local state around it, and nothing else.
 *
 * Two rules shape everything here. Secrets are denied outright - `.env` files, SSH and cloud
 * credentials, private keys - because a reporting session has no reason to read them and the
 * user is not present to approve a prompt. And write access is granted per directory rather
 * than per file, since a report often needs siblings created next to it; the paths granted are
 * the local-state trees goat-flow owns, never the user's source.
 */
import { execFileSync } from "node:child_process";
import { lstatSync, realpathSync, type Stats } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { isPathWithin } from "./local-paths.js";
import type { Runner, TerminalAccessMode } from "./types.js";

/** Codex profile name applied to dashboard reporting sessions. */
export const CODEX_REPORTING_PROFILE_NAME = "goat_flow_reporting";

/** Local-state trees a reporting session is allowed to write into. */
const REPORTING_LOCAL_STATE_PATHS = [
  ".goat-flow/logs",
  ".goat-flow/scratchpad",
  ".goat-flow/plans",
] as const;

/** Local-state trees whose relative Codex rules may apply to every readable project root. */
const CODEX_SHARED_LOCAL_STATE_PATHS = [
  ".goat-flow/scratchpad",
  ".goat-flow/plans",
] as const;

/** Staging control files written by the dashboard server, never by the reporting agent. */
const QUALITY_STAGING_SERVER_FILES = [
  "goat-quality-result-*.json",
  "goat-quality-claim-*.json",
  "goat-quality-reap-*.json",
] as const;

/** Build and dependency directories never treated as durable reporting anchors. */
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

/** Committed anchors proving a local-state tree exists even when its contents are ignored. */
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

/** Secret-bearing paths denied to every reporting session, inside the project. */
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

/** Secret-bearing paths denied in the user's home directory, outside the project. */
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

/** Encode one TOML basic string for a CLI inline-table override. */
function tomlString(rawText: string): string {
  return JSON.stringify(rawText);
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

/**
 * Read tracked files beneath candidate writable paths so exact files stay read-only.
 * Side effect: spawns `git ls-files` in the project, with a bounded timeout.
 * Error behavior: throws nothing; an unavailable Git or non-repository root swallows the failure
 * and returns no anchors, leaving the conservative canonical fallback list in charge.
 *
 * @param projectPath - repository root the query runs in
 * @param candidatePaths - writable candidates to enumerate tracked files beneath
 * @returns tracked repo-relative paths; empty means the fallback anchors apply instead
 */
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

/**
 * Confirm a candidate write root exists as a real directory in every workspace.
 * Every root must agree, because one workspace resolving the path outside the project would let a
 * write escape through that root alone.
 * Error behavior: throws nothing; an unreadable or symlinked candidate reports false, so the
 * uncertain case denies the write rather than allowing it.
 *
 * @param rootPaths - every workspace root that must independently prove the same layout
 * @param relativePath - project-relative directory under test
 * @returns true only when the directory is a real in-project directory under every root
 */
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

/**
 * Confirm an absent write root can be created without following a parent outside the project.
 * Existing targets stay governed by {@link isSharedDirectory}, which also rejects final symlinks.
 * Error behavior: throws nothing; an unreadable parent reports false so an unverifiable path is
 * never treated as safe to create.
 *
 * @param rootPath - visible project root that owns the prospective directory
 * @param relativePath - project-relative directory the reporting command may need to create
 * @returns true only when the first missing component follows verified in-project directories
 */
function isSafeMissingDirectory(
  rootPath: string,
  relativePath: string,
): boolean {
  let cursor = rootPath;
  let realRootPath: string;
  try {
    realRootPath = realpathSync(rootPath);
  } catch {
    return false;
  }
  for (const component of relativePath.split("/")) {
    cursor = join(cursor, component);
    let stat: Stats;
    try {
      stat = lstatSync(cursor);
    } catch (error) {
      return (
        error instanceof Error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      );
    }
    if (!stat.isDirectory() && !stat.isSymbolicLink()) return false;
    try {
      if (!isPathWithin(realRootPath, realpathSync(cursor))) return false;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * List tracked and canonical protected paths beneath one candidate in one root.
 * Invariant: the result is the deny list that keeps committed files read-only inside an otherwise
 * writable directory, so a path missing here becomes writable for the session.
 * Error behavior: throws nothing; an unreadable anchor is dropped from the list.
 *
 * @param rootPath - workspace root the candidate is resolved against
 * @param candidatePath - project-relative writable candidate to protect beneath
 * @returns protected repo-relative paths; empty means nothing under the candidate is committed
 */
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

/**
 * Resolve the active Claude config directory without reading its contents.
 * Error behavior: throws nothing; an unset or unusable `CLAUDE_CONFIG_DIR` reports as no paths, so
 * the caller falls back to the default credential locations.
 *
 * @param projectPath - launch project, used to resolve a relative configured directory
 * @param environment - process environment supplying `CLAUDE_CONFIG_DIR`
 * @returns credential paths to deny; empty when no directory is configured
 */
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
 *
 * @param projectPath - project the user launched the terminal from
 * @param targetPath - project the report is being written about; often the same as
 *   `projectPath`, and an empty value simply contributes no extra writable root
 * @param environment - process environment, read for the user's home directory so home
 *   secrets can be denied explicitly
 * @returns the settings JSON handed to Claude for this one session; never empty, because a
 *   session with no allow rules would prompt the absent user for every action
 */
export function buildClaudeReportingSettings(
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
  const stagingServerFileDenies = rootPaths.flatMap((rootPath) =>
    QUALITY_STAGING_SERVER_FILES.map((receiptPattern) => {
      const stagingPath = claudePermissionPath(
        join(rootPath, ".goat-flow/logs/quality/staging"),
      );
      return `Edit(${stagingPath}/${receiptPattern})`;
    }),
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
    ...stagingServerFileDenies,
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
 * Project roots stay readable, while only the mode-selected owner receives log writes.
 * Shared local/build paths remain writable when every root proves the same safe layout,
 * tracked anchors return to read-only, and project secret paths stay denied.
 * Error behavior: throws nothing; a path that cannot be proved safe is simply left out of the
 * writable set, so an unverifiable layout narrows permissions instead of widening them.
 *
 * @param projectPath - project the user launched from; empty is invalid at the terminal boundary
 * @param targetPath - project being assessed; empty contributes no second readable root
 * @param qualityReportProjectPath - mode-selected report owner; omitted uses the launch project
 * @returns non-empty TOML profile override passed to Codex for this one reporting session
 */
export function buildCodexReportingProfile(
  projectPath: string,
  targetPath: string,
  qualityReportProjectPath: string = projectPath,
): string {
  const rootPaths = Array.from(
    new Set([projectPath, targetPath].filter((path) => path.length > 0)),
  );
  // A quality owner outside the two visible projects could redirect report writes off-screen.
  if (!rootPaths.includes(qualityReportProjectPath)) {
    throw new Error(
      "Quality report owner must match the terminal workspace or selected target.",
    );
  }
  const workspaceRoots = rootPaths.map((path) => [path, true] as const);
  const ignoredWritableCandidates = REPORTING_IGNORED_PATH_CANDIDATES.filter(
    (relativePath) =>
      isSharedDirectory(rootPaths, relativePath) &&
      rootPaths.every((rootPath) => isGitIgnoredPath(rootPath, relativePath)),
  );
  const candidateWritablePaths = [
    ...CODEX_SHARED_LOCAL_STATE_PATHS.filter((relativePath) =>
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
  const reportLogRelativePath = ".goat-flow/logs";
  const reportOwnerFilesystemRules: Array<readonly [string, string]> = [];
  // The owner may create its local log tree, but an escaping parent still blocks the grant.
  if (
    isSharedDirectory([qualityReportProjectPath], reportLogRelativePath) ||
    isSafeMissingDirectory(qualityReportProjectPath, reportLogRelativePath)
  ) {
    reportOwnerFilesystemRules.push([
      join(qualityReportProjectPath, reportLogRelativePath),
      "write",
    ]);
    // Tracked log anchors remain read-only even inside the owner's writable local-state tree.
    for (const protectedPath of protectedPathsForCandidate(
      qualityReportProjectPath,
      reportLogRelativePath,
    )) {
      reportOwnerFilesystemRules.push([
        join(qualityReportProjectPath, protectedPath),
        "read",
      ]);
    }
  }
  const filesystemRules: Array<readonly [string, string]> = [
    [".", "read"],
    ...writablePaths.map((path) => [path, "write"] as const),
    ...committedAnchors.map((path) => [path, "read"] as const),
    ...REPORTING_SECRET_DENIES.map((path) => [path, "deny"] as const),
  ];
  const reportOwnerFilesystemEntries = reportOwnerFilesystemRules
    .map(
      ([path, permission]) => `${tomlString(path)}=${tomlString(permission)}`,
    )
    .join(",");
  const reportOwnerFilesystemPrefix =
    reportOwnerFilesystemEntries.length > 0
      ? `${reportOwnerFilesystemEntries},`
      : "";
  const profile = [
    `description=${tomlString("Reporting-only project access with local artifact writes.")}`,
    `extends=${tomlString(":read-only")}`,
    `workspace_roots=${tomlInlineTable(workspaceRoots)}`,
    `filesystem={glob_scan_max_depth=3,${tomlString(":workspace_roots")}=${tomlInlineTable(filesystemRules)},${reportOwnerFilesystemPrefix}${tomlString(":tmpdir")}="write",${tomlString(":slash_tmp")}="write"}`,
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
 * Error behavior: throws when capture is requested for a runner or access mode that cannot own
 * persistence, because silently returning no roots would strand the agent waiting on a receipt.
 *
 * @param runner - launching runner; only Claude uses dashboard-owned persistence
 * @param accessMode - session access mode; capture belongs to enforced reporting runs
 * @param wasCaptureRequested - whether the launch asked for staged-draft capture
 * @param reportOwnerRoot - the mode-selected owner root, or null when omitted
 * @returns roots to stage and watch, or an empty list when capture does not apply
 */
export function stagedQualityCaptureRoots(
  runner: Runner,
  accessMode: TerminalAccessMode,
  wasCaptureRequested: boolean,
  reportOwnerRoot: string | null,
): string[] {
  if (!wasCaptureRequested) return [];
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
