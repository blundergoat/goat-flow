#!/usr/bin/env node
/**
 * Runs one preflight command while retaining its output for the final quality report.
 * Use from the Tests phase when a developer needs bounded liveness without raw log streaming.
 * Heartbeats use a separate descriptor, so CI output and pass/fail parsing stay deterministic.
 * Timeout and parent-exit cleanup target the child process group before returning a result.
 * A final deadline prevents an escaped output holder from hiding that result indefinitely.
 */
import { spawn } from "node:child_process";
import { writeSync } from "node:fs";

const FORCE_KILL_DELAY_MS = 1_000;
const FORCED_RESULT_DELAY_MS = 100;
const PARENT_SIGNAL_EXIT_CODES = new Map([
  ["SIGINT", 130],
  ["SIGTERM", 143],
]);

/**
 * Mutates one parsed option field and throws distinct operator guidance for unsupported names.
 *
 * @param {{timeoutSeconds: number, heartbeatSeconds: number, progressLabel: string, progressFileDescriptor: number | null}} options - runner state receiving one parsed value
 * @param {string | undefined} optionName - internal option name; missing names are rejected
 * @param {string} optionValue - required option value; empty strings remain available for validation
 * @returns {void} updates exactly one field
 * @throws {Error} when the internal preflight caller passes an unknown option
 */
function applyRunnerOption(options, optionName, optionValue) {
  switch (optionName) {
    // The timeout bounds how long the developer waits before cleanup begins.
    case "--timeout-seconds":
      options.timeoutSeconds = Number(optionValue);
      return;
    // The heartbeat interval controls liveness frequency without changing verification work.
    case "--heartbeat-seconds":
      options.heartbeatSeconds = Number(optionValue);
      return;
    // The label tells the developer whether the first run or retry is active.
    case "--label":
      options.progressLabel = optionValue;
      return;
    // The descriptor keeps progress separate from child output used by the final report.
    case "--progress-fd":
      options.progressFileDescriptor = Number(optionValue);
      return;
    // Unknown options stop before a child starts, so the operator never waits on the wrong contract.
    default:
      throw new Error(`unknown runner option: ${optionName}`);
  }
}

/**
 * Validate parsed timing and progress options before any verification child starts.
 * Throws one field-specific usage error so the developer can repair the preflight invocation.
 *
 * @param {{timeoutSeconds: number, heartbeatSeconds: number, progressLabel: string, progressFileDescriptor: number | null}} options - parsed runner options; null descriptor disables progress output
 * @returns {void} successful validation leaves the parsed values unchanged
 */
function validateRunnerOptions(options) {
  // Invalid timeout input cannot masquerade as a bounded verification run.
  if (!Number.isFinite(options.timeoutSeconds) || options.timeoutSeconds < 0) {
    throw new Error("timeout seconds must be a finite non-negative number");
  }
  // Invalid heartbeat input would make progress noisy or silently absent.
  if (
    !Number.isFinite(options.heartbeatSeconds) ||
    options.heartbeatSeconds < 0
  ) {
    throw new Error("heartbeat seconds must be a finite non-negative number");
  }
  // An empty label would show meaningless liveness copy while the developer waits.
  if (options.progressLabel.trim().length === 0) {
    throw new Error("progress label must not be empty");
  }
  // No descriptor is the normal CI path; a supplied value must be an inherited file handle.
  if (
    options.progressFileDescriptor !== null &&
    (!Number.isInteger(options.progressFileDescriptor) ||
      options.progressFileDescriptor < 0)
  ) {
    throw new Error("progress file descriptor must be a non-negative integer");
  }
}

/**
 * Parse the internal runner contract used by preflight and its focused tests.
 * Use only behind preflight; it throws a usage error before invalid Tests work begins.
 * Explicit branches preserve distinct timeout, progress, and command guidance for the operator.
 *
 * @param {string[]} commandLineArguments - runner options followed by `--` and a child command; empty is invalid
 * @returns {{
 *   timeoutSeconds: number,
 *   heartbeatSeconds: number,
 *   progressLabel: string,
 *   progressFileDescriptor: number | null,
 *   childCommand: string,
 *   childArguments: string[]
 * }} parsed options; null descriptor means no progress is shown
 */
