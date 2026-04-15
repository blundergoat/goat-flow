/**
 * Types for the `goat-flow audit` command.
 * Audit validates setup correctness (build checks) and optionally checks
 * AI harness completeness (--harness) grouped by harness concerns.
 *
 * Wording: audit = deterministic integrity/completeness. Never "quality" or "score".
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
}

export interface AuditConcern {
  status: "pass" | "fail";
  /** Percentage of passing checks for this concern (0-100). */
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
  harness: boolean;
  status: "pass" | "fail";
  target: string;
  scopes: {
    setup: AuditScope;
    agent: AuditScope;
    harness: AuditScope | null;
  };
  concerns: Record<AuditConcernKey, AuditConcern> | null;
  overall: {
    status: "pass" | "fail";
  };
}

// === Internal types (check definitions and context) ===

/** Parsed subset of manifest.json used by audit checks */
export interface ProjectStructure {
  required_files: string[];
  required_dirs: string[];
  skills: {
    canonical: string[];
    stale_names: string[];
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

/** Context passed to build and harness check functions */
export interface AuditContext {
  projectPath: string;
  facts: ProjectFacts;
  config: LoadedConfig;
  fs: ReadonlyFS;
  structure: ProjectStructure;
  agents: AgentFacts[];
  agentFilter: AgentId | null;
}

export type AuditScopeName = "setup" | "agent";

/** A single build check that returns null on pass or a failure on fail */
export interface BuildCheck {
  id: string;
  name: string;
  scope: AuditScopeName;
  run: (ctx: AuditContext) => AuditFailure | null;
}

/** A single harness completeness check (deterministic pass/fail) */
export interface HarnessCheck {
  id: string;
  name: string;
  concern: AuditConcernKey;
  run: (ctx: AuditContext) => HarnessCheckResult;
}

export interface HarnessCheckResult {
  status: "pass" | "fail";
  findings: string[];
  recommendations: string[];
  howToFix?: string[];
}
