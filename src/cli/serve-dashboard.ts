import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFS } from './facts/fs.js';
import { scanProject } from './scanner/scan.js';
import { renderJson } from './render/json.js';
import type { AgentId } from './types.js';
import type { Runner } from './terminal-types.js';
import type { TerminalManager } from './terminal-server.js';
import type { WebSocketServer, WebSocket as WsWebSocket } from 'ws';

const VALID_AGENTS = new Set<string>(['claude', 'codex', 'gemini']);
const VALID_RUNNERS = new Set<string>(['claude', 'codex', 'gemini']);
const MAX_BODY_BYTES = 64 * 1024; // 64 KB

/** Load a file from the package root by walking up */
function loadPackageFile(name: string): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    try { return readFileSync(join(dir, name), 'utf-8'); } catch { /* up */ }
    dir = dirname(dir);
  }
  throw new Error(`${name} not found`);
}

/** Read the request body as a string, capped at MAX_BODY_BYTES. */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) { req.destroy(); reject(new Error('Request body too large')); return; }
      chunks.push(chunk);
    });
    req.on('end', () => { resolve(Buffer.concat(chunks).toString('utf-8')); });
    req.on('error', reject);
  });
}

/** Send a JSON response. */
function jsonResponse(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

interface DashboardOptions {
  projectPath: string;
}

export interface DashboardServer {
  close: () => Promise<void>;
  port: number;
}

/**
 * Start a local dashboard server. Serves the HTML dashboard and
 * exposes /api/scan, /api/setup, /api/terminal/*, and /api/health endpoints.
 * Returns a handle for testing; callers that don't need it can ignore the return value.
 */
export function serveDashboard(options: DashboardOptions): Promise<DashboardServer> {
  return new Promise((resolveStart) => {
  const template = loadPackageFile('src/dashboard/index.html');
  const absDefault = resolve(options.projectPath);

  // Lazy-init terminal manager + WSS on first terminal request
  let managerPromise: Promise<TerminalManager> | null = null;
  let wssPromise: Promise<WebSocketServer> | null = null;

  async function getManager(): Promise<TerminalManager> {
    if (!managerPromise) {
      managerPromise = import('./terminal-server.js').then(({ TerminalManager: TM }) => new TM());
    }
    return managerPromise;
  }

  async function getWSS(): Promise<WebSocketServer> {
    if (!wssPromise) {
      wssPromise = import('ws').then(({ WebSocketServer: WSS }) => new WSS({ noServer: true }));
    }
    return wssPromise;
  }

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

    // Dashboard HTML - inject default project path
    if (url.pathname === '/') {
      const injection = `<script>window.__GOAT_FLOW_DEFAULT_PATH__ = ${JSON.stringify(absDefault)};</script>`;
      const html = template.replace('</body>', `${injection}\n</body>`);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    // Static dashboard assets (presets.js, etc.)
    if (url.pathname.startsWith('/assets/')) {
      const filename = url.pathname.slice('/assets/'.length);
      if (/^[a-z0-9_-]+\.js$/i.test(filename)) {
        try {
          const content = loadPackageFile(`src/dashboard/${filename}`);
          res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
          res.end(content);
        } catch {
          res.writeHead(404); res.end('Not found');
        }
        return;
      }
    }

    // Scan API
    if (url.pathname === '/api/scan') {
      const projectPath = resolve(url.searchParams.get('path') || absDefault);
      try {
        const fs = createFS(projectPath);
        const report = scanProject(fs, projectPath, { agentFilter: null });
        jsonResponse(res, 200, JSON.parse(renderJson(report)));
      } catch (err) {
        jsonResponse(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    // Setup API
    if (url.pathname === '/api/setup') {
      const projectPath = resolve(url.searchParams.get('path') || absDefault);
      const agentParam = url.searchParams.get('agent') || 'claude';
      if (!VALID_AGENTS.has(agentParam)) {
        jsonResponse(res, 400, { error: `Invalid agent: ${agentParam}. Valid: claude, codex, gemini` });
        return;
      }
      const agent = agentParam as AgentId;
      try {
        const fs = createFS(projectPath);
        const report = scanProject(fs, projectPath, { agentFilter: agent });
        const { composeSetup } = await import('./prompt/compose-setup.js');
        const output = composeSetup(report, agent);
        jsonResponse(res, 200, { output: output ?? 'No setup output generated.' });
      } catch (err) {
        jsonResponse(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    // Browse directories API
    if (url.pathname === '/api/browse') {
      const dirPath = resolve(url.searchParams.get('path') || absDefault);
      try {
        const entries = readdirSync(dirPath, { withFileTypes: true })
          .filter(e => e.isDirectory() && !e.name.startsWith('.'))
          .map(e => e.name)
          .sort();
        const dirs = entries.map(name => {
          const full = join(dirPath, name);
          const hasProject = ['package.json', 'go.mod', 'Cargo.toml', 'composer.json', 'pyproject.toml', 'CLAUDE.md', 'AGENTS.md'].some(f => {
            try { statSync(join(full, f)); return true; } catch { return false; }
          });
          return { name, path: full, isProject: hasProject };
        });
        jsonResponse(res, 200, { current: dirPath, parent: dirname(dirPath), dirs });
      } catch (err) {
        jsonResponse(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    // Terminal: create session
    if (url.pathname === '/api/terminal/create' && req.method === 'POST') {
      try {
        const manager = await getManager();
        const body = JSON.parse(await readBody(req)) as { prompt?: string; projectPath?: string; runner?: string };
        const runner = (body.runner && VALID_RUNNERS.has(body.runner) ? body.runner : 'claude') as Runner;
        const result = await manager.create(
          body.prompt ?? '',
          body.projectPath ?? absDefault,
          runner,
        );
        jsonResponse(res, 200, result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const status = message.includes('Maximum') || message.includes('not found') || message.includes('not available') || message.includes('too large') ? 400 : 500;
        jsonResponse(res, status, { error: message });
      }
      return;
    }

    // Terminal: list sessions
    if (url.pathname === '/api/terminal/list' && req.method === 'GET') {
      try {
        const manager = await getManager();
        jsonResponse(res, 200, manager.list());
      } catch (err) {
        jsonResponse(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    // Terminal: kill session
    if (url.pathname.startsWith('/api/terminal/') && req.method === 'DELETE') {
      const id = url.pathname.slice('/api/terminal/'.length);
      try {
        const manager = await getManager();
        const killed = manager.kill(id);
        if (killed) {
          jsonResponse(res, 200, { ok: true });
        } else {
          jsonResponse(res, 404, { error: 'Session not found' });
        }
      } catch (err) {
        jsonResponse(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    // Health
    if (url.pathname === '/api/health' && req.method === 'GET') {
      try {
        const manager = await getManager();
        jsonResponse(res, 200, await manager.health());
      } catch (err) {
        jsonResponse(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  }

  const server = createServer((req, res) => {
    handleRequest(req, res).catch((err: unknown) => {
      if (!res.headersSent) {
        jsonResponse(res, 500, { error: err instanceof Error ? err.message : 'Internal error' });
      }
    });
  });

  // WebSocket upgrade for terminal sessions
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1`);

    if (!url.pathname.startsWith('/ws/terminal/')) {
      socket.destroy();
      return;
    }

    // Origin check — reject non-localhost origins (DNS rebinding protection)
    const origin = req.headers.origin;
    const addr = server.address();
    if (origin && addr && typeof addr !== 'string') {
      const expected = `http://127.0.0.1:${addr.port}`;
      if (origin !== expected && origin !== `http://localhost:${addr.port}`) {
        socket.destroy();
        return;
      }
    }

    const sessionId = url.pathname.slice('/ws/terminal/'.length);

    void (async () => {
      try {
        const wss = await getWSS();
        const manager = await getManager();
        wss.handleUpgrade(req, socket, head, (ws) => {
          manager.attachWebSocket(sessionId, ws as unknown as WsWebSocket);
        });
      } catch {
        socket.destroy();
      }
    })();
  });

  // Graceful shutdown
  const doShutdown = (): void => {
    void (async () => {
      if (managerPromise) {
        const manager = await managerPromise;
        manager.shutdown();
      }
      process.exit(0);
    })();
  };
  process.on('SIGTERM', doShutdown);
  process.on('SIGINT', doShutdown);

  server.listen(0, '127.0.0.1', () => {
    const addr = server.address();
    if (!addr || typeof addr === 'string') return;
    const url = `http://127.0.0.1:${addr.port}`;
    console.log(`Dashboard: ${url}`);
    resolveStart({
      port: addr.port,
      close: async () => {
        if (managerPromise) {
          const manager = await managerPromise;
          manager.shutdown();
        }
        server.close();
      },
    });
  });
  }); // end Promise
}
