/**
 * Agent settings fact extraction - parses settings.json for deny patterns and read-deny coverage.
 */
import type { AgentProfile, AgentFacts, ReadonlyFS } from "../../types.js";

/**
 * Check whether the agent's deny mechanism blocks git commit and/or git push.
 *
 * @param fs - project filesystem adapter used to read settings or hook scripts
 * @param agent - agent profile whose deny mechanism should be inspected
 * @returns git operation coverage detected from the agent's configured guardrail path
 */
export function checkDenyPatterns(
  fs: ReadonlyFS,
  agent: AgentProfile,
): { gitCommitBlocked: boolean; gitPushBlocked: boolean } {
  /** Deny mechanism configuration for this agent */
  const deny = agent.denyMechanism;
  if (deny === null) {
    return { gitCommitBlocked: false, gitPushBlocked: false };
  }

  if (deny.type === "settings-deny") {
    /** Parsed JSON from the settings deny file */
    const parsed = fs.readJson(deny.path) as Record<string, unknown> | null;
    if (parsed == null)
      return { gitCommitBlocked: false, gitPushBlocked: false };
    /** Permissions object from the parsed settings */
    const permissions = parsed.permissions as
      Record<string, unknown> | undefined;
    /** Raw deny array from permissions */
    const rawDeny = permissions?.deny;
    /** Deny patterns as a string array, filtering non-strings for safety */
    const denyList = Array.isArray(rawDeny)
      ? rawDeny.filter((p): p is string => typeof p === "string")
      : [];
    return {
      gitCommitBlocked: denyList.some((p) => p.includes("git commit")),
      gitPushBlocked: denyList.some((p) => p.includes("git push")),
    };
  }

  if (deny.type === "deny-script") {
    /** Content of the deny hook script */
    const content = fs.readFile(deny.path);
    if (content == null)
      return { gitCommitBlocked: false, gitPushBlocked: false };
    return {
      gitCommitBlocked: /git\s+commit/i.test(content),
      gitPushBlocked: /git\s+push/i.test(content),
    };
  }

  // The 'both' mechanism blocks when either the settings file or the deny
  // script matches.
  /** Deny results from the settings-based mechanism */
  const settings = checkDenyPatterns(fs, {
    ...agent,
    denyMechanism: { type: "settings-deny", path: deny.settingsPath },
  });
  /** Deny results from the script-based mechanism */
  const script = checkDenyPatterns(fs, {
    ...agent,
    denyMechanism: { type: "deny-script", path: deny.scriptPath },
  });
  return {
    gitCommitBlocked: settings.gitCommitBlocked || script.gitCommitBlocked,
    gitPushBlocked: settings.gitPushBlocked || script.gitPushBlocked,
  };
}

/** Extract settings facts from supported agent config formats. */
// eslint-disable-next-line complexity -- intentional multi-format settings extraction requires branching.
export function extractSettingsFacts(
  fs: ReadonlyFS,
  agent: AgentProfile,
): AgentFacts["settings"] & { readDenyCoversSecrets: boolean } {
  /** Whether the agent's settings file exists on disk */
  const exists = agent.settingsFile ? fs.exists(agent.settingsFile) : false;
  let isSettingsValid = false;
  let parsed: unknown = null;
  let hasDenyPatterns = false;
  if (agent.settingsFile) {
    if (agent.settingsFile.endsWith(".toml")) {
      // TOML (Codex config.toml) -- parse key=value pairs into a flattened object
      const tomlContent = fs.readFile(agent.settingsFile);
      if (tomlContent) {
        const tomlObj: Record<string, unknown> = {};
        let currentSection = "";
        for (const line of tomlContent.split("\n")) {
          const trimmed = line.trim();
          if (trimmed.startsWith("#") || trimmed === "") continue;
          const sectionMatch = trimmed.match(/^\[(.+)\]$/);
          if (sectionMatch?.[1]) {
            currentSection = normalizeTomlDottedKey(sectionMatch[1]);
            continue;
          }
          const kvMatch = trimmed.match(
            /^((?:"(?:\\.|[^"\\])*")|[\w.-]+)\s*=\s*(.+)$/,
          );
          if (kvMatch?.[1] && kvMatch[2]) {
            const key = currentSection
              ? `${currentSection}.${normalizeTomlKey(kvMatch[1])}`
              : normalizeTomlKey(kvMatch[1]);
            const val = parseTomlScalar(kvMatch[2]);
            tomlObj[key] = val;
          }
        }
        isSettingsValid = Object.keys(tomlObj).length > 0;
        parsed = tomlObj;
      }
    } else {
      parsed = fs.readJson(agent.settingsFile);
      isSettingsValid = parsed !== null;
    }
    if (isSettingsValid && parsed) {
      /** Permissions object from the parsed settings */
      const perms = (parsed as Record<string, unknown>).permissions as
        Record<string, unknown> | undefined;
      /** Raw deny array from permissions */
      const denyArr = perms?.deny;
      hasDenyPatterns =
        Array.isArray(denyArr) && (denyArr as string[]).length > 0;
    }
  }

  // Require deny coverage for the common secret-bearing paths goat-flow cares about.
  const readDenyCoversSecrets = checkReadDenyCoversSecrets(
    parsed,
    hasDenyPatterns,
    fs,
  );

  return {
    exists,
    valid: isSettingsValid,
    parsed,
    hasDenyPatterns,
    readDenyCoversSecrets,
  };
}

