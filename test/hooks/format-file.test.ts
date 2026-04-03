/**
 * Hook tests for the format-file post-tool hook.
 * These tests verify JSON payload parsing, formatting behavior, and config-directory skipping.
 */
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createTempCommandDir,
  touchTempCommandFile,
  runHookScript,
  writeWorkspaceFile,
} from '../helpers/hook-runner.js';

const HOOK_PATH = join(
  import.meta.dirname,
  '../../.claude/hooks/format-file.sh',
);

let tempRoot: string | null = null;
let tempBin: ReturnType<typeof createTempCommandDir> | null = null;

afterEach(() => {
  if (tempBin) {
    tempBin.cleanup();
    tempBin = null;
  }
  if (tempRoot) {
    rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  }
});

/** Create a disposable workspace root for each hook test. */
function prepareWorkspace(): string {
  tempRoot = mkdtempSync(join(tmpdir(), 'goat-flow-format-hook-'));
  return tempRoot;
}

/** Return the current temp command directory or fail fast when setup was skipped. */
function requireTempBin(): ReturnType<typeof createTempCommandDir> {
  assert.ok(tempBin, 'temp bin is not initialized');
  return tempBin;
}

/** Install a jq stub that reads the top-level `file_path` field from stdin JSON. */
function writeJqStub(): void {
  tempBin = createTempCommandDir();
  tempBin.writeCommand(
    'jq',
    `#!/usr/bin/env node
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', () => {
  try {
    const parsed = JSON.parse(input);
    const value = parsed?.file_path;
    process.stdout.write(typeof value === 'string' ? value : '');
  } catch {
    process.exitCode = 0;
  }
});
`,
  );
}

/** Install a prettier stub that records invocations and rewrites one chosen file. */
function writePrettierStub(
  fileToFormat: string,
  formattedContent: string,
): string {
  const bin = requireTempBin();

  const logPath = join(bin.dir, 'prettier.log');
  bin.writeCommand(
    'prettier',
    `#!/usr/bin/env node
const fs = require('node:fs');
const logPath = process.env.PRETTIER_LOG_PATH;
if (logPath) fs.appendFileSync(logPath, process.argv.slice(2).join(' ') + '\\n');
const target = process.argv[process.argv.length - 1];
if (target === ${JSON.stringify(fileToFormat)}) {
  fs.writeFileSync(target, ${JSON.stringify(formattedContent)});
}
`,
  );

  return logPath;
}

describe('format-file.sh hook', () => {
  it('reads the top-level file_path field and formats eligible files', () => {
    const root = prepareWorkspace();
    writeJqStub();

    const filePath = join(root, 'src', 'example.ts');
    writeWorkspaceFile(filePath, 'const value=1\n');

    const logPath = writePrettierStub(filePath, 'const value = 1;\n');
    const payload = JSON.stringify({
      file_path: filePath,
      tool_input: { file_path: join(root, '.claude', 'settings.json') },
    });

    const result = runHookScript(HOOK_PATH, payload, {
      cwd: root,
      env: {
        ...tempBin?.env,
        PRETTIER_LOG_PATH: logPath,
      },
    });

    assert.equal(result.status, 0);
    assert.equal(readFileSync(filePath, 'utf8'), 'const value = 1;\n');
    assert.ok(readFileSync(logPath, 'utf8').includes('--write'));
    assert.ok(readFileSync(logPath, 'utf8').includes(filePath));
  });

  it('skips agent config paths even when prettier is available', () => {
    const root = prepareWorkspace();
    writeJqStub();
    const bin = requireTempBin();

    const configPath = join(root, '.claude', 'settings.json');
    writeWorkspaceFile(configPath, '{\n  "value":1\n}\n');

    const eligiblePath = join(root, 'src', 'safe.ts');
    writeWorkspaceFile(eligiblePath, 'const safe=1\n');
    const logPath = writePrettierStub(eligiblePath, 'const safe = 1;\n');
    touchTempCommandFile(bin.dir, 'prettier.log');

    const result = runHookScript(
      HOOK_PATH,
      JSON.stringify({ file_path: configPath }),
      {
        cwd: root,
        env: {
          ...tempBin?.env,
          PRETTIER_LOG_PATH: logPath,
        },
      },
    );

    assert.equal(result.status, 0);
    assert.equal(readFileSync(configPath, 'utf8'), '{\n  "value":1\n}\n');
    assert.equal(readFileSync(logPath, 'utf8'), '');
    assert.equal(readFileSync(eligiblePath, 'utf8'), 'const safe=1\n');
  });
});
