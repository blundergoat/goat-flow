/**
 * Shared, consent-checked, allow-listed, timeout-bounded command executor.
 *
 * Every dashboard route that needs to spawn a local process must go through
 * this helper. Callers declare an explicit per-call-site allow-list; commands
 * not in that list are rejected synchronously without a spawn. Arguments are
 * passed positionally to `child_process.spawn` with `shell: false` so shell
 * metacharacters in `args` cannot be interpreted.
 *
 * Pitfalls:
 *   - Do NOT pass `shell: true`. Ever.
 *   - Do NOT accept user-supplied `env`. Callers must scrub secrets first.
 *   - Always use positional `args: string[]`, never a single command string.
 *   - The `allowList` is the security boundary, not `command -v`.
 */
import { spawn } from "node:child_process";
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
 * Shell metacharacters rejected in args. Because we always spawn with
 * `shell: false`, redirection / glob characters like `>` `<` `*` are inert at
 * execve time. We still reject the four genuinely-dangerous tokens because
 * any hostile callee shelling out internally would re-interpret them.
 */
const SHELL_METACHARACTER = /[;|\n\r\0]/u;
const COMMAND_SUBSTITUTION = /\$\(|`/u;

/** Spawn request accepted by `execSafely` after the caller has validated route inputs. */
export interface ExecOptions {
  /** The binary to spawn. Must exactly match an entry in `allowList`. */
  command: string;
  /** Positional argv after `command`. No shell interpolation; metacharacters
   *  in any arg cause a synchronous rejection before spawn. */
  args: string[];
  /** Working directory. Callers validate this with `validateLocalPath`. */
  cwd: string;
  /** Hard wall-clock cap; the process is killed (SIGTERM → SIGKILL) on expiry. */
  timeoutMs?: number;
  /** Explicit per-call-site whitelist. The command must be a member, regardless
   *  of whether `command -v` would resolve it. */
  allowList: readonly string[];
  /** Optional environment. Defaults to a minimal PATH/temp env; callers that
   *  pass env must scrub secrets first. */
  env?: Record<string, string>;
  /** Optional cap on captured stdout bytes. Defaults to 1 MB. */
  stdoutCapBytes?: number;
  /** Optional cap on captured stderr bytes. Defaults to 1 MB. */
  stderrCapBytes?: number;
  /** Optional local evidence event for spawned command completion. */
  evidence?: {
    projectPath: string;
    eventKind?: EvidenceEventKind;
    producer?: string;
    onWarning?: EvidenceEnvelopeWriteOptions["onWarning"];
  };
}

/** Stable result flags: `ok` means clean exit; `truncated` means an output cap fired. */
type ExecResultBooleanFields = Record<"ok" | "truncated", boolean>;

/** Completed process result with captured output bounded to the configured byte caps. */
export interface ExecResult extends ExecResultBooleanFields {
  /** Exit code; `null` if the process was killed by signal. */
  exitCode: number | null;
  /** Signal that terminated the process, if any. */
  signal: NodeJS.Signals | null;
  /** Captured stdout, truncated with a marker line if the cap fired. */
  stdout: string;
  /** Captured stderr, truncated with a marker line if the cap fired. */
  stderr: string;
  /** Whether the timeout fired. */
  timedOut: boolean;
  /** Wall-clock duration in milliseconds. */
  durationMs: number;
  /** Basename of the spawned command, for telemetry. */
  commandBasename: string;
}

/** Runtime defaults derived after pre-spawn validation succeeds. */
interface ExecRuntimeConfig {
  timeoutMs: number;
  stdoutCap: number;
  stderrCap: number;
  commandBasename: string;
  env: Record<string, string>;
}

/** Buffered stream state used to cap output without keeping unlimited data. */
interface OutputCapture {
  chunks: Buffer[];
  bytes: number;
}

/** Rejected safety check before any child process is spawned. */
class SafeExecRejection extends Error {
  readonly reason:
    | "command-not-in-allow-list"
    | "args-contain-metacharacters"
    | "args-not-array";

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

/** Rejected local file write before any content is written. */
class SafeFileWriteRejection extends Error {
  readonly reason = "target-outside-project";

  /** Report the rejected destination and project root without writing any file content. */
  constructor(targetPath: string, projectRoot: string) {
    super(
      `Refusing to write ${JSON.stringify(targetPath)} outside project root ${JSON.stringify(projectRoot)}`,
    );
    this.name = "SafeFileWriteRejection";
  }
}

/** Extract telemetry-safe command names from POSIX or Windows-style command paths. */
function basename(path: string): string {
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return slash === -1 ? path : path.slice(slash + 1);
}

/** Confirm a target path resolves to the project root or one of its descendants. */
function isWithinProject(projectRoot: string, targetPath: string): boolean {
  const root = resolve(projectRoot);
  const target = resolve(targetPath);
  return target === root || target.startsWith(`${root}${sep}`);
}

/**
 * Write one file atomically inside a project root.
 *
 * The temp file lives beside the destination so `rename` stays atomic on the
 * same filesystem. Existing destination content is replaced only after the
 * temp file is flushed and closed.
 *
 * @param targetPath - destination path to replace atomically
 * @param content - complete file contents to write
 * @param projectRoot - project boundary that targetPath must stay within
 */
export function writeFileAtomic(
  targetPath: string,
  content: string,
  projectRoot: string,
): void {
  if (!isWithinProject(projectRoot, targetPath)) {
    throw new SafeFileWriteRejection(targetPath, projectRoot);
  }
  const dir = dirname(targetPath);
  mkdirSync(dir, { recursive: true });
  const tempPath = resolve(
    dir,
    `.${pathBasename(targetPath)}.${process.pid}.${Date.now()}.tmp`,
  );
  if (!isWithinProject(projectRoot, tempPath)) {
    throw new SafeFileWriteRejection(tempPath, projectRoot);
  }
  let fd: number | null = null;
  try {
    fd = openSync(tempPath, "w", 0o600);
    writeFileSync(fd, content, "utf-8");
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    renameSync(tempPath, targetPath);
  } catch (err) {
    if (fd !== null) closeSync(fd);
    try {
      unlinkSync(tempPath);
    } catch {
      /* temp file may be missing — best-effort cleanup before rethrow */
    }
    throw err;
  }
}

/** Build a minimal inherited environment so spawned commands keep PATH but not secrets. */
function defaultSafeEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of DEFAULT_ENV_KEYS) {
    const envValue = process.env[key];
    if (typeof envValue === "string" && envValue !== "") env[key] = envValue;
  }
  return env;
}

/** Throws `SafeExecRejection` for argv shapes that could become dangerous if a callee shells out. */
function rejectIfUnsafeArgs(args: string[]): void {
  if (!Array.isArray(args)) {
    throw new SafeExecRejection("args-not-array", "args must be an array");
  }
  for (const [index, arg] of args.entries()) {
    if (typeof arg !== "string") {
      throw new SafeExecRejection(
        "args-not-array",
        `args[${index}] must be a string`,
      );
    }
    if (SHELL_METACHARACTER.test(arg) || COMMAND_SUBSTITUTION.test(arg)) {
      throw new SafeExecRejection(
        "args-contain-metacharacters",
        `args[${index}] contains shell metacharacters: ${JSON.stringify(arg)}`,
      );
    }
  }
}

function capBuffer(
  buffers: Buffer[],
  totalBytes: number,
  capBytes: number,
): { text: string; truncated: boolean } {
  const truncated = totalBytes > capBytes;
  const joined = Buffer.concat(buffers);
  if (!truncated) return { text: joined.toString("utf-8"), truncated: false };
  const decoder = new StringDecoder("utf8");
  const head = decoder.write(joined.subarray(0, Math.max(0, capBytes)));
  return {
    text: `${head}\n…[output truncated at ${capBytes} bytes]`,
    truncated: true,
  };
}

/**
 * Validate command and argv before spawn.
 *
 * @throws SafeExecRejection when the command is not explicitly allowed or argv is unsafe.
 */
function validateExecRequest(opts: ExecOptions): void {
  if (!opts.allowList.includes(opts.command)) {
    throw new SafeExecRejection(
      "command-not-in-allow-list",
      `command ${JSON.stringify(opts.command)} is not in the allow-list`,
    );
  }
  rejectIfUnsafeArgs(opts.args);
}

/** Resolve timeout, caps, command display name, and environment after validation. */
function buildExecRuntimeConfig(opts: ExecOptions): ExecRuntimeConfig {
  return {
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    stdoutCap: opts.stdoutCapBytes ?? DEFAULT_STDOUT_CAP_BYTES,
    stderrCap: opts.stderrCapBytes ?? DEFAULT_STDOUT_CAP_BYTES,
    commandBasename: basename(opts.command),
    env: opts.env ?? defaultSafeEnv(),
  };
}

/** Create an output accumulator for stdout or stderr. */
function createOutputCapture(): OutputCapture {
  return { chunks: [], bytes: 0 };
}

/** Append child-process data while retaining only enough bytes to produce a capped response. */
function appendOutputChunk(
  capture: OutputCapture,
  chunk: Buffer,
  capBytes: number,
): void {
  capture.bytes += chunk.length;
  if (capture.bytes <= capBytes * 2) capture.chunks.push(chunk);
}

/** Start the timeout that first sends SIGTERM, then SIGKILL after the grace period. */
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
      /* already gone */
    }
    setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    }, KILL_GRACE_MS).unref();
  }, timeoutMs);
  timer.unref();
  return timer;
}

/**
 * Build the externally visible execution result from collected process state.
 *
 * @param runtime Runtime config derived from validated options.
 * @param output Captured stdout and stderr accumulators.
 * @param status Process close status and timeout state.
 * @returns Redacted, capped execution result for API responses and evidence logs.
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
  const out = capBuffer(
    output.stdout.chunks,
    output.stdout.bytes,
    runtime.stdoutCap,
  );
  const err = capBuffer(
    output.stderr.chunks,
    output.stderr.bytes,
    runtime.stderrCap,
  );
  return {
    ok: !status.hasTimedOut && status.exitCode === 0,
    exitCode: status.exitCode,
    signal: status.signal,
    stdout: out.text,
    stderr: err.text,
    timedOut: status.hasTimedOut,
    truncated: out.truncated || err.truncated,
    durationMs: Number((performance.now() - status.start).toFixed(2)),
    commandBasename: runtime.commandBasename,
  };
}

/** Writes redacted command-completion evidence only when a route opts in. */
function recordExecEvidence(opts: ExecOptions, result: ExecResult): void {
  if (!opts.evidence) return;
  recordEvidenceEvent(
    {
      actor: "server",
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
 * Spawns one allow-listed command without a shell and reports bounded output.
 *
 * The control flow stays explicit because each branch owns a different safety
 * invariant: pre-spawn rejection, timeout cleanup, output capping, spawn-error
 * recovery, and optional evidence writes.
 *
 * @param opts Spawn request plus allow-list, cwd, caps, and optional evidence settings.
 * @returns A promise that resolves with the process result or rejects with `SafeExecRejection`.
 */
export function execSafely(opts: ExecOptions): Promise<ExecResult> {
  try {
    validateExecRequest(opts);
  } catch (err) {
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

    /** Writes evidence and resolves once because both spawn error and close can fire. */
    function finish(exitCode: number | null, signal: NodeJS.Signals | null) {
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

    child.on("error", (e) => {
      appendOutputChunk(
        stderr,
        Buffer.from(`spawn error: ${e.message}`, "utf-8"),
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
 * Build the canonical key for side-effectful API route allow-lists.
 *
 * @param method HTTP method as received from the server.
 * @param path Normalised route path.
 * @returns Uppercase-method route key used by exact-match allow-lists.
 */
export function sideEffectfulRouteKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}