function parseRunnerOptions(commandLineArguments) {
  const childCommandSeparator = commandLineArguments.indexOf("--");

  // Without the separator, the runner cannot distinguish its options from the developer's command.
  if (childCommandSeparator === -1) {
    throw new Error("expected -- before the child command");
  }

  const options = {
    timeoutSeconds: 0,
    heartbeatSeconds: 10,
    progressLabel: "Tests",
    progressFileDescriptor: null,
  };
  let optionIndex = 0;

  // Each internal option has one value, keeping the shell call explicit and testable.
  while (optionIndex < childCommandSeparator) {
    const optionName = commandLineArguments[optionIndex];
    const optionValue = commandLineArguments[optionIndex + 1];

    // A missing value cannot be rendered safely, so fail before starting user-visible work.
    if (optionValue === undefined || optionIndex + 1 >= childCommandSeparator) {
      throw new Error(`missing value for ${optionName}`);
    }

    applyRunnerOption(options, optionName, optionValue);
    optionIndex += 2;
  }

  // Missing command input becomes the explicit empty state rejected below, never an accidental Node launch.
  const childCommand = commandLineArguments[childCommandSeparator + 1] ?? "";
  const childArguments = commandLineArguments.slice(childCommandSeparator + 2);

  // An empty command would leave the Tests phase waiting without doing useful verification.
  if (childCommand.length === 0) {
    throw new Error("child command must not be empty");
  }

  validateRunnerOptions(options);

  return {
    ...options,
    childCommand,
    childArguments,
  };
}

/**
 * Render a command in timeout and signal diagnostics shown after captured output.
 * Empty arguments show only the executable, which is still enough for the user to retry it.
 *
 * @param {string} childCommand - executable selected by preflight; empty is rejected before this helper
 * @param {string[]} childArguments - child arguments; empty means the command takes no options
 * @returns {string} one plain-English command line for the final failure detail
 */
function displayCommand(childCommand, childArguments) {
  return [childCommand, ...childArguments].join(" ");
}

/**
 * Stop the complete child process group so timed-out verification cannot leak into the next run.
 * Use for timeout and parent termination; a missing PID means startup failed before work began.
 * It swallows an already-finished process error because user-visible cleanup already succeeded.
 *
 * @param {import("node:child_process").ChildProcess} childProcess - spawned verification process
 * @param {NodeJS.Signals} stopSignal - graceful or forced signal chosen by the runner
 * @returns {void} no result; an already-exited child is treated as successfully stopped
 */
function stopChildProcessGroup(childProcess, stopSignal) {
  // A spawn failure has no PID, so there is no user work left to terminate.
  if (!childProcess.pid) {
    return;
  }

  try {
    // Windows has no POSIX process group, so Node terminates the direct child instead.
    if (process.platform === "win32") {
      childProcess.kill(stopSignal);
      // POSIX process groups include descendants, so timeout cleanup removes the full verification tree.
    } else {
      process.kill(-childProcess.pid, stopSignal);
    }
  } catch {
    // The child may finish between the timeout appearing and the operator cleanup signal.
  }
}

/**
 * Write one out-of-band heartbeat for the developer watching an interactive preflight.
 * Use only with an inherited descriptor; null means CI receives no progress noise.
 *
 * @param {number | null} progressFileDescriptor - inherited operator channel; null hides progress
 * @param {string} progressLabel - Tests or Tests retry, matching the work the user is waiting on
 * @param {number} elapsedMilliseconds - measured liveness duration; zero means the command just started
 * @param {number} heartbeatSeconds - production interval; sub-second values are for focused tests
 * @returns {boolean} true when the heartbeat was written; false when the channel is absent or closed
 */
