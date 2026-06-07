/**
 * Browser-side payload readers for the dashboard.
 * This is loaded as a classic script before app.js, so helpers intentionally
 * live in the shared browser global scope rather than using module imports.
 */

type JsonRecord = Record<string, unknown>;
const DASHBOARD_TOKEN_PARAM = "token";
const DASHBOARD_TOKEN_HEADER = "X-Goat-Flow-Dashboard-Token";

/** Return the process-local dashboard authorization token injected at boot. */
function dashboardAuthToken(): string {
  return typeof window.__GOAT_FLOW_DASHBOARD_TOKEN__ === "string"
    ? window.__GOAT_FLOW_DASHBOARD_TOKEN__
    : "";
}

/** Fetch a dashboard API route with the current process-local token. */
function dashboardFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const token = dashboardAuthToken();
  if (token) headers.set(DASHBOARD_TOKEN_HEADER, token);
  return fetch(input, { ...init, headers });
}

/** Read a browser File object and return its raw bytes as a base64 string.
 *  Used by the terminal image drop handler so the upload endpoint receives a
 *  JSON payload it can decode without multipart parsing. */
function dashboardFileToBase64(file: File): Promise<string> {
  return new Promise<string>((resolveBase64, rejectBase64) => {
    const reader = new FileReader();
    reader.onerror = () => {
      rejectBase64(reader.error ?? new Error("File read failed"));
    };
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        rejectBase64(new Error("Unexpected file read result"));
        return;
      }
      const comma = result.indexOf(",");
      resolveBase64(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

/** Append the dashboard token to a terminal WebSocket path. */
function dashboardTerminalWsPath(wsPath: string): string {
  const token = dashboardAuthToken();
  if (!token) return wsPath;
  const url = new URL(wsPath, window.location.origin);
  url.searchParams.set(DASHBOARD_TOKEN_PARAM, token);
  return `${url.pathname}${url.search}`;
}

/** Remove the launch token from the visible URL after the boot payload is loaded. */
function dashboardClearLaunchToken(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(DASHBOARD_TOKEN_PARAM)) return;
  url.searchParams.delete(DASHBOARD_TOKEN_PARAM);
  const next =
    url.pathname +
    (url.searchParams.toString() ? `?${url.searchParams.toString()}` : "") +
    url.hash;
  window.history.replaceState(null, "", next);
}

dashboardClearLaunchToken();

/** Treat arrays as invalid records because dashboard API payloads use named fields. */
function isRecord(candidate: unknown): candidate is JsonRecord {
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    !Array.isArray(candidate)
  );
}

/** Read a required object record; throws when a top-level API payload is malformed. */
function readRecord(rawPayload: unknown, context: string): JsonRecord {
  if (!isRecord(rawPayload)) {
    throw new Error(`${context} returned an invalid payload`);
  }
  return rawPayload;
}

/** Read a string value with a safe fallback for invalid payload fields. */
function readString(rawValue: unknown, fallback = ""): string {
  return typeof rawValue === "string" ? rawValue : fallback;
}

/** Read a string array from raw payload data. */
function readStringArray(rawValue: unknown): string[] {
  return Array.isArray(rawValue)
    ? rawValue.filter((entry): entry is string => typeof entry === "string")
    : [];
}

/** Read a `{ [key: string]: string }` map, silently dropping invalid entries. */
function readStringMap(rawValue: unknown): Record<string, string> {
  if (!isRecord(rawValue)) return {};
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawValue)) {
    if (typeof v === "string" && v.length > 0) result[k] = v;
  }
  return result;
}

/** Read an audit status from raw payload data. */
function readAuditStatus(rawValue: unknown): AuditStatus | null {
  return rawValue === "pass" || rawValue === "fail" || rawValue === "skipped"
    ? rawValue
    : null;
}

/** Read a dashboard display status from raw payload data. */
function readAuditDisplayStatus(rawValue: unknown): AuditDisplayStatus | null {
  return rawValue === "pass" ||
    rawValue === "fail" ||
    rawValue === "warn" ||
    rawValue === "info" ||
    rawValue === "skipped"
    ? rawValue
    : null;
}

