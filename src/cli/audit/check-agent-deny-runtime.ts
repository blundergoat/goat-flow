/**
 * Replay the selected project's deny hooks when the caller has authorized trusted-target execution.
 *
 * Configured launchers receive safe and blocked requests; undiscovered or unreadable registrations use a direct-script fallback.
 * Results describe these local replays, without proving external agent delivery during a live session.
 */
import * as childProcess from "node:child_process";
import { existsSync } from "node:fs";
import { join, posix } from "node:path";
import type { AuditContext, AuditFailure } from "./types.js";

/**
 * Describe why audit could not start a hook and how the user can retry.
 *
 * Keep launcher availability separate from a policy decision to allow or block work.
 * Both fields supply the failure and repair text displayed by the audit.
 */
interface SpawnFailure {
  message: string;
  howToFix: string;
}

/**
 * Read a launcher error code so audit can explain a missing executable, blocked process, or timeout.
 *
 * @param error - caught value; null or a value without a string code has no recognized errno
 * @returns error code when available; undefined leaves the caller to inspect other process evidence
 */
function errnoCode(error: unknown): string | undefined {
  // Values without an errno cannot identify which launcher repair the user needs.
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}

/**
 * Turn a caught launcher value into the detail displayed beside the audit's repair advice.
 *
 * @param error - caught value; null becomes the literal text "null"
 * @returns Error message or stringified value; an empty Error message contributes no extra detail
 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Report known launch failures separately from the hook's decision about a user command.
 *
 * @param error - value returned or thrown by the launch attempt; an absent code produces no classified failure
 * @param action - audit action named in the failure message; empty omits that context
 * @param executable - program audit tried to start; defaults to Bash
 * @returns known launch failure, or null for an unrecognized error; null alone does not prove the hook ran
 */
export function spawnFailureFor(
  error: unknown,
  action: string,
  executable = "bash",
): SpawnFailure | null {
  const code = errnoCode(error);
  // A process-restricted audit cannot start the hook; explain which permission prevents verification.
  if (code === "EPERM") {
    return {
      message: `${action} could not spawn ${executable} (EPERM: ${errorMessage(error)}). The current sandbox or permission profile blocks child-process execution.`,
      howToFix: `Run this audit outside the child-process-restricted sandbox, or use a profile that permits Node child_process to spawn ${executable}.`,
    };
  }
  // An unavailable executable leaves the hook untested; tell the user what to install or add to PATH.
  if (code === "ENOENT") {
    return {
      message: `${action} could not spawn ${executable} (ENOENT: ${errorMessage(error)}).`,
      howToFix: `Install ${executable} or run the audit in an environment where ${executable} is on PATH.`,
    };
  }
  // A hook launch that exceeds its deadline needs a manual replay to reveal where it stalls.
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
 * Recognize a recorded child exit so audit does not mistake a policy result for a failure to start.
 *
 * @param result - process result; absent or null status means no numeric exit was recorded
 * @returns true when the result contains a numeric child exit status
 */
function completedWithStatus(result: { status?: unknown }): boolean {
  return typeof result.status === "number";
}

/**
 * Recognize a zero child exit inside a thrown process result before audit reports a launcher failure.
 *
 * @param error - caught process value; null or a missing status supplies no successful-exit evidence
 * @returns true only when the caught value explicitly records exit status zero
 */
export function commandCompletedSuccessfully(error: unknown): boolean {
  // Only an explicit zero exit lets the caller treat a thrown result as a successful command.
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    error.status === 0
  );
}

/**
 * Classify a launch failure only when audit has no recorded child exit.
 * A null result means no known launcher failure was found; it is not proof of a successful policy check.
 */
function spawnFailureFromResult(
  result: childProcess.SpawnSyncReturns<string>,
  action: string,
  executable = "bash",
): SpawnFailure | null {
  // A numeric exit belongs to the hook result, so the caller evaluates policy instead of suggesting a launch repair.
  if (completedWithStatus(result)) return null;
  // Without a reported process error there is no launch-specific repair to show.
  return result.error
    ? spawnFailureFor(result.error, action, executable)
    : null;
}

