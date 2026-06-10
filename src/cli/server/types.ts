/**
 * Shared wire types for dashboard terminal sessions.
 * Both the HTTP/WebSocket server and the frontend rely on these discriminated unions staying in sync.
 */
import type { CheckEvidence } from "../audit/provenance-types.js";
import type {
  CheckAssurance,
  CheckDisplayStatus,
  CheckEvidenceKind,
  CheckImpact,
  HarnessCheckType,
} from "../audit/types.js";
import type { IndexFreshness } from "../stats/index-freshness.js";
import type { AgentId } from "../types.js";
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
export type Runner = AgentId;

/** Metadata for an active or recently terminated terminal session. */
export interface SessionInfo {
  id: string;
  status: SessionStatus;
  createdAt: string;
  /** Selected target project for code evidence and dashboard grouping. */
  projectPath: string;
  /** Actual PTY working directory where the runner was spawned. */
  cwd: string;
  /** Explicit target project path passed to the launched agent. */
  targetPath: string;
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
        status: "pass" | "fail" | "skipped";
        displayStatus: CheckDisplayStatus;
        impact: CheckImpact;
        type?: HarnessCheckType;
        evidenceKind?: CheckEvidenceKind | undefined;
        assurance?: CheckAssurance | undefined;
        acknowledged?: boolean | undefined;
        provenance: CheckEvidence;
        failure?:
          | {
              check: string;
              message: string;
              evidence?: string | undefined;
              howToFix?: string | undefined;
            }
          | undefined;
      }[];
      failures: {
        check: string;
        message: string;
        evidence?: string | undefined;
        howToFix?: string | undefined;
      }[];
      summary: Record<string, string>;
    };
    harness: {
      status: string;
      checks: {
        id: string;
        name: string;
        status: "pass" | "fail" | "skipped";
        displayStatus: CheckDisplayStatus;
        impact: CheckImpact;
        type?: HarnessCheckType;
        evidenceKind?: CheckEvidenceKind | undefined;
        acknowledged?: boolean | undefined;
        provenance: CheckEvidence;
        failure?:
          | {
              check: string;
              message: string;
              evidence?: string | undefined;
              howToFix?: string | undefined;
            }
          | undefined;
      }[];
      failures: {
        check: string;
        message: string;
        evidence?: string | undefined;
        howToFix?: string | undefined;
      }[];
      summary: Record<string, string>;
    } | null;
    concerns: Record<
      string,
      {
        status: "pass" | "fail";
        score: number;
        findings: string[];
        limits: string[];
        recommendations: string[];
        howToFix?: string[];
        integrityPass: number;
        integrityFail: number;
        advisoryPass: number;
        advisoryFail: number;
        advisoryAcknowledged: number;
        metrics: number;
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
        status: "pass" | "fail" | "skipped";
        displayStatus?: CheckDisplayStatus;
        impact?: CheckImpact;
        type?: HarnessCheckType;
        acknowledged?: boolean | undefined;
        evidenceKind?: CheckEvidenceKind | undefined;
        assurance?: CheckAssurance | undefined;
        provenance: CheckEvidence;
        failure?:
          | {
              check: string;
              message: string;
              evidence?: string | undefined;
              howToFix?: string | undefined;
            }
          | undefined;
      }[];
      failures: {
        check: string;
        message: string;
        evidence?: string | undefined;
        howToFix?: string | undefined;
      }[];
      summary: Record<string, string>;
    }
  >;
  overall: {
    status: string;
  };
  learningLoop: {
    recordCount: number;
    footgunCount: number;
    lessonCount: number;
    staleCount: number;
    invalidLineRefCount: number;
    oversizedCount: number;
    indexes: (IndexFreshness & { entryCount: number })[];
    indexStaleCount: number;
    indexMissingCount: number;
    oldestLastReviewed: string | null;
    topBucketsNeedingAction: { path: string; reason: string }[];
    status: "fresh" | "needs-review" | "unavailable";
  } | null;
  recentLessons: {
    id: string;
    title: string;
    created: string | null;
    path: string;
  }[];
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
  /** Host platform for install guidance when node-pty is unavailable */
  platformHint?: "linux" | "darwin" | "win32" | undefined;
  /** Configured idle timeout in minutes (0 = never) */
  idleTimeoutMinutes: number;
}
