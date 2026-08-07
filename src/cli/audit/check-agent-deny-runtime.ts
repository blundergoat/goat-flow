/**
 * Runtime-execution half of the agent deny-mechanism audit (concern 4): spawn-failure
 * classification shared with the static checks, plus the runtime smoke that replays a
 * blocked payload through the registered hook path - both the project-configured
 * launcher strings (from each agent's hook config) and the direct registered hook
 * script. Static presence/syntax/pattern/template checks live in
 * check-agent-deny-mechanism.ts, which composes these into the BuildCheck.
 */
import * as childProcess from "node:child_process";
import { existsSync } from "node:fs";
import { join, posix } from "node:path";
import type { AuditContext, AuditFailure } from "./types.js";

/** A bash-spawn failure surfaced as an audit result: the user-facing message and
 * the remediation hint, kept separate from a hook's own non-zero exit. */
interface SpawnFailure {
  message: string;
  howToFix: string;
}

/**
 * Extract a Node errno `code` (e.g. `"EPERM"`) from an unknown thrown value.
 *
 * @param error - A caught value that may be a Node system error.
 * @returns The `code` string when present, otherwise `undefined`.
 */
function errnoCode(error: unknown): string | undefined {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}

/**
 * Coerce an unknown caught value into a human-readable message string.
 *
 * @param error - A caught value (Error or otherwise).
 * @returns The Error's `message`, or the value stringified.
 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Translate a spawn-level errno (EPERM/ENOENT/ETIMEDOUT) into a {@link SpawnFailure}
 * with actionable remediation, distinguishing "bash could not run" from "the hook
 * ran and reported a failure".
 *
 * @param error - The error thrown/returned by the spawn attempt.
 * @param action - Short description of what was being spawned, for the message.
 * @returns A {@link SpawnFailure} for known spawn errnos, or `null` when the error
 *   is not a recognised spawn failure (i.e. the command actually ran).
 */
export function spawnFailureFor(
  error: unknown,
  action: string,
): SpawnFailure | null {
  const code = errnoCode(error);
  if (code === "EPERM") {
    return {
      message: `${action} could not spawn bash (EPERM: ${errorMessage(error)}). The current sandbox or permission profile blocks child-process execution.`,
      howToFix:
        "Run this audit outside the child-process-restricted sandbox, or use a profile that permits Node child_process to spawn bash.",
    };
  }
  if (code === "ENOENT") {
    return {
      message: `${action} could not spawn bash (ENOENT: ${errorMessage(error)}).`,
      howToFix:
        "Install bash or run the audit in an environment where bash is on PATH.",
    };
  }
  if (code === "ETIMEDOUT") {
    return {
      message: `${action} timed out while spawning bash (${errorMessage(error)}).`,
      howToFix:
        "Re-run the audit with the hook command manually to inspect whether the hook hangs.",
    };
  }
  return null;
}

/**
 * Decide whether a `spawnSync` result represents a child that actually ran (it
 * carries a numeric exit status) versus one that failed to launch.
 *
 * @param result - A `spawnSync`-shaped result with an optional `status`.
 * @returns `true` when `status` is a number (the child started and exited).
 */
function completedWithStatus(result: { status?: unknown }): boolean {
  return typeof result.status === "number";
}

/**
 * Decide whether a thrown `execFileSync` error nonetheless reports a clean exit
 * (`status === 0`), which `execFileSync` can do when it throws on stderr output.
 *
 * @param error - The error thrown by `execFileSync`.
 * @returns `true` when the underlying command exited 0 despite the throw.
 */
export function commandCompletedSuccessfully(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    error.status === 0
  );
}

function spawnFailureFromResult(
  result: childProcess.SpawnSyncReturns<string>,
  action: string,
): SpawnFailure | null {
  if (completedWithStatus(result)) return null;
  return result.error ? spawnFailureFor(result.error, action) : null;
}

/**
 * POSIX single-quote a value so an arbitrary filesystem path can be embedded in a
 * `bash -c` string without word-splitting or expansion.
 *
 * @param value - The raw string (typically an absolute hook path) to quote.
 * @returns The value wrapped in single quotes with embedded quotes escaped.
 */
