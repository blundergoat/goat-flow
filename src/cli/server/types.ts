/**
 * Shared wire types for dashboard terminal sessions.
 * Both the HTTP/WebSocket server and the frontend rely on these discriminated unions staying in sync.
 */
/** Messages sent from the browser terminal to the WebSocket server. */
export type ClientMessage =
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number };

/** Messages sent from the WebSocket server to the browser terminal. */
export type ServerMessage =
  | { type: "output"; data: string }
  | { type: "exit"; code: number; signal: string | null }
  | { type: "error"; message: string }
  | { type: "shutdown" };

/** Lifecycle state of a terminal session. */
export type SessionStatus = "starting" | "active" | "terminated";

/** Supported CLI runners that can be spawned in a terminal session. */
export type Runner = "claude" | "codex" | "gemini";

/** Metadata for an active or recently terminated terminal session. */
export interface SessionInfo {
  id: string;
  status: SessionStatus;
  createdAt: string;
  projectPath: string;
  runner: Runner;
  /** Epoch milliseconds of last user input (for idle duration calculation) */
  lastInputAt: number;
}

/** Response body from the POST /api/terminal/create endpoint. */
export interface CreateResponse {
  id: string;
  status: SessionStatus;
  /** WebSocket URL for streaming terminal I/O */
  wsUrl: string;
}

// === Dashboard audit response ===

/** Combined response from /api/audit consumed by all dashboard views. */
export interface DashboardReport {
  // Per-agent AI Harness Completeness - Audit view agent cards
  agentScores: {
    id: string;
    name: string;
    agent: {
      status: string;
      checks: {
        id: string;
        name: string;
        status: string;
        failure?: { check: string; message: string; howToFix?: string };
      }[];
      failures: { check: string; message: string; howToFix?: string }[];
      summary: Record<string, string>;
    };
    harness: {
      status: string;
      checks: {
        id: string;
        name: string;
        status: string;
        failure?: { check: string; message: string; howToFix?: string };
      }[];
      failures: { check: string; message: string; howToFix?: string }[];
      summary: Record<string, string>;
    } | null;
    concerns: Record<
      string,
      {
        status: "pass" | "fail";
        score: number;
        findings: string[];
        recommendations: string[];
        howToFix?: string[];
      }
    > | null;
  }[];
  // Scope-based audit - Audit detail view
  status: "pass" | "fail";
  scopes: Record<
    string,
    {
      status: string;
      checks: {
        id: string;
        name: string;
        status: string;
        failure?: { check: string; message: string; howToFix?: string };
      }[];
      failures: { check: string; message: string; howToFix?: string }[];
      summary: Record<string, string>;
    }
  >;
  overall: {
    status: string;
  };
  // Metadata
  target: string;
}

/** Response body from the GET /api/health endpoint. */
export interface HealthResponse {
  /** Server uptime in seconds */
  uptime: number;
  activeSessions: number;
  /** Whether node-pty compiled successfully and is available */
  nodePtyAvailable: boolean;
  /** CLI runners detected on the system PATH */
  availableRunners: Runner[];
}
