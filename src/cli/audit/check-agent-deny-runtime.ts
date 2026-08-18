/**
 * Runs the runtime half of the deny-hook audit after a user selects a project.
 *
 * It replays safe and blocked commands through configured launchers, then uses the registered script when no launcher is present.
 * The result tells the user whether policy ran or failed before protection started.
 *
 * Static configuration checks remain in check-agent-deny-mechanism.ts.
 */
import * as childProcess from "node:child_process";
import { existsSync } from "node:fs";
import { join, posix } from "node:path";
import type { AuditContext, AuditFailure } from "./types.js";

/** User-facing spawn failure and repair, separate from a hook's policy exit. */
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
 * Turn a spawn errno into a user-facing failure, separate from a hook policy result.
 *
 * @param error - The error thrown/returned by the spawn attempt.
 * @param action - Short description of what was being spawned, for the message.
 * @param executable - Program the runtime attempted to launch.
 * @returns A {@link SpawnFailure} for known spawn errnos, or `null` when the error
 *   is not a recognised spawn failure (i.e. the command actually ran).
 */
export function spawnFailureFor(
  error: unknown,
  action: string,
  executable = "bash",
): SpawnFailure | null {
  const code = errnoCode(error);
  if (code === "EPERM") {
    return {
      message: `${action} could not spawn ${executable} (EPERM: ${errorMessage(error)}). The current sandbox or permission profile blocks child-process execution.`,
      howToFix: `Run this audit outside the child-process-restricted sandbox, or use a profile that permits Node child_process to spawn ${executable}.`,
    };
  }
  if (code === "ENOENT") {
    return {
      message: `${action} could not spawn ${executable} (ENOENT: ${errorMessage(error)}).`,
      howToFix: `Install ${executable} or run the audit in an environment where ${executable} is on PATH.`,
    };
  }
  if (code === "ETIMEDOUT") {
    return {
      message: `${action} timed out while spawning ${executable} (${errorMessage(error)}).`,
      howToFix:
        "Re-run the audit with the hook command manually to inspect whether the hook hangs.",
    };
  }
  return null;
}

/**
 * Detect whether the user's hook started and returned a numeric status.
 *
 * @param result - A `spawnSync`-shaped result with an optional `status`.
 * @returns `true` when `status` is a number (the child started and exited).
 */
function completedWithStatus(result: { status?: unknown }): boolean {
  return typeof result.status === "number";
}

/**
 * Detect a clean child exit even when `execFileSync` also reports an error.
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

/** Return a known launcher failure only when the child never reached a numeric exit status. */
function spawnFailureFromResult(
  result: childProcess.SpawnSyncReturns<string>,
  action: string,
  executable = "bash",
): SpawnFailure | null {
  if (completedWithStatus(result)) return null;
  return result.error
    ? spawnFailureFor(result.error, action, executable)
    : null;
}

/**
 * Quote a hook path so Bash reads it as one literal user-selected location.
 *
 * @param value - The raw string (typically an absolute hook path) to quote.
 * @returns The value wrapped in single quotes with embedded quotes escaped.
 */
function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * Carry one user-shaped runtime probe to the hook without changing its JSON bytes.
 * Use while audit replays the same standard-input flow an agent runtime uses.
 *
 * @param hookInput - agent event JSON; empty means the hook receives no user command
 * @returns child environment containing the probe; never empty because process values are preserved
 */
function runtimeProbeEnvironment(hookInput: string): NodeJS.ProcessEnv {
  return { ...process.env, GOAT_HOOK_SMOKE_PAYLOAD: hookInput };
}

/**
 * Pipe one user-shaped probe into the configured hook command.
 * Use during audit so the launcher receives input exactly as it does in an agent session.
 *
 * @param configuredHookCommand - launcher from agent config; empty cannot produce a valid audit run
 * @returns shell pipeline for replay; never empty because the payload command is always included
 */