function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * Build the child environment for a runtime smoke run, carrying the test payload
 * to the hook via `GOAT_HOOK_SMOKE_PAYLOAD` instead of argv (avoids quoting JSON).
 *
 * @param input - The JSON payload string the hook should read from the env var.
 * @returns A copy of `process.env` with the smoke payload added.
 */
function runtimeSmokeEnv(input: string): NodeJS.ProcessEnv {
  return { ...process.env, GOAT_HOOK_SMOKE_PAYLOAD: input };
}

/**
 * Wrap a hook command so the smoke payload is piped to its stdin, matching how the
 * agent runtimes feed tool-call JSON to a PreToolUse hook.
 *
 * @param command - The hook invocation to run with the payload on stdin.
 * @returns A `bash -c`-ready command string that pipes the payload in.
 */
function pipeSmokePayloadTo(command: string): string {
  return `printf %s "$GOAT_HOOK_SMOKE_PAYLOAD" | { ${command}; }`;
}

/**
 * Audit evidence paths are user-visible in text/markdown/JSON output. Force
 * forward slashes so Windows and POSIX agree on the rendered shape.
 *
 * @param relPath - Repo-relative path that may carry Windows separators.
 * @returns The same path with every backslash rendered as a forward slash.
 */
export function evidencePath(relPath: string): string {
  return relPath.replace(/\\/g, "/");
}

/** Build the per-agent hook payload and expected denial shape for runtime smoke tests. */
function runtimeSmokePayload(agentId: string): {
  input: string;
  expectedStatus: number;
  expectedStream: "stdout" | "stderr";
  expectedPattern: RegExp;
} {
  if (agentId === "copilot") {
    return {
      input:
        '{"toolName":"bash","toolArgs":{"command":"git push origin main"}}',
      expectedStatus: 0,
      expectedStream: "stdout",
      expectedPattern: /"permissionDecision"\s*:\s*"deny"/,
    };
  }
  if (agentId === "antigravity") {
    return {
      input:
        '{"hookEventName":"PreToolUse","toolCall":{"name":"run_command","args":{"CommandLine":"git push origin main"}}}',
      expectedStatus: 0,
      expectedStream: "stdout",
      expectedPattern: /"decision"\s*:\s*"deny"/,
    };
  }
  return {
    input:
      '{"tool_name":"Bash","tool_input":{"command":"git push origin main"}}',
    expectedStatus: 2,
    expectedStream: "stderr",
    expectedPattern: /BLOCKED:/,
  };
}

function runtimeSmokePayloadForScript(
  agentId: string,
  scriptFile: string,
): ReturnType<typeof runtimeSmokePayload> {
  const command =
    scriptFile === "deny-dangerous.sh" ||
    scriptFile === "guard-repository-writes.sh"
      ? "git push origin main"
      : scriptFile === "guard-secret-paths.sh"
        ? "cat .env"
        : "rm -rf /";
  const base = runtimeSmokePayload(agentId);
  if (agentId === "copilot") {
    return {
      ...base,
      input: JSON.stringify({
        toolName: "bash",
        toolArgs: { command },
      }),
    };
  }
  if (agentId === "antigravity") {
    return {
      ...base,
      input: JSON.stringify({
        hookEventName: "PreToolUse",
        toolCall: { name: "run_command", args: { CommandLine: command } },
      }),
    };
  }
  return {
    ...base,
    input: JSON.stringify({
      tool_name: "Bash",
      tool_input: { command },
    }),
  };
}

function registeredDenyRelPath(
  agentFacts: AuditContext["agents"][number],
): string | null {
  if (agentFacts.hooks.denyRegisteredPath)
    return agentFacts.hooks.denyRegisteredPath;
  if (!agentFacts.agent.hooksDir) return null;
  return join(agentFacts.agent.hooksDir, "deny-dangerous.sh");
}

