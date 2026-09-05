// goat-flow-hook-version: 1.17.0
/**
 * Owns the bounded lifecycle result for an already-started managed hook.
 *
 * The launcher captures output, enforces deadlines, and renders one provider-visible result when a hook stalls, floods output, or exits unexpectedly.
 * Use this module when the coding agent must receive a bounded outcome instead of waiting on child processes.
 */

/**
 * Bounded state returned after a managed hook reaches its first terminal event.
 *
 * @typedef {object} CapturedHookProcessResult
 * @property {number | null} status - child exit code; null means no trustworthy status arrived
 * @property {boolean} timedOut - true when the user's configured deadline ended the hook
 * @property {Error | null} launchError - startup failure; null means the child started or no startup error was reported
 * @property {string} stdout - bounded captured output; empty means legacy relay or no child output
 * @property {string} stderr - bounded captured diagnostic; empty means the child reported no error text
 * @property {boolean} hasExceededOutputLimit - true when feedback was stopped before it could flood the coding agent
 */

/**
 * Provider-facing result prepared after launcher-owned validation or delivery work.
 *
 * @typedef {object} ProviderLauncherDelivery
 * @property {"delivered" | "unavailable"} state - whether the coding agent received a valid provider response
 * @property {number} [exitCode] - provider status; absent when adaptation could not produce a response
 * @property {string} [reason] - practical failure reason; absent after successful delivery
 * @property {string} stdout - bounded provider output; empty when delivery is unavailable or intentionally silent
 * @property {string} stderr - bounded diagnostic; empty when no human-only detail exists
 */

const MANAGED_HOOK_IDENTIFIERS_BY_RESPONSE_KIND = new Map([
  ["policy", "deny-dangerous"],
  ["gruff", "gruff-code-quality"],
  ["post-turn", "post-turn-safety"],
]);

/**
 * Select a safe user wait below the registered host deadline.
 * Use before launch so invalid overrides cannot leave the coding agent waiting indefinitely.
 * Rejection is a session-wide outage for a policy hook, so only a value that cannot bound
 * the wait at all is rejected; an empty or oversized override still yields a usable wait.
 *
 * @param {number} timeoutCeiling - validated host deadline; zero or missing values are rejected earlier
 * @param {NodeJS.ProcessEnv} hookEnvironment - hook settings; missing or empty uses the ceiling, while a larger override is clamped
 * @returns {number | null} timeout in milliseconds, or null when the user override is not a whole number of milliseconds of at least 1
 */
export function resolveHookLaunchTimeoutMs(timeoutCeiling, hookEnvironment) {
  const configuredUserTimeout =
    hookEnvironment.GOAT_FLOW_HOOK_LAUNCH_TIMEOUT_MS;
  // `export VAR=` arrives as "" rather than undefined; both mean "use the mode ceiling", which stays below host limits.
  if (configuredUserTimeout === undefined || configuredUserTimeout === "") {
    return timeoutCeiling;
  }
  // Only a plain decimal is a wait; signs, spaces, and fractions are ambiguous.
  if (!/^[0-9]+$/u.test(configuredUserTimeout)) return null;
  const configuredTimeoutMilliseconds = Number(configuredUserTimeout);
  // Zero would time out before the hook starts, so it cannot bound the user's wait.
  if (configuredTimeoutMilliseconds < 1) return null;
  // A larger override cannot exceed the bounded host contract; the ceiling is the closest safe wait.
  return Math.min(configuredTimeoutMilliseconds, timeoutCeiling);
}

/**
 * Explain a rejected timeout override so the user can repair one setting instead of reading launcher source.
 * Use only after resolveHookLaunchTimeoutMs returned null for the same ceiling and environment.
 *
 * @param {number} timeoutCeiling - validated host deadline named as the accepted maximum
 * @param {NodeJS.ProcessEnv} hookEnvironment - hook settings whose override was rejected; a missing value is reported as ""
 * @returns {string} failure reason naming the variable, the supplied value, and the accepted range
 */
export function describeInvalidHookLaunchTimeout(
  timeoutCeiling,
  hookEnvironment,
) {
  const configuredUserTimeout =
    hookEnvironment.GOAT_FLOW_HOOK_LAUNCH_TIMEOUT_MS ?? "";
  return `hook timeout configuration is invalid: GOAT_FLOW_HOOK_LAUNCH_TIMEOUT_MS=${JSON.stringify(configuredUserTimeout)} must be a whole number of milliseconds from 1 to ${timeoutCeiling}`;
}