function pipeRuntimeProbeTo(configuredHookCommand: string): string {
  return `printf %s "$GOAT_HOOK_SMOKE_PAYLOAD" | { ${configuredHookCommand}; }`;
}

/**
 * Render one evidence path consistently for users on Windows and POSIX.
 *
 * @param relPath - Repo-relative path that may carry Windows separators.
 * @returns The same path with every backslash rendered as a forward slash.
 */
export function evidencePath(relPath: string): string {
  return relPath.replace(/\\/g, "/");
}

/**
 * Expected user outcome for one replay, including the agent's status and response stream.
 * Use it to distinguish a policy decision from a launcher that never reached policy.
 */
interface RuntimeProbeExpectation {
  expectedOutcome: "allow" | "block";
  hookInput: string;
  expectedStatus: number;
  expectedStream: "stdout" | "stderr";
  expectedPattern: RegExp;
}

/**
 * Build the blocked-command expectation for one agent protocol.
 * Use when audit proves an unsafe user command reaches policy and is denied.
 */
function blockedRuntimeProbe(agentId: string): RuntimeProbeExpectation {
  // Copilot users receive a JSON permission denial on standard output.
  if (agentId === "copilot") {
    return {
      expectedOutcome: "block",
      hookInput:
        '{"toolName":"bash","toolArgs":{"command":"git push origin main"}}',
      expectedStatus: 0,
      expectedStream: "stdout",
      expectedPattern:
        /"permissionDecisionReason"\s*:\s*"Policy (?:destructive|secret|repository):/,
    };
  }
  // Antigravity users receive its allow-or-deny decision object on standard output.
  if (agentId === "antigravity") {
    return {
      expectedOutcome: "block",
      hookInput:
        '{"hookEventName":"PreToolUse","toolCall":{"name":"run_command","args":{"CommandLine":"git push origin main"}}}',
      expectedStatus: 0,
      expectedStream: "stdout",
      expectedPattern:
        /"reason"\s*:\s*"Policy (?:destructive|secret|repository):/,
    };
  }
  return {
    expectedOutcome: "block",
    hookInput:
      '{"tool_name":"Bash","tool_input":{"command":"git push origin main"}}',
    expectedStatus: 2,
    expectedStream: "stderr",
    expectedPattern: /BLOCKED: Policy (?:destructive|secret|repository):/,
  };
}

/**
 * Build the safe-command expectation for one agent protocol.
 * Use when audit proves ordinary user work is still allowed by the configured launcher.
 */
function allowedRuntimeProbe(agentId: string): RuntimeProbeExpectation {
  // Copilot represents a safe command by returning no hook response.
  if (agentId === "copilot") {
    return {
      expectedOutcome: "allow",
      hookInput: '{"toolName":"bash","toolArgs":{"command":"echo safe"}}',
      expectedStatus: 0,
      expectedStream: "stdout",
      expectedPattern: /^$/u,
    };
  }
  // Antigravity explicitly tells the user that the safe command may continue.
  if (agentId === "antigravity") {
    return {
      expectedOutcome: "allow",
      hookInput:
        '{"hookEventName":"PreToolUse","toolCall":{"name":"run_command","args":{"CommandLine":"echo safe"}}}',
      expectedStatus: 0,
      expectedStream: "stdout",
      expectedPattern: /"decision"\s*:\s*"allow"/u,
    };
  }
  return {
    expectedOutcome: "allow",
    hookInput: '{"tool_name":"Bash","tool_input":{"command":"echo safe"}}',
    expectedStatus: 0,
    expectedStream: "stdout",
    expectedPattern: /^$/u,
  };
}

/**
 * Match one managed guard with the user action it is meant to block.
 * Use when audit replays an exact configured script rather than only the shared deny guard.
 */