/** Read a check impact label from raw payload data. */
function readAuditCheckImpact(rawValue: unknown): AuditCheckImpact | null {
  return rawValue === "none" ||
    rawValue === "scope-fail" ||
    rawValue === "score-only"
    ? rawValue
    : null;
}

/** Compute a backward-compatible display status when an older server omits it. */
function defaultDisplayStatus(
  status: AuditStatus,
  type?: AuditCheckType,
  acknowledged = false,
): AuditDisplayStatus {
  if (status === "skipped") return "skipped";
  if (status === "pass") return type === "metric" ? "info" : "pass";
  return type === "metric" || acknowledged ? "warn" : "fail";
}

/** Compute backward-compatible impact when an older server omits it. */
function defaultCheckImpact(
  status: AuditStatus,
  type?: AuditCheckType,
  acknowledged = false,
): AuditCheckImpact {
  if (status !== "fail") return "none";
  return type === "metric" || acknowledged ? "score-only" : "scope-fail";
}

/** Read the runner IDs injected into the dashboard shell. */
function readInjectedRunnerIds(): string[] {
  return Array.isArray(window.__GOAT_FLOW_RUNNER_IDS__)
    ? window.__GOAT_FLOW_RUNNER_IDS__.filter(
        (id): id is string => typeof id === "string",
      )
    : [];
}

/** Read a runner ID from raw payload data. Unknown values narrow to null so
 *  the server's wire contract isn't silently widened to arbitrary strings. */
function readRunnerId(rawValue: unknown): RunnerId | null {
  const runner = readString(rawValue).trim();
  return readInjectedRunnerIds().includes(runner) ? (runner as RunnerId) : null;
}

/** Read prompt invocation style from server-provided runner metadata. */
function readPromptInvocationStyle(
  rawValue: unknown,
): PromptInvocationStyle | null {
  return rawValue === "slash" || rawValue === "dollar" ? rawValue : null;
}

/** Read the source bucket for installed or mirrored runner skills. */
function readSkillSource(rawValue: unknown): SkillSource | null {
  return rawValue === "installed" ||
    rawValue === "agent-mirror" ||
    rawValue === "github-mirror"
    ? rawValue
    : null;
}

/** Build the default setup-agent selection from the injected support list. */
function buildDefaultSetupAgents(
  supportedAgents: SupportedAgent[],
  defaultRunner: RunnerId,
): SetupData["agents"] {
  if (supportedAgents.length === 0) {
    return { [defaultRunner]: true };
  }
  return Object.fromEntries(
    supportedAgents.map((agent) => [agent.id, agent.id === defaultRunner]),
  );
}

/** Read a terminal-session status from raw payload data. */
function readSessionStatus(rawValue: unknown): SessionStatus | null {
  return rawValue === "starting" ||
    rawValue === "active" ||
    rawValue === "terminated"
    ? rawValue
    : null;
}

/** Read an error message from a payload record. */
function readErrorMessage(payload: JsonRecord): string | null {
  return typeof payload.error === "string" ? payload.error : null;
}

function readNumber(rawValue: unknown, fallback = 0): number {
  return typeof rawValue === "number" && Number.isFinite(rawValue)
    ? rawValue
    : fallback;
}

function readSecurityReviewSeverity(rawValue: unknown): SecurityReviewSeverity {
  return rawValue === "Critical" ||
    rawValue === "High" ||
    rawValue === "Medium" ||
    rawValue === "Low"
    ? rawValue
    : "Low";
}

function readSecurityReviewConfidence(
  rawValue: unknown,
): SecurityReviewConfidence {
  return rawValue === "CONFIRMED" ||
    rawValue === "PROBABLE" ||
    rawValue === "THEORETICAL"
    ? rawValue
    : "THEORETICAL";
}

function readSecurityReviewProofClass(
  rawValue: unknown,
): SecurityReviewProofClass {
  return rawValue === "RUNTIME" ||
    rawValue === "CONTRACT-GREP" ||
    rawValue === "STATIC" ||
    rawValue === "NOT-REPRODUCED"
    ? rawValue
    : "STATIC";
}

