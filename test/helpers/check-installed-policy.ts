/**
 * Runs installed policy interfaces without changing the command text being assessed.
 *
 * Use for classifier tests on Windows and POSIX; native argv conversion can otherwise change paths before inspection.
 * Only the hook runs, and the proposed command remains inert data throughout the check.
 */
import { spawnSync } from "node:child_process";
import {
  closeSync,
  mkdtempSync,
  openSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Deliver an inert provider request to an installed hook with a finite stdin stream.
 *
 * @param hookPath - existing hook inside the test's disposable installation
 * @param projectPath - disposable project whose configuration the hook reads
 * @param payload - exact provider JSON bytes, including malformed input under test
 * @param argumentsAfterHook - optional classifier arguments; never executed as shell text
 * @returns unchanged process result; a timeout or null status never counts as an allow decision
 */
export function runHookWithPayload(
  hookPath: string,
  projectPath: string,
  payload: string,
  argumentsAfterHook: string[] = [],
) {
  const inputDirectory = mkdtempSync(join(tmpdir(), "goat-policy-input-"));
  const payloadPath = join(inputDirectory, "payload");
  let descriptor: number | undefined;
  try {
    writeFileSync(payloadPath, payload, { flag: "wx", mode: 0o600 });
    descriptor = openSync(payloadPath, "r");
    // A regular file supplies EOF even when a managed Node pipe leaves Bash cat waiting.
    return spawnSync("bash", [hookPath, ...argumentsAfterHook], {
      cwd: projectPath,
      encoding: "utf8",
      stdio: [descriptor, "pipe", "pipe"],
      timeout: 10000,
    });
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(inputDirectory, { recursive: true, force: true });
  }
}

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