function writeOperatorHeartbeat(
  progressFileDescriptor,
  progressLabel,
  elapsedMilliseconds,
  heartbeatSeconds,
) {
  // Non-interactive runs omit the descriptor, preserving the stable report with no extra lines.
  if (progressFileDescriptor === null) {
    return false;
  }

  let elapsedSeconds = "";

  // Production intervals read as whole seconds; short test intervals remain distinguishable.
  if (heartbeatSeconds >= 1) {
    elapsedSeconds = String(
      Math.max(1, Math.round(elapsedMilliseconds / 1_000)),
    );
    // Sub-second intervals exist only for focused tests, so show enough precision to compare them.
  } else {
    elapsedSeconds = (elapsedMilliseconds / 1_000).toFixed(2);
  }

  try {
    writeSync(
      progressFileDescriptor,
      `[preflight] ${progressLabel} still running (${elapsedSeconds}s elapsed)\n`,
    );
    return true;
  } catch {
    // For example, a user may close the terminal while CI-safe output capture continues.
    return false;
  }
}

/** Clear every timer and parent-signal listener once one command result wins the race. */
function clearCapturedCommandResources(state) {
  // Completed work no longer needs the original timeout.
  if (state.timeoutTimer !== null) clearTimeout(state.timeoutTimer);
  // A normal close before escalation cancels the pending force kill.
  if (state.forceStopTimer !== null) clearTimeout(state.forceStopTimer);
  // A normal close after SIGKILL cancels the fallback result deadline.
  if (state.resultDeadlineTimer !== null) {
    clearTimeout(state.resultDeadlineTimer);
  }
  // Once a result is ready, the user no longer needs liveness heartbeats.
  if (state.heartbeatTimer !== null) clearInterval(state.heartbeatTimer);
  // Signal handlers are installed before child events can deliver a result.
  if (state.handlePreflightInterrupt !== null) {
    process.off("SIGINT", state.handlePreflightInterrupt);
  }
  if (state.handlePreflightTermination !== null) {
    process.off("SIGTERM", state.handlePreflightTermination);
  }
}

/** Release inherited output handles after escalation so an escaped descendant cannot hide the result. */
function releaseEscapedOutputHandles(state, renderedCommand) {
  state.capturedOutputChunks.push(
    Buffer.from(
      "\n[preflight] cleanup deadline reached after process-group escalation; " +
        "returning without waiting for inherited output handles: " +
        renderedCommand +
        "\n",
    ),
  );
  state.childProcess.stdout?.destroy();
  state.childProcess.stderr?.destroy();
  state.childProcess.unref();
}

/** Classify one child close into the exact preflight status and diagnostic contract. */
function capturedCommandFinalStatus(
  state,
  childExitCode,
  childExitSignal,
  renderedCommand,
) {
  let finalStatus = childExitCode ?? 1;

  // Timeout owns status 124 even when later cleanup produces a signal close.
  if (state.hasCommandTimedOut) {
    finalStatus = 124;
    state.capturedOutputChunks.push(
      Buffer.from(
        "\n[preflight] command timed out after " +
          state.runnerOptions.timeoutSeconds +
          "s: " +
          renderedCommand +
          "\n",
      ),
    );
    // Parent termination retains its conventional status after child cleanup.
  } else if (state.preflightStopSignal !== null) {
    finalStatus = PARENT_SIGNAL_EXIT_CODES.get(state.preflightStopSignal) ?? 1;
    state.capturedOutputChunks.push(
      Buffer.from(
        "\n[preflight] command stopped after parent " +
          state.preflightStopSignal +
          ": " +
          renderedCommand +
          "\n",
      ),
    );
    // A startup failure has no useful child code, so preflight returns status 1.
  } else if (state.hasCommandFailedToStart) {
    finalStatus = 1;
    // Signal-only closes are failed verification with the signal named for the user.
  } else if (childExitCode === null) {
    finalStatus = 1;
    const displayedSignal = childExitSignal ?? "unknown signal";
    state.capturedOutputChunks.push(
      Buffer.from(
        "\n[preflight] command terminated by " +
          displayedSignal +
          ": " +
          renderedCommand +
          "\n",
      ),
    );
  }

  return finalStatus;
}