function readSecurityReviewEvidence(
  rawValue: unknown,
): SecurityReviewFinding["evidence"] {
  return rawValue === "OBSERVED" || rawValue === "INFERRED"
    ? rawValue
    : "INFERRED";
}

function readSecurityReviewFinding(rawValue: unknown): SecurityReviewFinding {
  const payload = readRecord(rawValue, "Security review finding");
  const source = readRecord(payload.source ?? {}, "Security review source");
  return {
    id: readString(payload.id, "S-00"),
    file: readString(payload.file),
    anchor: readString(payload.anchor),
    title: readString(payload.title, "Untitled finding"),
    body: readString(payload.body),
    severity: readSecurityReviewSeverity(payload.severity),
    confidence: readSecurityReviewConfidence(payload.confidence),
    proofClass: readSecurityReviewProofClass(payload.proofClass),
    evidence: readSecurityReviewEvidence(payload.evidence),
    asset: readString(payload.asset),
    entry: readString(payload.entry),
    sink: readString(payload.sink),
    trustBoundary: readString(payload.trustBoundary),
    blastRadius: readString(payload.blastRadius),
    source: {
      tool: readString(source.tool, "agent"),
      ruleId: source.ruleId === null ? null : readString(source.ruleId),
      pillar: source.pillar === null ? null : readString(source.pillar),
    },
  };
}

function readSecurityReviewArtifact(rawValue: unknown): SecurityReviewArtifact {
  const payload = readRecord(rawValue, "Security review artifact");
  if (payload.resultKind !== "goat-flow-security-result") {
    throw new Error("Security review artifact returned an invalid result kind");
  }
  if (payload.contractVersion !== "1") {
    throw new Error(
      "Security review artifact returned an invalid contract version",
    );
  }
  const target = readRecord(payload.target ?? {}, "Security review target");
  const posture = readRecord(payload.posture ?? {}, "Security review posture");
  const rollup = readRecord(
    posture.rollupBySeverity ?? {},
    "Security review severity rollup",
  );
  const integrity = readRecord(
    payload.integrity ?? {},
    "Security review integrity",
  );
  const filesOpened = readRecord(
    integrity.filesOpened ?? {},
    "Security review files opened",
  );
  const conclusion =
    posture.conclusion === "confident" ||
    posture.conclusion === "coverage-degraded" ||
    posture.conclusion === "tool-limited"
      ? posture.conclusion
      : "coverage-degraded";
  return {
    resultKind: "goat-flow-security-result",
    contractVersion: "1",
    generatedAt: readString(payload.generatedAt),
    target: {
      projectPath: readString(target.projectPath),
      mode: readString(target.mode),
      agent: readString(target.agent),
    },
    posture: {
      conclusion,
      rollupBySeverity: {
        Critical: readNumber(rollup.Critical),
        High: readNumber(rollup.High),
        Medium: readNumber(rollup.Medium),
        Low: readNumber(rollup.Low),
      },
    },
    findings: Array.isArray(payload.findings)
      ? payload.findings.map(readSecurityReviewFinding)
      : [],
    integrity: {
      filesOpened: {
        opened: readNumber(filesOpened.opened),
        total: readNumber(filesOpened.total),
        paths: readStringArray(filesOpened.paths),
      },
      observed: readNumber(integrity.observed),
      inferred: readNumber(integrity.inferred),
      degradationFlags: readStringArray(integrity.degradationFlags),
      conclusion: readString(integrity.conclusion),
    },
  };
}

/** Collapse a project path down to the display name shown in the UI. */
function getProjectDisplayName(path: string): string {
  return path.split("/").filter(Boolean).pop() || path;
}

/** Read one audit failure record from raw payload data. */
function readAuditFailure(rawFailure: unknown): AuditFailure | null {
  if (!isRecord(rawFailure)) return null;
  const check = readString(rawFailure.check);
  const message = readString(rawFailure.message);
  if (!check || !message) return null;

  const failure: AuditFailure = { check, message };
  const evidence = readString(rawFailure.evidence);
  const howToFix = readString(rawFailure.howToFix);
  if (evidence) failure.evidence = evidence;
  if (howToFix) failure.howToFix = howToFix;
  return failure;
}

