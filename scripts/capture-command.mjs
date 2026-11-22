/**
 * Capture checker output for changed-file verification and the Gruff warning ratchet.
 *
 * Use when a check needs the exit status and raw output for its report.
 * Each stream has its own byte limit so a noisy tool cannot fill the caller's memory.
 */
import { spawn, spawnSync } from "node:child_process";

/**
 * Starts the checker with literal arguments and captures its output until it exits.
 *
 * Overflow or timeout records an error and attempts to terminate the process tree.
 * Launch errors go in the result. If spawn throws on invalid arguments, the promise rejects.
 *
 * @param argv - executable and arguments supplied by the owning check, without shell evaluation
 * @param options - check directory, byte limit per stream, and timeout in milliseconds. Omit the timeout to use five minutes.
 * @returns bounded raw output, exit status or signal, and any launch or capture error
 */
export function captureCommand(argv, options) {
  const { cwd, maxBuffer, timeout = 300_000 } = options;
  return new Promise((resolve) => {
    const output = { stdout: [], stderr: [] };
    const sizes = { stdout: 0, stderr: 0 };
    let error;
    const child = spawn(argv[0], argv.slice(1), {
      cwd,
      detached: process.platform !== "win32",
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    // Preserve the first error for the check that reports it and close the streams so a descendant cannot keep the check open.
    // On Windows this spawns taskkill to stop the process tree. The fallback kills the child directly.
    const stop = (code, message) => {
      if (error) return;
      error = Object.assign(new Error(message), { code });
      try {
        if (child.pid && process.platform === "win32") {
          const stopped = spawnSync(
            "taskkill.exe",
            ["/PID", String(child.pid), "/T", "/F"],
            { windowsHide: true, stdio: "ignore", timeout: 1000 },
          );
          if (stopped.error || stopped.status !== 0) child.kill("SIGKILL");
        } else if (child.pid) {
          process.kill(-child.pid, "SIGKILL");
        }
      } catch {
        // The process may exit between the capture failure and tree termination.
        child.kill("SIGKILL");
      }
      child.stdout.destroy();
      child.stderr.destroy();
    };
    const deadline = setTimeout(
      () => stop("ETIMEDOUT", "Tool capture timed out"),
      timeout,
    );
    for (const name of ["stdout", "stderr"]) {
      child[name].on("data", (chunk) => {
        if (error) return;
        if (sizes[name] + chunk.length > maxBuffer) {
          stop(
            "ENOBUFS",
            `Tool ${name} exceeded the ${maxBuffer} byte capture limit`,
          );
          return;
        }
        sizes[name] += chunk.length;
        output[name].push(chunk);
      });
    }
    child.on("error", (failure) => {
      error ??= failure;
    });
    child.on("close", (status, signal) => {
      clearTimeout(deadline);
      resolve({
        status,
        signal,
        error,
        stdout: Buffer.concat(output.stdout, sizes.stdout),
        stderr: Buffer.concat(output.stderr, sizes.stderr),
      });
    });
  });
}