/**
 * Build one bounded internal failure while retaining available child diagnostics.
 * Use when validation or provider adaptation cannot produce a host response.
 *
 * @param {string} userFacingReason - practical failure reason; empty text would hide the cause
 * @param {string} childStandardError - bounded child detail; empty means no diagnostic arrived
 * @returns {{state: "unavailable", reason: string, stdout: "", stderr: string}} unavailable response; reason is never empty
 */
function unavailableLauncherDelivery(userFacingReason, childStandardError) {
  return {
    state: "unavailable",
    reason: userFacingReason,
    stdout: "",
    stderr: childStandardError,
  };
}

/**
 * Capture one started hook until it exits, fails, floods output, or reaches its deadline.
 * Keep first-result ownership here because deadline, error, close, and output events can race.
 *
 * @param {import("node:child_process").ChildProcess} hookProcess - started Bash child; missing streams mean startup failed before output pipes opened
 * @param {NodeJS.ProcessEnv} hookEnvironment - hook environment; missing Windows roots allow direct-process cleanup only
 * @param {number} launchTimeout - positive deadline in milliseconds; zero would time out immediately
 * @param {NodeJS.Platform} hostPlatform - active host; empty text cannot select safe tree cleanup
 * @param {Function | null} appendCapturedHookOutput - bounded adapter writer; null preserves relayed legacy streams
 * @param {Function} stopHookProcessTree - required cleanup callback; missing behavior could strand timed-out user work
 * @returns {Promise<CapturedHookProcessResult>} first terminal result; empty captured streams mean legacy relay or no child output
 */
export function captureHookProcessUntilDeadline(
  hookProcess,
  hookEnvironment,
  launchTimeout,
  hostPlatform,
  appendCapturedHookOutput,
  stopHookProcessTree,
) {
  return new Promise((resolveHookResult) => {
    // A null adapter keeps the user's legacy hook output attached directly to the host.
    const shouldCaptureResult = appendCapturedHookOutput !== null;
    let hasDeliveredHookResult = false;
    let hasHookReachedDeadline = false;
    let hasExceededOutputLimit = false;
    const capturedHookOutput = { stdout: "", stderr: "" };

    /**
     * Release launcher-owned pipe handles after a forced terminal result.
     * Use so a descendant that outlives Bash cannot keep the provider-facing Node process open.
     *
     * @returns {void} no value; captured text remains in memory for the provider adapter.
     */
    function releaseHookOutputStreams() {
      for (const outputStream of [hookProcess.stdout, hookProcess.stderr]) {
        if (!outputStream) continue;
        outputStream.removeAllListeners("data");
        outputStream.destroy();
      }
    }

    const launchDeadlineTimer = setTimeout(() => {
      hasHookReachedDeadline = true;
      stopHookProcessTree(hookProcess, hostPlatform, hookEnvironment);
      hookProcess.unref();
      releaseHookOutputStreams();
      // A deadline has no trustworthy exit code or startup error, so the agent gets timeout context.
      deliverHookResult(null, null);
    }, launchTimeout);

    /**
     * Deliver the first terminal result and discard later close or error events.
     * Use when Bash exits or fails so the coding agent receives one response.
     *
     * @param {number | null} hookStatus - hook exit code; null means no user-visible status arrived
     * @param {Error | null} launchError - startup error; null means Bash started successfully
     * @returns {void} no value; resolving the promise resumes the user's agent
     */
    function deliverHookResult(hookStatus, launchError) {
      // A launch error can be followed by close, but the user must receive only the first result.
      if (hasDeliveredHookResult) {
        return;
      }
      hasDeliveredHookResult = true;
      clearTimeout(launchDeadlineTimer);
      resolveHookResult({
        status: hookStatus,
        timedOut: hasHookReachedDeadline,
        launchError,
        stdout: capturedHookOutput.stdout,
        stderr: capturedHookOutput.stderr,
        hasExceededOutputLimit,
      });
    }

    /**
     * Retain one stream chunk or stop the hook before it floods user feedback.
     * Use for stdout and stderr because either channel shares the host response limit.
     *
     * @param {"stdout" | "stderr"} outputStreamName - child channel; empty text cannot select storage
     * @param {Buffer | string} outputChunk - emitted bytes; empty content leaves the result unchanged
     * @returns {void} no value; exceeding the limit resolves the launch as unavailable
     */
    function captureHookOutputChunk(outputStreamName, outputChunk) {
      // A second stream event after shutdown cannot add a new user-visible result.
      if (hasExceededOutputLimit) return;
      // A retained chunk keeps the hook running toward its normal result.
      if (
        appendCapturedHookOutput(
          capturedHookOutput,
          outputStreamName,
          outputChunk,
        )
      ) {
        return;
      }
      hasExceededOutputLimit = true;
      stopHookProcessTree(hookProcess, hostPlatform, hookEnvironment);
      hookProcess.unref();
      releaseHookOutputStreams();
      deliverHookResult(null, null);
    }

    // Envelope mode captures both child streams; legacy relay listeners are attached by the launcher.
    if (shouldCaptureResult && hookProcess.stdout && hookProcess.stderr) {
      hookProcess.stdout.on("data", (outputChunk) => {
        captureHookOutputChunk("stdout", outputChunk);
      });
      hookProcess.stderr.on("data", (outputChunk) => {
        captureHookOutputChunk("stderr", outputChunk);
      });
    }
    hookProcess.once("error", (launchError) => {
      // A launch failure has no hook exit status for the user.
      deliverHookResult(null, launchError);
    });
    hookProcess.once("close", (hookStatus) => {
      // A normal close has no launch error to show the user.
      deliverHookResult(hookStatus, null);
    });
  });
}

