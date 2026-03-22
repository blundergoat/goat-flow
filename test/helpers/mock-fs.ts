import type { ReadonlyFS } from '../../src/cli/types.js';

/**
 * In-memory filesystem for unit testing. No disk access.
 */
export function createMockFS(files: Record<string, string>): ReadonlyFS {
  const fileMap = new Map(Object.entries(files));

  function hasDirEntries(dir: string): boolean {
    const prefix = dir.endsWith('/') ? dir : dir + '/';
    for (const key of fileMap.keys()) {
      if (key.startsWith(prefix)) return true;
    }
    return false;
  }

  return {
    exists(path: string): boolean {
      return fileMap.has(path) || hasDirEntries(path);
    },

    readFile(path: string): string | null {
      return fileMap.get(path) ?? null;
    },

    lineCount(path: string): number {
      const content = fileMap.get(path);
      if (!content) return 0;
      return content.split('\n').length;
    },

    readJson(path: string): unknown | null {
      const content = fileMap.get(path);
      if (!content) return null;
      try {
        return JSON.parse(content);
      } catch {
        return null;
      }
    },

    listDir(path: string): string[] {
      const prefix = path.endsWith('/') ? path : path + '/';
      const entries = new Set<string>();
      for (const key of fileMap.keys()) {
        if (key.startsWith(prefix)) {
          const rest = key.slice(prefix.length);
          const firstPart = rest.split('/')[0];
          if (firstPart) entries.add(firstPart);
        }
      }
      return [...entries];
    },

    isExecutable(path: string): boolean {
      const content = fileMap.get(path);
      if (!content) return false;
      return content.startsWith('#!');
    },

    glob(pattern: string): string[] {
      const regex = new RegExp(
        '^' +
        pattern
          .replace(/\./g, '\\.')
          .replace(/\*\*/g, '{{GLOBSTAR}}')
          .replace(/\*/g, '[^/]*')
          .replace(/\{\{GLOBSTAR\}\}/g, '.*') +
        '$'
      );
      return [...fileMap.keys()].filter(key => regex.test(key));
    },
  };
}
