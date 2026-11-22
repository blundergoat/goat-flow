/**
 * Collects results from installed hooks and the helpers they start.
 *
 * Use when an agent action or a turn ending starts a native hook.
 * The caller gets a result or a failure within the hook's time and output limits.
 */
import type { ChildProcess } from "node:child_process";
import {
  appendBoundedHookOutput,
  createCapturedHookOutput,
  finishCapturedHookOutput,
  type HookOutputMeasurement,
} from "./hook-output.mjs";
import { stopHookProcessTree } from "./process-tree.mjs";

/**
 * Reports what a hook or helper produced before it stopped.
 *
 * Use to choose between delivering a result, reporting a failure, or retrying a check.
 * A null status means there is no trusted exit code, and output metrics are absent outside managed capture.
 */
export interface CapturedHookProcessResult {
  status: number | null;
  timedOut: boolean;
  launchError: Error | null;
  stdout: string;
  stderr: string;
  hasExceededOutputLimit: boolean;
  output: HookOutputMeasurement | undefined;
  hasInvalidUtf8Output: boolean;
}

/**
 * Wait for a started hook so the agent can receive a decision or see why the check did not finish.
 * Use the default output budget for agent replies or pass a larger budget for an analyzer report.
 *
 * @returns Captured output and failure details. A null status means there is no completed exit code to trust.
 */
export function captureHookProcessUntilDeadline(
  hookProcess: ChildProcess,
  hookEnvironment: NodeJS.ProcessEnv,
  launchTimeout: number,
  hostPlatform: NodeJS.Platform,
  shouldCaptureResult: boolean,
  {
    stdoutLimitBytes,
    ownsProcessGroup = true,
    handleCancellation = false,
  }: {
    stdoutLimitBytes?: number;
    ownsProcessGroup?: boolean;
    handleCancellation?: boolean;
  } = {},
): Promise<CapturedHookProcessResult> {
  return new Promise((resolveHookResult) => {
    let hasFinishedSupervision = false;
    let hasHookReachedDeadline = false;
    let hasExceededOutputLimit = false;
    const captured = createCapturedHookOutput(
      hookEnvironment.GOAT_FLOW_HOOK_PROVIDER_MODE === "managed",
      stdoutLimitBytes,
    );

    /** Close the output pipes so a worker still holding them cannot delay the agent's reply. */
    function releaseHookOutputStreams(): void {
      // Either output stream may still be open when an analyzer runs out of time.
      for (const outputStream of [hookProcess.stdout, hookProcess.stderr]) {
        // An inherited stream needs no cleanup from this launcher.
        if (outputStream === null) continue;
        outputStream.removeAllListeners("data");
        outputStream.destroy();
      }
    }

    /** Stop the hook and its workers when the caller can no longer use their result. */
    function stopHook(): void {
      stopHookProcessTree(
        hookProcess,
        hostPlatform,
        hookEnvironment,
        ownsProcessGroup,
      );
      hookProcess.unref();
      releaseHookOutputStreams();
    }

    /** Forward a cancellation after cleanup so stopping a turn cannot deliver a hook decision. */
    function cancelHook(signal: NodeJS.Signals): void {
      stopHook();
      finishSupervision();
      process.kill(process.pid, signal);
    }

    // The launcher handles signals sent to it. Helpers share the launcher's cancellation path.
    if (handleCancellation) {
      process.once("SIGINT", cancelHook);
      process.once("SIGTERM", cancelHook);
    }
    // Report a timeout even if an analyzer worker still holds the output pipes open.
    const launchDeadlineTimer = setTimeout(() => {
      hasHookReachedDeadline = true;
      stopHook();
      deliverHookResult(null, null);
    }, launchTimeout);

    /** Clear the timer and handlers so a finished check cannot respond again. */
    function finishSupervision(): void {
      hasFinishedSupervision = true;
      clearTimeout(launchDeadlineTimer);
      // The launcher removes the handlers it registered for this check.
      if (handleCancellation) {
        process.removeListener("SIGINT", cancelHook);
        process.removeListener("SIGTERM", cancelHook);
      }
    }

    /**
     * Return one result for the agent or the calling hook.
     *
     * @param status - Exit code, or null if the check stopped without one.
     * @param launchError - Startup failure, or null if startup did not fail.
     */
    function deliverHookResult(
      status: number | null,
      launchError: Error | null,
    ): void {
      // The timeout or output limit may have already reported a result before the process closed.
      if (hasFinishedSupervision) return;
      finishSupervision();
      const hasInvalidUtf8Output = finishCapturedHookOutput(captured);
      // Managed runs report exact byte counts only when the hook finished normally.
      if (captured.output)
        captured.output.areByteCountsExact =
          status !== null &&
          launchError === null &&
          !hasHookReachedDeadline &&
          !hasExceededOutputLimit;
      resolveHookResult({
        status,
        timedOut: hasHookReachedDeadline,
        launchError,
        stdout: captured.stdout,
        stderr: captured.stderr,
        hasExceededOutputLimit,
        output: captured.output,
        hasInvalidUtf8Output,
      });
    }

    /** Collect output until it reaches the limit, then end the check with an output-limit result. */
    function captureHookOutputChunk(
      stream: "stdout" | "stderr",
      chunk: Buffer | string,
    ): void {
      // Ignore bytes queued after the check already hit its output limit.
      if (hasExceededOutputLimit) return;
      // Keep waiting for the result while the incoming output still fits.
      if (appendBoundedHookOutput(captured, stream, chunk)) return;
      hasExceededOutputLimit = true;
      stopHook();
      deliverHookResult(null, null);
    }

    // Collect output only for checks that return a reply. The caller relays other output directly.
    if (shouldCaptureResult && hookProcess.stdout && hookProcess.stderr) {
      hookProcess.stdout.on(
        "data",
        captureHookOutputChunk.bind(null, "stdout"),
      );
      hookProcess.stderr.on(
        "data",
        captureHookOutputChunk.bind(null, "stderr"),
      );
    }
    hookProcess.once("error", (error) => {
      deliverHookResult(null, error);
    });
    hookProcess.once("close", (status) => {
      deliverHookResult(status, null);
    });
  });
}
