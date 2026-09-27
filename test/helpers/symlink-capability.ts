/**
 * Checks whether this runner can create the links needed to exercise path-safety checks.
 *
 * Use before symlink-dependent tests; Windows permissions can prevent setup before the application runs.
 * Capability skips stay explicit, while unrelated filesystem failures still fail the suite.
 */
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let cachedSkipReason: string | false | undefined;

/**
 * Write and remove temporary links before selecting tests that need symlink privileges.
 *
 * @returns skip=false when links work; otherwise a reason explaining which host capability prevented coverage
 * @throws Unexpected filesystem errors, such as a full temporary drive, rather than hiding them as capability skips.
 */
export function symlinkTestOptions(): { skip: string | false } {
  // Undefined means this runner has not checked yet; reuse a completed probe throughout this test process.
  if (cachedSkipReason !== undefined) return { skip: cachedSkipReason };
  const fixtureRoot = mkdtempSync(join(tmpdir(), "goat-symlink-capability-"));
  try {
    writeFileSync(join(fixtureRoot, "file"), "fixture\n");
    mkdirSync(join(fixtureRoot, "directory"));
    try {
      symlinkSync(
        join(fixtureRoot, "file"),
        join(fixtureRoot, "file-link"),
        "file",
      );
      symlinkSync(
        join(fixtureRoot, "directory"),
        join(fixtureRoot, "directory-link"),
        "dir",
      );
      cachedSkipReason = false;
    } catch (error) {
      // Windows can reject links without Developer Mode; failures preparing ordinary files above must never earn this skip.
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EPERM" && code !== "EACCES" && code !== "ENOSYS")
        throw error;
      cachedSkipReason = `Host cannot create symlink fixtures (${code}); run on a symlink-capable host for this coverage`;
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
  return { skip: cachedSkipReason };
}
