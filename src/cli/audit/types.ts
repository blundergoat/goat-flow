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
import type { AgentEnforcementCapability } from "./enforcement.js";
import type { CheckEvidence } from "./provenance-types.js";

// === JSON contract types (stable public API) ===

/** User-facing failure detail carried by failed checks and renderer outputs. */
export interface AuditFailure {
  check: string;
  message: string;
  evidence?: string | undefined;
  howToFix?: string | undefined;
}

/** Stable per-check JSON shape consumed by CLI renderers, dashboard readers, and SARIF. */
export interface CheckResult {
  id: string;
  name: string;
  status: "pass" | "fail" | "skipped";
  /** UI-oriented status. Metric and acknowledged failures render as warnings, not hard failures. */
  displayStatus: CheckDisplayStatus;
  /** Whether this result affects audit status, concern score only, or neither. */
  impact: CheckImpact;
  provenance: CheckEvidence;
  failure?: AuditFailure | undefined;
  /** Harness-check classification; absent for build checks. */
  type?: HarnessCheckType;
  /** True when an advisory failure is silenced by `harness.acknowledge` in config. */
  acknowledged?: boolean | undefined;
  /** Evidence strength label for smoke checks that prove structure, not content semantics. */
  evidenceKind?: CheckEvidenceKind | undefined;
  /** Assurance label for checks that pass with a known platform limitation. */
  assurance?: CheckAssurance | undefined;
  /** Structured per-check detail. Forwarded verbatim from
   *  `HarnessCheckResult.details`; absent for build checks and for harness
   *  checks that haven't been extended yet. */
  details?: HarnessCheckDetails | undefined;
}

/** Scope aggregate plus the original checks used to build it. */
export interface AuditScope {
  status: "pass" | "fail";
  checks: CheckResult[];
  failures: AuditFailure[];
  summary: Record<string, string>;
}

/** Harness concern rollup for one of the five goat-flow design concerns. */
export interface AuditConcern {
  status: "pass" | "fail";
  /** Percentage of passing checks for this concern (0-100). */
  score: number;
  findings: string[];
  /** Non-gating evidence limits that keep a PASS from being read as complete assurance. */
  limits: string[];
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
  /** Count of metric checks (score-only; never fails concern status). */
  metrics: number;
}

/** Canonical five-concern keys used by harness audit rollups. */
export type AuditConcernKey =
  | "context"
  | "constraints"
  | "verification"
  | "recovery"
  | "feedback_loop";

/** Stable `harness` JSON field retained for existing CLI and dashboard consumers. */
type AuditHarnessJsonField = Record<"harness", boolean>;

/** Top-level audit JSON schema returned by CLI and dashboard audit routes. */
export interface AuditReport extends AuditHarnessJsonField {
  command: "audit";
  status: "pass" | "fail";
  target: string;
  scopes: {
    setup: AuditScope;
    agent: AuditScope;
    harness: AuditScope | null;
  };
  concerns: Record<AuditConcernKey, AuditConcern> | null;
  /** Advisory per-agent enforcement capability matrix. Does not affect status. */
  enforcement: AgentEnforcementCapability[];
  /** Drift section, populated when --check-drift is set. */
  drift: DriftReport | null;
  /** Content-lint section, populated when --check-content is set. */
  content: ContentReport | null;
  overall: {
    status: "pass" | "fail";
  };
}

/** Renderer-facing status; warnings and info do not always change audit status. */
export type CheckDisplayStatus = "pass" | "fail" | "warn" | "info" | "skipped";

/** Status impact category that separates hard failures from score-only signals. */
export type CheckImpact = "none" | "scope-fail" | "score-only";

/** Evidence precision label for checks that prove structure versus semantics. */
export type CheckEvidenceKind = "semantic" | "structural";

/** Assurance label for passes that are correct but limited by platform evidence. */
export type CheckAssurance = "full" | "limited";

// === Drift check ===

type DriftFindingKind = "content" | "missing" | "orphan" | "deprecated";

/** One installed-vs-template skill drift finding. */
export interface DriftFinding {
  kind: DriftFindingKind;
  path: string;
  message: string;
}

/** Optional drift section populated only when `--check-drift` runs. */
export interface DriftReport {
  status: "pass" | "fail";
  findings: DriftFinding[];
  checked: number;
}

// === Content lint ===

/** WARNING findings fail the content scope; INFO findings are advisory. */
export type ContentSeverity = "info" | "warning";

/** One cold-path content lint finding; invariant: rule/path/line identify the source issue. */
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

/** Optional content-lint section populated only when `--check-content` runs. */
export interface ContentReport {
  status: "pass" | "fail";
  findings: ContentFinding[];
  warnings: number;
  infos: number;
  /** Number of target files scanned. */
  filesScanned: number;
}

