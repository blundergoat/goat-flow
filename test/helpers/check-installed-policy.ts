/**
 * Runs the direct policy interface without changing the command text being assessed.
 *
 * Use for classifier tests on Windows and POSIX; native argv conversion can otherwise change paths before inspection.
 * Only the hook runs, and the proposed command remains inert data throughout the check.
 */
import { spawnSync } from "node:child_process";

/**
 * Spawns a selected installed hook with exact command bytes, leaving the proposed action unexecuted.
 *
 * @param hookPath - existing hook inside the test's disposable installation
 * @param projectPath - disposable project whose configuration the hook reads
 * @param proposedCommand - literal shell text; empty means no action was submitted
 * @returns hook exit and diagnostics; null status means execution did not complete, never a policy pass
 */
export function checkInstalledPolicy(
  hookPath: string,
  projectPath: string,
  proposedCommand: string,
): ReturnType<typeof spawnSync> {
  return spawnSync(
    "bash",
    [
      "--noprofile",
      "--norc",
      "-c",
      'exec bash "$GOAT_TEST_HOOK" --check "$GOAT_TEST_COMMAND"',
    ],
    {
      cwd: projectPath,
      encoding: "utf8",
      // Environment transport preserves UNC backslashes that Windows argv conversion would consume.
      env: {
        ...process.env,
        GOAT_TEST_HOOK: hookPath,
        GOAT_TEST_COMMAND: proposedCommand,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}
