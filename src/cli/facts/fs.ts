/**
 * Read-only filesystem adapter over Node's `fs` APIs.
 * Audit checks and fact extractors target this interface so tests can swap in mock filesystems without touching extraction logic.
 */
import {
  readFileSync,
  statSync,
  readdirSync,
  accessSync,
  constants,
  type Dirent,
} from "node:fs";
import { resolve, relative, join } from "node:path";
import type { ReadonlyFS } from "../types.js";

/** Read directory entries, returning an empty list when the path is missing. */
function readDirEntries(path: string): Dirent[] {
  try {
    return readdirSync(path, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** Convert one glob segment into the regex used by the filesystem walker. */
function buildGlobRegex(part: string): RegExp {
  return new RegExp(
    "^" + part.replace(/\./g, "\\.").replace(/\*/g, "[^/]*") + "$",
  );
}

/** Walk a glob pattern recursively from the current directory segment. */
function walkGlob(
  root: string,
  resolvePath: (path: string) => string,
  parts: string[],
  dir: string,
  patternIndex: number,
  results: string[],
): void {
  if (patternIndex >= parts.length) return;

  const part = parts[patternIndex];
  if (part === undefined) return;
  if (part === "**") {
    walkGlobStar(root, resolvePath, parts, dir, patternIndex, results);
    return;
  }
  walkGlobSegment(root, resolvePath, parts, dir, patternIndex, results, part);
}

/** Handle the recursive `**` segment in the custom glob walker. */
function walkGlobStar(
  root: string,
  resolvePath: (path: string) => string,
  parts: string[],
  dir: string,
  patternIndex: number,
  results: string[],
): void {
  if (patternIndex + 1 < parts.length) {
    walkGlob(root, resolvePath, parts, dir, patternIndex + 1, results);
  }

  for (const entry of readDirEntries(resolvePath(dir))) {
    if (entry.isDirectory() && isIgnoredDir(entry.name) === false) {
      walkGlob(
        root,
        resolvePath,
        parts,
        join(dir, entry.name),
        patternIndex,
        results,
      );
    }
  }
}

/** Handle a normal glob segment and descend when matching directories remain. */
function walkGlobSegment(
  root: string,
  resolvePath: (path: string) => string,
  parts: string[],
  dir: string,
  patternIndex: number,
  results: string[],
  part: string,
): void {
  const isLast = patternIndex === parts.length - 1;
  const regex = buildGlobRegex(part);

  for (const entry of readDirEntries(resolvePath(dir))) {
    if (!regex.test(entry.name)) continue;

    const fullPath = join(dir, entry.name);
    if (isLast) {
      results.push(relative(root, resolvePath(fullPath)));
      continue;
    }
    if (entry.isDirectory()) {
      walkGlob(root, resolvePath, parts, fullPath, patternIndex + 1, results);
    }
  }
}

/** Walk a glob pattern until the first match is found. */
function walkGlobExists(
  root: string,
  resolvePath: (path: string) => string,
  parts: string[],
  dir: string,
  patternIndex: number,
): boolean {
  if (patternIndex >= parts.length) return false;

  const part = parts[patternIndex];
  if (part === undefined) return false;
  if (part === "**") {
    return walkGlobStarExists(root, resolvePath, parts, dir, patternIndex);
  }
  return walkGlobSegmentExists(
    root,
    resolvePath,
    parts,
    dir,
    patternIndex,
    part,
  );
}

/** Handle a recursive `**` segment for first-match glob checks. */
function walkGlobStarExists(
  root: string,
  resolvePath: (path: string) => string,
  parts: string[],
  dir: string,
  patternIndex: number,
): boolean {
  if (
    patternIndex + 1 < parts.length &&
    walkGlobExists(root, resolvePath, parts, dir, patternIndex + 1)
  ) {
    return true;
  }

  for (const entry of readDirEntries(resolvePath(dir))) {
    if (
      entry.isDirectory() &&
      isIgnoredDir(entry.name) === false &&
      walkGlobExists(
        root,
        resolvePath,
        parts,
        join(dir, entry.name),
        patternIndex,
      )
    ) {
      return true;
    }
  }
  return false;
}

/** Handle a normal glob segment for first-match glob checks. */
function walkGlobSegmentExists(
  root: string,
  resolvePath: (path: string) => string,
  parts: string[],
  dir: string,
  patternIndex: number,
  part: string,
): boolean {
  const isLast = patternIndex === parts.length - 1;
  const regex = buildGlobRegex(part);

  for (const entry of readDirEntries(resolvePath(dir))) {
    if (!regex.test(entry.name)) continue;

    const fullPath = join(dir, entry.name);
    if (isLast) {
      return true;
    }
    if (
      entry.isDirectory() &&
      walkGlobExists(root, resolvePath, parts, fullPath, patternIndex + 1)
    ) {
      return true;
    }
  }
  return false;
}

/** Create a read-only filesystem abstraction rooted at the given path. */
export function createFS(rootPath: string): ReadonlyFS {
  const root = resolve(rootPath);

  function resolvePath(p: string): string {
    return resolve(root, p);
  }

  // Request-scoped caches - discarded when the FS instance is discarded.
  const contentCache = new Map<string, string | null>();
  const existsCache = new Map<string, boolean>();
  const listDirCache = new Map<string, string[]>();
  const globCache = new Map<string, string[]>();

  function cachedReadFile(path: string): string | null {
    const resolved = resolvePath(path);
    const cached = contentCache.get(resolved);
    if (cached !== undefined) return cached;
    try {
      const content = readFileSync(resolved, "utf-8");
      contentCache.set(resolved, content);
      return content;
    } catch {
      contentCache.set(resolved, null);
      return null;
    }
  }

  return {
    exists(path: string): boolean {
      const resolved = resolvePath(path);
      const cached = existsCache.get(resolved);
      if (cached !== undefined) return cached;
      try {
        statSync(resolved);
        existsCache.set(resolved, true);
        return true;
      } catch {
        existsCache.set(resolved, false);
        return false;
      }
    },

    readFile(path: string): string | null {
      return cachedReadFile(path);
    },

    lineCount(path: string): number {
      const content = cachedReadFile(path);
      if (content === null) return 0;
      return content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
    },

    readJson(path: string): unknown {
      const content = cachedReadFile(path);
      if (content === null) return null;
      try {
        return JSON.parse(content);
      } catch {
        return null;
      }
    },

    listDir(path: string): string[] {
      const resolved = resolvePath(path);
      const cached = listDirCache.get(resolved);
      if (cached !== undefined) return cached;
      try {
        const entries = readdirSync(resolved, { withFileTypes: true }).map(
          (entry) => entry.name,
        );
        listDirCache.set(resolved, entries);
        return entries;
      } catch {
        const empty: string[] = [];
        listDirCache.set(resolved, empty);
        return empty;
      }
    },

    isExecutable(path: string): boolean {
      try {
        accessSync(resolvePath(path), constants.X_OK);
        return true;
      } catch {
        if (process.platform === "win32") {
          const content = cachedReadFile(path);
          return content !== null && content.startsWith("#!");
        }
        return false;
      }
    },

    glob(pattern: string): string[] {
      const cached = globCache.get(pattern);
      if (cached !== undefined) return [...cached];
      const results: string[] = [];
      const parts = pattern.split("/");
      walkGlob(root, resolvePath, parts, ".", 0, results);
      globCache.set(pattern, results);
      return [...results];
    },

    existsGlob(pattern: string): boolean {
      const cached = globCache.get(pattern);
      if (cached !== undefined) return cached.length > 0;
      const parts = pattern.split("/");
      return walkGlobExists(root, resolvePath, parts, ".", 0);
    },
  };
}

/** Directory names to skip during recursive glob traversal */
const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
  "vendor",
  ".venv",
  "__pycache__",
  ".idea",
  ".vscode",
]);

/** Skip heavyweight or generated directories during recursive glob walking. */
function isIgnoredDir(name: string): boolean {
  return IGNORED_DIRS.has(name);
}
