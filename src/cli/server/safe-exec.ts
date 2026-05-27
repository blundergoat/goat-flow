/**
 * Shared, consent-checked, allow-listed, timeout-bounded command executor.
 *
 * Every dashboard route that needs to spawn a local process must go through
 * this helper. Callers declare an explicit per-call-site allow-list; commands
 * not in that list are rejected synchronously without a spawn. Arguments are
 * passed positionally to `child_process.spawn` with `shell: false` so shell
 * metacharacters in `args` cannot be interpreted.
 *
 * Pitfalls (M31):
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

/** Completed process result with captured output bounded to the configured byte caps. */
export interface ExecResult {
  /** `true` iff the process exited with code 0 and did not time out. */
  ok: boolean;
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
  /** Whether the stdout or stderr cap truncated the output. */
  truncated: boolean;
  /** Wall-clock duration in milliseconds. */
  durationMs: number;
  /** Basename of the spawned command, for telemetry. */
  commandBasename: string;
}

/** Rejected safety check before any child process is spawned. */
export class SafeExecRejection extends Error {
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

/** Rejected local file write before any content is written. */
class SafeFileWriteRejection extends Error {
  readonly reason = "target-outside-project";

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
      /* temp file may not exist */
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

/** Writes redacted command-completion evidence only when a route opts in. */
function recordExecEvidence(opts: ExecOptions, result: ExecResult): void {
  if (!opts.evidence) return;
  recordEvidenceEvent(
    {
      actor: "server",
      eventKind: opts.evidence.eventKind ?? "audit.exec",
      producer: opts.evidence.producer ?? "safe-exec",
      projectPath: opts.evidence.projectPath,
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
  const allowList = opts.allowList;
  if (!allowList.includes(opts.command)) {
    return Promise.reject(
      new SafeExecRejection(
        "command-not-in-allow-list",
        `command ${JSON.stringify(opts.command)} is not in the allow-list`,
      ),
    );
  }
  try {
    rejectIfUnsafeArgs(opts.args);
  } catch (err) {
    return Promise.reject(err instanceof Error ? err : new Error(String(err)));
  }
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const stdoutCap = opts.stdoutCapBytes ?? DEFAULT_STDOUT_CAP_BYTES;
  const stderrCap = opts.stderrCapBytes ?? DEFAULT_STDOUT_CAP_BYTES;
  const commandBasename = basename(opts.command);
  const env = opts.env ?? defaultSafeEnv();

  return new Promise<ExecResult>((resolveExec) => {
    const start = performance.now();
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let hasTimedOut = false;
    let hasSettled = false;

    const child = spawn(opts.command, opts.args, {
      cwd: opts.cwd,
      env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      hasTimedOut = true;
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

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes <= stdoutCap * 2) stdoutChunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes <= stderrCap * 2) stderrChunks.push(chunk);
    });

    /** Writes evidence and resolves once because both spawn error and close can fire. */
    function finish(exitCode: number | null, signal: NodeJS.Signals | null) {
      if (hasSettled) return;
      hasSettled = true;
      clearTimeout(timer);
      const out = capBuffer(stdoutChunks, stdoutBytes, stdoutCap);
      const err = capBuffer(stderrChunks, stderrBytes, stderrCap);
      const result: ExecResult = {
        ok: !hasTimedOut && exitCode === 0,
        exitCode,
        signal,
        stdout: out.text,
        stderr: err.text,
        timedOut: hasTimedOut,
        truncated: out.truncated || err.truncated,
        durationMs: Number((performance.now() - start).toFixed(2)),
        commandBasename,
      };
      recordExecEvidence(opts, result);
      resolveExec(result);
    }

    child.on("error", (e) => {
      stderrChunks.push(Buffer.from(`spawn error: ${e.message}`, "utf-8"));
      stderrBytes += e.message.length;
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
