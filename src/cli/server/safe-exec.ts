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
import { performance } from "node:perf_hooks";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_STDOUT_CAP_BYTES = 1_048_576; // 1 MB
const KILL_GRACE_MS = 2_000;

/**
 * Shell metacharacters rejected in args. Because we always spawn with
 * `shell: false`, redirection / glob characters like `>` `<` `*` are inert at
 * execve time. We still reject the four genuinely-dangerous tokens because
 * any hostile callee shelling out internally would re-interpret them.
 */
const SHELL_METACHARACTER = /[;|\n\r\0]/u;
const COMMAND_SUBSTITUTION = /\$\(|`/u;

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
  /** Optional environment. Callers must scrub secrets; the helper does not. */
  env?: Record<string, string>;
  /** Optional cap on captured stdout bytes. Defaults to 1 MB. */
  stdoutCapBytes?: number;
  /** Optional cap on captured stderr bytes. Defaults to 1 MB. */
  stderrCapBytes?: number;
}

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

function basename(path: string): string {
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return slash === -1 ? path : path.slice(slash + 1);
}

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
  const joined = Buffer.concat(buffers).toString("utf-8");
  if (!truncated) return { text: joined, truncated: false };
  const head = joined.slice(0, capBytes);
  return {
    text: `${head}\n…[output truncated at ${capBytes} bytes]`,
    truncated: true,
  };
}

/** Run a single command with strict allow-listing, no shell, and a timeout. */
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
    return Promise.reject(err);
  }
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const stdoutCap = opts.stdoutCapBytes ?? DEFAULT_STDOUT_CAP_BYTES;
  const stderrCap = opts.stderrCapBytes ?? DEFAULT_STDOUT_CAP_BYTES;
  const commandBasename = basename(opts.command);

  return new Promise<ExecResult>((resolveExec) => {
    const start = performance.now();
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let settled = false;

    const child = spawn(opts.command, opts.args, {
      cwd: opts.cwd,
      env: opts.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      timedOut = true;
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

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes <= stdoutCap * 2) stdoutChunks.push(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes <= stderrCap * 2) stderrChunks.push(chunk);
    });

    function finish(exitCode: number | null, signal: NodeJS.Signals | null) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const out = capBuffer(stdoutChunks, stdoutBytes, stdoutCap);
      const err = capBuffer(stderrChunks, stderrBytes, stderrCap);
      const result: ExecResult = {
        ok: !timedOut && exitCode === 0,
        exitCode,
        signal,
        stdout: out.text,
        stderr: err.text,
        timedOut,
        truncated: out.truncated || err.truncated,
        durationMs: Number((performance.now() - start).toFixed(2)),
        commandBasename,
      };
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

/** Build the route key used by `SIDE_EFFECTFUL_EXACT_API_ROUTES.has()`. */
export function sideEffectfulRouteKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}