function blockedRuntimeProbeForScript(
  agentId: string,
  scriptFile: string,
): RuntimeProbeExpectation {
  // Each guard is probed with the user action its policy is expected to stop.
  const blockedCommand =
    scriptFile === "deny-dangerous.sh" ||
    scriptFile === "guard-repository-writes.sh"
      ? "git push origin main"
      : scriptFile === "guard-secret-paths.sh"
        ? "cat .env"
        : "rm -rf /";
  const baseProbe = blockedRuntimeProbe(agentId);
  // Copilot receives the selected blocked command in its tool-argument shape.
  if (agentId === "copilot") {
    return {
      ...baseProbe,
      hookInput: JSON.stringify({
        toolName: "bash",
        toolArgs: { command: blockedCommand },
      }),
    };
  }
  // Antigravity receives the same blocked action in its command-line field.
  if (agentId === "antigravity") {
    return {
      ...baseProbe,
      hookInput: JSON.stringify({
        hookEventName: "PreToolUse",
        toolCall: {
          name: "run_command",
          args: { CommandLine: blockedCommand },
        },
      }),
    };
  }
  return {
    ...baseProbe,
    hookInput: JSON.stringify({
      tool_name: "Bash",
      tool_input: { command: blockedCommand },
    }),
  };
}

/**
 * Return allow and block probes for one configured launcher.
 * Use both so a launcher that rejects every user command cannot pass audit.
 */
function configuredRuntimeProbes(
  agentId: string,
  scriptFile: string,
): RuntimeProbeExpectation[] {
  return [
    allowedRuntimeProbe(agentId),
    blockedRuntimeProbeForScript(agentId, scriptFile),
  ];
}

/**
 * Resolve the managed deny script a selected agent should run.
 * A null result means the user has no installed hook path for direct runtime proof.
 */
