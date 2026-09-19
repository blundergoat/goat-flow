/**
 * Decode API and injected shell data before dashboard views consume it.
 *
 * Required audit fields reject incompatible responses; optional rows and fields use explicit absent-value fallbacks.
 * Load this classic script before app.js so the dashboard's feature scripts can share these readers without module imports.
 */

type JsonRecord = Record<string, unknown>;
const DASHBOARD_TOKEN_PARAM = "token";
const DASHBOARD_TOKEN_HEADER = "X-Goat-Flow-Dashboard-Token";

// Read the token supplied by this dashboard server at startup; empty means no token was injected for outgoing requests.
function dashboardAuthToken(): string {
  return typeof window.__GOAT_FLOW_DASHBOARD_TOKEN__ === "string"
    ? window.__GOAT_FLOW_DASHBOARD_TOKEN__
    : "";
}

// Send an API request with the boot token when available; callers handle network failures and response decoding.
function dashboardFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const token = dashboardAuthToken();
  // A server-injected token authenticates requests from this dashboard page; without one, preserve the caller's headers.
  if (token) headers.set(DASHBOARD_TOKEN_HEADER, token);
  return fetch(input, { ...init, headers });
}

// Encode a file dropped onto the terminal for its JSON upload; read failures reject the promise for the upload handler to report.
function dashboardFileToBase64(file: File): Promise<string> {
  return new Promise<string>((resolveBase64, rejectBase64) => {
    const reader = new FileReader();
    // If the browser cannot read the dropped file, let the upload handler report the failure without sending incomplete image data.
    reader.onerror = () => {
      rejectBase64(reader.error ?? new Error("File read failed"));
    };
    reader.onload = () => {
      const result = reader.result;
      // The upload expects a data URL; another reader result cannot provide valid image bytes.
      if (typeof result !== "string") {
        rejectBase64(new Error("Unexpected file read result"));
        return;
      }
      // Remove the data-URL prefix before upload; a result without the separator is already used as the encoded payload.
      const comma = result.indexOf(",");
      resolveBase64(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

// Append the dashboard token to a terminal WebSocket path.
function dashboardTerminalWsPath(wsPath: string): string {
  const token = dashboardAuthToken();
  // A page without an injected credential leaves the terminal connection path unchanged.
  if (!token) return wsPath;
  const url = new URL(wsPath, window.location.origin);
  url.searchParams.set(DASHBOARD_TOKEN_PARAM, token);
  return `${url.pathname}${url.search}`;
}

// Remove the launch token from the visible URL after the boot payload is loaded.
function dashboardClearLaunchToken(): void {
  const url = new URL(window.location.href);
  // Ordinary page navigation has no launch credential to remove from the address bar.
  if (!url.searchParams.has(DASHBOARD_TOKEN_PARAM)) return;
  url.searchParams.delete(DASHBOARD_TOKEN_PARAM);
  const next =
    url.pathname +
    (url.searchParams.toString() ? `?${url.searchParams.toString()}` : "") +
    url.hash;
  window.history.replaceState(null, "", next);
}

dashboardClearLaunchToken();

// Treat arrays as invalid records because dashboard API payloads use named fields.
function isRecord(candidate: unknown): candidate is JsonRecord {
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    !Array.isArray(candidate)
  );
}

// Read a required object record; throws when a top-level API payload is malformed.
function readRecord(rawPayload: unknown, context: string): JsonRecord {
  // Missing or malformed top-level data cannot become a believable dashboard result; its loader must handle the error.
  if (!isRecord(rawPayload)) {
    throw new Error(`${context} returned an invalid payload`);
  }
  return rawPayload;
}

// Preserve payload text, including an empty string; missing or non-text values use the caller's display fallback.
function readString(rawValue: unknown, fallback = ""): string {
  return typeof rawValue === "string" ? rawValue : fallback;
}

// Preserve an explicit feature flag; missing or non-boolean values keep the caller's default behavior.
function readBoolean(rawValue: unknown, withDefault: boolean): boolean {
  return typeof rawValue === "boolean" ? rawValue : withDefault;
}

// Retain text entries for dashboard lists; a missing or non-array field produces an empty list.
function readStringArray(rawValue: unknown): string[] {
  return Array.isArray(rawValue)
    ? rawValue.filter((entry): entry is string => typeof entry === "string")
    : [];
}

// Decode dashboard list rows; null decoder results are omitted, and a missing or non-array field produces an empty list.
function readArray<T>(
  rawValue: unknown,
  reader: (entry: unknown) => T | null,
): T[] {
  return Array.isArray(rawValue)
    ? rawValue.map(reader).filter((entry): entry is T => entry !== null)
    : [];
}

// Restore named display values; empty strings and invalid entries are omitted so callers can keep their default labels.
function readStringMap(rawValue: unknown): Record<string, string> {
  // An absent or malformed label map leaves callers with no saved display overrides.
  if (!isRecord(rawValue)) return {};
  const result: Record<string, string> = {};
  // Each valid saved label can replace its matching default without accepting unrelated payload value types.
  for (const [k, v] of Object.entries(rawValue)) {
    // Blank or non-text overrides must not erase a usable default label.
    if (typeof v === "string" && v.length > 0) result[k] = v;
  }
  return result;
}

// Recognize measured audit outcomes; null lets the caller reject or omit a result whose status is unknown.
function readAuditStatus(rawValue: unknown): AuditStatus | null {
  return rawValue === "pass" || rawValue === "fail" || rawValue === "skipped"
    ? rawValue
    : null;
}

// Recognize a dashboard status label; null asks the audit reader to derive its compatible display fallback.
function readAuditDisplayStatus(rawValue: unknown): AuditDisplayStatus | null {
  return rawValue === "pass" ||
    rawValue === "fail" ||
    rawValue === "warn" ||
    rawValue === "info" ||
    rawValue === "skipped"
    ? rawValue
    : null;
}

// Recognize how a check affects scoring; null asks the audit reader to derive impact from status, type, and acknowledgement.
function readAuditCheckImpact(rawValue: unknown): AuditCheckImpact | null {
  return rawValue === "none" ||
    rawValue === "scope-fail" ||
    rawValue === "score-only"
    ? rawValue
    : null;
}

// Compute a backward-compatible display status when an older server omits it.
function defaultDisplayStatus(
  status: AuditStatus,
  type?: AuditCheckType,
  acknowledged = false,
): AuditDisplayStatus {
  // An inapplicable check stays visibly skipped even when an older server omits display metadata.
  if (status === "skipped") return "skipped";
  // Passing metrics convey information; passing integrity and advisory checks use the success label.
  if (status === "pass") return type === "metric" ? "info" : "pass";
  // A failed metric or acknowledged finding warns without presenting itself as a hard audit failure.
  return type === "metric" || acknowledged ? "warn" : "fail";
}

// Compute backward-compatible impact when an older server omits it.
function defaultCheckImpact(
  status: AuditStatus,
  type?: AuditCheckType,
  acknowledged = false,
): AuditCheckImpact {
  // Passing and skipped checks do not lower the scope result.
  if (status !== "fail") return "none";
  // Metrics and acknowledged findings can lower the score without failing the audit scope.
  return type === "metric" || acknowledged ? "score-only" : "scope-fail";
}

// Read the server's supported runner IDs; a missing list leaves no runner identity eligible for decoding.
function readInjectedRunnerIds(): string[] {
  return Array.isArray(window.__GOAT_FLOW_RUNNER_IDS__)
    ? window.__GOAT_FLOW_RUNNER_IDS__.filter(
        (id): id is string => typeof id === "string",
      )
    : [];
}

// Accept only an injected runner ID; null prevents unknown payload values from becoming dashboard launch targets.
function readRunnerId(rawValue: unknown): RunnerId | null {
  const runner = readString(rawValue).trim();
  return readInjectedRunnerIds().includes(runner) ? (runner as RunnerId) : null;
}

// Read the runner's slash or dollar command style; null makes unsupported launch metadata unusable to the caller.
function readPromptInvocationStyle(
  rawValue: unknown,
): PromptInvocationStyle | null {
  return rawValue === "slash" || rawValue === "dollar" ? rawValue : null;
}

// Recognize the runner's installed or mirrored skill source; null prevents unknown sources from becoming supported runner metadata.
function readSkillSource(rawValue: unknown): SkillSource | null {
  return rawValue === "installed" ||
    rawValue === "agent-mirror" ||
    rawValue === "github-mirror"
    ? rawValue
    : null;
}

// Build the default setup-agent selection from the injected support list.
function buildDefaultSetupAgents(
  supportedAgents: SupportedAgent[],
  defaultRunner: RunnerId,
): SetupData["agents"] {
  // A shell with no supported-agent metadata still selects its default runner for Setup.
  if (supportedAgents.length === 0) {
    return { [defaultRunner]: true };
  }
  return Object.fromEntries(
    supportedAgents.map((agent) => [agent.id, agent.id === defaultRunner]),
  );
}

// Recognize terminal lifecycle states for workspace controls; null means the session row must not be restored.
function readSessionStatus(rawValue: unknown): SessionStatus | null {
  return rawValue === "starting" ||
    rawValue === "active" ||
    rawValue === "terminated"
    ? rawValue
    : null;
}

// Read a server error for a loader to report; null means no text error was supplied, while empty text remains empty.
function readErrorMessage(payload: JsonRecord): string | null {
  return typeof payload.error === "string" ? payload.error : null;
}

// Use the final directory as the project label; a path with no directory segment remains unchanged.
function getProjectDisplayName(path: string): string {
  return path.split("/").filter(Boolean).pop() || path;
}

// Decode an actionable audit failure; null omits rows missing a check or message, while absent evidence and repair text stay optional.
function readAuditFailure(rawFailure: unknown): AuditFailure | null {
  // A malformed failure row cannot supply a check message for the audit details view.
  if (!isRecord(rawFailure)) return null;
  const check = readString(rawFailure.check);
  const message = readString(rawFailure.message);
  // A failure needs both its check and explanation before it can appear as an actionable result.
  if (!check || !message) return null;

  const failure: AuditFailure = { check, message };
  const evidence = readString(rawFailure.evidence);
  const howToFix = readString(rawFailure.howToFix);
  // Only supplied evidence adds supporting detail to the failure shown on screen.
  if (evidence) failure.evidence = evidence;
  // A missing repair explanation leaves the failure visible without inventing a fix instruction.
  if (howToFix) failure.howToFix = howToFix;
  return failure;
}

const AUDIT_PROVENANCE_SOURCE_TYPES =
  "|spec|vendor_docs|paper|incident|community|unknown|";
const AUDIT_PROVENANCE_NORMATIVE_LEVELS = "|MUST|SHOULD|BEST_PRACTICE|";
const AUDIT_CHECK_TYPES = ["integrity", "advisory", "metric"] as const;
const AUDIT_EVIDENCE_KINDS = ["semantic", "structural"] as const;
const AUDIT_ASSURANCE_LEVELS = ["full", "limited"] as const;
const AUDIT_EVIDENCE_PATH_KEYS = [
  "evidence_paths",
  "framework_evidence_paths",
  "target_evidence_paths",
] as const;

// Attach optional provenance evidence paths when the API sends the field as an array.
function assignEvidencePaths(
  provenance: AuditCheckProvenance,
  key: "evidence_paths" | "framework_evidence_paths" | "target_evidence_paths",
  rawPaths: unknown,
): void {
  // An absent path field stays absent; an explicit empty array records that this evidence category contains no paths.
  if (Array.isArray(rawPaths)) provenance[key] = readStringArray(rawPaths);
}

// Decode the evidence source behind an audit check; null rejects missing or unknown source metadata before the check is displayed.
function readAuditCheckProvenance(
  rawProvenance: unknown,
): AuditCheckProvenance | null {
  // Without an evidence record, the audit reader cannot present this check as a sourced finding.
  if (!isRecord(rawProvenance)) return null;
  const sourceType = readString(rawProvenance.source_type);
  const verifiedOn = readString(rawProvenance.verified_on);
  const normativeLevel = readString(rawProvenance.normative_level);
  // Evidence must name a recognized source class and obligation level, plus when it was verified.
  if (
    !AUDIT_PROVENANCE_SOURCE_TYPES.includes(`|${sourceType}|`) ||
    !verifiedOn ||
    !AUDIT_PROVENANCE_NORMATIVE_LEVELS.includes(`|${normativeLevel}|`)
  ) {
    return null;
  }

  const provenance: AuditCheckProvenance = {
    source_type: sourceType as AuditCheckProvenance["source_type"],
    source_urls: readStringArray(rawProvenance.source_urls),
    verified_on: verifiedOn,
    normative_level: normativeLevel as AuditCheckProvenance["normative_level"],
  };
  // Keep framework and target evidence paths separate so audit details can show which project each claim concerns.
  for (const key of AUDIT_EVIDENCE_PATH_KEYS) {
    assignEvidencePaths(provenance, key, rawProvenance[key]);
  }
  // A supplied explanation accompanies the provenance without requiring every source to include one.
  if (typeof rawProvenance.reason === "string")
    provenance.reason = rawProvenance.reason;
  return provenance;
}

// Read one optional string discriminator only when it is in the allowed API vocabulary.
function readEnum<T extends string>(
  rawValue: unknown,
  allowedValues: readonly T[],
): T | undefined {
  // Missing or non-text API values cannot become user-visible status labels.
  if (typeof rawValue !== "string") return undefined;
  return allowedValues.find((allowedValue) => allowedValue === rawValue);
}

// Apply optional audit-check fields because scoring defaults depend on decoded type and acknowledgement.
function applyAuditCheckOptionalFields(
  check: AuditCheck,
  rawCheck: Record<string, unknown>,
  status: AuditStatus,
): void {
  const type = readEnum(rawCheck.type, AUDIT_CHECK_TYPES);
  // Known check types control whether the dashboard shows an integrity failure, advisory finding, or maturity metric.
  if (type) check.type = type;
  // Only an explicit acknowledgement can soften this finding's displayed failure and scope impact.
  if (rawCheck.acknowledged === true) check.acknowledged = true;
  const acknowledged = check.acknowledged === true;
  // Older responses without valid display metadata derive their label from the decoded type and acknowledgement.
  check.displayStatus =
    readAuditDisplayStatus(rawCheck.displayStatus) ??
    defaultDisplayStatus(status, check.type, acknowledged);
  // A missing impact label uses the compatible scoring rule instead of treating every warning as a failed scope.
  check.impact =
    readAuditCheckImpact(rawCheck.impact) ??
    defaultCheckImpact(status, check.type, acknowledged);
  const evidenceKind = readEnum(rawCheck.evidenceKind, AUDIT_EVIDENCE_KINDS);
  // Recognized evidence kinds let audit details distinguish semantic inspection from structural checks.
  if (evidenceKind) check.evidenceKind = evidenceKind;
  const assurance = readEnum(rawCheck.assurance, AUDIT_ASSURANCE_LEVELS);
  // Known assurance metadata qualifies how much the user can conclude from the check.
  if (assurance) check.assurance = assurance;
  const failure = readAuditFailure(rawCheck.failure);
  // Only a usable failure record can add an explanation and repair guidance to this check.
  if (failure) check.failure = failure;
  // Optional structured details remain available to detail views without admitting malformed values as a details object.
  if (isRecord(rawCheck.details)) check.details = rawCheck.details;
}

/**
 * Decode a check for audit scoring and details, preserving its type, impact, displayed status, and acknowledgement.
 * Null omits checks without required identity, status, or provenance instead of inventing an audit claim.
 */
function readAuditCheck(rawCheck: unknown): AuditCheck | null {
  // A malformed check cannot contribute a row or scoring classification to the dashboard.
  if (!isRecord(rawCheck)) return null;
  const id = readString(rawCheck.id);
  const name = readString(rawCheck.name);
  const status = readAuditStatus(rawCheck.status);
  // Every displayed check needs a stable identity, readable label, and recognized outcome.
  if (!id || !name || !status) return null;

  const provenance = readAuditCheckProvenance(rawCheck.provenance);
  // A check without usable provenance is omitted from the displayed audit findings.
  if (!provenance) return null;

  const check: AuditCheck = {
    id,
    name,
    status,
    displayStatus: "pass",
    impact: "none",
    provenance,
  };
  applyAuditCheckOptionalFields(check, rawCheck, status);
  return check;
}

// Preserve text-valued audit summary fields, including empty text; a missing or invalid map leaves no summary fields.
function readStringRecord(rawValue: unknown): Record<string, string> {
  // An absent summary object contributes no labels to the audit scope.
  if (!isRecord(rawValue)) return {};

  const entries = Object.entries(rawValue).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return Object.fromEntries(entries);
}

// Read one audit scope; throws when required scope status is missing or invalid.
function readAuditScope(rawScope: unknown, context: string): AuditScope {
  const payload = readRecord(rawScope, context);
  const status = readAuditStatus(payload.status);
  // A scope without a valid outcome must fail decoding so the view does not present a fabricated audit result.
  if (!status) {
    throw new Error(`${context} returned an invalid audit status`);
  }

  return {
    status,
    checks: readArray(payload.checks, readAuditCheck),
    failures: readArray(payload.failures, readAuditFailure),
    summary: readStringRecord(payload.summary),
  };
}

// Decode a scored harness concern; null omits incomplete results, and missing numeric counters default to zero.
function readAuditConcern(rawConcern: unknown): AuditConcern | null {
  // Missing concern data provides no score or recommendations to display.
  if (!isRecord(rawConcern)) return null;
  const status = readAuditStatus(rawConcern.status);
  // A concern card needs a recognized outcome and numeric score before showing readiness.
  if (!status || typeof rawConcern.score !== "number") return null;

  // Give older concern payloads zero for missing counters while preserving supplied numeric totals.
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

const STATUSES = ["hard", "limited", "soft", "missing", "unknown"] as const;
const ENFORCEMENT_SOURCE_VALUES: readonly EnforcementCapabilitySource[] = [
  "local-settings",
  "local-hook",
  "runtime-self-test",
  "manifest",
  "provider-docs",
  "not-observed",
];
const ENFORCEMENT_ASSURANCE_VALUES: readonly EnforcementCapabilityAssurance[] =
  [
    "runtime-local",
    "static-local",
    "manifest-declared",
    "provider-documented",
    "not-observed",
  ];

// Read only the known enforcement status counters from raw payload data.
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
  // Missing summary data gives the dashboard explicit zeroes instead of invented runner results.
  if (!isRecord(rawSummary)) return summary;
  // Only recognized status buckets can contribute to the user-facing totals.
  for (const [key, count] of Object.entries(rawSummary)) {
    const status = readEnum(key, STATUSES);
    // Invalid or empty counters are ignored so malformed payloads cannot become dashboard claims.
    if (status && typeof count === "number") summary[status] = count;
  }
  return summary;
}

// Read one advisory enforcement capability row.
function readEnforcementCapability(
  rawCapability: unknown,
): EnforcementCapability | null {
  // A malformed row is omitted before it can appear as a user-visible protection claim.
  if (!isRecord(rawCapability)) return null;
  const id = readString(rawCapability.id);
  const label = readString(rawCapability.label);
  const status = readEnum(rawCapability.status, STATUSES);
  const assurance = readEnum(
    rawCapability.assurance,
    ENFORCEMENT_ASSURANCE_VALUES,
  );
  const sources = readArray(
    rawCapability.sources,
    (rawSource) => readEnum(rawSource, ENFORCEMENT_SOURCE_VALUES) ?? null,
  );
  const summary = readString(rawCapability.summary);
  const hasVisibleEvidence = assurance !== undefined && sources.length > 0;
  // Every visible row needs identity, status, a proof class, a source, and plain-English meaning.
  if (!id || !label || !status || !hasVisibleEvidence || !summary) return null;
  return {
    id,
    label,
    status,
    sources,
    assurance,
    summary,
    evidence: readStringArray(rawCapability.evidence),
  };
}

// Read the advisory enforcement matrix for one agent.
function readAgentEnforcementCapability(
  rawEnforcement: unknown,
): AgentEnforcementCapability | null {
  // A malformed runner matrix is omitted rather than shown as a partial assurance result.
  if (!isRecord(rawEnforcement)) return null;
  const agent = readRunnerId(rawEnforcement.agent);
  const name = readString(rawEnforcement.name);
  // Runner identity and advisory scope must be explicit before the dashboard shows capabilities.
  if (!agent || !name || rawEnforcement.advisory !== true) return null;
  const capabilities = readArray(
    rawEnforcement.capabilities,
    readEnforcementCapability,
  );
  return {
    agent,
    name,
    advisory: true,
    capabilities,
    summary: readEnforcementSummary(rawEnforcement.summary),
  };
}

// Decode one runner's audit results; null omits unknown runners, while absent harness and concern data remain unavailable.
function readAgentScore(rawScore: unknown): AgentScore | null {
  // A malformed runner score cannot become an audit result for an agent card.
  if (!isRecord(rawScore)) return null;
  const id = readRunnerId(rawScore.id);
  // Only a supported runner can own the agent and harness results displayed by this dashboard.
  if (!id) return null;

  // Legacy or agent-only results may have no harness scope; keep it absent rather than assigning a pass or fail.
  const harness =
    rawScore.harness === null
      ? null
      : rawScore.harness === undefined
        ? null
        : readAuditScope(rawScore.harness, "Audit response harness scope");

  // Missing concerns leave the breakdown unavailable, and malformed individual concerns are omitted from an otherwise usable map.
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

// Decode a learning-loop repair destination and reason; null omits entries that cannot tell the user where or why to act.
function readLearningLoopBucketAction(
  rawAction: unknown,
): { path: string; reason: string } | null {
  // An invalid action cannot become a repair recommendation in the learning-loop summary.
  if (!isRecord(rawAction)) return null;
  const path = readString(rawAction.path);
  const reason = readString(rawAction.reason);
  // Recommendations need both a destination and explanation before they can guide the user.
  if (!path || !reason) return null;
  return { path, reason };
}

// Decode one learning-loop index status; null omits rows whose paths or freshness state cannot support a maintenance action.
function readLearningLoopIndexFreshness(
  rawIndex: unknown,
): LearningLoopIndexFreshness | null {
  // A malformed index result provides no trustworthy freshness row for the learning-loop summary.
  if (!isRecord(rawIndex)) return null;
  const bucket = readString(rawIndex.bucket);
  const dirPath = readString(rawIndex.dirPath);
  const indexPath = readString(rawIndex.indexPath);
  const state = readString(rawIndex.state);
  // Index maintenance rows need known bucket and index paths plus a recognized freshness state.
  if (
    !bucket ||
    !dirPath ||
    !indexPath ||
    !["fresh", "stale", "missing", "no-bucket"].includes(state)
  ) {
    return null;
  }
  return {
    bucket,
    dirPath,
    indexPath,
    state: state as LearningLoopIndexFreshness["state"],
    entryCount: readFiniteNumber(rawIndex.entryCount),
  };
}

// Decode the learning-loop health summary; null keeps missing or incomplete totals from appearing as measured project health.
function readLearningLoopSummary(
  rawSummary: unknown,
): DashboardClientReport["learningLoop"] {
  // Missing health data leaves the learning-loop summary unavailable.
  if (!isRecord(rawSummary)) return null;
  const status = readString(rawSummary.status);
  // The summary needs all required counters and a known status before it can describe the selected project's learning-loop health.
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
    indexes: readArray(rawSummary.indexes, readLearningLoopIndexFreshness),
    indexStaleCount: readFiniteNumber(rawSummary.indexStaleCount),
    indexMissingCount: readFiniteNumber(rawSummary.indexMissingCount),
    // No review date means the summary cannot identify the oldest review; it must not supply a synthetic date.
    oldestLastReviewed:
      typeof rawSummary.oldestLastReviewed === "string"
        ? rawSummary.oldestLastReviewed
        : null,
    topBucketsNeedingAction: readArray(
      rawSummary.topBucketsNeedingAction,
      readLearningLoopBucketAction,
    ),
    status: status as "fresh" | "needs-review" | "unavailable",
  };
}

// Decode a recent lesson link; null omits unusable links, while a missing creation date leaves the date unavailable.
function readRecentLesson(rawLesson: unknown): RecentLesson | null {
  // A malformed lesson cannot supply a recent-learning link.
  if (!isRecord(rawLesson)) return null;
  const id = readString(rawLesson.id);
  const title = readString(rawLesson.title);
  const path = readString(rawLesson.path);
  // Recent lesson links need identity, readable title, and a destination the user can open.
  if (!id || !title || !path) return null;
  return {
    id,
    title,
    path,
    created: readString(rawLesson.created) || null,
  };
}

// Read a finite display counter; missing, nonnumeric, or infinite values use the caller's fallback, which defaults to zero.
function readFiniteNumber(rawValue: unknown, fallback = 0): number {
  return typeof rawValue === "number" && Number.isFinite(rawValue)
    ? rawValue
    : fallback;
}

// Decode a plan directory for the Plans list; null omits a plan without a name or destination.
function readTaskPlanSummary(rawPlan: unknown): TaskPlanSummary | null {
  // A malformed plan entry cannot become a selectable plan directory.
  if (!isRecord(rawPlan)) return null;
  const name = readString(rawPlan.name);
  const path = readString(rawPlan.path);
  // The Plans list needs both a visible name and a directory to load when selected.
  if (!name || !path) return null;
  return {
    name,
    path,
    modifiedAt: readString(rawPlan.modifiedAt),
    milestoneCount: readFiniteNumber(rawPlan.milestoneCount),
    active: rawPlan.active === true,
  };
}

// Decode a milestone for the selected plan; null omits rows that cannot identify and label a milestone file.
function readTaskMilestoneSummary(
  rawMilestone: unknown,
): TaskMilestoneSummary | null {
  // Invalid milestone data cannot supply a row the user can open from a plan.
  if (!isRecord(rawMilestone)) return null;
  const filename = readString(rawMilestone.filename);
  const path = readString(rawMilestone.path);
  const title = readString(rawMilestone.title);
  // A milestone needs its file identity, location, and title before the Plans view can offer it.
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

// Decode the selected project's Plans view; absent active or selected plan names become null, and malformed top-level state throws.
function readTaskState(rawState: unknown): TaskState {
  const payload = readRecord(rawState, "Tasks response");
  const planRoot = readString(payload.planRoot, readString(payload.taskRoot));
  return {
    planRoot,
    taskRoot: planRoot,
    exists: payload.exists === true,
    // An empty active-plan pointer means no plan is marked active for this project.
    active: readString(payload.active) || null,
    activeExists: payload.activeExists === true,
    // Without a selected plan, the view has no selected directory whose milestones it can show.
    selectedPlan: readString(payload.selectedPlan) || null,
    plans: readArray(payload.plans, readTaskPlanSummary),
    milestones: readArray(payload.milestones, readTaskMilestoneSummary),
  };
}

// Read the full dashboard report; throws when required audit status fields drift.
function readDashboardReport(rawReport: unknown): DashboardClientReport {
  const payload = readRecord(rawReport, "Audit response");
  const status = readAuditStatus(payload.status);
  // A missing or unknown report outcome cannot be shown as a completed audit result.
  if (!status) {
    throw new Error("Audit response returned an invalid status");
  }

  const scopesPayload = readRecord(payload.scopes, "Audit response scopes");
  const overallPayload = readRecord(payload.overall, "Audit response overall");
  const overallStatus = readAuditStatus(overallPayload.status);
  // The overall result must be explicit before the dashboard can summarize the audit.
  if (!overallStatus) {
    throw new Error("Audit response returned an invalid overall status");
  }

  return {
    agentScores: readArray(payload.agentScores, readAgentScore),
    status,
    scopes: {
      setup: readAuditScope(scopesPayload.setup, "Audit response setup scope"),
      agent: readAuditScope(scopesPayload.agent, "Audit response agent scope"),
      // An audit without harness scope keeps that section absent while retaining setup and agent results.
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
    recentLessons: readArray(payload.recentLessons, readRecentLesson),
    target: readString(payload.target),
  };
}

// Read injected boot report; swallows stale shell payloads so the app can refetch.
function readInjectedReport(): DashboardClientReport | null {
  // A shell without a boot report opens without an audit result until its normal fetch completes.
  if (window.__GOAT_FLOW_REPORT__ == null) return null;
  try {
    return readDashboardReport(window.__GOAT_FLOW_REPORT__);
  } catch {
    // A stale cached shell may contain an incompatible audit payload; leave the report empty so startup can request a fresh one.
    return null;
  }
}