/**
 * Read one audit check while preserving score-critical discriminants.
 *
 * This stays explicit because dashboard scoring branches on `type`, `impact`,
 * `displayStatus`, and acknowledgement fields after decoding the API payload.
 */
function readAuditCheck(rawCheck: unknown): AuditCheck | null {
  if (!isRecord(rawCheck)) return null;
  const id = readString(rawCheck.id);
  const name = readString(rawCheck.name);
  const status = readAuditStatus(rawCheck.status);
  if (!id || !name || !status) return null;

  const provenanceValue = rawCheck.provenance;
  if (!isRecord(provenanceValue)) return null;
  const sourceType = readString(provenanceValue.source_type);
  const verifiedOn = readString(provenanceValue.verified_on);
  const normativeLevel = readString(provenanceValue.normative_level);
  if (
    ![
      "spec",
      "vendor_docs",
      "paper",
      "incident",
      "community",
      "unknown",
    ].includes(sourceType) ||
    !verifiedOn ||
    !["MUST", "SHOULD", "BEST_PRACTICE"].includes(normativeLevel)
  ) {
    return null;
  }

  const check: AuditCheck = {
    id,
    name,
    status,
    displayStatus: "pass",
    impact: "none",
    provenance: {
      source_type: sourceType as AuditCheckProvenance["source_type"],
      source_urls: readStringArray(provenanceValue.source_urls),
      verified_on: verifiedOn,
      normative_level:
        normativeLevel as AuditCheckProvenance["normative_level"],
      ...(Array.isArray(provenanceValue.evidence_paths)
        ? {
            evidence_paths: readStringArray(provenanceValue.evidence_paths),
          }
        : {}),
      ...(Array.isArray(provenanceValue.framework_evidence_paths)
        ? {
            framework_evidence_paths: readStringArray(
              provenanceValue.framework_evidence_paths,
            ),
          }
        : {}),
      ...(Array.isArray(provenanceValue.target_evidence_paths)
        ? {
            target_evidence_paths: readStringArray(
              provenanceValue.target_evidence_paths,
            ),
          }
        : {}),
      ...(typeof provenanceValue.reason === "string"
        ? { reason: provenanceValue.reason }
        : {}),
    },
  };
  if (
    rawCheck.type === "integrity" ||
    rawCheck.type === "advisory" ||
    rawCheck.type === "metric"
  ) {
    check.type = rawCheck.type;
  }
  if (rawCheck.acknowledged === true) check.acknowledged = true;
  check.displayStatus =
    readAuditDisplayStatus(rawCheck.displayStatus) ??
    defaultDisplayStatus(status, check.type, check.acknowledged === true);
  check.impact =
    readAuditCheckImpact(rawCheck.impact) ??
    defaultCheckImpact(status, check.type, check.acknowledged === true);
  if (
    rawCheck.evidenceKind === "semantic" ||
    rawCheck.evidenceKind === "structural"
  ) {
    check.evidenceKind = rawCheck.evidenceKind;
  }
  if (rawCheck.assurance === "full" || rawCheck.assurance === "limited") {
    check.assurance = rawCheck.assurance;
  }
  const failure = readAuditFailure(rawCheck.failure);
  if (failure) check.failure = failure;
  if (isRecord(rawCheck.details)) check.details = rawCheck.details;
  return check;
}

/** Read a string-to-string map from raw payload data. */
function readStringRecord(rawValue: unknown): Record<string, string> {
  if (!isRecord(rawValue)) return {};

  const entries = Object.entries(rawValue).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return Object.fromEntries(entries);
}

/** Read one audit scope; throws when required scope status is missing or invalid. */
function readAuditScope(rawScope: unknown, context: string): AuditScope {
  const payload = readRecord(rawScope, context);
  const status = readAuditStatus(payload.status);
  if (!status) {
    throw new Error(`${context} returned an invalid audit status`);
  }

  return {
    status,
    checks: Array.isArray(payload.checks)
      ? payload.checks
          .map((check) => readAuditCheck(check))
          .filter((check): check is AuditCheck => check !== null)
      : [],
    failures: Array.isArray(payload.failures)
      ? payload.failures
          .map((failure) => readAuditFailure(failure))
          .filter((failure): failure is AuditFailure => failure !== null)
      : [],
    summary: readStringRecord(payload.summary),
  };
}

