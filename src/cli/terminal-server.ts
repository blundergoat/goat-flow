import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import type { WebSocket } from 'ws';
import type {
  SessionInfo,
  SessionStatus,
  CreateResponse,
  HealthResponse,
  ClientMessage,
  ServerMessage,
  Runner,
} from './terminal-types.js';

// node-pty types — optional dep, can't use static import
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type NodePtyModule = typeof import('node-pty');
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type IPty = ReturnType<typeof import('node-pty').spawn>;

const MAX_SESSIONS = 3;
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

/** CLI binary names for each runner. */
const RUNNER_BINARIES: Record<Runner, string> = {
  claude: 'claude',
  codex: 'codex',
  gemini: 'gemini',
};

interface TerminalSession {
  id: string;
  status: SessionStatus;
  createdAt: string;
  projectPath: string;
  runner: Runner;
  lastInputAt: number;
  pty: IPty | null;
  ws: WebSocket | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

/** Resolve the absolute path to a CLI binary. Returns null if not found. */
function resolveCLIPath(name: string): string | null {
  try {
    execFileSync(name, ['--version'], { stdio: 'ignore', timeout: 5000 });
    try {
      return execFileSync('which', [name], { encoding: 'utf-8', timeout: 5000 }).trim();
    } catch {
      try {
        return execFileSync('where', [name], { encoding: 'utf-8', timeout: 5000 }).trim().split('\n')[0]?.trim() ?? null;
      } catch {
        return name; // Works via PATH even without absolute resolution
      }
    }
  } catch {
    return null;
  }
}

/** Validate that a project path is safe to use as a CWD. */
function validateProjectPath(projectPath: string): string {
  const resolved = resolve(projectPath);

  try {
    const stat = statSync(resolved);
    if (!stat.isDirectory()) {
      throw new Error(`Invalid project path: not a directory`);
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Invalid project path')) throw err;
    throw new Error(`Invalid project path: does not exist`);
  }

  return resolved;
}

function sendMessage(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === 1) { // WebSocket.OPEN
    ws.send(JSON.stringify(msg));
  }
}

export class TerminalManager {
  private sessions = new Map<string, TerminalSession>();
  private runnerPaths = new Map<Runner, string>();
  private nodePtyModule: NodePtyModule | null = null;
  private nodePtyAvailable: boolean | null = null;
  private startedAt = Date.now();

  constructor() {
    // Resolve all runner CLI paths at startup
    for (const [runner, binary] of Object.entries(RUNNER_BINARIES)) {
      const path = resolveCLIPath(binary);
      if (path) this.runnerPaths.set(runner as Runner, path);
    }
  }

  /** Lazy-load node-pty on first use. */
  private async loadNodePty(): Promise<NodePtyModule> {
    if (this.nodePtyModule) return this.nodePtyModule;
    try {
      this.nodePtyModule = await import('node-pty');
      this.nodePtyAvailable = true;
      return this.nodePtyModule;
    } catch {
      this.nodePtyAvailable = false;
      throw new Error('node-pty is not available. Install it with: npm install node-pty');
    }
  }

  async create(prompt: string, projectPath: string, runner: Runner = 'claude'): Promise<CreateResponse> {
    const activeSessions = Array.from(this.sessions.values()).filter(s => s.status !== 'terminated').length;
    if (activeSessions >= MAX_SESSIONS) {
      throw new Error(`Maximum ${MAX_SESSIONS} concurrent sessions. Kill an existing session first.`);
    }

    const cliPath = this.runnerPaths.get(runner);
    if (!cliPath) {
      throw new Error(`${runner} CLI not found. Install it first.`);
    }

    const validatedPath = validateProjectPath(projectPath);
    const nodePty = await this.loadNodePty();

    const id = randomUUID();
    const args = prompt ? [prompt] : [];

    const pty = nodePty.spawn(cliPath, args, {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: validatedPath,
    });

    const session: TerminalSession = {
      id,
      status: 'active',
      createdAt: new Date().toISOString(),
      projectPath: validatedPath,
      runner,
      lastInputAt: Date.now(),
      pty,
      ws: null,
      idleTimer: null,
    };

    pty.onExit(({ exitCode, signal }) => {
      session.status = 'terminated';
      if (session.ws) {
        sendMessage(session.ws, { type: 'exit', code: exitCode, signal: signal?.toString() ?? null });
      }
      this.clearIdleTimer(session);
    });

    this.sessions.set(id, session);
    this.resetIdleTimer(session);

    return {
      id,
      status: session.status,
      wsUrl: `/ws/terminal/${id}`,
    };
  }

