/**
 * Ambient audit and hook contracts consumed by dashboard browser scripts.
 * Use when Audit, Home, or Hooks UI payloads add fields users can inspect.
 * These declarations stay import-free so every classic dashboard script shares
 * the same API shapes without pulling CLI-only code into the browser build.
 */

type AuditStatus = "pass" | "fail" | "skipped";
type AuditDisplayStatus = "pass" | "fail" | "warn" | "info" | "skipped";
type AuditCheckType = "integrity" | "advisory" | "metric";
type AuditCheckImpact = "none" | "scope-fail" | "score-only";
type AuditCheckEvidenceKind = "semantic" | "structural";
type AuditCheckAssurance = "full" | "limited";
type EnforcementCapabilityStatus =
  "hard" | "limited" | "soft" | "missing" | "unknown";
type EnforcementCapabilitySource =
  | "local-settings"
  | "local-hook"
  | "runtime-self-test"
  | "manifest"
  | "provider-docs"
  | "not-observed";
type EnforcementCapabilityAssurance =
  | "runtime-local"
  | "static-local"
  | "manifest-declared"
  | "provider-documented"
  | "not-observed";

// ---------------------------------------------------------------------------
// Audit API response types
// ---------------------------------------------------------------------------

/** Failure entry returned by the audit API for a failed check. */
interface AuditFailure {
  check: string;
  message: string;
  evidence?: string;
  howToFix?: string;
}

/** Evidence provenance emitted for each registered audit check. */
interface AuditCheckProvenance {
  source_type:
    "spec" | "vendor_docs" | "paper" | "incident" | "community" | "unknown";
  source_urls: string[];
  verified_on: string;
  normative_level: "MUST" | "SHOULD" | "BEST_PRACTICE";
  evidence_paths?: string[];
  framework_evidence_paths?: string[];
  target_evidence_paths?: string[];
  reason?: string;
}

/** Structured harness detail payloads are forwarded verbatim for dashboard pages. */
type AuditCheckDetails = Record<string, unknown>;

/** Individual check result inside an audit scope. */
interface AuditCheck {
  id: string;
  name: string;
  status: AuditStatus;
  displayStatus: AuditDisplayStatus;
  impact: AuditCheckImpact;
  provenance: AuditCheckProvenance;
  type?: AuditCheckType;
  acknowledged?: boolean;
  evidenceKind?: AuditCheckEvidenceKind;
  assurance?: AuditCheckAssurance;
  failure?: AuditFailure;
  details?: AuditCheckDetails;
}

/** Audit scope as returned by the /api/audit endpoint. */
interface AuditScope {
  status: AuditStatus;
  checks: AuditCheck[];
  failures: AuditFailure[];
  summary: Record<string, string>;
}

/** Concern data from the harness completeness audit. */
interface AuditConcern {
  status: AuditStatus;
  score: number;
  findings: string[];
  limits: string[];
  recommendations: string[];
  howToFix: string[];
  integrityPass: number;
  integrityFail: number;
  advisoryPass: number;
  advisoryFail: number;
  advisoryAcknowledged: number;
  metrics: number;
}

/** One advisory enforcement matrix row for an agent. */
interface EnforcementCapability {
  id: string;
  label: string;
  status: EnforcementCapabilityStatus;
  sources: EnforcementCapabilitySource[];
  assurance: EnforcementCapabilityAssurance;
  summary: string;
  evidence: string[];
}

/** Per-agent advisory enforcement matrix. */
interface AgentEnforcementCapability {
  agent: RunnerId;
  name: string;
  advisory: true;
  capabilities: EnforcementCapability[];
  summary: Record<EnforcementCapabilityStatus, number>;
}

/** Per-agent audit summary shown on the Home and Audit views. */
interface AgentScore {
  id: RunnerId;
  name: string;
  agent: AuditScope;
  harness: AuditScope | null;
  concerns: Record<string, AuditConcern> | null;
  enforcement: AgentEnforcementCapability | null;
}

/** Named audit scopes included in the dashboard report payload. */
interface DashboardClientScopes {
  setup: AuditScope;
  agent: AuditScope;
  harness?: AuditScope;
}

/** Generated learning-loop index state for one bucket. */
interface LearningLoopIndexFreshness {
  bucket: string;
  dirPath: string;
  indexPath: string;
  state: "fresh" | "stale" | "missing" | "no-bucket";
  entryCount: number;
}

/** Dashboard audit report returned by `/api/audit`. */
interface DashboardClientReport {
  agentScores: AgentScore[];
  status: AuditStatus;
  scopes: DashboardClientScopes;
  overall: { status: AuditStatus };
  learningLoop: {
    recordCount: number;
    footgunCount: number;
    lessonCount: number;
    staleCount: number;
    invalidLineRefCount: number;
    oversizedCount: number;
    indexes: LearningLoopIndexFreshness[];
    indexStaleCount: number;
    indexMissingCount: number;
    oldestLastReviewed: string | null;
    topBucketsNeedingAction: { path: string; reason: string }[];
    status: "fresh" | "needs-review" | "unavailable";
  } | null;
  recentLessons: RecentLesson[];
  target: string;
}

/** Compact lesson row shown on the Home page. */
interface RecentLesson {
  id: string;
  title: string;
  created: string | null;
  path: string;
}

// ---------------------------------------------------------------------------
// Hook API response types
// ---------------------------------------------------------------------------

type HookDrift = "desired-on-actual-off" | "desired-off-actual-on";
type HookEffectiveStatus =
  | "disabled"
  | "provider-undocumented"
  | "provider-documentation-stale"
  | "provider-documented-unsupported"
  | "provider-capture-absent"
  | "provider-capture-stale"
  | "provider-capture-untrusted"
  | "provider-capture-inconclusive"
  | "provider-live-unsupported"
  | "not-registered"
  | "installation-stale"
  | "runtime-untrusted"
  | "not-observed"
  | "result-undelivered"
  | "scenario-unverified"
  | "effective";
type HookEffectiveSeverity = "neutral" | "warning" | "danger" | "success";
type HookRegistrationIssue =
  | "registration-missing"
  | "duplicate-registration"
  | "retired-registration"
  | "event-mismatch"
  | "matcher-mismatch"
  | "command-or-response-mismatch"
  | "timeout-mismatch";
type HookInstallationIssue =
  | "managed-files-missing"
  | "installed-version-mismatch"
  | "managed-path-untrusted";

/** Per-agent desired-to-effective hook chain delivered to the browser. */
interface HookAgentState extends Record<"supported", boolean> {
  installed: boolean;
  isRegistered: boolean;
  isCurrentVersionInstalled: boolean;
  isTrusted: boolean;
  registrationIssue: HookRegistrationIssue | null;
  installationIssue: HookInstallationIssue | null;
  effectiveState: {
    status: HookEffectiveStatus;
    severity: HookEffectiveSeverity;
  };
  effectiveStateLabel: string;
  evidenceIdentity: string | null;
  repairCommand: string | null;
  repairSummary: string;
  scriptPath: string | null;
  configPath: string | null;
  drift?: HookDrift;
  reason?: string;
}

/** Browser-side hook state used by the Hooks view and confirmation dialog. */
interface HookState extends Record<"togglable" | "enabled", boolean> {
  id: string;
  name: string;
  description: string;
  defaultEnabled: boolean;
  requiresConfirmDialog: boolean;
  agents: Partial<Record<RunnerId, HookAgentState>>;
}
