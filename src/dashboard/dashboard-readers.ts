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

/** Check whether a value is a plain object record. */
function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read a plain object record from raw dashboard payload data. */
function readRecord(value: unknown, context: string): JsonRecord {
  if (!isRecord(value)) {
    throw new Error(`${context} returned an invalid payload`);
  }
  return value;
}

/** Read a string value with a safe fallback for invalid payload fields. */
function readString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

/** Read a string array from raw payload data. */
function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

/** Read a `{ [key: string]: string }` map, silently dropping invalid entries. */
function readStringMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === "string" && v.length > 0) result[k] = v;
  }
  return result;
}

/** Read an audit status from raw payload data. */
function readAuditStatus(value: unknown): AuditStatus | null {
  return value === "pass" || value === "fail" || value === "skipped"
    ? value
    : null;
}

/** Read a dashboard display status from raw payload data. */
function readAuditDisplayStatus(value: unknown): AuditDisplayStatus | null {
  return value === "pass" ||
    value === "fail" ||
    value === "warn" ||
    value === "info" ||
    value === "skipped"
    ? value
    : null;
}

/** Read a check impact label from raw payload data. */
function readAuditCheckImpact(value: unknown): AuditCheckImpact | null {
  return value === "none" || value === "scope-fail" || value === "score-only"
    ? value
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
function readRunnerId(value: unknown): RunnerId | null {
  const runner = readString(value).trim();
  return readInjectedRunnerIds().includes(runner) ? (runner as RunnerId) : null;
}

function readPromptInvocationStyle(
  value: unknown,
): PromptInvocationStyle | null {
  return value === "slash" || value === "dollar" ? value : null;
}

function readSkillSource(value: unknown): SkillSource | null {
  return value === "installed" ||
    value === "agent-mirror" ||
    value === "github-mirror"
    ? value
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
function readSessionStatus(value: unknown): SessionStatus | null {
  return value === "starting" || value === "active" || value === "terminated"
    ? value
    : null;
}

/** Read an error message from a payload record. */
function readErrorMessage(payload: JsonRecord): string | null {
  return typeof payload.error === "string" ? payload.error : null;
}

/** Collapse a project path down to the display name shown in the UI. */
function getProjectDisplayName(path: string): string {
  return path.split("/").filter(Boolean).pop() || path;
}

/** Read one audit failure record from raw payload data. */
function readAuditFailure(value: unknown): AuditFailure | null {
  if (!isRecord(value)) return null;
  const check = readString(value.check);
  const message = readString(value.message);
  if (!check || !message) return null;

  const failure: AuditFailure = { check, message };
  const evidence = readString(value.evidence);
  const howToFix = readString(value.howToFix);
  if (evidence) failure.evidence = evidence;
  if (howToFix) failure.howToFix = howToFix;
  return failure;
}

/** Read one audit check record from raw payload data. */
function readAuditCheck(value: unknown): AuditCheck | null {
  if (!isRecord(value)) return null;
  const id = readString(value.id);
  const name = readString(value.name);
  const status = readAuditStatus(value.status);
  if (!id || !name || !status) return null;

  const provenanceValue = value.provenance;
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
    value.type === "integrity" ||
    value.type === "advisory" ||
    value.type === "metric"
  ) {
    check.type = value.type;
  }
  if (value.acknowledged === true) check.acknowledged = true;
  check.displayStatus =
    readAuditDisplayStatus(value.displayStatus) ??
    defaultDisplayStatus(status, check.type, check.acknowledged === true);
  check.impact =
    readAuditCheckImpact(value.impact) ??
    defaultCheckImpact(status, check.type, check.acknowledged === true);
  if (
    value.evidenceKind === "semantic" ||
    value.evidenceKind === "structural"
  ) {
    check.evidenceKind = value.evidenceKind;
  }
  if (value.assurance === "full" || value.assurance === "limited") {
    check.assurance = value.assurance;
  }
  const failure = readAuditFailure(value.failure);
  if (failure) check.failure = failure;
  return check;
}

/** Read a string-to-string map from raw payload data. */
function readStringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};

  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return Object.fromEntries(entries);
}