  attachWebSocket(id: string, ws: WebSocket): void {
    const session = this.sessions.get(id);
    if (!session || session.status === 'terminated') {
      sendMessage(ws, { type: 'error', message: 'Session not found or already terminated' });
      ws.close();
      return;
    }

    session.ws = ws;

    session.pty!.onData((data: string) => {
      sendMessage(ws, { type: 'output', data });
    });

    ws.on('message', (raw: Buffer | string) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf-8')) as ClientMessage;
      } catch {
        sendMessage(ws, { type: 'error', message: 'Invalid JSON' });
        return;
      }

      if (msg.type === 'input') {
        session.lastInputAt = Date.now();
        this.resetIdleTimer(session);
        session.pty!.write(msg.data);
      } else if (msg.type === 'resize') {
        session.pty!.resize(msg.cols, msg.rows);
      }
    });

    ws.on('close', () => {
      session.ws = null;
      this.killSession(session);
    });
  }

  get(id: string): SessionInfo | null {
    const session = this.sessions.get(id);
    if (!session) return null;
    return this.toInfo(session);
  }

  kill(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    this.killSession(session);
    return true;
  }

  list(): SessionInfo[] {
    return Array.from(this.sessions.values())
      .filter(s => s.status !== 'terminated')
      .map(s => this.toInfo(s));
  }

  async health(): Promise<HealthResponse> {
    // Probe node-pty availability on first health check
    if (this.nodePtyAvailable === null) {
      try { await this.loadNodePty(); } catch { /* sets nodePtyAvailable = false */ }
    }
    return {
      uptime: Math.floor((Date.now() - this.startedAt) / 1000),
      activeSessions: Array.from(this.sessions.values()).filter(s => s.status === 'active').length,
      nodePtyAvailable: this.nodePtyAvailable ?? false,
      availableRunners: Array.from(this.runnerPaths.keys()),
    };
  }

  shutdown(): void {
    for (const session of this.sessions.values()) {
      if (session.ws) {
        sendMessage(session.ws, { type: 'shutdown' });
      }
      this.killSession(session);
    }
  }

  private killSession(session: TerminalSession): void {
    this.clearIdleTimer(session);
    if (session.pty && session.status !== 'terminated') {
      session.status = 'terminated';
      try { session.pty.kill(); } catch { /* already dead */ }
    }
    if (session.ws) {
      try { session.ws.close(); } catch { /* already closed */ }
      session.ws = null;
    }
  }

  private resetIdleTimer(session: TerminalSession): void {
    this.clearIdleTimer(session);
    session.idleTimer = setTimeout(() => {
      if (session.ws) {
        sendMessage(session.ws, { type: 'error', message: 'Session killed: idle timeout (30 min)' });
      }
      this.killSession(session);
    }, IDLE_TIMEOUT_MS);
  }

  private clearIdleTimer(session: TerminalSession): void {
    if (session.idleTimer) {
      clearTimeout(session.idleTimer);
      session.idleTimer = null;
    }
  }

  private toInfo(session: TerminalSession): SessionInfo {
    return {
      id: session.id,
      status: session.status,
      createdAt: session.createdAt,
      projectPath: session.projectPath,
      runner: session.runner,
    };
  }
}

export { resolveCLIPath, validateProjectPath };
