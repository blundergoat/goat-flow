/**
 * Run checked subprocesses and replace complete local files for dashboard routes and CLI workflows.
 *
 * Callers authorize actions and validate filesystem paths before invoking these helpers.
 * execSafely bounds captured output and runtime; spawnInheritedSync keeps interactive commands attached to the caller's terminal.
 *
 * - Each call site supplies the commands it permits; command discovery alone never grants permission to spawn.
 * - Arguments remain positional with shell expansion disabled, and additional separator and substitution checks reject unsafe inputs.
 * - Captured execution uses a minimal default environment; callers supplying an environment must scrub it first.
 * - Atomic writes flush and close a neighboring temporary file before replacing the requested destination.
 */
import { spawn, spawnSync, type SpawnSyncReturns } from "node:child_process";
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename as pathBasename, dirname, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { StringDecoder } from "node:string_decoder";
import {
  recordEvidenceEvent,
  type EvidenceEnvelopeWriteOptions,
  type EvidenceEventKind,
} from "../evidence/envelope.js";

const DEFAULT_TIMEOUT_MS = 30_000; // Timeout budget: dashboard commands must return before the UI feels stuck.
const DEFAULT_STDOUT_CAP_BYTES = 1_048_576; // 1 MB
const KILL_GRACE_MS = 2_000;
const DEFAULT_ENV_KEYS = [
  "PATH",
  "Path",
  "PATHEXT",
  "SystemRoot",
  "WINDIR",
  "TEMP",
  "TMP",
  "TMPDIR",
];

/**
 * Reject separators and substitutions that a called program could later reinterpret as shell commands.
 * The child starts without shell expansion, so these checks add an argument boundary for tools that may invoke another shell.
 */