/** Deliver the first final status and captured output; every later close or deadline is ignored. */
function deliverCapturedCommandResult(
  state,
  childExitCode,
  childExitSignal,
  cleanupDeadlineReached = false,
) {
  // A prior close or deadline already gave the developer a result.
  if (state.hasReturnedResultToPreflight) return;
  state.hasReturnedResultToPreflight = true;
  clearCapturedCommandResources(state);

  const renderedCommand = displayCommand(
    state.runnerOptions.childCommand,
    state.runnerOptions.childArguments,
  );
  // Escaped descendants can retain pipes after the child group has been killed.
  if (cleanupDeadlineReached) {
    releaseEscapedOutputHandles(state, renderedCommand);
  }

  const finalStatus = capturedCommandFinalStatus(
    state,
    childExitCode,
    childExitSignal,
    renderedCommand,
  );
  state.resolveCommand({
    status: finalStatus,
    capturedOutput: Buffer.concat(state.capturedOutputChunks),
  });
}

/** Request graceful cleanup, then force the group and return after the bounded output deadline. */
function stopCapturedCommand(state) {
  stopChildProcessGroup(state.childProcess, "SIGTERM");
  state.forceStopTimer = setTimeout(() => {
    stopChildProcessGroup(state.childProcess, "SIGKILL");

    // A normal close during SIGKILL already delivered the result.
    if (state.hasReturnedResultToPreflight) return;
    state.resultDeadlineTimer = setTimeout(() => {
      deliverCapturedCommandResult(
        state,
        state.observedCommandExitCode,
        state.observedCommandExitSignal,
        true,
      );
    }, FORCED_RESULT_DELAY_MS);
    state.resultDeadlineTimer.unref();
  }, FORCE_KILL_DELAY_MS);
  state.forceStopTimer.unref();
}

/** Preserve the first parent stop signal while cleaning the child process group before returning. */
function handleCapturedParentStop(state, stopSignal) {
  // Repeated signals and timeout callbacks cannot create competing cleanup timers.
  if (state.preflightStopSignal !== null || state.hasCommandTimedOut) return;
  state.preflightStopSignal = stopSignal;
  stopCapturedCommand(state);
}

/** Register stable signal-handler identities so result delivery can remove them exactly once. */
function registerCapturedCommandSignals(state) {
  state.handlePreflightInterrupt = () =>
    handleCapturedParentStop(state, "SIGINT");
  state.handlePreflightTermination = () =>
    handleCapturedParentStop(state, "SIGTERM");
  process.once("SIGINT", state.handlePreflightInterrupt);
  process.once("SIGTERM", state.handlePreflightTermination);
}

/** Capture child output, startup failure, and the direct exit status before inherited pipes close. */
function registerCapturedChildEvents(state) {
  state.childProcess.once("exit", (childExitCode, childExitSignal) => {
    state.observedCommandExitCode = childExitCode;
    state.observedCommandExitSignal = childExitSignal;
  });

  // Configured pipes retain both child channels when startup reaches stream creation.
  state.childProcess.stdout?.on("data", (chunk) =>
    state.capturedOutputChunks.push(chunk),
  );
  state.childProcess.stderr?.on("data", (chunk) =>
    state.capturedOutputChunks.push(chunk),
  );
  state.childProcess.once("error", (error) => {
    state.hasCommandFailedToStart = true;
    state.capturedOutputChunks.push(
      Buffer.from(
        "\n[preflight] command failed to start: " +
          String(error.message || error) +
          "\n",
      ),
    );
  });
}

