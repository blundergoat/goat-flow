/** Publish installer files beside their destinations, without a copy fallback. */
import {
  chmodSync,
  constants,
  copyFileSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
  type Stats,
} from "node:fs";
import { basename, dirname, isAbsolute, join, win32 } from "node:path";

/** Reject path spellings that can leave the selected project. */
function isUnsafeDestination(relative: string): boolean {
  return (
    !relative ||
    isAbsolute(relative) ||
    win32.isAbsolute(relative) ||
    relative.includes("\\") ||
    relative.includes("\0") ||
    relative.split("/").some((part) => !part || part === "." || part === "..")
  );
}

/** Parents must be directories; an existing destination must be a single-link regular file. */
function destinationProblem(stats: Stats, isParent: boolean): string | null {
  if (stats.isSymbolicLink()) return "symlink component";
  if (isParent) return stats.isDirectory() ? null : "non-directory component";
  return stats.isFile() && stats.nlink === 1
    ? null
    : "destination is not a single-link regular file";
}

/** Reject redirects and non-files before a selected project receives installer bytes. */
export function installerDestination(
  project: string,
  relative: string,
): string {
  const parts = relative.split("/");
  if (isUnsafeDestination(relative)) {
    throw new Error(
      `unsafe installer destination '${relative}': expected a project-relative path`,
    );
  }
  let current = project;
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    const stats = lstatSync(current, { throwIfNoEntry: false });
    if (!stats) continue;
    const reason = destinationProblem(stats, index < parts.length - 1);
    if (reason)
      throw new Error(`unsafe installer destination '${relative}': ${reason}`);
  }
  return current;
}

/** Create parents one component at a time, checking them again before publication. */
export function installerDirectory(project: string, relative: string): string {
  installerDestination(project, `${relative}/.goat-flow-directory-check`);
  const directory = join(project, relative);
  mkdirSync(directory, { recursive: true });
  installerDestination(project, `${relative}/.goat-flow-directory-check`);
  return directory;
}

/** Windows sharing violations get a short bounded retry; other failures remain immediate. */
function renamePayload(source: string, destination: string): void {
  for (let attempt = 0; ; attempt += 1) {
    try {
      renameSync(source, destination);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (
        process.platform !== "win32" ||
        attempt >= 3 ||
        !["EACCES", "EPERM", "EBUSY"].includes(code ?? "")
      )
        throw error;
      Atomics.wait(
        new Int32Array(new SharedArrayBuffer(4)),
        0,
        0,
        25 * (attempt + 1),
      );
    }
  }
}

export interface InstallerFileOptions {
  /** A user seed must lose a race to any existing destination. */
  createOnly?: boolean;
  mode?: number;
}

/** Stage complete bytes before exposing them; remove only this operation's own payload. */
function publish(
  project: string,
  relative: string,
  fill: (payload: string) => void,
  options: InstallerFileOptions,
): void {
  const destination = installerDestination(project, relative);
  const parent = dirname(relative);
  if (parent !== ".") installerDirectory(project, parent);
  installerDestination(project, relative);
  let staging: string;
  try {
    staging = mkdtempSync(
      join(dirname(destination), `.goat-flow-stage.${basename(destination)}.`),
    );
  } catch (error) {
    throw new Error(
      `could not create adjacent staging directory for '${relative}'; previous destination was preserved`,
      { cause: error },
    );
  }
  const payload = join(staging, "payload");
  const stagingIdentity = lstatSync(staging);
  try {
    try {
      fill(payload);
      const staged = lstatSync(payload);
      if (!staged.isFile() || staged.nlink !== 1)
        throw new Error("staged payload is not a single-link regular file");
      if (options.mode !== undefined) chmodSync(payload, options.mode);
    } catch (error) {
      throw new Error(
        `staging copy failed for '${relative}'; previous destination was preserved`,
        { cause: error },
      );
    }
    installerDestination(project, relative);
    try {
      if (options.createOnly) linkSync(payload, destination);
      else renamePayload(payload, destination);
    } catch (error) {
      throw new Error(
        `atomic ${options.createOnly ? "create" : "replacement"} failed for '${relative}'; previous destination was preserved and no non-atomic fallback was attempted`,
        { cause: error },
      );
    }
  } finally {
    cleanStaging(staging, payload, stagingIdentity);
  }
}

/** Remove only the directory allocated by this operation, preserving replacements and unexpected files. */
function cleanStaging(staging: string, payload: string, identity: Stats): void {
  const current = lstatSync(staging, { throwIfNoEntry: false });
  if (
    !current?.isDirectory() ||
    current.dev !== identity.dev ||
    current.ino !== identity.ino
  )
    return;
  if (lstatSync(payload, { throwIfNoEntry: false })) unlinkSync(payload);
  rmdirSync(staging);
}

/** Copy a package template without exposing partially copied destination bytes. */
export function copyInstallerFile(
  project: string,
  relative: string,
  source: string,
  options: InstallerFileOptions = {},
): void {
  publish(
    project,
    relative,
    (payload) => {
      copyFileSync(source, payload, constants.COPYFILE_EXCL);
    },
    options,
  );
}

/** Publish generated or transformed content, retaining an existing destination's mode. */
export function writeInstallerFile(
  project: string,
  relative: string,
  bytes: string | Uint8Array,
  options: InstallerFileOptions = {},
): void {
  const destination = installerDestination(project, relative);
  const mode =
    options.mode ?? lstatSync(destination, { throwIfNoEntry: false })?.mode;
  publish(
    project,
    relative,
    (payload) => {
      writeFileSync(payload, bytes, { flag: "wx" });
    },
    {
      ...options,
      ...(mode === undefined ? {} : { mode }),
    },
  );
}

/** Leave unchanged transformations byte-for-byte and inode-for-inode intact. */
export function transformInstallerFile(
  project: string,
  relative: string,
  transform: (content: string) => string,
): boolean {
  const destination = installerDestination(project, relative);
  const before = readFileSync(destination, "utf8");
  const after = transform(before);
  if (before === after) return false;
  writeInstallerFile(project, relative, after);
  return true;
}
