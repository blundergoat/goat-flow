/**
 * Types for the `goat-flow audit` command.
 * Audit validates setup correctness (build checks) and optionally scores
 * project quality (--harness) grouped by harness concerns.
 */
import type {
  AgentFacts,
  AgentId,
  ProjectFacts,
  ReadonlyFS,
} from "../types.js";
import type { LoadedConfig } from "../config/types.js";

// === JSON contract types (stable public API) ===

export interface AuditFailure {
  check: string;
  message: string;
  evidence?: string;
  howToFix?: string;
}

export interface CheckResult {
  id: string;
  name: string;
  status: "pass" | "fail";
  failure?: AuditFailure;
}

export interface AuditScope {
  status: "pass" | "fail";
  checks: CheckResult[];
  failures: AuditFailure[];
  summary: Record<string, string>;
  /** Percentage score (0-100) for scored scopes like harness */
  score?: number;
}

export interface AuditConcern {
  score: number;
  findings: string[];
  recommendations: string[];
  howToFix: string[];
}

export type AuditConcernKey =
  | "context"
  | "constraints"
  | "verification"
  | "recovery"
  | "feedback_loop";

export interface AuditReport {
  command: "audit";
  quality: boolean;
  status: "pass" | "fail";
  target: string;
  scopes: {
    setup: AuditScope;
    harness: AuditScope;
  };
  concerns: Record<AuditConcernKey, AuditConcern> | null;
  overall: {
    status: "pass" | "fail";
    grade: string | null;
    qualityScore: number | null;
  };
}

// === Internal types (check definitions and context) ===

/** Parsed subset of project-structure.json used by audit checks */
export interface ProjectStructure {
  required_files: string[];
  required_dirs: string[];
  skills: {
    canonical: string[];
    stale_names: string[];
    stale_generic: string[];
  };
  agents: Record<
    string,
    {
      instruction_file: string;
      skills_dir: string;
      hooks_dir?: string;
      settings?: string;
      hooks?: string[];
    }
  >;
}

/** Context passed to build and quality check functions */
export interface AuditContext {
  projectPath: string;
  facts: ProjectFacts;
  config: LoadedConfig;
  fs: ReadonlyFS;
  structure: ProjectStructure;
  agents: AgentFacts[];
  agentFilter: AgentId | null;
}

export type AuditScopeName = "setup" | "harness";

/** A single build check that returns null on pass or a failure on fail */
export interface BuildCheck {
  id: string;
  name: string;
  scope: AuditScopeName;
  run: (ctx: AuditContext) => AuditFailure | null;
}

/** A single quality check that contributes to a concern score */
export interface QualityCheck {
  id: string;
  concern: AuditConcernKey;
  weight: number;
  run: (ctx: AuditContext) => QualityCheckResult;
}

export interface QualityCheckResult {
  score: number;
  findings: string[];
  recommendations: string[];
  howToFix?: string[];
}