/**
 * Quote a hook path so Bash reads the user's selected location as one literal argument.
 *
 * @param argument - raw hook path; empty becomes one empty shell argument
 * @returns quoted argument with embedded single quotes escaped
 */
function shellSingleQuote(argument: string): string {
  return `'${argument.replace(/'/g, "'\\''")}'`;
}

/**
 * Carry one policy request in the child environment without changing its JSON bytes.
 * Use when audit pipes the request into a configured shell launcher.
 *
 * @param hookInput - agent event JSON; empty supplies no command payload
 * @returns child environment; never empty because the probe payload key is always included
 */
function runtimeProbeEnvironment(hookInput: string): NodeJS.ProcessEnv {
  return { ...process.env, GOAT_HOOK_SMOKE_PAYLOAD: hookInput };
}

/**
 * Pipe one policy request into the exact shell command registered in the trusted target.
 * Preserve launcher syntax because rewriting it could conceal a broken registration.
 *
 * @param configuredHookCommand - registered shell text; empty leaves an invalid empty command group
 * @returns non-empty replay pipeline containing the payload command and configured launcher
 */
function pipeRuntimeProbeTo(configuredHookCommand: string): string {
  return `printf %s "$GOAT_HOOK_SMOKE_PAYLOAD" | { ${configuredHookCommand}; }`;
}

/**
 * Render an audit repair path with consistent separators on Windows and POSIX.
 *
 * @param relPath - project-relative evidence path; empty remains empty
 * @returns supplied path with backslashes rendered as forward slashes
 */
export function evidencePath(relPath: string): string {
  return relPath.replace(/\\/g, "/");
}

/**
 * Describe the allow or block response audit expects from one local policy replay.
 *
 * The request uses the selected agent's protocol; status, stream, and pattern define the observed response.
 * Use these expectations to identify which user action failed its runtime check.
 */
interface RuntimeProbeExpectation {
  expectedOutcome: "allow" | "block";
  hookInput: string;
  expectedStatus: number;
  expectedStream: "stdout" | "stderr";
  expectedPattern: RegExp;
}

/**
 * Build a blocked-command request in the selected agent's protocol.
 * Audit sends the command as hook input; this helper does not execute the command being denied.
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
 * Build a safe-command request to check that the configured launcher permits ordinary work.
 * The response expectation follows the selected agent's hook protocol.
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
 * Resolve the registered deny path, falling back to the agent's managed hook directory.
 * Null means audit has no candidate for direct replay; a returned path does not establish that the file exists.
 */
function registeredDenyRelPath(
  agentFacts: AuditContext["agents"][number],
): string | null {
  // Prefer the registered path so a hand-edited installation is checked against its own hook target.
  if (agentFacts.hooks.denyRegisteredPath)
    return agentFacts.hooks.denyRegisteredPath;
  // No hook directory means setup, rather than runtime audit, owns the next action.
  if (!agentFacts.agent.hooksDir) return null;
  return join(agentFacts.agent.hooksDir, "deny-dangerous.sh");
}

/**
 * Normalize the expected hook path before comparing it with the user's configured launcher.
 * Null preserves the absence of a known registration path.
 */