function registeredDenyRelPath(
  agentFacts: AuditContext["agents"][number],
): string | null {
  // An explicit registration is the path the user's agent will actually invoke.
  if (agentFacts.hooks.denyRegisteredPath)
    return agentFacts.hooks.denyRegisteredPath;
  // No hook directory means setup, rather than runtime audit, owns the next action.
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

const CONFIGURED_RUNTIME_SCRIPTS = ["deny-dangerous.sh"] as const;

/** Hook handler extracted from agent config for runtime-shaped smoke validation. */
interface ConfiguredHookCommand {
  command: string;
  /** Exec-form arguments; null means the command string is parsed by Bash. */
  args: string[] | null;
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
 * Match a complete managed script token while preserving similar user filenames.
 * Local copy: importing the shared matcher from server/agent-hook-command would close a module-init cycle through manifest.ts, which loads this audit
 * check.
 *
 * @param commands - runnable text from one config row; empty is never a match
 * @param script - managed script filename to look for, such as `deny-dangerous.sh`
 * @returns true when the text launches the managed script; false leaves user hooks alone
 */
function commandsReferenceScriptToken(
  commands: string,
  script: string,
): boolean {
  const escapedScript = script.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // The name must start at a path or word boundary and end at one, so `custom-<name>` never matches.
  const scriptTokenPattern = new RegExp(
    `(?:^|[\\s"'\`=/\\\\])${escapedScript}(?=$|[\\s"'\`;|&),])`,
    "mu",
  );
  return scriptTokenPattern.test(commands);
}

/**
 * Pick the exec-form operand naming the managed script without shell parsing.
 * Use for structured handlers whose argv elements are already exact tokens.
 *
 * @param argumentValues - string argv elements from one config row; empty finds no path
 * @param scriptFile - managed script filename, such as `deny-dangerous.sh`
 * @returns contained repo-relative script path, or null when no operand names it safely
 */
function extractConfiguredArgvScriptPath(
  argumentValues: string[],
  scriptFile: string,
): string | null {
  // Each operand may be the script path; escaping or absolute candidates are skipped.
  for (const argumentValue of argumentValues) {
    const normalizedCandidate = argumentValue.replace(/\\/g, "/");
    if (posix.basename(normalizedCandidate) !== scriptFile) continue;
    const relative = normalizedCandidate.replace(/^\.\//, "");
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
 * Add one managed launcher found in an agent config to the runtime audit queue.
 * Empty or unrelated user commands are ignored so audit reports only Goat Flow hooks.
 */
function pushConfiguredCommand(
  commands: ConfiguredHookCommand[],
  command: unknown,
  configPath: string,
): void {
  // Empty or non-text values cannot be launchers the user's agent will run.
  if (typeof command !== "string" || command.length === 0) return;
  const managedScriptFile = CONFIGURED_RUNTIME_SCRIPTS.find((script) =>
    commandsReferenceScriptToken(command, script),
  );
  // Unrelated user hooks stay outside the managed runtime audit.
  if (!managedScriptFile) return;
  commands.push({
    command,
    args: null,
    scriptFile: managedScriptFile,
    scriptPath: extractConfiguredScriptPath(command, managedScriptFile),
    configPath,
  });
}

/**
 * Add one structured exec-form handler found in an agent config to the runtime audit queue.
 * Rows whose argv never names a managed deny script stay outside the replay, untouched.
 */
function pushConfiguredArgvCommand(
  commands: ConfiguredHookCommand[],
  command: unknown,
  argumentValues: unknown[],
  configPath: string,
): void {
  // A runnable exec-form row needs one executable string beside its argument array.
  if (typeof command !== "string" || command.length === 0) return;
  const stringArguments = argumentValues.filter(
    (argumentValue): argumentValue is string =>
      typeof argumentValue === "string",
  );
  const argumentText = stringArguments.join("\n");
  const managedScriptFile = CONFIGURED_RUNTIME_SCRIPTS.find((script) =>
    commandsReferenceScriptToken(argumentText, script),
  );
  // Unrelated user hooks stay outside the managed runtime audit.
  if (!managedScriptFile) return;
  commands.push({
    command,
    args: stringArguments,
    scriptFile: managedScriptFile,
    scriptPath: extractConfiguredArgvScriptPath(
      stringArguments,
      managedScriptFile,
    ),
    configPath,
  });
}

/**
 * Walk a settings file of unknown shape and pull out every hook command it registers, wherever the agent chose to nest them.
 *
 * @param value - any node of the parsed config; non-command values are walked through and contribute nothing
 * @param configPath - config file the commands came from, kept so a finding can name the file the user must edit
 * @param commands - collected commands, appended to in place
 */
function collectNestedCommandValues(
  value: unknown,
  configPath: string,
  commands: ConfiguredHookCommand[],
): void {
  // Agents nest hook registrations differently, so both arrays and objects are walked rather than assuming one layout.
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectNestedCommandValues(entry, configPath, commands);
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  const obj = value as Record<string, unknown>;
  // Exec-form rows carry their operands in args; string rows keep shell text in command.
  if (Array.isArray(obj.args)) {
    pushConfiguredArgvCommand(commands, obj.command, obj.args, configPath);
  } else {
    pushConfiguredCommand(commands, obj.command, configPath);
  }
  pushConfiguredCommand(commands, obj.bash, configPath);
  for (const child of Object.values(obj)) {
    if (typeof child === "object") {
      collectNestedCommandValues(child, configPath, commands);
    }
  }
}

/**
 * Read the guard commands one agent has actually registered, which is what the runtime audit replays rather than trusting the file list.
 * It swallows an unreadable or malformed config as an empty list, which the caller reports as no registered protection.
 *
 * @param ctx - audit context supplying the target filesystem
 * @param agentFacts - agent whose configuration is being read
 * @returns every registered hook command; empty means this agent has nothing wired up
 */
function configuredGuardCommands(
  ctx: AuditContext,
  agentFacts: AuditContext["agents"][number],
): ConfiguredHookCommand[] {
  const configPath =
    agentFacts.agent.hookConfigFile ?? agentFacts.agent.settingsFile;
  // An agent with no settings file cannot register anything, so there is nothing to replay.
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
    // Args join the identity so two handlers sharing one executable stay distinct.
    const key = [
      command.configPath,
      command.command,
      ...(command.args ?? []),
    ].join("\0");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Render one configured handler for failure messages without re-quoting operands. */
function describeConfiguredCommand(configured: ConfiguredHookCommand): string {
  return configured.args === null
    ? configured.command
    : [configured.command, ...configured.args].join(" ");
}

/**
 * Say why a registered command does not point at the managed hook script, so a user with a hand-edited config learns what to correct.
 *
 * @param agentFacts - agent whose registration is being judged
 * @param configured - the command as registered in the user's config
 * @returns the failure text, or null when the registration names the expected script
 */
function configuredHookCommandPathFailure(
  agentFacts: AuditContext["agents"][number],
  configured: ConfiguredHookCommand,
): string | null {
  // The registration runs something, but nothing that resolves to a managed script path.
  if (configured.scriptPath === null) {
    return `${agentFacts.agent.id} configured hook command does not name an exact managed hook script path: ${describeConfiguredCommand(configured)}`;
  }
  const expectedScriptPath = normalizedRegisteredDenyRelPath(agentFacts);
  if (
    expectedScriptPath !== null &&
    configured.scriptPath !== expectedScriptPath
  ) {
    return `${agentFacts.agent.id} configured hook command points at ${configured.scriptPath}, expected ${expectedScriptPath}: ${describeConfiguredCommand(configured)}`;
  }
  return null;
}

/**
 * Return the project locations from which a user's configured launcher must work.
 * Root and managed descendants prove the launcher does not depend on Git cwd state.
 */
function configuredHookProbeLocations(
  ctx: AuditContext,
  agentFacts: AuditContext["agents"][number],
): Array<{
  label: string;
  cwd: string;
}> {
  const probeLocations = [{ label: "project root", cwd: ctx.projectPath }];
  // Copilot supplies its workspace root, so one root replay matches its user flow.
  if (agentFacts.agent.id === "copilot") return probeLocations;
  const managedStateDirectory = join(ctx.projectPath, ".goat-flow");
  // An installed managed folder adds the descendant launch path users can enter from.
  if (existsSync(managedStateDirectory)) {
    probeLocations.push({ label: ".goat-flow", cwd: managedStateDirectory });
  }
  return probeLocations;
}

/**
 * Convert one configured-launcher replay into the audit result a user sees.
 * A null result means the expected allow or block response reached policy.
 */
function configuredHookProbeFailureFromResult(
  result: childProcess.SpawnSyncReturns<string>,
  agentFacts: AuditContext["agents"][number],
  configured: ConfiguredHookCommand,
  runtimeProbe: RuntimeProbeExpectation,
  probeLocation: { label: string; cwd: string },
): {
  ok: boolean;
  message: string;
  evidence: string;
  howToFix?: string;
} | null {
  const spawnFailure = spawnFailureFromResult(
    result,
    `${agentFacts.agent.id} configured hook command for ${configured.scriptFile}`,
    configured.args === null ? "bash" : configured.command,
  );
  // A launcher that cannot start leaves the user without policy protection.
  if (spawnFailure !== null) {
    return {
      ok: false,
      message: spawnFailure.message,
      evidence: configured.configPath,
      howToFix: spawnFailure.howToFix,
    };
  }
  // A missing shell command means setup failed before the managed hook could run.
  const status = result.status ?? (result.error ? -1 : 0);
  if (status === 126 || status === 127) {
    return {
      ok: false,
      message: `${agentFacts.agent.id} configured hook command exited before ${configured.scriptFile} could start from ${probeLocation.label} (exit ${status}): ${configured.scriptPath}`,
      evidence: configured.configPath,
    };
  }
  // Each agent exposes its user-facing hook decision on a different stream.
  const responseText =
    runtimeProbe.expectedStream === "stdout" ? result.stdout : result.stderr;
  // The expected policy outcome means this configured launcher is working for the user.
  if (
    status === runtimeProbe.expectedStatus &&
    runtimeProbe.expectedPattern.test(responseText)
  ) {
    return null;
  }
  return {
    ok: false,
    message: `${agentFacts.agent.id} configured hook command did not return the expected ${runtimeProbe.expectedOutcome} response for ${configured.scriptFile} from ${probeLocation.label}: ${configured.scriptPath}`,
    evidence: configured.configPath,
  };
}

/**
 * Replay safe and blocked user commands through one exact configured launcher.
 * It spawns the registered launcher, so the audit proves the launcher, root selection, and policy together rather than inferring them.
 */
function verifyConfiguredHookRuntime(
  ctx: AuditContext,
  agentFacts: AuditContext["agents"][number],
  configured: ConfiguredHookCommand,
): { ok: boolean; message: string; evidence: string; howToFix?: string } {
  const pathFailure = configuredHookCommandPathFailure(agentFacts, configured);
  // A launcher that names the wrong script cannot protect the project the user selected.
  if (pathFailure !== null) {
    return {
      ok: false,
      message: pathFailure,
      evidence: configured.configPath,
    };
  }
  const runtimeProbes = configuredRuntimeProbes(
    agentFacts.agent.id,
    configured.scriptFile,
  );
  // Replay every location from which the user can launch the selected agent.
  for (const probeLocation of configuredHookProbeLocations(ctx, agentFacts)) {
    // A safe command followed by a blocked one proves policy is selective, not broadly broken.
    for (const runtimeProbe of runtimeProbes) {
      // Exec-form handlers replay their exact argv with the probe on stdin, as the provider runs them.
      const probeResult =
        configured.args === null
          ? childProcess.spawnSync(
              "bash",
              ["-c", pipeRuntimeProbeTo(configured.command)],
              {
                cwd: probeLocation.cwd,
                encoding: "utf8",
                env: runtimeProbeEnvironment(runtimeProbe.hookInput),
                input: "",
                timeout: 5000,
              },
            )
          : childProcess.spawnSync(configured.command, configured.args, {
              cwd: probeLocation.cwd,
              encoding: "utf8",
              env: process.env,
              input: runtimeProbe.hookInput,
              timeout: 5000,
            });
      const runtimeFailure = configuredHookProbeFailureFromResult(
        probeResult,
        agentFacts,
        configured,
        runtimeProbe,
        probeLocation,
      );
      // The first failed user outcome is the actionable audit result.
      if (runtimeFailure !== null) return runtimeFailure;
    }
  }
  return { ok: true, message: "", evidence: configured.configPath };
}

/**
 * Replay one blocked user command through the installed script itself.
 * It spawns the script directly, and is used only when no configured launcher exists to give stronger end-to-end proof.
 */
function verifyDirectHookRuntime(
  ctx: AuditContext,
  agentFacts: AuditContext["agents"][number],
  denyRelPath: string,
): { ok: boolean; message?: string; howToFix?: string } {
  const blockedProbe = blockedRuntimeProbe(agentFacts.agent.id);
  const directHookCommand = pipeRuntimeProbeTo(
    `bash ${shellSingleQuote(join(ctx.projectPath, denyRelPath))}`,
  );
  const probeResult = childProcess.spawnSync(
    "bash",
    ["-c", directHookCommand],
    {
      cwd: ctx.projectPath,
      encoding: "utf8",
      env: runtimeProbeEnvironment(blockedProbe.hookInput),
      input: "",
      timeout: 5000,
    },
  );
  const spawnFailure = spawnFailureFromResult(
    probeResult,
    `registered deny hook runtime check for ${agentFacts.agent.id}`,
  );
  // A script that cannot start leaves the user without direct policy proof.
  if (spawnFailure !== null) {
    return { ok: false, ...spawnFailure };
  }

  // Agent protocols expose their block decision on different output streams.
  const status = probeResult.status ?? (probeResult.error ? -1 : 0);
  const responseText =
    blockedProbe.expectedStream === "stdout"
      ? probeResult.stdout
      : probeResult.stderr;
  return {
    ok:
      status === blockedProbe.expectedStatus &&
      blockedProbe.expectedPattern.test(responseText),
  };
}

/**
 * Verify every configured guard for one agent and return its first user-facing failure.
 * Undefined means no launcher exists, while null means every configured launcher passed.
 */
function configuredHookRuntimeFailure(
  ctx: AuditContext,
  agentFacts: AuditContext["agents"][number],
): AuditFailure | null | undefined {
  const configuredLaunchers = configuredGuardCommands(ctx, agentFacts);
  // No launcher means the user needs the direct-script fallback checked next.
  if (configuredLaunchers.length === 0) return undefined;
  // Each configured guard must preserve the same safe-and-blocked user outcomes.
  for (const configuredLauncher of configuredLaunchers) {
    const runtimeResult = verifyConfiguredHookRuntime(
      ctx,
      agentFacts,
      configuredLauncher,
    );
    // A working launcher lets audit continue to the user's next configured guard.
    if (runtimeResult.ok) continue;
    return {
      check: "Agent deny mechanism",
      message: runtimeResult.message,
      evidence: evidencePath(runtimeResult.evidence),
      howToFix:
        // Without a spawn-specific repair, show the standard launcher check to the user.
        runtimeResult.howToFix ??
        "Run the configured hook command with a runtime-shaped payload and confirm it reaches the managed hook script without exit 126/127.",
    };
  }
  return null;
}

/**
 * Verify the installed deny script when no configured launcher is available.
 * Use this fallback so users still receive runtime evidence for older installations.
 */
function directHookRuntimeFailure(
  ctx: AuditContext,
  agentFacts: AuditContext["agents"][number],
): AuditFailure | null {
  const denyRelPath = registeredDenyRelPath(agentFacts);
  // No installed path leaves setup, not runtime audit, as the user's repair route.
  if (denyRelPath === null) return null;
  const installedHookContent = ctx.fs.readFile(denyRelPath);
  // A missing script is already reported by the static setup checks.
  if (installedHookContent === null) return null;

  const directRuntimeResult = verifyDirectHookRuntime(
    ctx,
    agentFacts,
    denyRelPath,
  );
  // The expected policy block means the installed script works for this user.
  if (directRuntimeResult.ok) return null;

  return {
    check: "Agent deny mechanism",
    message:
      // Without a spawn diagnostic, name the direct policy check that failed for the user.
      directRuntimeResult.message ??
      `registered deny hook runtime check failed for ${agentFacts.agent.id}`,
    evidence: evidencePath(denyRelPath),
    howToFix:
      // Without a spawn-specific repair, show the standard direct-hook check to the user.
      directRuntimeResult.howToFix ??
      "Run the registered deny hook with a runtime-shaped Bash payload and confirm it denies `git push origin main`.",
  };
}

/**
 * Verify safe and blocked user commands through each selected agent's real hook path.
 * Use during trusted CLI audit to separate working policy from launcher unavailability.
 *
 * @param ctx - selected project and agents; an empty agent list means there is nothing to show
 * @returns first runtime failure; `null` means every selected user-facing hook check passed
 */
export function checkHookRuntimeSmoke(ctx: AuditContext): AuditFailure | null {
  // Each selected agent gets an independent result so one pass cannot hide a later failure.
  for (const agentFacts of ctx.agents) {
    const configuredFailure = configuredHookRuntimeFailure(ctx, agentFacts);
    // A configured launcher is authoritative: show its failure or continue after its pass.
    if (configuredFailure !== undefined) {
      // A real failure gives the user an immediate, specific repair action.
      if (configuredFailure !== null) return configuredFailure;
      continue;
    }

    const directFailure = directHookRuntimeFailure(ctx, agentFacts);
    // Without a configured launcher, a direct-script failure is the user's runtime result.
    if (directFailure !== null) return directFailure;
  }
  return null;
}