/** Normalize registered hook paths to the same slash style as parsed shell command paths. */
function normalizedRegisteredDenyRelPath(
  agentFacts: AuditContext["agents"][number],
): string | null {
  const registeredPath = registeredDenyRelPath(agentFacts);
  if (registeredPath === null) return null;
  return posix.normalize(
    registeredPath.replace(/\\/gu, "/").replace(/^\.\//u, ""),
  );
}

const CONFIGURED_SMOKE_SCRIPTS = ["deny-dangerous.sh"] as const;

/** Hook command extracted from agent config for runtime-shaped smoke validation. */
interface ConfiguredHookCommand {
  command: string;
  scriptFile: string;
  scriptPath: string | null;
  configPath: string;
}

/** Extract the configured hook script path without executing shell glue from agent config. */
function extractConfiguredScriptPath(
  command: string,
  scriptFile: string,
): string | null {
  const withoutShellComment =
    command.replace(/\\/g, "/").split("#", 1)[0] ?? "";
  for (const candidate of withoutShellComment.match(/[^\s"'`;|&{}]+\.sh/gu) ??
    []) {
    if (posix.basename(candidate) !== scriptFile) continue;
    const withoutRoot = candidate.startsWith("$root/")
      ? candidate.slice("$root/".length)
      : candidate;
    const relative = withoutRoot.replace(/^\.\//, "");
    const normalised = posix.normalize(relative);
    if (
      normalised.startsWith("../") ||
      normalised === ".." ||
      posix.isAbsolute(normalised)
    ) {
      continue;
    }
    return normalised;
  }
  return null;
}

/**
 * Decide whether a configured hook command launches the managed deny script.
 * Use when picking which commands the trusted audit replays with a blocked payload, so the user's own
 * hooks are never run or reported. The name must appear as a whole path token: a project hook called
 * `custom-deny-dangerous.sh` merely contains the managed name, and replaying it would tell the user
 * their guard is broken when it is simply their own script.
 *
 * @param command - one command string from the project's hook config; empty is never a match
 * @param script - managed script filename to look for, such as `deny-dangerous.sh`
 * @returns true when this command launches the managed script and is worth replaying; false skips it
 *   so an unrelated project hook is left alone
 */
function commandReferencesScriptToken(
  command: string,
  script: string,
): boolean {
  const escapedScript = script.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // The name must start at a path or word boundary and end at one, so `custom-<name>` never matches.
  const scriptTokenPattern = new RegExp(
    `(?:^|[\\s"'\`=/\\\\])${escapedScript}(?=$|[\\s"'\`;|&),])`,
    "mu",
  );
  return scriptTokenPattern.test(command);
}

function pushConfiguredCommand(
  commands: ConfiguredHookCommand[],
  command: unknown,
  configPath: string,
): void {
  if (typeof command !== "string" || command.length === 0) return;
  const scriptFile = CONFIGURED_SMOKE_SCRIPTS.find((script) =>
    commandReferencesScriptToken(command, script),
  );
  if (!scriptFile) return;
  commands.push({
    command,
    scriptFile,
    scriptPath: extractConfiguredScriptPath(command, scriptFile),
    configPath,
  });
}

function collectNestedCommandValues(
  value: unknown,
  configPath: string,
  commands: ConfiguredHookCommand[],
): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectNestedCommandValues(entry, configPath, commands);
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  const obj = value as Record<string, unknown>;
  pushConfiguredCommand(commands, obj.command, configPath);
  pushConfiguredCommand(commands, obj.bash, configPath);
  for (const child of Object.values(obj)) {
    if (typeof child === "object") {
      collectNestedCommandValues(child, configPath, commands);
    }
  }
}

function configuredGuardCommands(
  ctx: AuditContext,
  agentFacts: AuditContext["agents"][number],
): ConfiguredHookCommand[] {
  const configPath =
    agentFacts.agent.hookConfigFile ?? agentFacts.agent.settingsFile;
  if (!configPath) return [];
  const rawConfig = ctx.fs.readFile(configPath);
  if (rawConfig === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawConfig);
  } catch {
    return [];
  }
  const commands: ConfiguredHookCommand[] = [];
  collectNestedCommandValues(parsed, configPath, commands);
  const seen = new Set<string>();
  return commands.filter((command) => {
    const key = `${command.configPath}\0${command.command}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function configuredHookCommandPathFailure(
  agentFacts: AuditContext["agents"][number],
  configured: ConfiguredHookCommand,
): string | null {
  if (configured.scriptPath === null) {
    return `${agentFacts.agent.id} configured hook command does not name an exact managed hook script path: ${configured.command}`;
  }
  const expectedScriptPath = normalizedRegisteredDenyRelPath(agentFacts);
  if (
    expectedScriptPath !== null &&
    configured.scriptPath !== expectedScriptPath
  ) {
    return `${agentFacts.agent.id} configured hook command points at ${configured.scriptPath}, expected ${expectedScriptPath}: ${configured.command}`;
  }
  return null;
}

/** Return cwd labels used to replay configured hook launchers. */
function configuredHookSmokeCwds(
  ctx: AuditContext,
  agentFacts: AuditContext["agents"][number],
): Array<{
  label: string;
  cwd: string;
}> {
  const cwds = [{ label: "project root", cwd: ctx.projectPath }];
  if (agentFacts.agent.id === "copilot") return cwds;
  const nested = join(ctx.projectPath, ".goat-flow");
  if (existsSync(nested)) {
    cwds.push({ label: ".goat-flow", cwd: nested });
  }
  return cwds;
}

function configuredHookSmokeFailureFromResult(
  result: childProcess.SpawnSyncReturns<string>,
  agentFacts: AuditContext["agents"][number],
  configured: ConfiguredHookCommand,
  smoke: ReturnType<typeof runtimeSmokePayloadForScript>,
  smokeCwd: { label: string; cwd: string },
): {
  ok: boolean;
  message: string;
  evidence: string;
  howToFix?: string;
} | null {
  const spawnFailure = spawnFailureFromResult(
    result,
    `${agentFacts.agent.id} configured hook command for ${configured.scriptFile}`,
  );
  if (spawnFailure !== null) {
    return {
      ok: false,
      message: spawnFailure.message,
      evidence: configured.configPath,
      howToFix: spawnFailure.howToFix,
    };
  }
  const status = result.status ?? (result.error ? -1 : 0);
  if (status === 126 || status === 127) {
    return {
      ok: false,
      message: `${agentFacts.agent.id} configured hook command exited before ${configured.scriptFile} could start from ${smokeCwd.label} (exit ${status}): ${configured.scriptPath}`,
      evidence: configured.configPath,
    };
  }
  const stream =
    smoke.expectedStream === "stdout" ? result.stdout : result.stderr;
  if (status === smoke.expectedStatus && smoke.expectedPattern.test(stream)) {
    return null;
  }
  return {
    ok: false,
    message: `${agentFacts.agent.id} configured hook command did not return the expected deny response for ${configured.scriptFile} from ${smokeCwd.label}: ${configured.scriptPath}`,
    evidence: configured.configPath,
  };
}

function runConfiguredHookCommandSmoke(
  ctx: AuditContext,
  agentFacts: AuditContext["agents"][number],
  configured: ConfiguredHookCommand,
): { ok: boolean; message: string; evidence: string; howToFix?: string } {
  const pathFailure = configuredHookCommandPathFailure(agentFacts, configured);
  if (pathFailure !== null) {
    return {
      ok: false,
      message: pathFailure,
      evidence: configured.configPath,
    };
  }
  const smoke = runtimeSmokePayloadForScript(
    agentFacts.agent.id,
    configured.scriptFile,
  );
  // Invoke via `bash -c`, not `-lc`: the agent runtimes run the configured
  // launcher directly without a login shell, so `-lc` would source user rc files
  // and make audit results environment-dependent. `-c` is more faithful to
  // runtime and drops that rc-sourcing surface. This smoke still executes the
  // project-configured launcher string by design (to validate the real
  // root-resolution/cd glue), so the runtime evidence level should only be run
  // against trusted target projects.
  for (const smokeCwd of configuredHookSmokeCwds(ctx, agentFacts)) {
    const result = childProcess.spawnSync(
      "bash",
      ["-c", pipeSmokePayloadTo(configured.command)],
      {
        cwd: smokeCwd.cwd,
        encoding: "utf8",
        env: runtimeSmokeEnv(smoke.input),
        input: "",
        timeout: 5000,
      },
    );
    const failure = configuredHookSmokeFailureFromResult(
      result,
      agentFacts,
      configured,
      smoke,
      smokeCwd,
    );
    if (failure !== null) return failure;
  }
  return { ok: true, message: "", evidence: configured.configPath };
}

function runDirectHookRuntimeSmoke(
  ctx: AuditContext,
  agentFacts: AuditContext["agents"][number],
  denyRelPath: string,
): { ok: boolean; message?: string; howToFix?: string } {
  const smoke = runtimeSmokePayload(agentFacts.agent.id);
  const command = pipeSmokePayloadTo(
    `bash ${shellSingleQuote(join(ctx.projectPath, denyRelPath))}`,
  );
  const result = childProcess.spawnSync("bash", ["-c", command], {
    cwd: ctx.projectPath,
    encoding: "utf8",
    env: runtimeSmokeEnv(smoke.input),
    input: "",
    timeout: 5000,
  });
  const spawnFailure = spawnFailureFromResult(
    result,
    `registered deny hook runtime smoke for ${agentFacts.agent.id}`,
  );
  if (spawnFailure !== null) {
    return { ok: false, ...spawnFailure };
  }

  const status = result.status ?? (result.error ? -1 : 0);
  const stream =
    smoke.expectedStream === "stdout" ? result.stdout : result.stderr;
  return {
    ok: status === smoke.expectedStatus && smoke.expectedPattern.test(stream),
  };
}

function configuredHookRuntimeFailure(
  ctx: AuditContext,
  agentFacts: AuditContext["agents"][number],
): AuditFailure | null | undefined {
  const configuredCommands = configuredGuardCommands(ctx, agentFacts);
  if (configuredCommands.length === 0) return undefined;
  for (const configured of configuredCommands) {
    const result = runConfiguredHookCommandSmoke(ctx, agentFacts, configured);
    if (result.ok) continue;
    return {
      check: "Agent deny mechanism",
      message: result.message,
      evidence: evidencePath(result.evidence),
      howToFix:
        result.howToFix ??
        "Run the configured hook command with a runtime-shaped payload and confirm it reaches the managed hook script without exit 126/127.",
    };
  }
  return null;
}

function directHookRuntimeFailure(
  ctx: AuditContext,
  agentFacts: AuditContext["agents"][number],
): AuditFailure | null {
  const denyRelPath = registeredDenyRelPath(agentFacts);
  if (denyRelPath === null) return null;
  const content = ctx.fs.readFile(denyRelPath);
  if (content === null) return null;

  const directSmoke = runDirectHookRuntimeSmoke(ctx, agentFacts, denyRelPath);
  if (directSmoke.ok) return null;

  return {
    check: "Agent deny mechanism",
    message:
      directSmoke.message ??
      `registered deny hook runtime smoke failed for ${agentFacts.agent.id}`,
    evidence: evidencePath(denyRelPath),
    howToFix:
      directSmoke.howToFix ??
      "Run the registered deny hook with a runtime-shaped Bash payload and confirm it denies `git push origin main`.",
  };
}

/**
 * Run a runtime-shaped blocked payload because configured commands and direct
 * hooks fail differently.
 *
 * @param ctx - Audit context carrying agent facts, project path, and the audit FS.
 * @returns The first runtime-smoke failure across agents, or `null` when all pass.
 */
export function checkHookRuntimeSmoke(ctx: AuditContext): AuditFailure | null {
  for (const agentFacts of ctx.agents) {
    const configuredFailure = configuredHookRuntimeFailure(ctx, agentFacts);
    // `undefined` means the agent has no configured guard commands, so fall
    // through to the direct registered-hook smoke. A non-null value is a real
    // failure to report now. `null` means the configured commands ran and
    // passed (authoritative for this agent) - continue to the next agent
    // instead of returning, which previously short-circuited the whole loop on
    // the first agent whose configured smoke passed, skipping its direct smoke
    // and every later agent.
    if (configuredFailure !== undefined) {
      if (configuredFailure !== null) return configuredFailure;
      continue;
    }

    const directFailure = directHookRuntimeFailure(ctx, agentFacts);
    if (directFailure !== null) return directFailure;
  }
  return null;
}
