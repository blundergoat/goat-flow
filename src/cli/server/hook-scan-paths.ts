/** Physical path and Git-root checks for post-turn scan registration. */
import { spawnSync } from "node:child_process";
import {
  closeSync,
  fstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";

/**
 * Resolve a project or scan folder to its physical path before checking coverage.
 * Missing folders, non-directories and filesystem failures return null so callers can show an invalid-root state.
 *
 * @param directoryPath - candidate directory; missing or unreadable paths are invalid facts
 *
 * @returns physical directory path, or `null` after any filesystem lookup failure
 * @throws Never; filesystem lookup errors are converted to `null`
 */
export function physicalDirectory(directoryPath: string): string | null {
  try {
    // A selected file cannot serve as a project or post-turn scan folder.
    if (!statSync(directoryPath).isDirectory()) return null;
    return realpathSync(directoryPath);
  } catch {
    // A folder may be moved or become unreadable after selection; report no usable physical root.
    return null;
  }
}

/**
 * Return the physical Git top-level for one directory.
 * Spawns one read-only Git process with a five-second deadline; private output files stay outside the selected project.
 * Uses bounded pipes when the temporary directory is inside the project. Capture, startup, timeout and non-work-tree failures return `null`.
 *
 * @param directoryPath - existing directory Git should classify without modifying it
 * @returns physical work-tree root, or `null` when the bounded child process cannot prove one
 */
export function gitTopLevel(directoryPath: string): string | null {
  try {
    // Capture outside the selected project so a read-only lookup never adds project files.
    const temporaryRoot = physicalDirectory(tmpdir());
    if (temporaryRoot === null) return null;
    if (
      !relativePathEscapesRoot(
        relative(realpathSync(directoryPath), temporaryRoot),
      )
    ) {
      return pipeGitTopLevel(directoryPath);
    }
    const directory = mkdtempSync(
      join(temporaryRoot, "goat-hook-root-output-"),
    );
    try {
      const outputPath = join(directory, "stdout");
      const descriptor = openSync(outputPath, "wx", 0o600);
      try {
        const result = spawnSync(
          "git",
          ["-C", directoryPath, "rev-parse", "--show-toplevel"],
          {
            encoding: "utf-8",
            shell: false,
            timeout: 5_000,
            stdio: ["ignore", descriptor, "ignore"],
          },
        );
        const error: NodeJS.ErrnoException | undefined = result.error;
        // A completed EPERM result still needs successful status, bounded output and a real physical root.
        if (
          result.status !== 0 ||
          result.signal !== null ||
          (error && error.code !== "EPERM") ||
          fstatSync(descriptor).size > 16_384
        )
          return null;
        const output = readFileSync(outputPath, "utf-8").trim();
        return output.length === 0 ? null : physicalDirectory(output);
      } finally {
        closeSync(descriptor);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  } catch {
    // Failed capture, cleanup or physical-path validation cannot establish a scan root.
    return null;
  }
}

/**
 * Detect a scan path outside its selected root before post-turn registration can include another project.
 * @param relativePath - candidate path relative to the selected root
 * @returns whether the path escapes that root
 */
export function relativePathEscapesRoot(relativePath: string): boolean {
  return (
    relativePath === ".." ||
    relativePath.startsWith(`..${String.fromCharCode(47)}`) ||
    relativePath.startsWith(`..${String.fromCharCode(92)}`) ||
    isAbsolute(relativePath)
  );
}

/** Use bounded in-memory output when no capture file can stay outside the project. */
function pipeGitTopLevel(directoryPath: string): string | null {
  const result = spawnSync(
    "git",
    ["-C", directoryPath, "rev-parse", "--show-toplevel"],
    {
      encoding: "utf8",
      shell: false,
      timeout: 5_000,
      maxBuffer: 16_384,
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
  const error: NodeJS.ErrnoException | undefined = result.error;
  if (
    result.status !== 0 ||
    result.signal !== null ||
    (error && error.code !== "EPERM")
  )
    return null;
  const output = result.stdout.trim();
  return output.length === 0 ? null : physicalDirectory(output);
}
