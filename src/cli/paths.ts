import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Find the goat-flow project root by walking up from this file's directory */
function findGoatFlowRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, 'package.json');
    if (existsSync(candidate)) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Could not find goat-flow project root');
}

/** Absolute path to the goat-flow project root */
const GOAT_FLOW_ROOT = findGoatFlowRoot();

/** Resolve a relative template path to an absolute path within goat-flow */
export function getTemplatePath(relative: string): string {
  return join(GOAT_FLOW_ROOT, relative);
}

/** Check whether a template file exists on disk */
export function templateExists(relative: string): boolean {
  return existsSync(getTemplatePath(relative));
}
