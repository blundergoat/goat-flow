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
export type Runner = "claude" | "codex" | "gemini" | "copilot";

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

/** Response body from the POST /api/sessions endpoint. */
export interface CreateResponse {
  id: string;
  status: SessionStatus;
  /** WebSocket URL for streaming terminal I/O */
  wsUrl: string;
}

// === Dashboard audit response ===

/** Per-agent scoring summary consumed by the Home page agent cards. */
export interface DashboardAgentSummary {
  agent: string;
  agentName: string;
  score: {
    grade: string;
    percentage: number;
    earned: number;
    available: number;
    tiers: Record<string, { percentage: number; available: number }>;
  };
  checks: { id: string; status: string; hidden?: boolean }[];
  antiPatterns: { id: string; triggered: boolean; deduction: number }[];
  recommendations: { priority: string; message: string }[];
}

/** Combined response from /api/audit consumed by all dashboard views.
 * Merges per-agent scoring (Home page) with scope-based audit results (Audit detail). */
export interface DashboardReport {
  // Per-agent scoring — Home page agent cards, banner counts
  agents: DashboardAgentSummary[];
  // Per-agent AI Harness Score — Home page agent cards
  agentScores: {
    id: string;
    name: string;
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
      score?: number;
    };
  }[];
  // Scope-based audit — Audit detail view
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
      score?: number;
    }
  >;
  overall: {
    status: string;
    grade: string | null;
    qualityScore: number | null;
  };
  concerns: Record<
    string,
    {
      score: number;
      findings: string[];
      recommendations: string[];
      howToFix?: string[];
    }
  > | null;
  // Metadata
  rubricVersion: string;
  packageVersion: string;
  target: string;
  // Stack detection — Wizard view
  stack?: { languages?: string[] };
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