/** Remove simple TOML string-key quoting for keys goat-flow needs to inspect. */
function normalizeTomlKey(rawKey: string): string {
  const key = rawKey.trim();
  if (key.startsWith('"') && key.endsWith('"')) return key.slice(1, -1);
  return key;
}

/** Normalize a dotted TOML table key while preserving quoted path/glob parts. */
function normalizeTomlDottedKey(rawKey: string): string {
  return rawKey.split(".").map(normalizeTomlKey).join(".");
}

/** Parse the simple scalar values used in Codex config.toml. */
function parseTomlScalar(rawValue: string): unknown {
  const value = rawValue.trim();
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+$/u.test(value)) return Number(value);
  if (value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1);
  return value;
}

/** Require settings-based read denies for the main secret and credential path families. */
function checkReadDenyCoversSecrets(
  parsed: unknown,
  hasDenyPatterns: boolean,
  fs: ReadonlyFS,
): boolean {
  if (checkCodexPermissionProfileCoversSecrets(parsed, fs)) return true;
  if (!hasDenyPatterns || !parsed) return false;
  /** Permissions object from the parsed settings */
  const perms = (parsed as Record<string, unknown>).permissions as
    Record<string, unknown> | undefined;
  /** Raw deny array from permissions */
  const denyArr = perms?.deny;
  if (!Array.isArray(denyArr)) return false;
  /** All deny patterns concatenated into a single string for regex matching */
  const denyStr = (denyArr as string[]).join(" ");
  /** Whether .env paths are covered by deny rules */
  const hasEnv = /Read\(.*\.env/.test(denyStr);
  /** Whether .ssh paths are covered by deny rules */
  const hasSsh = /Read\(.*\.ssh/.test(denyStr);
  /** Whether .aws paths are covered by deny rules */
  const hasAws = /Read\(.*\.aws/.test(denyStr);
  /** Whether key/credential paths are covered by deny rules */
  const hasKeys =
    /Read\(.*\.(pem|key|pfx)\b/.test(denyStr) ||
    /Read\(.*credentials/.test(denyStr);
  return hasEnv && hasSsh && hasAws && hasKeys;
}

/** Detect Codex TOML permission profiles that deny the main secret path families. */
function checkCodexPermissionProfileCoversSecrets(
  parsed: unknown,
  fs: ReadonlyFS,
): boolean {
  if (!parsed || typeof parsed !== "object") return false;
  const defaultPermissions = (parsed as Record<string, unknown>)
    .default_permissions;
  if (typeof defaultPermissions !== "string" || defaultPermissions === "") {
    return false;
  }

  const denied = collectCodexDeniedWorkspaceRootPatterns(
    parsed,
    defaultPermissions,
  );
  if (denied.size === 0) return false;

  return (
    hasCodexEnvDeny(denied, fs) &&
    hasAnyCodexPattern(denied, ["secrets/**", "**/secrets/**"]) &&
    hasAnyCodexPattern(denied, [".ssh/**", "**/.ssh/**"]) &&
    hasAnyCodexPattern(denied, [".aws/**", "**/.aws/**"]) &&
    hasCodexCredentialRootDeny(denied, fs)
  );
}

/** Workspace-root permission entry parsed from Codex TOML settings. */
export interface CodexWorkspaceRootEntry {
  pattern: string;
  mode: string;
}

function collectCodexWorkspaceRootEntry(
  key: string,
  value: unknown,
  inlineTableKey: string,
  prefix: string,
): CodexWorkspaceRootEntry[] {
  if (key === inlineTableKey && typeof value === "string") {
    return parseTomlInlineStringTable(value).map(([pattern, mode]) => ({
      pattern,
      mode,
    }));
  }
  if (typeof value !== "string" || !key.startsWith(prefix)) return [];
  const pattern = key.slice(prefix.length);
  return pattern ? [{ pattern, mode: value }] : [];
}

export function collectCodexWorkspaceRootEntries(
  parsed: unknown,
  profileName: string,
): CodexWorkspaceRootEntry[] {
  if (!parsed || typeof parsed !== "object") return [];
  const rootToken = ":workspace_roots";
  const inlineTableKey = `permissions.${profileName}.filesystem.${rootToken}`;
  const prefix = `${inlineTableKey}.`;
  return Object.entries(parsed as Record<string, unknown>).flatMap(
    ([key, value]) =>
      collectCodexWorkspaceRootEntry(key, value, inlineTableKey, prefix),
  );
}

function collectCodexDeniedWorkspaceRootPatterns(
  parsed: unknown,
  profileName: string,
): Set<string> {
  const denied = new Set<string>();
  for (const { pattern, mode } of collectCodexWorkspaceRootEntries(
    parsed,
    profileName,
  )) {
    if (isCodexDenyMode(mode)) denied.add(pattern);
  }
  return denied;
}

/** Parse the single-line TOML inline string table shape Codex accepts. */
function parseTomlInlineStringTable(rawValue: string): Array<[string, string]> {
  const value = rawValue.trim();
  if (!value.startsWith("{") || !value.endsWith("}")) return [];
  const entries: Array<[string, string]> = [];
  const entryPattern = /"((?:\\.|[^"\\])*)"\s*=\s*"((?:\\.|[^"\\])*)"/gu;
  for (const match of value.matchAll(entryPattern)) {
    const [, key, mode] = match;
    if (key && mode) entries.push([key, mode]);
  }
  return entries;
}

/** Return whether any required Codex filesystem pattern is denied. */
function hasAnyCodexPattern(denied: Set<string>, patterns: string[]): boolean {
  return patterns.some((pattern) => denied.has(pattern));
}

/** Return whether every required Codex filesystem pattern is denied. */
function hasEveryCodexPattern(
  denied: Set<string>,
  patterns: string[],
): boolean {
  return patterns.every((pattern) => denied.has(pattern));
}

/** Recognize both old goat-flow "none" entries and current Codex "deny" entries. */
function isCodexDenyMode(mode: string): boolean {
  return mode === "none" || mode === "deny";
}

/** Detect root .env files and variants. Codex broad denies also deny .env.example. */
function existingExactPathsAreDenied(
  denied: Set<string>,
  fs: ReadonlyFS,
  patterns: string[],
): boolean {
  return patterns
    .filter((pattern) => fs.exists(pattern))
    .every((pattern) => denied.has(pattern));
}

/** Confirm Codex denies every root env file that actually exists in the target project. */
function hasCodexEnvDeny(denied: Set<string>, fs: ReadonlyFS): boolean {
  const exactEnvPaths = [
    ".env",
    ".env.local",
    ".env.development",
    ".env.production",
    ".env.staging",
    ".env.test",
    ".envrc",
  ];
  return (
    hasAnyCodexPattern(denied, ["**/.env*"]) ||
    hasEveryCodexPattern(
      denied,
      exactEnvPaths.map((pattern) => `**/${pattern}`),
    ) ||
    existingExactPathsAreDenied(denied, fs, exactEnvPaths)
  );
}

/** Detect exact root/subtree credential surfaces Codex can express on 0.131+. */
function hasCodexCredentialRootDeny(
  denied: Set<string>,
  fs: ReadonlyFS,
): boolean {
  return (
    [
      [".docker/**", "**/.docker/**"],
      [".gnupg/**", "**/.gnupg/**"],
      [".kube/**", "**/.kube/**"],
    ].every((patternGroup) => hasAnyCodexPattern(denied, patternGroup)) &&
    hasAnyCodexPattern(denied, ["**/credentials*"]) &&
    (hasEveryCodexPattern(denied, ["**/.npmrc", "**/.pypirc"]) ||
      existingExactPathsAreDenied(denied, fs, [".npmrc", ".pypirc"])) &&
    ["pem", "key", "pfx"].every((extension) =>
      hasAnyCodexPattern(denied, [`**/*.${extension}`, `*.${extension}`]),
    )
  );
}
