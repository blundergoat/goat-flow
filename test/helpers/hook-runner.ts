/**
 * Utilities for executing hook scripts in tests with a controlled stdin payload and PATH.
 * The helpers keep hook tests deterministic by letting callers provide local command stubs.
 */
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export interface HookRunResult {
  status: number;
  stdout: string;
  stderr: string;
}

export interface HookRunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export interface TempCommandDir {
  dir: string;
  env: NodeJS.ProcessEnv;
  cleanup: () => void;
  writeCommand: (name: string, body: string) => string;
}

/** Write a UTF-8 text file after creating its parent directory tree. */
export function writeWorkspaceFile(filePath: string, content: string): string {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf8');
  return filePath;
}

/** Run a hook script with stdin payload and capture its exit status plus output. */
export function runHookScript(
  scriptPath: string,
  input: string,
  options: HookRunOptions = {},
): HookRunResult {
  const result = spawnSync('bash', [scriptPath], {
    cwd: options.cwd,
    env: options.env,
    input,
    encoding: 'utf8',
    timeout: options.timeoutMs ?? 5000,
    maxBuffer: 10 * 1024 * 1024,
  });

  return {
    status: result.status ?? 0,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/** Create a temporary bin directory and prepend it to PATH for hook stubs. */
export function createTempCommandDir(
  prefix = 'goat-flow-hook-bin-',
): TempCommandDir {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${dir}${process.env.PATH ? `:${process.env.PATH}` : ''}`,
  };

  return {
    dir,
    env,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
    /** Write an executable command stub into the temporary bin directory. */
    writeCommand(name: string, body: string): string {
      const path = join(dir, name);
      writeFileSync(path, body, 'utf8');
      chmodSync(path, 0o755);
      return path;
    },
  };
}

/** Create an empty log file in the temporary command directory. */
export function touchTempCommandFile(dir: string, name: string): string {
  const path = join(dir, name);
  writeFileSync(path, '', 'utf8');
  return path;
}