// === Internal types (check definitions and context) ===

/** Fact extraction depth used to trade check fidelity for dashboard speed. */
export type AuditFactProfile = "full" | "dashboard-summary";

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
  /** Fact extraction profile backing this context. Summary contexts omit stack facts. */
  factProfile?: AuditFactProfile;
  /** Optional downgrade for expensive per-agent summary checks used by dashboard routes. */
  denyMechanismEvidenceLevel?: "full" | "static" | "present-only" | undefined;
}

/** Build-check scopes that exist before optional harness checks are requested. */
export type AuditScopeName = "setup" | "agent";

/** A single build check that returns null on pass or a failure on fail */
export interface BuildCheck {
  id: string;
  name: string;
  scope: AuditScopeName;
  provenance: CheckEvidence;
  /** Evidence strength label exposed to dashboard/detail renderers. */
  evidenceKind?: CheckEvidenceKind;
  /** Optional context-specific provenance when one check covers per-agent rules. */
  provenanceFor?: (
    ctx: AuditContext,
    failure: AuditFailure | null,
  ) => CheckEvidence;
  /** True when an agent-scope check runs meaningful logic in aggregate mode. */
  supportsAggregate?: boolean;
  /** True when the check reads `ctx.facts.stack` and must run only with full facts. */
  requiresStack?: boolean;
  /** Return true when the check is intentionally not applicable for this context. */
  skip?: (ctx: AuditContext) => boolean;
  run: (ctx: AuditContext) => AuditFailure | null;
}

/**
 * Harness check classification:
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
  /** Evidence strength label exposed to dashboard/detail renderers. */
  evidenceKind?: CheckEvidenceKind;
  /** True when the check reads `ctx.facts.stack` and must run only with full facts. */
  requiresStack?: boolean;
  /** Return true when the harness check is intentionally not applicable. */
  skip?: (ctx: AuditContext) => boolean;
  run: (ctx: AuditContext) => HarnessCheckResult;
}

/** Output from one harness check before it is adapted into a public CheckResult. */
export interface HarnessCheckResult {
  status: "pass" | "fail";
  findings: string[];
  recommendations: string[];
  howToFix?: string[];
  /** Optional UI-oriented status override for passing limited-assurance checks. */
  displayStatus?: CheckDisplayStatus;
  /** Optional assurance label for checks that pass with caveats. */
  assurance?: CheckAssurance;
  /** Non-gating caveats surfaced at the concern level. */
  limits?: string[];
  /** Structured per-check detail for dashboard consumers. Discriminated by
   *  the parent `HarnessCheck.id`; each consuming page reads the keys it knows.
   *  Plain-text and markdown audit renderers ignore this block. */
  details?: HarnessCheckDetails;
}

/** Structured per-check detail union. Keyed by `HarnessCheck.id`.
 *  Pages that consume the dashboard `/api/audit` response read the keys for
 *  their concern; unknown keys are ignored. Keep this synced with the per-check
 *  shapes declared by the dashboard audit payload contract. */
export interface HarnessCheckDetails {
  /** instruction-line-count */
  lineCounts?: {
    agent: AgentId;
    actual: number;
    target: number;
    hardLimit: number;
  }[];
  /** execution-loop-present */
  executionLoop?: {
    agent: AgentId;
    found: boolean;
    sectionLabel: string;
    missingSteps: string[];
  }[];
  /** doc-paths-resolve */
  docPaths?: {
    totalPaths: number;
    resolvedCount: number;
    unresolved: { ref: string; source: string }[];
  };
  /** instruction-sections-present */
  sections?: {
    agent: AgentId;
    required: string[];
    present: string[];
    missing: string[];
  }[];
  /** boundary-guidance-present */
  boundary?: {
    agent: AgentId;
    controllingWorkspace: boolean;
    targetWorkspace: boolean;
    boundaryHeading: boolean;
  }[];
  /** deny-covers-secrets / deny-blocks-dangerous / deny-blocks-pipe-to-shell / deny-hook-registered */
  denyMatrix?: {
    agent: AgentId;
    missingPatterns: string[];
    extraPatterns: string[];
    hookRegistered: boolean;
  }[];
  /** hooks-registered / commit-guidance / evidence-before-claims / post-turn-hook-integrity */
  verification?: {
    agent: AgentId;
    reason: string;
    expected?: string;
    actual?: string;
  }[];
  /** milestone-tracking / session-logs */
  recovery?: {
    agent: AgentId;
    dir: string;
    fileCount: number;
    mostRecent?: string;
  }[];
  /** feedback-loop-active / decisions-tracked */
  freshness?: {
    agent: AgentId;
    fresh: number;
    aging: number;
    stale: number;
  }[];
}