/** Read one audit scope from raw payload data. */
function readAuditScope(value: unknown, context: string): AuditScope {
  const payload = readRecord(value, context);
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
function readAuditConcern(value: unknown): AuditConcern | null {
  if (!isRecord(value)) return null;
  const status = readAuditStatus(value.status);
  if (!status || typeof value.score !== "number") return null;

  /** Read a numeric counter from raw payload data. */
  const readCount = (v: unknown): number => (typeof v === "number" ? v : 0);

  return {
    status,
    score: value.score,
    findings: readStringArray(value.findings),
    recommendations: readStringArray(value.recommendations),
    howToFix: readStringArray(value.howToFix),
    integrityPass: readCount(value.integrityPass),
    integrityFail: readCount(value.integrityFail),
    advisoryPass: readCount(value.advisoryPass),
    advisoryFail: readCount(value.advisoryFail),
    advisoryAcknowledged: readCount(value.advisoryAcknowledged),
    metrics: readCount(value.metrics),
  };
}

/** Read one per-agent score from raw payload data. */
function readAgentScore(value: unknown): AgentScore | null {
  if (!isRecord(value)) return null;
  const id = readRunnerId(value.id);
  if (!id) return null;

  const harness =
    value.harness === null
      ? null
      : value.harness === undefined
        ? null
        : readAuditScope(value.harness, "Audit response harness scope");

  const concerns =
    value.concerns === null
      ? null
      : isRecord(value.concerns)
        ? Object.fromEntries(
            Object.entries(value.concerns)
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
    name: readString(value.name, id),
    agent: readAuditScope(value.agent, "Audit response agent scope"),
    harness,
    concerns,
  };
}

/** Read one learning-loop action bucket from the audit payload. */
function readLearningLoopBucketAction(
  value: unknown,
): { path: string; reason: string } | null {
  if (!isRecord(value)) return null;
  const path = readString(value.path);
  const reason = readString(value.reason);
  if (!path || !reason) return null;
  return { path, reason };
}

/** Read compact learning-loop health from the audit payload. */
function readLearningLoopSummary(
  value: unknown,
): DashboardClientReport["learningLoop"] {
  if (!isRecord(value)) return null;
  const status = readString(value.status);
  if (
    !["fresh", "needs-review", "unavailable"].includes(status) ||
    typeof value.recordCount !== "number" ||
    typeof value.footgunCount !== "number" ||
    typeof value.lessonCount !== "number" ||
    typeof value.staleCount !== "number" ||
    typeof value.invalidLineRefCount !== "number" ||
    typeof value.oversizedCount !== "number"
  ) {
    return null;
  }
  return {
    recordCount: value.recordCount,
    footgunCount: value.footgunCount,
    lessonCount: value.lessonCount,
    staleCount: value.staleCount,
    invalidLineRefCount: value.invalidLineRefCount,
    oversizedCount: value.oversizedCount,
    oldestLastReviewed:
      typeof value.oldestLastReviewed === "string"
        ? value.oldestLastReviewed
        : null,
    topBucketsNeedingAction: Array.isArray(value.topBucketsNeedingAction)
      ? value.topBucketsNeedingAction
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
function readRecentLesson(value: unknown): RecentLesson | null {
  if (!isRecord(value)) return null;
  const id = readString(value.id);
  const title = readString(value.title);
  const path = readString(value.path);
  if (!id || !title || !path) return null;
  return {
    id,
    title,
    path,
    created: readString(value.created) || null,
  };
}

/** Read a finite numeric payload field with a safe fallback. */
function readFiniteNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Read one top-level task directory summary from `/api/tasks`. */
function readTaskPlanSummary(value: unknown): TaskPlanSummary | null {
  if (!isRecord(value)) return null;
  const name = readString(value.name);
  const path = readString(value.path);
  if (!name || !path) return null;
  return {
    name,
    path,
    modifiedAt: readString(value.modifiedAt),
    milestoneCount: readFiniteNumber(value.milestoneCount),
    active: value.active === true,
  };
}

/** Read one milestone summary from `/api/tasks`. */
function readTaskMilestoneSummary(value: unknown): TaskMilestoneSummary | null {
  if (!isRecord(value)) return null;
  const filename = readString(value.filename);
  const path = readString(value.path);
  const title = readString(value.title);
  if (!filename || !path || !title) return null;
  return {
    filename,
    path,
    title,
    status: readString(value.status, "unknown"),
    objective: readString(value.objective),
    totalTasks: readFiniteNumber(value.totalTasks),
    completedTasks: readFiniteNumber(value.completedTasks),
    modifiedAt: readString(value.modifiedAt),
  };
}

/** Read the selected project's `.goat-flow/tasks/` state. */
function readTaskState(value: unknown): TaskState {
  const payload = readRecord(value, "Tasks response");
  return {
    taskRoot: readString(payload.taskRoot),
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

/** Read the full dashboard report from raw payload data. */
function readDashboardReport(value: unknown): DashboardClientReport {
  const payload = readRecord(value, "Audit response");
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

/** Read the dashboard report injected into the page shell. */
function readInjectedReport(): DashboardClientReport | null {
  if (window.__GOAT_FLOW_REPORT__ == null) return null;
  try {
    return readDashboardReport(window.__GOAT_FLOW_REPORT__);
  } catch {
    return null;
  }
}

/** Read one supported-agent record from dashboard shell injection. */
function readSupportedAgent(value: unknown): SupportedAgent | null {
  if (!isRecord(value)) return null;
  const id = readRunnerId(value.id);
  const name = readString(value.name);
  const terminalBinary = readString(value.terminalBinary).trim();
  const setupSurfaces = readStringArray(value.setupSurfaces).filter(
    (surface) => surface.trim().length > 0,
  );
  const promptInvocationStyle = readPromptInvocationStyle(
    value.promptInvocationStyle,
  );
  const skillSource = readSkillSource(value.skillSource);
  const supportsPostTurnHook = value.supportsPostTurnHook;
  if (
    !id ||
    !name ||
    !terminalBinary ||
    setupSurfaces.length === 0 ||
    !promptInvocationStyle ||
    !skillSource ||
    typeof supportsPostTurnHook !== "boolean"
  ) {
    return null;
  }
  return {
    id,
    name,
    terminalBinary,
    setupSurfaces,
    promptInvocationStyle,
    skillSource,
    supportsPostTurnHook,
  };
}

/** Read the supported agent list injected into the dashboard shell. */
function readInjectedSupportedAgents(): SupportedAgent[] {
  return Array.isArray(window.__GOAT_FLOW_AGENTS__)
    ? window.__GOAT_FLOW_AGENTS__
        .map((agent) => readSupportedAgent(agent))
        .filter((agent): agent is SupportedAgent => agent !== null)
    : [];
}

/** Read one preset definition from dashboard shell injection. */
function readPreset(value: unknown): Preset | null {
  if (!isRecord(value)) return null;
  const id = readString(value.id);
  const name = readString(value.name);
  const desc = readString(value.desc);
  const prompt = readString(value.prompt);
  const cat = readString(value.cat);
  if (!id || !name || !desc || !prompt || !cat) return null;
  const costTier =
    value.costTier === "low" ||
    value.costTier === "medium" ||
    value.costTier === "high"
      ? value.costTier
      : undefined;
  return {
    id,
    name,
    desc,
    prompt,
    cat,
    route: readString(value.route) || undefined,
    source: readString(value.source) || undefined,
    globalSafe:
      typeof value.globalSafe === "boolean" ? value.globalSafe : undefined,
    internalOnly:
      typeof value.internalOnly === "boolean" ? value.internalOnly : undefined,
    qualityMode:
      typeof value.qualityMode === "boolean" ? value.qualityMode : undefined,
    requiresGh:
      typeof value.requiresGh === "boolean" ? value.requiresGh : undefined,
    requiresPrOrIssue:
      typeof value.requiresPrOrIssue === "boolean"
        ? value.requiresPrOrIssue
        : undefined,
    requiresLocalDiff:
      typeof value.requiresLocalDiff === "boolean"
        ? value.requiresLocalDiff
        : undefined,
    requiresUiApp:
      typeof value.requiresUiApp === "boolean"
        ? value.requiresUiApp
        : undefined,
    requiresDependencyFiles:
      typeof value.requiresDependencyFiles === "boolean"
        ? value.requiresDependencyFiles
        : undefined,
    requiresGoatFlowInstall:
      typeof value.requiresGoatFlowInstall === "boolean"
        ? value.requiresGoatFlowInstall
        : undefined,
    mayCheckoutBranch:
      typeof value.mayCheckoutBranch === "boolean"
        ? value.mayCheckoutBranch
        : undefined,
    requiresCleanWorktree:
      typeof value.requiresCleanWorktree === "boolean"
        ? value.requiresCleanWorktree
        : undefined,
    mayWriteFiles:
      typeof value.mayWriteFiles === "boolean"
        ? value.mayWriteFiles
        : undefined,
    artifactRequired:
      typeof value.artifactRequired === "boolean"
        ? value.artifactRequired
        : undefined,
    bestTargetSurfaces: readStringArray(value.bestTargetSurfaces),
    fallbackPrompt: readString(value.fallbackPrompt) || undefined,
    costTier,
  };
}

/** Read the preset list injected into the dashboard shell. */
function readInjectedPresets(): Preset[] {
  return Array.isArray(window.__GOAT_FLOW_PRESETS__)
    ? window.__GOAT_FLOW_PRESETS__
        .map((preset) => readPreset(preset))
        .filter((preset): preset is Preset => preset !== null)
    : [];
}

/** Read one installed-agent record from raw payload data. */
function readAgentInfo(value: unknown): AgentInfo | null {
  if (!isRecord(value)) return null;
  const agent = readSupportedAgent(value);
  if (!agent || typeof value.installed !== "boolean") return null;

  return {
    ...agent,
    installed: value.installed,
    version: typeof value.version === "string" ? value.version : null,
  };
}

/** Read one directory entry from the project browser payload. */
function readBrowseDir(value: unknown): BrowseDir | null {
  if (!isRecord(value)) return null;
  const name = readString(value.name);
  const path = readString(value.path);
  if (!name || !path || typeof value.isProject !== "boolean") return null;

  return { name, path, isProject: value.isProject };
}

/** Read one saved project entry from persisted state. */
function readProjectEntry(value: unknown): ProjectEntry | null {
  if (!isRecord(value)) return null;
  const path = readString(value.path);
  if (!path) return null;
  const identity = readString(value.identity);
  const identitySource =
    value.identitySource === "git-remote" ||
    value.identitySource === "goat-marker" ||
    value.identitySource === "path"
      ? value.identitySource
      : null;

  const entry: ProjectEntry = {
    path,
    paths: readStringArray(value.paths),
    state: readString(value.state),
    action: readString(value.action),
    details: readString(value.details),
  };
  if (identity) entry.identity = identity;
  if (identitySource) entry.identitySource = identitySource;
  const remoteUrlHash = readString(value.remoteUrlHash);
  if (remoteUrlHash) entry.remoteUrlHash = remoteUrlHash;
  const markerId = readString(value.markerId);
  if (markerId) entry.markerId = markerId;
  return entry;
}

/** Read one backend terminal-session record from raw payload data. */
function readServerSessionInfo(value: unknown): ServerSessionInfo | null {
  if (!isRecord(value)) return null;
  const id = readString(value.id);
  const status = readSessionStatus(value.status);
  const runner = readRunnerId(value.runner);
  const createdAt = readString(value.createdAt);
  const projectPath = readString(value.projectPath);
  const cwd = readString(value.cwd);
  const targetPath = readString(value.targetPath);
  if (
    !id ||
    !status ||
    !runner ||
    !createdAt ||
    !projectPath ||
    typeof value.lastInputAt !== "number"
  ) {
    return null;
  }

  return {
    id,
    status,
    createdAt,
    projectPath,
    cwd: cwd || projectPath,
    targetPath: targetPath || projectPath,
    runner,
    lastInputAt: value.lastInputAt,
    age: typeof value.age === "number" ? value.age : undefined,
    idleDuration:
      typeof value.idleDuration === "number" ? value.idleDuration : undefined,
    projectName: readString(value.projectName) || undefined,
  };
}

/** Read a quality-command response from raw payload data. */
function readQualityResult(value: unknown): QualityResult {
  const payload = readRecord(value, "Quality response");
  const agent = readRunnerId(payload.agent);
  const auditStatus = readAuditStatus(payload.auditStatus);
  const command = readString(payload.command);
  if (
    !agent ||
    (!auditStatus && payload.auditStatus !== "unavailable") ||
    command !== "quality"
  ) {
    throw new Error("Quality response returned an invalid payload");
  }

  return {
    command: "quality",
    agent,
    auditStatus: auditStatus ?? "unavailable",
    auditSummary: readString(payload.auditSummary),
    prompt: readString(payload.prompt),
  };
}

/** Read one quality-history table row from raw payload data. */
function readQualityHistoryRow(value: unknown): QualityHistoryRow | null {
  if (!isRecord(value)) return null;
  const id = readString(value.id);
  const date = readString(value.date);
  const agent = readRunnerId(value.agent);
  if (
    !id ||
    !date ||
    !agent ||
    typeof value.setupTotal !== "number" ||
    typeof value.systemTotal !== "number" ||
    (value.setupDelta !== null && typeof value.setupDelta !== "number") ||
    typeof value.blockerCount !== "number" ||
    typeof value.majorCount !== "number" ||
    typeof value.minorCount !== "number"
  ) {
    return null;
  }
  return {
    id,
    date,
    agent,
    setupTotal: value.setupTotal,
    systemTotal: value.systemTotal,
    setupDelta: value.setupDelta,
    blockerCount: value.blockerCount,
    majorCount: value.majorCount,
    minorCount: value.minorCount,
  };
}

/** Read the latest quality-history summary from raw payload data. */
function readQualityHistoryLatest(value: unknown): QualityHistoryLatest | null {
  if (!isRecord(value)) return null;
  const id = readString(value.id);
  const date = readString(value.date);
  const time = readString(value.time);
  const agent = readRunnerId(value.agent);
  if (
    !id ||
    !date ||
    !time ||
    !agent ||
    typeof value.setupTotal !== "number" ||
    typeof value.systemTotal !== "number" ||
    typeof value.blockerCount !== "number" ||
    typeof value.majorCount !== "number" ||
    typeof value.minorCount !== "number"
  ) {
    return null;
  }
  return {
    id,
    date,
    time,
    agent,
    setupTotal: value.setupTotal,
    systemTotal: value.systemTotal,
    blockerCount: value.blockerCount,
    majorCount: value.majorCount,
    minorCount: value.minorCount,
  };
}

/** Read a persisted string array from localStorage. */
function readStoredStringArray(key: string): string[] {
  try {
    return readStringArray(JSON.parse(localStorage.getItem(key) || "[]"));
  } catch {
    return [];
  }
}

/** Read a string map from localStorage, returning an empty map on corrupt data. */
function readStoredStringMap(key: string): Record<string, string> {
  try {
    return readStringMap(JSON.parse(localStorage.getItem(key) || "{}"));
  } catch {
    return {};
  }
}