/**
 * Adapt a launcher-owned failure into the same bounded response as hook-owned unavailable work.
 * Use when startup, validation, or a deadline fails before a child envelope can arrive.
 *
 * @param {object} providerAdapterRuntime - loaded adapter API; null or empty cannot validate a response
 * @param {object} launchContract - decoded host contract; null or empty fields cannot select a response
 * @param {string} unavailableReasonCode - stable failure code; empty text would hide the user outcome
 * @param {string} userFacingReason - practical explanation; empty text would leave feedback unactionable
 * @param {string} childStandardError - bounded child detail; empty means no diagnostic arrived
 * @param {number} launcherDurationMs - measured wait; zero means startup failed before useful work
 * @returns {ProviderLauncherDelivery} provider response or explicit adaptation failure
 */
export function prepareProviderLauncherUnavailableDelivery(
  providerAdapterRuntime,
  launchContract,
  unavailableReasonCode,
  userFacingReason,
  childStandardError = "",
  launcherDurationMs = 0,
) {
  const managedHookIdentifier =
    MANAGED_HOOK_IDENTIFIERS_BY_RESPONSE_KIND.get(
      launchContract.responseKind,
    ) ?? "managed-hook";
  const launcherUnavailableResult = {
    schema: providerAdapterRuntime.HOOK_RESULT_SCHEMA,
    hookId: managedHookIdentifier,
    event: launchContract.hookEvent,
    outcome: "unavailable",
    coverage: {
      status: "none",
      attemptedUnits: 1,
      completedUnits: 0,
      skippedUnits: 1,
    },
    reasonCode: unavailableReasonCode,
    findings: [
      {
        code: unavailableReasonCode,
        message: userFacingReason,
      },
    ],
    execution: {
      hookVersion: "managed-launcher",
      provider: launchContract.providerIdentifier,
      providerMode: "managed",
      adapterName: `${launchContract.providerIdentifier}-${launchContract.hookEvent}-launcher`,
      adapterVersion: launchContract.adapterVersion,
      durationMs: launcherDurationMs,
    },
  };
  const decodedLauncherResult = providerAdapterRuntime.decodeHookResultOutput(
    JSON.stringify(launcherUnavailableResult),
  );
  // An invalid internal result must stay unavailable instead of reaching the user's host.
  if (decodedLauncherResult.state !== "valid") {
    return unavailableLauncherDelivery(
      decodedLauncherResult.reason,
      childStandardError,
    );
  }
  const providerHookOutput = providerAdapterRuntime.adaptHookResultForProvider(
    decodedLauncherResult.result,
    launchContract.providerIdentifier,
    launchContract.hookEvent,
  );
  // An unsupported host response remains explicit and cannot become silent success.
  if (providerHookOutput.state !== "adapted") {
    return unavailableLauncherDelivery(
      providerHookOutput.reason,
      childStandardError,
    );
  }
  return {
    state: "delivered",
    exitCode: providerHookOutput.exitCode,
    stdout: providerHookOutput.stdout,
    stderr: childStandardError + providerHookOutput.stderr,
  };
}