function normalizedRegisteredDenyRelPath(
  agentFacts: AuditContext["agents"][number],
): string | null {
  const registeredPath = registeredDenyRelPath(agentFacts);
  // Without an expected hook location, audit cannot compare the launcher's target with a registration.
  if (registeredPath === null) return null;
  return posix.normalize(
    registeredPath.replace(/\\/gu, "/").replace(/^\.\//u, ""),
  );
}

const CONFIGURED_RUNTIME_SCRIPTS = ["deny-dangerous.sh"] as const;

/**
 * Retain one managed deny handler found in the user's agent configuration.
 *
 * Shell text and exec arguments stay distinct so runtime replay preserves the configured invocation.
 * A null script path means extraction could not identify a project-relative managed script operand.
 */
interface ConfiguredHookCommand {
  command: string;
  // Codex's optional Windows-only shell override; null keeps the default command on every platform.
  commandWindows: string | null;
  // Exec-form arguments; null means the platform-selected shell command is used.
  args: string[] | null;
  scriptFile: string;
  scriptPath: string | null;
  configPath: string;
}

/**
 * Read the managed script operand from shell text without running the user's launcher.
 * Return null when no matching project-relative token remains after lexical path checks.
 */
function extractConfiguredScriptPath(
  command: string,
  scriptFile: string,
): string | null {
  // Ignore trailing shell comments so a mentioned filename does not become the user's replay target.
  const withoutShellComment =
    command.replace(/\\/g, "/").split("#", 1)[0] ?? "";
  // Inspect each script token; no tokens means there is no managed path to validate.
  for (const candidate of withoutShellComment.match(/[^\s"'`;|&{}]+\.sh/gu) ??
    []) {
    // Other script names are user hooks outside this managed deny check.
    if (posix.basename(candidate) !== scriptFile) continue;
    // A launcher may prefix its managed path with $root; compare the remaining project-relative operand.
    const withoutRoot = candidate.startsWith("$root/")
      ? candidate.slice("$root/".length)
      : candidate;
    const relative = withoutRoot.replace(/^\.\//, "");
    const normalised = posix.normalize(relative);
    // Paths outside the project do not identify a managed hook location for this audit.
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
 * Match a complete managed script token without selecting similarly named user hooks.
 * Keep this local because importing the server matcher would create a module cycle through manifest.ts.
 *
 * @param commands - config row text; empty never matches
 * @param script - managed script filename, such as deny-dangerous.sh
 * @returns true when the text contains the exact script token; this does not prove the launcher executes it
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
 * @returns lexically project-relative script operand, or null when no matching operand passes these path checks
 */
function extractConfiguredArgvScriptPath(
  argumentValues: string[],
  scriptFile: string,
): string | null {
  // Each operand may be the script path; escaping or absolute candidates are skipped.
  for (const argumentValue of argumentValues) {
    const normalizedCandidate = argumentValue.replace(/\\/g, "/");
    // An operand naming another script does not select the managed deny hook.
    if (posix.basename(normalizedCandidate) !== scriptFile) continue;
    const relative = normalizedCandidate.replace(/^\.\//, "");
    const normalised = posix.normalize(relative);
    // Absolute or parent-relative operands cannot supply the project's managed hook path.
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
  commandWindows: unknown,
  configPath: string,
): void {
  // Empty or non-text values cannot be launchers the user's agent will run.
  if (typeof command !== "string" || command.length === 0) return;
  // A missing or non-text Windows override leaves the default shell command in use.
  const configuredWindowsCommand =
    typeof commandWindows === "string" ? commandWindows : null;
  const commandSearchText = [command, configuredWindowsCommand ?? ""].join(
    "\n",
  );
  const managedScriptFile = CONFIGURED_RUNTIME_SCRIPTS.find((script) =>
    commandsReferenceScriptToken(commandSearchText, script),
  );
  // Unrelated user hooks stay outside the managed runtime audit.
  if (!managedScriptFile) return;
  // Use the Windows override only on Windows; an empty override remains visible as a broken configured command.
  const platformSelectedCommand =
    process.platform === "win32" && configuredWindowsCommand !== null
      ? configuredWindowsCommand
      : command;
  commands.push({
    command,
    commandWindows: configuredWindowsCommand,
    args: null,
    scriptFile: managedScriptFile,
    scriptPath: extractConfiguredScriptPath(
      platformSelectedCommand,
      managedScriptFile,
    ),
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
    commandWindows: null,
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
 * Collect managed deny handlers across the agent's nested settings so audit can replay each configured invocation.
 *
 * @param configNode - parsed settings node; null and primitive values contribute no handlers
 * @param configPath - settings path retained so a finding identifies the file to repair
 * @param commands - handler queue mutated in place; initially empty means no handlers have been discovered
 */
function collectNestedCommandValues(
  configNode: unknown,
  configPath: string,
  commands: ConfiguredHookCommand[],
): void {
  // Agents nest hook registrations differently, so both arrays and objects are walked rather than assuming one layout.
  if (Array.isArray(configNode)) {
    // Visit each registration in a settings array so later handlers are also checked.
    for (const entry of configNode) {
      collectNestedCommandValues(entry, configPath, commands);
    }
    return;
  }
  // Empty or scalar settings cannot contain another handler to replay.
  if (!configNode || typeof configNode !== "object") return;
  const obj = configNode as Record<string, unknown>;
  // Exec-form rows carry their operands in args; string rows keep shell text in command.
  if (Array.isArray(obj.args)) {
    pushConfiguredArgvCommand(commands, obj.command, obj.args, configPath);
  } else {
    pushConfiguredCommand(
      commands,
      obj.command,
      obj.commandWindows,
      configPath,
    );
  }
  pushConfiguredCommand(commands, obj.bash, undefined, configPath);
  // Look through nested settings objects for managed registrations.
  for (const child of Object.values(obj)) {
    // Nested objects may contain handlers; null children are ignored by the next visit.
    if (typeof child === "object") {
      collectNestedCommandValues(child, configPath, commands);
    }
  }
}

/**
 * Read and deduplicate the managed deny commands audit can discover in one agent's settings.
 * Missing or malformed settings recover as an empty list, allowing the caller's direct-script fallback.
 *
 * @param ctx - audit context supplying the selected project's filesystem
 * @param agentFacts - agent whose configured handlers are read
 * @returns discovered managed handlers; empty means none were extracted, not that the agent has no protection
 */
function configuredGuardCommands(
  ctx: AuditContext,
  agentFacts: AuditContext["agents"][number],
): ConfiguredHookCommand[] {
  const configPath =
    agentFacts.agent.hookConfigFile ?? agentFacts.agent.settingsFile;
  // Without a known settings path, audit cannot discover this agent's configured launchers.
  if (!configPath) return [];
  const rawConfig = ctx.fs.readFile(configPath);
  // Unreadable settings supply no launchers; the caller can still try the registered script.
  if (rawConfig === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawConfig);
  } catch {
    // For example, a user may be midway through repairing a truncated hooks file; setup owns that malformed-config guidance.
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
      command.commandWindows ?? "",
      ...(command.args ?? []),
    ].join("\0");
    // The same discovered handler needs only one replay, even when nested settings expose it twice.
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Render one configured handler for failure messages without re-quoting operands.
function describeConfiguredCommand(configured: ConfiguredHookCommand): string {
  // Exec-form registrations display their executable and operands as the user configured them.
  if (configured.args !== null) {
    return [configured.command, ...configured.args].join(" ");
  }
  // Windows failures name the selected override so users repair the command actually replayed.
  if (process.platform === "win32" && configured.commandWindows !== null) {
    // An empty override needs a visible label rather than a blank command in the failure message.
    return configured.commandWindows.length > 0
      ? configured.commandWindows
      : "<empty commandWindows>";
  }
  return configured.command;
}

// Name the executable selected for one configured handler on this platform.
function configuredHookExecutable(configured: ConfiguredHookCommand): string {
  // Exec-form failures must name the configured executable in installation or permission advice.
  if (configured.args !== null) return configured.command;
  // Shell registrations select PowerShell for a Windows override and Bash otherwise.
  return process.platform === "win32" && configured.commandWindows !== null
    ? "powershell.exe"
    : "bash";
}

/**
 * Say why a registered command does not point at the managed hook script, so a user with a hand-edited config learns what to correct.
 *
 * @param agentFacts - agent whose registration is being judged
 * @param configured - the command as registered in the user's config
 * @returns repair detail, or null when no mismatch is found; an unknown expected path cannot be compared
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
  // When registration supplies an expected path, a different target requires the user to repair the launcher.
  if (
    expectedScriptPath !== null &&
    configured.scriptPath !== expectedScriptPath
  ) {
    return `${agentFacts.agent.id} configured hook command points at ${configured.scriptPath}, expected ${expectedScriptPath}: ${describeConfiguredCommand(configured)}`;
  }
  return null;
}

/**
 * Select the project root and, when applicable, the existing .goat-flow directory for local replay.
 * These locations check common working-directory assumptions without proving every possible launch location.
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
 * Translate one local launcher replay into the audit's failure detail.
 * Null means the recorded status and response match this probe's expectation.
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
    configuredHookExecutable(configured),
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
  // Without an exit status, a reported process error counts as failure; otherwise use the existing zero-status fallback.
  const status = result.status ?? (result.error ? -1 : 0);
  // An unavailable or non-executable shell command prevents this replay from reaching the managed hook.
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
  // A matching status and response satisfy this local allow-or-block probe.
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
 * Spawn one bounded policy replay using the trusted target's exact configured invocation.
 *
 * The caller must authorize target execution before entering this runtime path.
 * Preserve shell and exec argument shapes because a rewritten launcher could hide the user's configuration error.
 *
 * @param configured - installed handler; null args selects a platform shell command
 * @param runtimeProbe - safe or blocked request and its expected response
 * @param workingDirectoryPath - selected project root or managed directory used as the replay's working directory
 * @returns process result; null status means no child exit code was recorded
 */
function spawnConfiguredHookProbe(
  configured: ConfiguredHookCommand,
  runtimeProbe: RuntimeProbeExpectation,
  workingDirectoryPath: string,
): childProcess.SpawnSyncReturns<string> {
  // Exec-form handlers receive the policy request on stdin without shell retokenization.
  if (configured.args !== null) {
    return childProcess.spawnSync(configured.command, configured.args, {
      cwd: workingDirectoryPath,
      encoding: "utf8",
      env: process.env,
      input: runtimeProbe.hookInput,
      timeout: 5000,
    });
  }
  // Codex users on native Windows run the registered PowerShell override directly.
  if (process.platform === "win32" && configured.commandWindows !== null) {
    return childProcess.spawnSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", configured.commandWindows],
      {
        cwd: workingDirectoryPath,
        encoding: "utf8",
        env: runtimeProbeEnvironment(runtimeProbe.hookInput),
        input: runtimeProbe.hookInput,
        timeout: 5000,
      },
    );
  }
  // Other shell registrations pipe the request exactly as their Bash command expects.
  return childProcess.spawnSync(
    "bash",
    ["-c", pipeRuntimeProbeTo(configured.command)],
    {
      cwd: workingDirectoryPath,
      encoding: "utf8",
      env: runtimeProbeEnvironment(runtimeProbe.hookInput),
      input: "",
      timeout: 5000,
    },
  );
}

/**
 * Replay safe and blocked requests through the trusted target's configured launcher.
 * Return the first path or response failure so audit names the registration and location the user must repair.
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
  // Replay the root and any selected managed directory to expose working-directory-dependent launcher failures.
  for (const probeLocation of configuredHookProbeLocations(ctx, agentFacts)) {
    // Check both selected outcomes so a launcher that rejects every request cannot pass.
    for (const runtimeProbe of runtimeProbes) {
      const probeResult = spawnConfiguredHookProbe(
        configured,
        runtimeProbe,
        probeLocation.cwd,
      );
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
 * Spawn a replay of one blocked request through the installed script when no launcher was discovered.
 * This fallback checks the script's response without verifying configured launcher syntax or external agent delivery.
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

  // Without an exit status, a process error counts as failure; otherwise retain the existing zero-status fallback.
  const status = probeResult.status ?? (probeResult.error ? -1 : 0);
  // Read the stream where this agent protocol exposes its block decision.
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
 * Replay discovered managed handlers and report the first local runtime failure.
 * Undefined requests the direct-script fallback; null means every discovered handler passed its selected probes.
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
 * Replay the installed script when no configured launcher was discovered.
 * Null means no failure was found; missing paths and unreadable scripts are skipped for static checks to report.
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
  // The expected response satisfies this direct blocked-command probe.
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
 * Replay selected agents' deny hooks after the caller authorizes trusted-target execution.
 * Report the first local runtime failure; external agent delivery is outside this check.
 *
 * @param ctx - trusted selected project and agents; an empty agent list performs no replay
 * @returns first replay failure, or null when none was found; skipped or unreadable hooks do not establish a passing replay
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
