/**
 * Agent settings fact extraction - parses settings.json for deny patterns and read-deny coverage.
 */
import type { AgentProfile, AgentFacts, ReadonlyFS } from "../../types.js";

/** Check whether the agent's deny mechanism blocks git commit and/or git push. */
export function checkDenyPatterns(
  fs: ReadonlyFS,
  agent: AgentProfile,
): { gitCommitBlocked: boolean; gitPushBlocked: boolean } {
  /** Deny mechanism configuration for this agent */
  const deny = agent.denyMechanism;

  if (deny.type === "settings-deny") {
    /** Parsed JSON from the settings deny file */
    const parsed = fs.readJson(deny.path) as Record<string, unknown> | null;
    if (parsed == null)
      return { gitCommitBlocked: false, gitPushBlocked: false };
    /** Permissions object from the parsed settings */
    const permissions = parsed.permissions as
      | Record<string, unknown>
      | undefined;
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

  // type: 'both'
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
// eslint-disable-next-line complexity -- multi-format settings extraction (JSON, TOML, Starlark) requires branching
export function extractSettingsFacts(
  fs: ReadonlyFS,
  agent: AgentProfile,
): AgentFacts["settings"] & { readDenyCoversSecrets: boolean } {
  /** Whether the agent's settings file exists on disk */
  const exists = agent.settingsFile ? fs.exists(agent.settingsFile) : false;
  let valid = false;
  let parsed: unknown = null;
  let hasDenyPatterns = false;
  if (agent.settingsFile) {
    if (agent.settingsFile.endsWith(".toml")) {
      // TOML (Codex config.toml) -- parse key=value pairs into an object
      const tomlContent = fs.readFile(agent.settingsFile);
      if (tomlContent) {
        const tomlObj: Record<string, unknown> = {};
        let currentSection = "";
        for (const line of tomlContent.split("\n")) {
          const trimmed = line.trim();
          if (trimmed.startsWith("#") || trimmed === "") continue;
          const sectionMatch = trimmed.match(/^\[(.+)\]$/);
          if (sectionMatch?.[1]) {
            currentSection = sectionMatch[1];
            continue;
          }
          const kvMatch = trimmed.match(/^(\w+)\s*=\s*(.+)$/);
          if (kvMatch?.[1] && kvMatch[2]) {
            const key = currentSection
              ? `${currentSection}.${kvMatch[1]}`
              : kvMatch[1];
            let val: unknown = kvMatch[2].trim();
            if (val === "true") val = true;
            else if (val === "false") val = false;
            else if (
              typeof val === "string" &&
              val.startsWith('"') &&
              val.endsWith('"')
            )
              val = val.slice(1, -1);
            tomlObj[key] = val;
          }
        }
        valid = Object.keys(tomlObj).length > 0;
        parsed = tomlObj;
      }
    } else {
      parsed = fs.readJson(agent.settingsFile);
      valid = parsed !== null;
    }
    if (valid && parsed) {
      /** Permissions object from the parsed settings */
      const perms = (parsed as Record<string, unknown>).permissions as
        | Record<string, unknown>
        | undefined;
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
  );

  return { exists, valid, parsed, hasDenyPatterns, readDenyCoversSecrets };
}

/** Require settings-based read denies for the main secret and credential path families. */
function checkReadDenyCoversSecrets(
  parsed: unknown,
  hasDenyPatterns: boolean,
): boolean {
  if (!hasDenyPatterns || !parsed) return false;
  /** Permissions object from the parsed settings */
  const perms = (parsed as Record<string, unknown>).permissions as
    | Record<string, unknown>
    | undefined;
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
