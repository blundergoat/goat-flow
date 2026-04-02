import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { TerminalManager, validateProjectPath } from '../../src/cli/terminal-server.js';

// Check if claude CLI is available (skip PTY tests on CI where it's not installed)
let claudeAvailable = false;
try { execFileSync('claude', ['--version'], { stdio: 'ignore', timeout: 5000 }); claudeAvailable = true; } catch { /* not installed */ }
const skipReason = 'claude CLI not installed (CI environment)';
const requiresClaude = { skip: claudeAvailable ? false : skipReason };

// Create a real temp directory for path validation tests
let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'goat-flow-test-'));
});

afterEach(() => {
  try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('validateProjectPath', () => {
  it('accepts a valid directory', () => {
    const result = validateProjectPath(tempDir);
    assert.equal(result, tempDir);
  });

  it('rejects a non-existent path', () => {
    assert.throws(
      () => validateProjectPath('/tmp/does-not-exist-goat-flow-test-xyz'),
      /does not exist/,
    );
  });

  it('rejects a file (not a directory)', async () => {
    const { writeFileSync } = await import('node:fs');
    const filePath = join(tempDir, 'not-a-dir.txt');
    writeFileSync(filePath, 'hello');
    assert.throws(
      () => validateProjectPath(filePath),
      /not a directory/,
    );
  });
});

describe('TerminalManager', () => {
  it('reports available runners', async () => {
    const manager = new TerminalManager();
    const health = await manager.health();
    assert.equal(typeof health.uptime, 'number');
    assert.equal(typeof health.activeSessions, 'number');
    assert.ok(Array.isArray(health.availableRunners));
  });

  it('list() returns empty initially', () => {
    const manager = new TerminalManager();
    assert.deepEqual(manager.list(), []);
  });

  it('get() returns null for unknown session', () => {
    const manager = new TerminalManager();
    assert.equal(manager.get('nonexistent-id'), null);
  });

  it('kill() returns false for unknown session', () => {
    const manager = new TerminalManager();
    assert.equal(manager.kill('nonexistent-id'), false);
  });

  it('health() reports structure', async () => {
    const manager = new TerminalManager();
    const health = await manager.health();
    assert.equal(typeof health.uptime, 'number');
    assert.equal(health.activeSessions, 0);
    assert.equal(typeof health.nodePtyAvailable, 'boolean');
    assert.ok(Array.isArray(health.availableRunners));
  });

  it('rejects create when runner CLI not found', async () => {
    const manager = new TerminalManager();
    // Use a runner that doesn't exist — codex or gemini might not be installed
    // Override runnerPaths to be empty
    (manager as unknown as { runnerPaths: Map<string, string> }).runnerPaths = new Map();
    await assert.rejects(
      () => manager.create('hello', tempDir, 'claude'),
      /CLI not found/,
    );
  });

  it('enforces max 3 sessions', requiresClaude, async () => {
    const manager = new TerminalManager();
    try {
      const sessions = [];
      for (let i = 0; i < 3; i++) {
        sessions.push(await manager.create('', tempDir));
      }
      assert.equal(manager.list().length, 3);

      // 4th should fail
      await assert.rejects(
        () => manager.create('', tempDir),
        /Maximum 3 concurrent sessions/,
      );

      // Kill one and try again
      manager.kill(sessions[0].id);
      const fourth = await manager.create('', tempDir);
      assert.ok(fourth.id);
    } finally {
      await manager.shutdown();
    }
  });

  it('create rejects invalid projectPath', requiresClaude, async () => {
    const manager = new TerminalManager();
    await assert.rejects(
      () => manager.create('hello', '/tmp/does-not-exist-goat-flow-xyz'),
      /does not exist/,
    );
  });

  it('session includes runner info', requiresClaude, async () => {
    const manager = new TerminalManager();
    try {
      const session = await manager.create('', tempDir);
      const info = manager.get(session.id);
      assert.ok(info);
      assert.equal(info.runner, 'claude');
    } finally {
      await manager.shutdown();
    }
  });
});

describe('idle timeout', () => {
  it('terminates session after idle period', requiresClaude, async () => {
    mock.timers.enable({ apis: ['setTimeout'] });

    const manager = new TerminalManager();
    try {
      const session = await manager.create('', tempDir);
      assert.equal(manager.get(session.id)?.status, 'active');

      // Advance past the 30-minute idle timeout
      mock.timers.tick(31 * 60 * 1000);

      // Session should now be terminated
      const info = manager.get(session.id);
      assert.equal(info?.status, 'terminated');
    } finally {
      await manager.shutdown();
      mock.timers.reset();
    }
  });
});

describe('shell metacharacter safety', () => {
  it('prompt with semicolon is passed as literal argument', requiresClaude, async () => {
    const manager = new TerminalManager();
    try {
      const session = await manager.create('"; rm -rf /"', tempDir);
      assert.ok(session.id);
      manager.kill(session.id);
    } finally {
      await manager.shutdown();
    }
  });

  it('prompt with $() is passed as literal argument', requiresClaude, async () => {
    const manager = new TerminalManager();
    try {
      const session = await manager.create('$(whoami)', tempDir);
      assert.ok(session.id);
      manager.kill(session.id);
    } finally {
      await manager.shutdown();
    }
  });

  it('prompt with backticks is passed as literal argument', requiresClaude, async () => {
    const manager = new TerminalManager();
    try {
      const session = await manager.create('`id`', tempDir);
      assert.ok(session.id);
      manager.kill(session.id);
    } finally {
      await manager.shutdown();
    }
  });
});
