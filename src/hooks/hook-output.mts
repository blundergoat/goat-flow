/** Bounded output for the native hook launcher preserves original result bytes and diagnostic prefixes. */
import { StringDecoder } from "node:string_decoder";

export const HOOK_RESULT_OUTPUT_LIMIT_BYTES = 10_000; // Cap: fits Copilot's smallest feedback channel.
export const HOOK_RESULT_ENVELOPE_LIMIT_BYTES = 65_536; // Cap: keeps scan detail separate from provider output.
export const HOOK_STDERR_RETENTION_LIMIT_BYTES = 4096; // Cap: retains actionable diagnostics.
export const HOOK_STDERR_FLOOD_LIMIT_BYTES = 1_048_576; // Cap: stops a diagnostic flood while draining ordinary excess.

export interface HookOutputMeasurement {
  envelopeLimitBytes: number;
  stderrRetentionLimitBytes: number;
  stderrFloodLimitBytes: number;
  providerLimitBytes: number;
  stdoutBytes: number;
  stderrBytes: number;
  areByteCountsExact: boolean;
  isStderrTruncated: boolean;
  failureStage?: "envelope" | "diagnostic-flood";
}

export interface CapturedHookOutput {
  stdout: string;
  stderr: string;
  managed: boolean;
  output?: HookOutputMeasurement;
}

interface CapturedStreamState {
  stdout: StringDecoder;
  stderr: StringDecoder;
  stdoutBytes: number;
  stderrBytes: number;
  stderrRetainedBytes: number;
  stdoutChunks: Buffer[];
}

const capturedStreamStates = new WeakMap<
  CapturedHookOutput,
  CapturedStreamState
>();

/** Start one capture; managed empty output retains zero-byte measurements before any chunk arrives. */
export function createCapturedHookOutput(
  managed: boolean,
  stdoutLimitBytes = HOOK_RESULT_ENVELOPE_LIMIT_BYTES,
): CapturedHookOutput {
  const captured: CapturedHookOutput = { stdout: "", stderr: "", managed };
  if (managed)
    captured.output = {
      envelopeLimitBytes: stdoutLimitBytes,
      stderrRetentionLimitBytes: HOOK_STDERR_RETENTION_LIMIT_BYTES,
      stderrFloodLimitBytes: HOOK_STDERR_FLOOD_LIMIT_BYTES,
      providerLimitBytes: HOOK_RESULT_OUTPUT_LIMIT_BYTES,
      stdoutBytes: 0,
      stderrBytes: 0,
      areByteCountsExact: false,
      isStderrTruncated: false,
    };
  return captured;
}

/** Record raw-byte lower bounds; false reports a limit breach before retaining the offending chunk. */
function recordHookOutputBytes(
  captured: CapturedHookOutput,
  state: CapturedStreamState,
  stream: "stdout" | "stderr",
): boolean {
  const managed = captured.managed;
  // Legacy policy retains its shared ceiling and does not adopt managed diagnostic draining.
  if (
    !managed &&
    state.stdoutBytes + state.stderrBytes > HOOK_RESULT_OUTPUT_LIMIT_BYTES
  )
    return false;
  captured.output = {
    envelopeLimitBytes:
      captured.output?.envelopeLimitBytes ?? HOOK_RESULT_ENVELOPE_LIMIT_BYTES,
    stderrRetentionLimitBytes: HOOK_STDERR_RETENTION_LIMIT_BYTES,
    stderrFloodLimitBytes: HOOK_STDERR_FLOOD_LIMIT_BYTES,
    providerLimitBytes: HOOK_RESULT_OUTPUT_LIMIT_BYTES,
    stdoutBytes: state.stdoutBytes,
    stderrBytes: state.stderrBytes,
    areByteCountsExact: false,
    isStderrTruncated:
      managed && state.stderrBytes > HOOK_STDERR_RETENTION_LIMIT_BYTES,
  };
  if (
    managed &&
    (state.stdoutBytes > captured.output.envelopeLimitBytes ||
      state.stderrBytes > HOOK_STDERR_FLOOD_LIMIT_BYTES)
  ) {
    captured.output.failureStage =
      stream === "stdout" ? "envelope" : "diagnostic-flood";
    return false;
  }
  return true;
}

/**
 * Retain one chunk with separate managed result and diagnostic budgets.
 * Mutates raw counts and decoded prefixes; false requires the capture owner to stop the hook.
 */
export function appendBoundedHookOutput(
  captured: CapturedHookOutput,
  stream: "stdout" | "stderr",
  chunk: Buffer | string,
): boolean {
  let state = capturedStreamStates.get(captured);
  if (state === undefined) {
    state = {
      stdout: new StringDecoder("utf8"),
      stderr: new StringDecoder("utf8"),
      stdoutBytes: 0,
      stderrBytes: 0,
      stderrRetainedBytes: 0,
      stdoutChunks: [],
    };
    capturedStreamStates.set(captured, state);
  }
  const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  state[`${stream}Bytes`] += bytes.length;
  if (!recordHookOutputBytes(captured, state, stream)) return false;
  let retained = bytes;
  // Original stdout bytes establish validity after EOF rather than at arbitrary chunk boundaries.
  if (stream === "stdout") state.stdoutChunks.push(bytes);
  // Managed diagnostic excess is counted and drained while only its bounded prefix reaches the provider.
  if (captured.managed && stream === "stderr") {
    retained = bytes.subarray(
      0,
      Math.max(
        0,
        HOOK_STDERR_RETENTION_LIMIT_BYTES - state.stderrRetainedBytes,
      ),
    );
    state.stderrRetainedBytes += retained.length;
  }
  captured[stream] += state[stream].write(retained);
  return true;
}

/**
 * Complete decoded prefixes once when the owner delivers its terminal result.
 * Reports invalid original stdout as true; truncated diagnostics never gain a partial replacement character.
 */
export function finishCapturedHookOutput(
  captured: CapturedHookOutput,
): boolean {
  const state = capturedStreamStates.get(captured);
  if (state === undefined) return false;
  captured.stdout += state.stdout.end();
  if (!captured.output?.isStderrTruncated)
    captured.stderr += state.stderr.end();
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(state.stdoutChunks),
    );
    return false;
  } catch {
    // Invalid UTF-8 is handled by the capture owner as an unavailable scan.
    return true;
  }
}