/** Read one harness concern from raw payload data. */
function readAuditConcern(rawConcern: unknown): AuditConcern | null {
  if (!isRecord(rawConcern)) return null;
  const status = readAuditStatus(rawConcern.status);
  if (!status || typeof rawConcern.score !== "number") return null;

  /** Read a numeric counter from raw payload data. */
  const readCount = (v: unknown): number => (typeof v === "number" ? v : 0);

  return {
    status,
    score: rawConcern.score,
    findings: readStringArray(rawConcern.findings),
    limits: readStringArray(rawConcern.limits),
    recommendations: readStringArray(rawConcern.recommendations),
    howToFix: readStringArray(rawConcern.howToFix),
    integrityPass: readCount(rawConcern.integrityPass),
    integrityFail: readCount(rawConcern.integrityFail),
    advisoryPass: readCount(rawConcern.advisoryPass),
    advisoryFail: readCount(rawConcern.advisoryFail),
    advisoryAcknowledged: readCount(rawConcern.advisoryAcknowledged),
    metrics: readCount(rawConcern.metrics),
  };
}

/** Read an enforcement capability status from raw payload data. */
function readEnforcementStatus(
  rawValue: unknown,
): EnforcementCapabilityStatus | null {
  return rawValue === "hard" ||
    rawValue === "limited" ||
    rawValue === "soft" ||
    rawValue === "missing" ||
    rawValue === "unknown"
    ? rawValue
    : null;
}

/** Read only the known enforcement status counters from raw payload data. */
function readEnforcementSummary(
  rawSummary: unknown,
): Record<EnforcementCapabilityStatus, number> {
  const summary: Record<EnforcementCapabilityStatus, number> = {
    hard: 0,
    limited: 0,
    soft: 0,
    missing: 0,
    unknown: 0,
  };
  if (!isRecord(rawSummary)) return summary;
  for (const [key, count] of Object.entries(rawSummary)) {
    const status = readEnforcementStatus(key);
    if (status && typeof count === "number") summary[status] = count;
  }
  return summary;
}

/** Read one enforcement source label from raw payload data. */
function readEnforcementSource(
  rawValue: unknown,
): EnforcementCapabilitySource | null {
  return rawValue === "local-settings" ||
    rawValue === "local-hook" ||
    rawValue === "runtime-self-test" ||
    rawValue === "manifest" ||
    rawValue === "provider-docs" ||
    rawValue === "not-observed"
    ? rawValue
    : null;
}

/** Read one advisory enforcement capability row. */
function readEnforcementCapability(
  rawCapability: unknown,
): EnforcementCapability | null {
  if (!isRecord(rawCapability)) return null;
  const id = readString(rawCapability.id);
  const label = readString(rawCapability.label);
  const status = readEnforcementStatus(rawCapability.status);
  const summary = readString(rawCapability.summary);
  if (!id || !label || !status || !summary) return null;
  return {
    id,
    label,
    status,
    sources: Array.isArray(rawCapability.sources)
      ? rawCapability.sources
          .map((source) => readEnforcementSource(source))
          .filter(
            (source): source is EnforcementCapabilitySource => source !== null,
          )
      : [],
    summary,
    evidence: readStringArray(rawCapability.evidence),
  };
}

/** Read the advisory enforcement matrix for one agent. */
function readAgentEnforcementCapability(
  rawEnforcement: unknown,
): AgentEnforcementCapability | null {
  if (!isRecord(rawEnforcement)) return null;
  const agent = readRunnerId(rawEnforcement.agent);
  const name = readString(rawEnforcement.name);
  if (!agent || !name || rawEnforcement.advisory !== true) return null;
  const capabilities = Array.isArray(rawEnforcement.capabilities)
    ? rawEnforcement.capabilities
        .map((item) => readEnforcementCapability(item))
        .filter((item): item is EnforcementCapability => item !== null)
    : [];
  return {
    agent,
    name,
    advisory: true,
    capabilities,
    summary: readEnforcementSummary(rawEnforcement.summary),
  };
}

