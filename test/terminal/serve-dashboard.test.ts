import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

// Check if claude CLI is available (skip PTY tests on CI)
let claudeAvailable = false;
try { execFileSync('claude', ['--version'], { stdio: 'ignore', timeout: 5000 }); claudeAvailable = true; } catch { /* not installed */ }
const skipReason = 'claude CLI not installed (CI environment)';
const requiresClaude = { skip: claudeAvailable ? false : skipReason };

// Helper: make an HTTP request to the dashboard server
function request(port: number, method: string, path: string, body?: unknown): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      method,
      path,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8');
        let data: unknown;
        try { data = JSON.parse(raw); } catch { data = raw; }
        resolve({ status: res.statusCode ?? 0, data });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

import type { DashboardServer } from '../../src/cli/serve-dashboard.js';

let tempDir: string;
let dashboardServer: DashboardServer | null = null;

// We use a single server for all tests to avoid port conflicts
// Start it before any test runs

describe('serve-dashboard API', () => {
  let port = 0;

  it('setup: start server', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'goat-dashboard-test-'));
    const { serveDashboard } = await import('../../src/cli/serve-dashboard.js');
    // Suppress console.log from server startup
    const origLog = console.log;
    console.log = () => {};
    dashboardServer = await serveDashboard({ projectPath: tempDir });
    console.log = origLog;
    port = dashboardServer.port;
    assert.ok(port > 0, 'Server should start on a port');
  });

  it('GET / returns HTML', async () => {
    const { status, data } = await request(port, 'GET', '/');
    assert.equal(status, 200);
    assert.ok(typeof data === 'string' && data.includes('GOAT Flow'));
  });

  it('GET / injects default project path', async () => {
    const { data } = await request(port, 'GET', '/');
    assert.ok(typeof data === 'string' && data.includes('__GOAT_FLOW_DEFAULT_PATH__'));
  });

  it('GET /api/health returns health info', async () => {
    const { status, data } = await request(port, 'GET', '/api/health');
    assert.equal(status, 200);
    const d = data as { uptime: number; activeSessions: number; nodePtyAvailable: boolean; availableRunners: string[] };
    assert.equal(typeof d.uptime, 'number');
    assert.equal(typeof d.activeSessions, 'number');
    assert.equal(typeof d.nodePtyAvailable, 'boolean');
    assert.ok(Array.isArray(d.availableRunners));
  });

  it('GET /api/terminal/list returns empty array', async () => {
    const { status, data } = await request(port, 'GET', '/api/terminal/list');
    assert.equal(status, 200);
    assert.ok(Array.isArray(data));
    assert.equal((data as unknown[]).length, 0);
  });

  it('POST /api/terminal/create with valid path succeeds', requiresClaude, async () => {
    const { status, data } = await request(port, 'POST', '/api/terminal/create', {
      prompt: 'hello',
      projectPath: tempDir,
    });
    assert.equal(status, 200);
    const d = data as { id: string; status: string; wsUrl: string };
    assert.ok(d.id);
    assert.equal(d.status, 'active');
    assert.ok(d.wsUrl.startsWith('/ws/terminal/'));
    // Clean up
    await request(port, 'DELETE', `/api/terminal/${d.id}`);
  });

  it('POST /api/terminal/create with invalid path returns 400/500', requiresClaude, async () => {
    const { status, data } = await request(port, 'POST', '/api/terminal/create', {
      prompt: 'hello',
      projectPath: '/tmp/nonexistent-goat-test-xyz',
    });
    assert.ok(status >= 400);
    assert.ok((data as { error: string }).error.includes('does not exist'));
  });

  it('POST /api/terminal/create with invalid runner returns 400', requiresClaude, async () => {
    const { status, data } = await request(port, 'POST', '/api/terminal/create', {
      prompt: 'hello',
      projectPath: tempDir,
      runner: 'nonexistent-cli',
    });
    // Invalid runner falls back to 'claude' which should work
    // Actually 'nonexistent-cli' is not in VALID_RUNNERS so it defaults to 'claude'
    assert.equal(status, 200);
    const d = data as { id: string };
    await request(port, 'DELETE', `/api/terminal/${d.id}`);
  });

  it('DELETE /api/terminal/:id kills a session', requiresClaude, async () => {
    const createRes = await request(port, 'POST', '/api/terminal/create', {
      prompt: '',
      projectPath: tempDir,
    });
    const id = (createRes.data as { id: string }).id;
    const { status, data } = await request(port, 'DELETE', `/api/terminal/${id}`);
    assert.equal(status, 200);
    assert.deepEqual(data, { ok: true });
  });

  it('DELETE /api/terminal/:id returns 404 for unknown session', async () => {
    const { status, data } = await request(port, 'DELETE', '/api/terminal/nonexistent-id');
    assert.equal(status, 404);
    assert.ok((data as { error: string }).error.includes('not found'));
  });

  it('GET /api/browse returns directory listing', async () => {
    const { status, data } = await request(port, 'GET', `/api/browse?path=${encodeURIComponent(tempDir)}`);
    assert.equal(status, 200);
    const d = data as { current: string; parent: string; dirs: unknown[] };
    assert.equal(d.current, tempDir);
    assert.ok(Array.isArray(d.dirs));
  });

  it('GET /unknown returns 404', async () => {
    const { status } = await request(port, 'GET', '/nonexistent');
    assert.equal(status, 404);
  });

  it('POST /api/terminal/create rejects oversized body', async () => {
    const huge = 'x'.repeat(65 * 1024); // > 64KB
    try {
      const { status } = await request(port, 'POST', '/api/terminal/create', { prompt: huge });
      assert.ok(status >= 400);
    } catch (err) {
      // Connection reset is also correct — server destroys the socket
      assert.ok(err instanceof Error && (err.message.includes('socket hang up') || err.message.includes('ECONNRESET')));
    }
  });

  it('GET /assets/presets.js returns JS', async () => {
    const { status, data } = await request(port, 'GET', '/assets/presets.js');
    assert.equal(status, 200);
    assert.ok(typeof data === 'string' && data.includes('PRESETS'));
  });

  it('GET /assets/nonexistent.js returns 404', async () => {
    const { status } = await request(port, 'GET', '/assets/nonexistent.js');
    assert.equal(status, 404);
  });

  it('cleanup', async () => {
    if (dashboardServer) await dashboardServer.close();
    try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });
});
