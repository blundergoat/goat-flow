// WS message envelopes (discriminated union on `type`)

export type ClientMessage =
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number };

export type ServerMessage =
  | { type: 'output'; data: string }
  | { type: 'exit'; code: number; signal: string | null }
  | { type: 'error'; message: string }
  | { type: 'shutdown' };

export type SessionStatus = 'starting' | 'active' | 'terminated';

/** Supported CLI runners that can be spawned in a terminal session. */
export type Runner = 'claude' | 'codex' | 'gemini';

export interface SessionInfo {
  id: string;
  status: SessionStatus;
  createdAt: string;
  projectPath: string;
  runner: Runner;
}

export interface CreateResponse {
  id: string;
  status: SessionStatus;
  wsUrl: string;
}

export interface HealthResponse {
  uptime: number;
  activeSessions: number;
  nodePtyAvailable: boolean;
  availableRunners: Runner[];
}
