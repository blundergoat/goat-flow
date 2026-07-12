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
 * Parse the internal runner contract used by preflight and its focused tests.
 * Use only behind preflight; empty options or command input produce a clear usage error.
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

  let timeoutSeconds = 0;
  let heartbeatSeconds = 10;
  let progressLabel = "Tests";
  let progressFileDescriptor = null;
  let optionIndex = 0;

  // Each internal option has one value, keeping the shell call explicit and testable.
  while (optionIndex < childCommandSeparator) {
    const optionName = commandLineArguments[optionIndex];
    const optionValue = commandLineArguments[optionIndex + 1];

    // A missing value cannot be rendered safely, so fail before starting user-visible work.
    if (optionValue === undefined || optionIndex + 1 >= childCommandSeparator) {
      throw new Error(`missing value for ${optionName}`);
    }

    // Each supported option controls one operator-visible part of the Tests phase.
    switch (optionName) {
      // The timeout bounds how long the developer waits before cleanup begins.
      case "--timeout-seconds":
        timeoutSeconds = Number(optionValue);
        break;
      // The heartbeat interval controls liveness frequency without changing verification work.
      case "--heartbeat-seconds":
        heartbeatSeconds = Number(optionValue);
        break;
      // The label tells the developer whether the first run or retry is active.
      case "--label":
        progressLabel = optionValue;
        break;
      // The descriptor keeps progress separate from child output used by the final report.
      case "--progress-fd":
        progressFileDescriptor = Number(optionValue);
        break;
      // Unknown options fail before a child starts, so the operator never waits on the wrong contract.
      default:
        throw new Error(`unknown runner option: ${optionName}`);
    }
    optionIndex += 2;
  }

  // Missing command input becomes the explicit empty state rejected below, never an accidental Node launch.
  const childCommand = commandLineArguments[childCommandSeparator + 1] ?? "";
  const childArguments = commandLineArguments.slice(childCommandSeparator + 2);

  // An empty command would leave the Tests phase waiting without doing useful verification.
  if (childCommand.length === 0) {
    throw new Error("child command must not be empty");
  }

  // Invalid timeout input must fail before users mistake an unbounded run for a protected one.
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 0) {
    throw new Error("timeout seconds must be a finite non-negative number");
  }

  // Invalid heartbeat input would make progress noisy or silently absent, so reject it explicitly.
  if (!Number.isFinite(heartbeatSeconds) || heartbeatSeconds < 0) {
    throw new Error("heartbeat seconds must be a finite non-negative number");
  }

  // An empty label would show meaningless liveness copy while the developer waits.
  if (progressLabel.trim().length === 0) {
    throw new Error("progress label must not be empty");
  }

  // No descriptor is the normal CI path; a supplied descriptor must be a real inherited file handle.
  if (
    progressFileDescriptor !== null &&
    (!Number.isInteger(progressFileDescriptor) || progressFileDescriptor < 0)
  ) {
    throw new Error("progress file descriptor must be a non-negative integer");
  }

  return {
    timeoutSeconds,
    heartbeatSeconds,
    progressLabel,
    progressFileDescriptor,
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

/**
 * Run one captured verification command with bounded progress and process-group cleanup.
 * Use for first-run and retry Tests paths so users receive one consistent result contract.
 *
 * @param {ReturnType<typeof parseRunnerOptions>} runnerOptions - validated command, timing, and progress contract
 * @returns {Promise<{
 *   status: number,
 *   capturedOutput: Buffer
 * }>} exact exit status and merged child output; empty output means the child was silent
 */
function runCapturedCommand(runnerOptions) {
  return new Promise((resolveCommand) => {
    const commandStartedAt = Date.now();
    const capturedOutputChunks = [];
    let commandTimedOut = false;
    let commandStartupFailed = false;

    // Null timers and child results mean that no matching operator event has happened yet.
    let parentStopSignal = null;
    let timeoutTimer = null;
    let forceKillTimer = null;
    let forcedResultTimer = null;
    let heartbeatTimer = null;
    let commandResultDelivered = false;
    let observedChildExitCode = null;
    let observedChildExitSignal = null;
    const childProcess = spawn(
      runnerOptions.childCommand,
      runnerOptions.childArguments,
      {
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    /**
     * Return one final status and captured output to the developer waiting on preflight.
     * Use for normal close or the cleanup deadline; late child events cannot duplicate the result.
     *
     * @param {number | null} childExitCode - direct child status; null means signal exit or no close yet
     * @param {NodeJS.Signals | null} childExitSignal - direct child signal; null means normal or pending exit
     * @param {boolean} cleanupDeadlineReached - true when escaped output handles outlive escalation
     * @returns {void} resolves the surrounding runner promise exactly once
     */
    function deliverCommandResult(
      childExitCode,
      childExitSignal,
      cleanupDeadlineReached = false,
    ) {
      // A prior close or deadline already gave the developer a result, so late events are ignored.
      if (commandResultDelivered) {
        return;
      }
      commandResultDelivered = true;

      // Completed work no longer needs the original timeout.
      if (timeoutTimer !== null) {
        clearTimeout(timeoutTimer);
      }
      // A normal close before escalation cancels the pending force kill.
      if (forceKillTimer !== null) {
        clearTimeout(forceKillTimer);
      }
      // A normal close after SIGKILL cancels the fallback result deadline.
      if (forcedResultTimer !== null) {
        clearTimeout(forcedResultTimer);
      }
      // Once a result is ready, the user no longer needs liveness heartbeats.
      if (heartbeatTimer !== null) {
        clearInterval(heartbeatTimer);
      }
      process.off("SIGINT", handleParentInterrupt);
      process.off("SIGTERM", handleParentTermination);

      const renderedCommand = displayCommand(
        runnerOptions.childCommand,
        runnerOptions.childArguments,
      );

      // An escaped process may retain output handles, so release local pipes and return the known result.
      if (cleanupDeadlineReached) {
        capturedOutputChunks.push(
          Buffer.from(
            `\n[preflight] cleanup deadline reached after process-group escalation; returning without waiting for inherited output handles: ${renderedCommand}\n`,
          ),
        );
        childProcess.stdout?.destroy();
        childProcess.stderr?.destroy();
        childProcess.unref();
      }

      // A null exit code means signal termination, which is a failed verification until classified below.
      let finalStatus = childExitCode ?? 1;

      // Timeout is a stable preflight contract, including its status and one precise explanation.
      if (commandTimedOut) {
        finalStatus = 124;
        capturedOutputChunks.push(
          Buffer.from(
            `\n[preflight] command timed out after ${runnerOptions.timeoutSeconds}s: ${renderedCommand}\n`,
          ),
        );
        // Parent termination is preserved after cleanup so callers still receive the conventional status.
      } else if (parentStopSignal !== null) {
        // An unknown parent signal still returns failure rather than presenting a successful preflight.
        finalStatus = PARENT_SIGNAL_EXIT_CODES.get(parentStopSignal) ?? 1;
        capturedOutputChunks.push(
          Buffer.from(
            `\n[preflight] command stopped after parent ${parentStopSignal}: ${renderedCommand}\n`,
          ),
        );
        // A startup failure has no useful child code, so the user receives one explicit status 1 result.
      } else if (commandStartupFailed) {
        finalStatus = 1;
        // A signal-only close is otherwise a failed verification with the signal named for the user.
      } else if (childExitCode === null) {
        finalStatus = 1;
        // No signal name is rare, but the user still receives a concrete abnormal-exit explanation.
        const displayedSignal = childExitSignal ?? "unknown signal";
        capturedOutputChunks.push(
          Buffer.from(
            `\n[preflight] command terminated by ${displayedSignal}: ${renderedCommand}\n`,
          ),
        );
      }

      resolveCommand({
        status: finalStatus,
        capturedOutput: Buffer.concat(capturedOutputChunks),
      });
    }

    /** Request graceful cleanup, then force the group and return even if an escaped pipe stays open. */
    function stopRunningCommand() {
      stopChildProcessGroup(childProcess, "SIGTERM");
      forceKillTimer = setTimeout(() => {
        stopChildProcessGroup(childProcess, "SIGKILL");

        // A normal close during SIGKILL already delivered the result, so no fallback timer is needed.
        if (commandResultDelivered) {
          return;
        }
        forcedResultTimer = setTimeout(() => {
          deliverCommandResult(
            observedChildExitCode,
            observedChildExitSignal,
            true,
          );
        }, FORCED_RESULT_DELAY_MS);
        forcedResultTimer.unref();
      }, FORCE_KILL_DELAY_MS);
      forceKillTimer.unref();
    }

    /** Preserve parent termination intent while still cleaning up the child process group first. */
    function handleParentStopSignal(stopSignal) {
      // The first parent signal owns cleanup; repeated signals must not create duplicate timers.
      if (parentStopSignal !== null || commandTimedOut) {
        return;
      }
      parentStopSignal = stopSignal;
      stopRunningCommand();
    }

    const handleParentInterrupt = () => handleParentStopSignal("SIGINT");
    const handleParentTermination = () => handleParentStopSignal("SIGTERM");
    process.once("SIGINT", handleParentInterrupt);
    process.once("SIGTERM", handleParentTermination);

    // Remember the direct child's status even when an escaped descendant delays the later close event.
    childProcess.once("exit", (childExitCode, childExitSignal) => {
      observedChildExitCode = childExitCode;
      observedChildExitSignal = childExitSignal;
    });

    // Configured pipes retain both child channels; absent streams mean startup failed before output existed.
    childProcess.stdout?.on("data", (chunk) =>
      capturedOutputChunks.push(chunk),
    );
    childProcess.stderr?.on("data", (chunk) =>
      capturedOutputChunks.push(chunk),
    );
    childProcess.once("error", (error) => {
      commandStartupFailed = true;
      capturedOutputChunks.push(
        Buffer.from(
          `\n[preflight] command failed to start: ${String(error.message || error)}\n`,
        ),
      );
    });

    // A positive timeout bounds silence; zero deliberately keeps the documented timeout opt-out.
    if (runnerOptions.timeoutSeconds > 0) {
      timeoutTimer = setTimeout(() => {
        // Parent termination already owns cleanup and must retain its conventional exit status.
        if (parentStopSignal !== null) {
          return;
        }
        commandTimedOut = true;
        stopRunningCommand();
      }, runnerOptions.timeoutSeconds * 1_000);
    }

    // e.g. a developer waiting on release tests gets liveness; CI has no descriptor and stays stable.
    if (
      runnerOptions.progressFileDescriptor !== null &&
      runnerOptions.heartbeatSeconds > 0
    ) {
      heartbeatTimer = setInterval(() => {
        const heartbeatWritten = writeOperatorHeartbeat(
          runnerOptions.progressFileDescriptor,
          runnerOptions.progressLabel,
          Date.now() - commandStartedAt,
          runnerOptions.heartbeatSeconds,
        );

        // A closed terminal needs no more progress attempts, but command capture continues safely.
        if (!heartbeatWritten && heartbeatTimer !== null) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
      }, runnerOptions.heartbeatSeconds * 1_000);
      heartbeatTimer.unref();
    }

    // Normal completion keeps the exact child result and cancels every fallback timer.
    childProcess.once("close", (childExitCode, childExitSignal) => {
      deliverCommandResult(childExitCode, childExitSignal);
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
