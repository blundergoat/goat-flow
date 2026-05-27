/**
 * Hook fact extraction - analyzes deny hooks, post-turn hooks, and hook registration.
 */
import type { AgentProfile, AgentFacts, ReadonlyFS } from "../../types.js";
import { pushUniquePath } from "./routing.js";

/** Regex matching common lint, typecheck, and format-check tool invocations. */
const POST_TURN_VALIDATION_COMMAND_PATTERN =
  /\b(shellcheck|eslint|tsc|phpstan|ruff|mypy|flake8|rubocop|stylelint|ktlint|swiftlint)\b|biome\s+check|(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:lint|typecheck|format(?::check)?)\b|cargo\s+check|go\s+vet|prettier\s+--check|bash\s+-n\b|(?:^|\s)(?:bash\s+)?(?:\.\/)?scripts\/preflight-checks\.sh\b/i;
const GUARDRAIL_HOOK_FILES = [
  "guard-common.sh",
  "guard-destructive-shell.sh",
  "guard-secret-paths.sh",
  "guard-repository-writes.sh",
];

/** Detect shell lines that intentionally mask validation failures with `|| true`. */
function lineSwallowsValidationFailure(line: string): boolean {
  if (line.includes("|| true") === false) return false;
  if (line.trimStart().startsWith("#")) return false;
  if (/\bcommand\s+-v\b/.test(line)) return false;
  return POST_TURN_VALIDATION_COMMAND_PATTERN.test(line);
}

/** Detect whether a post-turn hook runs real lint, typecheck, or format-check commands. */
function hasPostTurnValidationCommands(hookContent: string): boolean {
  return hookContent
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line.startsWith("#") === false)
    .some((line) => POST_TURN_VALIDATION_COMMAND_PATTERN.test(line));
}

/** Analyze a hook script for post-turn validation characteristics. */
function analyzePostTurnScript(hookContent: string): {
  exitsZero: boolean;
  hasValidation: boolean;
  swallowsFailures: boolean;
} {
  /** Non-empty, non-comment lines from the hook script */
  const lines = hookContent
    .trim()
    .split("\n")
    .filter((l) => l.trim() && l.trim().startsWith("#") === false);
  /** Last meaningful line of the hook script */
  const lastLine = lines[lines.length - 1];
  return {
    exitsZero: lastLine !== undefined && lastLine.trim() === "exit 0",
    hasValidation: hasPostTurnValidationCommands(hookContent),
    swallowsFailures: lines.some(lineSwallowsValidationFailure),
  };
}

/** Check deny hook script content for quality indicators. */
function analyzeDenyScript(denyContent: string): {
  hasBlocks: boolean;
  usesJq: boolean;
  handlesChaining: boolean;
  blocksRmRf: boolean;
  blocksGitPush: boolean;
  blocksChmod: boolean;
  blocksPipeToShell: boolean;
  blocksCloudDestructive: boolean;
} {
  return {
    hasBlocks:
      /exit\s+2|block|BLOCK/i.test(denyContent) &&
      denyContent.split("\n").length > 5,
    usesJq:
      /\bjq\b/.test(denyContent) &&
      !/grep\s+-[a-zA-Z]*P/.test(
        denyContent
          .split("\n")
          .filter((l) => !l.trimStart().startsWith("#"))
          .join("\n"),
      ),
    handlesChaining:
      /&&|\|\||;/.test(denyContent) && /split|segment|chain/i.test(denyContent),
    blocksRmRf: /rm\s*.*-.*r.*f|rm\s*-rf/i.test(denyContent),
    blocksGitPush: /git\s+push/i.test(denyContent),
    blocksChmod: /chmod.*777/.test(denyContent),
    blocksPipeToShell:
      /(curl|wget)[^|]*\|\s*(ba)?sh/i.test(denyContent) ||
      /pipe-to-shell/i.test(denyContent),
    blocksCloudDestructive:
      /docker\s+push|terraform\s+(destroy|apply.*-auto-approve)|aws\s+(s3\s+rm|ec2\s+terminate)/i.test(
        denyContent,
      ),
  };
}

