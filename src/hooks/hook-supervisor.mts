/** Native hook supervision delivers one bounded result and cleans up forced endings. */
import type { ChildProcess } from "node:child_process";
import {
  appendBoundedHookOutput,
  createCapturedHookOutput,
  finishCapturedHookOutput,
  type HookOutputMeasurement,
} from "./hook-output.mjs";
import { stopHookProcessTree } from "./process-tree.mjs";

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
 * Capture a started hook until its first exit, launch error, output flood or deadline.
 * The POSIX child must own a detached process group; false leaves feedback relay to the caller.
 * Resolves launch errors in the result and stops owned processes on forced endings without awaiting close.
 */
export function captureHookProcessUntilDeadline(
  hookProcess: ChildProcess,
  hookEnvironment: NodeJS.ProcessEnv,
  launchTimeout: number,
  hostPlatform: NodeJS.Platform,
  shouldCaptureResult: boolean,
): Promise<CapturedHookProcessResult> {
  return new Promise((resolveHookResult) => {
    let hasDeliveredHookResult = false;
    let hasHookReachedDeadline = false;
    let hasExceededOutputLimit = false;
    const captured = createCapturedHookOutput(
      hookEnvironment.GOAT_FLOW_HOOK_PROVIDER_MODE === "managed",
    );

    /** Release owned pipes so surviving descendants cannot keep the launcher open. */
    function releaseHookOutputStreams(): void {
      for (const outputStream of [hookProcess.stdout, hookProcess.stderr]) {
        if (outputStream === null) continue;
        outputStream.removeAllListeners("data");
        outputStream.destroy();
      }
    }

    // Deliver independently of close: a descendant may still hold the hook's pipes open.
    const launchDeadlineTimer = setTimeout(() => {
      hasHookReachedDeadline = true;
      stopHookProcessTree(hookProcess, hostPlatform, hookEnvironment);
      hookProcess.unref();
      releaseHookOutputStreams();
      deliverHookResult(null, null);
    }, launchTimeout);

    /** Resolve once; forced endings retain lower-bound byte totals and no trusted exit status. */
    function deliverHookResult(
      status: number | null,
      launchError: Error | null,
    ): void {
      if (hasDeliveredHookResult) return;
      hasDeliveredHookResult = true;
      clearTimeout(launchDeadlineTimer);
      const hasInvalidUtf8Output = finishCapturedHookOutput(captured);
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

    /** Retain bounded raw output; a breached budget stops the owned tree and resolves immediately. */
    function captureHookOutputChunk(
      stream: "stdout" | "stderr",
      chunk: Buffer | string,
    ): void {
      if (hasExceededOutputLimit) return;
      if (appendBoundedHookOutput(captured, stream, chunk)) return;
      hasExceededOutputLimit = true;
      stopHookProcessTree(hookProcess, hostPlatform, hookEnvironment);
      hookProcess.unref();
      releaseHookOutputStreams();
      deliverHookResult(null, null);
    }

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