/** Start the optional silence timeout; zero preserves the documented timeout opt-out. */
function startCapturedCommandTimeout(state) {
  // Zero leaves the child unbounded by explicit preflight contract.
  if (state.runnerOptions.timeoutSeconds <= 0) return;
  state.timeoutTimer = setTimeout(() => {
    // Parent termination already owns cleanup and its conventional exit status.
    if (state.preflightStopSignal !== null) return;
    state.hasCommandTimedOut = true;
    stopCapturedCommand(state);
  }, state.runnerOptions.timeoutSeconds * 1_000);
}

/** Start interactive liveness heartbeats while keeping CI and captured child output deterministic. */
function startCapturedCommandHeartbeat(state) {
  const { progressFileDescriptor, heartbeatSeconds, progressLabel } =
    state.runnerOptions;
  // CI has no progress descriptor, while zero explicitly disables heartbeats.
  if (progressFileDescriptor === null || heartbeatSeconds <= 0) return;

  state.heartbeatTimer = setInterval(() => {
    const heartbeatWritten = writeOperatorHeartbeat(
      progressFileDescriptor,
      progressLabel,
      Date.now() - state.commandStartedAt,
      heartbeatSeconds,
    );

    // A closed terminal needs no more progress attempts, but command capture continues.
    if (!heartbeatWritten && state.heartbeatTimer !== null) {
      clearInterval(state.heartbeatTimer);
      state.heartbeatTimer = null;
    }
  }, heartbeatSeconds * 1_000);
  state.heartbeatTimer.unref();
}

/**
 * Spawns one captured verification command with bounded progress and process-group cleanup.
 * Use for first-run and retry Tests paths so every result preserves output, signals, and status.
 *
 * @param {ReturnType<typeof parseRunnerOptions>} runnerOptions - validated command, timing, and progress contract
 * @returns {Promise<{status: number, capturedOutput: Buffer}>} exact status and merged output
 */
function runCapturedCommand(runnerOptions) {
  return new Promise((resolveCommand) => {
    const commandStartedAt = Date.now();
    // Preflight supplies argv without a shell, so user-entered test text cannot become shell syntax.
    const childProcess = spawn(
      runnerOptions.childCommand,
      runnerOptions.childArguments,
      {
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const state = {
      runnerOptions,
      resolveCommand,
      childProcess,
      commandStartedAt,
      capturedOutputChunks: [],
      hasCommandTimedOut: false,
      hasCommandFailedToStart: false,
      preflightStopSignal: null,
      timeoutTimer: null,
      forceStopTimer: null,
      resultDeadlineTimer: null,
      heartbeatTimer: null,
      hasReturnedResultToPreflight: false,
      observedCommandExitCode: null,
      observedCommandExitSignal: null,
      handlePreflightInterrupt: null,
      handlePreflightTermination: null,
    };

    registerCapturedCommandSignals(state);
    registerCapturedChildEvents(state);
    startCapturedCommandTimeout(state);
    startCapturedCommandHeartbeat(state);

    // Normal completion keeps the exact child result and cancels every fallback timer.
    childProcess.once("close", (childExitCode, childExitSignal) => {
      deliverCapturedCommandResult(state, childExitCode, childExitSignal);
    });
  });
}

/**
 * Execute the internal CLI and flush captured output before returning its exact status to preflight.
 * Invalid or empty input exits 2 so users see a runner-contract error, not a test failure.
 *
 * @returns {Promise<void>} resolves after output is written; no output means the child was silent
 */
async function main() {
  try {
    const runnerOptions = parseRunnerOptions(process.argv.slice(2));
    const commandResult = await runCapturedCommand(runnerOptions);
    await new Promise((resolveOutput) => {
      process.stdout.write(commandResult.capturedOutput, resolveOutput);
    });
    process.exitCode = commandResult.status;
  } catch (error) {
    // For example, a malformed internal option should fail before any test child is launched.
    process.stderr.write(
      `[preflight] command runner usage error: ${String(error.message || error)}\n`,
    );
    process.exitCode = 2;
  }
}

await main();
