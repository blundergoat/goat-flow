/**
 * CLI adapter for pre-write durable artifact redaction.
 *
 * Users pipe a draft through `goat-flow redact` before saving session, review, quality, security, or export text.
 * The scrubber runs in memory; file output is project-local, private, and create-only.
 */
import {
  closeSync,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import type { Stats } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { CLIError } from "./cli-error.js";
import type { ParsedCLI } from "./cli-types.js";
import { writeOutput } from "./cli-output.js";
import { scrubDurableText } from "./evidence/redaction.js";

/** One checked parent directory plus its project-relative diagnostic label. */
interface RedactDirectoryComponent {
  path: string;
  display: string;
}

/**
 * Normalize one trailing input newline because both output adapters add it back.
 * Empty input becomes one output newline, representing an empty durable note.
 *
 * @param inputText - raw stdin text; empty input means the user supplied no note body
 * @returns scrubbed output without one trailing newline, ready for either output adapter
 */
function renderRedactedDurableText(inputText: string): string {
  return scrubDurableText(inputText).replace(/\r?\n$/u, "");
}

/**
 * Resolve the selected project before any output directory or file is created.
 * Error behavior: throws CLIError when the path is missing, unreadable, or not a directory.
 */
function resolveRedactProjectRoot(projectPath: string): string {
  try {
    if (!statSync(projectPath).isDirectory()) throw new Error();
    return realpathSync(projectPath);
  } catch {
    throw new CLIError(
      "redact: selected project must be an existing directory.",
      2,
    );
  }
}

/**
 * Bind the caller's lexical output path to the real selected project root.
 * Error behavior: throws CLIError when the destination is not a child of the selected project.
 */
function resolveRedactOutputPath(
  projectPath: string,
  projectRoot: string,
  outputPath: string,
): { outputPath: string; relativeOutputPath: string } {
  const selectedPath = resolve(projectPath);
  const selectedOutputPath = resolve(outputPath);
  const relativeOutputPath = relative(selectedPath, selectedOutputPath);
  if (
    relativeOutputPath.length === 0 ||
    relativeOutputPath === ".." ||
    relativeOutputPath.startsWith(`..${sep}`) ||
    isAbsolute(relativeOutputPath)
  ) {
    throw new CLIError(
      "redact: --output must stay inside the selected project.",
      2,
    );
  }
  return {
    outputPath: join(projectRoot, relativeOutputPath),
    relativeOutputPath,
  };
}

/** List the directory chain that must remain real while owning one project-local redacted file. */
function redactDirectoryComponents(
  projectRoot: string,
  relativeOutputPath: string,
): RedactDirectoryComponent[] {
  const components: RedactDirectoryComponent[] = [
    { path: projectRoot, display: "." },
  ];
  const relativeParent = dirname(relativeOutputPath);
  if (relativeParent === ".") return components;

  let cursor = projectRoot;
  const displaySegments: string[] = [];
  for (const segment of relativeParent.split(sep)) {
    cursor = join(cursor, segment);
    displaySegments.push(segment);
    components.push({
      path: cursor,
      display: displaySegments.join("/"),
    });
  }
  return components;
}

/**
 * Read one output-directory component without accepting symlinks or files.
 * A missing component returns null; another metadata failure throws CLIError.
 */
function redactDirectoryStats(
  component: RedactDirectoryComponent,
): Stats | null {
  try {
    return lstatSync(component.path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new CLIError(
      `redact: cannot inspect output directory ${component.display}.`,
      2,
    );
  }
}

/**
 * Require every output parent to remain a real project-local directory.
 * Error behavior: throws CLIError when a component is missing, redirected, or not a directory.
 */
function assertRedactDirectories(
  components: readonly RedactDirectoryComponent[],
): void {
  for (const component of components) {
    const stats = redactDirectoryStats(component);
    if (stats?.isDirectory() === true && !stats.isSymbolicLink()) continue;
    throw new CLIError(
      `redact: output parent ${component.display} must be a real project-local directory.`,
      2,
    );
  }
}

/**
 * Create absent parents one component at a time, rejecting every redirected collision.
 *
 * Side effects: writes only missing filesystem directories in the selected project.
 * Error behavior: unsafe or failed creation throws CLIError.
 */
function ensureRedactDirectories(
  components: readonly RedactDirectoryComponent[],
): void {
  for (const component of components) {
    const initialStats = redactDirectoryStats(component);
    if (initialStats !== null) {
      if (initialStats.isDirectory() && !initialStats.isSymbolicLink())
        continue;
      throw new CLIError(
        `redact: output parent ${component.display} must be a real project-local directory.`,
        2,
      );
    }
    try {
      mkdirSync(component.path, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw new CLIError(
          `redact: could not create output directory ${component.display}.`,
          2,
        );
      }
    }
    const createdStats = redactDirectoryStats(component);
    if (
      createdStats?.isDirectory() === true &&
      !createdStats.isSymbolicLink()
    ) {
      continue;
    }
    throw new CLIError(
      `redact: output parent ${component.display} must be a real project-local directory.`,
      2,
    );
  }
  assertRedactDirectories(components);
}

/** Match one open descriptor to its expected single-link pathname and byte count. */
function isExpectedRedactAllocation(
  descriptorStats: Stats,
  pathStats: Stats,
  expectedSize: number,
): boolean {
  return (
    descriptorStats.isFile() &&
    pathStats.isFile() &&
    descriptorStats.nlink === 1 &&
    pathStats.nlink === 1 &&
    descriptorStats.dev === pathStats.dev &&
    descriptorStats.ino === pathStats.ino &&
    descriptorStats.size === expectedSize &&
    pathStats.size === expectedSize
  );
}

/**
 * Recheck ancestry and descriptor identity before accepting sensitive bytes.
 * Error behavior: throws CLIError when the directory chain or allocation identity changed.
 */
function assertRedactAllocation(
  components: readonly RedactDirectoryComponent[],
  outputPath: string,
  descriptor: number,
  expectedSize: number,
): void {
  assertRedactDirectories(components);
  try {
    if (
      !isExpectedRedactAllocation(
        fstatSync(descriptor),
        lstatSync(outputPath),
        expectedSize,
      )
    ) {
      throw new Error("output allocation changed");
    }
  } catch (error) {
    if (error instanceof CLIError) throw error;
    throw new CLIError(
      "redact: output allocation changed before persistence completed.",
      2,
    );
  }
}

/** Compare two snapshots before removing a rejected create-only allocation. */
function redactSnapshotsMatch(left: Stats, right: Stats): boolean {
  return (
    left.isFile() &&
    right.isFile() &&
    left.nlink === 1 &&
    right.nlink === 1 &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.ctimeMs === right.ctimeMs &&
    left.size === right.size
  );
}

/** Preserve native cleanup errors while making non-Error throws safe to propagate. */
function normalizeRedactCleanupError(error: unknown): Error {
  return error instanceof Error
    ? error
    : new Error("redact cleanup failed with a non-Error value");
}

/**
 * Run one cleanup operation even when an earlier operation already failed.
 * Error behavior: swallows cleanup failures into the first returned Error value.
 */
function attemptRedactCleanupStep(
  priorError: Error | null,
  step: () => void,
): Error | null {
  try {
    step();
    return priorError;
  } catch (error) {
    return priorError ?? normalizeRedactCleanupError(error);
  }
}

/**
 * Capture path ownership while the create-only descriptor is still available.
 * Error behavior: swallows inspection failures into a null ownership result.
 */
function captureRejectedRedactOwnership(
  components: readonly RedactDirectoryComponent[],
  outputPath: string,
  descriptor: number,
): Stats | null {
  try {
    assertRedactDirectories(components);
    const descriptorStats = fstatSync(descriptor);
    const pathStats = lstatSync(outputPath);
    return redactSnapshotsMatch(descriptorStats, pathStats) ? pathStats : null;
  } catch {
    return null;
  }
}

/**
 * Remove the rejected path only while it still matches the captured allocation.
 * Error behavior: swallows missing-path failures into null and converts other failures into returned Error values.
 */
function unlinkRejectedRedactAllocation(
  components: readonly RedactDirectoryComponent[],
  outputPath: string,
  ownedSnapshot: Stats | null,
): Error | null {
  if (ownedSnapshot === null) return null;
  try {
    assertRedactDirectories(components);
    const currentSnapshot = lstatSync(outputPath);
    if (redactSnapshotsMatch(currentSnapshot, ownedSnapshot)) {
      unlinkSync(outputPath);
    }
    return null;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? null
      : normalizeRedactCleanupError(error);
  }
}

/**
 * Attempt every cleanup step, then unlink only the create-only path still matching this descriptor.
 *
 * Error behavior: throws the first truncation, flush, close, or unlink error after later cleanup attempts.
 */
function discardRejectedRedactAllocation(
  components: readonly RedactDirectoryComponent[],
  outputPath: string,
  descriptor: number,
): void {
  let cleanupError = attemptRedactCleanupStep(null, () => {
    ftruncateSync(descriptor, 0);
  });
  cleanupError = attemptRedactCleanupStep(cleanupError, () => {
    fsyncSync(descriptor);
  });
  const ownedSnapshot = captureRejectedRedactOwnership(
    components,
    outputPath,
    descriptor,
  );
  cleanupError = attemptRedactCleanupStep(cleanupError, () => {
    closeSync(descriptor);
  });
  const unlinkError = unlinkRejectedRedactAllocation(
    components,
    outputPath,
    ownedSnapshot,
  );
  cleanupError ??= unlinkError;
  if (cleanupError !== null) throw cleanupError;
}

/**
 * Persist scrubbed text through a pinned create-only descriptor under the selected project.
 *
 * Side effects: writes parent directories and one private output file to the filesystem.
 * Error behavior: throws CLIError without replacing an existing artifact.
 */
function persistRedactedOutput(options: ParsedCLI, rendered: string): void {
  if (!options.output) throw new CLIError("redact: missing output path.", 2);
  const projectRoot = resolveRedactProjectRoot(options.projectPath);
  const resolvedOutput = resolveRedactOutputPath(
    options.projectPath,
    projectRoot,
    options.output,
  );
  const components = redactDirectoryComponents(
    projectRoot,
    resolvedOutput.relativeOutputPath,
  );
  ensureRedactDirectories(components);

  let descriptor: number | null = null;
  try {
    descriptor = openSync(resolvedOutput.outputPath, "wx", 0o600);
    assertRedactAllocation(
      components,
      resolvedOutput.outputPath,
      descriptor,
      0,
    );
    const serialized = `${rendered}\n`;
    writeFileSync(descriptor, serialized, { encoding: "utf8" });
    fsyncSync(descriptor);
    assertRedactAllocation(
      components,
      resolvedOutput.outputPath,
      descriptor,
      Buffer.byteLength(serialized, "utf8"),
    );
    closeSync(descriptor);
    descriptor = null;
  } catch (error) {
    if (descriptor !== null) {
      try {
        discardRejectedRedactAllocation(
          components,
          resolvedOutput.outputPath,
          descriptor,
        );
      } catch {
        throw new CLIError(
          "redact: could not discard a rejected output allocation.",
          2,
        );
      }
    }
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new CLIError(
        "redact: output already exists; choose a fresh create-only destination.",
        2,
      );
    }
    if (error instanceof CLIError) throw error;
    throw new CLIError("redact: could not persist scrubbed text.", 2);
  }
  console.error(`Written to ${options.output}`);
}

/**
 * Read a candidate durable artifact from stdin and emit only its scrubbed form.
 * Use `--output` when the CLI should persist the safe result for the user.
 *
 * @param options - parsed CLI options; null output writes the scrubbed text to stdout
 * @returns nothing; stdout uses the shared sink and file output uses the pinned create-only writer
 */
export function handleRedactCommand(options: ParsedCLI): void {
  const inputText = readFileSync(0, "utf-8");
  const rendered = renderRedactedDurableText(inputText);
  if (options.output) {
    persistRedactedOutput(options, rendered);
    return;
  }
  writeOutput(options, rendered);
}
