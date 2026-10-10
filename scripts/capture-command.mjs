/** Capture tool output in memory with a live per-stream limit and a deadline. */
import { spawn } from "node:child_process";

/**
 * Spawn literal tool arguments and return bounded raw streams and completion metadata.
 * @param argv - executable and arguments supplied by the owning check, without shell evaluation
 * @param options - working directory, byte limit per stream, and optional deadline
 * @returns process metadata and the captured bytes; limit and timeout errors prevent a passing verdict
 */
export function captureCommand(argv, { cwd, maxBuffer, timeout = 300_000 }) {
  return new Promise((resolve) => {
    const output = { stdout: [], stderr: [] };
    const sizes = { stdout: 0, stderr: 0 };
    let error;
    const child = spawn(argv[0], argv.slice(1), {
      cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    // Terminate a noisy or stalled child and close streams even if a descendant inherited them.
    const stop = (code, message) => {
      if (error) return;
      error = Object.assign(new Error(message), { code });
      child.kill("SIGKILL");
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
