import { readFileSync, statSync, readdirSync, accessSync, constants } from 'node:fs';
import { resolve, relative, join } from 'node:path';
import type { ReadonlyFS } from '../types.js';

/** Create a read-only filesystem abstraction rooted at the given path. */
export function createFS(rootPath: string): ReadonlyFS {
  /** Absolute path to the project root directory */
  const root = resolve(rootPath);

  /** Resolve a relative path against the project root. */
  function resolvePath(p: string): string {
    return resolve(root, p);
  }

  return {
    exists(path: string): boolean {
      try {
        statSync(resolvePath(path));
        return true;
      } catch {
        return false;
      }
    },

    readFile(path: string): string | null {
      try {
        return readFileSync(resolvePath(path), 'utf-8');
      } catch {
        return null;
      }
    },

    lineCount(path: string): number {
      try {
        const content = readFileSync(resolvePath(path), 'utf-8');
        return content.split('\n').length - (content.endsWith('\n') ? 1 : 0);
      } catch {
        return 0;
      }
    },

    readJson(path: string): unknown {
      try {
        const content = readFileSync(resolvePath(path), 'utf-8');
        return JSON.parse(content);
      } catch {
        return null;
      }
    },

    listDir(path: string): string[] {
      try {
        return readdirSync(resolvePath(path), { withFileTypes: true })
          .map(entry => entry.name);
      } catch {
        return [];
      }
    },

    isExecutable(path: string): boolean {
      try {
        accessSync(resolvePath(path), constants.X_OK);
        return true;
      } catch {
        // On Windows, check for shebang instead
        if (process.platform === 'win32') {
          try {
            const content = readFileSync(resolvePath(path), 'utf-8');
            return content.startsWith('#!');
          } catch {
            return false;
          }
        }
        return false;
      }
    },

    glob(pattern: string): string[] {
      // Simple recursive glob implementation (no deps)
      // Supports: *, **, specific extensions
      /** Accumulated matching file paths */
      const results: string[] = [];
      /** Pattern split into path segments for incremental matching */
      const parts = pattern.split('/');

      /** Recursively walk directories matching glob pattern segments. */
      function walk(dir: string, patternIndex: number): void {
        if (patternIndex >= parts.length) return;

        /** Current pattern segment being matched */
        const part = parts[patternIndex]!;
        /** Whether this is the final segment in the pattern */
        const isLast = patternIndex === parts.length - 1;

        try {
          /** Directory entries at the current level */
          const entries = readdirSync(resolvePath(dir), { withFileTypes: true });

          if (part === '**') {
            // Match zero or more directories
            // Try matching the next part at this level
            if (patternIndex + 1 < parts.length) {
              walk(dir, patternIndex + 1);
            }
            // Iterate over directory entries to recurse into non-ignored subdirectories
            for (const entry of entries) {
              if (entry.isDirectory() && isIgnoredDir(entry.name) === false) {
                walk(join(dir, entry.name), patternIndex);
              }
            }
          } else {
            /** Regex constructed from the glob segment for matching entry names */
            const regex = new RegExp(
              '^' + part.replace(/\./g, '\\.').replace(/\*/g, '[^/]*') + '$'
            );

            // Iterate over directory entries to match against the current glob segment
            for (const entry of entries) {
              if (regex.test(entry.name)) {
                /** Full path combining the current directory and entry name */
                const fullPath = join(dir, entry.name);
                if (isLast) {
                  results.push(relative(root, resolvePath(fullPath)));
                } else if (entry.isDirectory()) {
                  walk(fullPath, patternIndex + 1);
                }
              }
            }
          }
        } catch {
          // Directory doesn't exist or not readable
        }
      }

      walk('.', 0);
      return results;
    },
  };
}

/** Directory names to skip during recursive glob traversal */
const IGNORED_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'build', 'coverage',
  '.next', '.turbo', 'vendor', '.venv', '__pycache__',
  '.idea', '.vscode',
]);

/** Check whether a directory name should be skipped during glob traversal. */
function isIgnoredDir(name: string): boolean {
  return IGNORED_DIRS.has(name);
}
