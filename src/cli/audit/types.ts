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
import type { CheckEvidence } from "./provenance-types.js";

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
  status: "pass" | "fail" | "skipped";
  provenance: CheckEvidence;
  failure?: AuditFailure;
  /** Harness-check classification; absent for build checks. */
  type?: HarnessCheckType;
  /** True when an advisory failure is silenced by `harness.acknowledge` in config. */
  acknowledged?: boolean;
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
  /** Count of passing integrity checks. */
  integrityPass: number;
  /** Count of failing integrity checks. */
  integrityFail: number;
  /** Count of passing advisory checks. */
  advisoryPass: number;
  /** Count of failing advisory checks that are not acknowledged in config. */
  advisoryFail: number;
  /** Count of failing advisory checks silenced by `harness.acknowledge`. */
  advisoryAcknowledged: number;
  /** Count of metric checks (never scored, always informational). */
  metrics: number;
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
  /** Drift section, populated when --check-drift is set. */
  drift: DriftReport | null;
  /** Content-lint section, populated when --check-content is set. */
  content: ContentReport | null;
  overall: {
    status: "pass" | "fail";
  };
}

// === Drift check (M04) ===

export type DriftFindingKind = "content" | "missing" | "orphan" | "deprecated";

export interface DriftFinding {
  kind: DriftFindingKind;
  path: string;
  message: string;
}

export interface DriftReport {
  status: "pass" | "fail";
  findings: DriftFinding[];
  checked: number;
}

// === Content lint (M05) ===

/** WARNING findings fail the content scope; INFO findings are advisory. */
export type ContentSeverity = "info" | "warning";

export interface ContentFinding {
  severity: ContentSeverity;
  /** Stable rule id (e.g. "vague-term", "skill-count-drift"). */
  rule: string;
  /** File path relative to project root. */
  path: string;
  /** 1-indexed line number if applicable. */
  line?: number;
  message: string;
  /** Actionable suggestion when available (e.g. "Use 'consistent 2-space indentation' instead of 'format properly'"). */
  suggestion?: string;
}

export interface ContentReport {
  status: "pass" | "fail";
  findings: ContentFinding[];
  warnings: number;
  infos: number;
  /** Number of target files scanned. */
  filesScanned: number;
}

// === Internal types (check definitions and context) ===

/** Parsed subset of manifest.json used by audit checks */
export interface ProjectStructure {
  required_files: string[];
  required_dirs: string[];
  skills: {
    canonical: string[];
    stale_names: string[];
    references?: Record<string, string[]>;
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
  provenance: CheckEvidence;
  /** Optional context-specific provenance when one check covers per-agent rules. */
  provenanceFor?: (
    ctx: AuditContext,
    failure: AuditFailure | null,
  ) => CheckEvidence;
  /** True when an agent-scope check runs meaningful logic in aggregate mode. */
  supportsAggregate?: boolean;
  run: (ctx: AuditContext) => AuditFailure | null;
}

/**
 * Harness check classification (M01):
 * - `integrity`: drift from install state; failing integrity gates concern status.
 * - `advisory`: best practice; failing advisory gates concern status unless
 *   the check id is listed in `harness.acknowledge` in config.yaml.
 * - `metric`: workflow maturity signal; never affects status.
 */
export type HarnessCheckType = "integrity" | "advisory" | "metric";

/** A single harness completeness check (deterministic pass/fail) */
export interface HarnessCheck {
  id: string;
  name: string;
  concern: AuditConcernKey;
  type: HarnessCheckType;
  provenance: CheckEvidence;
  run: (ctx: AuditContext) => HarnessCheckResult;
}

export interface HarnessCheckResult {
  status: "pass" | "fail";
  findings: string[];
  recommendations: string[];
  howToFix?: string[];
}