/** Read one per-agent score from raw payload data. */
function readAgentScore(rawScore: unknown): AgentScore | null {
  if (!isRecord(rawScore)) return null;
  const id = readRunnerId(rawScore.id);
  if (!id) return null;

  const harness =
    rawScore.harness === null
      ? null
      : rawScore.harness === undefined
        ? null
        : readAuditScope(rawScore.harness, "Audit response harness scope");

  const concerns =
    rawScore.concerns === null
      ? null
      : isRecord(rawScore.concerns)
        ? Object.fromEntries(
            Object.entries(rawScore.concerns)
              .map(
                ([key, concern]) => [key, readAuditConcern(concern)] as const,
              )
              .filter(
                (entry): entry is [string, AuditConcern] => entry[1] !== null,
              ),
          )
        : null;

  return {
    id,
    name: readString(rawScore.name, id),
    agent: readAuditScope(rawScore.agent, "Audit response agent scope"),
    harness,
    concerns,
    enforcement: readAgentEnforcementCapability(rawScore.enforcement),
  };
}

/** Read one learning-loop action bucket from the audit payload. */
function readLearningLoopBucketAction(
  rawAction: unknown,
): { path: string; reason: string } | null {
  if (!isRecord(rawAction)) return null;
  const path = readString(rawAction.path);
  const reason = readString(rawAction.reason);
  if (!path || !reason) return null;
  return { path, reason };
}

/** Read compact learning-loop health from the audit payload. */
function readLearningLoopSummary(
  rawSummary: unknown,
): DashboardClientReport["learningLoop"] {
  if (!isRecord(rawSummary)) return null;
  const status = readString(rawSummary.status);
  if (
    !["fresh", "needs-review", "unavailable"].includes(status) ||
    typeof rawSummary.recordCount !== "number" ||
    typeof rawSummary.footgunCount !== "number" ||
    typeof rawSummary.lessonCount !== "number" ||
    typeof rawSummary.staleCount !== "number" ||
    typeof rawSummary.invalidLineRefCount !== "number" ||
    typeof rawSummary.oversizedCount !== "number"
  ) {
    return null;
  }
  return {
    recordCount: rawSummary.recordCount,
    footgunCount: rawSummary.footgunCount,
    lessonCount: rawSummary.lessonCount,
    staleCount: rawSummary.staleCount,
    invalidLineRefCount: rawSummary.invalidLineRefCount,
    oversizedCount: rawSummary.oversizedCount,
    oldestLastReviewed:
      typeof rawSummary.oldestLastReviewed === "string"
        ? rawSummary.oldestLastReviewed
        : null,
    topBucketsNeedingAction: Array.isArray(rawSummary.topBucketsNeedingAction)
      ? rawSummary.topBucketsNeedingAction
          .map((entry) => readLearningLoopBucketAction(entry))
          .filter(
            (entry): entry is { path: string; reason: string } =>
              entry !== null,
          )
      : [],
    status: status as "fresh" | "needs-review" | "unavailable",
  };
}

/** Read one recent lesson row from the audit payload. */
function readRecentLesson(rawLesson: unknown): RecentLesson | null {
  if (!isRecord(rawLesson)) return null;
  const id = readString(rawLesson.id);
  const title = readString(rawLesson.title);
  const path = readString(rawLesson.path);
  if (!id || !title || !path) return null;
  return {
    id,
    title,
    path,
    created: readString(rawLesson.created) || null,
  };
}

/** Read a finite numeric payload field with a safe fallback. */
function readFiniteNumber(rawValue: unknown, fallback = 0): number {
  return typeof rawValue === "number" && Number.isFinite(rawValue)
    ? rawValue
    : fallback;
}