/** Apply settings-based Bash deny pattern overrides to hook facts. */
function applySettingsDenyOverrides(
  denyStr: string,
  hook: {
    denyExists: boolean;
    denyHasBlocks: boolean;
    denyIsConfigBased: boolean;
    denyUsesJq: boolean;
    denyHandlesChaining: boolean;
    denyBlocksRmRf: boolean;
    denyBlocksGitPush: boolean;
    denyBlocksChmod: boolean;
    denyBlocksPipeToShell: boolean;
    denyBlocksCloudDestructive: boolean;
  },
): void {
  // Settings deny counts as a deny mechanism existing
  if (hook.denyExists === false && denyStr.includes("Bash(")) {
    hook.denyExists = true;
    // settings.json deny is mechanical blocking
    hook.denyHasBlocks = true;
    // Config-based deny - jq/chaining checks are not applicable
    hook.denyIsConfigBased = true;
  }
  // Mirror the shell-hook safety checks against settings-based Bash deny rules.
  if (/Bash\(.*rm -rf|Bash\(.*rm -fr/i.test(denyStr))
    hook.denyBlocksRmRf = true;
  if (/Bash\(.*git push/i.test(denyStr)) hook.denyBlocksGitPush = true;
  if (/Bash\(.*chmod 777/i.test(denyStr)) hook.denyBlocksChmod = true;
  if (
    /Bash\(.*(curl|wget).*(\|\s*(ba)?sh|\|\s*sh)/i.test(denyStr) ||
    /Bash\(.*pipe-to-shell/i.test(denyStr)
  ) {
    hook.denyBlocksPipeToShell = true;
  }
  if (
    /Bash\(.*(docker push|terraform destroy|terraform apply|aws s3 rm|aws ec2 terminate)/i.test(
      denyStr,
    )
  )
    hook.denyBlocksCloudDestructive = true;
}

/** Enrich deny hook facts from settings.json Bash deny patterns. */
function enrichDenyFromSettings(
  settingsParsed: unknown,
  hasDenyPatterns: boolean,
  hook: {
    denyExists: boolean;
    denyHasBlocks: boolean;
    denyIsConfigBased: boolean;
    denyUsesJq: boolean;
    denyHandlesChaining: boolean;
    denyBlocksRmRf: boolean;
    denyBlocksGitPush: boolean;
    denyBlocksChmod: boolean;
    denyBlocksPipeToShell: boolean;
    denyBlocksCloudDestructive: boolean;
  },
): void {
  if (!hasDenyPatterns || !settingsParsed) return;
  /** Permissions object from the parsed settings */
  const perms = (settingsParsed as Record<string, unknown>).permissions as
    | Record<string, unknown>
    | undefined;
  /** Raw deny array from permissions */
  const rawDeny = perms?.deny;
  if (!Array.isArray(rawDeny)) return;
  /** All deny patterns concatenated for pattern matching */
  const denyStr = (rawDeny as string[]).join(" ");
  applySettingsDenyOverrides(denyStr, hook);
}

/** Subset of hook facts describing deny-hook blocking behavior. */
type HookDenyFacts = Pick<
  AgentFacts["hooks"],
  | "denyExists"
  | "denyHasBlocks"
  | "denyIsConfigBased"
  | "denyUsesJq"
  | "denyHandlesChaining"
  | "denyBlocksRmRf"
  | "denyBlocksGitPush"
  | "denyBlocksChmod"
  | "denyBlocksPipeToShell"
  | "denyBlocksCloudDestructive"
>;

/** Subset of hook facts describing post-turn hook registration and behavior. */
type PostTurnFacts = Pick<
  AgentFacts["hooks"],
  | "postTurnExists"
  | "postTurnRegistered"
  | "postTurnRegisteredPath"
  | "postTurnExecutable"
  | "postTurnExitsZero"
  | "postTurnHasValidation"
  | "postTurnSwallowsFailures"
>;

/** Subset of hook facts describing post-turn registration state. */
type HookRegistrationFacts = Pick<
  AgentFacts["hooks"],
  "postTurnRegistered" | "postTurnRegisteredPath"
>;

/** Result of resolving one hook event to its registered script path. */
interface HookRegistrationMatch {
  registered: boolean;
  path: string | null;
}

/** Normalize hook command arguments into a repo-relative shell-script path. */
function normalizeHookPath(candidate: string): string | null {
  if (!candidate) return null;
  let path = candidate.trim();
  if (!path) return null;
  path = path.replace(/^['"`]|['"`]$/g, "");
  // Common pattern across hook-supporting agents: bash "$(git rev-parse --show-toplevel)/.../script.sh"
  const substitutionMatch = path.match(/\$\([^)]*\)\/(.*\.sh)$/);
  if (substitutionMatch && substitutionMatch[1]) {
    path = substitutionMatch[1];
  }
  if (!path.endsWith(".sh")) return null;
  return path;
}

/** Extract normalized shell-script paths from one hook command string. */
function extractHookPathsFromCommand(command: string): string[] {
  const pathCandidates: string[] = [];
  const quotedMatches = command.matchAll(/["']([^"']+\.sh)["']/g);
  for (const match of quotedMatches) {
    const path = match[1];
    if (path === undefined) continue;
    const normalized = normalizeHookPath(path);
    if (normalized) pushUniquePath(pathCandidates, normalized);
  }

  const unquotedMatches = command.matchAll(/([^\s"'`]+\.sh)/g);
  for (const match of unquotedMatches) {
    const path = match[1];
    if (path === undefined) continue;
    const normalized = normalizeHookPath(path);
    if (normalized) pushUniquePath(pathCandidates, normalized);
  }

  return pathCandidates;
}

/** Return the preferred shell-script path referenced by a list of hook commands. */
function preferredHookPathFromCommands(commands: string[]): string | null {
  const paths: string[] = [];
  for (const command of commands) {
    const candidates = extractHookPathsFromCommand(command);
    for (const candidate of candidates) pushUniquePath(paths, candidate);
  }
  return (
    paths.find((path) => path.endsWith("/guard-repository-writes.sh")) ??
    paths[0] ??
    null
  );
}

/** Return the parsed `hooks` object from settings when it exists. */
function readHooksObject(
  settingsParsed: unknown,
): Record<string, unknown> | null {
  if (!settingsParsed || typeof settingsParsed !== "object") return null;
  const hooks = (settingsParsed as Record<string, unknown>).hooks;
  if (!hooks || typeof hooks !== "object") return null;
  return hooks as Record<string, unknown>;
}

/** Return one Antigravity top-level hook definition by goat-flow hook id. */
function readAntigravityHookDefinition(
  hookConfigParsed: unknown,
  hookId: string,
): Record<string, unknown> | null {
  if (!hookConfigParsed || typeof hookConfigParsed !== "object") return null;
  const definition = (hookConfigParsed as Record<string, unknown>)[hookId];
  if (!definition || typeof definition !== "object") return null;
  return definition as Record<string, unknown>;
}

/** Extract the shell command from one hook entry when it uses command mode. */
function hasSupportedHookType(hookObj: Record<string, unknown>): boolean {
  return (
    hookObj.type === undefined ||
    hookObj.type === "command" ||
    hookObj.type === "Command"
  );
}

/** Read one shell command field from a normalized hook object. */
function readHookCommand(hookObj: Record<string, unknown>): string | null {
  if (typeof hookObj.bash === "string") return hookObj.bash;
  if (typeof hookObj.command === "string") return hookObj.command;
  const nestedCommand = hookObj.command;
  if (!nestedCommand || typeof nestedCommand !== "object") return null;
  return typeof (nestedCommand as Record<string, unknown>).bash === "string"
    ? ((nestedCommand as Record<string, unknown>).bash as string)
    : null;
}

/** Extract command from hook. */
function extractCommandFromHook(hook: unknown): string | null {
  if (!hook || typeof hook !== "object") return null;
  const hookObj = hook as Record<string, unknown>;
  if (!hasSupportedHookType(hookObj)) return null;
  return readHookCommand(hookObj);
}

/** Extract all shell commands declared inside one event registration entry. */
function extractCommandsFromEventEntry(entry: unknown): string[] {
  if (!entry || typeof entry !== "object") return [];
  const directCommand = extractCommandFromHook(entry);
  if (directCommand !== null) return [directCommand];
  const eventHooks = (entry as Record<string, unknown>).hooks;
  if (!Array.isArray(eventHooks)) return [];

  const commands: string[] = [];
  for (const hook of eventHooks) {
    const command = extractCommandFromHook(hook);
    if (command !== null) commands.push(command);
  }
  return commands;
}

/** Normalize one event's hook registration into a simple registered/path pair. */
function normalizeEventConfig(
  hooks: Record<string, unknown>,
  event: string | null,
): HookRegistrationMatch {
  if (!event) return { registered: false, path: null };
  const rawEvent = hooks[event];
  if (rawEvent === undefined) return { registered: false, path: null };
  if (!Array.isArray(rawEvent)) return { registered: false, path: null };

  const commands: string[] = [];
  for (const entry of rawEvent) {
    commands.push(...extractCommandsFromEventEntry(entry));
  }

  const path = preferredHookPathFromCommands(commands);
  return { registered: path !== null, path };
}

/** Load the hook-registration config for the current agent. */
function readHookConfig(
  fs: ReadonlyFS,
  agent: AgentProfile,
  settingsParsed: unknown,
  settingsValid: boolean,
): { parsed: unknown; valid: boolean } {
  if (!agent.hookConfigFile) {
    return { parsed: null, valid: false };
  }
  if (agent.hookConfigFile === agent.settingsFile) {
    return { parsed: settingsParsed, valid: settingsValid };
  }
  const parsed = fs.readJson(agent.hookConfigFile);
  return { parsed, valid: parsed !== null };
}

/** Collect registered post-turn hook paths for the current agent. */
function buildHookRegistration(
  agent: AgentProfile,
  hookConfigParsed: unknown,
): {
  postTurnRegistered: boolean;
  postTurnRegisteredPath: string | null;
} {
  const hooks = readHooksObject(hookConfigParsed);
  if (!hooks) {
    return {
      postTurnRegistered: false,
      postTurnRegisteredPath: null,
    };
  }

  if (!agent.hookEvents) {
    return { postTurnRegistered: false, postTurnRegisteredPath: null };
  }
  const postTurn = normalizeEventConfig(hooks, agent.hookEvents.postTurn);
  return {
    postTurnRegistered: postTurn.registered,
    postTurnRegisteredPath: postTurn.path,
  };
}

/** Check whether the deny hook is registered as a pre-tool-use hook in settings. */
function buildDenyRegistration(
  agent: AgentProfile,
  hookConfigParsed: unknown,
): { denyIsRegistered: boolean; denyRegisteredPath: string | null } {
  if (agent.id === "antigravity") {
    if (!agent.hookEvents) {
      return { denyIsRegistered: false, denyRegisteredPath: null };
    }
    const denyDefinition = readAntigravityHookDefinition(
      hookConfigParsed,
      "guard-repository-writes",
    );
    if (!denyDefinition || denyDefinition.enabled === false) {
      return { denyIsRegistered: false, denyRegisteredPath: null };
    }
    const preTool = normalizeEventConfig(
      denyDefinition,
      agent.hookEvents.preTool,
    );
    return {
      denyIsRegistered: preTool.registered,
      denyRegisteredPath: preTool.path,
    };
  }

  const hooks = readHooksObject(hookConfigParsed);
  if (!hooks) {
    return { denyIsRegistered: false, denyRegisteredPath: null };
  }

  if (!agent.hookEvents) {
    return { denyIsRegistered: false, denyRegisteredPath: null };
  }
  const preTool = normalizeEventConfig(hooks, agent.hookEvents.preTool);
  return {
    denyIsRegistered: preTool.registered,
    denyRegisteredPath: preTool.path,
  };
}

/** Resolve the deny hook script path for the current agent, if it has one. */
function resolveDenyHookPath(
  fs: ReadonlyFS,
  agent: AgentProfile,
): string | null {
  const explicitHook =
    agent.denyHookFile && fs.exists(agent.denyHookFile)
      ? agent.denyHookFile
      : null;
  if (explicitHook) return explicitHook;

  const splitGuardrail = agent.hooksDir
    ? `${agent.hooksDir}/guard-repository-writes.sh`
    : null;
  if (splitGuardrail && fs.exists(splitGuardrail)) return splitGuardrail;

  return resolveDenyMechanismPath(agent);
}

function resolveDenyMechanismPath(agent: AgentProfile): string | null {
  if (agent.denyMechanism?.type === "deny-script") {
    return agent.denyMechanism.path;
  }
  if (agent.denyMechanism?.type === "both") {
    return agent.denyMechanism.scriptPath;
  }
  return null;
}

function siblingGuardrailPaths(
  fs: ReadonlyFS,
  denyHookPath: string | null,
): string[] {
  if (!denyHookPath) return [];
  const slash = denyHookPath.lastIndexOf("/");
  if (slash === -1) return [];
  const dir = denyHookPath.slice(0, slash);
  const paths = GUARDRAIL_HOOK_FILES.map((file) => `${dir}/${file}`);
  return paths.every((path) => fs.exists(path)) ? paths : [];
}

/** Build the empty deny-hook fact object used when no deny hook is available. */
function createEmptyDenyFacts(denyExists: boolean): HookDenyFacts {
  return {
    denyExists,
    denyHasBlocks: false,
    denyIsConfigBased: false,
    denyUsesJq: false,
    denyHandlesChaining: false,
    denyBlocksRmRf: false,
    denyBlocksGitPush: false,
    denyBlocksChmod: false,
    denyBlocksPipeToShell: false,
    denyBlocksCloudDestructive: false,
  };
}

/** Analyze the deny hook script on disk for the blocking behaviors we care about. */
function analyzeDenyHookPath(
  fs: ReadonlyFS,
  denyHookPath: string | null,
): HookDenyFacts {
  const denyExists = denyHookPath !== null && fs.exists(denyHookPath);
  const hook = createEmptyDenyFacts(denyExists);
  if (!denyExists || !denyHookPath) {
    return hook;
  }

  const denyContent = fs.readFile(denyHookPath);
  if (!denyContent) {
    return hook;
  }

  const guardrailContents = siblingGuardrailPaths(fs, denyHookPath)
    .map((path) => fs.readFile(path))
    .filter((content): content is string => typeof content === "string");
  const analysis = analyzeDenyScript(
    guardrailContents.length > 0 ? guardrailContents.join("\n") : denyContent,
  );
  return {
    ...hook,
    denyHasBlocks: analysis.hasBlocks,
    denyUsesJq: analysis.usesJq,
    denyHandlesChaining: analysis.handlesChaining,
    denyBlocksRmRf: analysis.blocksRmRf,
    denyBlocksGitPush: analysis.blocksGitPush,
    denyBlocksChmod: analysis.blocksChmod,
    denyBlocksPipeToShell: analysis.blocksPipeToShell,
    denyBlocksCloudDestructive: analysis.blocksCloudDestructive,
  };
}

/** Detect the executable secret-blocking rule, not just probe labels. */
function denyHookHasActiveSecretRule(content: string): boolean {
  const hasSecretFunction = /\bis_secret_path_touch\s*\(\)/.test(content);
  const hasSecretFlag = /\btouches_secret\b/.test(content);
  const hasSecretBlock = /block\s+["']Secret-file access/.test(content);
  return [hasSecretFunction, hasSecretFlag].every(Boolean) || hasSecretBlock;
}

/** Detect relative/home root normalization for secret path checks. */
function denyHookHasNormalizedSecretRoots(content: string): boolean {
  const hasRootMatcher = content.includes("((\\./|\\.\\./|~/)*)");
  const hasSelfTestRoots = [
    "cat ./.env",
    "cat ../.env",
    "cat ~/.ssh/id_rsa",
  ].every((marker) => content.includes(marker));
  return hasRootMatcher || hasSelfTestRoots;
}

/** Detect the direct literal secret-path families the Bash hook should block. */
function denyHookHasSecretFamilyMarkers(content: string): boolean {
  const hasKeys =
    content.includes("\\.(pem|key|pfx)") ||
    content.includes("\\.(pem|key|pfx|p12)") ||
    content.includes("\\.\\(pem\\|key\\|pfx\\)");
  return [
    /\\\.env/.test(content),
    /\\\.env\\\.example/.test(content) || /\.env\.example/.test(content),
    /\\\.ssh\//.test(content) || /\/\\\.ssh\//.test(content),
    /\\\.aws\//.test(content) || /\/\\\.aws\//.test(content),
    /secrets\//.test(content),
    /credentials/.test(content) || /\\\.npmrc|\\\.pypirc/.test(content),
    hasKeys,
  ].every(Boolean);
}

/** Detect whether the Bash deny hook blocks direct literal secret-bearing paths
 *  (.env, SSH/AWS paths, credentials, and key material). Required because
 *  file-read deny rules do not apply to Bash. */
function detectBashDenyCoversSecrets(
  fs: ReadonlyFS,
  denyHookPath: string | null,
): boolean {
  if (!denyHookPath || !fs.exists(denyHookPath)) return false;
  const secretSibling = siblingGuardrailPaths(fs, denyHookPath).find((path) =>
    path.endsWith("/guard-secret-paths.sh"),
  );
  const content = fs.readFile(secretSibling ?? denyHookPath);
  if (!content) return false;
  return (
    denyHookHasActiveSecretRule(content) &&
    denyHookHasNormalizedSecretRoots(content) &&
    denyHookHasSecretFamilyMarkers(content)
  );
}

/** Detect hardcoded absolute paths inside shell hook lines. */
function lineHasAbsolutePath(line: string): boolean {
  return (
    !line.trimStart().startsWith("#") &&
    !/\$\(git rev-parse/.test(line) &&
    /\/(home|Users|tmp|var|opt)\/\w+\//.test(line)
  );
}

/** List hook scripts that contain hardcoded absolute paths. */
function findAbsolutePathHooks(
  fs: ReadonlyFS,
  hooksDir: string | null,
): string[] {
  if (!hooksDir || !fs.exists(hooksDir)) return [];
  const absolutePathHooks: string[] = [];

  for (const hookFile of fs.listDir(hooksDir)) {
    if (!hookFile.endsWith(".sh")) continue;
    const hookContent = fs.readFile(`${hooksDir}/${hookFile}`);
    if (!hookContent) continue;
    if (hookContent.split("\n").some(lineHasAbsolutePath)) {
      absolutePathHooks.push(hookFile);
    }
  }

  return absolutePathHooks;
}

/** Extract all hook-related facts: deny hooks, post-turn, compaction. */
export function extractHookFacts(
  fs: ReadonlyFS,
  agent: AgentProfile,
  settingsParsed: unknown,
  hasDenyPatterns: boolean,
  settingsValid: boolean,
): Omit<AgentFacts["hooks"], "readDenyCoversSecrets"> {
  const hookConfig = readHookConfig(fs, agent, settingsParsed, settingsValid);
  const registration = buildHookRegistration(agent, hookConfig.parsed);
  const denyHookPath = resolveDenyHookPath(fs, agent);
  const hook = analyzeDenyHookPath(fs, denyHookPath);
  const absolutePathHooks = findAbsolutePathHooks(fs, agent.hooksDir);
  const denyRegistration = buildDenyRegistration(agent, hookConfig.parsed);
  const bashDenyCoversSecrets = detectBashDenyCoversSecrets(fs, denyHookPath);

  // Second: also check settings.json Bash deny patterns
  enrichDenyFromSettings(settingsParsed, hasDenyPatterns, hook);

  const postTurn = extractPostTurnFacts(fs, agent, registration);

  return {
    ...hook,
    ...denyRegistration,
    ...postTurn,
    absolutePathHooks,
    bashDenyCoversSecrets,
  };
}

/** Analyze a hook script file for exit-zero and validation behavior. */
function analyzeHookScriptAtPath(
  fs: ReadonlyFS,
  scriptPath: string,
): Pick<
  PostTurnFacts,
  "postTurnExitsZero" | "postTurnHasValidation" | "postTurnSwallowsFailures"
> {
  const hookContent = fs.readFile(scriptPath);
  if (!hookContent) {
    return {
      postTurnExitsZero: false,
      postTurnHasValidation: false,
      postTurnSwallowsFailures: false,
    };
  }

  const analysis = analyzePostTurnScript(hookContent);
  return {
    postTurnExitsZero: analysis.exitsZero,
    postTurnHasValidation: analysis.hasValidation,
    postTurnSwallowsFailures: analysis.swallowsFailures,
  };
}

/** Extract post-turn facts from Codex hook registration. */
function extractCodexPostTurnFacts(
  fs: ReadonlyFS,
  registration: HookRegistrationFacts,
): PostTurnFacts {
  const postTurnRegisteredPath = registration.postTurnRegisteredPath;
  const postTurnExists =
    registration.postTurnRegistered &&
    postTurnRegisteredPath !== null &&
    fs.exists(postTurnRegisteredPath);
  const postTurnExecutable = postTurnExists
    ? fs.isExecutable(postTurnRegisteredPath)
    : false;

  return {
    postTurnRegistered: registration.postTurnRegistered,
    postTurnRegisteredPath,
    postTurnExists,
    postTurnExecutable,
    ...(postTurnExists && postTurnRegisteredPath
      ? analyzeHookScriptAtPath(fs, postTurnRegisteredPath)
      : {
          postTurnExitsZero: false,
          postTurnHasValidation: false,
          postTurnSwallowsFailures: false,
        }),
  };
}

/** Extract post-turn facts from shell hook directories. */
function extractDirectoryPostTurnFacts(
  fs: ReadonlyFS,
  registration: HookRegistrationFacts,
): PostTurnFacts {
  const postTurnRegisteredPath = registration.postTurnRegisteredPath;
  const postTurnExists =
    registration.postTurnRegistered &&
    postTurnRegisteredPath !== null &&
    fs.exists(postTurnRegisteredPath);
  const postTurnExecutable = postTurnExists
    ? fs.isExecutable(postTurnRegisteredPath)
    : false;

  return {
    postTurnRegistered: registration.postTurnRegistered,
    postTurnRegisteredPath,
    postTurnExists,
    postTurnExecutable,
    ...(postTurnExists && postTurnRegisteredPath
      ? analyzeHookScriptAtPath(fs, postTurnRegisteredPath)
      : {
          postTurnExitsZero: false,
          postTurnHasValidation: false,
          postTurnSwallowsFailures: false,
        }),
  };
}

/** Extract post-turn and post-tool hook facts. */
function extractPostTurnFacts(
  fs: ReadonlyFS,
  agent: AgentProfile,
  registration: HookRegistrationFacts,
): PostTurnFacts {
  if (agent.id === "codex") {
    return extractCodexPostTurnFacts(fs, registration);
  }

  if (agent.hooksDir) {
    return extractDirectoryPostTurnFacts(fs, registration);
  }

  return {
    postTurnRegistered: false,
    postTurnRegisteredPath: null,
    postTurnExists: false,
    postTurnExecutable: false,
    postTurnExitsZero: false,
    postTurnHasValidation: false,
    postTurnSwallowsFailures: false,
  };
}
