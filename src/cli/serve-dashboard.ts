import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
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
  openBrowser: boolean;
}

export interface DashboardServer {
  close: () => Promise<void>;
  port: number;
}

function getDashboardOpenFlagPath(projectPath: string): string {
  return join(projectPath, '.goat-flow', '.goat-flow-dashboard-opened');
}

function markDashboardOpened(projectPath: string): void {
  const flagPath = getDashboardOpenFlagPath(projectPath);
  try {
    mkdirSync(dirname(flagPath), { recursive: true });
    writeFileSync(flagPath, '');
  } catch { /* ignore */ }
}

function shouldOpenDashboardInBrowser(projectPath: string): boolean {
  return !existsSync(getDashboardOpenFlagPath(projectPath));
}

function openBrowserWindow(url: string): void {
  const [command, args] = (() => {
    if (process.platform === 'darwin') {
      return ['open', [url] as string[]] as const;
    }
    if (process.platform === 'win32') {
      return ['cmd', ['/c', 'start', '', url] as string[]] as const;
    }
    return ['xdg-open', [url] as string[]] as const;
  })();

  try {
    const proc = spawn(command, args, { detached: true, stdio: 'ignore' });
    proc.unref();
  } catch { /* ignore */ }
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
  const openBrowser = options.openBrowser === true;

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

  function handleHtmlRequest(url: URL, res: ServerResponse): boolean {
    if (url.pathname !== '/') return false;

    const injection = `<script>window.__GOAT_FLOW_DEFAULT_PATH__ = ${JSON.stringify(absDefault)};</script>`;
    const html = template.replace('</body>', `${injection}\n</body>`);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return true;
  }

  function handleAssetRequest(url: URL, res: ServerResponse): boolean {
    if (!url.pathname.startsWith('/assets/')) return false;

    const filename = url.pathname.slice('/assets/'.length);
    if (!/^[a-z0-9_-]+\.js$/i.test(filename)) return false;

    try {
      const content = loadPackageFile(`src/dashboard/${filename}`);
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
    return true;
  }

  function handleScanRequest(url: URL, res: ServerResponse): boolean {
    if (url.pathname !== '/api/scan') return false;

    const projectPath = resolve(url.searchParams.get('path') || absDefault);
    try {
      const fs = createFS(projectPath);
      const report = scanProject(fs, projectPath, { agentFilter: null });
      jsonResponse(res, 200, JSON.parse(renderJson(report)));
    } catch (err) {
      jsonResponse(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  async function handleSetupRequest(url: URL, res: ServerResponse): Promise<boolean> {
    if (url.pathname !== '/api/setup') return false;

    const projectPath = resolve(url.searchParams.get('path') || absDefault);
    const agentParam = url.searchParams.get('agent') || 'claude';
    if (!VALID_AGENTS.has(agentParam)) {
      jsonResponse(res, 400, { error: `Invalid agent: ${agentParam}. Valid: claude, codex, gemini` });
      return true;
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
    return true;
  }

  function isProjectDirectory(dirPath: string): boolean {
    return ['package.json', 'go.mod', 'Cargo.toml', 'composer.json', 'pyproject.toml', 'CLAUDE.md', 'AGENTS.md'].some((file) => {
      try {
        statSync(join(dirPath, file));
        return true;
      } catch {
        return false;
      }
    });
  }

  function handleBrowseRequest(url: URL, res: ServerResponse): boolean {
    if (url.pathname !== '/api/browse') return false;

    const dirPath = resolve(url.searchParams.get('path') || absDefault);
    try {
      const entries = readdirSync(dirPath, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
        .map(entry => entry.name)
        .sort();
      const dirs = entries.map(name => {
        const full = join(dirPath, name);
        return { name, path: full, isProject: isProjectDirectory(full) };
      });
      jsonResponse(res, 200, { current: dirPath, parent: dirname(dirPath), dirs });
    } catch (err) {
      jsonResponse(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  function terminalCreateStatus(message: string): number {
    return message.includes('Maximum')
      || message.includes('not found')
      || message.includes('not available')
      || message.includes('too large')
      ? 400
      : 500;
  }

  async function handleTerminalCreateRequest(
    req: IncomingMessage,
    url: URL,
    res: ServerResponse,
  ): Promise<boolean> {
    if (url.pathname !== '/api/terminal/create' || req.method !== 'POST') return false;

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
      jsonResponse(res, terminalCreateStatus(message), { error: message });
    }
    return true;
  }

  async function handleTerminalListRequest(
    req: IncomingMessage,
    url: URL,
    res: ServerResponse,
  ): Promise<boolean> {
    if (url.pathname !== '/api/terminal/list' || req.method !== 'GET') return false;

    try {
      const manager = await getManager();
      jsonResponse(res, 200, manager.list());
    } catch (err) {
      jsonResponse(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  async function handleTerminalDeleteRequest(
    req: IncomingMessage,
    url: URL,
    res: ServerResponse,
  ): Promise<boolean> {
    if (!url.pathname.startsWith('/api/terminal/') || req.method !== 'DELETE') return false;

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
    return true;
  }

  async function handleHealthRequest(
    req: IncomingMessage,
    url: URL,
    res: ServerResponse,
  ): Promise<boolean> {
    if (url.pathname !== '/api/health' || req.method !== 'GET') return false;

    try {
      const manager = await getManager();
      jsonResponse(res, 200, await manager.health());
    } catch (err) {
      jsonResponse(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const routeHandlers = [
      () => Promise.resolve(handleHtmlRequest(url, res)),
      () => Promise.resolve(handleAssetRequest(url, res)),
      () => Promise.resolve(handleScanRequest(url, res)),
      () => handleSetupRequest(url, res),
      () => Promise.resolve(handleBrowseRequest(url, res)),
      () => handleTerminalCreateRequest(req, url, res),
      () => handleTerminalListRequest(req, url, res),
      () => handleTerminalDeleteRequest(req, url, res),
      () => handleHealthRequest(req, url, res),
    ];

    for (const route of routeHandlers) {
      if (await route()) return;
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
    if (openBrowser && shouldOpenDashboardInBrowser(absDefault)) {
      openBrowserWindow(url);
      markDashboardOpened(absDefault);
    }
    // Check if terminal is available and warn if not
    void getManager().then(m => m.health()).then(h => {
      if (!h.nodePtyAvailable) {
        console.log('Note: Terminal feature unavailable (node-pty not installed)');
        console.log('  Fix: npm install node-pty (or: pnpm approve-builds)');
        console.log('  See: https://github.com/blundergoat/goat-flow#troubleshooting');
      }
    }).catch(() => {
      console.log('Note: Terminal feature unavailable (node-pty not installed)');
      console.log('  Fix: npm install node-pty (or: pnpm approve-builds)');
      console.log('  See: https://github.com/blundergoat/goat-flow#troubleshooting');
    });
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