/** Read one top-level plan directory summary from `/api/plans`. */
function readTaskPlanSummary(rawPlan: unknown): TaskPlanSummary | null {
  if (!isRecord(rawPlan)) return null;
  const name = readString(rawPlan.name);
  const path = readString(rawPlan.path);
  if (!name || !path) return null;
  return {
    name,
    path,
    modifiedAt: readString(rawPlan.modifiedAt),
    milestoneCount: readFiniteNumber(rawPlan.milestoneCount),
    active: rawPlan.active === true,
  };
}

/** Read one milestone summary from `/api/plans`. */
function readTaskMilestoneSummary(
  rawMilestone: unknown,
): TaskMilestoneSummary | null {
  if (!isRecord(rawMilestone)) return null;
  const filename = readString(rawMilestone.filename);
  const path = readString(rawMilestone.path);
  const title = readString(rawMilestone.title);
  if (!filename || !path || !title) return null;
  return {
    filename,
    path,
    title,
    status: readString(rawMilestone.status, "unknown"),
    objective: readString(rawMilestone.objective),
    totalTasks: readFiniteNumber(rawMilestone.totalTasks),
    completedTasks: readFiniteNumber(rawMilestone.completedTasks),
    modifiedAt: readString(rawMilestone.modifiedAt),
  };
}

/** Read the selected project's `.goat-flow/plans/` state. */
function readTaskState(rawState: unknown): TaskState {
  const payload = readRecord(rawState, "Tasks response");
  const planRoot = readString(payload.planRoot, readString(payload.taskRoot));
  return {
    planRoot,
    taskRoot: planRoot,
    exists: payload.exists === true,
    active: readString(payload.active) || null,
    activeExists: payload.activeExists === true,
    selectedPlan: readString(payload.selectedPlan) || null,
    plans: Array.isArray(payload.plans)
      ? payload.plans
          .map((plan) => readTaskPlanSummary(plan))
          .filter((plan): plan is TaskPlanSummary => plan !== null)
      : [],
    milestones: Array.isArray(payload.milestones)
      ? payload.milestones
          .map((milestone) => readTaskMilestoneSummary(milestone))
          .filter(
            (milestone): milestone is TaskMilestoneSummary =>
              milestone !== null,
          )
      : [],
  };
}

/** Read the full dashboard report; throws when required audit status fields drift. */
function readDashboardReport(rawReport: unknown): DashboardClientReport {
  const payload = readRecord(rawReport, "Audit response");
  const status = readAuditStatus(payload.status);
  if (!status) {
    throw new Error("Audit response returned an invalid status");
  }

  const scopesPayload = readRecord(payload.scopes, "Audit response scopes");
  const overallPayload = readRecord(payload.overall, "Audit response overall");
  const overallStatus = readAuditStatus(overallPayload.status);
  if (!overallStatus) {
    throw new Error("Audit response returned an invalid overall status");
  }

  return {
    agentScores: Array.isArray(payload.agentScores)
      ? payload.agentScores
          .map((score) => readAgentScore(score))
          .filter((score): score is AgentScore => score !== null)
      : [],
    status,
    scopes: {
      setup: readAuditScope(scopesPayload.setup, "Audit response setup scope"),
      agent: readAuditScope(scopesPayload.agent, "Audit response agent scope"),
      ...(scopesPayload.harness
        ? {
            harness: readAuditScope(
              scopesPayload.harness,
              "Audit response harness scope",
            ),
          }
        : {}),
    },
    overall: { status: overallStatus },
    learningLoop: readLearningLoopSummary(payload.learningLoop),
    recentLessons: Array.isArray(payload.recentLessons)
      ? payload.recentLessons
          .map((lesson) => readRecentLesson(lesson))
          .filter((lesson): lesson is RecentLesson => lesson !== null)
      : [],
    target: readString(payload.target),
  };
}

/** Read injected boot report; swallows stale shell payloads so the app can refetch. */
function readInjectedReport(): DashboardClientReport | null {
  if (window.__GOAT_FLOW_REPORT__ == null) return null;
  try {
    return readDashboardReport(window.__GOAT_FLOW_REPORT__);
  } catch {
    return null;
  }
}

/**
 * Read one supported-agent record from dashboard shell injection.
 *
 * This stays explicit because the injected metadata controls prompt routing,
 * terminal launch labels, and setup-surface hints before any API refetch occurs.
 */