const SHELL_METACHARACTER = /[;|\n\r\0]/u;
const COMMAND_SUBSTITUTION = /\$\(|`/u;

/**
 * Describe a subprocess the caller has authorized for one dashboard or CLI action.
 *
 * The command must match this call site's allow-list, and callers validate the working directory before execution.
 * Omitted timing, capture, and environment options use bounded defaults so a request cannot inherit unlimited output or the whole server environment.
 */
export interface ExecOptions {
  // The binary to spawn. Must exactly match an entry in `allowList`.
  command: string;
  // Positional arguments; rejected separators or substitutions stop the launch, while an empty array starts the command without arguments.
  args: string[];
  // Working directory. Callers validate this with `validateLocalPath`.
  cwd: string;
  // Hard wall-clock cap; the process is killed (SIGTERM → SIGKILL) on expiry.
  timeoutMs?: number;
  // Commands this call site permits; an empty list rejects every launch even if the binary is installed.
  allowList: readonly string[];
  // Optional child environment; omitted uses minimal launch settings, while an explicit empty map passes no inherited variables.
  env?: Record<string, string>;
  // Optional cap on captured stdout bytes. Defaults to 1 MB.
  stdoutCapBytes?: number;
  // Optional cap on captured stderr bytes. Defaults to 1 MB.
  stderrCapBytes?: number;
  // Optional local evidence event for spawned command completion.
  evidence?: {
    projectPath: string;
    eventKind?: EvidenceEventKind;
    producer?: string;
    onWarning?: EvidenceEnvelopeWriteOptions["onWarning"];
  };
}

// Stable result flags: ok requires exit zero without a timeout; truncated means at least one output cap was exceeded.
type ExecResultBooleanFields = Record<"ok" | "truncated", boolean>;

/**
 * Return the command's outcome and bounded captured output to the route or CLI that requested it.
 *
 * Timeout and truncation flags explain incomplete execution or output; neither stdout nor stderr is redacted here.
 * Optional evidence recording stores completion metadata separately without command arguments or captured text.
 */
export interface ExecResult extends ExecResultBooleanFields {
  // Exit code; null means no code was available, including a spawn failure or signal termination.
  exitCode: number | null;
  // Termination signal; null means none was reported, including an ordinary exit or failure to spawn.
  signal: NodeJS.Signals | null;
  // Captured stdout; empty means no stdout was returned, and capped output carries a visible truncation marker.
  stdout: string;
  // Captured stderr; empty means no stderr was returned, and capped output carries a visible truncation marker.
  stderr: string;
  // Whether the timeout fired.
  timedOut: boolean;
  // Wall-clock duration in milliseconds.
  durationMs: number;
  // Basename of the spawned command, for telemetry.
  commandBasename: string;
}

/**
 * Hold the resolved limits and environment for a command after its launch checks pass.
 *
 * Default timeout and byte caps bound the response returned to the waiting dashboard or CLI caller.
 * The command basename is retained for completion metadata without exposing its full executable path.
 */
interface ExecRuntimeConfig {
  timeoutMs: number;
  stdoutCap: number;
  stderrCap: number;
  commandBasename: string;
  env: Record<string, string>;
}

/**
 * Track one child-process stream while retaining only a bounded set of output chunks.
 *
 * bytes counts all received data, including data no longer retained, so the final result can disclose truncation.
 * An initially empty chunk list represents a command that has not supplied any output on this stream.
 */
interface OutputCapture {
  chunks: Buffer[];
  bytes: number;
}

/**
 * Report a launch rejected before any child process starts.
 *
 * The reason distinguishes an unapproved command, invalid argument shape, or rejected argument content.
 * Callers can present the refusal directly without confusing it with a command that ran and failed.
 */
class SafeExecRejection extends Error {
  readonly reason:
    | "command-not-in-allow-list"
    | "args-contain-metacharacters"
    | "args-not-array";

  /**
   * Keep the machine-readable reason beside the message, so a route can react to why a command was refused rather than parsing its text.
   *
   * @param reason - which guard refused the call
   * @param message - human-readable explanation surfaced to the dashboard
   */
  constructor(
    reason:
      | "command-not-in-allow-list"
      | "args-contain-metacharacters"
      | "args-not-array",
    message: string,
  ) {
    super(message);
    this.name = "SafeExecRejection";
    this.reason = reason;
  }
}

export { SafeExecRejection };

/**
 * Report an atomic-write destination outside the caller's project boundary.
 *
 * The error identifies the rejected destination and the project root that constrained it.
 * Throwing before the write begins lets the route explain the refusal without publishing file content.
 */
class SafeFileWriteRejection extends Error {
  readonly reason = "target-outside-project";

  // Report the rejected destination and project root without writing any file content.
  constructor(targetPath: string, projectRoot: string) {
    super(
      `Refusing to write ${JSON.stringify(targetPath)} outside project root ${JSON.stringify(projectRoot)}`,
    );
    this.name = "SafeFileWriteRejection";
  }
}

// Extract telemetry-safe command names from POSIX or Windows-style command paths.
function basename(path: string): string {
  const lastSeparatorIndex = Math.max(
    path.lastIndexOf("/"),
    path.lastIndexOf("\\"),
  );
  return lastSeparatorIndex === -1 ? path : path.slice(lastSeparatorIndex + 1);
}

// Confirm a target path resolves to the project root or one of its descendants.
function isWithinProject(projectRoot: string, targetPath: string): boolean {
  const root = resolve(projectRoot);
  const target = resolve(targetPath);
  return target === root || target.startsWith(`${root}${sep}`);
}

/**
 * Replace complete project state only after a neighboring temporary file is flushed and closed.
 *
 * The shared directory keeps rename atomic on the same filesystem so readers do not see partially replaced content.
 * Throws SafeFileWriteRejection before writing when the target or temporary path falls outside the project bounds.
 *
 * @param targetPath - destination path to replace atomically after the caller validates its filesystem location
 * @param content - complete replacement text; an empty string intentionally publishes an empty file
 * @param projectRoot - project boundary that targetPath and its neighboring temporary file must stay within
 * @param fileMode - replacement permissions; omitted uses 0600 for private local state
 */
export function writeFileAtomic(
  targetPath: string,
  content: string,
  projectRoot: string,
  fileMode = 0o600,
): void {
  // The requested state file must stay within the caller's project instead of replacing content in an unrelated location.
  if (!isWithinProject(projectRoot, targetPath)) {
    throw new SafeFileWriteRejection(targetPath, projectRoot);
  }
  const destinationDirectory = dirname(targetPath);
  mkdirSync(destinationDirectory, { recursive: true });
  const tempPath = resolve(
    destinationDirectory,
    `.${pathBasename(targetPath)}.${process.pid}.${Date.now()}.tmp`,
  );
  // The temporary copy must obey the same project boundary before any replacement bytes are written.
  if (!isWithinProject(projectRoot, tempPath)) {
    throw new SafeFileWriteRejection(tempPath, projectRoot);
  }
  // No descriptor exists until opening succeeds, so an early failure has nothing to close.
  let fileDescriptor: number | null = null;
  try {
    fileDescriptor = openSync(tempPath, "w", fileMode);
    writeFileSync(fileDescriptor, content, "utf-8");
    fsyncSync(fileDescriptor);
    closeSync(fileDescriptor);
    // The descriptor is already closed; a later rename failure only needs temporary-path cleanup.
    fileDescriptor = null;
    renameSync(tempPath, targetPath);
  } catch (err) {
    // A write or rename failure, such as a read-only destination, reaches the caller after temporary-file cleanup is attempted.
    // A descriptor left open by the failed write must be closed before the temporary path is removed.
    if (fileDescriptor !== null) closeSync(fileDescriptor);
    try {
      unlinkSync(tempPath);
    } catch {
      // A failed open may leave no temporary file; best-effort cleanup must not hide the write failure already being returned.
    }
    throw err;
  }
}

// Copy only launch and temporary-directory settings so child commands do not inherit the rest of the server environment.
function defaultSafeEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  // Only settings needed to locate binaries or support platform and temporary-directory behavior are inherited by default.
  for (const key of DEFAULT_ENV_KEYS) {
    const envValue = process.env[key];
    // Missing or empty launch settings supply no usable value, so the child receives only the configured entries.
    if (typeof envValue === "string" && envValue !== "") env[key] = envValue;
  }
  return env;
}

// Throws `SafeExecRejection` for argv shapes that could become dangerous if a callee shells out.
function rejectIfUnsafeArgs(args: string[]): void {
  // A single command string cannot preserve the caller's argument boundaries, so the request is rejected before launch.
  if (!Array.isArray(args)) {
    throw new SafeExecRejection("args-not-array", "args must be an array");
  }
  // Every argument must pass the same check before any part of the requested command can run.
  for (const [index, arg] of args.entries()) {
    // Non-text arguments cannot be passed as the caller's intended command-line values.
    if (typeof arg !== "string") {
      throw new SafeExecRejection(
        "args-not-array",
        `args[${index}] must be a string`,
      );
    }
    // Reject separators and substitutions that a called tool could reinterpret as an additional command.
    if (SHELL_METACHARACTER.test(arg) || COMMAND_SUBSTITUTION.test(arg)) {
      throw new SafeExecRejection(
        "args-contain-metacharacters",
        `args[${index}] contains shell metacharacters: ${JSON.stringify(arg)}`,
      );
    }
  }
}

/**
 * Turn captured process output into text the dashboard can show, cutting it at the cap and saying so rather than flooding the panel.
 *
 * @param buffers - retained output chunks; an empty list supplies no process text before any truncation marker
 * @param totalBytes - bytes received from the stream, including output no longer retained after the cap
 * @param capBytes - most bytes to show
 * @returns the text plus whether it was cut; truncated text ends with a visible marker so the user knows more existed
 */
function capBuffer(
  buffers: Buffer[],
  totalBytes: number,
  capBytes: number,
): { text: string; truncated: boolean } {
  const truncated = totalBytes > capBytes;
  const joined = Buffer.concat(buffers);
  // Output fits, so the user sees exactly what the command printed.
  if (!truncated) return { text: joined.toString("utf-8"), truncated: false };
  const decoder = new StringDecoder("utf8");
  const capturedPrefix = decoder.write(
    joined.subarray(0, Math.max(0, capBytes)),
  );
  return {
    text: `${capturedPrefix}\n…[output truncated at ${capBytes} bytes]`,
    truncated: true,
  };
}

/**
 * Check the caller's command permission and argument boundaries before any subprocess can start.
 *
 * @throws SafeExecRejection - when this call site does not allow the command or its argument shape or content is rejected
 */
function validateExecRequest(opts: ExecOptions): void {
  // An installed binary still cannot run unless this particular caller included it in the allowed command set.
  if (!opts.allowList.includes(opts.command)) {
    throw new SafeExecRejection(
      "command-not-in-allow-list",
      `command ${JSON.stringify(opts.command)} is not in the allow-list`,
    );
  }
  rejectIfUnsafeArgs(opts.args);
}

// Resolve omitted execution options to bounded defaults while preserving the caller's explicit limits and child environment.
function buildExecRuntimeConfig(opts: ExecOptions): ExecRuntimeConfig {
  return {
    // Omitted limits use the shared request budgets; explicit values remain the caller's responsibility.
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    stdoutCap: opts.stdoutCapBytes ?? DEFAULT_STDOUT_CAP_BYTES,
    stderrCap: opts.stderrCapBytes ?? DEFAULT_STDOUT_CAP_BYTES,
    commandBasename: basename(opts.command),
    // An omitted environment uses minimal launch settings; an explicit empty environment stays empty.
    env: opts.env ?? defaultSafeEnv(),
  };
}

// Start an empty capture for one stream so commands with no output still return a valid empty-text result.
function createOutputCapture(): OutputCapture {
  return { chunks: [], bytes: 0 };
}

// Append child-process data while retaining only enough bytes to produce a capped response.
function appendOutputChunk(
  capture: OutputCapture,
  chunk: Buffer,
  capBytes: number,
): void {
  capture.bytes += chunk.length;
  // Stop retaining further chunks after the bounded buffer budget, while keeping the total so the result can disclose lost output.
  if (capture.bytes <= capBytes * 2) capture.chunks.push(chunk);
}

/**
 * Stop a command that overruns its deadline, asking it to quit first and killing it if it ignores that.
 * Swallows signal-cleanup failures because the runner may stop during timeout handling; the recorded timeout remains the caller's result.
 *
 * @param child - the running process to stop
 * @param timeoutMs - how long the command may run before it is stopped
 * @param onTimeout - callback that records the timeout so the user is told why the output stops
 * @returns the unref'd timer, so the caller can clear it when the command finishes on its own
 */
function startTimeoutGuard(
  child: ReturnType<typeof spawn>,
  timeoutMs: number,
  onTimeout: () => void,
): NodeJS.Timeout {
  const timer = setTimeout(() => {
    onTimeout();
    try {
      child.kill("SIGTERM");
    } catch {
      // If the runner stops during timeout cleanup, ignore a failed termination attempt and retain the timeout already recorded for the caller.
    }
    setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // The runner may have exited during the grace period; ignore cleanup failure because the caller already has its timeout state.
      }
    }, KILL_GRACE_MS).unref();
  }, timeoutMs);
  timer.unref();
  return timer;
}

/**
 * Combine the command's close status, timeout state, and captured streams into the result the waiting caller receives.
 *
 * @param runtime - resolved limits and command label used to cap output and identify the completed action
 * @param output - stdout and stderr captures; empty streams produce empty text unless a truncation marker is needed
 * @param status - close and timeout state; a null exit code means no ordinary exit status was available
 * @returns capped process output and status; captured text is not redacted, and evidence recording separately stores only completion metadata
 */
function buildExecResult(
  runtime: ExecRuntimeConfig,
  output: { stdout: OutputCapture; stderr: OutputCapture },
  status: {
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    hasTimedOut: boolean;
    start: number;
  },
): ExecResult {
  const stdoutResult = capBuffer(
    output.stdout.chunks,
    output.stdout.bytes,
    runtime.stdoutCap,
  );
  const stderrResult = capBuffer(
    output.stderr.chunks,
    output.stderr.bytes,
    runtime.stderrCap,
  );
  return {
    ok: !status.hasTimedOut && status.exitCode === 0,
    exitCode: status.exitCode,
    signal: status.signal,
    stdout: stdoutResult.text,
    stderr: stderrResult.text,
    timedOut: status.hasTimedOut,
    truncated: stdoutResult.truncated || stderrResult.truncated,
    durationMs: Number((performance.now() - status.start).toFixed(2)),
    commandBasename: runtime.commandBasename,
  };
}

// Writes command-completion metadata only when the caller opts into a local evidence event.
function recordExecEvidence(opts: ExecOptions, result: ExecResult): void {
  // Callers that did not request an evidence event still receive the command result without a local trace write.
  if (!opts.evidence) return;
  recordEvidenceEvent(
    {
      actor: "server",
      // Unspecified event labels retain the shared command-completion category and producer.
      eventType: opts.evidence.eventKind ?? "audit.exec",
      producer: opts.evidence.producer ?? "safe-exec",
      projectRoot: opts.evidence.projectPath,
      payload: {
        command: result.commandBasename,
        ok: result.ok,
        exitCode: result.exitCode,
        signal: result.signal,
        timedOut: result.timedOut,
        truncated: result.truncated,
        durationMs: result.durationMs,
      },
      provenance: {
        framework_evidence_paths: ["src/cli/server/safe-exec.ts"],
        reason:
          "safe-exec records command completion without args, stdout, or stderr",
      },
    },
    { onWarning: opts.evidence.onWarning },
  );
}

/**
 * Spawns one caller-approved command without a shell and reports bounded output for the waiting dashboard or CLI action.
 *
 * Launch validation rejects unsafe requests before execution; process errors resolve as failed results with diagnostic output.
 * Timeout cleanup and output caps preserve a bounded response, while optional evidence records completion without captured text.
 *
 * @param opts - command, positional arguments, validated working directory, allowed commands, and optional limits and evidence settings
 * @returns a promise for the process result; pre-launch validation rejects rather than starting a command
 */
export function execSafely(opts: ExecOptions): Promise<ExecResult> {
  try {
    validateExecRequest(opts);
  } catch (err) {
    // A command outside the caller's allow-list or a rejected pasted argument returns a launch error before any child process exists.
    return Promise.reject(err instanceof Error ? err : new Error(String(err)));
  }
  const runtime = buildExecRuntimeConfig(opts);

  return new Promise<ExecResult>((resolveExec) => {
    const start = performance.now();
    const stdout = createOutputCapture();
    const stderr = createOutputCapture();
    let hasTimedOut = false;
    let hasSettled = false;

    const child = spawn(opts.command, opts.args, {
      cwd: opts.cwd,
      env: runtime.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timer = startTimeoutGuard(child, runtime.timeoutMs, () => {
      hasTimedOut = true;
    });

    child.stdout.on("data", (chunk: Buffer) => {
      appendOutputChunk(stdout, chunk, runtime.stdoutCap);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      appendOutputChunk(stderr, chunk, runtime.stderrCap);
    });

    /**
     * Finish the requested action once, even when both spawn error and close events arrive.
     *
     * @param exitCode - process exit status; null also covers a failed spawn with no exit code
     * @param signal - termination signal, or null when no signal was reported
     */
    function finish(exitCode: number | null, signal: NodeJS.Signals | null) {
      // An earlier event already returned the result and recorded completion, so a second event must not repeat either action.
      if (hasSettled) return;
      hasSettled = true;
      clearTimeout(timer);
      const result = buildExecResult(
        runtime,
        { stdout, stderr },
        { exitCode, signal, hasTimedOut, start },
      );
      recordExecEvidence(opts, result);
      resolveExec(result);
    }

    // A missing executable or vanished working directory produces a failed result with the spawn diagnostic preserved for the caller.
    child.on("error", (spawnError) => {
      appendOutputChunk(
        stderr,
        Buffer.from(`spawn error: ${spawnError.message}`, "utf-8"),
        runtime.stderrCap,
      );
      finish(null, null);
    });
    child.on("close", (code, signal) => {
      finish(code, signal);
    });
  });
}

/**
 * Describe an interactive command that keeps the user's existing terminal input and output.
 *
 * Allowed basenames are compared without letter case so callers can pass resolved binaries from different platforms.
 * This path does not capture output or enforce a runtime limit; the caller chooses it for interactive CLI work.
 */
export interface InheritedSpawnOptions {
  // Resolved binary to spawn; its basename must appear in `allowedBasenames`.
  command: string;
  // Positional arguments checked for the same separators and substitutions as execSafely; empty means no command arguments.
  args: string[];
  // Command basenames permitted by this call site, compared without letter case; an empty list rejects every launch.
  allowedBasenames: readonly string[];
  // Child environment passed through unchanged; omitted inherits the current process environment.
  env?: NodeJS.ProcessEnv;
}

/**
 * Spawns an approved interactive command with input and output attached to the user's existing terminal.
 *
 * Output and runtime remain uncapped for CLI work such as the bundled installer; arguments still run without shell expansion.
 * Throws SafeExecRejection before execution when the basename allow-list or argument checks reject the launch.
 *
 * @param opts - resolved command, positional arguments, permitted basenames, and optional child environment
 * @returns raw spawnSync result; null status or an error means the caller must handle an unsuccessful launch or termination
 */
export function spawnInheritedSync(
  opts: InheritedSpawnOptions,
): SpawnSyncReturns<Buffer> {
  const commandBasename = pathBasename(opts.command).toLowerCase();
  // Platform-specific binary names and caller-supplied allow-list entries must use the same case-insensitive comparison.
  const allowedBasenames = opts.allowedBasenames.map((name) =>
    name.toLowerCase(),
  );
  // A discovered interactive binary still needs permission from this call site before it can attach to the user's terminal.
  if (!allowedBasenames.includes(commandBasename)) {
    throw new SafeExecRejection(
      "command-not-in-allow-list",
      `command ${JSON.stringify(opts.command)} is not in the allow-list`,
    );
  }
  rejectIfUnsafeArgs(opts.args);
  return spawnSync(opts.command, opts.args, {
    env: opts.env,
    stdio: "inherit",
    shell: false,
  });
}

/**
 * Build the exact method-and-path key used to decide whether a dashboard request belongs to a write-capable route.
 *
 * @param method - incoming HTTP method, normalized to uppercase for matching
 * @param path - normalized route path that identifies the requested action
 * @returns canonical method-and-path key for exact allow-list lookup
 */
export function sideEffectfulRouteKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}
